import type * as THREE from "three";
import { HEIGHT_PRESETS, type HeightPreset } from "../camera/sensors";

import type { ScaleSource, ScaleReference, SceneScale } from "../model/types";
export type { ScaleSource, ScaleReference, SceneScale };

export function noScale(): SceneScale {
  return { source: "none", metricScaleFactor: 1, groundPlaneOffsetM: 0, reference: null, confirmedAt: null };
}

export function manualScale(factor: number, groundOffsetM: number, reference: ScaleReference | null, confirmedAt: string): SceneScale {
  return { source: "manual", metricScaleFactor: factor, groundPlaneOffsetM: groundOffsetM, reference, confirmedAt };
}

/** Factor from a marked raw distance and the length the user says it is. */
export function scaleFromReference(measuredRaw: number, knownM: number): number {
  if (!Number.isFinite(measuredRaw) || measuredRaw <= 0) throw new Error("The marked distance must be greater than zero. Mark two different points.");
  if (!Number.isFinite(knownM) || knownM <= 0) throw new Error("The known length must be a number greater than zero.");
  return knownM / measuredRaw;
}

/**
 * Marble's own scale. A null factor, or exactly 1.0, means the scale was not inferred (World Labs schema),
 * so the source is "none" and the user marks a known distance instead.
 */
export function fromMarbleMetadata(meta: { metric_scale_factor: number | null; ground_plane_offset: number | null }): { factor: number; groundOffsetM: number; source: "marble" | "none" } {
  const f = meta.metric_scale_factor;
  if (f === null || !Number.isFinite(f) || f <= 0 || f === 1) return { factor: 1, groundOffsetM: 0, source: "none" };
  return { factor: f, groundOffsetM: meta.ground_plane_offset ?? 0, source: "marble" };
}

/**
 * Scale the content group (splat and collider) by the factor and shift it down by the ground offset,
 * so the floor sits at y = 0. Sets absolute values: calling it twice does not compound.
 */
export function applyScale(content: THREE.Group, factor: number, groundOffsetM: number): void {
  content.scale.setScalar(factor);
  content.position.y = -groundOffsetM;
  content.updateMatrixWorld(true);
}

export type HeightPresetsState = {
  enabled: boolean;
  /** Why the presets are off, or null when they are on. */
  reason: string | null;
  presets: Array<HeightPreset & { enabled: boolean }>;
};

export const PRESETS_OFF_REASON = "Confirm the scale to use height presets. Until then heights are in model units and unverified.";

export function heightPresetsState(scale: SceneScale): HeightPresetsState {
  const enabled = scale.source !== "none" && scale.confirmedAt !== null;
  return {
    enabled,
    reason: enabled ? null : PRESETS_OFF_REASON,
    presets: HEIGHT_PRESETS.map((p) => ({ ...p, enabled })),
  };
}
