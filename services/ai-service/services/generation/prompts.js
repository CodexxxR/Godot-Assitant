const jsonOnlyRule =
  "Return ONLY valid JSON. Do not wrap the answer in Markdown. Do not add commentary. JSON values must be strings, numbers, booleans, arrays, objects, or null; never emit raw GDScript literals such as Vector2(0, 0) or Color(1, 1, 1, 1). Put those as quoted strings or numeric arrays.";

const buildPlannerPrompt = ({
  userRequest,
  targetGodotVersion,
  assets = [],
  attachments = [],
  constraints = [],
}) => `
${jsonOnlyRule}

You are the planner role for a Godot ${targetGodotVersion}.x project generator.

Create a strict JSON project plan and structural scene manifest. Target Godot ${targetGodotVersion}.x only.
Refuse Godot 3.x, 4.0, 4.1, or 4.2 APIs and assumptions. Do not use KinematicBody2D.
Prefer generated scene manifests over raw .tscn text. The system will deterministically build .tscn files.
For node properties, use JSON-safe values only. Example: "position": [120, 80] or "modulate": [1, 1, 1, 1]. If you must express a Godot constructor, quote it as a string: "position": "Vector2(120, 80)".

Required JSON shape:
{
  "godot_version": "${targetGodotVersion}",
  "game_type": "short genre",
  "main_scene": "res://scenes/Main.tscn",
  "inputs": [
    {
      "name": "move_left",
      "events": [{ "type": "key", "key": "A" }]
    }
  ],
  "autoloads": [],
  "assets": [
    { "source_name": "asset.png", "path": "res://assets/imported/asset.png", "usage": "player sprite" }
  ],
  "scenes": [
    {
      "path": "res://scenes/Main.tscn",
      "root": {
        "type": "Node2D",
        "name": "Main",
        "script": "res://scripts/main.gd",
        "children": []
      }
    }
  ],
  "scripts": [
    {
      "path": "res://scripts/main.gd",
      "extends": "Node2D",
      "purpose": "Coordinates gameplay"
    }
  ],
  "validation_expectations": [
    "project.godot run/main_scene points at res://scenes/Main.tscn",
    "All script paths referenced by scenes exist"
  ]
}

Supported scene node types for this phase:
Node, Node2D, CharacterBody2D, Area2D, StaticBody2D, RigidBody2D, Sprite2D, ColorRect, Label, Camera2D, Timer, CollisionShape2D, Marker2D, CanvasLayer.

Known copied assets:
${assets.length ? assets.map((asset) => `- ${asset.name} -> res://${asset.destinationPath}`).join("\n") : "- No assets provided; use code-drawn placeholders."}

Prompt-only visual references:
${
  attachments.length
    ? attachments
        .map(
          (attachment) =>
            `- ${attachment.name} (${attachment.mimeType}, ${
              attachment.width || "?"
            }x${attachment.height || "?"}, ${attachment.size || 0} bytes)`
        )
        .join("\n")
    : "- No prompt-only visual references."
}

If visual references are attached, use them for map layout, scene composition, obstacle placement, and gameplay structure. Do not reference them as res:// assets unless they also appear in Known copied assets.

Constraints:
${constraints.map((constraint) => `- ${constraint}`).join("\n")}

User request:
${userRequest}
`;

const buildCoderPrompt = ({ plan, targetGodotVersion }) => `
${jsonOnlyRule}

You are the coder role for a Godot ${targetGodotVersion}.x project generator.

Input is an approved JSON plan. Generate strict JSON containing project files to create.
Generate GDScript files and support files. Avoid raw .tscn files unless absolutely required.
If a raw .tscn file is generated, it must be ordered:
[gd_scene], [ext_resource], [sub_resource], [node], [connection].
Prefer scene_manifest updates instead of raw .tscn. Use Godot ${targetGodotVersion}.x-compatible GDScript.
Do not use Godot 3.x, 4.0, 4.1, or 4.2 assumptions. Do not use KinematicBody2D.

Required JSON shape:
{
  "files": [
    { "path": "res://scripts/main.gd", "content": "extends Node2D\\n..." },
    { "path": "README.md", "content": "# Game\\n..." }
  ],
  "scene_manifest": null,
  "notes": []
}

Rules:
- Script paths must match the plan.
- Use input actions from the plan.
- If assets are referenced, only reference assets listed in the plan.
- Keep files complete. No TODO placeholders.
- Do not output project.godot unless you need project settings not expressible elsewhere.

Approved plan:
${JSON.stringify(plan, null, 2)}
`;

const buildReviewerPrompt = ({ plan, files, targetGodotVersion }) => `
${jsonOnlyRule}

You are the reviewer role for generated Godot ${targetGodotVersion}.x projects.

Review the plan and generated files. Return strict JSON:
{
  "approved": true,
  "issues": [],
  "suggested_fixes": []
}

Check:
- Godot version is ${targetGodotVersion}.x.
- No Godot 4.2-specific assumptions or config/features=PackedStringArray("4.2").
- No Godot 3 syntax such as KinematicBody2D.
- No invented missing file paths.
- No broken script paths.
- No raw .tscn ExtResource usage before definition.
- No missing main scene.
- project.godot points to the correct main scene.
- GDScript class/node usage is reasonable for Godot 4.x.

Plan:
${JSON.stringify(plan, null, 2)}

Generated files:
${JSON.stringify(files, null, 2)}
`;

const buildFixerPrompt = ({
  plan,
  files,
  validation,
  targetGodotVersion,
}) => `
${jsonOnlyRule}

You are the fixer role for generated Godot ${targetGodotVersion}.x projects.

Fix only affected files or the scene manifest. Preserve the Godot ${targetGodotVersion}.x target.
Do not rewrite the whole project unless explicitly necessary.
Do not introduce Godot 3.x, 4.0, 4.1, or 4.2 APIs.

Return strict JSON:
{
  "files": [
    { "path": "res://scripts/main.gd", "content": "complete corrected file content" }
  ],
  "scene_manifest": null,
  "notes": ["what changed"]
}

Project plan:
${JSON.stringify(plan, null, 2)}

Validation/review errors:
${JSON.stringify(validation, null, 2)}

Affected files:
${JSON.stringify(files, null, 2)}
`;

module.exports = {
  buildCoderPrompt,
  buildFixerPrompt,
  buildPlannerPrompt,
  buildReviewerPrompt,
};
