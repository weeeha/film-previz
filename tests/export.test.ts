import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { validateShot } from "../src/model/schema";
import { SHOT_LIST_COLUMNS, cameraSentence, headerLine, separatorLine, shotListMarkdown } from "../src/export/shotList";
import { locationSheetMarkdown } from "../src/export/locationSheet";
import { buildExportZip, exportZipName } from "../src/export/zip";
import { makeScene, makeShot } from "./helpers/model";

const TEMPLATE = process.env.FILM_CRAFT_SHOT_LIST;
const scene = makeScene();
const shots = [1, 2, 3].map((n) => makeShot(scene.id, n));
const tableRows = (md: string) => md.split("\n").filter((l) => /^\| \d+ \|/.test(l));
const cells = (line: string) => line.replace(/^\| /, "").replace(/ \|$/, "").split(/(?<!\\) \| /);

describe("shot list", () => {
  it.skipIf(!TEMPLATE)(`shot_list_header_matches_film_craft${TEMPLATE ? "" : " (skipped: set FILM_CRAFT_SHOT_LIST to the path of film-craft templates/shot-list.md)"}`, () => {
    const text = fs.readFileSync(TEMPLATE!, "utf8").split("\n");
    const i = text.findIndex((l) => l.startsWith("| # |"));
    expect(i, "no table header in the template").toBeGreaterThanOrEqual(0);
    expect(headerLine()).toBe(text[i]);
    expect(separatorLine()).toBe(text[i + 1]);
    expect(shotListMarkdown(scene, shots).split("\n")).toContain(text[i]);
  });

  it("has the 12 columns of the spec mapping, in order", () => {
    expect(SHOT_LIST_COLUMNS).toHaveLength(12);
    expect(SHOT_LIST_COLUMNS[0]).toBe("#");
    expect(SHOT_LIST_COLUMNS[11]).toBe("Review/selection state");
  });

  it("row_count_equals_shot_count", () => {
    const md = shotListMarkdown(scene, shots);
    expect(tableRows(md)).toHaveLength(3);
    for (const r of tableRows(md)) expect(cells(r)).toHaveLength(12);
    expect(tableRows(shotListMarkdown(scene, shots.slice(0, 1)))).toHaveLength(1);
  });

  it("camera_sentence", () => {
    const s = makeShot(scene.id, 1, { pose: { positionM: [0, 1.6, 3], headingDeg: 40, pitchDeg: 0, rollDeg: 0 } });
    const t = cameraSentence(s);
    for (const part of ["35 mm", "36 mm", "1.6 m", "static", "full frame", "heading 40"]) expect(t).toContain(part);
    expect(t.startsWith("Medium shot, ")).toBe(true);
    expect(t.endsWith(".")).toBe(true);
  });

  it("unconfirmed_scale_marks_heights", () => {
    const s = makeShot(scene.id, 1, { scaleConfirmed: false, heightAboveGroundM: 0.64 });
    const md = shotListMarkdown(scene, [s]);
    expect(cameraSentence(s)).toContain("height unverified");
    expect(cameraSentence(s)).not.toMatch(/\d m\b/);
    expect(tableRows(md)[0]).toContain("height unverified");
    expect(md).toContain("Heights unverified: 1 of 1");
  });

  it("fills job, size, action, light note and the fixed cells", () => {
    const sc = makeScene(undefined, { lightNote: "Overcast through the window" });
    const row = cells(tableRows(shotListMarkdown(sc, [makeShot(sc.id, 1, { job: "a | b", action: "Opens\nthe door" })]))[0]!);
    expect(row[0]).toBe("1");
    expect(row[1]).toBe("a \\| b");
    expect(row[2]).toBe("MS");
    expect(row[4]).toBe("Opens the door");
    expect([row[5], row[6], row[7], row[10]]).toEqual(["", "", "", ""]);
    expect(row[8]).toBe("Overcast through the window");
    expect(row[9]).toContain("shot-001.jpg");
    expect(row[9]).toContain("not identity");
    expect(row[11]).toBe("Previz frame saved; not generated; not reviewed");
  });
});

describe("location sheet", () => {
  it("location_sheet_fields", () => {
    const sc = makeScene(undefined, { name: "Test room", sourceKind: "text", sourceNote: "a small room", colliderFile: { name: "set-01-collider.glb", bytes: 99, sha256: "c".repeat(64) } });
    const md = locationSheetMarkdown(sc, shots);
    for (const part of ["Test room", sc.id, "generated from text", "a small room", sc.file.name, "set-01-collider.glb"]) expect(md).toContain(part);
  });
});

describe("zip", () => {
  const jpeg = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, n, 0, 1, 2, 3, 4]);
  it("holds the folder layout, one frame per shot and no scene bytes", () => {
    const zip = buildExportZip(scene, shots.map((shot, i) => ({ shot, bytes: jpeg(i) })));
    const files = unzipSync(zip);
    const names = Object.keys(files).sort();
    expect(names).toEqual([
      "set-01-previz/frames/shot-001.jpg", "set-01-previz/frames/shot-002.jpg", "set-01-previz/frames/shot-003.jpg",
      "set-01-previz/location-sheet.md", "set-01-previz/scene-ref.json", "set-01-previz/shot-list.md", "set-01-previz/shots.json",
    ]);
    expect(exportZipName(scene)).toBe("set-01-previz.zip");
    const records = JSON.parse(strFromU8(files["set-01-previz/shots.json"]!)) as unknown[];
    expect(records).toHaveLength(3);
    for (const r of records) expect(validateShot(r)).toEqual({ ok: true });
    expect(JSON.parse(strFromU8(files["set-01-previz/scene-ref.json"]!))).toEqual({ name: "Set 01", fileName: scene.file.name, sha256: scene.file.sha256, scaleSource: "none" });
  });
});
