import {
  ArrowBackRounded,
  CheckRounded,
  CloudQueueRounded,
  InfoRounded,
  KeyRounded,
  MemoryRounded,
  MonitorRounded,
  SpeedRounded,
  StorageRounded,
  SyncRounded,
} from "@mui/icons-material";
import type { OpenRouterModelCatalog, SystemInfo } from "../types/project";

type SystemModelScreenProps = {
  catalog?: OpenRouterModelCatalog;
  isLoading: boolean;
  systemInfo?: SystemInfo;
  onBack: () => void;
  onRefresh: () => void;
  onSelectModel: (model: string) => void;
};

const formatBytes = (bytes = 0) => {
  if (!bytes) return "Unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
};

const formatTokens = (tokens = 0) => {
  if (!tokens) return "Provider limited";
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M tokens`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K tokens`;
  return `${tokens} tokens`;
};

export function SystemModelScreen({
  catalog,
  isLoading,
  systemInfo,
  onBack,
  onRefresh,
  onSelectModel,
}: SystemModelScreenProps) {
  const activeModel = catalog?.activeModel;

  return (
    <div className="system-screen">
      <header className="screen-header">
        <button className="icon-button compact-icon" onClick={onBack} title="Back" type="button">
          <ArrowBackRounded />
        </button>
        <div>
          <span className="screen-kicker">OpenRouter free runtime</span>
          <h1>System and free models</h1>
        </div>
        <button className="secondary-action" disabled={isLoading} onClick={onRefresh} type="button">
          {isLoading ? <SyncRounded className="spin" /> : <MonitorRounded />}
          <span>Refresh</span>
        </button>
      </header>

      <section className="system-grid">
        <article className="spec-panel">
          <div className="panel-title-row">
            <SpeedRounded />
            <h2>Computer</h2>
          </div>
          <dl className="spec-list">
            <div>
              <dt>CPU</dt>
              <dd>{systemInfo?.cpu.model || "Unknown"}</dd>
            </div>
            <div>
              <dt>Cores</dt>
              <dd>{systemInfo?.cpu.cores || "Unknown"}</dd>
            </div>
            <div>
              <dt>Platform</dt>
              <dd>{systemInfo ? `${systemInfo.platform} ${systemInfo.arch}` : "Unknown"}</dd>
            </div>
          </dl>
        </article>

        <article className="spec-panel">
          <div className="panel-title-row">
            <MemoryRounded />
            <h2>Memory</h2>
          </div>
          <dl className="spec-list">
            <div>
              <dt>Total RAM</dt>
              <dd>{formatBytes(systemInfo?.memory.totalBytes)}</dd>
            </div>
            <div>
              <dt>Free RAM</dt>
              <dd>{formatBytes(systemInfo?.memory.freeBytes)}</dd>
            </div>
            <div>
              <dt>Local index</dt>
              <dd>{catalog?.embeddingModel || "Local hashing embeddings"}</dd>
            </div>
          </dl>
        </article>

        <article className="spec-panel">
          <div className="panel-title-row">
            <CloudQueueRounded />
            <h2>OpenRouter free tier</h2>
          </div>
          <dl className="spec-list">
            <div>
              <dt>API key</dt>
              <dd>{catalog?.apiKeyConfigured ? "Configured" : "Missing OPENROUTER_API_KEY"}</dd>
            </div>
            <div>
              <dt>Provider</dt>
              <dd>{catalog?.provider || "OpenRouter"} free models only</dd>
            </div>
            <div>
              <dt>Active model</dt>
              <dd>{activeModel || "Unknown"}</dd>
            </div>
            <div>
              <dt>Free models</dt>
              <dd>{catalog ? `${catalog.models.length} available` : "Loading"}</dd>
            </div>
          </dl>
        </article>
      </section>

      {!catalog?.apiKeyConfigured ? (
        <section className="pull-panel">
          <div className="panel-title-row">
            <KeyRounded />
            <h2>API key required</h2>
          </div>
          <p>
            Set OPENROUTER_API_KEY before starting the app to enable generation,
            inline edits, explanations, and debugging.
          </p>
        </section>
      ) : null}

      <section className="pull-panel free-model-note">
        <div className="panel-title-row">
          <InfoRounded />
          <h2>Free model limits</h2>
        </div>
        <p>
          This app only lists zero-cost OpenRouter models. The catalog source is{" "}
          {catalog?.source || "OpenRouter"}.
        </p>
        <ul className="limit-list">
          {(catalog?.limitations || [
            "Free routes can be rate limited, temporarily unavailable, or changed by OpenRouter/providers.",
          ]).map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </section>

      <section className="model-list" aria-label="OpenRouter models">
        {catalog?.models.length ? (
          catalog.models.map((model) => {
            const isActive = activeModel === model.name;

            return (
              <article className="model-card" key={model.name}>
                <div className="model-card-main">
                  <div>
                    <span className="model-family">{model.family}</span>
                    <h2>{model.title}</h2>
                    <p>{model.useCase}</p>
                  </div>
                  <div className="model-pills">
                    <span className="fit-pill good">Free</span>
                    <span className={`fit-pill ${isActive ? "good" : "neutral"}`}>
                      {isActive ? "Active" : "Available"}
                    </span>
                  </div>
                </div>
                <div className="model-meta">
                  <span>{model.name}</span>
                  <span>{model.pricingLabel}</span>
                  <span>Context {formatTokens(model.contextLength)}</span>
                  <span>Max output {formatTokens(model.maxCompletionTokens)}</span>
                  <span>{model.modality}</span>
                </div>
                <ul className="model-limitations">
                  {model.limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>
                <div className="model-actions">
                  <button
                    className={isActive ? "secondary-action" : "primary-action compact-action"}
                    disabled={isActive}
                    onClick={() => onSelectModel(model.name)}
                    type="button"
                  >
                    {isActive ? <CheckRounded /> : <CloudQueueRounded />}
                    <span>{isActive ? "Active" : "Use model"}</span>
                  </button>
                  <span className="install-state">Free OpenRouter route</span>
                </div>
              </article>
            );
          })
        ) : (
          <p className="empty-state">No free OpenRouter models available.</p>
        )}
      </section>

      <section className="installed-models">
        <div className="panel-title-row">
          <StorageRounded />
          <h2>Local storage</h2>
        </div>
        <dl className="spec-list">
          <div>
            <dt>Vector store</dt>
            <dd>Chroma keeps project chunks local.</dd>
          </div>
          <div>
            <dt>Generation</dt>
            <dd>Prompts are sent only to the selected free OpenRouter model.</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
