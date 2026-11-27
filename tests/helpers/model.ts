import { lensFov } from "../../src/camera/lens";
import { sceneIdForHash } from "../../src/model/store";
import type { Scene, Shot } from "../../src/model/types";

export const HASH_A = "a".repeat(63) + "1";
export const HASH_B = "b".repeat(63) + "2";

export function makeScene(sha256 = HASH_A, over: Partial<Scene> = {}): Scene {
  return {
    id: sceneIdForHash(sha256),
    name: "Set 01",
    sourceKind: "other",
    sourceNote: "",
    marbleWorldId: null,
    file: { name: "set-01-2m.spz", bytes: 1234, sha256, format: "spz" },
    colliderFile: null,
    importFrame: "opencv",
    scale: { source: "none", metricScaleFactor: 1, groundPlaneOffsetM: 0, reference: null, confirmedAt: null },
    frontHeadingDeg: 0,
    lightNote: "",
    markers: [],
    createdAt: "2026-11-21T10:00:00.000Z",
    ...over,
  };
}

export function makeShot(sceneId: string, number = 1, over: Partial<Shot> = {}): Shot {
  const sensor = { id: "full-frame", label: "Full frame", widthMm: 36, heightMm: 24 };
  const aspect = 16 / 9;
  const fov = lensFov(35, sensor, aspect);
  const id = `shot-${String(number).padStart(3, "0")}`;
  return {
    id, number, sceneId,
    name: `Shot ${number}`, job: "Show the door", action: "She walks in", sizeLabel: "MS",
    lens: { focalLengthMm: 35, sensor, aspect, hfovDeg: fov.hfovDeg, vfovDeg: fov.vfovDeg },
    pose: { positionM: [0, 1.6, 3], headingDeg: 10, pitchDeg: -2, rollDeg: 0 },
    heightAboveGroundM: 1.6, scaleConfirmed: true,
    move: { kind: "static", durationS: null, ease: null, endPose: null },
    standIns: [{ id: "si-1", label: "Anna", heightM: 1.75, headHeightM: 0.23, positionM: [0, 0, 0], headingDeg: 180 }],
    frame: { file: `${id}.jpg`, widthPx: 1920, heightPx: 1080 },
    referencePhoto: null, notes: "", createdAt: "2026-11-21T10:05:00.000Z", updatedAt: "2026-11-21T10:05:00.000Z",
    ...over,
  };
}
