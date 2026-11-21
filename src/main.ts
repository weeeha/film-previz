import "./styles.css";
import { startRouter, type Route } from "./router";
import { Viewer } from "./viewer/scene";
import { createScalePanel } from "./ui/scalePanel";
import { createScenes } from "./ui/scenes";
import { createStage } from "./ui/stage";
import { createShots } from "./ui/shots";
import { createSession } from "./model/session";
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
const session = createSession();
const scenes = createScenes(viewer, panel, (name) => header.setSceneName(name), (id) => { session.setScene(id).catch((e) => console.warn("could not read the shots", e)); });
const stage = createStage(viewer, shot, sceneScale, session);
const shots = createShots(session, (rec) => { stage.openShot(rec); location.hash = "#/stage"; });

if (import.meta.env.DEV) {
  (window as unknown as { __shot: typeof shot; __session: typeof session }).__shot = shot;
  (window as unknown as { __session: typeof session }).__session = session;
}

function render(route: Route): void {
  tabs.forEach((a) => {
    if (a.dataset.route === route) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  main.dataset.route = route;
  main.replaceChildren();
  stage.setActive(false, viewport);
  shots.setActive(false);
  if (route === "/stage") {
    main.appendChild(stage.root);
    stage.setActive(true, viewport);
  } else if (route === "/shots") {
    main.appendChild(shots.root);
    shots.setActive(true);
  } else {
    main.appendChild(scenes.root);
    scenes.setActive(true, viewport);
  }
}

startRouter(render);
