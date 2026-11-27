import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { poseFromHeadset, createPlacementQueue, savePlacedShots, type PlacedPose } from "../../src/xr/place";
import type { Shot } from "../../src/model/types";

const DEG = Math.PI / 180;
const quat = (e: THREE.Euler): [number, number, number, number] => { const q = new THREE.Quaternion().setFromEuler(e); return [q.x, q.y, q.z, q.w]; };
const placed = (n: number): PlacedPose => ({ pose: { positionM: [n, 1.6, 0], headingDeg: n, pitchDeg: 0, rollDeg: 0 }, heightAboveGroundM: 1.6 });
const shot = (n: number) => ({ id: `shot-${n}`, number: n } as unknown as Shot);

describe("pose from the headset", () => {
  it("level_head_facing_front", () => {
    const p = poseFromHeadset([1, 1.62, 2], [0, 0, 0, 1]);
    expect(p).toEqual({ positionM: [1, 1.62, 2], headingDeg: 0, pitchDeg: 0, rollDeg: 0 });
    expect(p.positionM[1]).toBe(1.62);
  });
  it("head_turned_right", () => {
    // three.js turns a head to the left for a positive rotation about y, so right is negative
    const p = poseFromHeadset([0, 1.6, 0], quat(new THREE.Euler(0, -90 * DEG, 0)));
    expect(p.headingDeg).toBeCloseTo(90, 9);
    expect(p.pitchDeg).toBeCloseTo(0, 9);
  });
  it("head_looking_up", () => {
    const p = poseFromHeadset([0, 1.6, 0], quat(new THREE.Euler(20 * DEG, 0, 0)));
    expect(p.pitchDeg).toBeCloseTo(20, 9);
    expect(p.headingDeg).toBeCloseTo(0, 9);
  });
  it("rolled_head_gives_zero_roll", () => {
    const level = poseFromHeadset([0, 1.6, 0], quat(new THREE.Euler(10 * DEG, -40 * DEG, 0, "YXZ")));
    const rolled = poseFromHeadset([0, 1.6, 0], quat(new THREE.Euler(10 * DEG, -40 * DEG, 15 * DEG, "YXZ")));
    expect(rolled.rollDeg).toBe(0);
    expect(rolled.headingDeg).toBeCloseTo(level.headingDeg, 6);
    expect(rolled.pitchDeg).toBeCloseTo(level.pitchDeg, 6);
    expect(level.headingDeg).toBeCloseTo(40, 6);
  });
  it("front_heading_is_subtracted", () => {
    const q = quat(new THREE.Euler(0, -100 * DEG, 0)); // world heading 100
    expect(poseFromHeadset([0, 1.6, 0], q, 30).headingDeg).toBeCloseTo(70, 9);
    expect(poseFromHeadset([0, 1.6, 0], q, 120).headingDeg).toBeCloseTo(340, 9); // wraps into 0 to 360
  });
});

describe("placement queue", () => {
  it("queue_drains_in_order", () => {
    const q = createPlacementQueue();
    q.add(placed(1)); q.add(placed(2)); q.add(placed(3));
    expect(q.size()).toBe(3);
    expect(q.drain().map((p) => p.pose.headingDeg)).toEqual([1, 2, 3]);
    expect(q.size()).toBe(0);
    expect(q.drain()).toEqual([]);
  });
  it("placed_shots_are_saved_in_order", async () => {
    const calls: number[] = [];
    const out = await savePlacedShots([placed(1), placed(2), placed(3)], async (p, i) => { calls.push(p.pose.headingDeg); return shot(i + 1); });
    expect(calls).toEqual([1, 2, 3]);
    expect(out.map((s) => s.number)).toEqual([1, 2, 3]);
  });
  it("a_failed_save_does_not_drop_the_rest", async () => {
    const calls: number[] = [];
    const errors: Array<[unknown, number]> = [];
    const boom = new Error("disk full");
    const save = async (p: PlacedPose, i: number): Promise<Shot> => { calls.push(p.pose.headingDeg); if (i === 1) throw boom; return shot(i + 1); };
    const out = await savePlacedShots([placed(1), placed(2), placed(3)], save, (e, i) => errors.push([e, i]));
    expect(calls).toEqual([1, 2, 3]);
    expect(out.map((s) => s.number)).toEqual([1, 3]);
    expect(errors).toEqual([[boom, 1]]);
    // with no error callback the failure is thrown after the rest were tried, never swallowed
    calls.length = 0;
    await expect(savePlacedShots([placed(1), placed(2), placed(3)], save)).rejects.toBeInstanceOf(AggregateError);
    expect(calls).toEqual([1, 2, 3]);
  });
});
