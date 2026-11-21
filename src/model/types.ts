// The data model, field for field from docs/spec.md section 4. This is the one definition:
// other modules import or re-export these types and do not declare their own copies.
// All lengths are metres in the scene's metric frame (y up) once scale is confirmed. All angles are degrees.

export type Scene = {
  /** "scene-<short hash>" */
  id: string;
  name: string;
  sourceKind: "text" | "photo" | "still" | "video" | "other";
  /** The prompt or a description of the photo; no client material. */
  sourceNote: string;
  /** Only when generated through the API. */
  marbleWorldId: string | null;
  file: { name: string; bytes: number; sha256: string; format: "spz" | "ply" };
  colliderFile: { name: string; bytes: number; sha256: string } | null;
  /** Marble worlds are OpenCV axes, converted on load. */
  importFrame: "opencv";
  scale: {
    source: "marble" | "manual" | "none";
    /** Multiplier from raw units to metres; 1 when source is "none". */
    metricScaleFactor: number;
    /** Subtract from y after scaling so the floor is y = 0. */
    groundPlaneOffsetM: number;
    reference: { label: string; knownLengthM: number; measuredRaw: number } | null;
    /** ISO time the user accepted the scale. */
    confirmedAt: string | null;
  };
  /** Direction treated as heading 0. */
  frontHeadingDeg: number;
  lightNote: string;
  markers: Marker[];
  createdAt: string;
};

export type Marker = { id: string; label: string; positionM: [number, number, number] };

export type Sensor = { id: string; label: string; widthMm: number; heightMm: number };

export type StandIn = {
  id: string;
  /** "Anna", "Cop 1" */
  label: string;
  /** Default 1.75. */
  heightM: number;
  /** Default 0.23, an assumption shown in the UI. */
  headHeightM: number;
  positionM: [number, number, number];
  headingDeg: number;
};

export type Move = {
  kind: "static" | "push-in" | "pull-out" | "pan" | "tilt" | "track" | "handheld";
  /** Null for static. */
  durationS: number | null;
  ease: "linear" | "ease-in-out" | null;
  /** Null for static. */
  endPose: CameraPose | null;
};

export type CameraPose = {
  positionM: [number, number, number];
  /** Clockwise from above, 0 = scene front. */
  headingDeg: number;
  /** Positive looks up. */
  pitchDeg: number;
  rollDeg: number;
};

export type Shot = {
  /** "shot-001" */
  id: string;
  number: number;
  sceneId: string;
  name: string;
  job: string;
  action: string;
  sizeLabel: "ECU" | "CU" | "MCU" | "MS" | "MWS" | "WS" | "EWS" | null;
  lens: {
    focalLengthMm: number;
    sensor: Sensor;
    /** Width / height, at least 1 in v1. */
    aspect: number;
    /** Derived, stored for readers of the JSON. */
    hfovDeg: number;
    vfovDeg: number;
  };
  pose: CameraPose;
  /** Derived from pose and ground offset. */
  heightAboveGroundM: number;
  /** False means heights and distances are in model units. */
  scaleConfirmed: boolean;
  move: Move;
  standIns: StandIn[];
  frame: { file: string; widthPx: number; heightPx: number };
  /** Name only, never the pixels. */
  referencePhoto: { file: string; role: string } | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type ScaleSource = Scene["scale"]["source"];
export type SceneScale = Scene["scale"];
export type ScaleReference = NonNullable<SceneScale["reference"]>;
export type SizeLabel = NonNullable<Shot["sizeLabel"]>;

export const SIZE_LABELS: readonly SizeLabel[] = ["ECU", "CU", "MCU", "MS", "MWS", "WS", "EWS"];
export const SCALE_SOURCES: readonly ScaleSource[] = ["marble", "manual", "none"];
export const SOURCE_KINDS: readonly Scene["sourceKind"][] = ["text", "photo", "still", "video", "other"];
export const MOVE_KINDS: readonly Move["kind"][] = ["static", "push-in", "pull-out", "pan", "tilt", "track", "handheld"];
export const EASES: readonly NonNullable<Move["ease"]>[] = ["linear", "ease-in-out"];
