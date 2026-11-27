# film-previz

**Problem.** Planning shots before a shoot needs a place to put a camera and try lenses. A streamed generated world drifts between visits, so it cannot hold a shot list.

**Idea.** Generate a set once in World Labs Marble and walk it in the browser, where a virtual camera follows real focal length and sensor math. Each saved shot exports as a frame grab plus its camera data in a shot list.

**Built.** A working browser tool on a synthetic test room: scene loading and scale marking, a lens-accurate shot camera, stand-ins, camera moves, a floor plan and the shot list export. Quest 3 code exists but has not run on a headset, and nothing has run on a real Marble export yet. Started with a spec and plan on Oct 27 to Oct 30, 2026; the app was built on Nov 1 and Nov 20 to 22.

**Decision.** The splat is for looking and a separate collider mesh is for picking, instead of raycasting against the splat. Spark's documentation does not describe raycasting against splats (unverified), so floor and wall hits go through the invisible mesh.

Status: exploration. Live URL: none. Started 2026-10-27.

## TL;DR

Walk a generated set before a shoot. Give a world model a location description, a reference photo or a still, get a walkable 3D set, then place a virtual camera in the browser, pick a lens, block stand-in characters and save shots. The output is a shot list with one frame grab per shot and the camera data behind it (lens, height, position, move), ready for an AI video tool or a real crew.

## How a session works

1. Generate a set once in World Labs Marble from text, a photo or a still, and export it.
2. Load the exported scene in the browser and set its scale (for example, mark a door as 2 m).
3. Place the camera. Pick a focal length and sensor size, set the height, aim.
4. Block simple stand-in figures where the actors stand.
5. Save the shot. The app stores the frame grab and the camera metadata.
6. Export the shot list as a folder: `shots.json`, a markdown shot list, the frames, and a location sheet.

## Usage

Install and start the app:

```
npm install
npm run dev
```

The app opens at `http://localhost:5185`. The port is fixed. Chrome and Safari both work, and both need WebGL 2. Windows narrower than 900 px show a message instead of the tool.

You do not need a Marble export to try it. `npm run make-set` writes a synthetic test room into `scenes/` (splats at two sizes, a collider mesh and a file of true measurements). The room is invented, and the files stay out of git.

The three views, in the order a person uses them:

1. **Scenes.** Choose an SPZ or PLY file, and a GLB collider mesh if you have one. Mark a known distance, such as a door, type its length and apply the scale. Name the scene, set which way is front and add notes. A scene you open is listed under Past scenes, and you open the same file again later to get its shots back.
2. **Stage.** Look through the shot camera, pick a focal length, sensor and aspect, set the height, heading and pitch, and save a shot. Select a saved shot in the strip to update it or save it as a new shot. "Save frame" downloads one JPEG and saves nothing to the scene.
3. **Shots.** Edit names, size and notes in the table, reorder, duplicate or delete shots (delete has an Undo), then export.

The export is one zip download. It holds `shots.json` (full records), `shot-list.md` (the film-craft shot list columns), `location-sheet.md`, `scene-ref.json` (scene name, file name, SHA-256 and scale source, with no scene data) and `frames/shot-001.jpg` and so on, one frame per shot. Scene files are never included.

Tests:

```
npm run typecheck
FILM_CRAFT_SHOT_LIST="/path/to/film-craft/templates/shot-list.md" npm test
npm run test:e2e
```

`npm test` runs the Vitest suites. Set `FILM_CRAFT_SHOT_LIST` to the path of film-craft's `templates/shot-list.md` so the check that the export header matches that template runs. Without it that one check is skipped. `npm run test:e2e` runs Playwright in Chromium and WebKit, starts its own server on port 5185 and takes about 12 minutes. Tests that need a scene skip when `scenes/` is empty.

Built since the first version (2026-11-21), each with tests on the synthetic room:

- Stand-ins: capsule figures on the floor with a height, a facing arrow and a readout of how tall they are in the frame
- The top-down floor plan in the export (`floor-plan.png`), with numbered cameras and an optional action axis
- Camera moves: push-in, pull-out, pan, tilt, track and handheld, with a preview and an end frame in the export
- Quest 3 code: an Enter VR button, thumbstick movement and placing shots from the headset. None of it has run on a headset

Not done yet:

- A test with a real Marble export (everything so far ran on the synthetic room)
- Any check on a Quest 3 headset (list in `notes/xr-results.md`)
- The items under "Postponed" in `docs/decisions-2026-11-21.md`

## How it works technically

```
 text / photo / still
        |
        v
  World Labs Marble  ---- generated once, exported (splats + collider mesh)
        |
        v
  local scene files (SPZ or PLY, GLB) ---- stay on disk, never in git
        |
        v
  browser: three.js + Spark splat renderer
        |   PerspectiveCamera: focal length + film gauge -> field of view
        |   collider mesh: floor and wall picking, scale marking
        v
  shot record = lens + height + pose + move + stand-ins + frame grab
        |
        v
  export folder: shots.json, shot-list.md, frames/, location-sheet.md
        |
        v
  AI video tool (frame as start image, metadata in the prompt) or a crew
```

Lens-accurate describes the virtual camera: it follows the real relation between focal length, sensor width and field of view. The generated set is a plausible space and carries no survey accuracy.

## Stack

- three.js for the scene and camera, Spark (World Labs, MIT) for Gaussian splats
- Vite and TypeScript, no UI framework until the HTML draft shows one is needed
- Vitest for the lens math and data model, Playwright for browser checks
- WebXR for the optional Quest 3 phase
- No backend. Shots live in the browser and in the export folder

## Out of scope

- Generating the world inside this app (Marble runs outside it, or through its API in a later step)
- Genie 3 and Runway GWM Worlds 2, which have no public API
- Final video rendering, lip sync, animated characters, rigged actors
- Matching a real location to survey accuracy
- Multi-user editing, accounts, a hosted scene library

## Docs

- [Spec](docs/spec.md): goals, data model, decisions, acceptance criteria
- [Implementation plan](docs/implementation-plan.md): phases 0 to 5 plus an optional Quest 3 phase
- [Phase 4 plan](docs/phase-4-plan.md): stand-ins and floor plan, step by step
- [Decisions of 2026-11-21](docs/decisions-2026-11-21.md): choices made without the owner, and what is postponed

This repo feeds [film-craft](https://github.com/weeeha/film-craft), the owner's AI film-making notebook. The shot list export follows its shot list template, and the location sheet export follows its location sheet template. Details are in the spec.

## Budget

$0 until the owner approves paid tools. The plan marks every step that costs money. The first one is the Marble export, which needs a paid Marble plan.

## Repository rules

- Branch per task, PR per change. Nothing on `main` directly.
- Media and generated scenes stay local and out of git: splats, meshes, panoramas, reference photos and frame grabs. Task 1 of the plan adds the `.gitignore` entries.
- No client material in this repo.

<!-- BEGIN:generation-family -->
## Related repos

These seventeen repos make Nick's films together, from story to sound. Each handles one stage, and the same table sits in every one of them.

| Stage | Repo | What it does |
|---|---|---|
| Story and worlds | My Films (private) | The film worlds: bibles, scenes, production plans and generated-image archives |
| Story and worlds | Storytelling Kit (private) | Storytelling cards with artwork editions |
| Story and worlds | Film Writer (private) | World-first film development with the screenplay grown from it |
| Craft and reference | film-craft (private) | Craft rules, measured film norms and dated tool tests |
| Craft and reference | Film Analyzer (private) | Frame-by-frame close reading of films |
| Craft and reference | [Look Tokens](https://github.com/weeeha/Look-Tokens) | A film's look as one token table that composes shot prompts |
| Images | [Film Design System](https://github.com/weeeha/Film-Design-System) | Keeps characters, props and settings consistent across image generations |
| Images | [Idea to Prop](https://github.com/weeeha/idea-to-prop) | Keeps one prop design connected from concept image to fabrication |
| 3D, previs and props | 3D Models (private) | Generates 3D models from text, with a viewer and gallery |
| 3D, previs and props | [Scene Builder 3D](https://github.com/weeeha/scene-builder-3d) | Blocks out shots in 3D before anything is generated |
| 3D, previs and props | [film-previz](https://github.com/weeeha/film-previz) | Walk a generated set and save camera shots (spec stage) |
| 3D, previs and props | [Location Lab](https://github.com/weeeha/location-lab) | Scout a real place and hand it to Seedance (design stage) |
| 3D, previs and props | film-props (private) | 3D-printed props and pre-vis sets |
| Video | [Video Generation Pipeline](https://github.com/weeeha/Video-Generation-Pipeline) | Seedance and Runway video generation with reusable reference packs |
| Video | Local Video Pipeline (private) | Wan 2.2 and MiniMax H3 video drafts on a local GPU |
| Video | Continuity Lab (private, in progress) | Finds and repairs inconsistencies between generated video shots |
| Sound | [Audio Generation Pipeline](https://github.com/weeeha/Audio-Generation-Pipeline) | Local speech, voice cloning and sound effects |
<!-- END:generation-family -->
