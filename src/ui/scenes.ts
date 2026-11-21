import { Viewer } from "../viewer/scene";
import type { ScalePanel } from "./scalePanel";
import { sha256Hex } from "../scale/persist";
import { el } from "./dom";

export type Scenes = {
  root: HTMLElement;
  /** The viewport takes its place in the preview when Scenes is the route. */
  setActive(active: boolean, viewport: HTMLElement): void;
};

function fileField(id: string, label: string, accept: string): { wrap: HTMLElement; input: HTMLInputElement } {
  const input = el("input", { type: "file", id, accept });
  const wrap = el("label", { className: "field" }, label, input);
  return { wrap, input };
}

/**
 * The Scenes route for now: the two file inputs, the load status, a preview of the viewport so marking
 * has a surface to click on, and the scale panel. The full Scenes view from the draft comes in a later task.
 */
export function createScenes(viewer: Viewer, panel: ScalePanel, onSceneName: (name: string) => void): Scenes {
  const splatField = fileField("splat-file", "Scene file (SPZ or PLY)", ".spz,.ply,.splat,.ksplat,.sog");
  const colliderField = fileField("collider-file", "Collider mesh (GLB)", ".glb,.gltf");
  const fields = el("div", { className: "fields two" }, splatField.wrap, colliderField.wrap);
  const status = el("p", { className: "meta", id: "scene-status" }, "No scene loaded");
  status.setAttribute("aria-live", "polite");
  const preview = el("div", { className: "preview-slot" });
  const head = el("div", { className: "page-head" }, el("h1", {}, "Scenes"));
  const root = el("div", { className: "page" }, head, fields, status, preview, panel.root);

  const openSplat = async (f: File): Promise<number> => {
    panel.setScene(await sha256Hex(f));
    return viewer.loadSplat(f);
  };
  const loaded = (name: string, n: number) => {
    status.textContent = `${name}: ${n} splats`;
    status.dataset.splats = String(n);
    onSceneName(name);
  };
  const fail = (err: unknown) => { status.textContent = "Failed: " + (err instanceof Error ? err.message : String(err)); console.error(err); };

  splatField.input.addEventListener("change", () => {
    const f = splatField.input.files?.[0];
    if (!f) return;
    status.textContent = "Loading " + f.name;
    openSplat(f).then((n) => loaded(f.name, n)).catch(fail);
  });
  colliderField.input.addEventListener("change", () => {
    const f = colliderField.input.files?.[0];
    if (f) viewer.loadCollider(f).then((n) => { status.dataset.colliderTriangles = String(n); panel.refresh(); }).catch(fail);
  });

  if (import.meta.env.DEV) {
    (window as unknown as { __viewer: Viewer }).__viewer = viewer;
    // Dev only, for by-hand checks: ?src=/scenes/<file>&collider=/scenes/<file>
    const q = new URLSearchParams(location.search);
    const load = async (u: string) => new File([await (await fetch(u)).blob()], u.split("/").pop() ?? "file");
    const src = q.get("src"), col = q.get("collider");
    if (src) load(src).then((f) => openSplat(f).then((n) => loaded(f.name, n))).catch(fail);
    if (col) load(col).then((f) => viewer.loadCollider(f)).then(() => panel.refresh()).catch(fail);
  }

  return {
    root,
    setActive(on, viewport) {
      if (on) { viewport.removeAttribute("tabindex"); viewport.setAttribute("aria-label", "Preview of the scene"); preview.appendChild(viewport); }
    },
  };
}
