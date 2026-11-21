import "./styles.css";
import { startRouter, type Route } from "./router";
import { Viewer } from "./viewer/scene";
import { createScalePanel } from "./ui/scalePanel";
import { createScenes } from "./ui/scenes";
import { createStage } from "./ui/stage";
import { createHeader } from "./ui/header";
import { createShotState } from "./camera/shotState";
import { sceneScale } from "./scale/store";
import { el } from "./ui/dom";

const main = document.getElementById("main") as HTMLElement;
const tabs = document.querySelectorAll<HTMLAnchorElement>(".tabs a");

// One viewer for the whole app. Its viewport element moves between the Scenes preview and the Stage.
const viewport = el("div", { className: "viewport", id: "viewport" });
const viewer = new Viewer(viewport);
const FRONT_HEADING_DEG = 0; // the scene record's frontHeadingDeg arrives with scene records
const shot = createShotState(viewer.shotCamera, () => FRONT_HEADING_DEG);
viewer.afterScale.add(() => shot.syncFromCamera());
shot.subscribe(() => viewer.syncRig());

const header = createHeader(sceneScale);
const panel = createScalePanel(viewer);
const scenes = createScenes(viewer, panel, (name) => header.setSceneName(name));
const stage = createStage(viewer, shot, sceneScale);

if (import.meta.env.DEV) {
  (window as unknown as { __shot: typeof shot }).__shot = shot;
}

function page(title: string, ...children: Node[]): HTMLElement {
  const root = el("div", { className: "page" }, el("div", { className: "page-head" }, el("h1", {}, title)), ...children);
  return root;
}
const shotsPage = page("Shots");

function render(route: Route): void {
  tabs.forEach((a) => {
    if (a.dataset.route === route) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  main.dataset.route = route;
  main.replaceChildren();
  stage.setActive(false, viewport);
  if (route === "/stage") {
    main.appendChild(stage.root);
    stage.setActive(true, viewport);
  } else if (route === "/shots") {
    main.appendChild(shotsPage);
  } else {
    main.appendChild(scenes.root);
    scenes.setActive(true, viewport);
  }
}

startRouter(render);
