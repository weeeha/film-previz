import { describe, it, expect } from "vitest";
import {
  easeValue, endPoseFor, interpolatePose, buildMove, settingFromMove, moveDistanceM, moveAngleDeg,
  defaultAmount, DEFAULT_DURATION_S, type MoveKind, type MoveSetting,
} from "../src/camera/move";
import type { CameraPose } from "../src/model/types";

const pose = (over: Partial<CameraPose> = {}): CameraPose => ({ positionM: [0, 1.6, 0], headingDeg: 0, pitchDeg: 0, rollDeg: 0, ...over });

describe("camera moves", () => {
  it("ease_endpoints_are_exact", () => {
    for (const e of ["linear", "ease-in-out"] as const) {
      expect(easeValue(0, e)).toBe(0);
      expect(easeValue(1, e)).toBe(1);
    }
    expect(easeValue(0.5, "ease-in-out")).toBe(0.5);
    expect(easeValue(0.25, "ease-in-out")).toBe(0.15625);
    expect(easeValue(-1, "ease-in-out")).toBe(0);
    expect(easeValue(2, "linear")).toBe(1);
  });

  it("position_interpolates_linearly", () => {
    const p = interpolatePose(pose(), pose({ positionM: [0, 1.6, -2] }), 0.25, "linear");
    expect(p.positionM[2]).toBeCloseTo(-0.5, 12);
    expect(p.positionM[1]).toBe(1.6);
  });

  it("heading_takes_the_short_way", () => {
    const a = pose({ headingDeg: 350 }), b = pose({ headingDeg: 10 });
    const mid = interpolatePose(a, b, 0.5, "linear").headingDeg;
    expect(Math.min(mid, 360 - mid)).toBeLessThan(1e-9);
    expect(interpolatePose(a, b, 0.25, "linear").headingDeg).toBeCloseTo(355, 9);
  });

  it("push_in_keeps_height_and_orientation", () => {
    const s = pose({ headingDeg: 90, pitchDeg: -10, rollDeg: 2 });
    const e = endPoseFor("push-in", s, 1.2)!;
    expect(e.positionM[0]).toBeCloseTo(1.2, 12); // heading 90 looks down +x
    expect(e.positionM[1]).toBe(1.6);
    expect(e.positionM[2]).toBeCloseTo(0, 12);
    expect([e.headingDeg, e.pitchDeg, e.rollDeg]).toEqual([90, -10, 2]);
    expect(moveDistanceM(s, e)).toBeCloseTo(1.2, 12);
    // the scene front heading turns the direction with it
    const f = endPoseFor("push-in", pose({ headingDeg: 0 }), 1, 90)!;
    expect(f.positionM[0]).toBeCloseTo(1, 12);
  });

  it("pull_out_goes_backward", () => {
    const e = endPoseFor("pull-out", pose(), 2)!; // heading 0 looks down -z, so backward is +z
    expect(e.positionM[2]).toBeCloseTo(2, 12);
    expect(e.positionM[0]).toBeCloseTo(0, 12);
    expect(e.headingDeg).toBe(0);
  });

  it("pan_right_adds_heading", () => {
    const e = endPoseFor("pan", pose({ headingDeg: 350 }), 30)!;
    expect(e.headingDeg).toBeCloseTo(20, 9);
    expect(e.positionM).toEqual([0, 1.6, 0]);
    expect(moveAngleDeg(pose({ headingDeg: 350 }), e)).toBeCloseTo(30, 9);
  });

  it("tilt_is_clamped", () => {
    expect(endPoseFor("tilt", pose({ pitchDeg: 80 }), 30)!.pitchDeg).toBe(89);
    expect(endPoseFor("tilt", pose({ pitchDeg: -10 }), 10)!.pitchDeg).toBe(0);
  });

  it("track_goes_right", () => {
    const e = endPoseFor("track", pose(), 1.5, 0)!;
    expect(e.positionM[0]).toBeCloseTo(1.5, 12);
    expect(e.positionM[2]).toBeCloseTo(0, 12);
    expect(e.positionM[1]).toBe(1.6);
    expect(e.headingDeg).toBe(0);
  });

  it("static_and_handheld_have_no_end_pose", () => {
    expect(endPoseFor("static", pose(), 1)).toBeNull();
    expect(endPoseFor("handheld", pose(), 1)).toBeNull();
    const s: MoveSetting = { kind: "static", amount: 0, durationS: 4, ease: "linear" };
    expect(buildMove(s, pose())).toEqual({ kind: "static", durationS: null, ease: null, endPose: null });
    expect(buildMove({ ...s, kind: "handheld" }, pose())).toEqual({ kind: "handheld", durationS: 4, ease: null, endPose: null });
  });

  it("setting_round_trips", () => {
    const start = pose({ positionM: [1, 1.6, -2], headingDeg: 130, pitchDeg: 5 });
    const kinds: MoveKind[] = ["static", "push-in", "pull-out", "pan", "tilt", "track", "handheld"];
    for (const front of [0, 37]) for (const kind of kinds) {
      const s: MoveSetting = { kind, amount: defaultAmount(kind), durationS: DEFAULT_DURATION_S, ease: "ease-in-out" };
      if (kind === "pan") s.amount = -40;
      if (kind === "track") s.amount = -0.7;
      if (kind === "tilt") s.amount = -12;
      const back = settingFromMove(buildMove(s, start, front), start, front);
      expect(back.kind).toBe(s.kind);
      expect(back.amount, kind).toBeCloseTo(s.amount, 9);
      expect(back.durationS).toBe(s.durationS);
      expect(back.ease).toBe(s.ease);
    }
  });
});
