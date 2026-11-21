import { appStore, type Store } from "../model/store";
import type { SceneScale } from "./scale";

/** What is kept per scene file. `figureXZ` is where the 1.75 m reference figure stood (not part of the spec record). */
export type StoredScale = { scale: SceneScale; figureXZ: [number, number] | null };

/** SHA-256 of the file's bytes as lower-case hex. */
export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Persistence is these two functions only. The scale lives on the scene record in IndexedDB.
// The scene record for the file must exist (the Scenes route creates it when the file is opened).
export async function saveScale(hash: string, rec: StoredScale, store?: Store): Promise<void> {
  const s = store ?? await appStore();
  const scene = await s.getSceneByHash(hash);
  if (!scene) throw new Error("There is no scene record for this file, so the scale was not saved.");
  await s.saveScene({ ...scene, scale: rec.scale });
  await s.setFigure(scene.id, rec.figureXZ);
}

export async function loadScale(hash: string, store?: Store): Promise<StoredScale | null> {
  try {
    const s = store ?? await appStore();
    const scene = await s.getSceneByHash(hash);
    if (!scene) return null;
    return { scale: scene.scale, figureXZ: await s.getFigure(scene.id) };
  } catch (e) {
    console.warn("could not read the saved scale", e);
    return null;
  }
}
