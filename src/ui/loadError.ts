// Small pure helpers for the Scenes view: which files it accepts and how a failed load is described.

export type SceneFileKind = "splat" | "collider" | "unsupported";

/** The scene input takes SPZ and PLY. A GLB is a collider mesh. Anything else is unsupported. */
export function fileKind(name: string): SceneFileKind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "spz" || ext === "ply") return "splat";
  if (ext === "glb") return "collider";
  return "unsupported";
}

export const formatOf = (name: string): "spz" | "ply" => (name.toLowerCase().endsWith(".ply") ? "ply" : "spz");

/**
 * A failed splat load is "toolarge" when the browser reports that it ran out of memory (a RangeError from an
 * allocation, or a message that says so). Everything else is "parse": the file could not be read as that format.
 */
export function classifyLoadError(err: unknown): "toolarge" | "parse" {
  if (err instanceof RangeError) return "toolarge";
  const msg = err instanceof Error ? err.message : String(err);
  return /out of memory|allocation failed|array buffer allocation|invalid array length|too large/i.test(msg) ? "toolarge" : "parse";
}

export const megabytes = (bytes: number): string => `${(bytes / 1e6).toFixed(bytes < 1e5 ? 2 : 1)} MB`;

/** Collider meshes are small: kilobytes below one megabyte. */
export function sizeText(bytes: number): string {
  return bytes < 1e6 ? `${(bytes / 1e3).toFixed(1)} KB` : megabytes(bytes);
}
