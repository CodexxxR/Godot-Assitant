import { useCallback, useEffect, useState } from "react";
import {
  CodeRounded,
  ErrorOutlineRounded,
  FolderOpenRounded,
  HomeRounded,
  NoteAddRounded,
  RefreshRounded,
  RestartAltRounded,
  SwapHorizRounded,
} from "@mui/icons-material";
import "./App.css";
import { ChatPanel } from "./components/ChatPanel";
import { EditorPanel } from "./components/EditorPanel";
import { FileTree } from "./components/FileTree";
import { SystemModelScreen } from "./components/SystemModelScreen";
import { WelcomeScreen } from "./components/WelcomeScreen";
import {
  deleteProject,
  getProjectStats,
  listOpenRouterModels,
  registerProject,
  selectOpenRouterModel,
  streamChat,
  streamGeneratedCode,
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

const isImageFile = (file?: ProjectFile) =>
  Boolean(file && (file.kind === "image" || IMAGE_EXTENSIONS.has(file.extension)));

const isTextFile = (file?: ProjectFile) => Boolean(file && !isImageFile(file));

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
  const [modelSwitchNotice, setModelSwitchNotice] = useState<
    (ModelSwitchEvent & { id: string }) | null
  >(null);
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

  useEffect(() => {
    if (!modelSwitchNotice) return;

    const timeout = window.setTimeout(() => {
      setModelSwitchNotice(null);
    }, 5600);

    return () => window.clearTimeout(timeout);
  }, [modelSwitchNotice]);

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

  const handleCreateFile = async () => {
    if (!selectedProject || !window.assistant) return;

    const requestedPath = window.prompt(
      "New Godot file path",
      activeFile?.path.includes("/")
        ? `${activeFile.path.slice(0, activeFile.path.lastIndexOf("/") + 1)}new_script.gd`
        : "scripts/new_script.gd"
    );
    const filePath = requestedPath?.trim();
    if (!filePath) return;

    setError("");

    try {
      const file = await window.assistant.createProjectFile({
        rootPath: selectedProject.rootPath,
        filePath,
        text: filePath.endsWith(".gd") ? "extends Node\n\n" : "",
      });
      const files = await window.assistant.listProjectFiles({
        rootPath: selectedProject.rootPath,
      });
      updateSelectedProjectFiles(files);
      await openFile(file, selectedProject.rootPath);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create file.");
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
          onOpenModels={handleOpenSystemModels}
          onOpenProject={handleSelectProject}
          projectName={registeredProject?.name}
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

      <div className="workspace-grid">
        <FileTree
          activePath={activeFile?.path}
          files={selectedProject?.files || []}
          indexedCount={indexedCount}
          key={selectedProject?.rootPath || "empty-project"}
          onSelect={openFile}
          totalCount={selectedProject?.files.length || 0}
        />
        <EditorPanel
          activeFile={activeFile}
          content={fileContent}
          projectTypeInfo={projectTypeInfo}
          projectFiles={editorFileContents}
          inlineState={inlineState}
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
          onSave={handleSave}
          onSelectionChange={setSelection}
        />
        <ChatPanel
          disabled={sendDisabled}
          input={input}
          isLoading={isResponding}
          messages={messages}
          onInputChange={setInput}
          onSend={handleSend}
          selectedCodeInfo={selectedCodeInfo}
        />
      </div>
    </main>
  );
}

export default App;
