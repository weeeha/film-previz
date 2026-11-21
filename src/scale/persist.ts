import type { SceneScale } from "./scale";

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** What is kept per scene file. `figureXZ` is where the 1.75 m reference figure stood (not part of the spec record). */
export type StoredScale = { scale: SceneScale; figureXZ: [number, number] | null };

export const scaleKey = (hash: string): string => `film-previz.scale.${hash}`;

/** SHA-256 of the file's bytes as lower-case hex. */
export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Persistence is these two functions only. Task 16 swaps the body for IndexedDB.
export function saveScale(hash: string, rec: StoredScale, storage: StorageLike = localStorage): void {
  try { storage.setItem(scaleKey(hash), JSON.stringify(rec)); } catch (e) { console.warn("could not save the scale", e); }
}

export function loadScale(hash: string, storage: StorageLike = localStorage): StoredScale | null {
  try {
    const raw = storage.getItem(scaleKey(hash));
    if (!raw) return null;
    const v = JSON.parse(raw) as StoredScale;
    const s = v?.scale;
    const ok = s && (s.source === "marble" || s.source === "manual" || s.source === "none")
      && typeof s.metricScaleFactor === "number" && s.metricScaleFactor > 0
      && typeof s.groundPlaneOffsetM === "number";
    if (!ok) return null;
    const f = v.figureXZ;
    return { scale: s, figureXZ: Array.isArray(f) && f.length === 2 && f.every((n) => typeof n === "number") ? [f[0]!, f[1]!] : null };
  } catch { return null; }
}
