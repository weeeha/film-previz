// shot-list.md: the 12 columns of film-craft's shot list template, filled from the saved shots (docs/spec.md section 3).
import { moveSentence } from "../camera/move";
import { heightText } from "../model/shotRecord";
import type { Marker, Scene, Shot, SizeLabel } from "../model/types";

/** In the order of film-craft's `templates/shot-list.md`. The header test reads the template and compares. */
export const SHOT_LIST_COLUMNS = [
  "#",
  "Job",
  "Size",
  "Camera position and motivated move/static",
  "Decisive action",
  "Dialogue/audio",
  "Generation duration + handles",
  "Intended edit duration",
  "Light/continuity",
  "References and roles",
  "Stopping rule",
  "Review/selection state",
] as const;

export const REVIEW_STATE = "Previz frame saved; not generated; not reviewed";
export const REFERENCE_ROLE = "camera position, lens and geometry; not identity";
export const HEIGHTS_UNVERIFIED = "height unverified";

export const headerLine = (): string => `| ${SHOT_LIST_COLUMNS.join(" | ")} |`;
export const separatorLine = (): string => `|${SHOT_LIST_COLUMNS.map(() => "---").join("|")}|`;

const SIZE_WORDS: Record<SizeLabel, string> = {
  ECU: "Extreme close-up",
  CU: "Close-up",
  MCU: "Medium close-up",
  MS: "Medium shot",
  MWS: "Medium wide shot",
  WS: "Wide shot",
  EWS: "Extreme wide shot",
};

const num = (x: number): string => String(+x.toFixed(2));

/** Table cells are one line, and a pipe would split the cell. */
export const cell = (text: string): string => text.replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");

/**
 * The camera sentence for one shot, for example
 * "Medium shot, 35 mm lens on a full frame sensor 36 mm wide, camera at 1.6 m, at x 0, z 3 from the scene origin, heading 40 degrees, static."
 * With confirmed scale and at least one marker on the scene, the position part names the nearest marker and the
 * distance to it on the floor ("2.5 m from the door"). Otherwise it gives x and z from the scene origin.
 */
export function cameraSentence(s: Shot, scene?: Pick<Scene, "markers"> & Partial<Pick<Scene, "frontHeadingDeg">>): string {
  const parts: string[] = [];
  if (s.sizeLabel) parts.push(SIZE_WORDS[s.sizeLabel]);
  parts.push(`${num(s.lens.focalLengthMm)} mm lens on a ${s.lens.sensor.label.toLowerCase()} sensor ${num(s.lens.sensor.widthMm)} mm wide`);
  parts.push(s.scaleConfirmed ? `camera at ${heightText(s)}` : `camera ${HEIGHTS_UNVERIFIED}`);
  parts.push(positionPart(s, scene?.markers ?? []));
  parts.push(`heading ${num(s.pose.headingDeg)} degrees`);
  parts.push(moveSentence(s.move, s.pose, s.scaleConfirmed, scene?.frontHeadingDeg ?? 0));
  const sentence = parts.join(", ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + ".";
}

/** The marker closest to the camera on the floor plane (x and z), and that distance in metres. */
export function nearestMarker(pos: [number, number, number], markers: Marker[]): { marker: Marker; distanceM: number } | null {
  let best: { marker: Marker; distanceM: number } | null = null;
  for (const m of markers) {
    const d = Math.hypot(pos[0] - m.positionM[0], pos[2] - m.positionM[2]);
    if (!best || d < best.distanceM) best = { marker: m, distanceM: d };
  }
  return best;
}

/** Where the camera stands. Distances are metres once the scale is confirmed, otherwise model units. */
function positionPart(s: Shot, markers: Marker[]): string {
  const near = s.scaleConfirmed ? nearestMarker(s.pose.positionM, markers.filter((m) => m.label.trim())) : null;
  if (near) return `${num(near.distanceM)} m from the ${near.marker.label.trim()}`;
  const [x, , z] = s.pose.positionM;
  const unit = s.scaleConfirmed ? "" : " units";
  return `at x ${num(x)}${unit}, z ${num(z)}${unit} from the scene origin`;
}

const day = (iso: string): string => iso.slice(0, 10);

export function shotListRow(s: Shot, scene: Scene): string {
  const refs = `${s.frame.file}, role: ${REFERENCE_ROLE}; ${scene.name}, ${day(s.updatedAt)}`;
  const cells = [
    String(s.number),
    s.job,
    s.sizeLabel ?? "",
    cameraSentence(s, scene),
    s.action,
    "",
    "",
    "",
    scene.lightNote,
    refs,
    "",
    REVIEW_STATE,
  ];
  return `| ${cells.map(cell).join(" | ")} |`;
}

export function shotListMarkdown(scene: Scene, shots: Shot[]): string {
  const ordered = [...shots].sort((a, b) => a.number - b.number);
  const unverified = ordered.filter((s) => !s.scaleConfirmed).length;
  const lines = [
    `# Shot list: ${cell(scene.name)}`,
    "",
    "Exported from film-previz. Rows paste under the header of a film's shot list. Empty cells are left for the filmmaker.",
  ];
  if (unverified) lines.push("", `Heights unverified: ${unverified} of ${ordered.length} shots were saved before the scale was confirmed, so their camera heights and positions are in model units.`);
  lines.push("", headerLine(), separatorLine(), ...ordered.map((s) => shotListRow(s, scene)), "");
  return lines.join("\n");
}
