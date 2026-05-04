import type {
  OpenRouterModelCatalog,
  ProjectStats,
  RegisteredProject,
} from "../types/project";

const API_BASE_URL = import.meta.env.VITE_AI_SERVICE_URL || "http://localhost:3001";
const STREAM_EVENT_PREFIX = "\u001e";

export type ModelSwitchEvent = {
  type: "model-switch";
  from: string;
  to: string;
};

type StreamHandlers =
  | ((token: string) => void)
  | {
      onToken: (token: string) => void;
      onModelSwitch?: (event: ModelSwitchEvent) => void;
    };

const normalizeStreamHandlers = (handlers: StreamHandlers) =>
  typeof handlers === "function" ? { onToken: handlers } : handlers;

const parseJsonResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
};

const readTextStream = async (response: Response, handlers: StreamHandlers) => {
  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(text || `Request failed with ${response.status}`);
  }

  const streamHandlers = normalizeStreamHandlers(handlers);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consume = (chunk: string) => {
    buffer += chunk;

    while (buffer) {
      const eventIndex = buffer.indexOf(STREAM_EVENT_PREFIX);

      if (eventIndex === -1) {
        streamHandlers.onToken(buffer);
        buffer = "";
        return;
      }

      if (eventIndex > 0) {
        streamHandlers.onToken(buffer.slice(0, eventIndex));
        buffer = buffer.slice(eventIndex);
      }

      const lineEnd = buffer.indexOf("\n");
      if (lineEnd === -1) return;

      const rawEvent = buffer.slice(STREAM_EVENT_PREFIX.length, lineEnd);
      buffer = buffer.slice(lineEnd + 1);

      try {
        const event = JSON.parse(rawEvent) as ModelSwitchEvent;
        if (event.type === "model-switch") {
          streamHandlers.onModelSwitch?.(event);
        }
      } catch {
        streamHandlers.onToken(`${STREAM_EVENT_PREFIX}${rawEvent}\n`);
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    consume(decoder.decode(value, { stream: true }));
  }

  const tail = decoder.decode();
  if (tail) consume(tail);
  if (buffer) streamHandlers.onToken(buffer);
};

export const registerProject = async (payload: {
  name: string;
  rootPath: string;
}): Promise<RegisteredProject> => {
  const response = await fetch(`${API_BASE_URL}/project`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return parseJsonResponse<RegisteredProject>(response);
};

export const deleteProject = async (projectId: string): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/project/${projectId}`, {
    method: "DELETE",
  });

  await parseJsonResponse(response);
};

export const getProjectStats = async (projectId: string): Promise<ProjectStats> => {
  const response = await fetch(`${API_BASE_URL}/project/${projectId}/stats`);

  return parseJsonResponse<ProjectStats>(response);
};

export const uploadFile = async (payload: {
  projectId: string;
  fileName: string;
  text: string;
}): Promise<{
  projectId: string;
  fileName: string;
  indexedChunks: number;
  skippedChunks: number;
  skipped: boolean;
}> => {
  const response = await fetch(`${API_BASE_URL}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return parseJsonResponse(response);
};

export const uploadFiles = async (payload: {
  projectId: string;
  files: Array<{
    fileName: string;
    text: string;
  }>;
}): Promise<{
  projectId: string;
  indexedFiles: number;
  indexedChunks: number;
  skippedFiles: number;
  files: Array<{
    projectId: string;
    fileName: string;
    indexedChunks: number;
    skippedChunks: number;
    skipped: boolean;
    reason?: string;
  }>;
}> => {
  const response = await fetch(`${API_BASE_URL}/upload/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return parseJsonResponse(response);
};

export const streamChat = async (
  payload: {
    projectId: string;
    message: string;
    selectedCode?: string;
    selectedFile?: string;
    activeFileContent?: string;
    intent?: "chat" | "explain" | "debug" | "generate";
  },
  handlers: StreamHandlers
) => {
  const response = await fetch(`${API_BASE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  await readTextStream(response, handlers);
};

export const listOpenRouterModels = async (): Promise<OpenRouterModelCatalog> => {
  const response = await fetch(`${API_BASE_URL}/models`);

  return parseJsonResponse<OpenRouterModelCatalog>(response);
};

export const selectOpenRouterModel = async (
  model: string
): Promise<{ activeModel: string }> => {
  const response = await fetch(`${API_BASE_URL}/models/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });

  return parseJsonResponse(response);
};

export const streamGeneratedCode = async (
  payload: {
    projectId: string;
    instruction: string;
    selectedCode?: string;
    selectedFile?: string;
    activeFileContent?: string;
  },
  handlers: StreamHandlers
) => {
  const response = await fetch(`${API_BASE_URL}/chat/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  await readTextStream(response, handlers);
};

export const streamInlineEdit = async (
  payload: {
    projectId: string;
    instruction: string;
    selectedCode?: string;
    selectedFile?: string;
    activeFileContent?: string;
  },
  handlers: StreamHandlers
) => {
  const response = await fetch(`${API_BASE_URL}/chat/inline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  await readTextStream(response, handlers);
};
