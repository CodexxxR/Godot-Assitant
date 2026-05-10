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

export type GenerationAsset = {
  sourcePath: string;
  name: string;
  extension: string;
  size: number;
  width: number;
  height: number;
  destinationPath: string;
};

export type GenerationAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
  width: number;
  height: number;
};

export type GenerationHistoryItem = {
  id: string;
  createdAt: string;
  prompt: string;
  status: "generated" | "failed";
  message: string;
  projectName?: string;
  summary?: string;
  mainScene?: string;
  fileCount?: number;
  assetCount: number;
  attachmentCount: number;
  outputPath?: string;
  model?: string;
};

export type GeneratedProjectFile = {
  path: string;
  content: string;
};

export type GeneratedProjectManifest = {
  projectName: string;
  summary: string;
  mainScene: string;
  files: GeneratedProjectFile[];
  notes: string[];
  model?: string;
  models?: Record<string, string>;
  mode?: "free";
  targetGodotVersion?: string;
  success?: boolean;
  usedFallback?: boolean;
  repairIterationsUsed?: number;
  logs?: string[];
  validation?: {
    ok: boolean;
    static_errors: Array<{
      code?: string;
      message: string;
      file?: string;
      line?: number;
      path?: string;
    }>;
    cli_errors: string[];
    warnings: string[];
  };
  review?: {
    approved: boolean;
    issues: unknown[];
    suggested_fixes: unknown[];
    skipped?: boolean;
    warning?: string;
  };
};

export type SelectedProject = {
  rootPath: string;
  name: string;
  files: ProjectFile[];
  copiedAssets?: GenerationAsset[];
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
