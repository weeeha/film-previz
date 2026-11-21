import "./styles.css";
import { startRouter, type Route } from "./router";
import { Viewer } from "./viewer/scene";

const main = document.getElementById("main") as HTMLElement;
const chip = document.getElementById("scene-chip") as HTMLElement;
const tabs = document.querySelectorAll<HTMLAnchorElement>(".tabs a");

let stage: { root: HTMLElement; viewer: Viewer } | null = null;

function page(title: string, ...children: Node[]): HTMLElement {
  const root = document.createElement("div");
  root.className = "page";
  const head = document.createElement("div");
  head.className = "page-head";
  const h1 = document.createElement("h1");
  h1.textContent = title;
  head.appendChild(h1);
  root.append(head, ...children);
  return root;
}

function fileField(id: string, label: string, accept: string): { wrap: HTMLElement; input: HTMLInputElement } {
  const wrap = document.createElement("label");
  wrap.className = "field";
  wrap.append(label);
  const input = document.createElement("input");
  input.type = "file";
  input.id = id;
  input.accept = accept;
  wrap.appendChild(input);
  return { wrap, input };
}

function buildStage(): { root: HTMLElement; viewer: Viewer } {
  const bar = document.createElement("div");
  bar.className = "fields two";
  const splatField = fileField("splat-file", "Scene file (SPZ or PLY)", ".spz,.ply,.splat,.ksplat,.sog");
  const colliderField = fileField("collider-file", "Collider mesh (GLB)", ".glb,.gltf");
  bar.append(splatField.wrap, colliderField.wrap);

  const status = document.createElement("p");
  status.className = "meta";
  status.id = "stage-status";
  status.textContent = "No scene loaded";

  const viewport = document.createElement("div");
  viewport.className = "viewport";
  viewport.id = "viewport";

  const root = page("Stage", bar, status, viewport);
  const viewer = new Viewer(viewport);

  const fail = (err: unknown) => { status.textContent = "Failed: " + (err instanceof Error ? err.message : String(err)); console.error(err); };
  splatField.input.addEventListener("change", () => {
    const f = splatField.input.files?.[0];
    if (!f) return;
    status.textContent = "Loading " + f.name;
    viewer.loadSplat(f).then((n) => {
      status.textContent = `${f.name}: ${n} splats`;
      status.dataset.splats = String(n);
      chip.textContent = f.name;
    }).catch(fail);
  });
  colliderField.input.addEventListener("change", () => {
    const f = colliderField.input.files?.[0];
    if (f) viewer.loadCollider(f).then((n) => { status.dataset.colliderTriangles = String(n); }).catch(fail);
  });

  if (import.meta.env.DEV) {
    (window as unknown as { __viewer: Viewer }).__viewer = viewer;
    // Dev only, for by-hand checks: ?src=/scenes/<file>&collider=/scenes/<file>
    const q = new URLSearchParams(location.search);
    const load = async (u: string) => new File([await (await fetch(u)).blob()], u.split("/").pop() ?? "file");
    const src = q.get("src"), col = q.get("collider");
    if (src) load(src).then((f) => viewer.loadSplat(f)).then((n) => { status.textContent = `${src}: ${n} splats`; status.dataset.splats = String(n); }).catch(fail);
    if (col) load(col).then((f) => viewer.loadCollider(f)).catch(fail);
  }
  return { root, viewer };
}

function render(route: Route): void {
  tabs.forEach((a) => {
    if (a.dataset.route === route) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  main.replaceChildren();
  if (route === "/stage") {
    stage ??= buildStage();
    main.appendChild(stage.root);
  } else if (route === "/shots") {
    main.appendChild(page("Shots"));
  } else {
    main.appendChild(page("Scenes"));
  }
}

startRouter(render);
