// location-sheet.md: the fields previz knows, from the scene record. Light, materials, dressing and sound stay empty.
// No scene bytes: file names, sizes and the SHA-256 only.
import type { Scene, Shot } from "../model/types";
import { cell } from "./shotList";

const SOURCE_WORDS: Record<Scene["sourceKind"], string> = {
  text: "generated from text",
  photo: "generated from a photo",
  still: "generated from a still",
  video: "generated from video",
  other: "invented set",
};

const SCALE_WORDS: Record<Scene["scale"]["source"], string> = {
  marble: "from the Marble export",
  manual: "marked by hand against a known length",
  none: "not set",
};

export function locationSheetMarkdown(scene: Scene, shots: Shot[]): string {
  const f = scene.file;
  const files = [`${f.name} (${f.format}, ${f.bytes} bytes)`];
  if (scene.colliderFile) files.push(`${scene.colliderFile.name} (collider mesh, ${scene.colliderFile.bytes} bytes)`);
  const refs = [...new Set(shots.flatMap((s) => (s.referencePhoto ? [`${s.referencePhoto.file}, role: ${s.referencePhoto.role} (shot ${s.number})`] : [])))];
  const scale = scene.scale;
  const scaleLine = scale.confirmedAt
    ? `Scale ${SCALE_WORDS[scale.source]}${scale.reference ? `, ${scale.reference.label} ${scale.reference.knownLengthM} m` : ""}, confirmed ${scale.confirmedAt.slice(0, 10)}`
    : "Scale not confirmed: heights and distances in the shot list are unverified";
  const lines = [
    `# Location sheet: ${cell(scene.name)}`,
    "",
    "Exported from film-previz. Fields previz does not know are left empty.",
    "",
    "## Identity and geography",
    "",
    `- Name/id and scenes hosted: ${cell(scene.name)}, ${scene.id}`,
    `- Real, built, or invented; source/reference paths: ${SOURCE_WORDS[scene.sourceKind]}${scene.sourceNote ? `: ${cell(scene.sourceNote)}` : ""}; local files: ${files.map(cell).join("; ")}`,
    `- What the place contributes to the story:`,
    `- Floor plan with entrances, exits, action axis, and numbered cameras: not included in this export yet`,
    `- Background visible from each camera, including any necessary landmarks:`,
    `- Scene file SHA-256: ${f.sha256}`,
    `- ${scaleLine}`,
    "",
    "## Light and materials",
    "",
    `- Motivated sources, positions, colors, and intensity relationships: ${cell(scene.lightNote)}`,
    "- Time/weather and any intentional changes during the scene:",
    "- Palette and exposure choice, including what remains visible through windows:",
    "- Materials, maintenance, wear, repair, and areas deliberately kept plain:",
    "- Markings or readable text that matter; how correctness will be checked:",
    "",
    "## Persistent dressing",
    "",
    "| Object | Position | State by scene | Reference/prop sheet if needed |",
    "|---|---|---|---|",
    "| | | | |",
    "",
    "## Sound and references",
    "",
    "- Room tone, reverb, and exterior/interior sound relationship:",
    `- Spatial overview and reference views for needed camera positions: ${shots.length} previz ${shots.length === 1 ? "frame" : "frames"} in frames/`,
    `- Each reference's role and version: ${refs.length ? refs.map(cell).join("; ") : ""}`,
    "- Known generation failures to check:",
    "",
  ];
  return lines.join("\n");
}
