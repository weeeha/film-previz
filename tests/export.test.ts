import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { validateShot } from "../src/model/schema";
import { SHOT_LIST_COLUMNS, cameraSentence, nearestMarker, headerLine, separatorLine, shotListMarkdown } from "../src/export/shotList";
import { locationSheetMarkdown } from "../src/export/locationSheet";
import { buildExportZip, exportZipName } from "../src/export/zip";
import { buildMove, moveSentence, endFrameFileFor, DEFAULT_DURATION_S } from "../src/camera/move";
import type { CameraPose } from "../src/model/types";
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

  it("camera_sentence_names_the_nearest_marker_and_the_distance", () => {
    const markers = [
      { id: "marker-1", label: "door", positionM: [1, 1, -4] as [number, number, number] },
      { id: "marker-2", label: "window", positionM: [-3, 1.2, 2] as [number, number, number] },
    ];
    const s = makeShot(scene.id, 1, { pose: { positionM: [1, 1.6, -1.5], headingDeg: 40, pitchDeg: 0, rollDeg: 0 } });
    const t = cameraSentence(s, { markers });
    expect(t).toContain(", 2.5 m from the door, ");
    expect(t).not.toContain("from the scene origin");
    expect(t).not.toContain("window");
    // the other marker is nearer from the other side of the room
    const w = makeShot(scene.id, 2, { pose: { positionM: [-2.5, 1.6, 1.5], headingDeg: 0, pitchDeg: 0, rollDeg: 0 } });
    expect(cameraSentence(w, { markers })).toContain(", 0.71 m from the window, ");
    // distance is on the floor: height does not count
    expect(nearestMarker([1, 9, -1.5], markers)?.distanceM).toBeCloseTo(2.5, 6);
    // no markers, or no confirmed scale: the origin wording stays
    expect(cameraSentence(s, { markers: [] })).toContain("from the scene origin");
    expect(cameraSentence(s)).toContain("from the scene origin");
    const unconfirmed = makeShot(scene.id, 3, { scaleConfirmed: false, heightAboveGroundM: 0.64, pose: { positionM: [1, 0.64, -1.5], headingDeg: 0, pitchDeg: 0, rollDeg: 0 } });
    const u = cameraSentence(unconfirmed, { markers });
    expect(u).toContain("from the scene origin");
    expect(u).not.toContain("door");
    // the table row carries it
    const sc = makeScene(undefined, { markers });
    expect(tableRows(shotListMarkdown(sc, [s]))[0]).toContain("2.5 m from the door");
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
    const md = locationSheetMarkdown(sc, shots, "included");
    for (const part of ["Test room", sc.id, "generated from text", "a small room", sc.file.name, "set-01-collider.glb"]) expect(md).toContain(part);
  });

  it("location_sheet_names_the_floor_plan_and_axis", () => {
    const line = (md: string) => md.split("\n").find((l) => l.includes("Floor plan with entrances"))!;
    expect(line(locationSheetMarkdown(scene, shots, "included"))).toContain("floor-plan.png, cameras numbered as in shot-list.md, action axis: not set");
    const axis = makeScene(undefined, { actionAxis: { label: "Anna to Ben", aM: [0, 0], bM: [1, 2] } });
    expect(line(locationSheetMarkdown(axis, shots, "included"))).toContain("action axis: Anna to Ben");
    expect(line(locationSheetMarkdown(scene, shots, "left-out"))).toContain("not included: scale not confirmed");
    expect(line(locationSheetMarkdown(scene, shots, "left-out"))).not.toContain("floor-plan.png");
  });
});

describe("zip", () => {
  const jpeg = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, n, 0, 1, 2, 3, 4]);
  it("holds the folder layout, one frame per shot and no scene bytes", () => {
    const zip = buildExportZip(scene, shots.map((shot, i) => ({ shot, bytes: jpeg(i) })), { kind: "left-out", reason: "scale-not-confirmed" });
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

  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const png = new Uint8Array([...PNG_SIGNATURE, 0, 0, 0, 13, 73, 72, 68, 82]);
  it("zip_holds_the_floor_plan", () => {
    const zip = buildExportZip(scene, shots.map((shot, i) => ({ shot, bytes: jpeg(i) })), { kind: "included", png });
    const files = unzipSync(zip);
    const entry = files["set-01-previz/floor-plan.png"];
    expect(entry).toBeDefined();
    expect(Array.from(entry!.subarray(0, 8))).toEqual(PNG_SIGNATURE);
    expect(strFromU8(files["set-01-previz/location-sheet.md"]!)).toContain("floor-plan.png, cameras numbered as in shot-list.md");
  });
  it("zip_without_scale_has_no_floor_plan", () => {
    const files = unzipSync(buildExportZip(scene, shots.map((shot, i) => ({ shot, bytes: jpeg(i) })), { kind: "left-out", reason: "scale-not-confirmed" }));
    expect(Object.keys(files).some((n) => n.endsWith("floor-plan.png"))).toBe(false);
    expect(strFromU8(files["set-01-previz/location-sheet.md"]!)).toContain("not included: scale not confirmed");
  });
});

describe("move sentence", () => {
  const start: CameraPose = { positionM: [0, 1.6, 0], headingDeg: 0, pitchDeg: 0, rollDeg: 0 };
  const mv = (kind: Parameters<typeof buildMove>[0]["kind"], amount: number, durationS = DEFAULT_DURATION_S, ease: "linear" | "ease-in-out" = "ease-in-out") =>
    buildMove({ kind, amount, durationS, ease }, start);

  it("push_in_sentence", () => {
    expect(moveSentence(mv("push-in", 1.2), start, true)).toBe("push-in 1.2 m over 4 s at 0.30 m/s, ease in and out");
  });

  it("speed_is_distance_over_duration", () => {
    const t = moveSentence(mv("push-in", 3), start, true);
    const speed = Number(/at ([\d.]+) m\/s/.exec(t)![1]);
    expect(speed).toBe(0.75);
    expect(Number(/at ([\d.]+) degrees per second/.exec(moveSentence(mv("pan", 30), start, true))![1])).toBe(7.5);
  });

  it("pan_sentence_names_the_side", () => {
    expect(moveSentence(mv("pan", 30, 4, "linear"), start, true)).toBe("pan 30 degrees right over 4 s at 7.5 degrees per second, linear");
    expect(moveSentence(mv("pan", -30, 4, "linear"), start, true)).toContain("pan 30 degrees left over 4 s");
    expect(moveSentence(mv("tilt", 10, 4, "linear"), start, true)).toBe("tilt 10 degrees up over 4 s at 2.5 degrees per second, linear");
    expect(moveSentence(mv("tilt", -10), start, true)).toContain("tilt 10 degrees down");
    expect(moveSentence(mv("track", 2, 4, "linear"), start, true)).toBe("track 2.0 m right over 4 s at 0.50 m/s, linear");
    expect(moveSentence(mv("track", -2, 4, "linear"), start, true)).toContain("track 2.0 m left over 4 s");
    expect(moveSentence(mv("pull-out", 1.25), start, true)).toContain("pull-out 1.25 m over 4 s");
  });

  it("static_sentence_is_static", () => {
    expect(moveSentence(mv("static", 0), start, true)).toBe("static");
    expect(moveSentence(mv("handheld", 0), start, true)).toBe("handheld over 4 s");
    const t = cameraSentence(makeShot(scene.id, 1));
    expect(t.endsWith(", static.")).toBe(true);
  });

  it("unconfirmed_scale_says_units", () => {
    expect(moveSentence(mv("push-in", 1.2), start, false)).toBe("push-in 1.2 units over 4 s at 0.30 units/s, ease in and out");
    expect(moveSentence(mv("pan", 30), start, false)).toContain("degrees per second");
  });

  it("the camera sentence ends with the move sentence", () => {
    const base = makeShot(scene.id, 1);
    const s = makeShot(scene.id, 1, { move: buildMove({ kind: "push-in", amount: 1.2, durationS: 4, ease: "ease-in-out" }, base.pose) });
    expect(cameraSentence(s).endsWith(", push-in 1.2 m over 4 s at 0.30 m/s, ease in and out.")).toBe(true);
    const row = tableRows(shotListMarkdown(scene, [s]))[0]!;
    expect(row).toContain("push-in 1.2 m over 4 s at 0.30 m/s, ease in and out");
  });

  const jpeg = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, n, 0, 1, 2, 3, 4]);
  it("zip_holds_the_end_frame", () => {
    const moved = makeShot(scene.id, 1, { move: mv("push-in", 1.2), endFrame: { file: endFrameFileFor("shot-001"), widthPx: 1920, heightPx: 1080 } });
    const still = makeShot(scene.id, 2);
    const files = unzipSync(buildExportZip(scene, [{ shot: moved, bytes: jpeg(1), endBytes: jpeg(2) }, { shot: still, bytes: jpeg(3) }], { kind: "left-out", reason: "scale-not-confirmed" }));
    const end = files["set-01-previz/frames/shot-001-end.jpg"];
    expect(end).toBeDefined();
    expect(Array.from(end!)).toEqual(Array.from(jpeg(2)));
    const records = JSON.parse(strFromU8(files["set-01-previz/shots.json"]!)) as Array<{ endFrame?: { file: string } }>;
    expect(records[0]!.endFrame?.file).toBe("frames/shot-001-end.jpg");
    expect(validateShot(records[0])).toEqual({ ok: true });
  });

  it("static_shot_has_one_frame", () => {
    const files = unzipSync(buildExportZip(scene, shots.map((shot, i) => ({ shot, bytes: jpeg(i) })), { kind: "left-out", reason: "scale-not-confirmed" }));
    expect(Object.keys(files).filter((n) => n.includes("/frames/"))).toHaveLength(3);
    expect(Object.keys(files).some((n) => n.endsWith("-end.jpg"))).toBe(false);
  });
});
