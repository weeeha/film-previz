// Sensor presets and the option lists the Stage view offers. Pure data.

import type { Sensor } from "../model/types";
export type { Sensor };

export const SENSORS: Sensor[] = [
  { id: "full-frame", label: "Full frame", widthMm: 36, heightMm: 24 },
  // 24.89 x 18.66 mm is the Super 35 film gate figure, unverified against a maker's sheet.
  { id: "super-35", label: "Super 35", widthMm: 24.89, heightMm: 18.66 },
  // Placeholder size; the user edits it. Starts equal to full frame.
  { id: "custom", label: "Custom", widthMm: 36, heightMm: 24 },
];

export const LENSES_MM: number[] = [14, 18, 24, 28, 35, 50, 85, 100, 135];

export type AspectOption = { id: string; label: string; value: number };

export const ASPECTS: AspectOption[] = [
  { id: "16:9", label: "16:9", value: 16 / 9 },
  { id: "1.85:1", label: "1.85:1", value: 1.85 },
  { id: "2.39:1", label: "2.39:1", value: 2.39 },
  { id: "3:2", label: "3:2", value: 3 / 2 },
  { id: "4:3", label: "4:3", value: 4 / 3 },
  { id: "1:1", label: "1:1", value: 1 },
];

export type HeightPreset = { id: string; label: string; metres: number };

export const HEIGHT_PRESETS: HeightPreset[] = [
  { id: "low", label: "Low", metres: 0.3 },
  { id: "hip", label: "Hip", metres: 1.0 },
  { id: "eye", label: "Eye", metres: 1.6 },
  { id: "high", label: "High", metres: 2.5 },
];
