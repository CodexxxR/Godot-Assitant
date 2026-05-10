import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent,
} from "react";
import {
  CheckRounded,
  CodeRounded,
  CloseRounded,
  DeleteRounded,
  ErrorOutlineRounded,
  FolderOpenRounded,
  HomeRounded,
  NoteAddRounded,
  RefreshRounded,
  RestartAltRounded,
  SportsEsportsRounded,
  SwapHorizRounded,
  SyncRounded,
} from "@mui/icons-material";
import "./App.css";
import { ChatPanel } from "./components/ChatPanel";
import { EditorPanel } from "./components/EditorPanel";
import { FileTree } from "./components/FileTree";
import { ProjectGeneratorScreen } from "./components/ProjectGeneratorScreen";
import { SystemModelScreen } from "./components/SystemModelScreen";
import { WelcomeScreen } from "./components/WelcomeScreen";
import {
  deleteIndexedFile,
  deleteProject,
  getProjectStats,
  listOpenRouterModels,
  registerProject,
  selectOpenRouterModel,
  streamChat,
  streamGeneratedCode,
  streamGodotProjectGeneration,
  streamInlineEdit,
  uploadFiles,
} from "./services/api";
import type { ModelSwitchEvent } from "./services/api";
import {
  emptyInlineState,
  emptyProjectTypeInfo,
  emptySelection,
  useAppStore,
} from "./stores/appStore";
import type {
  ChatMessage,
  EditorRange,
  EditorSelection,
  GeneratedProjectManifest,
  GenerationAttachment,
  GenerationAsset,
  GenerationHistoryItem,
  ProjectAsset,
  ProjectFile,
  RegisteredProject,
  SelectedProject,
} from "./types/project";

const makeId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".bmp",
  ".gif",
  ".svg",
  ".ico",
  ".tga",
  ".exr",
  ".hdr",
  ".dds",
  ".ktx",
  ".ktx2",
]);
const GENERATION_HISTORY_KEY = "godot-assistant:generation-history";
const MAX_PROMPT_ATTACHMENT_BYTES = 6 * 1024 * 1024;
const MAX_PROMPT_ATTACHMENTS = 6;
const CHAT_WIDTH_STORAGE_KEY = "godot-assistant:workspace-chat-width";
const DEFAULT_CHAT_WIDTH = 390;
const MIN_CHAT_WIDTH = 280;
const MAX_CHAT_WIDTH = 760;
const CHAT_RESIZER_WIDTH = 8;

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const getInitialChatWidth = () => {
  if (typeof window === "undefined") return DEFAULT_CHAT_WIDTH;

  const savedWidth = Number(window.localStorage.getItem(CHAT_WIDTH_STORAGE_KEY));
  return Number.isFinite(savedWidth)
    ? clampNumber(savedWidth, MIN_CHAT_WIDTH, MAX_CHAT_WIDTH)
    : DEFAULT_CHAT_WIDTH;
};

type GenerationPreview = {
  title: string;
  dataUrl: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
};

const isImageFile = (file?: ProjectFile) =>
  Boolean(file && (file.kind === "image" || IMAGE_EXTENSIONS.has(file.extension)));

const isTextFile = (file?: ProjectFile) => Boolean(file && !isImageFile(file));

const isPreviewableGenerationAsset = (asset: GenerationAsset) =>
  [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".svg", ".ico"].includes(
    asset.extension.toLowerCase()
  );

const isPromptImageFile = (file: File) =>
  file.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp|gif|svg|ico)$/i.test(file.name);

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read file."));
    reader.readAsDataURL(file);
  });

const getImageSize = (dataUrl: string) =>
  new Promise<{ width: number; height: number }>((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: 0, height: 0 });
    image.src = dataUrl;
  });

const toGenerationPreview = (asset: ProjectAsset, title = asset.fileName): GenerationPreview => ({
  title,
  dataUrl: asset.dataUrl,
  mimeType: asset.mimeType,
  size: asset.size,
  width: asset.width,
  height: asset.height,
});

const loadGenerationHistory = (): GenerationHistoryItem[] => {
  try {
    const raw = localStorage.getItem(GENERATION_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(0, 12) : [];
  } catch {
    return [];
  }
};

const progressForGenerationStage = (stage: string, iteration = 0, maxIterations = 2) => {
  if (stage === "plan") return 16;
  if (stage === "code") return 38;
  if (stage === "build-scenes") return 58;
  if (stage === "validate") return 70;
  if (stage === "review") return 82;
  if (stage === "repair") {
    const repairShare = maxIterations > 0 ? iteration / maxIterations : 1;
    return Math.min(95, 84 + repairShare * 10);
  }
  if (stage === "done") return 100;
  return 48;
};

const buildImageAssetIndexText = (file: ProjectFile) =>
  [
    "Godot image asset",
    `Path: ${file.path}`,
    `Name: ${file.name}`,
    `Extension: ${file.extension}`,
    `Size bytes: ${file.size}`,
    `Previewable in editor: ${file.previewable ? "yes" : "no"}`,
    "Binary pixel data is not indexed; this metadata helps the assistant reason about asset paths and scene/script references.",
  ].join("\n");

const stripCodeFence = (text: string) => {
  const match = text.match(/```[a-zA-Z0-9_+.-]*\n?([\s\S]*?)```/);
  return (match ? match[1] : text).trim();
};

type WorkspacePanel = "files" | "editor" | "chat";

const normalizeNewFilePath = (value: string) => {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) return "";
  return /\.[^/.]+$/.test(normalized) ? normalized : `${normalized}.gd`;
};

const getNewFileTemplate = (filePath: string) => {
  const normalized = filePath.toLowerCase();
  if (normalized.endsWith(".gd")) return "extends Node\n\n";
  if (normalized.endsWith(".gdshader") || normalized.endsWith(".shader")) {
    return "shader_type canvas_item;\n\n";
  }
  if (normalized.endsWith(".cs")) {
    return "using Godot;\n\npublic partial class NewScript : Node\n{\n}\n";
  }
  return "";
};

const replaceRange = (source: string, range: EditorRange, replacement: string) => {
  const lines = source.split("\n");
  const startLine = range.startLineNumber - 1;
  const endLine = range.endLineNumber - 1;
  const prefix = lines[startLine]?.slice(0, range.startColumn - 1) || "";
  const suffix = lines[endLine]?.slice(range.endColumn - 1) || "";
  const replacementLines = replacement.split("\n");

  const mergedLines =
    replacementLines.length === 1
      ? [`${prefix}${replacementLines[0]}${suffix}`]
      : [
          `${prefix}${replacementLines[0]}`,
          ...replacementLines.slice(1, -1),
          `${replacementLines[replacementLines.length - 1]}${suffix}`,
        ];

  return [
    ...lines.slice(0, startLine),
    ...mergedLines,
    ...lines.slice(endLine + 1),
  ].join("\n");
};

function App() {
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const [modelSwitchNotice, setModelSwitchNotice] = useState<
    (ModelSwitchEvent & { id: string }) | null
  >(null);
  const [collapsedPanels, setCollapsedPanels] = useState<Record<WorkspacePanel, boolean>>({
    files: false,
    editor: false,
    chat: false,
  });
  const [chatColumnWidth, setChatColumnWidth] = useState(getInitialChatWidth);
  const [isResizingChat, setIsResizingChat] = useState(false);
  const [isChatFullscreen, setIsChatFullscreen] = useState(false);
  const [isNewFileDialogOpen, setIsNewFileDialogOpen] = useState(false);
  const [newFilePath, setNewFilePath] = useState("");
  const [newFileError, setNewFileError] = useState("");
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [deleteTargetFile, setDeleteTargetFile] = useState<ProjectFile | null>(null);
  const [deleteFileError, setDeleteFileError] = useState("");
  const [isDeletingFile, setIsDeletingFile] = useState(false);
  const [generatorPrompt, setGeneratorPrompt] = useState("");
  const [generatorAssets, setGeneratorAssets] = useState<GenerationAsset[]>([]);
  const [generatorAttachments, setGeneratorAttachments] = useState<GenerationAttachment[]>([]);
  const [generatorOutputFolder, setGeneratorOutputFolder] = useState("");
  const [generatorError, setGeneratorError] = useState("");
  const [generationStatus, setGenerationStatus] = useState("");
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generatedManifest, setGeneratedManifest] =
    useState<GeneratedProjectManifest>();
  const [generationHistory, setGenerationHistory] =
    useState<GenerationHistoryItem[]>(loadGenerationHistory);
  const [generationPreview, setGenerationPreview] = useState<GenerationPreview | null>(null);
  const [isGeneratingProject, setIsGeneratingProject] = useState(false);
  const {
    activeFile,
    appendAssistantToken,
    editorFileContents,
    error,
    fileContent,
    indexedChunks,
    indexedCount,
    inlineRange,
    inlineState,
    input,
    isIndexing,
    isLoadingSystem,
    isResponding,
    isSaving,
    lastSavedContent,
    mergeEditorFileContents,
    messages,
    modelCatalog,
    prepareProjectActivation,
    projectTypeInfo,
    registeredProject,
    resetWorkspaceState,
    selectedProject,
    selection,
    setActiveFile,
    setEditorFileContents,
    setError,
    setFileContent,
    setIndexedChunks,
    setIndexedCount,
    setInlineRange,
    setInlineState,
    setInput,
    setIsIndexing,
    setIsLoadingSystem,
    setIsResponding,
    setIsSaving,
    setLastSavedContent,
    setMessages,
    setModelCatalog,
    setProjectTypeInfo,
    setRegisteredProject,
    setSelection,
    setSystemInfo,
    setView,
    systemInfo,
    updateSelectedProjectFiles,
    view,
  } = useAppStore();

  const isDirty = Boolean(activeFile) && fileContent !== lastSavedContent;
  const activeModelName = modelCatalog?.activeModel
    ? `Free: ${modelCatalog.activeModel}`
    : "Free OpenRouter model";

  const showModelSwitchNotice = useCallback((event: ModelSwitchEvent) => {
    setModelSwitchNotice({ ...event, id: makeId() });
  }, []);

  const resetGeneratorDraft = useCallback(() => {
    if (isGeneratingProject) return;
    setGeneratorPrompt("");
    setGeneratorAssets([]);
    setGeneratorAttachments([]);
    setGeneratorError("");
    setGenerationStatus("");
    setGenerationProgress(0);
    setGeneratedManifest(undefined);
    setGenerationPreview(null);
  }, [isGeneratingProject]);

  const openFreshGenerator = useCallback(() => {
    resetGeneratorDraft();
    setView("generator");
  }, [resetGeneratorDraft, setView]);

  const addGenerationHistoryItem = useCallback((item: GenerationHistoryItem) => {
    setGenerationHistory((current) => [item, ...current].slice(0, 12));
  }, []);

  const addGeneratorAttachmentFiles = useCallback(
    async (files: File[]) => {
      const imageFiles = files.filter(isPromptImageFile);
      if (!imageFiles.length) {
        setGeneratorError("Add image files as prompt attachments.");
        return;
      }

      const availableSlots = Math.max(
        0,
        MAX_PROMPT_ATTACHMENTS - generatorAttachments.length
      );
      const acceptedFiles = imageFiles
        .filter((file) => file.size <= MAX_PROMPT_ATTACHMENT_BYTES)
        .slice(0, availableSlots);

      if (!acceptedFiles.length) {
        setGeneratorError(
          `Prompt attachments are limited to ${MAX_PROMPT_ATTACHMENTS} images under 6 MB each.`
        );
        return;
      }

      const attachments = await Promise.all(
        acceptedFiles.map(async (file) => {
          const dataUrl = await readFileAsDataUrl(file);
          const size = await getImageSize(dataUrl);
          return {
            id: makeId(),
            name: file.name,
            mimeType: file.type || "image/*",
            size: file.size,
            dataUrl,
            width: size.width,
            height: size.height,
          };
        })
      );

      setGeneratorAttachments((current) => [...current, ...attachments]);
      setGeneratorError("");
    },
    [generatorAttachments.length]
  );

  const toggleWorkspacePanel = useCallback((panel: WorkspacePanel) => {
    if (panel === "chat") setIsChatFullscreen(false);
    setCollapsedPanels((current) => ({
      ...current,
      [panel]: !current[panel],
    }));
  }, []);

  const toggleChatFullscreen = useCallback(() => {
    setCollapsedPanels((current) => ({ ...current, chat: false }));
    setIsChatFullscreen((current) => !current);
  }, []);

  const getChatWidthBounds = useCallback(() => {
    const workspace = workspaceRef.current;
    if (!workspace) {
      return { min: MIN_CHAT_WIDTH, max: MAX_CHAT_WIDTH };
    }

    const filesWidth = collapsedPanels.files ? 46 : 280;
    const minEditorWidth =
      typeof window !== "undefined" && window.matchMedia("(max-width: 1180px)").matches
        ? 360
        : 420;
    const availableWidth =
      workspace.getBoundingClientRect().width - filesWidth - minEditorWidth - CHAT_RESIZER_WIDTH;

    return {
      min: MIN_CHAT_WIDTH,
      max: Math.max(MIN_CHAT_WIDTH, Math.min(MAX_CHAT_WIDTH, availableWidth)),
    };
  }, [collapsedPanels.files]);

  const setBoundedChatWidth = useCallback(
    (value: number | ((current: number) => number)) => {
      setChatColumnWidth((current) => {
        const nextValue = typeof value === "function" ? value(current) : value;
        const bounds = getChatWidthBounds();
        return clampNumber(nextValue, bounds.min, bounds.max);
      });
    },
    [getChatWidthBounds]
  );

  const handleChatResizePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (isChatFullscreen || collapsedPanels.chat || collapsedPanels.editor) return;

      event.preventDefault();
      const workspace = workspaceRef.current;
      if (!workspace) return;

      const workspaceRight = workspace.getBoundingClientRect().right;
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      setIsResizingChat(true);

      const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
        const nextWidth = workspaceRight - moveEvent.clientX;
        setBoundedChatWidth(nextWidth);
      };

      const handlePointerUp = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        setIsResizingChat(false);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [collapsedPanels.chat, collapsedPanels.editor, isChatFullscreen, setBoundedChatWidth]
  );

  const handleChatResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

      event.preventDefault();
      setBoundedChatWidth((current) => current + (event.key === "ArrowLeft" ? 24 : -24));
    },
    [setBoundedChatWidth]
  );

  useEffect(() => {
    window.localStorage.setItem(CHAT_WIDTH_STORAGE_KEY, String(Math.round(chatColumnWidth)));
  }, [chatColumnWidth]);

  useEffect(() => {
    setBoundedChatWidth((current) => current);
  }, [collapsedPanels.files, setBoundedChatWidth]);

  useEffect(() => {
    if (!modelSwitchNotice) return;

    const timeout = window.setTimeout(() => {
      setModelSwitchNotice(null);
    }, 5600);

    return () => window.clearTimeout(timeout);
  }, [modelSwitchNotice]);

  useEffect(() => {
    localStorage.setItem(
      GENERATION_HISTORY_KEY,
      JSON.stringify(generationHistory.slice(0, 12))
    );
  }, [generationHistory]);

  const refreshProjectStats = useCallback(
    async (projectId: string) => {
      try {
        const stats = await getProjectStats(projectId);
        setIndexedCount(stats.indexedFiles);
        setIndexedChunks(stats.indexedChunks);
      } catch {
        setIndexedCount(0);
        setIndexedChunks(0);
      }
    },
    [setIndexedChunks, setIndexedCount]
  );

  const openFile = useCallback(
    async (file: ProjectFile, rootPath?: string) => {
      const projectRoot = rootPath || useAppStore.getState().selectedProject?.rootPath;
      if (!projectRoot || !window.assistant) return;

      const content = isImageFile(file)
        ? (
            await window.assistant.readProjectAsset({
              rootPath: projectRoot,
              filePath: file.path,
            })
          ).dataUrl
        : await window.assistant.readProjectFile({
            rootPath: projectRoot,
            filePath: file.path,
          });

      setActiveFile(file);
      setFileContent(content);
      setLastSavedContent(content);
      if (isTextFile(file)) {
        mergeEditorFileContents({ [file.path]: content });
      }
      setSelection(emptySelection);
      setInlineRange(null);
      setInlineState(emptyInlineState);
    },
    [
      mergeEditorFileContents,
      setActiveFile,
      setFileContent,
      setInlineRange,
      setInlineState,
      setLastSavedContent,
      setSelection,
    ]
  );

  const indexProjectFiles = useCallback(
    async (project: SelectedProject, registered: RegisteredProject) => {
      if (!window.assistant) return;

      setIsIndexing(true);
      setIndexedCount(0);
      setIndexedChunks(0);

      const batchSize = 12;
      try {
        for (let offset = 0; offset < project.files.length; offset += batchSize) {
          const batch = project.files.slice(offset, offset + batchSize);
          const files = await Promise.all(
            batch.map(async (file) => {
              if (isImageFile(file)) {
                return {
                  fileName: file.path,
                  text: buildImageAssetIndexText(file),
                };
              }

              return {
                fileName: file.path,
                text: await window.assistant!.readProjectFile({
                  rootPath: project.rootPath,
                  filePath: file.path,
                }),
              };
            })
          );

          const result = await uploadFiles({
            projectId: registered.projectId,
            files,
          });

          mergeEditorFileContents(
            Object.fromEntries(
              files
                .filter((file) => !isImageFile(batch.find((item) => item.path === file.fileName)))
                .map((file) => [file.fileName, file.text])
            )
          );
          setIndexedCount((count) => count + result.indexedFiles);
          setIndexedChunks((count) => count + result.indexedChunks);
        }
      } finally {
        setIsIndexing(false);
      }
    },
    [
      mergeEditorFileContents,
      setIndexedChunks,
      setIndexedCount,
      setIsIndexing,
    ]
  );

  const loadProjectTypeInfo = useCallback(
    async (rootPath: string) => {
      if (!window.assistant) return;

      try {
        const typeInfo = await window.assistant.loadProjectTypeInfo({ rootPath });
        setProjectTypeInfo(typeInfo);
      } catch {
        setProjectTypeInfo(emptyProjectTypeInfo);
      }
    },
    [setProjectTypeInfo]
  );

  const loadProjectEditorFiles = useCallback(
    async (project: SelectedProject) => {
      if (!window.assistant) return;

      const batchSize = 40;
      for (let offset = 0; offset < project.files.length; offset += batchSize) {
        const batch = project.files.slice(offset, offset + batchSize);
        const entries = await Promise.all(
          batch.filter(isTextFile).map(async (file) => {
            const text = await window.assistant!.readProjectFile({
              rootPath: project.rootPath,
              filePath: file.path,
            });
            return [file.path, text] as const;
          })
        );

        mergeEditorFileContents(Object.fromEntries(entries));
      }
    },
    [mergeEditorFileContents]
  );

  const loadSystemModelData = useCallback(async () => {
    setIsLoadingSystem(true);
    setError("");

    try {
      const [nextSystemInfo, nextCatalog] = await Promise.all([
        window.assistant?.getSystemInfo(),
        listOpenRouterModels(),
      ]);

      if (nextSystemInfo) setSystemInfo(nextSystemInfo);
      setModelCatalog(nextCatalog);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load system information.");
    } finally {
      setIsLoadingSystem(false);
    }
  }, [setError, setIsLoadingSystem, setModelCatalog, setSystemInfo]);

  const handleOpenSystemModels = async () => {
    setView("system");
    await loadSystemModelData();
  };

  useEffect(() => {
    let cancelled = false;

    const loadActiveModel = async () => {
      try {
        const catalog = await listOpenRouterModels();
        if (!cancelled) setModelCatalog(catalog);
      } catch {
        // The system screen surfaces OpenRouter configuration errors; startup stays quiet.
      }
    };

    void loadActiveModel();

    return () => {
      cancelled = true;
    };
  }, [setModelCatalog]);

  const activateProject = useCallback(
    async (project: SelectedProject, shouldIndex: boolean) => {
      if (!window.assistant) {
        setError("Electron project bridge is unavailable.");
        return;
      }

      prepareProjectActivation(project);
      setEditorFileContents({});
      setProjectTypeInfo(emptyProjectTypeInfo);

      const registered = await registerProject({
        name: project.name,
        rootPath: project.rootPath,
      });

      setRegisteredProject(registered);
      await window.assistant.rememberProject({
        name: project.name,
        rootPath: project.rootPath,
      });
      void loadProjectTypeInfo(project.rootPath);

      if (project.files[0]) {
        await openFile(project.files[0], project.rootPath);
      }

      if (shouldIndex) {
        await indexProjectFiles(project, registered);
      } else {
        await refreshProjectStats(registered.projectId);
        void loadProjectEditorFiles(project);
      }
    },
    [
      indexProjectFiles,
      loadProjectEditorFiles,
      loadProjectTypeInfo,
      openFile,
      prepareProjectActivation,
      refreshProjectStats,
      setEditorFileContents,
      setError,
      setProjectTypeInfo,
      setRegisteredProject,
    ]
  );

  useEffect(() => {
    let cancelled = false;

    const restoreProject = async () => {
      if (!window.assistant) return;
      const project = await window.assistant.loadLastProject();
      if (!project || cancelled) return;

      try {
        await activateProject(project, false);
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof Error
              ? `Could not restore last project: ${caught.message}`
              : "Could not restore last project."
          );
        }
      }
    };

    void restoreProject();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleGenerateProject = async () => {
    if (!window.assistant) {
      setGeneratorError("Electron project writer is unavailable.");
      return;
    }

    const prompt = generatorPrompt.trim();
    if (!prompt) {
      setGeneratorError("Describe the Godot project to generate.");
      return;
    }
    if (!generatorOutputFolder) {
      setGeneratorError("Choose an output folder first.");
      return;
    }

    setIsGeneratingProject(true);
    setGeneratorError("");
    setError("");
    setGeneratedManifest(undefined);
    setGenerationProgress(4);
    let lastGenerationMessage = "Designing project";
    let manifestForHistory: GeneratedProjectManifest | undefined;

    try {
      setGenerationStatus("Designing project");
      const manifest = await streamGodotProjectGeneration(
        {
          prompt,
          assets: generatorAssets.map((asset) => ({
            name: asset.name,
            extension: asset.extension,
            size: asset.size,
            width: asset.width,
            height: asset.height,
            destinationPath: asset.destinationPath,
          })),
          attachments: generatorAttachments.map((attachment) => ({
            name: attachment.name,
            mimeType: attachment.mimeType,
            size: attachment.size,
            dataUrl: attachment.dataUrl,
            width: attachment.width,
            height: attachment.height,
          })),
          mode: "free",
          targetGodotVersion: "4.6",
          validationEnabled: true,
          repairIterations: 2,
        },
        {
          onProgress: (event) => {
            lastGenerationMessage = event.message;
            setGenerationStatus(event.message);
            setGenerationProgress(
              progressForGenerationStage(
                event.stage,
                event.iteration,
                event.maxIterations
              )
            );
            if (event.stage === "model-switch" && event.from && event.to) {
              showModelSwitchNotice({
                type: "model-switch",
                from: event.from,
                to: event.to,
              });
            }
          },
        }
      );
      manifestForHistory = manifest;
      setGeneratedManifest(manifest);

      if (manifest.success === false) {
        const validationErrors = [
          ...(manifest.validation?.static_errors.map((issue) => issue.message) || []),
          ...(manifest.validation?.cli_errors || []),
        ];
        throw new Error(
          validationErrors.length
            ? `Generated project did not pass validation: ${validationErrors.slice(0, 3).join("; ")}`
            : "Generated project did not pass validation."
        );
      }

      setGenerationStatus("Writing files");
      const project = await window.assistant.writeGeneratedProject({
        parentPath: generatorOutputFolder,
        projectName: manifest.projectName,
        files: manifest.files,
        assetPaths: generatorAssets.map((asset) => asset.sourcePath),
      });

      setGenerationStatus("Indexing project");
      await activateProject(project, true);
      addGenerationHistoryItem({
        id: makeId(),
        createdAt: new Date().toISOString(),
        prompt,
        status: "generated",
        message: `Generated ${manifest.projectName} with ${manifest.files.length} files.`,
        projectName: manifest.projectName,
        summary: manifest.summary,
        mainScene: manifest.mainScene,
        fileCount: manifest.files.length,
        assetCount: generatorAssets.length,
        attachmentCount: generatorAttachments.length,
        outputPath: project.rootPath,
        model: manifest.model,
      });
      setView("workspace");

      if (manifest.usedFallback) {
        setError(
          "The selected free model did not return a valid project manifest, so a runnable fallback Godot prototype was generated."
        );
      }
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Could not generate Godot project.";
      setGeneratorError(
        message.includes(":") ? message : `${lastGenerationMessage}: ${message}`
      );
      addGenerationHistoryItem({
        id: makeId(),
        createdAt: new Date().toISOString(),
        prompt,
        status: "failed",
        message: message.includes(":") ? message : `${lastGenerationMessage}: ${message}`,
        projectName: manifestForHistory?.projectName,
        summary: manifestForHistory?.summary,
        mainScene: manifestForHistory?.mainScene,
        fileCount: manifestForHistory?.files.length,
        assetCount: generatorAssets.length,
        attachmentCount: generatorAttachments.length,
        model: manifestForHistory?.model,
      });
    } finally {
      setGenerationStatus("");
      setGenerationProgress(0);
      setIsGeneratingProject(false);
    }
  };

  const handleSelectProject = async () => {
    if (!window.assistant) {
      setError("Electron project picker is unavailable.");
      return;
    }

    const project = await window.assistant.selectProjectFolder();
    if (!project) return;

    try {
      await activateProject(project, true);
      setView("workspace");
    } catch (caught) {
      setIsIndexing(false);
      setError(caught instanceof Error ? caught.message : "Project indexing failed.");
    }
  };

  const handleSelectModel = async (model: string) => {
    try {
      const selected = await selectOpenRouterModel(model);
      setModelCatalog((current) =>
        current ? { ...current, activeModel: selected.activeModel } : current
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not select model.");
    }
  };

  const handleSelectGeneratorOutput = async () => {
    if (!window.assistant) return;

    const folder = await window.assistant.selectGenerationParentFolder();
    if (folder) {
      setGeneratorOutputFolder(folder);
      setGeneratorError("");
    }
  };

  const addGeneratorAssetPaths = async (paths: string[]) => {
    if (!window.assistant) return;

    const nextPaths = Array.from(
      new Set([...generatorAssets.map((asset) => asset.sourcePath), ...paths].filter(Boolean))
    );
    const assets = await window.assistant.inspectGenerationAssets({ paths: nextPaths });
    setGeneratorAssets(assets);
    setGeneratorError("");
  };

  const handleSelectGeneratorAssets = async () => {
    if (!window.assistant) return;

    const assets = await window.assistant.selectGenerationAssets();
    await addGeneratorAssetPaths(assets.map((asset) => asset.sourcePath));
  };

  const handleDropGeneratorAssets = async (files: File[]) => {
    if (!window.assistant || files.length === 0) return;

    const paths = (
      await Promise.all(files.map((file) => window.assistant!.getDroppedFilePath(file)))
    ).filter(Boolean);
    if (!paths.length) {
      setGeneratorError("Could not read the dropped folder. Use Add files or folders to select it.");
      return;
    }
    await addGeneratorAssetPaths(paths);
  };

  const handlePreviewGeneratorAsset = async (asset: GenerationAsset) => {
    if (!window.assistant || !isPreviewableGenerationAsset(asset)) return;

    try {
      const preview = await window.assistant.readGenerationAsset({
        sourcePath: asset.sourcePath,
      });
      if (!preview.previewable || !preview.dataUrl) {
        setGeneratorError("This asset cannot be previewed in the app.");
        return;
      }
      setGenerationPreview(toGenerationPreview(preview, asset.name));
    } catch (caught) {
      setGeneratorError(caught instanceof Error ? caught.message : "Could not preview asset.");
    }
  };

  const handlePreviewGeneratorAttachment = (attachment: GenerationAttachment) => {
    setGenerationPreview({
      title: attachment.name,
      dataUrl: attachment.dataUrl,
      mimeType: attachment.mimeType,
      size: attachment.size,
      width: attachment.width,
      height: attachment.height,
    });
  };

  const handleRemoveGeneratorAsset = async (sourcePath: string) => {
    if (!window.assistant) return;

    const paths = generatorAssets
      .map((asset) => asset.sourcePath)
      .filter((path) => path !== sourcePath);
    const assets = await window.assistant.inspectGenerationAssets({ paths });
    setGeneratorAssets(assets);
  };

  const handleRemoveGeneratorAttachment = (id: string) => {
    setGeneratorAttachments((current) =>
      current.filter((attachment) => attachment.id !== id)
    );
  };

  const handleCreateFile = () => {
    if (!selectedProject || !window.assistant) return;

    const activeDirectory = activeFile?.path.includes("/")
      ? activeFile.path.slice(0, activeFile.path.lastIndexOf("/") + 1)
      : "scripts/";
    setNewFilePath(`${activeDirectory}new_script.gd`);
    setNewFileError("");
    setError("");
    setIsNewFileDialogOpen(true);
  };

  const handleCloseNewFileDialog = () => {
    if (isCreatingFile) return;

    setIsNewFileDialogOpen(false);
    setNewFileError("");
  };

  const handleSubmitNewFile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedProject || !window.assistant) return;

    const filePath = normalizeNewFilePath(newFilePath);
    if (!filePath) {
      setNewFileError("Enter a project-relative file path.");
      return;
    }

    const text = getNewFileTemplate(filePath);
    setNewFileError("");
    setError("");
    setIsCreatingFile(true);
    try {
      const file = await window.assistant.createProjectFile({
        rootPath: selectedProject.rootPath,
        filePath,
        text,
      });
      const files = await window.assistant.listProjectFiles({
        rootPath: selectedProject.rootPath,
      });
      updateSelectedProjectFiles(files);

      if (registeredProject) {
        await uploadFiles({
          projectId: registeredProject.projectId,
          files: [{ fileName: file.path, text }],
        });
        await refreshProjectStats(registeredProject.projectId);
      }

      setIsNewFileDialogOpen(false);
      setNewFilePath("");
      await openFile(file, selectedProject.rootPath);
    } catch (caught) {
      setNewFileError(caught instanceof Error ? caught.message : "Could not create file.");
    } finally {
      setIsCreatingFile(false);
    }
  };

  const requestDeleteFile = (file: ProjectFile) => {
    setDeleteTargetFile(file);
    setDeleteFileError("");
    setError("");
  };

  const handleCloseDeleteDialog = () => {
    if (isDeletingFile) return;

    setDeleteTargetFile(null);
    setDeleteFileError("");
  };

  const clearActiveEditor = () => {
    setActiveFile(undefined);
    setFileContent("");
    setLastSavedContent("");
    setSelection(emptySelection);
    setInlineRange(null);
    setInlineState(emptyInlineState);
  };

  const handleConfirmDeleteFile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!deleteTargetFile || !selectedProject || !window.assistant) return;

    const deletedPath = deleteTargetFile.path;
    setDeleteFileError("");
    setError("");
    setIsDeletingFile(true);

    try {
      await window.assistant.deleteProjectFile({
        rootPath: selectedProject.rootPath,
        filePath: deletedPath,
      });

      let indexCleanupError = "";
      if (registeredProject) {
        try {
          await deleteIndexedFile({
            projectId: registeredProject.projectId,
            fileName: deletedPath,
          });
        } catch (caught) {
          indexCleanupError =
            caught instanceof Error ? caught.message : "Indexed chunks were not removed.";
        }
      }

      const files = await window.assistant.listProjectFiles({
        rootPath: selectedProject.rootPath,
      });
      updateSelectedProjectFiles(files);

      const nextEditorContents = { ...useAppStore.getState().editorFileContents };
      delete nextEditorContents[deletedPath];
      setEditorFileContents(nextEditorContents);

      if (activeFile?.path === deletedPath) {
        const nextFile = files.find((file) => file.path !== deletedPath);
        if (nextFile) {
          await openFile(nextFile, selectedProject.rootPath);
        } else {
          clearActiveEditor();
        }
      }

      if (registeredProject) {
        await refreshProjectStats(registeredProject.projectId);
      }

      setDeleteTargetFile(null);
      if (indexCleanupError) {
        setError(`File deleted, but indexed chunks were not cleared: ${indexCleanupError}`);
      }
    } catch (caught) {
      setDeleteFileError(caught instanceof Error ? caught.message : "Could not delete file.");
    } finally {
      setIsDeletingFile(false);
    }
  };

  const handleReset = async () => {
    const projectId = registeredProject?.projectId;
    resetWorkspaceState();

    if (!projectId) return;

    try {
      await deleteProject(projectId);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `Workspace reset locally, but indexed chunks were not cleared: ${caught.message}`
          : "Workspace reset locally, but indexed chunks were not cleared."
      );
    }
  };

  const sendPrompt = async (
    userMessage: string,
    options: {
      selectedCode?: string;
      selectedFile?: string;
      intent?: "chat" | "explain" | "debug" | "generate";
    } = {}
  ) => {
    if (!registeredProject || !userMessage.trim() || isResponding) return;

    const assistantId = makeId();
    setIsResponding(true);
    setMessages((current: ChatMessage[]) => [
      ...current,
      { id: makeId(), role: "user", content: userMessage },
      { id: assistantId, role: "assistant", content: "" },
    ]);

    try {
      await streamChat(
        {
          projectId: registeredProject.projectId,
          message: userMessage,
          selectedCode: (options.selectedCode ?? selection.text) || undefined,
          selectedFile: options.selectedFile ?? activeFile?.path,
          activeFileContent: activeFile
            ? isImageFile(activeFile)
              ? buildImageAssetIndexText(activeFile)
              : fileContent
            : undefined,
          intent: options.intent || "chat",
        },
        {
          onModelSwitch: showModelSwitchNotice,
          onToken: (token) => appendAssistantToken(assistantId, token),
        }
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Chat failed.";
      setMessages((current: ChatMessage[]) =>
        current.map((chatMessage) =>
          chatMessage.id === assistantId
            ? { ...chatMessage, content: message }
            : chatMessage
        )
      );
    } finally {
      setIsResponding(false);
    }
  };

  const handleSend = async () => {
    const userMessage = input.trim();
    setInput("");
    await sendPrompt(userMessage);
  };

  const handleExplainSelection = (targetSelection: EditorSelection) => {
    if (!targetSelection.text.trim() || !activeFile) return;

    const lineLabel = targetSelection.range
      ? `lines ${targetSelection.range.startLineNumber}-${targetSelection.range.endLineNumber}`
      : "the selected lines";

    void sendPrompt(`Explain this GDScript selection from ${activeFile.path} (${lineLabel}).`, {
      selectedCode: targetSelection.text,
      selectedFile: activeFile.path,
      intent: "explain",
    });
  };

  const handleDebugSelection = (targetSelection: EditorSelection) => {
    if (!targetSelection.text.trim() || !activeFile) return;

    void sendPrompt(`Debug this GDScript from ${activeFile.path}.`, {
      selectedCode: targetSelection.text,
      selectedFile: activeFile.path,
      intent: "debug",
    });
  };

  const handleInlineRequest = async (
    targetSelection: EditorSelection,
    instruction: string
  ) => {
    if (!registeredProject || !activeFile || !targetSelection.range || isResponding) return;

    setInlineRange(targetSelection.range);
    setInlineState({ isLoading: true, suggestion: "", error: "" });

    try {
      await streamInlineEdit(
        {
          projectId: registeredProject.projectId,
          instruction,
          selectedCode: targetSelection.text,
          selectedFile: activeFile.path,
          activeFileContent: fileContent,
        },
        {
          onModelSwitch: showModelSwitchNotice,
          onToken: (token) => {
            setInlineState((current) => ({
              ...current,
              suggestion: `${current.suggestion}${token}`,
            }));
          },
        }
      );
    } catch (caught) {
      setInlineState({
        isLoading: false,
        suggestion: "",
        error: caught instanceof Error ? caught.message : "Inline AI failed.",
      });
      return;
    }

    setInlineState((current) => ({
      ...current,
      isLoading: false,
      suggestion: stripCodeFence(current.suggestion),
    }));
  };

  const handleGenerateRequest = async (
    targetSelection: EditorSelection,
    instruction: string
  ) => {
    if (!registeredProject || !activeFile || !targetSelection.range || isResponding) return;

    setInlineRange(targetSelection.range);
    setInlineState({ isLoading: true, suggestion: "", error: "" });

    try {
      await streamGeneratedCode(
        {
          projectId: registeredProject.projectId,
          instruction,
          selectedCode: targetSelection.text,
          selectedFile: activeFile.path,
          activeFileContent: fileContent,
        },
        {
          onModelSwitch: showModelSwitchNotice,
          onToken: (token) => {
            setInlineState((current) => ({
              ...current,
              suggestion: `${current.suggestion}${token}`,
            }));
          },
        }
      );
    } catch (caught) {
      setInlineState({
        isLoading: false,
        suggestion: "",
        error: caught instanceof Error ? caught.message : "Code generation failed.",
      });
      return;
    }

    setInlineState((current) => ({
      ...current,
      isLoading: false,
      suggestion: stripCodeFence(current.suggestion),
    }));
  };

  const handleApplyInline = () => {
    if (!inlineRange || !inlineState.suggestion) return;

    setFileContent((current) =>
      replaceRange(current, inlineRange, stripCodeFence(inlineState.suggestion))
    );
    setSelection(emptySelection);
    setInlineRange(null);
    setInlineState(emptyInlineState);
  };

  const handleSave = async () => {
    if (
      !activeFile ||
      !selectedProject ||
      !registeredProject ||
      !window.assistant ||
      !isTextFile(activeFile)
    ) {
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      await window.assistant.writeProjectFile({
        rootPath: selectedProject.rootPath,
        filePath: activeFile.path,
        text: fileContent,
      });
      setLastSavedContent(fileContent);
      mergeEditorFileContents({ [activeFile.path]: fileContent });

      const result = await uploadFiles({
        projectId: registeredProject.projectId,
        files: [{ fileName: activeFile.path, text: fileContent }],
      });
      setIndexedChunks((count) => count + result.indexedChunks);
      await refreshProjectStats(registeredProject.projectId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Save failed.");
    } finally {
      setIsSaving(false);
    }
  };

  const selectedCodeInfo =
    activeFile && isImageFile(activeFile)
      ? "Image asset selected"
      : selection.text && activeFile
      ? `${selection.lineCount} selected line${selection.lineCount === 1 ? "" : "s"}`
      : indexedChunks
        ? `${indexedChunks} chunks indexed`
        : undefined;
  const sendDisabled =
    !registeredProject || !input.trim() || isResponding || isIndexing;
  const canResizeChat =
    !isChatFullscreen && !collapsedPanels.editor && !collapsedPanels.chat;
  const workspaceStyle = {
    "--files-column": collapsedPanels.files ? "46px" : "280px",
    "--editor-column": collapsedPanels.editor ? "46px" : "minmax(420px, 1fr)",
    "--chat-resizer-column": canResizeChat ? `${CHAT_RESIZER_WIDTH}px` : "0px",
    "--chat-column": collapsedPanels.chat ? "46px" : `${Math.round(chatColumnWidth)}px`,
  } as CSSProperties;
  const workspaceClassName = `workspace-grid${isChatFullscreen ? " chat-fullscreen" : ""}${
    canResizeChat ? " has-chat-resizer" : ""
  }${isResizingChat ? " is-resizing-chat" : ""}`;

  if (view === "welcome") {
    return (
      <main className="app-shell">
        {modelSwitchNotice ? (
          <div className="model-switch-ribbon" key={modelSwitchNotice.id} role="status">
            <SwapHorizRounded />
            <span>
              Free model switched from {modelSwitchNotice.from} to {modelSwitchNotice.to}
            </span>
            <div className="ribbon-timer" />
          </div>
        ) : null}
        {error ? (
          <div className="error-banner">
            <ErrorOutlineRounded />
            <span>{error}</span>
          </div>
        ) : null}
        <WelcomeScreen
          canContinue={Boolean(selectedProject && registeredProject)}
          isIndexing={isIndexing}
          onContinue={() => setView("workspace")}
          onGenerateProject={openFreshGenerator}
          onOpenModels={handleOpenSystemModels}
          onOpenProject={handleSelectProject}
          projectName={registeredProject?.name}
        />
      </main>
    );
  }

  if (view === "generator") {
    return (
      <main className="app-shell">
        {modelSwitchNotice ? (
          <div className="model-switch-ribbon" key={modelSwitchNotice.id} role="status">
            <SwapHorizRounded />
            <span>
              Free model switched from {modelSwitchNotice.from} to {modelSwitchNotice.to}
            </span>
            <div className="ribbon-timer" />
          </div>
        ) : null}
        {error ? (
          <div className="error-banner">
            <ErrorOutlineRounded />
            <span>{error}</span>
          </div>
        ) : null}
        <ProjectGeneratorScreen
          assets={generatorAssets}
          attachments={generatorAttachments}
          error={generatorError}
          generatedManifest={generatedManifest}
          history={generationHistory}
          isGenerating={isGeneratingProject}
          preview={generationPreview}
          progress={generationProgress}
          onAddAssets={handleSelectGeneratorAssets}
          onAddAttachments={addGeneratorAttachmentFiles}
          onAssetDrop={handleDropGeneratorAssets}
          onAttachmentDrop={addGeneratorAttachmentFiles}
          onBack={() => setView(selectedProject && registeredProject ? "workspace" : "welcome")}
          onClosePreview={() => setGenerationPreview(null)}
          onGenerate={handleGenerateProject}
          onOutputFolder={handleSelectGeneratorOutput}
          onPromptChange={setGeneratorPrompt}
          onRemoveAsset={handleRemoveGeneratorAsset}
          onRemoveAttachment={handleRemoveGeneratorAttachment}
          onPreviewAsset={handlePreviewGeneratorAsset}
          onPreviewAttachment={handlePreviewGeneratorAttachment}
          outputFolder={generatorOutputFolder}
          prompt={generatorPrompt}
          status={generationStatus}
        />
      </main>
    );
  }

  if (view === "system") {
    return (
      <main className="app-shell">
        {modelSwitchNotice ? (
          <div className="model-switch-ribbon" key={modelSwitchNotice.id} role="status">
            <SwapHorizRounded />
            <span>
              Free model switched from {modelSwitchNotice.from} to {modelSwitchNotice.to}
            </span>
            <div className="ribbon-timer" />
          </div>
        ) : null}
        {error ? (
          <div className="error-banner">
            <ErrorOutlineRounded />
            <span>{error}</span>
          </div>
        ) : null}
        <SystemModelScreen
          catalog={modelCatalog}
          isLoading={isLoadingSystem}
          onBack={() => setView("welcome")}
          onRefresh={loadSystemModelData}
          onSelectModel={handleSelectModel}
          systemInfo={systemInfo}
        />
      </main>
    );
  }

  return (
    <main className="app-shell">
      {modelSwitchNotice ? (
        <div className="model-switch-ribbon" key={modelSwitchNotice.id} role="status">
          <SwapHorizRounded />
          <span>
            Free model switched from {modelSwitchNotice.from} to {modelSwitchNotice.to}
          </span>
          <div className="ribbon-timer" />
        </div>
      ) : null}
      <header className="topbar">
        <div className="brand">
          <CodeRounded />
          <div>
            <h1>Godot Assistant</h1>
            <span>
              {registeredProject?.name || "No project selected"} · {activeModelName}
            </span>
          </div>
        </div>
        <div className="topbar-actions">
          <button
            className="toolbar-button"
            disabled={isIndexing || isResponding}
            onClick={() => setView("welcome")}
            title="Home"
            type="button"
          >
            <HomeRounded />
            <span>Home</span>
          </button>
          <button
            className="toolbar-button"
            disabled={!selectedProject || isIndexing || isResponding}
            onClick={handleCreateFile}
            title="New Godot file"
            type="button"
          >
            <NoteAddRounded />
            <span>New file</span>
          </button>
          <button
            className="toolbar-button"
            disabled={isIndexing || isResponding || isGeneratingProject}
            onClick={openFreshGenerator}
            title="Generate Godot project"
            type="button"
          >
            <SportsEsportsRounded />
            <span>Generate</span>
          </button>
          <button
            className="toolbar-button"
            disabled={isIndexing || isResponding}
            onClick={handleReset}
            title="Reset workspace"
            type="button"
          >
            <RestartAltRounded />
            <span>Reset</span>
          </button>
          <button
            className="toolbar-button"
            disabled={isIndexing || isResponding}
            onClick={handleSelectProject}
            type="button"
          >
            {isIndexing ? <RefreshRounded className="spin" /> : <FolderOpenRounded />}
            <span>{isIndexing ? "Indexing" : "Project"}</span>
          </button>
        </div>
      </header>

      {error ? (
        <div className="error-banner">
          <ErrorOutlineRounded />
          <span>{error}</span>
        </div>
      ) : null}

      {isNewFileDialogOpen ? (
        <div className="modal-backdrop" role="presentation">
          <form
            className="new-file-dialog"
            onKeyDown={(event) => {
              if (event.key === "Escape") handleCloseNewFileDialog();
            }}
            onSubmit={handleSubmitNewFile}
          >
            <div className="dialog-header">
              <div>
                <h2>New Godot file</h2>
                <span>{selectedProject?.name}</span>
              </div>
              <button
                className="icon-button compact-icon"
                disabled={isCreatingFile}
                onClick={handleCloseNewFileDialog}
                title="Close"
                type="button"
              >
                <CloseRounded />
              </button>
            </div>
            <label className="dialog-body">
              <span>Path</span>
              <input
                autoFocus
                disabled={isCreatingFile}
                onChange={(event) => setNewFilePath(event.target.value)}
                placeholder="scripts/player_controller.gd"
                value={newFilePath}
              />
            </label>
            {newFileError ? <div className="dialog-error">{newFileError}</div> : null}
            <div className="dialog-actions">
              <button
                className="secondary-action compact-action"
                disabled={isCreatingFile}
                onClick={handleCloseNewFileDialog}
                type="button"
              >
                <CloseRounded />
                <span>Cancel</span>
              </button>
              <button
                className="primary-action compact-action"
                disabled={isCreatingFile || !newFilePath.trim()}
                type="submit"
              >
                {isCreatingFile ? <SyncRounded className="spin" /> : <CheckRounded />}
                <span>Create</span>
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {deleteTargetFile ? (
        <div className="modal-backdrop" role="presentation">
          <form
            className="new-file-dialog"
            onKeyDown={(event) => {
              if (event.key === "Escape") handleCloseDeleteDialog();
            }}
            onSubmit={handleConfirmDeleteFile}
          >
            <div className="dialog-header">
              <div>
                <h2>Delete file</h2>
                <span>{deleteTargetFile.name}</span>
              </div>
              <button
                className="icon-button compact-icon"
                disabled={isDeletingFile}
                onClick={handleCloseDeleteDialog}
                title="Close"
                type="button"
              >
                <CloseRounded />
              </button>
            </div>
            <div className="dialog-body">
              <span>Path</span>
              <div className="delete-path-preview">{deleteTargetFile.path}</div>
            </div>
            {deleteFileError ? <div className="dialog-error">{deleteFileError}</div> : null}
            <div className="dialog-actions">
              <button
                className="secondary-action compact-action"
                disabled={isDeletingFile}
                onClick={handleCloseDeleteDialog}
                type="button"
              >
                <CloseRounded />
                <span>Cancel</span>
              </button>
              <button
                className="danger-action compact-action"
                disabled={isDeletingFile}
                type="submit"
              >
                {isDeletingFile ? <SyncRounded className="spin" /> : <DeleteRounded />}
                <span>Delete</span>
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <div
        className={workspaceClassName}
        ref={workspaceRef}
        style={isChatFullscreen ? undefined : workspaceStyle}
      >
        {!isChatFullscreen ? (
          <FileTree
            activePath={activeFile?.path}
            files={selectedProject?.files || []}
            indexedCount={indexedCount}
            isCollapsed={collapsedPanels.files}
            deletingPath={isDeletingFile ? deleteTargetFile?.path : undefined}
            key={selectedProject?.rootPath || "empty-project"}
            onDelete={requestDeleteFile}
            onSelect={openFile}
            onTogglePanel={() => toggleWorkspacePanel("files")}
            totalCount={selectedProject?.files.length || 0}
          />
        ) : null}
        {!isChatFullscreen ? (
          <EditorPanel
            activeFile={activeFile}
            content={fileContent}
            projectTypeInfo={projectTypeInfo}
            projectFiles={editorFileContents}
            inlineState={inlineState}
            isCollapsed={collapsedPanels.editor}
            isDeleting={isDeletingFile && deleteTargetFile?.path === activeFile?.path}
            isDirty={isDirty}
            isSaving={isSaving}
            onApplyInline={handleApplyInline}
            onContentChange={setFileContent}
            onDebugSelection={handleDebugSelection}
            onDismissInline={() => {
              setInlineRange(null);
              setInlineState(emptyInlineState);
            }}
            onExplainSelection={handleExplainSelection}
            onGenerateRequest={handleGenerateRequest}
            onInlineRequest={handleInlineRequest}
            onDeleteFile={requestDeleteFile}
            onSave={handleSave}
            onSelectionChange={setSelection}
            onTogglePanel={() => toggleWorkspacePanel("editor")}
          />
        ) : null}
        {canResizeChat ? (
          <div
            aria-label="Resize assistant panel"
            aria-orientation="vertical"
            className="workspace-chat-resizer"
            onKeyDown={handleChatResizeKeyDown}
            onPointerDown={handleChatResizePointerDown}
            role="separator"
            tabIndex={0}
            title="Drag to resize assistant"
          />
        ) : null}
        <ChatPanel
          disabled={sendDisabled}
          input={input}
          isCollapsed={collapsedPanels.chat && !isChatFullscreen}
          isFullscreen={isChatFullscreen}
          isLoading={isResponding}
          messages={messages}
          onInputChange={setInput}
          onSend={handleSend}
          onToggleCollapse={() => toggleWorkspacePanel("chat")}
          onToggleFullscreen={toggleChatFullscreen}
          selectedCodeInfo={selectedCodeInfo}
        />
      </div>
    </main>
  );
}

export default App;
