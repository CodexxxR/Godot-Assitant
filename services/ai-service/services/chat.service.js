const { retrieveProjectContext } = require("./retrieval.service");
const { streamGenerate } = require("./openrouter.service");
const config = require("../config");
const { logger } = require("../utils/logger");
const { requireString } = require("../utils/validation");

const clampText = (text = "", maxChars = 12000) => {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n// ...truncated...`;
};

const stripMarkdownFences = (text) => {
  const fence = text.match(/```[a-zA-Z0-9_+.-]*\n?([\s\S]*?)```/);
  return (fence ? fence[1] : text).trim();
};

const getLastNonEmptyLine = (text = "") =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) || "";

const getLastHeading = (text = "") => {
  const heading = text
    .split("\n")
    .reverse()
    .map((line) => line.trim().match(/^#{2,6}\s+(.+)$/))
    .find(Boolean);

  return heading?.[1]?.trim() || "";
};

const looksLikeIncompleteChatResponse = (text = "") => {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const lastLine = getLastNonEmptyLine(trimmed);
  if (/^#{2,6}\s+\S/.test(lastLine)) return true;
  if (/^\*\*[^*]+:\*\*\s*$/.test(lastLine)) return true;
  if (/[:;,-]$/.test(lastLine) && trimmed.length < 2000) return true;

  return false;
};

const stripRepeatedContinuationLeadIn = ({ text = "", previousAnswer = "" }) => {
  const previousHeading = getLastHeading(previousAnswer);
  let cleaned = text.trimStart();

  if (previousHeading) {
    const escapedHeading = previousHeading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned.replace(
      new RegExp(`^#{2,6}\\s+${escapedHeading}\\s*\\n+`, "i"),
      ""
    );
  }

  cleaned = cleaned
    .replace(
      /^The codebase is structured into several key components, each serving a specific purpose in the overall architecture\.\s*Here's a breakdown of these components and their relationships:\s*/i,
      ""
    )
    .replace(/^Here's a breakdown of these components and their relationships:\s*/i, "")
    .trimStart();

  return cleaned;
};

const isUnhelpfulContinuation = ({ text = "", previousAnswer = "" }) => {
  const cleaned = stripRepeatedContinuationLeadIn({ text, previousAnswer }).trim();
  if (!cleaned) return true;

  const previousHeading = getLastHeading(previousAnswer);
  const firstLine = cleaned.split("\n").map((line) => line.trim()).find(Boolean) || "";
  if (previousHeading && firstLine.toLowerCase() === `### ${previousHeading}`.toLowerCase()) {
    return true;
  }

  return cleaned.length < 220 && looksLikeIncompleteChatResponse(cleaned);
};

const buildContinuationMessages = ({ prompt, partialAnswer }) => {
  const lastHeading = getLastHeading(partialAnswer);

  return [
    {
      role: "system",
      content:
        "You continue incomplete technical answers. Continue only the missing content. " +
        "Never repeat prior headings, introductions, summaries, or bullets.",
    },
    {
      role: "user",
      content: prompt,
    },
    {
      role: "assistant",
      content: partialAnswer,
    },
    {
      role: "user",
      content:
        `Continue from the exact stopping point${lastHeading ? ` under "${lastHeading}"` : ""}. ` +
        "Do not write any Markdown heading. Do not repeat any prior sentence. " +
        "Start immediately with concrete bullet points or prose content.",
    },
  ];
};

const buildPrompt = ({
  message,
  context,
  selectedCode,
  selectedFile,
  activeFileContent,
  intent,
}) => {
  const selectionBlock = selectedCode
    ? `
User-selected code from ${selectedFile || "the active editor"}:
\`\`\`
${selectedCode}
\`\`\`
`
    : "";
  const activeFileBlock = activeFileContent
    ? `
Active file snapshot (${selectedFile || "active editor"}):
\`\`\`
${clampText(activeFileContent, 10000)}
\`\`\`
`
    : "";
  const intentInstruction = {
    explain:
      "The user invoked Explain this on a GDScript selection. Explain what it does, how it relates to nearby Godot nodes/resources/scenes, and call out risks or assumptions.",
    debug:
      "The user invoked Debug on a GDScript selection. Find likely runtime, signal, node-path, typing, lifecycle, indentation, and scene-resource issues. Suggest precise fixes.",
    generate:
      "The user wants new GDScript. Generate practical Godot code that fits the active file and project context.",
  }[intent] || "Use the active file, selected code, and ranked Godot project context together before answering.";

  return `
You are a senior Godot engineer helping with a local Godot project.

${intentInstruction}
Use the project context below as one unified view of the relevant files. Explain scene/script/resource relationships, node lifecycles, signal flow, exported variables, autoload assumptions, and implementation details. Reference file names when you make claims. If the context is insufficient, say what is missing instead of inventing files, node paths, scenes, or APIs.

Ranked project context:
${context}

${activeFileBlock}
${selectionBlock}
User question:
${message}

Answer in clear engineering prose. Prefer concrete file references and practical next steps.
Do not output placeholder headings. If you write a heading, immediately include useful content beneath it before moving to the next heading. For broad codebase explanations, keep the structure compact: Overview, Key Components, Request Flow, Extension Points, and Risks.

When you suggest code changes, include each snippet in a fenced Markdown code block with an accurate language tag, such as \`\`\`gdscript, \`\`\`gdshader, \`\`\`tscn, \`\`\`json, or \`\`\`text. Put the target file name in the sentence immediately before the block.
`;
};

const buildInlinePrompt = ({
  instruction,
  context,
  selectedCode,
  selectedFile,
  activeFileContent,
}) => `
You are an inline Godot GDScript coding copilot.

Return only the replacement code. Do not wrap it in Markdown. Do not explain.
Preserve the surrounding GDScript style, indentation, node API usage, signals, exported variables, and naming from the active file.
If the request is ambiguous, make the smallest useful edit.

Ranked project context:
${context}

Active file (${selectedFile || "active editor"}):
\`\`\`
${clampText(activeFileContent || "", 14000)}
\`\`\`

Selected code to replace:
\`\`\`
${selectedCode || ""}
\`\`\`

Inline instruction:
${instruction}
`;

const buildCodeGenerationPrompt = ({
  instruction,
  context,
  selectedCode,
  selectedFile,
  activeFileContent,
}) => `
You are a Godot 4 GDScript code generator.

Return only code to insert into the active editor. Do not wrap it in Markdown. Do not explain.
Use tabs or spaces consistently with the active file. Prefer typed GDScript where it is natural.
Use Godot 4 APIs unless the project context clearly shows otherwise.
When creating scene interactions, avoid inventing node paths unless the context shows them; expose NodePath or variables when appropriate.

Ranked project context:
${context}

Active file (${selectedFile || "active editor"}):
\`\`\`gdscript
${clampText(activeFileContent || "", 14000)}
\`\`\`

Selected code or insertion neighborhood:
\`\`\`gdscript
${selectedCode || ""}
\`\`\`

Generation request:
${instruction}
`;

const streamChat = async ({
  projectId,
  message,
  selectedCode,
  selectedFile,
  activeFileContent,
  intent,
  onToken,
  onModelSwitch,
}) => {
  const validMessage = requireString(message, "message");
  const { chunks, context } = await retrieveProjectContext({
    projectId,
    message: [validMessage, selectedCode || ""].join("\n\n").trim(),
    selectedCode,
    selectedFile,
  });

  if (chunks.length === 0 && !activeFileContent && !selectedCode) {
    onToken("No relevant context found for this project yet. Index the project first, then try again.");
    return;
  }

  const prompt = buildPrompt({
    message: validMessage,
    context,
    selectedCode,
    selectedFile,
    activeFileContent,
    intent,
  });

  let output = "";
  const streamAndCapture = (token) => {
    output += token;
    onToken(token);
  };
  let result = await streamGenerate({
    prompt,
    onToken: streamAndCapture,
    onModelSwitch,
  });
  let continuationCount = 0;
  let stoppedForRepeatedContinuation = false;

  while (
    continuationCount < config.openRouter.maxContinuations &&
    (["length", "max_tokens"].includes(String(result?.finishReason || "")) ||
      looksLikeIncompleteChatResponse(output))
  ) {
    continuationCount += 1;
    logger.warn("Continuing incomplete OpenRouter response", {
      projectId,
      finishReason: result?.finishReason || "unknown",
      lastLine: getLastNonEmptyLine(output),
      continuationCount,
    });

    let continuation = "";
    result = await streamGenerate({
      messages: buildContinuationMessages({
        prompt,
        partialAnswer: output,
      }),
      onModelSwitch,
      onToken: (token) => {
        continuation += token;
      },
    });

    const cleanedContinuation = stripRepeatedContinuationLeadIn({
      text: continuation,
      previousAnswer: output,
    });

    if (
      isUnhelpfulContinuation({
        text: continuation,
        previousAnswer: output,
      })
    ) {
      stoppedForRepeatedContinuation = true;
      logger.warn("Stopped repeated or unhelpful OpenRouter continuation", {
        projectId,
        model: config.openRouter.chatModel,
        continuationCount,
        preview: continuation.slice(0, 240),
      });
      break;
    }

    onToken(`\n\n${cleanedContinuation}`);
    output += `\n\n${cleanedContinuation}`;
  }

  if (stoppedForRepeatedContinuation) {
    onToken(
      `\n\n_${config.openRouter.chatModel} stopped after a repeated/incomplete continuation. ` +
        `This is common on some OpenRouter free-tier routes. Switch to DeepSeek Chat or ask "continue" manually._`
    );
  } else if (
    continuationCount >= config.openRouter.maxContinuations &&
    (["length", "max_tokens"].includes(String(result?.finishReason || "")) ||
      looksLikeIncompleteChatResponse(output))
  ) {
    onToken(
      `\n\n_Response still appears incomplete after automatic continuation. ` +
        `Ask "continue" to keep going, or increase OPENROUTER_MAX_CONTINUATIONS._`
    );
  }
};

const streamInlineEdit = async ({
  projectId,
  instruction,
  selectedCode,
  selectedFile,
  activeFileContent,
  onToken,
  onModelSwitch,
}) => {
  const validInstruction = requireString(instruction, "instruction");
  const { chunks, context } = await retrieveProjectContext({
    projectId,
    message: [validInstruction, selectedCode || "", selectedFile || ""].join("\n\n").trim(),
    selectedCode,
    selectedFile,
  });

  if (chunks.length === 0 && !activeFileContent) {
    onToken("No relevant context found for this project yet.");
    return;
  }

  let output = "";
  await streamGenerate({
    prompt: buildInlinePrompt({
      instruction: validInstruction,
      context,
      selectedCode,
      selectedFile,
      activeFileContent,
    }),
    onModelSwitch,
    onToken: (token) => {
      output += token;
      onToken(token);
    },
  });

  return stripMarkdownFences(output);
};

const streamCodeGeneration = async ({
  projectId,
  instruction,
  selectedCode,
  selectedFile,
  activeFileContent,
  onToken,
  onModelSwitch,
}) => {
  const validInstruction = requireString(instruction, "instruction");
  const { context } = await retrieveProjectContext({
    projectId,
    message: [validInstruction, selectedCode || "", selectedFile || ""].join("\n\n").trim(),
    selectedCode,
    selectedFile,
  });

  let output = "";
  await streamGenerate({
    prompt: buildCodeGenerationPrompt({
      instruction: validInstruction,
      context,
      selectedCode,
      selectedFile,
      activeFileContent,
    }),
    onModelSwitch,
    onToken: (token) => {
      output += token;
      onToken(token);
    },
  });

  return stripMarkdownFences(output);
};

module.exports = {
  streamChat,
  streamInlineEdit,
  streamCodeGeneration,
  buildPrompt,
  buildInlinePrompt,
  buildCodeGenerationPrompt,
};
