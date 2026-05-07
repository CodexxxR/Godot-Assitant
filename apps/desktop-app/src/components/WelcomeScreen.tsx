import {
  AccountTreeRounded,
  AutoFixHighRounded,
  CloudQueueRounded,
  FolderOpenRounded,
  ForumRounded,
  PsychologyRounded,
  SmartToyRounded,
  SportsEsportsRounded,
} from "@mui/icons-material";

type WelcomeScreenProps = {
  canContinue: boolean;
  isIndexing: boolean;
  projectName?: string;
  onContinue: () => void;
  onGenerateProject: () => void;
  onOpenModels: () => void;
  onOpenProject: () => void;
};

const featureItems = [
  {
    icon: ForumRounded,
    title: "Ask about Godot projects",
    body: "Project retrieval gives chat scripts, scenes, resources, and active selections.",
  },
  {
    icon: AutoFixHighRounded,
    title: "Generate and edit GDScript",
    body: "Insert new code, replace selections, preview changes, then save back to disk.",
  },
  {
    icon: AccountTreeRounded,
    title: "Scene-aware context",
    body: "GDScript preloads, resources, and ranked chunks help the assistant reason across files.",
  },
];

export function WelcomeScreen({
  canContinue,
  isIndexing,
  projectName,
  onContinue,
  onGenerateProject,
  onOpenModels,
  onOpenProject,
}: WelcomeScreenProps) {
  return (
    <div className="welcome-screen">
      <section className="welcome-hero">
        <div className="welcome-mark">
          <SmartToyRounded />
        </div>
        <div className="welcome-copy">
          <span className="screen-kicker">Godot copilot</span>
          <h1>Godot Assistant</h1>
          <p>
            A local-first AI code editor for Godot projects, powered by Monaco,
            OpenRouter generation, local project retrieval, GDScript editing, and
            persistent project context.
          </p>
        </div>
        <div className="welcome-actions">
          <button
            className="primary-action"
            disabled={isIndexing}
            onClick={onOpenProject}
            type="button"
          >
            <FolderOpenRounded />
            <span>{isIndexing ? "Indexing project" : "Open project"}</span>
          </button>
          <button className="secondary-action" onClick={onOpenModels} type="button">
            <CloudQueueRounded />
            <span>OpenRouter models</span>
          </button>
          <button className="secondary-action" onClick={onGenerateProject} type="button">
            <SportsEsportsRounded />
            <span>Generate project</span>
          </button>
          <button
            className="secondary-action"
            disabled={!canContinue}
            onClick={onContinue}
            type="button"
          >
            <PsychologyRounded />
            <span>{projectName ? `Continue ${projectName}` : "Continue workspace"}</span>
          </button>
        </div>
      </section>

      <section className="feature-strip" aria-label="Feature overview">
        {featureItems.map((item) => {
          const Icon = item.icon;
          return (
            <article className="feature-card" key={item.title}>
              <Icon />
              <h2>{item.title}</h2>
              <p>{item.body}</p>
            </article>
          );
        })}
      </section>
    </div>
  );
}
