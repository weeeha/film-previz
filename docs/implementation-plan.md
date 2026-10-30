# film-previz Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Walk a generated set in the browser, place a lens-accurate virtual camera, save shots, and export a shot list with frame grabs and camera metadata that fits film-craft. One lens-accurate still frame works before any camera moves.

**Architecture:** A static single-page app. A Marble scene (SPZ splats plus a GLB collider mesh) is exported once, kept on local disk and opened through a file picker. three.js renders it with the Spark splat renderer. A small camera module turns focal length, sensor width and aspect into a `PerspectiveCamera` field of view. A shot record holds the lens, pose, stand-ins and a frame grab. Shots live in IndexedDB and leave the app as a zip folder. No backend.

**Tech stack:** Vite, TypeScript, three.js (version pinned in task 1), `@sparkjsdev/spark` (MIT), Vitest, Playwright (Chromium and WebKit), a zip library chosen in task 18, WebXR for the optional Quest 3 phase.

**Spec:** [docs/spec.md](spec.md)

**Scope note:** Phases 0 to 3 are written step by step. Phases 4, 5 and the Quest 3 phase are outlines with files, deliverables and checks. Expand each into steps after phase 0 results land, since file sizes, load times, scale behavior and splat picking decide parts of them.

## Global Constraints

- **Budget is $0.** No paid tool, plan or credit without the owner's recorded go. Steps that cost money are marked **[COST]** and sit behind a gate (task 2). The known ones: a paid Marble plan to export (the Free plan cannot export), Marble API credits, the Pro plan (not needed), video generation from exported frames (out of scope).
- **Branch per task, PR per change, nothing on `main`.** Name branches `phase-N/<short-task-name>`. The branch for this document is `docs/spec-and-plan`.
- **Media stays out of git.** Splats, meshes, panoramas, reference photos, frame grabs and exported folders live in `scenes/`, `reference/` and `out/`, which `.gitignore` covers (task 1). Check `git status` before every commit.
- **No client material.** Reference photos are the owner's own or freely licensed.
- **Scenes never leave the machine.** No upload, no CDN-hosted scene data, no analytics. Libraries are bundled from npm at build time, with no CDN requests at runtime.
- **Draft before build.** Phase 1 produces static HTML. No application code for Stage or Shots is merged until the owner approves the draft (task 8).
- **Run `unslop` twice for UI work.** Before building any screen (constraints, tasks 6 and 13) and again before calling it done (audit and fixes, tasks 8, 15 and 20).
- **Verify before claiming done.** A green build is not a working page. Each phase ends with the page opened in Chrome and Safari. A check that reports zero or clean is trusted only after it has caught a planted fault; the plan names the plant.
- **Unverified items stay labelled.** Anything the spec lists as unverified is checked in the task named next to it and the result goes in `notes/phase-0-results.md` or the PR.
- **Writing rules for docs and UI copy:** no em dashes, no exclamation marks, no negative parallelism, plain short sentences.
- **Owner approvals** are recorded as a dated line in `notes/phase-0-results.md` (for cost) or in the PR conversation (for design).
- **Preview links.** Each PR ends with a link: local (`http://localhost:5173`) or a Vercel preview. The first deploy of a new Vercel project can land as production; check `vercel inspect <url>` shows target preview, and check the short public project URL returns 302 or 404 without cookies, before sharing a link. The owner confirms the Vercel team first.

## Review Focus

1. **Wrong focal length applied.** `filmGauge` left at the three.js default of 35 instead of the sensor width gives a field of view that is slightly off and passes a casual look. Test: the reference table in `tests/lens.test.ts` (task 10), with a planted fault.
2. **Aspect or portrait frames.** `filmGauge` is the larger axis; a portrait aspect would silently flip the math. The lens module rejects aspects under 1 and says so. Test: `rejects_portrait_aspect` (task 10).
3. **Mirrored or upside-down set.** The OpenCV to three.js conversion is wrong. Check: task 3 (floor below the camera, signage readable).
4. **Scale taken on trust.** Heights shown as meters while scale is unconfirmed. Test: `unconfirmed_scale_disables_height_presets` (task 12).
5. **UI in the frame grab.** Helpers, frustum lines or labels render into the JPEG. Test: `frame_grab_has_no_overlays` (task 11).
6. **Scene bytes leave the page.** A dependency or debug call posts the file. Check: network panel assertion (task 19).
7. **Media committed.** A splat or JPEG lands in git. Check: `.gitignore` plus a pre-commit grep in task 1.

---

## Phase 0: Spike

Goal: prove the set can be generated, exported, loaded and measured. Throwaway code in `spike/`.

### Task 1: Repo hygiene and spike scaffold

**Files:**
- Create: `.gitignore`
- Create: `spike/package.json`, `spike/index.html`, `spike/main.js`
- Create: `notes/phase-0-results.md`

- [ ] **Step 1: Add `.gitignore`.** Include `scenes/`, `reference/`, `out/`, `*.spz`, `*.ply`, `*.glb`, `*.splat`, `*.ksplat`, `*.sog`, `*.jpg`, `*.jpeg`, `*.png` (draft assets are CSS, so no image is needed in git), `node_modules/`, `dist/`, `.DS_Store`.
- [ ] **Step 2: Scaffold the spike.** A Vite page in `spike/` with a three.js scene, a `SparkRenderer` added to the scene, and one file input. Install `three` and `@sparkjsdev/spark`.
- [ ] **Step 3: Pin versions.** Spark's example uses three.js 0.180.0; the minimum is unverified. Install the Spark release current at the time, install three.js 0.180.0, and confirm a test splat renders. If it fails, read the Spark release notes for the three.js version it needs. Write both versions in `notes/phase-0-results.md`.
- [ ] **Step 4: Create `notes/phase-0-results.md`** with headings: Approvals, Set, Load and size, Axes, Scale, Splat picking, Versions, Decision.
- [ ] **Step 5: Commit** on `phase-0/scaffold`.

**Check:** `touch scenes/test.spz scenes/test.glb && git status --short` lists neither file. `cd spike && npm run dev` serves a page with a file input and an empty scene, no console errors, in Chrome and Safari. Planted fault: rename a dummy file to `x.ply` in the repo root and confirm `git status` hides it.

### Task 2: Cost gate and generate one Marble set [COST]

**Files:**
- Edit: `notes/phase-0-results.md` (Approvals, Set)
- Local only: `scenes/set-01.spz`, `scenes/set-01.ply` (optional), `scenes/set-01-collider.glb`, `reference/photo-01.jpg`

- [ ] **Step 1: Ask the owner for the spend decision.** Options, recommended first:
  1. Approve one month of the Marble Standard plan (price unverified; read the live pricing page and write the number down before approving) and generate in the Marble web app.
  2. Spend nothing now. Run tasks 3 and 4 on a freely licensed sample splat (confirm its license, keep it out of git) and do task 2 later. Real Marble numbers and the real-input test wait.
- [ ] **Step 2: Record the decision** as a dated line under Approvals, with the plan, the price read from the pricing page, and the cancel date.
- [ ] **Step 3: Pick the input.** One reference photo from the owner of a room or street with a door or another object of known size. Note its 35 mm equivalent focal length from EXIF and about how high the camera was held. Save to `reference/photo-01.jpg`.
- [ ] **Step 4: Generate** a Marble world from the photo (image input). Note generation time. Do not make more than this one world in phase 0.
- [ ] **Step 5: Export** SPZ (about 2M splats), the low-res SPZ (about 500k), and the collider mesh GLB. The high-quality mesh needs Pro and is skipped. Save to `scenes/`. Record file sizes in bytes.
- [ ] **Step 6: Check whether the export carries any scale information** (a readme, a metadata file, the web app's world page). Write what was found or "none found".

**Check:** `ls -l scenes/` shows the files and sizes; `git status` shows none of them; the Approvals section has a dated line with a price. If option 2 was chosen, the section says "no spend" and the later tasks name the sample file used.

### Task 3: View in the browser, check axes, measure load

**Files:**
- Edit: `spike/main.js`
- Edit: `notes/phase-0-results.md` (Load and size, Axes)

- [ ] **Step 1: Load from file input.** Create an object URL from the picked file, pass it to a `SplatMesh` through its `url` parameter, add it to the scene.
- [ ] **Step 2: Apply the axis conversion.** Rotate the splat 180 degrees about x (flipping y and z, per the Marble documentation's OpenCV note). Add a walk camera (orbit controls are enough for the spike).
- [ ] **Step 3: Check axes by eye and by number.** The floor is below the camera; any text or signage reads correctly. If the scene is mirrored or inverted, fix the rotation and write the fix down.
- [ ] **Step 4: Time it.** With `performance.now()`, log: file read, time to first rendered frame, and frames per second after 10 seconds of slow orbiting (average over 5 seconds). Do it for the 2M SPZ and the 500k SPZ, three runs each, in Chrome and in Safari, on this Mac. Write the machine model.
- [ ] **Step 5: Try the PLY** if one was exported, or note that Spark loads the SPZ without trouble.
- [ ] **Step 6: Note visible problems** in the splat from the walk camera: holes, floaters, smeared areas, what happens behind objects. These feed the location sheet's "known generation failures".
- [ ] **Step 7: Screenshot** one view per browser into `reference/` (git-ignored).

**Check:** the Load and size table in the notes has 2 files x 2 browsers x 3 runs of numbers. Axes section says "floor below, text readable" with the screenshot file name. Proposed thresholds, for the owner to confirm: first frame under 15 seconds, 30 fps or more at 2M splats; if missed, use the 500k file.

### Task 4: Scale, and the picking question

**Files:**
- Edit: `spike/main.js`
- Edit: `notes/phase-0-results.md` (Scale, Splat picking)

- [ ] **Step 1: Load the collider mesh** as an invisible mesh with the same axis rotation.
- [ ] **Step 2: Add two-point marking.** A raycaster against the collider mesh; click a point on the floor at a door's base, click at the door's top edge, read the raw distance.
- [ ] **Step 3: Apply scale.** Enter 2.00 m, compute `factor = known / measured`, scale the splat and the collider by it. Mark a second distance (door width, or a chair seat height of about 0.45 m) and read the result.
- [ ] **Step 4: Test the Marble metadata route** only if the owner approved API credits. If not, write "API route not tested (cost gate)". If tested, request the world through the API, read `semantics_metadata.metric_scale_factor` and `ground_plane_offset`, apply them, then measure the door. Report the error in meters. **[COST]**
- [ ] **Step 5: Test splat picking.** Try to raycast against the `SplatMesh` itself. Write whether Spark's version supports it and how close the hit lands to the visible surface. If it works well, the collider mesh becomes optional for picking; if not, the decision in the spec stands.
- [ ] **Step 6: Check the collider mesh fits the splat.** Toggle its visibility with a wireframe material and look for offsets. Write the worst mismatch seen, in meters after scale.

**Check:** after scaling by the door, the second known distance reads within 0.15 m of the real-world value (a loose bound for a generated scene; the owner may tighten it). The notes record the raw measurement, the factor, the second check, and the picking result. A planted fault: type 3.00 for the door instead of 2.00 and confirm the second distance goes visibly wrong.

### Task 5: Phase 0 readout and decision

**Files:**
- Edit: `notes/phase-0-results.md` (Decision)
- Edit: `docs/spec.md` (only where a measured fact replaces an unverified one)

- [ ] **Step 1: Fill the Decision section.** For each unverified item named in the spec (three.js minimum version, Spark picking, scale accuracy, web export scale metadata), write the result or "still unverified".
- [ ] **Step 2: Decide whether to cache the scene in IndexedDB** from the file sizes (spec decision 12).
- [ ] **Step 3: Update the spec** to replace measured facts; keep every other line unchanged.
- [ ] **Step 4: Open the PR** with the results and ask the owner for go or no-go on phase 1, with the numbered options, recommended first.

**Check:** the owner has read the notes and replied go, no-go, or a change. The unverified table in spec section 9 has no stale rows for items that were measured.

---

## Phase 1: HTML draft of the flow

Goal: something to look at before any real code. Static pages, fake data, no build step.

### Task 6: Constraints and the first `unslop` pass

**Files:**
- Create: `notes/draft-constraints.md`

- [ ] **Step 1: Write the constraints.** Who uses it (a filmmaker planning shots, at a desk, mouse and keyboard); the three views; what the first screen must show (the scene file, scale state, next action); density (a tool, not a landing page); the fixed data (focal length list, sensor list, height presets).
- [ ] **Step 2: Run `unslop` in constraints mode.** Paste its constraints into the file: what to avoid for this tool (generic hero, decorative gradients, icon-card grids, filler copy), and what to choose instead (a viewport-first layout, a readable numeric inspector, plain labels).
- [ ] **Step 3: Name the flow** in 6 steps: open scene, set scale, place camera, pick lens, save shot, export.

**Check:** the file exists and the owner can read it in under two minutes. It names no client and no invented background.

### Task 7: Build the static draft

**Files:**
- Create: `draft/index.html` (Scenes), `draft/stage.html` (Stage), `draft/shots.html` (Shots), `draft/draft.css`

- [ ] **Step 1: Scenes page.** File picker area, a table of past scenes, the scale step as a form (known object, length in meters, apply), and a scale-state badge. Use a `?state=` query to show default, empty, loading, error.
- [ ] **Step 2: Stage page.** A viewport drawn with CSS only (a grey perspective floor and walls; no image file), the frame mask in 16:9 and 2.39:1 with a toggle, a lens panel (focal length buttons 14 to 135 plus a field, sensor select, aspect select, a readout "35 mm on 36 mm: 54.43 degrees horizontal, 32.27 vertical"), a camera panel (height presets, heading, pitch), a stand-ins list, a reference overlay switch, a shot strip, and the save button. Show the "scale not confirmed" state with disabled height presets via `?state=noscale`.
- [ ] **Step 3: Shots page.** A table with frame thumbnails (CSS boxes), lens, height, size label, job, action; an export button; an export-folder preview listing the files from the spec.
- [ ] **Step 4: Link the pages** so the 6-step flow can be clicked through with plain anchors and the `?state=` switch.
- [ ] **Step 5: Light and dark theme** with CSS custom properties and `prefers-color-scheme`.
- [ ] **Step 6: Open in Chrome and Safari** at 1440 px and at 880 px (the small-screen message).

**Check:** from `draft/index.html` the owner clicks all 6 steps without a dead link. The states checklist in spec section 6 is shown for Scenes (empty, loading, error) and Stage (no scale). Screenshots in both browsers and both themes are attached to the PR.

### Task 8: `unslop` audit and owner review gate

**Files:**
- Edit: `draft/*` (fixes only)
- Edit: `notes/draft-constraints.md` (findings)

- [ ] **Step 1: Run `unslop` in audit mode** on the draft. Fix what it flags or list what is left.
- [ ] **Step 2: Send the owner the preview link** (local or Vercel preview, per the global constraint) and the numbered questions that change the work: viewport placement, whether the Shots table needs a card view, which lens list to keep. Recommended option first on each.
- [ ] **Step 3: Record approval** in the PR with the date, and any changes requested. Apply them.

**Check:** the PR shows the owner's written go. Without it, phase 2 does not start. Spec criterion 13 is satisfied.

---

## Phase 2: Lens-accurate camera and frame grab

Goal: one still frame whose framing follows the lens math, checked by number and against a real photo. No moves.

### Task 9: App scaffold and viewer port

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`
- Create: `src/main.ts`, `src/router.ts`, `src/viewer/scene.ts`, `src/viewer/walk.ts`
- Create: `playwright.config.ts`
- Delete: `spike/` (after its findings are in the notes)

- [ ] **Step 1: Scaffold Vite with TypeScript**, add Vitest and Playwright (Chromium and WebKit), `npm run test`, `npm run test:e2e`, `npm run typecheck`.
- [ ] **Step 2: Port the spike viewer** into `src/viewer/scene.ts` (load, axis conversion, collider) and `walk.ts` (walk camera with mouse look and WASD at a settable height).
- [ ] **Step 3: Add hash routing** for `#/`, `#/stage`, `#/shots`, each a placeholder.
- [ ] **Step 4: Write one e2e test** that opens the app and expects the three routes to render a heading.

**Check:** `npm run typecheck && npm test && npm run test:e2e` pass. `npm run dev` opens the app; picking the phase 0 scene renders it as the spike did. Planted fault: break the route name in the e2e test and confirm it fails.

### Task 10: Lens module (tests first)

**Files:**
- Create: `src/camera/sensors.ts`, `src/camera/lens.ts`
- Test: `tests/lens.test.ts`

**Interfaces:**
- Produces:
  - `SENSORS: Sensor[]` (full frame 36 x 24; Super 35 24.89 x 18.66, unverified, confirm against a camera maker's sheet in this task; custom)
  - `fovDeg(focalMm: number, sensorSideMm: number): number` returns `2 * atan(side / (2 * f))` in degrees
  - `lensFov(focalMm, sensor, aspect): { hfovDeg: number; vfovDeg: number }`
  - `applyLens(camera: PerspectiveCamera, focalMm: number, sensor: Sensor, aspect: number): void` sets `camera.aspect`, `camera.filmGauge = sensor.widthMm`, calls `camera.setFocalLength(focalMm)`, then `camera.updateProjectionMatrix()`; throws for `aspect` under 1

- [ ] **Step 1: Write the failing tests.**

```ts
// tests/lens.test.ts
import { describe, it, expect } from "vitest";
import { PerspectiveCamera } from "three";
import { lensFov, applyLens } from "../src/camera/lens";
import { SENSORS } from "../src/camera/sensors";

const FF = SENSORS.find(s => s.id === "full-frame");

// Reference values computed independently: 2 * atan(side / (2 * f)).
const cases = [
  { f: 24, a: 3 / 2, h: 73.74, v: 53.13 },
  { f: 35, a: 3 / 2, h: 54.43, v: 37.85 },
  { f: 50, a: 3 / 2, h: 39.60, v: 26.99 },
  { f: 85, a: 3 / 2, h: 23.91, v: 16.07 },
  { f: 24, a: 16 / 9, h: 73.74, v: 45.75 },
  { f: 35, a: 16 / 9, h: 54.43, v: 32.27 },
  { f: 50, a: 16 / 9, h: 39.60, v: 22.90 },
  { f: 85, a: 16 / 9, h: 23.91, v: 13.59 },
];

describe("lensFov", () => {
  for (const c of cases) {
    it(`${c.f} mm at ${c.a.toFixed(2)}`, () => {
      const r = lensFov(c.f, FF, c.a);
      expect(r.hfovDeg).toBeCloseTo(c.h, 2);
      expect(r.vfovDeg).toBeCloseTo(c.v, 2);
    });
  }
});

describe("applyLens", () => {
  it("sets the camera vertical fov and reads back the focal length", () => {
    const cam = new PerspectiveCamera();
    applyLens(cam, 35, FF, 16 / 9);
    expect(cam.fov).toBeCloseTo(32.27, 2);
    expect(cam.getFocalLength()).toBeCloseTo(35, 2);
    expect(cam.filmGauge).toBe(36);
  });
  it("rejects_portrait_aspect", () => {
    expect(() => applyLens(new PerspectiveCamera(), 35, FF, 0.8)).toThrow();
  });
  it("a Super 35 sensor gives a narrower field than full frame at the same focal length", () => {
    const s35 = SENSORS.find(s => s.id === "super-35");
    expect(lensFov(35, s35, 16 / 9).hfovDeg).toBeLessThan(lensFov(35, FF, 16 / 9).hfovDeg);
  });
});
```

- [ ] **Step 2: Run, see them fail** (`npm test`; module not found).
- [ ] **Step 3: Implement** `sensors.ts` and `lens.ts` as specified.
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: Plant a fault.** Temporarily set `camera.filmGauge = 35` in `applyLens`; confirm the 35 mm / 16:9 test fails on the vertical field of view (31.42 degrees instead of 32.27, a shift of about 2.6 percent). Revert.
- [ ] **Step 6: Confirm Super 35 dimensions** against two camera makers' published sensor sheets and write the source in the PR. If they disagree, keep the film gate figure and list the alternatives as custom presets.
- [ ] **Step 7: Commit** on `phase-2/lens`.

**Check:** `npm test` passes all lens cases; the planted fault fails exactly the filmGauge-sensitive assertions.

### Task 11: Synthetic box scene and the frame grab

**Files:**
- Create: `tests/fixtures/box-scene.ts`, `src/camera/frameGrab.ts`
- Test: `tests/e2e/box.spec.ts`, `tests/e2e/frame-grab.spec.ts`

**Interfaces:**
- Produces: `grabFrame(renderer, scene, camera, widthPx: number, aspect: number): Promise<{ blob: Blob; widthPx: number; heightPx: number }>` renders to an offscreen target at exact aspect with helpers and overlay layers hidden, and returns a JPEG.

- [ ] **Step 1: Build the fixture.** A flat-colored scene: black background, a 1.00 m wide, 1.00 m tall white box centered on the camera axis at 10.00 m distance. Built in code, no files.
- [ ] **Step 2: Write the failing e2e test.** For 50 mm on full frame at 16:9, grab a 1920 px frame, scan one row through the box center for white pixels, expect the white run to be 13.9 percent of 1920 px (267 px) within 0.5 points. For 35 mm expect 9.7 percent.
- [ ] **Step 3: Implement `grabFrame`.** Render with `camera.aspect` set to the target aspect, hide helper layers (frustum lines, grid, labels), return `toBlob("image/jpeg", 0.92)`.
- [ ] **Step 4: Write `frame_grab_has_no_overlays`.** Put a bright magenta helper in the scene on the helper layer; expect the grab to contain no magenta pixel.
- [ ] **Step 5: Aspect test.** 16:9 grab is 1920 x 1080; 2.39:1 is 1920 x 803.
- [ ] **Step 6: Run in Chromium and WebKit.** If WebGL does not run in headless WebKit, record that (unverified in the spec), run the same page by hand in Safari with a button that prints the measured percent, and write the numbers in the PR.
- [ ] **Step 7: Plant a fault.** Change the focal length in the 35 mm case to 50 and confirm the test reports 13.9 where it reported 9.7 before.
- [ ] **Step 8: Commit** on `phase-2/frame-grab`.

**Check:** both box cases pass within tolerance; the overlay test fails when the helper layer is left visible during grab (plant it, then revert).

### Task 12: Scale module

**Files:**
- Create: `src/scale/scale.ts`
- Test: `tests/scale.test.ts`

**Interfaces:**
- Produces:
  - `scaleFromReference(measuredRaw: number, knownM: number): number`
  - `applyScale(scene, factor: number, groundOffsetM: number): void` scales the splat and collider and shifts them so the floor is y = 0
  - `fromMarbleMetadata(meta: { metric_scale_factor: number | null; ground_plane_offset: number | null }): { factor: number; groundOffsetM: number; source: "marble" | "none" }` returns source `none` when the factor is null or exactly 1.0

- [ ] **Step 1: Write failing tests.**
  - `scaleFromReference(0.8, 2.0)` returns 2.5.
  - `scaleFromReference(0, 2.0)` throws.
  - `fromMarbleMetadata({ metric_scale_factor: null, ground_plane_offset: null })` has source `none`.
  - `fromMarbleMetadata({ metric_scale_factor: 1.0, ground_plane_offset: 0 })` has source `none` (the schema says 1.0 means scale was not inferred).
  - `fromMarbleMetadata({ metric_scale_factor: 2.4, ground_plane_offset: -0.1 })` has source `marble`.
  - `unconfirmed_scale_disables_height_presets`: the height presets helper returns disabled when the scene scale source is `none` and not confirmed.
- [ ] **Step 2: Run, see them fail. Implement. Run, see them pass.**
- [ ] **Step 3: Wire the UI.** Two-point marking from the spike, an input for the known length with the label, an Apply button, the scale-state badge, and a 1.75 m reference figure beside the marked object.
- [ ] **Step 4: Persist the scale** by scene SHA-256 in `localStorage` for now; task 16 moves it to IndexedDB.
- [ ] **Step 5: Commit** on `phase-2/scale`.

**Check:** unit tests pass. By hand in Chrome and Safari: mark a door, enter 2.00, apply; the measure tool between the same two points reads 2.00 (within 0.02); reload, re-open the file, the scale is restored and the badge says "manual". Planted fault: enter 3.00 and confirm the reference figure looks wrong beside the door (a giant door frame).

### Task 13: Stage view and the first lens-accurate still

**Files:**
- Create: `src/ui/stage.ts`, `src/ui/lensPanel.ts`, `src/ui/cameraPanel.ts`
- Edit: `src/viewer/scene.ts` (shot camera and frustum helper)

- [ ] **Step 1: Run `unslop` in constraints mode** for the Stage view against the approved draft. Note findings in `notes/draft-constraints.md`.
- [ ] **Step 2: Build the Stage view from the approved draft.** The shot camera is a second `PerspectiveCamera`; the walk camera draws it as a frustum with its number. A "look through" toggle swaps the viewport to the shot camera with the frame mask.
- [ ] **Step 3: Lens panel.** Focal length buttons and field, sensor select, aspect select (16:9, 1.85:1, 2.39:1, 3:2, 4:3, 1:1), readout of horizontal and vertical field of view from `lensFov`, wired through `applyLens`.
- [ ] **Step 4: Camera panel.** Height presets (low 0.3, hip 1.0, eye 1.6, high 2.5; disabled until scale is confirmed), a free height field, heading, pitch, roll, position fields, a "move camera here" button using the walk camera's pose, and a nudge key set.
- [ ] **Step 5: Save frame.** A button that calls `grabFrame` and downloads one JPEG. Saving a full shot record is phase 3.
- [ ] **Step 6: Commit** on `phase-2/stage`.

**Check:** with the phase 0 scene loaded and scale confirmed, set 35 mm, full frame, 16:9, height eye, look through; the readout shows 54.43 and 32.27; the downloaded JPEG is 1920 x 1080. Switch to 85 mm and the framing narrows by the expected factor (the same object's width in the frame grows by 85/35, about 2.4 times; measure on the two JPEGs).

### Task 14: Reference compare and the real-input test

**Files:**
- Create: `src/ui/overlay.ts`
- Edit: `src/ui/stage.ts`

- [ ] **Step 1: Reference photo loader.** A file input that shows the photo in memory only (an object URL, no storage), with a name field and a role label.
- [ ] **Step 2: Compare modes.** Side by side (photo left, live frame right, same aspect, photo cropped to fit) and a 50 percent overlay; a key swaps between the photo and the frame at full opacity.
- [ ] **Step 3: Draw guides.** A horizon line and a vertical ruler in percent of frame height, on both images, so the horizon and door heights can be read as numbers.
- [ ] **Step 4: Run the real-input test** from spec section 8 with the phase 0 photo and scene. Record the horizon positions and the door heights as percents, for both images, and the verdict.
- [ ] **Step 5: Record the result** in `notes/phase-2-results.md` and the PR, with the side-by-side screenshot kept local unless the photo is the owner's to publish.

**Check:** the compare view shows the photo and the frame at the same aspect; the notes hold four numbers and a verdict. If the numbers miss, the notes also hold the box test result from task 11.

### Task 15: Phase 2 audit and cross-browser pass

**Files:**
- Edit: `src/ui/*` (fixes only)

- [ ] **Step 1: Run `unslop` in audit mode** on the Stage view. Fix or list.
- [ ] **Step 2: Walk the states checklist** for Stage: default, hover and focus, empty (no scene), loading, error (unsupported file, WebGL2 missing), long content, small screen, dark mode. Screenshot each in Chrome and Safari.
- [ ] **Step 3: Check criteria 1 to 8 and 12** from spec section 6 with evidence next to each in the PR.
- [ ] **Step 4: Open the PR** with a preview link. Ask the owner whether phase 3 starts, with the numbered options, recommended first.

**Check:** each criterion has a line in the PR: pass, fail, or not yet applicable (criteria 9 to 11 belong to phase 3). The owner replies go or changes.

---

## Phase 3: Shot list and export

Goal: save shots, list them, export a folder that fits film-craft.

### Task 16: Data model and store

**Files:**
- Create: `src/model/types.ts`, `src/model/store.ts`, `src/model/schema.ts`
- Test: `tests/store.test.ts`

- [ ] **Step 1: Write types** from spec section 4.
- [ ] **Step 2: Write the failing tests.** Save a scene and a shot, read them back equal; a shot referencing a missing scene is rejected; `schema.validateShot` accepts a good record and rejects one with `aspect` under 1; re-opening a file with a different SHA-256 raises a "hash mismatch" state instead of attaching the shots.
- [ ] **Step 3: Implement** the IndexedDB store (a small wrapper, no framework), the validator (a hand-written check or a small schema library; license checked), and migrate the scale from `localStorage`.
- [ ] **Step 4: Run tests.** Commit on `phase-3/model`.

**Check:** `npm test` passes; in Chrome and Safari the scale from task 12 survives a reload through IndexedDB. Planted fault: change one byte of a test file's hash and see the mismatch state.

### Task 17: Save, restore and the Shots view

**Files:**
- Create: `src/ui/shots.ts`
- Edit: `src/ui/stage.ts`
- Test: `tests/e2e/save-restore.spec.ts`

- [ ] **Step 1: Save shot.** Collect lens, pose, height, move (static), stand-ins (empty until phase 4), frame grab, notes, `scaleConfirmed`. Store the JPEG blob with the shot.
- [ ] **Step 2: Shots view.** Thumbnail, number, name, lens, height, size label, job, action, notes; edit in place; reorder; duplicate; delete with an undo.
- [ ] **Step 3: Open shot.** Restores the shot camera and lens in the Stage view.
- [ ] **Step 4: Write the e2e test.** Save a shot, reload, open it, grab again, compute the mean absolute pixel difference against the saved JPEG; expect under 2 of 255.
- [ ] **Step 5: Plant a fault.** Change the saved heading by 5 degrees in storage and confirm the difference exceeds the threshold.
- [ ] **Step 6: Commit** on `phase-3/shots`.

**Check:** the e2e test passes in Chromium (and WebKit if WebGL runs there). By hand: 5 shots saved, reloaded, each opens to the same frame. Confirm the pixel difference threshold against the real scene, since splat sorting may add noise; adjust and record the final value in the spec.

### Task 18: Export folder

**Files:**
- Create: `src/export/shotList.ts`, `src/export/locationSheet.ts`, `src/export/zip.ts`
- Test: `tests/export.test.ts`

- [ ] **Step 1: Choose a zip library.** Compare two candidates on license (MIT or similar), size, and Safari support; write the choice and license in the PR. This resolves the spec's unverified JSZip license.
- [ ] **Step 2: Write the failing tests.**
  - `shot_list_header_matches_film_craft`: the header cells of the generated table equal the 12 columns in the spec's mapping table, in order, read from film-craft's shot list template at test time from a path given by an environment variable (the test is skipped, with a message, when the variable is unset).
  - `row_count_equals_shot_count`.
  - `camera_sentence`: 35 mm, full frame, 1.6 m, heading 40, static yields a sentence containing "35 mm", "36 mm", "1.6 m", "static".
  - `unconfirmed_scale_marks_heights`: a shot with `scaleConfirmed: false` renders "height unverified" in place of meters.
  - `location_sheet_fields`: the sheet contains scene name, source kind, file names, and no scene bytes.
- [ ] **Step 3: Implement** `shotList.ts` (the 12 columns, the mapping from the spec), `locationSheet.ts`, `zip.ts` (folder layout from the spec; `scene-ref.json` carries name, SHA-256 and scale source only).
- [ ] **Step 4: Export button** on the Shots view: downloads `<scene-name>-previz.zip`.
- [ ] **Step 5: Check the fit by hand.** Unzip to `out/`. Copy `shot-list.md` into a scratch file inside a throwaway copy of a film-craft film folder (do not edit film-craft itself) and render it. Confirm the table renders and the header is unchanged.
- [ ] **Step 6: Plant a fault.** Swap two header cells in the generator and confirm `shot_list_header_matches_film_craft` fails.
- [ ] **Step 7: Commit** on `phase-3/export`.

**Check:** exporting 3 shots yields 3 JPEGs, a `shots.json` that passes `validateShot`, a `shot-list.md` with 3 rows, a `location-sheet.md`, and a `scene-ref.json`; none contains scene data (grep the zip for the file's first bytes).

### Task 19: Scenes view, markers, local-only check

**Files:**
- Create: `src/ui/scenes.ts`
- Edit: `src/ui/stage.ts` (markers)
- Test: `tests/e2e/network.spec.ts`

- [ ] **Step 1: Scenes view** from the draft: open file, optional collider file, source kind and note, light note, front direction, past scenes list.
- [ ] **Step 2: Markers.** Click a point to add a named marker (door, window, bed); markers reuse the scale reference mark. The camera sentence in the export names the nearest marker.
- [ ] **Step 3: Network test.** In Playwright, record all requests after the scene loads. Expect every request host to equal the app's own origin, and no request body larger than 10 KB.
- [ ] **Step 4: Plant a fault.** Add a test-only fetch that posts the first 1 KB of the scene to the same origin and confirm the body-size check or a request listing catches it (then remove it).
- [ ] **Step 5: Commit** on `phase-3/scenes`.

**Check:** the network test passes; by hand, the browser's network panel after loading a 50 MB class file shows no upload.

### Task 20: Phase 3 audit and wrap

**Files:**
- Edit: `src/ui/*` (fixes only)
- Edit: `README.md` (status line stays "exploration" until the owner changes it; add a usage section)

- [ ] **Step 1: Run `unslop` in audit mode** on Scenes and Shots. Fix or list.
- [ ] **Step 2: Walk the states checklist** for all three views in both browsers and themes.
- [ ] **Step 3: Check all 15 criteria** in spec section 6 with evidence in the PR.
- [ ] **Step 4: Preview link.** Deploy a Vercel preview with no scene files, apply the Vercel checks from the global constraints, and put the link at the top of the PR.
- [ ] **Step 5: Ask the owner** whether to continue with phases 4 and 5, with numbered options, recommended first.

**Check:** each criterion has evidence; the preview link opens the app in Chrome and Safari; `git ls-files` lists no media.

---

## Phase 4: Stand-ins and blocking (outline)

Expand into steps after phase 3. Depends on how well the collider mesh holds a figure on the floor (phase 0 task 4).

### Task 21: Stand-in figures

**Files:** `src/viewer/standIns.ts`, `src/ui/standIns.ts`, `tests/standIns.test.ts`, edit `src/model/types.ts` if the record changes.

- Deliverable: add, name, move (floor drag on the collider mesh), face, and resize capsule figures; record them in each shot; readouts for figure height and head height as percent of frame height.
- Check: a 1.75 m figure at 5 m with 50 mm on full frame at 16:9 reads a height of 1.75 x 50 / (5 x 20.25) = 86 percent of frame height (unit test); the same figure appears in the frame grab and in the saved shot after reload.

### Task 22: Floor plan export

**Files:** `src/export/floorPlan.ts`, `tests/floorPlan.test.ts`.

- Deliverable: a top-down PNG with the collider mesh footprint, numbered camera positions with heading arrows, stand-in positions, and an optional action axis line; included in the zip as `floor-plan.png` and referenced from the location sheet.
- Check: camera numbers on the plan equal the shot numbers in `shot-list.md`; the 180 degree line check from film-craft can be done on the plan by hand, and the owner confirms the drawing is usable for it.

---

## Phase 5: Camera moves (outline)

Starts only when phases 2 and 3 pass. The risk here is path quality, so the first move is the simplest.

### Task 23: Start and end poses with preview

**Files:** `src/camera/move.ts`, `src/ui/moves.ts`, `tests/move.test.ts`.

- Deliverable: a shot gets a move kind (push-in first, then pan and track), a duration and an ease; the move is two poses (start is the shot pose, end is set by the user); a preview plays in the viewport at real time; interpolation keeps height and lens fixed unless the move says otherwise.
- Check: unit tests for interpolation (position, heading wrap-around at 360, ease endpoints equal start and end); the push-in preview of 4 seconds moves the camera by the recorded distance, measured in the viewport; no lens change during a move.

### Task 24: Move metadata and end frame

**Files:** `src/export/shotList.ts`, `src/camera/frameGrab.ts`, `tests/export.test.ts`.

- Deliverable: the export includes an end frame grab for a move, the camera sentence names the move, speed (meters per second) and ease, and `shots.json` has the end pose.
- Check: a push-in shot exports two frames and a sentence such as "push-in 1.2 m over 4 s, ease in and out"; speed in the sentence equals distance divided by duration.
- Open question for the owner after this task: whether any video tool the owner uses accepts the end frame or the camera sentence. Untested.

---

## Optional phase: Quest 3 walk at real scale (outline)

Needs the headset and a confirmed scale. Expand after phase 0 shows how heavy the 500k and 2M splat files are. Hardware access is the owner's to confirm.

### Task 25: WebXR session

**Files:** `src/xr/xr.ts`, `src/ui/xrButton.ts`, `notes/xr-results.md`.

- Deliverable: an "Enter VR" button that starts a WebXR VR session with Spark's WebXR support (stated on its overview page; behavior on Quest 3 unverified), the set at metric scale with the floor at the headset's floor level, and teleport or thumbstick locomotion.
- Check: in the Quest Browser, the scene loads (the app served over HTTPS or through a local tunnel, method recorded), the door marked at 2.0 m looks 2.0 m tall, and the frame rate is recorded for the 500k and 2M files. If the 2M file is too slow, the 500k file is the default in VR.

### Task 26: Place a shot from the headset

**Files:** `src/xr/place.ts`, `tests/xr/place.test.ts`.

- Deliverable: a controller trigger drops the shot camera at the headset's position and heading, using the headset height above the floor as `heightAboveGroundM`; the shot appears in the Shots view after leaving VR.
- Check: a shot placed standing at the door has a recorded height within 0.05 m of the user's real eye height, measured with a tape; the frame grab in the Stage view matches what the user saw.

---

## Done for the plan

The plan is done when phases 0 to 3 pass their checks and the owner has decided on phases 4, 5 and the Quest 3 phase. The README status line changes from "exploration" only on the owner's word.
