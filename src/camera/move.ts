// Camera moves: a start pose, an end pose worked out from one amount, a duration and an ease (docs/spec.md decision 11).
// The lens never changes during a move. Heading and track directions follow src/camera/pose.ts:
// world heading 0 looks down -z and 90 looks down +x; the scene's front heading is added to the pose heading.
import { clampPitch, wrapHeading } from "./pose";
import type { CameraPose, Move } from "../model/types";

export const DEFAULT_DURATION_S = 4;
export const MIN_DURATION_S = 0.5;
export const MAX_DURATION_S = 60;
export const DEFAULT_EASE: NonNullable<Move["ease"]> = "ease-in-out";
/** The largest pan the short-way interpolation can follow. */
export const MAX_PAN_DEG = 179;

export type MoveKind = Move["kind"];
export type MoveSetting = { kind: MoveKind; amount: number; durationS: number; ease: NonNullable<Move["ease"]> };

const DEG = Math.PI / 180;

/** The amount a move kind starts with: metres, degrees, or none. */
export function defaultAmount(kind: MoveKind): number {
  if (kind === "push-in" || kind === "pull-out" || kind === "track") return 1;
  if (kind === "pan" || kind === "tilt") return 30;
  return 0;
}
export const hasAmount = (kind: MoveKind): boolean => defaultAmount(kind) !== 0;
export const amountIsAngle = (kind: MoveKind): boolean => kind === "pan" || kind === "tilt";
export const hasEndPose = (kind: MoveKind): boolean => hasAmount(kind);

export function easeValue(t: number, ease: NonNullable<Move["ease"]>): number {
  const x = Math.min(1, Math.max(0, t));
  return ease === "linear" ? x : x * x * (3 - 2 * x);
}

/** Signed angle from a to b the short way round, in -180 up to 180. */
export function shortDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

const worldYaw = (heading: number, front: number) => (heading + front) * DEG;

export function endPoseFor(kind: MoveKind, start: CameraPose, amount: number, frontHeadingDeg = 0): CameraPose | null {
  const [x, y, z] = start.positionM;
  const w = worldYaw(start.headingDeg, frontHeadingDeg);
  const fwd: [number, number] = [Math.sin(w), -Math.cos(w)];
  const right: [number, number] = [Math.cos(w), Math.sin(w)];
  const moved = (d: number, dir: [number, number]): CameraPose => ({ ...start, positionM: [x + dir[0] * d, y, z + dir[1] * d] });
  switch (kind) {
    case "push-in": return moved(amount, fwd);
    case "pull-out": return moved(amount, [-fwd[0], -fwd[1]]);
    case "track": return moved(amount, right);
    case "pan": return { ...start, positionM: [x, y, z], headingDeg: wrapHeading(start.headingDeg + amount) };
    case "tilt": return { ...start, positionM: [x, y, z], pitchDeg: clampPitch(start.pitchDeg + amount) };
    default: return null;
  }
}

export function interpolatePose(start: CameraPose, end: CameraPose, t: number, ease: NonNullable<Move["ease"]>): CameraPose {
  const e = easeValue(t, ease);
  const lerp = (a: number, b: number) => a + (b - a) * e;
  return {
    positionM: [lerp(start.positionM[0], end.positionM[0]), lerp(start.positionM[1], end.positionM[1]), lerp(start.positionM[2], end.positionM[2])],
    headingDeg: wrapHeading(start.headingDeg + shortDelta(start.headingDeg, end.headingDeg) * e),
    pitchDeg: lerp(start.pitchDeg, end.pitchDeg),
    rollDeg: lerp(start.rollDeg, end.rollDeg),
  };
}

export function buildMove(setting: MoveSetting, start: CameraPose, frontHeadingDeg = 0): Move {
  const { kind } = setting;
  if (kind === "static") return { kind, durationS: null, ease: null, endPose: null };
  if (kind === "handheld") return { kind, durationS: setting.durationS, ease: null, endPose: null };
  const endPose = endPoseFor(kind, start, setting.amount, frontHeadingDeg);
  return { kind, durationS: setting.durationS, ease: setting.ease, endPose };
}

export function moveDistanceM(start: CameraPose, end: CameraPose): number {
  return Math.hypot(end.positionM[0] - start.positionM[0], end.positionM[1] - start.positionM[1], end.positionM[2] - start.positionM[2]);
}

/** The larger of the heading and the pitch change, signed, the short way round. */
export function moveAngleDeg(start: CameraPose, end: CameraPose): number {
  const h = shortDelta(start.headingDeg, end.headingDeg);
  const p = end.pitchDeg - start.pitchDeg;
  return Math.abs(h) >= Math.abs(p) ? h : p;
}

/** The inverse of `buildMove`, for opening a saved shot. Fields a kind does not store come back as the defaults. */
export function settingFromMove(move: Move, start: CameraPose, frontHeadingDeg = 0): MoveSetting {
  const durationS = move.durationS ?? DEFAULT_DURATION_S;
  const ease = move.ease ?? DEFAULT_EASE;
  const end = move.endPose;
  if (!end || !hasEndPose(move.kind)) return { kind: move.kind, amount: defaultAmount(move.kind), durationS, ease };
  let amount: number;
  const dx = end.positionM[0] - start.positionM[0], dz = end.positionM[2] - start.positionM[2];
  const w = worldYaw(start.headingDeg, frontHeadingDeg);
  switch (move.kind) {
    case "push-in": amount = dx * Math.sin(w) - dz * Math.cos(w); break;
    case "pull-out": amount = -(dx * Math.sin(w) - dz * Math.cos(w)); break;
    case "track": amount = dx * Math.cos(w) + dz * Math.sin(w); break;
    case "pan": amount = shortDelta(start.headingDeg, end.headingDeg); break;
    default: amount = end.pitchDeg - start.pitchDeg; break;
  }
  return { kind: move.kind, amount, durationS, ease };
}

/** Distance text: one decimal at least ("1.2", "2.0"), two when they matter ("1.25"). */
const metres = (x: number): string => {
  const two = Math.abs(x).toFixed(2);
  return two.endsWith("0") ? two.slice(0, -1) : two;
};
const trim = (x: number): string => String(+Math.abs(x).toFixed(2));
const secondsText = (x: number): string => String(+x.toFixed(2));

/**
 * "static", "handheld over 4 s", "push-in 1.2 m over 4 s at 0.30 m/s, ease in and out",
 * "pan 30 degrees right over 4 s at 7.5 degrees per second, linear". With scaleConfirmed false, "m" reads "units"
 * and "m/s" reads "units/s". The front heading is needed to tell the side of a track.
 */
export function moveSentence(move: Move, start: CameraPose, scaleConfirmed: boolean, frontHeadingDeg = 0): string {
  if (move.kind === "static") return "static";
  const dur = move.durationS;
  const over = dur === null ? "" : ` over ${secondsText(dur)} s`;
  if (move.kind === "handheld") return `handheld${over}`;
  const ease = move.ease === null ? "" : move.ease === "linear" ? ", linear" : ", ease in and out";
  const end = move.endPose;
  if (!end) return `${move.kind}${over}${ease}`;
  const rate = (amount: number) => (dur && dur > 0 ? amount / dur : null);
  if (move.kind === "pan" || move.kind === "tilt") {
    const d = move.kind === "pan" ? shortDelta(start.headingDeg, end.headingDeg) : end.pitchDeg - start.pitchDeg;
    const side = move.kind === "pan" ? (d >= 0 ? "right" : "left") : d >= 0 ? "up" : "down";
    const r = rate(Math.abs(d));
    return `${move.kind} ${trim(d)} degrees ${side}${over}${r === null ? "" : ` at ${trim(r)} degrees per second`}${ease}`;
  }
  const unit = scaleConfirmed ? "m" : "units";
  const d = moveDistanceM(start, end);
  const side = move.kind === "track" ? ` ${settingFromMove(move, start, frontHeadingDeg).amount >= 0 ? "right" : "left"}` : "";
  const r = rate(d);
  return `${move.kind} ${metres(d)} ${unit}${side}${over}${r === null ? "" : ` at ${r.toFixed(2)} ${unit}/s`}${ease}`;
}

export const endFrameFileFor = (shotId: string): string => `frames/${shotId}-end.jpg`;
