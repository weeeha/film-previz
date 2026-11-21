// Building a Shot record from what the Stage holds, and the small derived values the strip and the Shots table show.
import { lensFov } from "../camera/lens";
import { ASPECTS, HEIGHT_PRESETS, type Sensor } from "../camera/sensors";
import type { CameraPose, Move, Shot, SizeLabel, StandIn } from "./types";

export type ShotDetails = { name: string; sizeLabel: SizeLabel | null; job: string; action: string; notes: string };

export const FRAME_FILE_DIR = "frames/";
export const frameFileFor = (shotId: string): string => `${FRAME_FILE_DIR}${shotId}.jpg`;

export type ShotCapture = {
  id: string;
  number: number;
  sceneId: string;
  lens: { focalMm: number; sensor: Sensor; aspect: number };
  pose: CameraPose;
  /** The move as set on the Stage, its end pose already worked out. Copied into the record. */
  move: Move;
  /** The stand-ins on the Stage now. Copied into the record. */
  standIns: StandIn[];
  scaleConfirmed: boolean;
  frame: { widthPx: number; heightPx: number };
  referencePhoto: { file: string; role: string } | null;
  details: ShotDetails;
  /** Present when an existing shot is updated: its creation time is kept. */
  previous?: Shot;
  now?: string;
};

/**
 * A shot record, ready for `validateShot`. The height above ground is the pose's y: the scene content is shifted
 * by the ground offset when the scale is applied, so the floor is y = 0 in the scene's own frame. Without a
 * confirmed scale that y is in model units and `scaleConfirmed` is false.
 */
export function buildShot(c: ShotCapture): Shot {
  const now = c.now ?? new Date().toISOString();
  const fov = lensFov(c.lens.focalMm, c.lens.sensor, c.lens.aspect);
  return {
    id: c.id,
    number: c.number,
    sceneId: c.sceneId,
    name: c.details.name,
    job: c.details.job,
    action: c.details.action,
    sizeLabel: c.details.sizeLabel,
    lens: {
      focalLengthMm: c.lens.focalMm,
      sensor: { id: c.lens.sensor.id, label: c.lens.sensor.label, widthMm: c.lens.sensor.widthMm, heightMm: c.lens.sensor.heightMm },
      aspect: c.lens.aspect,
      hfovDeg: fov.hfovDeg,
      vfovDeg: fov.vfovDeg,
    },
    pose: { positionM: [...c.pose.positionM], headingDeg: c.pose.headingDeg, pitchDeg: c.pose.pitchDeg, rollDeg: c.pose.rollDeg },
    heightAboveGroundM: c.pose.positionM[1],
    scaleConfirmed: c.scaleConfirmed,
    move: structuredClone(c.move),
    standIns: structuredClone(c.standIns),
    frame: { file: frameFileFor(c.id), widthPx: c.frame.widthPx, heightPx: c.frame.heightPx },
    referencePhoto: c.referencePhoto ? { ...c.referencePhoto } : null,
    notes: c.details.notes,
    createdAt: c.previous?.createdAt ?? now,
    updatedAt: now,
  };
}

/** The aspect option closest to a stored ratio. */
export function aspectIdFor(aspect: number): string {
  let best = ASPECTS[0]!;
  for (const a of ASPECTS) if (Math.abs(a.value - aspect) < Math.abs(best.value - aspect)) best = a;
  return best.id;
}

const num = (x: number) => String(+x.toFixed(2));
export const lensLabel = (s: Shot): string => `${num(s.lens.focalLengthMm)} mm`;
export const sensorLabel = (s: Shot): string => `${s.lens.sensor.label}, ${aspectIdFor(s.lens.aspect)}`;

/** "1.6 m" with a confirmed scale, "0.64 units" without. */
export function heightText(s: Shot): string {
  if (!s.scaleConfirmed) return `${s.heightAboveGroundM.toFixed(2)} units`;
  const two = s.heightAboveGroundM.toFixed(2);
  return `${two.endsWith("0") ? two.slice(0, -1) : two} m`;
}

/** The strip's second line: "50 mm, eye 1.6 m" or "50 mm, 0.64 units, unverified". */
export function stripLine(s: Shot): string {
  if (!s.scaleConfirmed) return `${lensLabel(s)}, ${heightText(s)}, unverified`;
  const p = HEIGHT_PRESETS.find((h) => Math.abs(h.metres - s.heightAboveGroundM) < 0.005);
  return `${lensLabel(s)}, ${p ? p.label.toLowerCase() : "height"} ${heightText(s)}`;
}

export const shotTitle = (s: Shot): string => `${s.number} ${s.name || "Untitled"}`;
