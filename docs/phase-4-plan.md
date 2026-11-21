# film-previz Phase 4 Implementation Plan: stand-ins and floor plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Place capsule stand-ins on the set floor, read how large they are in the frame, save them with each shot, and export a top-down floor plan with numbered cameras.

**Architecture:** Stand-ins are a working set on the Stage, the same way the lens and pose are: saving a shot copies the set into the shot record, opening a shot replaces the set. Pure maths (frame readout, mesh slicing, plan layout) lives apart from three.js meshes and from DOM panels, so it is unit tested without a browser. The floor plan is a section cut of the collider mesh drawn on a 2D canvas and added to the export zip as a PNG.

**Tech stack:** unchanged. three 0.180.0 exact, `@sparkjsdev/spark` 2.4.0, Vitest, `@playwright/test` 1.64.1 exact (cached browsers), fflate. No new dependency.

**Spec:** [docs/spec.md](spec.md). This plan expands tasks 21 and 22 of [docs/implementation-plan.md](implementation-plan.md), whose Global Constraints apply to every task here.

**Task numbering:** tasks here are P4-1 to P4-6. P4-1 to P4-3 are old task 21, P4-4 and P4-5 are old task 22, P4-6 is the phase audit.

## Global Constraints

- Everything in the Global Constraints of `docs/implementation-plan.md` (budget $0, media out of git, scenes never leave the machine, draft before build, `unslop` twice, verify with a planted fault, writing rules).
- Work only in the worktree on branch `build/film-previz`. Commit locally. Never push, never touch `main`.
- Stand-ins are static capsules with a height and a facing arrow. No rigs, no animation (spec decision 10).
- Stand-in heights and positions are metres. Adding a stand-in needs a confirmed scale, the same rule as the height presets (spec decision 5.3).
- Defaults from the spec: `heightM` 1.75, `headHeightM` 0.23, shown in the UI as an assumption.
- The frame grab shows the stand-ins and no interface (criterion 6). Capsule and floor arrow are in the grab. Name label and selection ring are on `HELPER_LAYER` and are not.
- The approved draft fixes the Stand-ins panel copy: "Stand-ins", "2 on this scene", "None yet", "75.6% of frame height", "1.75 m tall, 4.0 m away", "Head 9.9%", "Head height of 0.23 m is an assumption. Use these readouts to check face size against the shot size.", "No stand-ins on this scene. Add one to check how large a person is in the frame.", "Add stand-in".
- UI that the approved draft does not show (editing a stand-in, the action axis control, the look of the floor plan) is drafted and approved in P4-1 before any of it is coded.

## Decisions this plan makes (for the owner to confirm at the P4-1 gate)

1. **Stand-ins carry over from shot to shot.** A new shot starts with the stand-ins that are on the Stage, so one blocking serves several camera positions. Each saved shot keeps its own copy.
2. **The facing arrow is in the frame grab**, as a flat triangle on the floor at the feet. The name label is not.
3. **The floor plan is a section cut**, like an architect's plan: the collider mesh cut at 1.0 m above the floor (walls, solid line) and at 0.3 m (low furniture, light line). A render from above would only show the ceiling.
4. **Heading 0 (scene front) points up on the plan.** x runs to the right.
5. **No confirmed scale, no floor plan.** The export leaves `floor-plan.png` out and says why. No collider: the plan is drawn without walls and says so.
6. **The action axis is stored on the scene** as a line between two points, set from two stand-ins on the Stage. This adds one optional field to `Scene` in spec section 4: `actionAxis?: { label: string; aM: [number, number]; bM: [number, number] } | null` (x and z in metres). Scene records saved before stay valid.
7. **Stand-ins on the plan:** each distinct label and position is drawn once, with the shot numbers that use it.

## Review Focus

1. **Interface in the frame grab.** A selected stand-in's ring or label lands in the JPEG. Test: `grab_is_the_same_with_and_without_selection` (P4-3).
2. **Stand-ins leak between shots.** Opening a shot with no stand-ins after one with two leaves two on the set. Test: `opening_a_shot_replaces_the_working_set` (P4-3).
3. **A confident percent for a figure the camera cannot see whole.** Behind the camera, or cut by the frame edge. Test: `readout_states` (P4-2).
4. **Mirrored floor plan.** x or z flipped passes a casual look and breaks the 180 degree check. Test: `plan_is_not_mirrored` with a planted flip (P4-4).
5. **Export without a collider or without a scale.** The zip still downloads and says what is missing. Test: `export_without_collider`, `export_without_scale` (P4-5).
6. **Update shot drops the stand-ins.** `buildShot` used to copy them from the previous record. Test: `update_keeps_the_stage_stand_ins` (P4-2).
7. **Old scene records.** A scene saved before `actionAxis` existed fails validation and its shots vanish. Test: `scene_without_action_axis_validates` (P4-5).

---

### Task P4-1: Draft the new interface and get the owner's yes

**Files:**
- Modify: `draft/stage.html`, `draft/draft.css`, `notes/draft-constraints.md`
- Create: `draft/floor-plan.svg` (a hand-drawn sample of the plan for the draft room, linked from `draft/shots.html`)
- Modify: `draft/shots.html` (the floor-plan row links to the sample)

**Interfaces:**
- Produces: the approved markup and copy for the stand-in editor, the action axis control and the floor plan look. P4-3 and P4-4 copy from these files.

- [ ] **Step 1: Run `unslop` Phase 1 (constraints) for the three additions** and append the result to `notes/draft-constraints.md` under a "Phase 4" heading.
- [ ] **Step 2: Add the stand-in editor to `draft/stage.html`.** Clicking a stand-in row opens it in place with: Name (text), Height in metres (number, 0.50 to 2.50, step 0.01), Head height in metres (number, step 0.01), Facing in degrees (number, 0 to 359), X and Z in metres (number, step 0.05), and a "Remove" button. One row open at a time. Add `?state=standin-edit`, `?state=standins-long` (8 stand-ins, one with a 40 character name) and `?state=standins-noscale` (button disabled, line "Confirm the scale to add stand-ins. Their heights are in metres.") to the draft state switcher.
- [ ] **Step 3: Add the action axis control** at the foot of the Stand-ins panel: two selects listing the stand-ins, a "Set action axis" button, and when set the line "Action axis: Person A to Person B" with a "Clear" button. With fewer than two stand-ins the control shows "Add two stand-ins to set the action axis."
- [ ] **Step 4: Draw `draft/floor-plan.svg`** for the draft room: white page, black wall outline with the door gap, light outline for the chair, three numbered camera circles each with a wedge showing its horizontal field of view, two stand-in circles with a facing tick and label, the dashed action axis with its label, an arrow labelled "Front", a 1 m scale bar, and a title line "Scene name, floor plan, 2026-11-21, cut at 1.0 m".
- [ ] **Step 5: Run the `unslop` audit on the changed draft pages** (both themes, 1440 x 900) and fix what it finds. List the findings and rulings in `notes/draft-constraints.md`.
- [ ] **Step 6: Commit**, then stop for the owner.

```bash
git add draft notes/draft-constraints.md
git commit -m "Draft stand-in editing, action axis and floor plan sample"
```

- [ ] **Step 7: Owner gate.** The controller shows `http://localhost:5184/stage.html?state=standin-edit` and the floor plan sample, and asks the owner to approve the draft and the seven decisions above. No later task starts without a written yes. Record it as a dated line in `notes/draft-constraints.md`.

---

### Task P4-2: Stand-in maths, working set and shot record

**Files:**
- Create: `src/model/standIns.ts`, `tests/standIns.test.ts`
- Modify: `src/model/shotRecord.ts` (`ShotCapture`, `buildShot`), `tests/shotRecord.test.ts`, `src/ui/stage.ts` (pass an empty list for now)

**Interfaces:**
- Consumes: `applyLens(camera, focalMm, sensor, aspect)` from `src/camera/lens.ts`; `applyPose(camera, pose, frontHeadingDeg)` from `src/camera/pose.ts`; `StandIn`, `CameraPose`, `Sensor` from `src/model/types.ts`.
- Produces, all from `src/model/standIns.ts`:

```ts
export const DEFAULT_HEIGHT_M = 1.75;
export const DEFAULT_HEAD_HEIGHT_M = 0.23;
export const MIN_HEIGHT_M = 0.5;
export const MAX_HEIGHT_M = 2.5;

export type FrameReadout = {
  state: "in-frame" | "partly-out" | "out-of-frame" | "behind-camera";
  heightPct: number | null;   // null when behind the camera
  headPct: number | null;
  distanceM: number;          // horizontal distance from the camera
};
export function standInReadout(
  s: StandIn, pose: CameraPose, lens: { focalMm: number; sensor: Sensor; aspect: number }, frontHeadingDeg?: number,
): FrameReadout;

export function nextStandInId(list: Pick<StandIn, "id">[]): string;       // "standin-1"; highest number plus 1
export function nextStandInLabel(list: Pick<StandIn, "label">[]): string; // "Person A" to "Person Z", then "Person 27"

export type StandInSet = {
  list(): StandIn[];                                  // copies, in creation order
  add(positionM: [number, number, number], headingDeg: number): StandIn;
  update(id: string, patch: Partial<Omit<StandIn, "id">>): void;  // heightM clamped to MIN..MAX; headHeightM to 0.05..heightM
  remove(id: string): void;
  replace(list: StandIn[]): void;                     // deep copy in
  subscribe(fn: () => void): () => void;
};
export function createStandInSet(): StandInSet;
```

- `ShotCapture` gains `standIns: StandIn[]`. `buildShot` writes a deep copy of it and no longer reads `previous.standIns`.

- [ ] **Step 1: Write the failing tests in `tests/standIns.test.ts`.** Full frame is `{ widthMm: 36, heightMm: 24 }`, aspect `16 / 9`, a stand-in at `[0, 0, -5]`, camera at heading 0, pitch 0, roll 0.

```ts
test("readout_matches_the_plan_value", () => {
  const r = standInReadout(fig(1.75, [0, 0, -5]), cam([0, 0.875, 0]), ff(50));
  expect(r.heightPct).toBeCloseTo(86.42, 1);   // 1.75 x 50 / (5 x 20.25)
  expect(r.headPct).toBeCloseTo(11.36, 1);
  expect(r.distanceM).toBeCloseTo(5, 3);
  expect(r.state).toBe("in-frame");
});
test("readout_matches_the_draft_values", () => {
  expect(standInReadout(fig(1.75, [0, 0, -4]), cam([0, 0.875, 0]), ff(35)).heightPct).toBeCloseTo(75.6, 1);
  expect(standInReadout(fig(1.62, [0, 0, -5.5]), cam([0, 0.81, 0]), ff(35)).heightPct).toBeCloseTo(50.9, 1);
  expect(standInReadout(fig(1.75, [0, 0, -4]), cam([0, 0.875, 0]), ff(35)).headPct).toBeCloseTo(9.9, 1);
});
test("readout_states", () => {
  expect(standInReadout(fig(1.75, [0, 0, -5]), cam([0, 1.6, 0]), ff(50)).state).toBe("partly-out");   // feet below the frame
  expect(standInReadout(fig(1.75, [20, 0, -5]), cam([0, 1.6, 0]), ff(50)).state).toBe("out-of-frame");
  const behind = standInReadout(fig(1.75, [0, 0, 5]), cam([0, 1.6, 0]), ff(50));
  expect(behind.state).toBe("behind-camera");
  expect(behind.heightPct).toBeNull();
});
test("ids_and_labels", () => {
  expect(nextStandInId([{ id: "standin-1" }, { id: "standin-4" }])).toBe("standin-5");
  expect(nextStandInLabel([{ label: "Person A" }, { label: "Anna" }])).toBe("Person B");
});
test("set_clamps_and_copies", () => {
  const set = createStandInSet();
  const a = set.add([1, 0, 2], 90);
  expect(a).toMatchObject({ heightM: 1.75, headHeightM: 0.23, label: "Person A", headingDeg: 90 });
  set.update(a.id, { heightM: 9 });
  expect(set.list()[0]!.heightM).toBe(2.5);
  set.list()[0]!.label = "changed outside";
  expect(set.list()[0]!.label).toBe("Person A");
});
```

- [ ] **Step 2: Run `npm test -- standIns` and see them fail** because the module does not exist.
- [ ] **Step 3: Implement `src/model/standIns.ts`.** `standInReadout` builds a `PerspectiveCamera` with `applyLens` and `applyPose`, projects the feet point and the top point, and reports the distance between the two projected points as a percent of frame height (NDC y spans 2, x spans 2 times the aspect in the same units). `headPct` is `heightPct * headHeightM / heightM`. A point with camera-space z at or in front of zero means "behind-camera" when both points are behind, otherwise "partly-out". Both points inside the frame is "in-frame", both outside on the same side is "out-of-frame".
- [ ] **Step 4: Plant the fault.** Use `sensor.heightMm` in place of `sensor.widthMm / aspect`; `readout_matches_the_plan_value` must fail with about 72.9. Revert.
- [ ] **Step 5: Add to `tests/shotRecord.test.ts`:**

```ts
test("update_keeps_the_stage_stand_ins", () => {
  const previous = buildShot({ ...capture, standIns: [figA, figB] });
  const updated = buildShot({ ...capture, previous, standIns: [figA] });
  expect(updated.standIns).toEqual([figA]);
  expect(updated.standIns[0]).not.toBe(figA);
});
```

- [ ] **Step 6: Change `ShotCapture` and `buildShot`**, pass `standIns: []` from `src/ui/stage.ts` for now, run `npm run typecheck && npm test`. Expected: all pass.
- [ ] **Step 7: Commit.** `git commit -m "Add stand-in readout maths, working set and shot record field"`

---

### Task P4-3: Figures in the viewer, the Stand-ins panel, save and restore

**Files:**
- Create: `src/viewer/standIns.ts`, `src/ui/standIns.ts`, `tests/e2e/stand-ins.spec.ts`
- Modify: `src/viewer/scene.ts` (floor pick), `src/ui/stage.ts`, `src/styles.css`, `tests/e2e/save-restore.spec.ts`

**Interfaces:**
- Consumes: everything P4-2 produces; `Viewer`, `HELPER_LAYER`, `Viewer.pickCollider` from `src/viewer/scene.ts`; `ShotState`; the approved markup from P4-1.
- Produces:

```ts
// src/viewer/scene.ts, on Viewer
/** A point on the floor under the pointer, in the metric world frame, through the camera now drawn.
 *  A collider hit whose face normal points up (y above 0.7) wins; otherwise the plane y = 0. Null when the ray misses or the point is over 50 m away. */
pickFloor(clientX: number, clientY: number): THREE.Vector3 | null;

// src/viewer/standIns.ts
export class StandInFigures {
  constructor(scene: THREE.Scene, helperLayer: number);
  sync(list: StandIn[], selectedId: string | null): void;   // add, move, resize, remove meshes to match
  idAt(raycaster: THREE.Raycaster): string | null;          // the stand-in under a ray
  dispose(): void;
}

// src/ui/standIns.ts
export function createStandInsPanel(
  viewer: Viewer, shot: ShotState, set: StandInSet, scaleConfirmed: () => boolean,
): { root: HTMLDetailsElement; selectedId(): string | null; dispose(): void };
```

- Figure geometry: `CapsuleGeometry` with radius `0.12 * heightM`, feet at `positionM`, opaque unlit grey `#d9dce1`, on the default layer. Floor arrow: a flat triangle 0.02 m above the floor, 0.35 m long, pointing along the heading, default layer. Label sprite above the head and a selection ring on the floor: `HELPER_LAYER`.
- "Add stand-in" puts the figure on the floor 3 m in front of the shot camera, facing the camera. If `pickFloor` finds nothing there, 3 m in front on y = 0.
- Pointer down on a figure in the viewport selects it and starts a floor drag; the walk controls ignore that gesture. Every value is also editable from the panel fields, so a keyboard alone can place a figure.

- [ ] **Step 1: Write `tests/e2e/stand-ins.spec.ts`** (Chromium and WebKit, skips with a clear message when `scenes/` is empty). Use the 500k set, confirm the scale through the store helper the other specs use.

```ts
test("add_shows_the_readout", ...);          // Add stand-in; row reads "Person A"; pct text matches /\d+\.\d% of frame height/; hint matches "1.75 m tall, 3.0 m away"
test("readout_follows_the_lens", ...);       // pct at 85 mm equals pct at 35 mm times 85 / 35, within 0.2 points
test("add_is_disabled_without_scale", ...);  // button disabled; the P4-1 line is visible
test("figure_is_in_the_frame_grab", ...);    // grab with one figure 3 m ahead differs from the grab without it; the pixel at the figure's projected centre is within 12 of 217,220,225
test("grab_is_the_same_with_and_without_selection", ...);  // mean absolute difference 0.00
test("drag_moves_the_figure_on_the_floor", ...);  // pointer drag from the figure to a floor point 200 px right; X field changes, y stays within 0.01 of the floor
test("opening_a_shot_replaces_the_working_set", ...);  // save shot 1 with two figures, remove both, save shot 2, open shot 1: two rows; open shot 2: "None yet"
test("stand_ins_survive_a_reload", ...);     // reload, reopen the file, open shot 1: same labels, positions within 0.001
```

- [ ] **Step 2: Run the spec and see it fail** on the missing "Add stand-in" button.
- [ ] **Step 3: Implement `Viewer.pickFloor` and `StandInFigures`.**
- [ ] **Step 4: Implement the panel from the approved draft** and wire `src/ui/stage.ts`: replace the "Later step" section; `saveShotRecord` passes `set.list()`; `openShot` calls `set.replace(rec.standIns)`; a change of scene calls `set.replace([])`; the readouts repaint on every lens, pose or set change.
- [ ] **Step 5: Extend the restore test in `tests/e2e/save-restore.spec.ts`:** a shot saved with one figure restores with a mean absolute pixel difference under 2 of 255 against its stored grab.
- [ ] **Step 6: Measure how a figure sits among splats** and write the result in `notes/phase-4-results.md`: stand a figure behind the chair of the synthetic set and record whether the chair's splats hide the covered part in the grab. If they do not, record it as a known limit and keep going. It is not a blocker.
- [ ] **Step 7: Plant the fault.** Put the selection ring on the default layer; `grab_is_the_same_with_and_without_selection` must fail. Revert.
- [ ] **Step 8: Run `npm run typecheck && npm test && npm run test:e2e`.** Expected: all pass in both browsers. Commit. `git commit -m "Add stand-in figures, panel, floor drag, save and restore"`

---

### Task P4-4: Floor plan model and drawing

**Files:**
- Create: `src/export/floorPlan.ts`, `tests/floorPlan.test.ts`

**Interfaces:**
- Consumes: `Scene`, `Shot`, `StandIn`, `Marker` from `src/model/types.ts`. The look approved in `draft/floor-plan.svg`.
- Produces:

```ts
export const FLOOR_PLAN_FILE = "floor-plan.png";
export const CUT_HEIGHT_M = 1.0;
export const LOW_CUT_HEIGHT_M = 0.3;
export const FLOOR_PLAN_WIDTH_PX = 2000;

export type Segment = [x1: number, z1: number, x2: number, z2: number];   // metres
/** `tri` holds 9 numbers per triangle, world frame, metres. Each triangle that crosses the plane gives one segment. */
export function sliceTriangles(tri: Float32Array, y: number): Segment[];

export type FloorPlan = {
  title: string;                                   // "<scene name>, floor plan, <YYYY-MM-DD>, cut at 1.0 m"
  boundsM: { minX: number; maxX: number; minZ: number; maxZ: number };   // everything drawn, plus 0.5 m
  walls: Segment[]; low: Segment[]; hasCollider: boolean;
  cameras: { number: number; x: number; z: number; headingDeg: number; hfovDeg: number }[];
  standIns: { label: string; x: number; z: number; headingDeg: number; shots: number[] }[];
  markers: { label: string; x: number; z: number }[];
  axis: { label: string; ax: number; az: number; bx: number; bz: number } | null;
  frontHeadingDeg: number;
};
/** Throws when the scene's scale is not confirmed. `tri` is null when no collider is loaded. */
export function buildFloorPlan(scene: Scene, shots: Shot[], tri: Float32Array | null, date?: string): FloorPlan;

export type PlanTransform = { widthPx: number; heightPx: number; pxPerM: number; toPx(x: number, z: number): [number, number] };
/** Heading 0 points up the page. heightPx follows the bounds, capped at 2 times widthPx. */
export function planTransform(plan: FloorPlan, widthPx?: number, marginPx?: number): PlanTransform;

export function drawFloorPlan(ctx: CanvasRenderingContext2D, plan: FloorPlan, t: PlanTransform): void;
export function floorPlanPng(plan: FloorPlan, widthPx?: number): Uint8Array;   // canvas.toDataURL, as frameGrab.ts does
```

- [ ] **Step 1: Write the failing tests in `tests/floorPlan.test.ts`.**

```ts
test("slice_of_a_box_is_its_outline", ...);   // a 6 x 8 x 3 m box of 12 triangles cut at 1.0: 8 segments, total length 28 m, every end on the rectangle x = +-3, z = +-4
test("slice_misses_what_is_below_the_cut", ...);   // a 0.45 m high box gives 0 segments at 1.0 and 4 or more at 0.3
test("camera_numbers_are_the_shot_numbers", ...);  // shots numbered 1, 2, 3 in shuffled order: plan.cameras.map(c => c.number) equals [1, 2, 3], and equals the first cell of each row of shotListMarkdown(scene, shots)
test("stand_ins_are_drawn_once_per_place", ...);   // same label and position in shots 1 and 2: one entry, shots [1, 2]; moved in shot 3: a second entry, shots [3]
test("plan_is_not_mirrored", () => {
  // camera 1 at x = +2, z = 0; camera 2 at x = 0, z = -3 (toward the front); frontHeadingDeg 0
  const [x1] = t.toPx(2, 0), [x0, y0] = t.toPx(0, 0), [, y2] = t.toPx(0, -3);
  expect(x1).toBeGreaterThan(x0);   // +x is to the right
  expect(y2).toBeLessThan(y0);      // the front is up the page
});
test("front_heading_turns_the_page", ...);   // frontHeadingDeg 90: the point 3 m along heading 0 is straight up from the origin, within 0.5 px
test("unconfirmed_scale_throws", ...);       // message contains "scale not confirmed"
test("no_collider_has_no_walls", ...);       // hasCollider false, walls empty, bounds still cover cameras and stand-ins
```

- [ ] **Step 2: Run `npm test -- floorPlan`** and see the failures.
- [ ] **Step 3: Implement `sliceTriangles`, `buildFloorPlan` and `planTransform`.** Shot heading in the three.js world: heading 0 with `frontHeadingDeg` 0 looks along -z, clockwise from above, the convention `src/camera/pose.ts` already uses. Read it there; do not invent a second one.
- [ ] **Step 4: Plant the fault.** Negate x in `toPx`; `plan_is_not_mirrored` must fail. Revert.
- [ ] **Step 5: Implement `drawFloorPlan` and `floorPlanPng`** to the approved sample: white page, black 3 px walls, grey 1.5 px low cut, camera circles with the number inside and a wedge of the shot's `hfovDeg` 1.2 m long, stand-in circles with a facing tick and "label (shots 1, 2)", markers as crosses with labels, the dashed axis with its label, the "Front" arrow, a 1 m scale bar, the title line, and "No collider mesh was loaded, so walls are not drawn." when `hasCollider` is false. Colours are fixed; the plan does not follow the interface theme.
- [ ] **Step 6: Run `npm run typecheck && npm test`.** Expected: all pass. Commit. `git commit -m "Add floor plan model, layout and drawing"`

---

### Task P4-5: Floor plan in the export, action axis, location sheet

**Files:**
- Modify: `src/viewer/scene.ts`, `src/model/types.ts`, `src/model/schema.ts`, `docs/spec.md` (section 4, the one new field), `src/export/zip.ts`, `src/export/locationSheet.ts`, `src/ui/shots.ts`, `src/ui/standIns.ts`, `tests/export.test.ts`, `tests/store.test.ts`, `tests/e2e/export.spec.ts`

**Interfaces:**
- Consumes: `buildFloorPlan`, `floorPlanPng`, `FLOOR_PLAN_FILE` from P4-4; `StandInSet` from P4-2.
- Produces:

```ts
// src/model/types.ts, on Scene
actionAxis?: { label: string; aM: [number, number]; bM: [number, number] } | null;   // x and z, metres

// src/viewer/scene.ts, on Viewer
/** The collider's triangles in the metric world frame, 9 numbers each, or null when none is loaded. */
colliderTriangles(): Float32Array | null;

// src/export/zip.ts
export type FloorPlanState = { kind: "included"; png: Uint8Array } | { kind: "left-out"; reason: "scale-not-confirmed" };
export function buildExportZip(scene: Scene, frames: ExportFrame[], floorPlan: FloorPlanState): Uint8Array;

// src/export/locationSheet.ts
export function locationSheetMarkdown(scene: Scene, shots: Shot[], floorPlan: FloorPlanState["kind"]): string;
```

- Location sheet floor plan line, included: `floor-plan.png, cameras numbered as in shot-list.md, action axis: <label>` (or `action axis: not set`). Left out: `not included: scale not confirmed`.
- Shots export panel row for `floor-plan.png`: "Top-down view with numbered cameras." when it will be included, "Left out until the scale is confirmed." otherwise, and with no collider "Top-down view with numbered cameras. Walls are not drawn without a collider mesh."

- [ ] **Step 1: Write the failing tests.** In `tests/export.test.ts`: `zip_holds_the_floor_plan` (entry `<folder>/floor-plan.png` begins with the PNG signature `89 50 4E 47 0D 0A 1A 0A`), `zip_without_scale_has_no_floor_plan`, `location_sheet_names_the_floor_plan_and_axis`. In `tests/store.test.ts`: `scene_without_action_axis_validates` and `bad_action_axis_is_rejected` (a point with one number). In `tests/e2e/export.spec.ts`: `export_with_floor_plan` (download the zip, decode the PNG in the page, width 2000, and the pixel at shot 1's plan position is not white), `export_without_collider` (zip downloads, PNG present), `export_without_scale` (no PNG, the panel line reads "Left out until the scale is confirmed.").
- [ ] **Step 2: Run them and see the failures.**
- [ ] **Step 3: Add the type, the validator branch and the spec line.** The validator accepts a missing or null `actionAxis`.
- [ ] **Step 4: Implement `Viewer.colliderTriangles`, the zip and location sheet changes, and the Shots export wiring.** The Shots view builds the plan at export time from the open scene, its shots and `viewer.colliderTriangles()`.
- [ ] **Step 5: Implement the action axis control** in `src/ui/standIns.ts` from the approved draft: "Set action axis" saves `{ label: "<A> to <B>", aM, bM }` on the scene record through the session's store and refreshes the session; "Clear" saves null.
- [ ] **Step 6: Plant the fault.** Skip the floor plan entry in `buildExportZip`; `zip_holds_the_floor_plan` and `export_with_floor_plan` must fail. Revert.
- [ ] **Step 7: Run `npm run typecheck && npm test && npm run test:e2e`** with `FILM_CRAFT_SHOT_LIST` set as the README says. Expected: all pass in both browsers. Commit. `git commit -m "Add floor plan to the export, action axis and location sheet line"`

---

### Task P4-6: Phase 4 audit and wrap

**Files:**
- Modify: `tests/audit/states-walk.mjs` (it still targets the markup from before the task 20 fixes), `README.md`, `docs/implementation-plan.md` (the phase 4 outline becomes a pointer to this file)
- Create: `notes/phase-4-results.md`

- [ ] **Step 1: Bring `tests/audit/states-walk.mjs` up to the current markup** and add the phase 4 states: no stand-ins, one, eight with a 40 character name, a stand-in open for editing, scale not confirmed, axis set, export panel with and without a floor plan. Run `npm run audit:states`. Expected: every state writes a screenshot in Chromium and WebKit, light and dark.
- [ ] **Step 2: Run the `unslop` audit** on the Stage and Shots screenshots and on one exported `floor-plan.png`. Write the fix list with a ruling per item, fix, rerun the affected tests.
- [ ] **Step 3: Check by hand on a real GPU in the Browser pane:** open the 2M set, confirm the scale, add two stand-ins, drag one, save two shots from different sides, set the axis, export, open `floor-plan.png`. Record in `notes/phase-4-results.md` what was seen, with the plan image path (git-ignored).
- [ ] **Step 4: Check the stand-ins part of criterion 6** on the saved frame, and the old task 22 check: camera numbers on the plan equal the shot numbers in `shot-list.md`.
- [ ] **Step 5: Update `README.md`** (stand-ins and floor plan move out of "Not built yet") and replace the phase 4 outline in `docs/implementation-plan.md` with a line pointing here.
- [ ] **Step 6: Final run:** `npm run typecheck && npm test && npm run test:e2e`, `git ls-files | grep -E '\.(png|jpg|ply|spz|glb)$'` returns nothing. Commit. `git commit -m "Phase 4 audit, notes and README"`
- [ ] **Step 7: Owner check.** The owner looks at one exported floor plan and says whether the drawing is usable for film-craft's 180 degree line check. The answer goes in `notes/phase-4-results.md`.

---

## Not in this plan

- Camera moves (old tasks 23 and 24) and the Quest phase (25 and 26) stay outlines.
- Desktop Safari by hand and a real Marble export are still open from phase 3 and are not closed here.
- No per-shot switch to hide stand-ins in the frame grab. If the owner wants clean frames for a video tool, that is a follow-up.
