import Editor from "@monaco-editor/react";
import {
  ContentCopyRounded,
  FullscreenExitRounded,
  FullscreenRounded,
  KeyboardDoubleArrowLeftRounded,
  KeyboardDoubleArrowRightRounded,
  SendRounded,
  SyncRounded,
} from "@mui/icons-material";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { FormEvent, KeyboardEvent, WheelEvent } from "react";
import type { ChatMessage } from "../types/project";

type ChatPanelProps = {
  messages: ChatMessage[];
  input: string;
  isLoading: boolean;
  disabled: boolean;
  isCollapsed?: boolean;
  isFullscreen?: boolean;
  selectedCodeInfo?: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onToggleCollapse?: () => void;
  onToggleFullscreen?: () => void;
};

type MessageSegment =
  | {
      type: "text";
      content: string;
    }
  | {
      type: "code";
      content: string;
      language: string;
    };

const parseMessageContent = (content: string): MessageSegment[] => {
  const segments: MessageSegment[] = [];
  const codeFence = /```([a-zA-Z0-9_+.-]*)[^\n]*\n?([\s\S]*?)(?:```|$)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = codeFence.exec(content)) !== null) {
    if (match.index > cursor) {
      segments.push({
        type: "text",
        content: content.slice(cursor, match.index),
      });
    }

    segments.push({
      type: "code",
      language: match[1] || "code",
      content: match[2],
    });

    cursor = codeFence.lastIndex;
  }

  if (cursor < content.length) {
    segments.push({
      type: "text",
      content: content.slice(cursor),
    });
  }

  return segments.length ? segments : [{ type: "text", content }];
};

const getMonacoLanguage = (language: string) => {
  const normalized = language.toLowerCase();

  if (["ts", "tsx", "typescript"].includes(normalized)) return "typescript";
  if (["gd", "gdscript"].includes(normalized)) return "gdscript";
  if (["gdshader", "shader", "glsl"].includes(normalized)) return "glsl";
  if (["tscn", "tres", "godot", "ini"].includes(normalized)) return "ini";
  if (["js", "jsx", "mjs", "cjs", "javascript"].includes(normalized)) return "javascript";
  if (["sh", "shell", "bash", "zsh"].includes(normalized)) return "shell";
  if (["yml", "yaml"].includes(normalized)) return "yaml";
  if (["md", "markdown"].includes(normalized)) return "markdown";
  if (["txt", "text", "plain", "plaintext", "code"].includes(normalized)) {
    return "plaintext";
  }
  if (["html", "css", "json", "markdown", "sql"].includes(normalized)) {
    return normalized;
  }

  return "plaintext";
};

function CodeSnippet({
  code,
  language,
  onWheel,
  snippetId,
}: {
  code: string;
  language: string;
  onWheel: (deltaY: number) => void;
  snippetId: string;
}) {
  const height = Math.min(900, Math.max(110, code.split("\n").length * 20 + 46));

  const handleEditorWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

    event.preventDefault();
    event.stopPropagation();
    onWheel(event.deltaY);
  };

  const handleCopy = () => {
    void navigator.clipboard?.writeText(code);
  };

  return (
    <div className="code-snippet">
      <div className="code-snippet-header">
        <span>{language}</span>
        <button className="snippet-copy" onClick={handleCopy} title="Copy code" type="button">
          <ContentCopyRounded />
        </button>
      </div>
      <div className="code-snippet-editor" onWheelCapture={handleEditorWheel} style={{ height }}>
        <Editor
          height="100%"
          language={getMonacoLanguage(language)}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 12,
            fontFamily: "JetBrains Mono, SFMono-Regular, Menlo, monospace",
            lineNumbers: "on",
            folding: false,
            glyphMargin: false,
            lineDecorationsWidth: 8,
            lineNumbersMinChars: 3,
            overviewRulerLanes: 0,
            renderLineHighlight: "none",
            scrollBeyondLastLine: false,
            scrollbar: {
              alwaysConsumeMouseWheel: false,
            },
            wordWrap: "on",
          }}
          path={`${snippetId}.${language || "txt"}`}
          theme="vs-dark"
          value={code}
        />
      </div>
    </div>
  );
}

function MessageContent({
  message,
  onSnippetWheel,
}: {
  message: ChatMessage;
  onSnippetWheel: (deltaY: number) => void;
}) {
  const segments = useMemo(() => parseMessageContent(message.content), [message.content]);

  return (
    <div className="message-content">
      {segments.map((segment, index) =>
        segment.type === "code" ? (
          <CodeSnippet
            code={segment.content}
            key={`${message.id}-${index}-code`}
            language={segment.language}
            onWheel={onSnippetWheel}
            snippetId={`${message.id}-${index}`}
          />
        ) : segment.content ? (
          <div className="message-text" key={`${message.id}-${index}-text`}>
            {segment.content}
          </div>
        ) : null
      )}
    </div>
  );
}

export function ChatPanel({
  messages,
  input,
  isLoading,
  disabled,
  isCollapsed = false,
  isFullscreen = false,
  selectedCodeInfo,
  onInputChange,
  onSend,
  onToggleCollapse,
  onToggleFullscreen,
}: ChatPanelProps) {
  const messagesRef = useRef<HTMLDivElement>(null);

  const scrollMessagesBy = useCallback((deltaY: number) => {
    const element = messagesRef.current;
    if (!element) return;

    element.scrollTop += deltaY;
  }, []);

  useEffect(() => {
    const element = messagesRef.current;
    if (!element) return;

    element.scrollTop = element.scrollHeight;
  }, [messages]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!disabled) onSend();
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;

    event.preventDefault();
    if (!disabled) onSend();
  };

  if (isCollapsed) {
    return (
      <section className="panel panel-rail chat-panel" aria-label="Assistant collapsed">
        <button
          className="panel-rail-button"
          onClick={onToggleCollapse}
          title="Expand assistant"
          type="button"
        >
          <KeyboardDoubleArrowLeftRounded />
          <span>Assistant</span>
        </button>
      </section>
    );
  }

  return (
    <section className="panel chat-panel">
      <div className="panel-header">
        <div>
          <h2>Assistant</h2>
          <span>{isLoading ? "Streaming" : selectedCodeInfo || "Ready"}</span>
        </div>
        <div className="panel-header-actions">
          <button
            className="icon-button compact-icon"
            onClick={onToggleFullscreen}
            title={isFullscreen ? "Exit assistant fullscreen" : "Fullscreen assistant"}
            type="button"
          >
            {isFullscreen ? <FullscreenExitRounded /> : <FullscreenRounded />}
          </button>
          {!isFullscreen ? (
            <button
              className="icon-button compact-icon"
              onClick={onToggleCollapse}
              title="Collapse assistant"
              type="button"
            >
              <KeyboardDoubleArrowRightRounded />
            </button>
          ) : null}
        </div>
      </div>
      <div className="messages" ref={messagesRef}>
        {messages.length === 0 ? (
          <p className="empty-state">Ask about the indexed project</p>
        ) : (
          messages.map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <div className="message-role">{message.role}</div>
              <MessageContent message={message} onSnippetWheel={scrollMessagesBy} />
            </article>
          ))
        )}
      </div>
      <form className="chat-form" onSubmit={handleSubmit}>
        <textarea
          disabled={isLoading}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="Ask a codebase question"
          rows={4}
          title="Enter sends. Shift+Enter adds a new line."
          value={input}
        />
        <button className="icon-button send-button" disabled={disabled} type="submit" title="Send">
          {isLoading ? <SyncRounded className="spin" /> : <SendRounded />}
        </button>
      </form>
    </section>
  );
}
