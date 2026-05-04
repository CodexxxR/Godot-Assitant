export type ProjectFile = {
  name: string;
  path: string;
  size: number;
  extension: string;
  kind: "text" | "image";
  previewable?: boolean;
};

export type ProjectAsset = {
  dataUrl: string;
  fileName: string;
  mimeType: string;
  previewable: boolean;
  size: number;
  width: number;
  height: number;
};

export type SelectedProject = {
  rootPath: string;
  name: string;
  files: ProjectFile[];
};

export type ProjectTypeLib = {
  filePath: string;
  content: string;
  packageName?: string;
};

export type ProjectTypeInfo = {
  compilerOptions: Record<string, unknown>;
  configFile?: string;
  packageNames: string[];
  typeLibs: ProjectTypeLib[];
  totalBytes: number;
};

export type RegisteredProject = {
  projectId: string;
  name: string;
  rootPath: string;
  registeredAt: string;
  lastOpenedAt?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type EditorRange = {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};

export type EditorSelection = {
  text: string;
  lineCount: number;
  range?: EditorRange;
  cursorLine: number;
  cursorLineText: string;
};

export type ProjectStats = {
  projectId: string;
  indexedFiles: number;
  indexedChunks: number;
  lastIndexedAt: string | null;
};

export type SystemInfo = {
  platform: string;
  arch: string;
  hostname: string;
  osRelease: string;
  modelName?: string;
  cpu: {
    model: string;
    cores: number;
    speedMhz: number;
  };
  memory: {
    totalBytes: number;
    freeBytes: number;
  };
  gpu: {
    models: string[];
    devices: Array<{
      model: string;
      vendor?: string;
      vramBytes?: number;
      metal?: string;
    }>;
  };
};

export type OpenRouterModel = {
  name: string;
  title: string;
  family: string;
  useCase: string;
  isFree: boolean;
  pricingLabel: string;
  contextLength: number;
  maxCompletionTokens: number;
  modality: string;
  limitations: string[];
};

export type OpenRouterModelCatalog = {
  activeModel: string;
  embeddingModel: string;
  provider: "OpenRouter";
  apiKeyConfigured: boolean;
  modelPolicy: "free-only";
  source: string;
  updatedAt: string;
  limitations: string[];
  models: OpenRouterModel[];
};

export type FileTreeNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children: FileTreeNode[];
  file?: ProjectFile;
};
