# Godot Assistant

A local-first desktop IDE assistant for Godot GDScript projects. It keeps project indexing and file editing local, uses Chroma for local retrieval, and sends generation/debug/explanation prompts to OpenRouter.

## Features

- Open Godot project folders and index `.gd`, `.tscn`, `.tres`, `project.godot`, shaders, config, and common code files.
- Edit GDScript in Monaco with custom GDScript syntax highlighting and snippets.
- Generate GDScript from a prompt and insert it at the cursor.
- Edit selected code with an AI replacement preview.
- Explain or debug selected code in the assistant chat.
- Generate complete Godot 4.6.x project folders from a prompt and optional dropped assets.
- Attach prompt-only reference images for map layouts, scene composition, and level planning.
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
export OPENROUTER_CHAT_MODEL="openai/gpt-oss-120b:free"
export OPENROUTER_MAX_TOKENS="4096"
export OPENROUTER_MAX_CONTINUATIONS="2"
export OPENROUTER_FREE_FALLBACK_ATTEMPTS="6"
export OPENROUTER_STREAM_IDLE_TIMEOUT_MS="45000"
export OPENROUTER_STREAM_TOTAL_TIMEOUT_MS="180000"
```

Only zero-cost OpenRouter models are selectable. `OPENROUTER_CHAT_MODEL` takes precedence over the saved model only when it is a free model, usually an id ending in `:free`; paid model ids are ignored and the app falls back to `openai/gpt-oss-120b:free`.
When a free route is rate-limited, the service automatically retries other free code/general models up to `OPENROUTER_FREE_FALLBACK_ATTEMPTS`.

Project generation uses role-specific free OpenRouter models. Override them with free model ids only:

```bash
export OPENROUTER_PLANNER_MODEL="openai/gpt-oss-120b:free"
export OPENROUTER_CODER_MODEL="openai/gpt-oss-120b:free"
export OPENROUTER_REVIEWER_MODEL="z-ai/glm-4.5-air:free"
export OPENROUTER_FIXER_MODEL="openai/gpt-oss-120b:free"
export GODOT_TARGET_VERSION="4.6"
export GODOT_GENERATION_REPAIR_ITERATIONS="2"
```

Optional Godot CLI validation:

```bash
export GODOT_BIN="/Applications/Godot.app/Contents/MacOS/Godot"
export ENABLE_GODOT_CLI_VALIDATION="true"
```

If `GODOT_BIN` is not configured, generation still runs static validation and reports a warning.

## Run

```bash
npm run dev
```

On macOS/Linux, `npm run dev` and `npm run dev:macos` use `scripts/dev.sh`.

On Windows PowerShell, run:

```powershell
npm run dev:windows
```

The dev scripts install missing dependencies, clear stale AI/Vite ports by default, start Chroma if needed, start the AI service, and launch the Electron desktop app. Set `DEV_KILL_PORTS=0` if you do not want the launcher to kill existing listeners on ports `3001` and `5173`.

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

## Godot Project Generation Architecture

The project generator targets Godot 4.6.x only. It rejects manifests that target Godot 3.x, 4.0, 4.1, or 4.2, and static validation checks generated files for obvious old APIs such as `KinematicBody2D`.

Generation is split into free-model roles:

- `planner`: turns the user prompt, assets, and constraints into a strict JSON project and scene manifest.
- `coder`: creates GDScript and support files from the approved manifest.
- `reviewer`: checks the manifest and files for Godot 4.6 correctness.
- `fixer`: repairs only affected files or manifest sections when validation fails.

Scenes are manifest-first. The model describes scene structure as JSON with nodes, scripts, inputs, and assets. Godot Assistant then uses a deterministic scene builder to create `.tscn` files. This keeps `[ext_resource]` entries before every `ExtResource(...)` usage and avoids fragile hand-written scene text from the LLM.

Validation runs before any generated folder is written:

- `project.godot` exists and points to the manifest main scene.
- Main scene and all scene-referenced scripts exist.
- Manifest Godot version starts with `4.6`.
- `.tscn` `ExtResource` ids are defined before use.
- Generated files do not contain obvious Godot 3.x or Godot 4.2 assumptions.
- Manifest assets must match files the user actually provided.
- GDScript must not use legacy `onready` syntax.
- Grid games are checked for integer gameplay state instead of pixel-only collision logic.
- Image assets used by gameplay scripts must have an explicit scale, region, or dimension-based layout policy.
- Spawner code is checked for accidentally reusing one already-created node instance in a loop.
- Optional CLI hooks can run `godot --headless --path <project_path> --quit` and a main-scene debug check when a local Godot binary is configured.

If validation or review fails, the repair loop calls the `fixer` role with only the relevant errors and affected files. The default maximum is 2 repair iterations. Results include validation logs, warnings, model usage by role, and whether generation succeeded.

The generator screen uses a streaming progress endpoint, so it updates as each stage starts and finishes. OpenRouter streams also have idle and total body timeouts; this prevents a free provider from leaving the app stuck after it has accepted a request but stops sending tokens.

Prompt references are sent to the planner as image attachments when a free vision-capable route is available. If that route is unavailable, the generator falls back to text metadata for those images and continues with the free text planner. Project assets are separate: assets are copied into the generated Godot folder, while prompt references only guide the plan. The generator accepts individual asset files or folders; folders are scanned recursively for supported Godot assets. The desktop app sends copied asset dimensions to the planner/coder so generated scaling, grid size, and collision extents can be derived from the real files.

The local benchmark foundation in `services/ai-service/services/generation/evaluation.service.js` records model, role, test name, pass/fail, errors, latency, and timestamp as JSON. It is intentionally lightweight so free models can be compared later without changing the project generation pipeline.

Current limitations:

- Only free OpenRouter models are configured. Paid fallback is intentionally not implemented yet.
- The Phase 1 scene builder supports common 2D nodes and simple properties, not every Godot node/resource type.
- Godot CLI validation is optional and skipped unless explicitly configured.
- Binary assets are copied by the desktop app and referenced by path; the AI service does not inspect image pixels.

## API Notes

- `POST /chat` streams codebase-aware assistant responses.
- `POST /chat/inline` streams replacement code for selected editor text.
- `POST /chat/generate` streams code intended for insertion into the active editor.
- `POST /generation/godot-project` generates a manifest-first Godot 4.6 project using free model roles, static validation, optional CLI validation, and bounded repair.
- `POST /generation/godot-project/stream` returns newline-delimited progress events followed by the final generated project manifest.
- `GET /models` returns configured OpenRouter models and API-key status.
- `POST /models/select` changes the active OpenRouter model.
