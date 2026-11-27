import * as THREE from "three";
import type { Viewer } from "../viewer/scene";

// WebXR session for the Stage. The renderer, Spark and the walk camera are the ones the page already uses.
// Entering a session moves the walk camera under a rig group (Viewer.beginXr); locomotion moves that rig only,
// never the scene content. Nothing here is verified on a headset.

export type XrSupport = "supported" | "unsupported" | "insecure-context";

/** Whether the browser can start an immersive VR session. Never throws. */
export async function xrSupport(
  nav: Pick<Navigator, "xr"> | undefined = typeof navigator === "undefined" ? undefined : navigator,
  secure: boolean = typeof isSecureContext === "undefined" ? false : isSecureContext,
): Promise<XrSupport> {
  if (!secure) return "insecure-context";
  const xr = nav?.xr;
  if (!xr || typeof xr.isSessionSupported !== "function") return "unsupported";
  try {
    return (await xr.isSessionSupported("immersive-vr")) ? "supported" : "unsupported";
  } catch {
    return "unsupported";
  }
}

export const MOVE_SPEED_MPS = 1.5;
export const SNAP_TURN_DEG = 30;
const DEAD_ZONE = 0.15;
const TURN_FIRE = 0.6;
const TURN_REARM = 0.3;
const DEG = Math.PI / 180;

/** Stick values, each -1 to 1. moveY forward is positive, moveX right is positive, turnX right is positive. */
export type ThumbstickInput = { moveX: number; moveY: number; turnX: number };
export type RigState = { x: number; z: number; yawDeg: number; turnArmed: boolean };

/**
 * Pure. The rig's new position and yaw after dtS seconds. `headYawDeg` is the world heading of the head
 * (0 looks down -z, 90 down +x, the convention of src/camera/pose.ts); the stick moves along it.
 * The move has a radial dead zone of 0.15. The snap turn fires once per push past 0.6 and re-arms below 0.3.
 * The yaw is a heading offset in degrees, clockwise from above, and is not wrapped.
 */
export function stepLocomotion(rig: RigState, headYawDeg: number, input: ThumbstickInput, dtS: number): RigState {
  let { x, z, yawDeg, turnArmed } = rig;
  const mag = Math.hypot(input.moveX, input.moveY);
  if (mag >= DEAD_ZONE && dtS > 0) {
    const k = Math.min(mag, 1) / mag;
    const fwd = input.moveY * k, side = input.moveX * k;
    const h = headYawDeg * DEG;
    const step = MOVE_SPEED_MPS * dtS;
    x += (fwd * Math.sin(h) + side * Math.cos(h)) * step;
    z += (-fwd * Math.cos(h) + side * Math.sin(h)) * step;
  }
  const t = Math.abs(input.turnX);
  if (turnArmed && t > TURN_FIRE) {
    yawDeg += Math.sign(input.turnX) * SNAP_TURN_DEG;
    turnArmed = false;
  } else if (!turnArmed && t < TURN_REARM) {
    turnArmed = true;
  }
  return { x, z, yawDeg, turnArmed };
}

/**
 * Rig position that keeps the head where it is while the rig turns to `newYawDeg`.
 * `headLocal` is the head's x, z relative to the rig, before the rig's turn; `headWorld` is where it must stay.
 */
export function rigPositionKeepingHead(headWorld: [number, number], headLocal: [number, number], newYawDeg: number): [number, number] {
  const th = -newYawDeg * DEG; // rig.rotation.y
  const c = Math.cos(th), s = Math.sin(th);
  return [headWorld[0] - (headLocal[0] * c + headLocal[1] * s), headWorld[1] - (-headLocal[0] * s + headLocal[1] * c)];
}

export type XrHead = { position: [number, number, number]; quaternion: [number, number, number, number] };
export type XrSessionHandle = {
  end(): Promise<void>;
  onEnd(fn: () => void): void;
  onSelect(fn: (head: XrHead) => void): void;
};

function stickOf(src: XRInputSource | undefined): { x: number; y: number } {
  const a = src?.gamepad?.axes;
  if (!a) return { x: 0, y: 0 };
  return a.length >= 4 ? { x: a[2] ?? 0, y: a[3] ?? 0 } : { x: a[0] ?? 0, y: a[1] ?? 0 };
}

/** Start an immersive VR session on the viewer's renderer, with the floor at y = 0. Rejects when the browser refuses. */
export async function startXr(viewer: Viewer): Promise<XrSessionHandle> {
  const xr = typeof navigator === "undefined" ? undefined : navigator.xr;
  if (!xr) throw new Error("This browser has no WebXR.");
  const session = await xr.requestSession("immersive-vr", { requiredFeatures: ["local-floor"] });
  const endFns: Array<() => void> = [];
  const selectFns: Array<(h: XrHead) => void> = [];
  viewer.beginXr();
  let rig: RigState = { x: viewer.xrRig.position.x, z: viewer.xrRig.position.z, yawDeg: -viewer.xrRig.rotation.y / DEG, turnArmed: true };
  const q = new THREE.Quaternion(), p = new THREE.Vector3(), fwd = new THREE.Vector3();
  const headWorld = (): XrHead => {
    viewer.camera.getWorldPosition(p);
    viewer.camera.getWorldQuaternion(q);
    return { position: [p.x, p.y, p.z], quaternion: [q.x, q.y, q.z, q.w] };
  };
  viewer.xrTick = (dt) => {
    let left: XRInputSource | undefined, right: XRInputSource | undefined;
    for (const s of session.inputSources) { if (s.handedness === "left") left = s; else if (s.handedness === "right") right = s; }
    const l = stickOf(left), r = stickOf(right);
    viewer.camera.getWorldPosition(p);
    viewer.camera.getWorldQuaternion(q);
    fwd.set(0, 0, -1).applyQuaternion(q);
    const headYaw = Math.atan2(fwd.x, -fwd.z) / DEG;
    const next = stepLocomotion(rig, headYaw, { moveX: l.x, moveY: -l.y, turnX: r.x }, dt);
    let { x, z } = next;
    if (next.yawDeg !== rig.yawDeg) {
      const lp = viewer.camera.position;
      [x, z] = rigPositionKeepingHead([p.x + (next.x - rig.x), p.z + (next.z - rig.z)], [lp.x, lp.z], next.yawDeg);
    }
    rig = { ...next, x, z };
    viewer.xrRig.position.set(rig.x, 0, rig.z);
    viewer.xrRig.rotation.y = -rig.yawDeg * DEG;
  };
  session.addEventListener("select", () => { const h = headWorld(); selectFns.forEach((f) => f(h)); });
  try {
    viewer.renderer.xr.enabled = true;
    viewer.renderer.xr.setReferenceSpaceType("local-floor");
    await viewer.renderer.xr.setSession(session);
  } catch (err) {
    viewer.xrTick = null;
    viewer.renderer.xr.enabled = false;
    viewer.endXr();
    try { await session.end(); } catch { /* already ended */ }
    throw err;
  }
  // registered after three's own end listener, so the renderer has put its size and loop back first
  session.addEventListener("end", () => {
    viewer.xrTick = null;
    viewer.renderer.xr.enabled = false;
    viewer.endXr();
    endFns.forEach((f) => f());
  });
  return {
    end: () => session.end(),
    onEnd: (fn) => { endFns.push(fn); },
    onSelect: (fn) => { selectFns.push(fn); },
  };
}
