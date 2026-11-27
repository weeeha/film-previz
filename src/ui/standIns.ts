import type { Viewer } from "../viewer/scene";
import { HELPER_LAYER } from "../viewer/scene";
import { StandInFigures } from "../viewer/standIns";
import type { ShotState } from "../camera/shotState";
import { wrapHeading } from "../camera/pose";
import { standInReadout, freeStandInSpot, MIN_HEIGHT_M, MAX_HEIGHT_M, type StandInSet, type FrameReadout } from "../model/standIns";
import type { StandIn } from "../model/types";
import type { Session } from "../model/session";
import { el, labelled, fmt, isFocused } from "./dom";

const AHEAD_M = 3;
const DEG = Math.PI / 180;

export const NO_SCALE_LINE = "Confirm the scale to add stand-ins. Their heights are in metres.";
export const ASSUMPTION_LINE = "Head height of 0.23 m is an assumption. Use these readouts to check face size against the shot size.";
export const NO_AXIS_LINE = "Add two stand-ins to set the action axis.";
export const EMPTY_LINE = "No stand-ins on this scene. Add one to check how large a person is in the frame.";

type Refs = {
  s: StandIn;
  open: HTMLButtonElement;
  pct: HTMLElement;
  info: HTMLElement;
  head: HTMLElement;
  fields?: { name: HTMLInputElement; height: HTMLInputElement; headH: HTMLInputElement; facing: HTMLInputElement; x: HTMLInputElement; z: HTMLInputElement };
};

const m1 = (n: number) => n.toFixed(1);

function readoutText(r: FrameReadout): { pct: string; head: string; note: string } {
  if (r.state === "behind-camera") return { pct: "Behind the camera", head: "", note: "" };
  if (r.state === "out-of-frame") return { pct: "Out of frame", head: "", note: "" };
  const pct = `${m1(r.heightPct!)}% of frame height`;
  const head = `Head ${m1(r.headPct!)}%`;
  return { pct, head, note: r.state === "partly-out" ? ", partly out of frame" : "" };
}

/** The Stand-ins section of the Stage inspector: the list, the editor of one open row, and the figures in the viewport. */
export function createStandInsPanel(
  viewer: Viewer, shot: ShotState, set: StandInSet, scaleConfirmed: () => boolean, session?: Session,
): { root: HTMLDetailsElement; selectedId(): string | null; refresh(): void; dispose(): void } {
  const figures = new StandInFigures(viewer.scene, HELPER_LAYER);
  let selected: string | null = null;
  let structKey = "";
  let refs = new Map<string, Refs>();

  const count = el("span", { className: "hint", id: "standin-count" });
  const list = el("div", { className: "rows", id: "standin-list" });
  const assumption = el("p", { className: "hint", id: "standin-assumption" }, ASSUMPTION_LINE);
  const empty = el("div", { className: "rows", id: "standin-empty" }, el("p", { className: "meta" }, EMPTY_LINE));
  const addBtn = el("button", { className: "btn", type: "button", id: "standin-add" }, "Add stand-in");
  addBtn.style.justifySelf = "start";
  const noScale = el("p", { className: "hint", id: "standin-noscale" }, NO_SCALE_LINE);
  // ----- action axis: a line between two stand-ins, stored on the scene -----
  const axisSelA = el("select", { id: "axis-a" });
  const axisSelB = el("select", { id: "axis-b" });
  axisSelA.setAttribute("aria-label", "Action axis, first stand-in");
  axisSelB.setAttribute("aria-label", "Action axis, second stand-in");
  const axisSet = el("button", { className: "btn", type: "button", id: "axis-set" }, "Set action axis");
  const axisClear = el("button", { className: "btn", type: "button", id: "axis-clear" }, "Clear");
  const axisLine = el("span", { className: "meta", id: "axis-line" });
  const axisNone = el("p", { className: "hint", id: "axis-none" }, NO_AXIS_LINE);
  const axisState = el("div", { className: "row", id: "axis-state" }, axisLine, axisClear);
  axisState.style.cssText = "display:flex;gap:var(--s3);align-items:center;justify-content:space-between";
  const axisPick = el("div", { className: "fields two", id: "axis-pick" }, axisSelA, axisSelB);
  const axis = el("div", { className: "rows", id: "axis" }, axisNone, axisPick, axisSet, axisState);
  axisSet.style.justifySelf = "start";
  let axisKey = "";

  const root = el("details", { className: "insp", id: "standins", open: true },
    el("summary", {}, el("h2", { id: "h-stand" }, "Stand-ins"), count),
    el("div", { className: "insp-body" }, list, empty, addBtn, noScale, axis),
  );
  root.setAttribute("aria-labelledby", "h-stand");

  const numField = (id: string, step: string, min?: string, max?: string) => {
    const i = el("input", { type: "number", id, step });
    if (min) i.min = min;
    if (max) i.max = max;
    return i;
  };

  function buildRow(s: StandIn): Refs {
    const open = el("button", { className: "standin-open", type: "button" }, s.label);
    open.dataset.standInId = s.id;
    open.setAttribute("aria-expanded", String(s.id === selected));
    const pct = el("span", { className: "r pct" });
    const info = el("span", { className: "hint" });
    const head = el("span", { className: "hint r pct-head" });
    head.style.textAlign = "right";
    const row = el("div", { className: "standin" }, el("b", {}, open), pct, info, head);
    row.dataset.standInId = s.id;
    const r: Refs = { s, open, pct, info, head };
    if (s.id === selected) {
      row.setAttribute("aria-current", "true");
      const f = {
        name: el("input", { type: "text", id: "si-name" }),
        height: numField("si-height", "0.01", String(MIN_HEIGHT_M), String(MAX_HEIGHT_M)),
        headH: numField("si-head", "0.01", "0.05"),
        facing: numField("si-facing", "1", "0", "359"),
        x: numField("si-x", "0.05"),
        z: numField("si-z", "0.05"),
      };
      r.fields = f;
      const remove = el("button", { className: "btn", type: "button", id: "si-remove" }, "Remove");
      remove.style.justifySelf = "start";
      const edit = el("div", { className: "standin-edit" },
        el("div", { className: "fields two" }, labelled("Name", f.name), labelled("Height, m", f.height), labelled("Head height, m", f.headH), labelled("Facing, degrees", f.facing)),
        el("div", { className: "fields two" }, labelled("X", f.x), labelled("Z", f.z)),
        remove,
      );
      row.append(edit);
      const num = (input: HTMLInputElement, fn: (v: number) => void) => input.addEventListener("input", () => {
        if (input.value.trim() !== "" && Number.isFinite(Number(input.value))) fn(Number(input.value));
      });
      const pos = (patch: { x?: number; z?: number }): [number, number, number] => {
        const [x, y, z] = set.list().find((q) => q.id === s.id)?.positionM ?? s.positionM;
        return [patch.x ?? x, y, patch.z ?? z];
      };
      f.name.addEventListener("input", () => { const v = f.name.value.trim(); if (v) set.update(s.id, { label: v }); });
      num(f.height, (v) => set.update(s.id, { heightM: v }));
      num(f.headH, (v) => set.update(s.id, { headHeightM: v }));
      num(f.facing, (v) => set.update(s.id, { headingDeg: wrapHeading(v) }));
      num(f.x, (v) => set.update(s.id, { positionM: pos({ x: v }) }));
      num(f.z, (v) => set.update(s.id, { positionM: pos({ z: v }) }));
      for (const i of Object.values(f)) i.addEventListener("blur", paint);
      remove.addEventListener("click", () => { set.remove(s.id); });
    }
    open.addEventListener("click", () => { selected = selected === s.id ? null : s.id; paint(); });
    list.append(row);
    return r;
  }

  function paintAxis(items: StandIn[]): void {
    const two = items.length >= 2 && session !== undefined;
    axis.hidden = session === undefined;
    axisNone.hidden = two;
    axisPick.hidden = !two;
    axisSet.hidden = !two;
    const key = items.map((s) => `${s.id}:${s.label}`).join("|");
    if (two && key !== axisKey) {
      axisKey = key;
      const a = axisSelA.value, b = axisSelB.value;
      for (const [sel, keep, fallback] of [[axisSelA, a, 0], [axisSelB, b, 1]] as const) {
        sel.replaceChildren(...items.map((s) => el("option", { value: s.id }, s.label)));
        sel.value = items.some((s) => s.id === keep) ? keep : items[Math.min(fallback, items.length - 1)]!.id;
      }
    }
    axisSet.disabled = !two || axisSelA.value === axisSelB.value;
    const a = session?.scene()?.actionAxis ?? null;
    axisState.hidden = a === null;
    axisLine.textContent = a ? `Action axis: ${a.label}` : "";
  }

  async function saveAxis(actionAxis: NonNullable<ReturnType<Session["scene"]>>["actionAxis"]): Promise<void> {
    const scene = session?.scene();
    if (!session || !scene) return;
    // Read the record again: the session copy can be older than a scale confirmed since it was loaded, and saving it would undo that.
    const db = await session.store();
    const fresh = (await db.getScene(scene.id)) ?? scene;
    await db.saveScene({ ...fresh, actionAxis });
    await session.refresh();
  }
  axisSet.addEventListener("click", () => {
    const items = set.list();
    const a = items.find((s) => s.id === axisSelA.value), b = items.find((s) => s.id === axisSelB.value);
    if (!a || !b || a.id === b.id) return;
    void saveAxis({ label: `${a.label} to ${b.label}`, aM: [a.positionM[0], a.positionM[2]], bM: [b.positionM[0], b.positionM[2]] }).catch(console.error);
  });
  axisClear.addEventListener("click", () => { void saveAxis(null).catch(console.error); });
  axisSelA.addEventListener("change", () => paintAxis(set.list()));
  axisSelB.addEventListener("change", () => paintAxis(set.list()));

  function paint(): void {
    const items = set.list();
    if (selected && !items.some((s) => s.id === selected)) selected = null;
    const key = items.map((s) => s.id).join(",") + "|" + (selected ?? "");
    if (key !== structKey) {
      structKey = key;
      list.replaceChildren();
      refs = new Map(items.map((s) => [s.id, buildRow(s)]));
      list.append(assumption);
    }
    const ok = scaleConfirmed();
    addBtn.disabled = !ok;
    noScale.hidden = ok;
    list.hidden = items.length === 0;
    empty.hidden = items.length > 0;
    count.textContent = items.length ? `${items.length} on this scene` : "None yet";
    for (const s of items) {
      const r = refs.get(s.id)!;
      r.s = s;
      const rd = standInReadout(s, shot.pose, shot.lens, shot.frontHeadingDeg());
      const out = readoutText(rd);
      r.open.textContent = s.label;
      r.pct.textContent = out.pct;
      r.info.textContent = `${fmt(s.heightM, 2, true)} m tall, ${m1(rd.distanceM)} m away${out.note}`;
      r.head.textContent = out.head;
      r.head.hidden = out.head === "";
      const f = r.fields;
      if (f) {
        const set1 = (i: HTMLInputElement, v: string) => { if (!isFocused(i)) i.value = v; };
        set1(f.name, s.label);
        set1(f.height, fmt(s.heightM, 2));
        set1(f.headH, fmt(s.headHeightM, 2));
        set1(f.facing, fmt(s.headingDeg, 0));
        set1(f.x, fmt(s.positionM[0], 2));
        set1(f.z, fmt(s.positionM[2], 2));
      }
    }
    figures.sync(items, selected, shot.frontHeadingDeg());
    paintAxis(items);
  }

  function add(): void {
    if (!scaleConfirmed()) return;
    const p = shot.pose;
    const world = (p.headingDeg + shot.frontHeadingDeg()) * DEG;
    const [x, z] = freeStandInSpot(
      set.list(), [p.positionM[0] + AHEAD_M * Math.sin(world), p.positionM[2] - AHEAD_M * Math.cos(world)], p.headingDeg + shot.frontHeadingDeg(),
    );
    const y = viewer.floorHeightAt(x, z, p.positionM[1]);
    const s = set.add([x, y, z], wrapHeading(p.headingDeg + 180)); // faces the camera
    selected = s.id;
    paint();
  }
  addBtn.addEventListener("click", add);

  // ----- pointer: press on a figure selects it and drags it over the floor -----
  const canvas = viewer.renderer.domElement;
  const figureAt = (e: PointerEvent): string | null => (root.isConnected ? figures.idAt(viewer.raycasterAt(e.clientX, e.clientY)) : null);
  let drag: { id: string; dx: number; dz: number; pointerId: number } | null = null;
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const id = figureAt(e);
    if (!id) return;
    selected = id;
    const s = set.list().find((q) => q.id === id)!;
    const floor = viewer.pickFloor(e.clientX, e.clientY);
    drag = { id, dx: floor ? s.positionM[0] - floor.x : 0, dz: floor ? s.positionM[2] - floor.z : 0, pointerId: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
    paint();
  };
  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const floor = viewer.pickFloor(e.clientX, e.clientY);
    if (floor) set.update(drag.id, { positionM: [floor.x + drag.dx, floor.y, floor.z + drag.dz] });
  };
  const onUp = (e: PointerEvent) => { if (drag && e.pointerId === drag.pointerId) drag = null; };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  viewer.walk.ignorePress = (e) => figureAt(e) !== null;

  const offSet = set.subscribe(paint);
  const offShot = shot.subscribe(paint);
  const offSession = session?.subscribe(paint);
  paint();

  return {
    root,
    selectedId: () => selected,
    refresh: paint,
    dispose() {
      offSet(); offShot(); offSession?.();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      viewer.walk.ignorePress = null;
      figures.dispose();
    },
  };
}
