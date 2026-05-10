import {
  ArrowBackRounded,
  AutoAwesomeRounded,
  CloseRounded,
  FolderOpenRounded,
  HistoryRounded,
  ImageRounded,
  Inventory2Rounded,
  UploadFileRounded,
  VisibilityRounded,
} from "@mui/icons-material";
import { useRef } from "react";
import type { DragEvent, FormEvent } from "react";
import type {
  GenerationAsset,
  GenerationAttachment,
  GenerationHistoryItem,
  GeneratedProjectManifest,
} from "../types/project";

type GenerationPreview = {
  title: string;
  dataUrl: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
};

type ProjectGeneratorScreenProps = {
  assets: GenerationAsset[];
  attachments: GenerationAttachment[];
  error: string;
  generatedManifest?: GeneratedProjectManifest;
  history: GenerationHistoryItem[];
  isGenerating: boolean;
  outputFolder: string;
  preview: GenerationPreview | null;
  progress: number;
  prompt: string;
  status: string;
  onAddAssets: () => void;
  onAddAttachments: (files: File[]) => void;
  onAssetDrop: (files: File[]) => void;
  onAttachmentDrop: (files: File[]) => void;
  onBack: () => void;
  onClosePreview: () => void;
  onGenerate: () => void;
  onOutputFolder: () => void;
  onPromptChange: (value: string) => void;
  onPreviewAsset: (asset: GenerationAsset) => void;
  onPreviewAttachment: (attachment: GenerationAttachment) => void;
  onRemoveAsset: (sourcePath: string) => void;
  onRemoveAttachment: (id: string) => void;
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

const canPreviewAsset = (asset: GenerationAsset) =>
  [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".svg", ".ico"].includes(
    asset.extension.toLowerCase()
  );

export function ProjectGeneratorScreen({
  assets,
  attachments,
  error,
  generatedManifest,
  history,
  isGenerating,
  outputFolder,
  preview,
  progress,
  prompt,
  status,
  onAddAssets,
  onAddAttachments,
  onAssetDrop,
  onAttachmentDrop,
  onBack,
  onClosePreview,
  onGenerate,
  onOutputFolder,
  onPromptChange,
  onPreviewAsset,
  onPreviewAttachment,
  onRemoveAsset,
  onRemoveAttachment,
}: ProjectGeneratorScreenProps) {
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onGenerate();
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    onAssetDrop(Array.from(event.dataTransfer.files || []));
  };

  const handleAttachmentDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    onAttachmentDrop(Array.from(event.dataTransfer.files || []));
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

          {isGenerating && status ? (
            <div className="generator-progress" role="status">
              <AutoAwesomeRounded />
              <div>
                <span>{status}</span>
                <div className="generator-progress-track">
                  <div
                    className="generator-progress-fill"
                    style={{ width: `${Math.max(4, Math.min(100, progress))}%` }}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {error ? <div className="generator-error">{error}</div> : null}

          {generatedManifest ? (
            <div className="generator-result">
              <AutoAwesomeRounded />
              <div>
                <strong>{generatedManifest.projectName}</strong>
                <span>
                  {generatedManifest.files.length} files planned
                  {generatedManifest.usedFallback ? " with local fallback" : ""}
                  {generatedManifest.validation
                    ? ` · validation ${
                        generatedManifest.validation.ok ? "passed" : "needs repair"
                      }`
                    : ""}
                </span>
                {generatedManifest.repairIterationsUsed ? (
                  <span>{generatedManifest.repairIterationsUsed} repair pass(es)</span>
                ) : null}
                {generatedManifest.validation?.warnings.length ? (
                  <span>{generatedManifest.validation.warnings[0]}</span>
                ) : null}
              </div>
            </div>
          ) : null}

          <section className="generator-history">
            <div className="generator-history-header">
              <HistoryRounded />
              <div>
                <h2>History</h2>
                <span>{history.length ? `${history.length} recent runs` : "No runs yet"}</span>
              </div>
            </div>
            {history.length ? (
              <div className="history-list">
                {history.map((item) => (
                  <article className="history-item" key={item.id}>
                    <div>
                      <strong>{item.projectName || (item.status === "generated" ? "Generated project" : "Failed run")}</strong>
                      <span>{new Date(item.createdAt).toLocaleString()}</span>
                    </div>
                    <p>{item.prompt}</p>
                    <small>
                      {item.message}
                      {item.fileCount ? ` · ${item.fileCount} files` : ""}
                      {item.assetCount ? ` · ${item.assetCount} assets` : ""}
                      {item.attachmentCount ? ` · ${item.attachmentCount} refs` : ""}
                    </small>
                  </article>
                ))}
              </div>
            ) : (
              <p className="history-empty">Generated project summaries will stay here on this machine.</p>
            )}
          </section>
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
              <ImageRounded />
              <div>
                <h2>Prompt references</h2>
                <span>{attachments.length ? `${attachments.length} attached` : "Optional layout images"}</span>
              </div>
            </div>

            <input
              ref={attachmentInputRef}
              accept="image/*"
              hidden
              multiple
              onChange={(event) => {
                onAddAttachments(Array.from(event.target.files || []));
                event.currentTarget.value = "";
              }}
              type="file"
            />

            <div
              className="asset-dropzone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleAttachmentDrop}
            >
              <ImageRounded />
              <span>Drop map or layout images</span>
            </div>

            <button
              className="secondary-action compact-action"
              disabled={isGenerating}
              onClick={() => attachmentInputRef.current?.click()}
              type="button"
            >
              <UploadFileRounded />
              <span>Add references</span>
            </button>

            <div className="asset-list">
              {attachments.map((attachment) => (
                <div className="asset-pill three-actions" key={attachment.id}>
                  <div>
                    <strong>{attachment.name}</strong>
                    <span>
                      {attachment.width || "?"}x{attachment.height || "?"} · {formatBytes(attachment.size)}
                    </span>
                  </div>
                  <button
                    className="snippet-copy"
                    disabled={isGenerating}
                    onClick={() => onPreviewAttachment(attachment)}
                    title="Preview reference"
                    type="button"
                  >
                    <VisibilityRounded />
                  </button>
                  <button
                    className="snippet-copy"
                    disabled={isGenerating}
                    onClick={() => onRemoveAttachment(attachment.id)}
                    title="Remove reference"
                    type="button"
                  >
                    <CloseRounded />
                  </button>
                </div>
              ))}
            </div>
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
                <div className="asset-pill three-actions" key={asset.sourcePath}>
                  <div>
                    <strong>{asset.name}</strong>
                    <span>{formatBytes(asset.size)}</span>
                  </div>
                  <button
                    className="snippet-copy"
                    disabled={isGenerating || !canPreviewAsset(asset)}
                    onClick={() => onPreviewAsset(asset)}
                    title="Preview asset"
                    type="button"
                  >
                    <VisibilityRounded />
                  </button>
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

      {preview ? (
        <div className="modal-backdrop" role="presentation">
          <div className="new-file-dialog image-preview-dialog">
            <div className="dialog-header">
              <div>
                <h2>{preview.title}</h2>
                <span>
                  {preview.width || "?"}x{preview.height || "?"} · {preview.mimeType} · {formatBytes(preview.size)}
                </span>
              </div>
              <button
                className="icon-button compact-icon"
                onClick={onClosePreview}
                title="Close"
                type="button"
              >
                <CloseRounded />
              </button>
            </div>
            <div className="image-preview-body">
              <img alt={preview.title} src={preview.dataUrl} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
