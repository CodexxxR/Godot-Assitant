import { create } from "zustand";
import type {
  ChatMessage,
  EditorRange,
  EditorSelection,
  OpenRouterModelCatalog,
  ProjectFile,
  ProjectTypeInfo,
  RegisteredProject,
  SelectedProject,
  SystemInfo,
} from "../types/project";

export type AppView = "welcome" | "system" | "generator" | "workspace";

export type InlineState = {
  isLoading: boolean;
  suggestion: string;
  error: string;
};

export const emptySelection: EditorSelection = {
  text: "",
  lineCount: 0,
  cursorLine: 1,
  cursorLineText: "",
};

export const emptyProjectTypeInfo: ProjectTypeInfo = {
  compilerOptions: {},
  packageNames: [],
  typeLibs: [],
  totalBytes: 0,
};

export const emptyInlineState: InlineState = {
  isLoading: false,
  suggestion: "",
  error: "",
};

type AppStore = {
  view: AppView;
  selectedProject: SelectedProject | null;
  registeredProject: RegisteredProject | null;
  activeFile?: ProjectFile;
  fileContent: string;
  lastSavedContent: string;
  editorFileContents: Record<string, string>;
  projectTypeInfo: ProjectTypeInfo;
  indexedCount: number;
  indexedChunks: number;
  isIndexing: boolean;
  isResponding: boolean;
  isSaving: boolean;
  error: string;
  input: string;
  messages: ChatMessage[];
  selection: EditorSelection;
  inlineRange: EditorRange | null;
  inlineState: InlineState;
  systemInfo?: SystemInfo;
  modelCatalog?: OpenRouterModelCatalog;
  isLoadingSystem: boolean;

  setView: (view: AppView) => void;
  setSelectedProject: (project: SelectedProject | null) => void;
  updateSelectedProjectFiles: (files: ProjectFile[]) => void;
  setRegisteredProject: (project: RegisteredProject | null) => void;
  setActiveFile: (file?: ProjectFile) => void;
  setFileContent: (content: string | ((current: string) => string)) => void;
  setLastSavedContent: (content: string) => void;
  setEditorFileContents: (contents: Record<string, string>) => void;
  mergeEditorFileContents: (contents: Record<string, string>) => void;
  setProjectTypeInfo: (info: ProjectTypeInfo) => void;
  setIndexedCount: (count: number | ((current: number) => number)) => void;
  setIndexedChunks: (count: number | ((current: number) => number)) => void;
  setIsIndexing: (isIndexing: boolean) => void;
  setIsResponding: (isResponding: boolean) => void;
  setIsSaving: (isSaving: boolean) => void;
  setError: (error: string) => void;
  setInput: (input: string) => void;
  setMessages: (messages: ChatMessage[] | ((current: ChatMessage[]) => ChatMessage[])) => void;
  appendAssistantToken: (assistantId: string, token: string) => void;
  setSelection: (selection: EditorSelection) => void;
  setInlineRange: (range: EditorRange | null) => void;
  setInlineState: (state: InlineState | ((current: InlineState) => InlineState)) => void;
  setSystemInfo: (info?: SystemInfo) => void;
  setModelCatalog: (
    catalog?:
      | OpenRouterModelCatalog
      | ((current?: OpenRouterModelCatalog) => OpenRouterModelCatalog | undefined)
  ) => void;
  setIsLoadingSystem: (isLoadingSystem: boolean) => void;
  resetWorkspaceState: () => void;
  prepareProjectActivation: (project: SelectedProject) => void;
};

const resolveUpdate = <T>(value: T | ((current: T) => T), current: T) =>
  typeof value === "function" ? (value as (current: T) => T)(current) : value;

export const useAppStore = create<AppStore>((set) => ({
  view: "welcome",
  selectedProject: null,
  registeredProject: null,
  activeFile: undefined,
  fileContent: "",
  lastSavedContent: "",
  editorFileContents: {},
  projectTypeInfo: emptyProjectTypeInfo,
  indexedCount: 0,
  indexedChunks: 0,
  isIndexing: false,
  isResponding: false,
  isSaving: false,
  error: "",
  input: "",
  messages: [],
  selection: emptySelection,
  inlineRange: null,
  inlineState: emptyInlineState,
  systemInfo: undefined,
  modelCatalog: undefined,
  isLoadingSystem: false,

  setView: (view) => set({ view }),
  setSelectedProject: (selectedProject) => set({ selectedProject }),
  updateSelectedProjectFiles: (files) =>
    set((state) => ({
      selectedProject: state.selectedProject
        ? { ...state.selectedProject, files }
        : state.selectedProject,
    })),
  setRegisteredProject: (registeredProject) => set({ registeredProject }),
  setActiveFile: (activeFile) => set({ activeFile }),
  setFileContent: (fileContent) =>
    set((state) => ({
      fileContent: resolveUpdate(fileContent, state.fileContent),
    })),
  setLastSavedContent: (lastSavedContent) => set({ lastSavedContent }),
  setEditorFileContents: (editorFileContents) => set({ editorFileContents }),
  mergeEditorFileContents: (contents) =>
    set((state) => ({
      editorFileContents: {
        ...state.editorFileContents,
        ...contents,
      },
    })),
  setProjectTypeInfo: (projectTypeInfo) => set({ projectTypeInfo }),
  setIndexedCount: (indexedCount) =>
    set((state) => ({
      indexedCount: resolveUpdate(indexedCount, state.indexedCount),
    })),
  setIndexedChunks: (indexedChunks) =>
    set((state) => ({
      indexedChunks: resolveUpdate(indexedChunks, state.indexedChunks),
    })),
  setIsIndexing: (isIndexing) => set({ isIndexing }),
  setIsResponding: (isResponding) => set({ isResponding }),
  setIsSaving: (isSaving) => set({ isSaving }),
  setError: (error) => set({ error }),
  setInput: (input) => set({ input }),
  setMessages: (messages) =>
    set((state) => ({
      messages: resolveUpdate(messages, state.messages),
    })),
  appendAssistantToken: (assistantId, token) =>
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === assistantId
          ? { ...message, content: `${message.content}${token}` }
          : message
      ),
    })),
  setSelection: (selection) => set({ selection }),
  setInlineRange: (inlineRange) => set({ inlineRange }),
  setInlineState: (inlineState) =>
    set((state) => ({
      inlineState: resolveUpdate(inlineState, state.inlineState),
    })),
  setSystemInfo: (systemInfo) => set({ systemInfo }),
  setModelCatalog: (modelCatalog) =>
    set((state) => ({
      modelCatalog:
        typeof modelCatalog === "function" ? modelCatalog(state.modelCatalog) : modelCatalog,
    })),
  setIsLoadingSystem: (isLoadingSystem) => set({ isLoadingSystem }),
  resetWorkspaceState: () =>
    set({
      selectedProject: null,
      registeredProject: null,
      activeFile: undefined,
      fileContent: "",
      lastSavedContent: "",
      editorFileContents: {},
      projectTypeInfo: emptyProjectTypeInfo,
      indexedCount: 0,
      indexedChunks: 0,
      error: "",
      input: "",
      messages: [],
      selection: emptySelection,
      inlineRange: null,
      inlineState: emptyInlineState,
    }),
  prepareProjectActivation: (selectedProject) =>
    set({
      error: "",
      selectedProject,
      activeFile: undefined,
      fileContent: "",
      lastSavedContent: "",
      editorFileContents: {},
      projectTypeInfo: emptyProjectTypeInfo,
      messages: [],
      selection: emptySelection,
      inlineRange: null,
      inlineState: emptyInlineState,
    }),
}));
