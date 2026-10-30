# film-previz

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
