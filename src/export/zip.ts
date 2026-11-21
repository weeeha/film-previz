// The export folder as one zip (docs/spec.md section 3). Pure: records and frame bytes in, zip bytes out.
import { zipSync } from "fflate";
import { frameFileFor } from "../model/shotRecord";
import type { Scene, Shot } from "../model/types";
import { FLOOR_PLAN_FILE } from "./floorPlan";
import { locationSheetMarkdown } from "./locationSheet";
import { shotListMarkdown } from "./shotList";

export const slugify = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "scene";
export const exportFolderName = (scene: Pick<Scene, "name">): string => `${slugify(scene.name)}-previz`;
export const exportZipName = (scene: Pick<Scene, "name">): string => `${exportFolderName(scene)}.zip`;

export type ExportFrame = { shot: Shot; bytes: Uint8Array };

/** Name, SHA-256 and scale source only. The scene's own bytes and its collider's never go in. */
export function sceneRefJson(scene: Scene): string {
  return JSON.stringify({ name: scene.name, fileName: scene.file.name, sha256: scene.file.sha256, scaleSource: scene.scale.source }, null, 2) + "\n";
}

/** `shots.json`: the full records, in shot order, with the frame path every record already carries. */
export function shotsJson(shots: Shot[]): string {
  return JSON.stringify([...shots].sort((a, b) => a.number - b.number), null, 2) + "\n";
}

/** The floor plan is left out, with a reason, when the scale is not confirmed. */
export type FloorPlanState = { kind: "included"; png: Uint8Array } | { kind: "left-out"; reason: "scale-not-confirmed" };

export function buildExportZip(scene: Scene, frames: ExportFrame[], floorPlan: FloorPlanState): Uint8Array {
  const shots = frames.map((f) => f.shot);
  const folder = exportFolderName(scene);
  const enc = new TextEncoder();
  const files: Record<string, Uint8Array> = {
    [`${folder}/shots.json`]: enc.encode(shotsJson(shots)),
    [`${folder}/shot-list.md`]: enc.encode(shotListMarkdown(scene, shots)),
    [`${folder}/location-sheet.md`]: enc.encode(locationSheetMarkdown(scene, shots, floorPlan.kind)),
    [`${folder}/scene-ref.json`]: enc.encode(sceneRefJson(scene)),
  };
  // JPEG and PNG data are already compressed: store them as is (level 0).
  const stored: Record<string, [Uint8Array, { level: 0 }]> = {};
  if (floorPlan.kind === "included") stored[`${folder}/${FLOOR_PLAN_FILE}`] = [floorPlan.png, { level: 0 }];
  for (const f of frames) stored[`${folder}/${frameFileFor(f.shot.id)}`] = [f.bytes, { level: 0 }];
  return zipSync({ ...files, ...stored }, { level: 6 });
}
