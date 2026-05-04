# Godot Assistant

A local-first desktop IDE assistant for Godot GDScript projects. It keeps project indexing and file editing local, uses Chroma for local retrieval, and sends generation/debug/explanation prompts to OpenRouter.

## Features

- Open Godot project folders and index `.gd`, `.tscn`, `.tres`, `project.godot`, shaders, config, and common code files.
- Edit GDScript in Monaco with custom GDScript syntax highlighting and snippets.
- Generate GDScript from a prompt and insert it at the cursor.
- Edit selected code with an AI replacement preview.
- Explain or debug selected code in the assistant chat.
- Create new Godot files from the desktop toolbar.
- Select an OpenRouter model from the system/models screen.

## Setup

```bash
npm run setup
```

Set your OpenRouter API key before starting:

```bash
export OPENROUTER_API_KEY="your-key"
```

Optional model selection:

```bash
export OPENROUTER_CHAT_MODEL="qwen/qwen3-coder:free"
export OPENROUTER_MAX_TOKENS="4096"
export OPENROUTER_MAX_CONTINUATIONS="2"
export OPENROUTER_FREE_FALLBACK_ATTEMPTS="6"
```

Only zero-cost OpenRouter models are selectable. `OPENROUTER_CHAT_MODEL` takes precedence over the saved model only when it is a free model, usually an id ending in `:free`; paid model ids are ignored and the app falls back to `qwen/qwen3-coder:free`.
When a free route is rate-limited, the service automatically retries other free code/general models up to `OPENROUTER_FREE_FALLBACK_ATTEMPTS`.

## Run

```bash
npm run dev
```

The dev script installs missing dependencies, starts Chroma if needed, starts the AI service, and launches the Electron desktop app.

Image assets such as `.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`, `.gif`, `.svg`, `.ico`, `.tga`, `.exr`, `.hdr`, `.dds`, `.ktx`, and `.ktx2` appear in the file tree. Browser-previewable formats open as image previews; other Godot texture formats are tracked and indexed by metadata only.

## Useful Commands

```bash
npm run build
npm run test
```

## Services

- `apps/desktop-app`: Electron, React, Monaco, Material UI icons, Zustand.
- `services/ai-service`: Express API for project registration, indexing, retrieval, OpenRouter chat/code generation, and model selection.
- `scripts/dev.sh`: local development launcher.

## API Notes

- `POST /chat` streams codebase-aware assistant responses.
- `POST /chat/inline` streams replacement code for selected editor text.
- `POST /chat/generate` streams code intended for insertion into the active editor.
- `GET /models` returns configured OpenRouter models and API-key status.
- `POST /models/select` changes the active OpenRouter model.
