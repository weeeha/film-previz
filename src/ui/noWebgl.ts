import { el } from "./dom";

/** True when this browser can make a WebGL 2 context, which the viewer needs. */
export function hasWebGL2(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

/** The Scenes page for a browser without WebGL 2 (draft state "nowebgl"). Shown on every route, since nothing else can work. */
export function noWebglPage(): HTMLElement {
  const again = el("button", { className: "btn", type: "button", id: "check-again" }, "Check again");
  const msg = el("p", { className: "meta", id: "check-msg" });
  msg.setAttribute("aria-live", "polite");
  again.addEventListener("click", () => {
    if (hasWebGL2()) location.reload();
    else msg.textContent = "This browser still does not offer WebGL 2.";
  });
  const section = el("section", {},
      el("h2", { id: "h-file", className: "panel-title" }, "Scene file"),
      el("div", { className: "notice err", role: "alert", id: "no-webgl" },
        el("p", {}, el("strong", {}, "This browser cannot show scenes."), " film-previz needs WebGL 2, and this browser does not offer it."),
        el("p", {}, "Open film-previz in a current version of Chrome or Safari. If hardware acceleration is turned off, turn it on in the browser settings."),
        el("div", { className: "actions" }, again),
      ),
      msg,
  );
  section.setAttribute("aria-labelledby", "h-file");
  return el("div", { className: "page" }, el("div", { className: "page-head" }, el("h1", {}, "Scenes")), section);
}
