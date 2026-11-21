// Hand-written validators for the spec section 4 records. They return a list of error strings.
import { lensFov } from "../camera/lens";
import { EASES, MOVE_KINDS, SCALE_SOURCES, SIZE_LABELS, SOURCE_KINDS } from "./types";

export type Validation = { ok: true } | { ok: false; errors: string[] };

const FOV_TOLERANCE_DEG = 0.01;
const FRAME_TOLERANCE_PX = 1;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isIso = (v: unknown): boolean => isStr(v) && v.length > 0 && !Number.isNaN(Date.parse(v));

class Errors {
  list: string[] = [];
  add(path: string, msg: string): void { this.list.push(`${path}: ${msg}`); }
  num(path: string, v: unknown, min?: number): v is number {
    if (!isNum(v)) { this.add(path, "must be a finite number"); return false; }
    if (min !== undefined && v < min) { this.add(path, `must be at least ${min}`); return false; }
    return true;
  }
  str(path: string, v: unknown): v is string {
    if (!isStr(v)) { this.add(path, "must be a string"); return false; }
    return true;
  }
  oneOf<T extends string>(path: string, v: unknown, set: readonly T[]): v is T {
    if (!isStr(v) || !set.includes(v as T)) { this.add(path, `must be one of ${set.join(", ")}`); return false; }
    return true;
  }
  vec3(path: string, v: unknown): void {
    if (!Array.isArray(v) || v.length !== 3 || !v.every(isNum)) this.add(path, "must be three finite numbers");
  }
  iso(path: string, v: unknown): void {
    if (!isIso(v)) this.add(path, "must be an ISO date string");
  }
  rec(path: string, v: unknown): v is Rec {
    if (!isRec(v)) { this.add(path, "must be an object"); return false; }
    return true;
  }
  done(): Validation { return this.list.length ? { ok: false, errors: this.list } : { ok: true }; }
}

function pose(e: Errors, path: string, v: unknown): void {
  if (!e.rec(path, v)) return;
  e.vec3(`${path}.positionM`, v.positionM);
  e.num(`${path}.headingDeg`, v.headingDeg);
  e.num(`${path}.pitchDeg`, v.pitchDeg);
  e.num(`${path}.rollDeg`, v.rollDeg);
}

function sensor(e: Errors, path: string, v: unknown): v is { id: string; label: string; widthMm: number; heightMm: number } {
  if (!e.rec(path, v)) return false;
  const a = e.str(`${path}.id`, v.id);
  const b = e.str(`${path}.label`, v.label);
  const c = e.num(`${path}.widthMm`, v.widthMm, Number.MIN_VALUE);
  const d = e.num(`${path}.heightMm`, v.heightMm, Number.MIN_VALUE);
  return a && b && c && d;
}

export const SHOT_ID = /^shot-\d{3,}$/;
export const SCENE_ID = /^scene-[0-9a-f]{6,64}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export function validateShot(v: unknown): Validation {
  const e = new Errors();
  if (!e.rec("shot", v)) return e.done();
  if (!isStr(v.id) || !SHOT_ID.test(v.id)) e.add("id", 'must look like "shot-001"');
  if (e.num("number", v.number, 1) && !Number.isInteger(v.number)) e.add("number", "must be a whole number");
  if (!isStr(v.sceneId) || !SCENE_ID.test(v.sceneId)) e.add("sceneId", 'must look like "scene-<hash>"');
  for (const k of ["name", "job", "action", "notes"] as const) e.str(k, v[k]);
  if (v.sizeLabel !== null) e.oneOf("sizeLabel", v.sizeLabel, SIZE_LABELS);

  // Lens, with the derived field of view checked against the formula.
  if (e.rec("lens", v.lens)) {
    const l = v.lens;
    const fOk = e.num("lens.focalLengthMm", l.focalLengthMm, Number.MIN_VALUE);
    const sOk = sensor(e, "lens.sensor", l.sensor);
    const aOk = e.num("lens.aspect", l.aspect, 1);
    const hOk = e.num("lens.hfovDeg", l.hfovDeg);
    const vOk = e.num("lens.vfovDeg", l.vfovDeg);
    if (fOk && sOk && aOk && hOk && vOk) {
      const exp = lensFov(l.focalLengthMm as number, l.sensor as never, l.aspect as number);
      if (Math.abs(exp.hfovDeg - (l.hfovDeg as number)) > FOV_TOLERANCE_DEG) e.add("lens.hfovDeg", `is ${l.hfovDeg} but the lens gives ${exp.hfovDeg.toFixed(4)}`);
      if (Math.abs(exp.vfovDeg - (l.vfovDeg as number)) > FOV_TOLERANCE_DEG) e.add("lens.vfovDeg", `is ${l.vfovDeg} but the lens gives ${exp.vfovDeg.toFixed(4)}`);
    }
  }

  pose(e, "pose", v.pose);
  e.num("heightAboveGroundM", v.heightAboveGroundM);
  if (typeof v.scaleConfirmed !== "boolean") e.add("scaleConfirmed", "must be true or false");

  if (e.rec("move", v.move)) {
    const m = v.move;
    e.oneOf("move.kind", m.kind, MOVE_KINDS);
    if (m.durationS !== null) e.num("move.durationS", m.durationS, 0);
    if (m.ease !== null) e.oneOf("move.ease", m.ease, EASES);
    if (m.endPose !== null) pose(e, "move.endPose", m.endPose);
  }

  if (!Array.isArray(v.standIns)) e.add("standIns", "must be a list");
  else v.standIns.forEach((s, i) => {
    const p = `standIns[${i}]`;
    if (!e.rec(p, s)) return;
    e.str(`${p}.id`, s.id); e.str(`${p}.label`, s.label);
    e.num(`${p}.heightM`, s.heightM, Number.MIN_VALUE);
    e.num(`${p}.headHeightM`, s.headHeightM, Number.MIN_VALUE);
    e.vec3(`${p}.positionM`, s.positionM);
    e.num(`${p}.headingDeg`, s.headingDeg);
  });

  if (e.rec("frame", v.frame)) {
    const f = v.frame;
    e.str("frame.file", f.file);
    const w = e.num("frame.widthPx", f.widthPx, 1);
    const h = e.num("frame.heightPx", f.heightPx, 1);
    const aspect = isRec(v.lens) ? v.lens.aspect : undefined;
    if (w && h && isNum(aspect) && aspect >= 1) {
      const expH = (f.widthPx as number) / aspect;
      if (Math.abs(expH - (f.heightPx as number)) > FRAME_TOLERANCE_PX) e.add("frame.heightPx", `is ${f.heightPx} but ${f.widthPx} px wide at aspect ${aspect} gives ${expH.toFixed(1)}`);
    }
  }

  if (v.endFrame !== undefined && v.endFrame !== null && e.rec("endFrame", v.endFrame)) {
    e.str("endFrame.file", v.endFrame.file);
    e.num("endFrame.widthPx", v.endFrame.widthPx, 1);
    e.num("endFrame.heightPx", v.endFrame.heightPx, 1);
  }

  if (v.referencePhoto !== null) {
    if (e.rec("referencePhoto", v.referencePhoto)) {
      e.str("referencePhoto.file", v.referencePhoto.file);
      e.str("referencePhoto.role", v.referencePhoto.role);
    }
  }
  e.iso("createdAt", v.createdAt);
  e.iso("updatedAt", v.updatedAt);
  return e.done();
}

function fileRef(e: Errors, path: string, v: unknown, withFormat: boolean): void {
  if (!e.rec(path, v)) return;
  e.str(`${path}.name`, v.name);
  e.num(`${path}.bytes`, v.bytes, 0);
  if (!isStr(v.sha256) || !SHA256.test(v.sha256)) e.add(`${path}.sha256`, "must be 64 lower-case hex characters");
  if (withFormat) e.oneOf(`${path}.format`, v.format, ["spz", "ply"] as const);
}

export function validateScene(v: unknown): Validation {
  const e = new Errors();
  if (!e.rec("scene", v)) return e.done();
  if (!isStr(v.id) || !SCENE_ID.test(v.id)) e.add("id", 'must look like "scene-<hash>"');
  e.str("name", v.name);
  e.oneOf("sourceKind", v.sourceKind, SOURCE_KINDS);
  e.str("sourceNote", v.sourceNote);
  if (v.marbleWorldId !== null) e.str("marbleWorldId", v.marbleWorldId);
  fileRef(e, "file", v.file, true);
  if (v.colliderFile !== null) fileRef(e, "colliderFile", v.colliderFile, false);
  if (v.importFrame !== "opencv") e.add("importFrame", 'must be "opencv"');

  if (e.rec("scale", v.scale)) {
    const s = v.scale;
    e.oneOf("scale.source", s.source, SCALE_SOURCES);
    e.num("scale.metricScaleFactor", s.metricScaleFactor, Number.MIN_VALUE);
    e.num("scale.groundPlaneOffsetM", s.groundPlaneOffsetM);
    if (s.reference !== null && e.rec("scale.reference", s.reference)) {
      e.str("scale.reference.label", s.reference.label);
      e.num("scale.reference.knownLengthM", s.reference.knownLengthM, Number.MIN_VALUE);
      e.num("scale.reference.measuredRaw", s.reference.measuredRaw, Number.MIN_VALUE);
    }
    if (s.confirmedAt !== null) e.iso("scale.confirmedAt", s.confirmedAt);
  }
  e.num("frontHeadingDeg", v.frontHeadingDeg);
  e.str("lightNote", v.lightNote);
  if (!Array.isArray(v.markers)) e.add("markers", "must be a list");
  else v.markers.forEach((m, i) => {
    const p = `markers[${i}]`;
    if (!e.rec(p, m)) return;
    e.str(`${p}.id`, m.id); e.str(`${p}.label`, m.label); e.vec3(`${p}.positionM`, m.positionM);
  });
  if (v.actionAxis !== undefined && v.actionAxis !== null && e.rec("actionAxis", v.actionAxis)) {
    const a = v.actionAxis;
    e.str("actionAxis.label", a.label);
    for (const k of ["aM", "bM"] as const) {
      if (!Array.isArray(a[k]) || a[k].length !== 2 || !a[k].every(isNum)) e.add(`actionAxis.${k}`, "must be two finite numbers (x and z)");
    }
  }
  e.iso("createdAt", v.createdAt);
  return e.done();
}
