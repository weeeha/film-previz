import { describe, test, expect } from "vitest";
import { standInReadout, nextStandInId, nextStandInLabel, createStandInSet, freeStandInSpot, STAND_IN_SPACING_M } from "../src/model/standIns";
import type { CameraPose, StandIn } from "../src/model/types";

const fig = (heightM: number, positionM: [number, number, number], headHeightM = 0.23): StandIn =>
  ({ id: "standin-1", label: "Person A", heightM, headHeightM, positionM, headingDeg: 0 });
const cam = (positionM: [number, number, number]): CameraPose => ({ positionM, headingDeg: 0, pitchDeg: 0, rollDeg: 0 });
const ff = (focalMm: number) => ({ focalMm, sensor: { id: "ff", label: "Full frame", widthMm: 36, heightMm: 24 }, aspect: 16 / 9 });

describe("standInReadout", () => {
  test("readout_matches_the_plan_value", () => {
    const r = standInReadout(fig(1.75, [0, 0, -5]), cam([0, 0.875, 0]), ff(50));
    expect(r.heightPct).toBeCloseTo(86.42, 1); // 1.75 x 50 / (5 x 20.25)
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
    expect(standInReadout(fig(1.75, [0, 0, -5]), cam([0, 1.6, 0]), ff(50)).state).toBe("partly-out"); // feet below the frame
    expect(standInReadout(fig(1.75, [20, 0, -5]), cam([0, 1.6, 0]), ff(50)).state).toBe("out-of-frame");
    const behind = standInReadout(fig(1.75, [0, 0, 5]), cam([0, 1.6, 0]), ff(50));
    expect(behind.state).toBe("behind-camera");
    expect(behind.heightPct).toBeNull();
  });
  test("follows_the_scene_front_heading", () => {
    // front heading 90: world looks down +x at pose heading 0
    const r = standInReadout(fig(1.75, [5, 0, 0]), cam([0, 0.875, 0]), ff(50), 90);
    expect(r.state).toBe("in-frame");
    expect(r.heightPct).toBeCloseTo(86.42, 1);
  });
});

describe("ids and set", () => {
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
  test("head_height_is_clamped_and_set_notifies", () => {
    const set = createStandInSet();
    let n = 0;
    const off = set.subscribe(() => { n++; });
    const a = set.add([0, 0, 0], 0);
    set.update(a.id, { headHeightM: 9 });
    expect(set.list()[0]!.headHeightM).toBe(1.75);
    set.update(a.id, { headHeightM: 0 });
    expect(set.list()[0]!.headHeightM).toBe(0.05);
    set.replace([fig(1.6, [1, 0, 1])]);
    expect(set.list()).toHaveLength(1);
    set.remove("standin-1");
    expect(set.list()).toHaveLength(0);
    expect(n).toBe(5);
    off();
    set.add([0, 0, 0], 0);
    expect(n).toBe(5);
  });
});

describe("freeStandInSpot", () => {
  const at = (x: number, z: number): StandIn => fig(1.75, [x, 0, z]);
  test("keeps the spot ahead of the camera when it is free", () => {
    expect(freeStandInSpot([], [0, -3], 0)).toEqual([0, -3]);
  });
  test("moves the next figure to the right, then the left, then further out", () => {
    const first = freeStandInSpot([], [0, -3], 0);
    const second = freeStandInSpot([at(...first)], [0, -3], 0);
    expect(second[0]).toBeCloseTo(STAND_IN_SPACING_M, 5);
    expect(second[1]).toBeCloseTo(-3, 5);
    const third = freeStandInSpot([at(...first), at(...second)], [0, -3], 0);
    expect(third[0]).toBeCloseTo(-STAND_IN_SPACING_M, 5);
    const fourth = freeStandInSpot([at(...first), at(...second), at(...third)], [0, -3], 0);
    expect(fourth[0]).toBeCloseTo(2 * STAND_IN_SPACING_M, 5);
  });
  test("follows the camera's right side when it faces another way", () => {
    // camera heading 90 looks down +x, so its right is +z
    const second = freeStandInSpot([at(3, 0)], [3, 0], 90);
    expect(second[0]).toBeCloseTo(3, 5);
    expect(second[1]).toBeCloseTo(STAND_IN_SPACING_M, 5);
  });
  test("skips a slot taken by a figure that was dragged there", () => {
    const [x, z] = freeStandInSpot([at(0, -3), at(STAND_IN_SPACING_M, -3)], [0, -3], 0);
    expect(x).toBeCloseTo(-STAND_IN_SPACING_M, 5);
    expect(z).toBeCloseTo(-3, 5);
  });
});
