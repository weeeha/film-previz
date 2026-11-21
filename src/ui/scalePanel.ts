import * as THREE from "three";
import { HELPER_LAYER, type Viewer } from "../viewer/scene";
import { scaleFromReference, manualScale, noScale, type SceneScale } from "../scale/scale";
import { sceneScale, type ScaleStore } from "../scale/store";
import { loadScale, saveScale } from "../scale/persist";

export const FIGURE_HEIGHT_M = 1.75;
const MARKER_RADIUS_M = 0.04;
const CLICK_SLOP_PX = 4;

type Mode = "idle" | "marking" | "measuring";

export type ScalePanel = {
  root: HTMLElement;
  /** Call when a scene file is opened: pass its SHA-256, or null when no scene is open. Restores a stored scale. */
  /** Resolves once any saved scale for the file has been read and applied. */
  setScene(hash: string | null): Promise<void>;
  /** Call after the collider or the scene changed, so the panel can enable or disable marking. */
  refresh(): void;
  dispose(): void;
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
}

function field(label: string, input: HTMLElement): HTMLLabelElement {
  const l = el("label", { className: "field" }, label);
  l.appendChild(input);
  return l;
}

function readout(label: string, id: string): { wrap: HTMLElement; dd: HTMLElement } {
  const dd = el("dd", { id });
  return { wrap: el("div", {}, el("dt", {}, label), dd), dd };
}

/** The scale form from the approved draft (Scenes view), self-contained so a later task can move it. */
export function createScalePanel(viewer: Viewer, store: ScaleStore = sceneScale): ScalePanel {
  let mode: Mode = "idle";
  let hash: string | null = null;
  let marks: THREE.Vector3[] = []; // content-local (raw) points of the two marked points
  let measurePicks: THREE.Vector3[] = [];
  let figure: THREE.Mesh | null = null;
  let figureXZ: [number, number] | null = null;

  const markers = new THREE.Group();
  markers.layers.set(HELPER_LAYER);
  viewer.content.add(markers);
  const markerMat = new THREE.MeshBasicMaterial({ color: 0xff00ff, depthTest: false, transparent: true });
  const markerGeo = new THREE.SphereGeometry(1, 12, 8);
  const figureMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });

  // ----- DOM, following draft/index.html -----
  const badge = el("span", { className: "badge warn", id: "scale-badge" }, "Not confirmed");
  const head = el("div", { className: "scale-head" }, el("h2", { id: "h-scale" }, "Scale"), badge);
  const intro = el("p", { className: "meta" }, "A splat has no real-world size. Mark a known distance, such as a door, and type its length. Heights and distances on the Stage are in metres only after this step.");
  intro.style.maxWidth = "68ch";

  const label = el("input", { type: "text", id: "scale-label", value: "door" });
  const known = el("input", { type: "number", id: "scale-known", value: "2.00", step: "0.01", min: "0.01" });
  const source = el("select", { id: "scale-source" });
  const optMarble = el("option", { disabled: true }, "Marble scale (none in this file)");
  const optManual = el("option", { selected: true }, "Manual, two marked points");
  source.append(optMarble, optManual);
  const form = el("form", { className: "fields three" }, field("Known object", label), field("Known length, m", known), field("Source", source));
  form.setAttribute("aria-label", "Scale from a known object");
  form.addEventListener("submit", (e) => e.preventDefault());

  const raw = readout("Measured between marked points", "scale-raw");
  const factorOut = readout("Scale factor", "scale-factor");
  const check = readout("Check", "scale-check");
  const readouts = el("dl", { className: "scale-readout" }, raw.wrap, factorOut.wrap, check.wrap);

  const measureLine = el("p", { className: "meta", id: "scale-measure" });
  const hint = el("p", { className: "hint" }, "A 1.75 m reference figure stands next to the marked object in the preview, so you can judge the size by eye.");

  const markBtn = el("button", { className: "btn", type: "button", id: "scale-mark" }, "Mark two points");
  const applyBtn = el("button", { className: "btn", type: "button", id: "scale-apply" }, "Apply scale");
  const msg = el("p", { className: "meta", id: "scale-msg" });
  msg.setAttribute("aria-live", "polite");
  const row = el("div", { className: "next-row" }, markBtn, applyBtn, msg);

  const root = el("section", { className: "scale-block", id: "scale-panel" }, head, intro, form, readouts, measureLine, hint, row);
  root.setAttribute("aria-labelledby", "h-scale");

  // ----- state to DOM -----
  const fmt = (n: number, d = 3) => n.toFixed(d);

  function paintScale(s: SceneScale): void {
    const confirmed = s.source !== "none" && s.confirmedAt !== null;
    badge.className = "badge " + (confirmed ? "ok" : "warn");
    badge.textContent = confirmed ? (s.source === "manual" ? "Confirmed, manual" : "Confirmed, Marble") : "Not confirmed";
    badge.dataset.source = s.source;
    if (s.reference) {
      raw.dd.textContent = `${fmt(s.reference.measuredRaw)} units`;
      factorOut.dd.textContent = `${fmt(s.metricScaleFactor)} m per unit`;
    }
  }

  function refresh(): void {
    const hasCollider = viewer.hasCollider;
    markBtn.disabled = !hasCollider;
    applyBtn.disabled = marks.length !== 2;
    if (!hasCollider) msg.textContent = "Marking needs the collider mesh. Choose a collider GLB first.";
    else if (mode === "idle" && marks.length === 0 && store.get().source === "none") msg.textContent = "Press Mark two points, then click the floor at the base of the object and the top of it.";
    else if (msg.textContent?.startsWith("Marking needs")) msg.textContent = "";
  }

  function clearMarkers(): void {
    markers.clear();
  }

  function addMarker(p: THREE.Vector3): void {
    const m = new THREE.Mesh(markerGeo, markerMat);
    m.layers.set(HELPER_LAYER);
    m.renderOrder = 10;
    m.position.copy(p);
    m.scale.setScalar(MARKER_RADIUS_M / viewer.content.scale.x);
    markers.add(m);
  }

  function removeFigure(): void {
    if (figure) { viewer.scene.remove(figure); figure.geometry.dispose(); figure = null; }
  }

  function placeFigure(xz: [number, number]): void {
    removeFigure();
    const r = 0.22;
    const geo = new THREE.CapsuleGeometry(r, FIGURE_HEIGHT_M - 2 * r, 8, 16);
    figure = new THREE.Mesh(geo, figureMat);
    figure.name = "reference-figure";
    figure.layers.set(HELPER_LAYER);
    figure.position.set(xz[0], FIGURE_HEIGHT_M / 2, xz[1]);
    viewer.scene.add(figure);
    figureXZ = xz;
  }

  /** Stand the figure beside the marked base: to the camera's right, and a little toward the camera. */
  function figureBeside(baseWorld: THREE.Vector3): [number, number] {
    viewer.camera.updateMatrixWorld(true);
    const right = new THREE.Vector3().setFromMatrixColumn(viewer.camera.matrixWorld, 0).setY(0).normalize();
    const toCam = new THREE.Vector3(viewer.camera.position.x - baseWorld.x, 0, viewer.camera.position.z - baseWorld.z).normalize();
    return [baseWorld.x + right.x * 0.9 + toCam.x * 0.4, baseWorld.z + right.z * 0.9 + toCam.z * 0.4];
  }

  function worldDistance(a: THREE.Vector3, b: THREE.Vector3): { total: number; vertical: number } {
    const wa = viewer.content.localToWorld(a.clone()), wb = viewer.content.localToWorld(b.clone());
    return { total: wa.distanceTo(wb), vertical: Math.abs(wa.y - wb.y) };
  }

  // ----- picking -----
  function onPick(p: THREE.Vector3): void {
    if (mode === "marking") {
      marks.push(p);
      addMarker(p);
      if (marks.length === 2) {
        mode = "idle";
        const d = marks[0]!.distanceTo(marks[1]!);
        raw.dd.textContent = `${fmt(d)} units`;
        raw.dd.dataset.value = String(d);
        factorOut.dd.textContent = "Press Apply scale";
        msg.textContent = "Two points marked. Enter the known length, then press Apply scale.";
      } else {
        msg.textContent = "Now click the top of the object.";
      }
      applyBtn.disabled = marks.length !== 2;
    } else if (mode === "measuring") {
      if (measurePicks.length >= 2) { measurePicks = []; clearMarkers(); }
      measurePicks.push(p);
      addMarker(p);
      if (measurePicks.length === 2) {
        const d = worldDistance(measurePicks[0]!, measurePicks[1]!);
        measureLine.textContent = `Measure tool: ${d.total.toFixed(2)} m between the two picks, ${d.vertical.toFixed(2)} m of it vertical.`;
        measureLine.dataset.m = String(d.total);
      } else {
        measureLine.textContent = "Measure tool: click a second point.";
        delete measureLine.dataset.m;
      }
    }
  }

  const dom = viewer.renderer.domElement;
  let down: { x: number; y: number } | null = null;
  const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
  const onUp = (e: PointerEvent) => {
    const d = down; down = null;
    if (!d || mode === "idle") return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP_PX) return; // a drag is looking around
    const p = viewer.pickCollider(e.clientX, e.clientY);
    if (!p) { msg.textContent = "No surface under that click. Click on the room surfaces."; return; }
    onPick(p);
  };
  dom.addEventListener("pointerdown", onDown);
  dom.addEventListener("pointerup", onUp);

  // ----- actions -----
  markBtn.addEventListener("click", () => {
    if (!viewer.hasCollider) { refresh(); return; }
    mode = "marking";
    marks = [];
    measurePicks = [];
    clearMarkers();
    delete measureLine.dataset.m;
    measureLine.textContent = "";
    raw.dd.textContent = "Not marked";
    delete raw.dd.dataset.value;
    msg.textContent = "Click the floor at the base of the object. The lower point becomes the floor.";
    applyBtn.disabled = true;
  });

  applyBtn.addEventListener("click", () => {
    if (marks.length !== 2) return;
    try {
      const [a, b] = marks as [THREE.Vector3, THREE.Vector3];
      const measuredRaw = a.distanceTo(b);
      const knownM = Number(known.value);
      const factor = scaleFromReference(measuredRaw, knownM);
      const lower = a.y <= b.y ? a : b;
      const groundOffsetM = factor * lower.y;
      viewer.setScale(factor, groundOffsetM, true);
      const rec = manualScale(factor, groundOffsetM, { label: label.value.trim() || "reference", knownLengthM: knownM, measuredRaw }, new Date().toISOString());
      placeFigure(figureBeside(viewer.content.localToWorld(lower.clone())));
      store.set(rec);
      if (hash) saveScale(hash, { scale: rec, figureXZ }).catch((e) => console.warn("could not save the scale", e));
      // The marked points stay put in the group, so the check is a real distance in the scaled scene.
      const d = worldDistance(a, b);
      check.dd.textContent = `Measure tool reads ${d.total.toFixed(2)} m`;
      check.dd.dataset.m = String(d.total);
      mode = "measuring";
      measurePicks = [];
      clearMarkers();
      measureLine.textContent = "Measure tool: click two points to read the distance in metres.";
      msg.textContent = "Scale is applied and the floor is at 0. Next: place the camera.";
      refresh();
    } catch (err) {
      msg.textContent = err instanceof Error ? err.message : String(err);
    }
  });

  const unsub = store.subscribe(paintScale);

  function resetView(): void {
    mode = "idle"; marks = []; measurePicks = []; clearMarkers(); removeFigure(); figureXZ = null;
    raw.dd.textContent = "Not marked"; delete raw.dd.dataset.value;
    factorOut.dd.textContent = "Not set"; check.dd.textContent = "Not measured"; delete check.dd.dataset.m;
    measureLine.textContent = ""; delete measureLine.dataset.m;
    msg.textContent = "";
  }

  resetView();
  paintScale(store.get());
  refresh();

  return {
    root,
    async setScene(h) {
      hash = h;
      viewer.setScale(1, 0, false);
      resetView();
      store.set(noScale());
      const stored = h ? await loadScale(h) : null;
      if (hash !== h) return; // another file was opened while this one was being read
      if (stored && stored.scale.source !== "none") {
        const s = stored.scale;
        viewer.setScale(s.metricScaleFactor, s.groundPlaneOffsetM, true);
        if (stored.figureXZ) placeFigure(stored.figureXZ);
        store.set(s);
        if (s.reference) {
          raw.dd.textContent = `${fmt(s.reference.measuredRaw)} units`;
          check.dd.textContent = `Restored from this computer: ${s.reference.label}, ${s.reference.knownLengthM.toFixed(2)} m`;
          label.value = s.reference.label;
          known.value = s.reference.knownLengthM.toFixed(2);
        }
        mode = "measuring";
        measureLine.textContent = "Measure tool: click two points to read the distance in metres.";
        msg.textContent = "Scale restored for this file.";
      }
      refresh();
    },
    refresh,
    dispose() {
      unsub();
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointerup", onUp);
      viewer.content.remove(markers);
      removeFigure();
      markerMat.dispose(); markerGeo.dispose(); figureMat.dispose();
    },
  };
}
