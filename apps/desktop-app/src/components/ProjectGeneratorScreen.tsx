import {
  ArrowBackRounded,
  AutoAwesomeRounded,
  CloseRounded,
  FolderOpenRounded,
  Inventory2Rounded,
  UploadFileRounded,
} from "@mui/icons-material";
import type { DragEvent, FormEvent } from "react";
import type { GenerationAsset, GeneratedProjectManifest } from "../types/project";

type ProjectGeneratorScreenProps = {
  assets: GenerationAsset[];
  error: string;
  generatedManifest?: GeneratedProjectManifest;
  isGenerating: boolean;
  outputFolder: string;
  prompt: string;
  status: string;
  onAddAssets: () => void;
  onAssetDrop: (files: File[]) => void;
  onBack: () => void;
  onGenerate: () => void;
  onOutputFolder: () => void;
  onPromptChange: (value: string) => void;
  onRemoveAsset: (sourcePath: string) => void;
};

const formatBytes = (bytes = 0) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
};

export function ProjectGeneratorScreen({
  assets,
  error,
  generatedManifest,
  isGenerating,
  outputFolder,
  prompt,
  status,
  onAddAssets,
  onAssetDrop,
  onBack,
  onGenerate,
  onOutputFolder,
  onPromptChange,
  onRemoveAsset,
}: ProjectGeneratorScreenProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onGenerate();
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    onAssetDrop(Array.from(event.dataTransfer.files || []));
  };

  return (
    <div className="generator-screen">
      <header className="screen-header generator-header">
        <button className="icon-button compact-icon" onClick={onBack} title="Back" type="button">
          <ArrowBackRounded />
        </button>
        <div>
          <span className="screen-kicker">Project generator</span>
          <h1>Generate a runnable Godot project</h1>
        </div>
        <button
          className="primary-action compact-action"
          disabled={isGenerating || !prompt.trim() || !outputFolder}
          form="project-generator-form"
          type="submit"
        >
          <AutoAwesomeRounded />
          <span>{isGenerating ? status || "Generating" : "Generate"}</span>
        </button>
      </header>

      <form className="generator-grid" id="project-generator-form" onSubmit={handleSubmit}>
        <section className="generator-main">
          <label className="generator-field">
            <span>Prompt</span>
            <textarea
              disabled={isGenerating}
              onChange={(event) => onPromptChange(event.target.value)}
              placeholder="Build a top-down shooting game level with waves of enemies, a scoring UI, and use my player/enemy sprites if provided."
              rows={10}
              value={prompt}
            />
          </label>

          {error ? <div className="generator-error">{error}</div> : null}

          {generatedManifest ? (
            <div className="generator-result">
              <AutoAwesomeRounded />
              <div>
                <strong>{generatedManifest.projectName}</strong>
                <span>
                  {generatedManifest.files.length} files planned
                  {generatedManifest.usedFallback ? " with local fallback" : ""}
                </span>
              </div>
            </div>
          ) : null}
        </section>

        <aside className="generator-side">
          <section className="generator-card">
            <div className="generator-card-header">
              <FolderOpenRounded />
              <div>
                <h2>Output</h2>
                <span>{outputFolder || "No folder selected"}</span>
              </div>
            </div>
            <button
              className="secondary-action compact-action"
              disabled={isGenerating}
              onClick={onOutputFolder}
              type="button"
            >
              <FolderOpenRounded />
              <span>Choose folder</span>
            </button>
          </section>

          <section className="generator-card">
            <div className="generator-card-header">
              <Inventory2Rounded />
              <div>
                <h2>Assets</h2>
                <span>{assets.length ? `${assets.length} selected` : "Optional"}</span>
              </div>
            </div>

            <div
              className="asset-dropzone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
            >
              <UploadFileRounded />
              <span>Drop files here</span>
            </div>

            <button
              className="secondary-action compact-action"
              disabled={isGenerating}
              onClick={onAddAssets}
              type="button"
            >
              <UploadFileRounded />
              <span>Add assets</span>
            </button>

            <div className="asset-list">
              {assets.map((asset) => (
                <div className="asset-pill" key={asset.sourcePath}>
                  <div>
                    <strong>{asset.name}</strong>
                    <span>{formatBytes(asset.size)}</span>
                  </div>
                  <button
                    className="snippet-copy"
                    disabled={isGenerating}
                    onClick={() => onRemoveAsset(asset.sourcePath)}
                    title="Remove asset"
                    type="button"
                  >
                    <CloseRounded />
                  </button>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </form>
    </div>
  );
}
