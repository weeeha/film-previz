import { describe, it, expect } from "vitest";
import { sliceTriangles, buildFloorPlan, planTransform } from "../src/export/floorPlan";
import { shotListMarkdown } from "../src/export/shotList";
import { makeScene, makeShot } from "./helpers/model";

/** A box as 12 triangles, 9 numbers each. */
function box(cx: number, cz: number, w: number, d: number, y0: number, y1: number): Float32Array {
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  const v = (x: number, y: number, z: number) => [x, y, z];
  const quad = (a: number[], b: number[], c: number[], e: number[]) => [...a, ...b, ...c, ...a, ...c, ...e];
  return new Float32Array([
    ...quad(v(x0, y0, z0), v(x1, y0, z0), v(x1, y1, z0), v(x0, y1, z0)),
    ...quad(v(x1, y0, z0), v(x1, y0, z1), v(x1, y1, z1), v(x1, y1, z0)),
    ...quad(v(x1, y0, z1), v(x0, y0, z1), v(x0, y1, z1), v(x1, y1, z1)),
    ...quad(v(x0, y0, z1), v(x0, y0, z0), v(x0, y1, z0), v(x0, y1, z1)),
    ...quad(v(x0, y1, z0), v(x1, y1, z0), v(x1, y1, z1), v(x0, y1, z1)),
    ...quad(v(x0, y0, z1), v(x1, y0, z1), v(x1, y0, z0), v(x0, y0, z0)),
  ]);
}

const confirmed = { source: "manual" as const, metricScaleFactor: 2.5, groundPlaneOffsetM: 0, reference: null, confirmedAt: "2026-11-21T10:00:00.000Z" };
const sc = (over = {}) => makeScene(undefined, { scale: confirmed, ...over });
const at = (n: number, x: number, z: number, over = {}) => makeShot(sc().id, n, { pose: { positionM: [x, 1.6, z], headingDeg: 0, pitchDeg: 0, rollDeg: 0 }, standIns: [], ...over });
const len = (s: number[]) => Math.hypot(s[2]! - s[0]!, s[3]! - s[1]!);

describe("sliceTriangles", () => {
  it("slice_of_a_box_is_its_outline", () => {
    const segs = sliceTriangles(box(0, 0, 6, 8, 0, 3), 1.0);
    expect(segs).toHaveLength(8);
    expect(segs.reduce((a, s) => a + len(s), 0)).toBeCloseTo(28, 4);
    for (const s of segs) for (const [x, z] of [[s[0], s[1]], [s[2], s[3]]] as const) {
      const onSide = Math.abs(Math.abs(x) - 3) < 1e-5 && Math.abs(z) <= 4 + 1e-5;
      const onEnd = Math.abs(Math.abs(z) - 4) < 1e-5 && Math.abs(x) <= 3 + 1e-5;
      expect(onSide || onEnd).toBe(true);
    }
  });
  it("slice_misses_what_is_below_the_cut", () => {
    const low = box(0, 0, 1, 1, 0, 0.45);
    expect(sliceTriangles(low, 1.0)).toHaveLength(0);
    expect(sliceTriangles(low, 0.3).length).toBeGreaterThanOrEqual(4);
  });
});

describe("floor plan", () => {
  it("camera_numbers_are_the_shot_numbers", () => {
    const scene = sc();
    const shots = [at(3, 0, 0), at(1, 1, 0), at(2, 2, 0)];
    const plan = buildFloorPlan(scene, shots, null);
    expect(plan.cameras.map((c) => c.number)).toEqual([1, 2, 3]);
    const rows = shotListMarkdown(scene, shots).split("\n").filter((l) => /^\| \d+ \|/.test(l));
    expect(rows.map((r) => Number(r.split(" | ")[0]!.replace("| ", "")))).toEqual(plan.cameras.map((c) => c.number));
  });
  it("stand_ins_are_drawn_once_per_place", () => {
    const f = (x: number, z: number) => ({ id: "standin-1", label: "Anna", heightM: 1.75, headHeightM: 0.23, positionM: [x, 0, z] as [number, number, number], headingDeg: 0 });
    const plan = buildFloorPlan(sc(), [at(1, 0, 3, { standIns: [f(1, 1)] }), at(2, 2, 3, { standIns: [f(1, 1)] }), at(3, 0, 3, { standIns: [f(2, 2)] })], null);
    expect(plan.standIns).toHaveLength(2);
    expect(plan.standIns[0]).toMatchObject({ label: "Anna", shots: [1, 2] });
    expect(plan.standIns[1]!.shots).toEqual([3]);
  });
  it("plan_is_not_mirrored", () => {
    const plan = buildFloorPlan(sc(), [at(1, 2, 0), at(2, 0, -3)], null);
    const t = planTransform(plan);
    const [x1] = t.toPx(2, 0), [x0, y0] = t.toPx(0, 0), [, y2] = t.toPx(0, -3);
    expect(x1).toBeGreaterThan(x0); // +x is to the right
    expect(y2).toBeLessThan(y0); // the front is up the page
  });
  it("front_heading_turns_the_page", () => {
    const plan = buildFloorPlan(sc({ frontHeadingDeg: 90 }), [at(1, 0, 3)], null);
    const t = planTransform(plan);
    const [x0, y0] = t.toPx(0, 0), [x3, y3] = t.toPx(3, 0); // world heading 90 is scene heading 0
    expect(Math.abs(x3 - x0)).toBeLessThan(0.5);
    expect(y3).toBeLessThan(y0 - 100);
  });
  it("unconfirmed_scale_throws", () => {
    expect(() => buildFloorPlan(makeScene(), [at(1, 0, 0)], null)).toThrow(/scale not confirmed/);
  });
  it("no_collider_has_no_walls", () => {
    const f = { id: "standin-1", label: "Anna", heightM: 1.75, headHeightM: 0.23, positionM: [4, 0, -5] as [number, number, number], headingDeg: 0 };
    const plan = buildFloorPlan(sc(), [at(1, -3, 2, { standIns: [f] })], null);
    expect(plan.hasCollider).toBe(false);
    expect(plan.walls).toEqual([]);
    const b = plan.boundsM;
    expect(b.minX).toBeLessThanOrEqual(-3); expect(b.maxX).toBeGreaterThanOrEqual(4);
    expect(b.minZ).toBeLessThanOrEqual(-5); expect(b.maxZ).toBeGreaterThanOrEqual(2);
  });
  it("walls_come_from_the_collider", () => {
    const plan = buildFloorPlan(sc(), [at(1, 0, 0)], box(0, 0, 6, 8, 0, 3));
    expect(plan.hasCollider).toBe(true);
    expect(plan.walls).toHaveLength(8);
    expect(plan.boundsM.minX).toBeCloseTo(-3.5, 4);
  });
});
