import { describe, it, expect } from "vitest";
import { xrSupport, stepLocomotion, rigPositionKeepingHead, MOVE_SPEED_MPS, SNAP_TURN_DEG, type RigState } from "../../src/xr/xr";

const rig0: RigState = { x: 0, z: 0, yawDeg: 0, turnArmed: true };
const still = { moveX: 0, moveY: 0, turnX: 0 };
type Nav = Parameters<typeof xrSupport>[0];
const fakeNav = (isSessionSupported: () => Promise<boolean>): Nav => ({ xr: { isSessionSupported } } as unknown as Nav);

describe("xr support", () => {
  it("support_states", async () => {
    expect(await xrSupport({ xr: undefined } as unknown as Nav, true)).toBe("unsupported");
    expect(await xrSupport(undefined, true)).toBe("unsupported");
    expect(await xrSupport(fakeNav(async () => true), false)).toBe("insecure-context");
    expect(await xrSupport(fakeNav(async () => true), true)).toBe("supported");
    expect(await xrSupport(fakeNav(async () => false), true)).toBe("unsupported");
    expect(await xrSupport(fakeNav(() => Promise.reject(new Error("no"))), true)).toBe("unsupported");
  });
});

describe("locomotion", () => {
  it("stick_inside_dead_zone_does_not_move", () => {
    for (const [moveX, moveY] of [[0.1, 0], [0, 0.14], [0.1, 0.1], [-0.1, -0.1]] as const) {
      const r = stepLocomotion(rig0, 0, { moveX, moveY, turnX: 0 }, 1);
      expect(r.x).toBe(0); expect(r.z).toBe(0);
    }
    const out = stepLocomotion(rig0, 0, { moveX: 0, moveY: 0.16, turnX: 0 }, 1);
    expect(out.z).toBeLessThan(0); // just outside the dead zone it does move
  });

  it("forward_stick_moves_along_the_head_direction", () => {
    let r = rig0;
    for (let i = 0; i < 200; i++) r = stepLocomotion(r, 90, { moveX: 0, moveY: 1, turnX: 0 }, 0.01);
    expect(r.x).toBeCloseTo(3.0, 6); // heading 90 looks down +x
    expect(r.z).toBeCloseTo(0, 6);
    const north = stepLocomotion(rig0, 0, { moveX: 0, moveY: 1, turnX: 0 }, 1);
    expect(north.z).toBeCloseTo(-MOVE_SPEED_MPS, 9); // heading 0 looks down -z
    const right = stepLocomotion(rig0, 0, { moveX: 1, moveY: 0, turnX: 0 }, 1);
    expect(right.x).toBeCloseTo(MOVE_SPEED_MPS, 9);
  });

  it("snap_turn_fires_once_per_push", () => {
    let r = rig0;
    for (let i = 0; i < 5; i++) r = stepLocomotion(r, 0, { ...still, turnX: 1 }, 0.011);
    expect(r.yawDeg).toBe(SNAP_TURN_DEG);
    r = stepLocomotion(r, 0, { ...still, turnX: 0.2 }, 0.011); // released below 0.3
    expect(r.turnArmed).toBe(true);
    r = stepLocomotion(r, 0, { ...still, turnX: 1 }, 0.011);
    expect(r.yawDeg).toBe(2 * SNAP_TURN_DEG);
    r = stepLocomotion(r, 0, { ...still, turnX: 0.45 }, 0.011); // between 0.3 and 0.6 does not re-arm
    r = stepLocomotion(r, 0, { ...still, turnX: 1 }, 0.011);
    expect(r.yawDeg).toBe(2 * SNAP_TURN_DEG);
    const left = stepLocomotion(rig0, 0, { ...still, turnX: -1 }, 0.011);
    expect(left.yawDeg).toBe(-SNAP_TURN_DEG);
  });

  it("move_speed_is_one_and_a_half", () => {
    expect(MOVE_SPEED_MPS).toBe(1.5);
    const r = stepLocomotion(rig0, 180, { moveX: 0, moveY: 1, turnX: 0 }, 1); // heading 180 looks down +z
    expect(r.z).toBeCloseTo(1.5, 9);
    const diag = stepLocomotion(rig0, 0, { moveX: 1, moveY: 1, turnX: 0 }, 1); // a corner of the stick is not faster
    expect(Math.hypot(diag.x, diag.z)).toBeCloseTo(1.5, 9);
  });

  it("a snap turn keeps the head where it is", () => {
    // head 0.3 m right of the rig origin, rig turned 30 degrees: the rig moves so the head stays at (2, 5)
    const [rx, rz] = rigPositionKeepingHead([2, 5], [0.3, -0.2], 30);
    const th = -30 * Math.PI / 180;
    expect(rx + 0.3 * Math.cos(th) + -0.2 * Math.sin(th)).toBeCloseTo(2, 9);
    expect(rz + -0.3 * Math.sin(th) + -0.2 * Math.cos(th)).toBeCloseTo(5, 9);
  });
});
