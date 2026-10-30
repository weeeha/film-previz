# film-previz: Design Spec

- **Date:** 2026-10-27
- **Status:** draft, ready for owner review. Implementation starts after the phase 0 spike and the phase 1 HTML draft are approved.
- **Surface:** one static web app with three views (Scenes, Stage, Shots). Out of scope: generating worlds inside the app, character animation, final video rendering, accounts, any backend.

## 1. Summary

A director or filmmaker generates a 3D set once in World Labs Marble, exports it, and opens it in a browser viewer built on three.js and the Spark splat renderer. In the viewer they walk the set, put a virtual camera somewhere, choose a focal length and sensor size, set the height and heading, place stand-in figures, and save a shot. The app exports a folder: a shot list that fits the shot list template in [film-craft](https://github.com/weeeha/film-craft), one frame grab per shot, camera metadata per shot, and a location sheet. An AI video tool can take the frame as a start image and the metadata as prompt text, and a real crew can read the same list.

The hard part is camera accuracy, so the first deliverable is one lens-accurate still frame. Camera moves come after that works.

## 2. Goals / non-goals

**Goals**
- Load a Marble export (SPZ or PLY splats, optional collider mesh in GLB) from local disk and render it in Chrome and Safari.
- Set real-world scale from a known object (a door marked as 2 m) or from Marble's own scale metadata when it exists.
- Derive the camera field of view from focal length and sensor width with the same math a physical camera follows, and show the numbers.
- Save a shot: lens, sensor, aspect, height, position, heading, pitch, stand-ins, frame grab.
- Compare a frame grab with a reference photo, side by side and as an overlay.
- Export a shot list folder that drops into film-craft's shot list and location sheet.
- Stay at $0 until the owner approves each paid step.

**Non-goals** *(every one of these is a place a builder could drift)*
- No world generation inside the app. Marble runs outside it. A later task may call the Marble API from a script, never from the browser.
- No Genie 3 or Runway GWM Worlds 2. Neither has a public API.
- No rigged or animated characters. Stand-ins are static capsule figures with a height.
- No video output. Camera moves are previewed and saved as start and end poses; a clip is not rendered.
- No claim that the set matches a real place. Lens accuracy applies to the virtual camera only; the generated geometry carries no survey accuracy.
- No lens distortion, lens breathing, depth of field, anamorphic squeeze or exposure model in v1.
- No upload of scene files anywhere. The app makes no network request that carries scene data.
- No storage of splats, meshes, panoramas, reference photos or frame grabs in git.

## 3. Information architecture

One page, three views, hash routes. Desktop first. The shot camera and the walk camera are separate: the walk camera moves freely through the set; the shot camera is the one being specified, drawn in the walk view as a frustum with a number.

| View | Route | Contents |
|---|---|---|
| Scenes | `#/` | Open a scene file. Shows file name, size, load time. Scale step: use Marble scale, or mark a known distance. Set ground, front direction, scene name, light note. Past scenes list (name, hash, shot count). |
| Stage | `#/stage` | Viewport with frame mask in the shot's aspect. Lens panel (focal length, sensor, aspect, computed field of view). Camera panel (height, heading, pitch, roll, position). Stand-ins panel. Reference overlay panel. Shot strip along the bottom. Buttons: look through shot camera, save shot, update shot. |
| Shots | `#/shots` | Table of saved shots with frame thumbnail, lens, height, size label, job, action, notes. Reorder, rename, delete, duplicate. Export button. |

**Export folder**

```
<scene-name>-previz/
  shots.json            full records, schema in section 4
  shot-list.md          table with the film-craft shot list columns
  location-sheet.md     filled from the scene record
  frames/shot-001.jpg   one per shot, exact aspect, no UI
  floor-plan.png        top-down view, numbered cameras (phase 3)
  scene-ref.json        scene name, file name, SHA-256, scale source (no scene data)
```

**Integration with film-craft**

film-craft keeps one folder per film, with a shot list, location sheets and floor plans. The export fills what previz knows and leaves the rest empty for the filmmaker. Column mapping, using the columns of film-craft's shot list template:

| film-craft shot list column | Filled by film-previz |
|---|---|
| # | Shot number |
| Job | Shot `job` text, empty if not set |
| Size | Shot `sizeLabel` (ECU to EWS), chosen by the user |
| Camera position and motivated move/static | Generated sentence: lens, sensor, height, position relative to the nearest named marker or the scene origin, heading, move or "static" |
| Decisive action | Shot `action` text |
| Dialogue/audio | Empty |
| Generation duration + handles | Empty (previz does not know the video provider's limits) |
| Intended edit duration | Empty |
| Light/continuity | Scene `lightNote`, then empty per shot |
| References and roles | `frames/shot-001.jpg`, role "camera position, lens and geometry; not identity", scene name and date |
| Stopping rule | Empty |
| Review/selection state | "Previz frame saved; not generated; not reviewed" |

The location sheet export fills: name and id, source kind (invented set, generated from text, photo or still) and the local file names, the floor plan image with numbered cameras, the list of reference views, each reference's role and version, and the user's notes on known generation failures (for example splat holes behind furniture). Fields about light, materials, dressing and sound stay empty.

The floor plan export serves film-craft's scene floor plan template: camera positions numbered to match the shot list, with the action axis drawn when the user sets it. The 180 degree line check in film-craft can then be done on a drawing instead of by memory.

The payoff of the integration: when a generated clip comes back from a video tool, compare its first frame with `frames/shot-001.jpg`. That is the "compare generated views with the spatial source" check in the location sheet review, made against a lens-accurate reference.

## 4. Data model

All lengths are meters in the scene's metric frame (y up) once scale is confirmed. All angles are degrees.

```ts
type Scene = {
  id: string;                      // "scene-<short hash>"
  name: string;
  sourceKind: "text" | "photo" | "still" | "video" | "other";
  sourceNote: string;              // the prompt or a description of the photo; no client material
  marbleWorldId: string | null;    // only when generated through the API
  file: { name: string; bytes: number; sha256: string; format: "spz" | "ply" };
  colliderFile: { name: string; bytes: number; sha256: string } | null;
  importFrame: "opencv";           // Marble worlds are OpenCV axes, converted on load
  scale: {
    source: "marble" | "manual" | "none";
    metricScaleFactor: number;     // multiplier from raw units to meters; 1 when source is "none"
    groundPlaneOffsetM: number;    // subtract from y after scaling so the floor is y = 0
    reference: { label: string; knownLengthM: number; measuredRaw: number } | null;
    confirmedAt: string | null;    // ISO time the user accepted the scale
  };
  frontHeadingDeg: number;         // direction treated as heading 0
  lightNote: string;
  markers: Marker[];
  createdAt: string;
};

type Marker = { id: string; label: string; positionM: [number, number, number] };

type Sensor = { id: string; label: string; widthMm: number; heightMm: number };

type StandIn = {
  id: string;
  label: string;                   // "Anna", "Cop 1"
  heightM: number;                 // default 1.75
  headHeightM: number;             // default 0.23, an assumption shown in the UI
  positionM: [number, number, number];
  headingDeg: number;
};

type Move = {
  kind: "static" | "push-in" | "pull-out" | "pan" | "tilt" | "track" | "handheld";
  durationS: number | null;        // null for static
  ease: "linear" | "ease-in-out" | null;
  endPose: CameraPose | null;      // null for static
};

type CameraPose = {
  positionM: [number, number, number];
  headingDeg: number;              // clockwise from above, 0 = scene front
  pitchDeg: number;                // positive looks up
  rollDeg: number;
};

type Shot = {
  id: string;                      // "shot-001"
  number: number;
  sceneId: string;
  name: string;
  job: string;
  action: string;
  sizeLabel: "ECU" | "CU" | "MCU" | "MS" | "MWS" | "WS" | "EWS" | null;
  lens: {
    focalLengthMm: number;
    sensor: Sensor;
    aspect: number;                // width / height, at least 1 in v1
    hfovDeg: number;               // derived, stored for readers of the JSON
    vfovDeg: number;
  };
  pose: CameraPose;
  heightAboveGroundM: number;      // derived from pose and ground offset
  scaleConfirmed: boolean;         // false means heights and distances are in model units
  move: Move;
  standIns: StandIn[];
  frame: { file: string; widthPx: number; heightPx: number };
  referencePhoto: { file: string; role: string } | null;  // name only, never the pixels
  notes: string;
  createdAt: string;
  updatedAt: string;
};
```

**Derived values.** With sensor width `w` (the long side of the frame) and focal length `f`, the horizontal field of view is `2 * atan(w / (2 * f))`. With aspect `a` the sensor height used is `w / a`, and the vertical field of view is `2 * atan((w / a) / (2 * f))`. Reference values for a full frame sensor 36 mm wide:

| Focal length | Horizontal FOV | Vertical FOV at 3:2 | Vertical FOV at 16:9 |
|---|---|---|---|
| 24 mm | 73.74 degrees | 53.13 degrees | 45.75 degrees |
| 35 mm | 54.43 degrees | 37.85 degrees | 32.27 degrees |
| 50 mm | 39.60 degrees | 26.99 degrees | 22.90 degrees |
| 85 mm | 23.91 degrees | 16.07 degrees | 13.59 degrees |

These values were computed with the formula above. The unit test (task 10 of the plan) recomputes them independently of the app code.

**Projects.** A project is the set of scenes and shots in the browser's storage, plus the export folder. A scene file is re-opened from disk each session and matched to its record by SHA-256, so shots re-attach to the right file even if it moved.

## 5. Decisions

1. **Marble is the set source.** Genie 3 and Runway GWM Worlds 2 have no public API. Marble produces a persistent, exportable 3D scene from text, an image or video, and has a documented API. The scene is generated once, exported, and viewed locally. Why: a set for previz must stay the same between visits, and a streamed pixel world drifts.
2. **Splat for looking, collider mesh for picking.** The splat (SPZ, about 2M splats, or the low-res 500k version) is the visible set. The collider mesh (GLB, 100 to 200k triangles) is invisible and used for floor and wall hits when marking scale and placing stand-ins. Why: Spark's documentation does not describe raycasting against splats (unverified), so picking goes through the mesh. The collider mesh is covered by the Standard plan; the high-quality mesh needs Pro and is not needed.
3. **Viewer stack: three.js plus Spark.** Spark is MIT licensed, renders splats inside a normal three.js scene, reads SPZ and PLY, and states WebXR support. Spark's own getting-started example uses three.js 0.180.0; the exact minimum three.js version is not stated on the pages read (unverified). Task 1 pins both versions and records them.
4. **Coordinates.** Marble worlds use OpenCV axes (+x left, +y down, +z forward). On load the splat and the collider mesh are rotated 180 degrees about the x axis, which flips y and z, to reach three.js axes (y up, camera looks down -z). The Marble documentation describes the conversion as scaling y and z by -1. Task 3 confirms by loading a real export and checking the floor is below the walk camera and the scene is not mirrored.
5. **Scale is a required step before heights mean anything.** A splat scene has no reliable real-world scale. Order of preference:
   1. If the world came through the Marble API, `semantics_metadata.metric_scale_factor` converts raw coordinates to meters and `ground_plane_offset` gives the floor height in the scaled frame. Both can be null, and `metric_scale_factor` equal to 1.0 means the scale could not be inferred. How accurate the inferred scale is, is unverified. The user still checks it against a known object.
   2. Otherwise (web app export, or a null value) the user picks two points on the collider mesh, types a known distance (a door height of 2.0 m, a standard desk height of 0.75 m), and the app computes the factor. A 1.75 m reference figure appears beside the marked object as a sanity check.
   3. Until scale is confirmed, `scaleConfirmed` is false on every shot, height presets are disabled, and the export says "heights unverified". Focal length, sensor and field of view stay correct regardless of scale, since they depend on angles only.
6. **Lens math uses three.js PerspectiveCamera directly.** Verified on the three.js documentation: `setFocalLength(f)` sets the vertical FOV from `f` and the current `filmGauge`; `filmGauge` (default 35, in millimeters) is the film size for the larger axis, so for an aspect of 1 or more it is the frame width; `getFilmWidth()`, `getFilmHeight()`, `getFocalLength()` and `getEffectiveFOV()` exist; `updateProjectionMatrix()` must be called after any change. Consequences for the build:
   - Set `filmGauge` to the sensor width in millimeters (36 for full frame). The three.js default of 35 is left behind.
   - Set `camera.aspect` to the recorded frame aspect, then call `setFocalLength`, then `updateProjectionMatrix`.
   - v1 supports aspects of 1 or more only, because `filmGauge` switches to the height for portrait frames.
   - The viewport shows a mask in the shot's aspect; the frame grab renders at exactly that aspect.
7. **Sensor presets.** Full frame 36 x 24 mm. Super 35 at 24.89 x 18.66 mm (the film gate figure; unverified against any camera maker's sheet, confirm in task 10). Custom width and height. The preset list lives in a data file, so adding one is a one-line edit.
8. **Lens set.** 14, 18, 24, 28, 35, 50, 85, 100, 135 mm, plus a free numeric field. The list follows common prime lens sets.
9. **Height presets.** Low 0.3 m, hip 1.0 m, eye 1.6 m, high 2.5 m, plus a free field. These are editable assumptions, labelled so in the UI. Eye height of a standing person varies; the owner can change the default.
10. **Stand-ins are capsules with a height and a facing arrow.** No rigs, no animation. The readout "stand-in height as percent of frame height" and "head height as percent of frame height" helps check framing against film-craft's face-size guidance in its shot list template.
11. **A still before a move.** Phase 2 delivers one lens-accurate frame grab. Moves (phase 5) are saved as a start pose, an end pose, a duration and an ease, and previewed in the viewport. A video clip is not rendered.
12. **Storage is local.** Shots and scene records live in the browser (IndexedDB) and in the export folder. The scene file is re-opened from disk each session. Phase 0 measures file sizes to decide whether caching the scene in IndexedDB is worth it. No backend, no accounts. Why: nothing about the project needs a server, and generated scenes should not leave the machine.
13. **Export is a zip download.** One code path for Chrome and Safari. The File System Access API (Chromium only) is not used. A zip library is needed (JSZip is a candidate; its license is unverified, check in task 18).
14. **Hosting.** Static files. A preview on Vercel is acceptable at $0 on an account the owner already has; the owner confirms which team before the first deploy. Scene files are never hosted. The first deploy of a new Vercel project can land as production, so check its target with `vercel inspect` and confirm the public project URL is not open before sharing a link.
15. **Browsers.** Chrome and Safari on desktop are required for every phase. Quest Browser is required only for the optional WebXR phase.
16. **Process.** Phase 1 is a static HTML draft, reviewed by the owner, before any application code. The `unslop` anti-slop audit runs before building any UI (constraints) and again before calling the UI done (audit and fixes).
17. **Camera line for AI video tools.** The export writes a plain-English line per shot, for example "Medium shot, 35 mm lens on a full frame sensor, camera at 1.6 m, static." Whether a given video tool follows such text is untested and out of scope. The frame is the stronger input.

**Paid steps, flagged.** Each is a gate; none happens without the owner's go.

| Step | Cost | Status |
|---|---|---|
| Exporting a Marble world (SPZ, PLY, collider mesh) | The Free plan can generate worlds but cannot export them. Exporting requires a paid plan; the Standard plan covers splats, panoramas and collider meshes. | Price unverified. Read the live pricing page. |
| Marble API use | Requires a payment method and purchased credits. Larger or outdoor spaces use more credits with `marble-1.1-plus` than with `marble-1.1`. | Exact prices unverified. |
| High-quality textured mesh (GLB), commercial rights | Pro plan. Not needed for v1. | Avoided. |
| Hosting a preview | Vercel account the owner already uses; $0 expected. | Owner confirms team. |
| Quest 3 testing | Needs the headset. | Owner confirms access. |
| Generating video from the exported frames | Paid on most tools. | Out of scope. |

A $0 path exists up to a point: phases 1 and 2 (draft, lens math, frame grab) can run on any freely licensed sample splat, with the license confirmed before use and the file kept out of git. A real Marble export is needed for the phase 0 measurements and the real-input test.

## 6. Acceptance criteria & states

**Done means** (each line is observable):

1. **Load.** A Marble SPZ export opens from a local file in Chrome and Safari and renders. The Scenes view shows file size and time to first render. No console errors.
2. **Axes.** After load the floor is below the walk camera and text or signage in the set is not mirrored.
3. **Scale.** After marking a door as 2.00 m and applying, the measure tool reports 2.00 m (within 0.02 m) between the two marked points. A 1.75 m reference figure beside the door looks plausible. The scale source reads "manual". Reloading the page and re-opening the same file restores the scale.
4. **Lens math, unit.** For every row in the section 4 table, computed horizontal and vertical FOV match the reference within 0.01 degrees. The camera object reports the same focal length from `getFocalLength()` within 0.01 mm.
5. **Lens math, rendered.** In a synthetic test scene, a box 1.00 m wide centered at 10.00 m distance, seen with 50 mm on a 36 mm sensor, fills 13.9 percent of the frame width (50 x 1 / (10 x 36)), measured on the frame grab pixels, tolerance 0.5 points. The same box with 35 mm fills 9.7 percent.
6. **Frame grab.** The grab has exactly the recorded aspect (1920 x 1080 for 16:9; 1920 x 803 for 2.39:1), shows no UI overlays, and shows the stand-ins.
7. **Height.** With scale confirmed, the "eye" preset records `heightAboveGroundM` of 1.60 (within 0.01). With scale unconfirmed, presets are disabled and the saved shot has `scaleConfirmed: false`.
8. **Save and restore.** Save a shot, reload, open it from the Shots view. The viewport shows the same frame as the saved grab, mean absolute pixel difference under 2 of 255 (threshold to confirm in phase 2).
9. **Export.** Exporting N shots produces a folder with N JPEG frames, a `shots.json` that validates against the schema in section 4, and a `shot-list.md` whose header cells match the column mapping in section 3 and which has N rows.
10. **film-craft fit.** The rows of `shot-list.md` paste into a film's shot list file in film-craft and render as a table without edits to the header.
11. **Local only.** After the scene loads, the browser's network panel shows no request that carries scene bytes, and no request to a host other than the app's own origin.
12. **Reference compare.** Loading a reference photo shows it beside the frame and as a 50 percent overlay with a swap key. The photo stays local.
13. **Draft gate.** The phase 1 HTML draft is approved by the owner in writing before application code for Stage or Shots is merged.
14. **Cost gate.** The plan file lists every paid step, and none was taken without a recorded approval.
15. **Real-input test** (section 8) passes or its differences are written down.

**States checklist.** Every primary surface (Scenes, Stage, Shots) covers:

- [ ] default
- [ ] hover and focus (every control reachable and visible by keyboard)
- [ ] empty (no scene yet; scene with no shots; no stand-ins; no reference photo)
- [ ] loading (scene load with bytes read and a cancel; collider mesh load; export in progress)
- [ ] error (unsupported file; SPZ failed to parse with an offer to try PLY; WebGL2 missing; scene too large for memory; scale not confirmed; hash mismatch on re-open)
- [ ] long content (40 shots; a 600 character note; a scene name of 80 characters)
- [ ] small screen (below 900 px wide, the app shows a message that it needs a larger window; it does not render a broken layout)
- [ ] dark mode (interface follows the system theme; the viewport background is a fixed neutral grey in both)

**Explicitly not doing:** world generation in the browser, video output, animated characters, lens distortion, portrait aspects, accounts, server storage, committing media.

## 7. File touch list

Everything below is new unless marked. The reviewer diffs the final change against this list.

| Path | Phase | Purpose |
|---|---|---|
| `README.md` (edit) | 0 | Status line, overview |
| `docs/spec.md` | 0 | This file |
| `docs/implementation-plan.md` | 0 | Phased plan |
| `.gitignore` | 0 | Ignore `scenes/`, `reference/`, `out/`, `*.spz`, `*.ply`, `*.glb`, `*.splat`, `*.ksplat`, `node_modules/`, `dist/` |
| `spike/package.json`, `spike/index.html`, `spike/main.js` | 0 | Throwaway spike viewer; deleted or folded into `src/` in phase 2 |
| `notes/phase-0-results.md` | 0 | Measured load times, sizes, scale, axes, versions, approvals |
| `notes/draft-constraints.md` | 1 | Audience, constraints and `unslop` findings for the draft |
| `draft/index.html`, `draft/stage.html`, `draft/shots.html`, `draft/draft.css` | 1 | Static HTML draft of the three views |
| `package.json`, `tsconfig.json`, `vite.config.ts`, `playwright.config.ts`, `index.html` | 2 | App scaffold |
| `src/main.ts`, `src/router.ts` | 2 | Entry and hash routes |
| `src/viewer/scene.ts` | 2 | three.js scene, Spark renderer, load, axis conversion |
| `src/viewer/walk.ts` | 2 | Walk camera controls |
| `src/camera/lens.ts` | 2 | Focal length, sensor, aspect to FOV; applies to PerspectiveCamera |
| `src/camera/sensors.ts` | 2 | Sensor presets as data |
| `src/camera/frameGrab.ts` | 2 | Offscreen render at exact aspect, JPEG blob |
| `src/scale/scale.ts` | 2 | Scale from Marble metadata or two-point marking |
| `src/ui/stage.ts`, `src/ui/lensPanel.ts`, `src/ui/cameraPanel.ts`, `src/ui/overlay.ts` | 2 | Stage view |
| `spike/` (delete) | 2 | Removed once its findings are in `notes/` |
| `src/model/types.ts`, `src/model/store.ts`, `src/model/schema.ts` | 3 | Types from section 4; IndexedDB store; validator |
| `notes/phase-2-results.md` | 2 | Real-input test numbers and verdict |
| `src/export/shotList.ts`, `src/export/locationSheet.ts`, `src/export/zip.ts` | 3 | Export |
| `src/ui/scenes.ts`, `src/ui/shots.ts` | 3 | Scenes and Shots views |
| `src/viewer/standIns.ts`, `src/ui/standIns.ts`, `src/export/floorPlan.ts` | 4 | Stand-ins, top-down plan |
| `src/camera/move.ts`, `src/ui/moves.ts` | 5 | Start and end poses, preview |
| `src/xr/xr.ts`, `src/xr/place.ts`, `src/ui/xrButton.ts`, `notes/xr-results.md` | Quest phase | WebXR session, shot placement from the headset |
| `tests/lens.test.ts`, `tests/scale.test.ts`, `tests/store.test.ts`, `tests/export.test.ts`, `tests/standIns.test.ts`, `tests/floorPlan.test.ts`, `tests/move.test.ts` | 2 to 5 | Vitest |
| `tests/e2e/*.spec.ts` | 2 to 3 | Playwright in Chromium and WebKit (box, frame grab, save and restore, network) |
| `tests/fixtures/box-scene.ts` | 2 | Synthetic box scene, generated in code |

Not expected to change: anything outside this repo. film-craft is not edited by this project; its templates are only read to shape the export.

## 8. Verification plan

- **Typecheck, lint, unit tests:** `tsc --noEmit`, the linter the scaffold installs, and Vitest for lens math (criterion 4), scale math (criterion 3), shot list mapping and schema validation (criteria 9, 10).
- **Browser checks:** Playwright in Chromium and WebKit for load, save and restore (criteria 1, 8) and the synthetic box measurement (criterion 5). If WebGL does not run in headless WebKit (unverified), the same checks run by hand in Safari and are recorded in `notes/`.
- **Visual gate:** a screenshot pair of each view in Chrome and Safari, light and dark, attached to the PR. The `unslop` audit runs before building the UI and again before calling it done; findings are fixed or listed.
- **Network check:** the criterion 11 check is done by hand once per phase with the browser's network panel, and by a Playwright assertion that lists request hosts.
- **Measure, then claim:** a check that reports zero or clean is trusted only after it has caught a planted fault. For the box measurement, change the focal length to 35 mm and confirm the check reports 9.7 percent where it reported 13.9 before.
- **One real-input test:**
  1. The owner supplies one real reference photo of a room or street scene with a visible door or other object of known size. Record the photo's focal length (EXIF 35 mm equivalent) and roughly how high the camera was held.
  2. Generate a Marble world from that photo (image input). Export SPZ and the collider mesh. This is a paid step.
  3. Load it, mark the door height, confirm scale.
  4. Place the camera at eye height (1.6 m, or the real height if known), full frame sensor, 35 mm. If the photo's equivalent focal length is not 35 mm, run a second shot at the photo's value so the comparison is like for like.
  5. Aim to match the photo, save the shot, and open the reference compare view (side by side and 50 percent overlay).
  6. Record: horizon (or eye line) position as a percent of frame height in both images, and the door's height as a percent of frame height in both.
  7. Pass: horizon positions differ by 5 points or less and door heights by 15 points or less. If the numbers miss, the result is still written down, with a note on whether the synthetic box test (criterion 5) passes. A miss with a passing box test points at how faithfully Marble reconstructs a single photo's perspective, and the camera math is cleared.
  8. Save the side-by-side as a screenshot in a local folder; do not commit it if the photo is not the owner's to publish.

## 9. Verification status of external facts

Read on the primary pages on 2026-10-27 unless stated.

| Fact | Status |
|---|---|
| Marble exports SPZ and PLY splats at about 2M and about 500k splats | Verified, [Marble export specs](https://docs.worldlabs.ai/marble/export/specs) |
| Collider mesh GLB, 100 to 200k triangles; high-quality mesh GLB takes up to an hour, 4 requests per hour per user, owned worlds only | Verified, same page |
| 360 panorama is an equirectangular PNG, 2560 x 1280 | Verified, same page |
| Worlds use OpenCV axes; convert by scaling y and z by -1 | Verified, same page. Behavior on a real export: task 3 |
| Free plan cannot export; Standard covers splats, panoramas, collider meshes; Pro covers high-quality mesh and commercial rights | Verified, [Marble export](https://docs.worldlabs.ai/marble/export) |
| Marble export specs state no real-world units or scale | Verified (they are silent) |
| A World API exists at `api.worldlabs.ai/marble/v1`, async (about 5 minutes), inputs text, image, multi-image, video, key in the `WLT-Api-Key` header, payment method and credits required | Verified, [World API](https://docs.worldlabs.ai/api) |
| API world assets include `semantics_metadata.metric_scale_factor` and `ground_plane_offset` (meters), both nullable, null for worlds made before December 2025 | Verified, [Get a world](https://docs.worldlabs.ai/api/reference/worlds/get.md) |
| How accurate `metric_scale_factor` is | Unverified |
| Marble plan prices and API credit prices | Unverified; not stated on the pages read |
| Whether the web app export (not API) carries scale metadata | Unverified |
| Spark: MIT, three.js renderer, `SparkRenderer` and `SplatMesh`, reads PLY, SPZ, SPLAT, KSPLAT, SOG | Verified, [Spark repo](https://github.com/sparkjsdev/spark) and [Spark overview](https://sparkjs.dev/docs/overview/) |
| Spark minimum three.js version | Unverified; sources disagree (r179 vs r180). Spark's example uses 0.180.0 |
| Spark raycasting against splats | Unverified; not described on the pages read |
| Spark WebXR support | Stated on the Spark overview page; behavior on Quest 3 unverified |
| `PerspectiveCamera.setFocalLength`, `filmGauge` (default 35 mm, larger axis), `getFilmWidth`, `getFilmHeight`, `getFocalLength`, `getEffectiveFOV`, `updateProjectionMatrix` | Verified, [three.js docs](https://threejs.org/docs/pages/PerspectiveCamera.html). Behavior: criteria 4 and 5 |
| Super 35 gate size of 24.89 x 18.66 mm | Unverified |
| Genie 3 and Runway GWM Worlds 2 have no public API | From the owner's world-models notes (researched 2026-10-24); not re-checked |
| JSZip license | Unverified |
