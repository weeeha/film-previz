import * as THREE from "three";
import { HELPER_LAYER, type Viewer } from "../viewer/scene";
import type { ScalePanel } from "./scalePanel";
import type { ScaleStore } from "../scale/store";
import { heightPresetsState } from "../scale/scale";
import type { Marker } from "../model/types";
import { el, labelled } from "./dom";

const MARKER_RADIUS_M = 0.06;
const CLICK_SLOP_PX = 4;

export type Markers = {
  root: HTMLElement;
  /** The markers of the scene that is open, or none. Positions are read through the content scale that is in place now. */
  setScene(markers: Marker[] | null): void;
  /** Stop waiting for a click, for example when the route changes. */
  cancel(): void;
  /** Call after the collider or the scale changed, so the button can switch on or off. */
  refresh(): void;
  list(): Marker[];
};

/**
 * Named points on the collider, for "2.5 m from the door" in the shot list. A marker is picked the same way a scale
 * mark is (Viewer.pickCollider through the walk camera) and drawn with the same helper-layer spheres. Metres need a
 * confirmed scale, so the tool is off until then. The raw (content-local) point is kept in memory so a later change
 * of scale moves the metric position with the room.
 */
export function createMarkers(viewer: Viewer, panel: ScalePanel, scale: ScaleStore, onChange: (markers: Marker[]) => void): Markers {
  type Item = { id: string; label: string; local: THREE.Vector3 };
  let items: Item[] = [];
  let pending: THREE.Vector3 | null = null;
  let waiting = false;

  const group = new THREE.Group();
  group.layers.set(HELPER_LAYER);
  viewer.content.add(group);
  const mat = new THREE.MeshBasicMaterial({ color: 0x00c8ff, depthTest: false, transparent: true });
  const geo = new THREE.SphereGeometry(1, 12, 8);

  // ----- DOM, with the draft's components: panel title, meta, field, outlined buttons, notice -----
  const addBtn = el("button", { className: "btn", type: "button", id: "marker-add" }, "Add marker");
  const msg = el("p", { className: "meta", id: "marker-msg" });
  msg.setAttribute("aria-live", "polite");
  const nameIn = el("input", { type: "text", id: "marker-name", placeholder: "door, window, bed" });
  const saveBtn = el("button", { className: "btn", type: "button", id: "marker-save" }, "Save marker");
  const cancelBtn = el("button", { className: "btn", type: "button", id: "marker-cancel" }, "Cancel");
  const form = el("form", { className: "fields", id: "marker-form", hidden: true },
    labelled("Marker name", nameIn),
    el("div", { className: "next-row" }, saveBtn, cancelBtn),
  );
  const listEl = el("ul", { className: "marker-list", id: "marker-list" });
  const intro = el("p", { className: "meta" }, "Name a spot on the room, such as a door, a window or a bed. The shot list says how far the camera is from the nearest marker.");
  intro.style.maxWidth = "68ch";
  const root = el("section", { className: "scale-block", id: "markers" },
    el("h2", { id: "h-markers" }, "Markers"),
    intro,
    el("div", { className: "next-row" }, addBtn, msg),
    form,
    listEl,
  );

  root.setAttribute("aria-labelledby", "h-markers");

  const fmt = (n: number) => n.toFixed(2);
  const metric = (it: Item): [number, number, number] => {
    const w = viewer.content.localToWorld(it.local.clone());
    return [w.x, w.y, w.z];
  };
  const records = (): Marker[] => items.map((it) => ({ id: it.id, label: it.label, positionM: metric(it) }));

  function redraw3d(): void {
    group.clear();
    for (const it of items) {
      const m = new THREE.Mesh(geo, mat);
      m.layers.set(HELPER_LAYER);
      m.renderOrder = 11;
      m.position.copy(it.local);
      m.scale.setScalar(MARKER_RADIUS_M / viewer.content.scale.x);
      group.add(m);
    }
  }

  function paintList(): void {
    if (!items.length) {
      listEl.replaceChildren(el("li", { className: "meta" }, "No markers yet."));
      return;
    }
    listEl.replaceChildren(...items.map((it) => {
      const [x, y, z] = metric(it);
      const rm = el("button", { className: "btn", type: "button" }, "Remove");
      rm.setAttribute("aria-label", `Remove marker ${it.label}`);
      rm.addEventListener("click", () => { items = items.filter((o) => o.id !== it.id); changed(); });
      const row = el("li", { className: "marker-row" },
        el("span", { className: "trunc", title: it.label }, it.label),
        el("span", { className: "meta mono" }, `x ${fmt(x)}, y ${fmt(y)}, z ${fmt(z)} m`),
        rm,
      );
      row.dataset.markerId = it.id;
      return row;
    }));
  }

  function paintEnabled(): void {
    const ok = heightPresetsState(scale.get()).enabled;
    const hasCollider = viewer.hasCollider;
    addBtn.disabled = !ok || !hasCollider || waiting || pending !== null;
    if (waiting || pending) return;
    if (!hasCollider) msg.textContent = "Markers need the collider mesh. Choose a collider GLB first.";
    else if (!ok) msg.textContent = "Confirm the scale first, so a marker has a position in metres.";
    else if (msg.dataset.note) msg.textContent = msg.dataset.note;
    else msg.textContent = "";
  }
  const say = (t: string) => { msg.dataset.note = t; msg.textContent = t; };

  function changed(): void {
    redraw3d();
    paintList();
    onChange(records());
  }

  function endPlacing(): void {
    waiting = false;
    pending = null;
    form.hidden = true;
    nameIn.value = "";
    panel.suspendPicking(false);
    paintEnabled();
  }

  // ----- picking: the same raycast as the scale marks -----
  const dom = viewer.renderer.domElement;
  let down: { x: number; y: number } | null = null;
  const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
  const onUp = (e: PointerEvent) => {
    const d = down; down = null;
    if (!waiting || !d) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP_PX) return; // a drag is looking around
    const p = viewer.pickCollider(e.clientX, e.clientY);
    if (!p) { msg.textContent = "No surface under that click. Click on the room surfaces."; return; }
    waiting = false;
    pending = p;
    const w = viewer.content.localToWorld(p.clone());
    msg.textContent = `Point picked at x ${fmt(w.x)}, y ${fmt(w.y)}, z ${fmt(w.z)} m. Name it.`;
    delete msg.dataset.note;
    form.hidden = false;
    addBtn.disabled = true;
    nameIn.focus();
  };
  dom.addEventListener("pointerdown", onDown);
  dom.addEventListener("pointerup", onUp);

  addBtn.addEventListener("click", () => {
    waiting = true;
    pending = null;
    delete msg.dataset.note;
    panel.suspendPicking(true);
    addBtn.disabled = true;
    msg.textContent = "Click the spot in the preview. Drag to look around first if you need to.";
  });

  function commit(): void {
    const name = nameIn.value.trim();
    if (!pending) return;
    if (!name) { msg.textContent = "Type a name for the marker, such as door."; nameIn.focus(); return; }
    const n = 1 + Math.max(0, ...items.map((i) => Number(/(\d+)$/.exec(i.id)?.[1] ?? 0)));
    items.push({ id: `marker-${n}`, label: name, local: pending });
    endPlacing();
    say(`Added ${name}.`);
    changed();
  }
  form.addEventListener("submit", (e) => { e.preventDefault(); commit(); });
  saveBtn.addEventListener("click", commit);
  cancelBtn.addEventListener("click", () => { endPlacing(); });

  scale.subscribe(paintEnabled);
  // A new scale changes what a raw point is in metres: keep the points where they are in the room and write the new metres.
  panel.onApplied(() => { if (items.length) changed(); else paintEnabled(); });

  paintList();
  paintEnabled();

  return {
    root,
    list: records,
    refresh: paintEnabled,
    cancel() { if (waiting || pending) endPlacing(); },
    setScene(markers) {
      if (waiting || pending) endPlacing();
      delete msg.dataset.note;
      items = (markers ?? []).map((m) => ({ id: m.id, label: m.label, local: viewer.content.worldToLocal(new THREE.Vector3(...m.positionM)) }));
      redraw3d();
      paintList();
      paintEnabled();
    },
  };
}
