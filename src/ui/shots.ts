import type { Session } from "../model/session";
import { SIZE_LABELS, type Shot, type SizeLabel } from "../model/types";
import { heightText, lensLabel, sensorLabel } from "../model/shotRecord";
import { buildExportZip, exportFolderName, exportZipName, type ExportFrame } from "../export/zip";
import { el } from "./dom";

export type Shots = {
  root: HTMLElement;
  /** Call when the route becomes Shots, so the table is drawn from the current list. */
  setActive(active: boolean): void;
};

/** `el` assigns props, and a string assigned to `style` sets its cssText. */
const S = (css: string): CSSStyleDeclaration => css as unknown as CSSStyleDeclaration;
const SVG_NS = "http://www.w3.org/2000/svg";
const ICONS = {
  up: "M8 13V3M4 7l4-4 4 4",
  down: "M8 3v10M4 9l4 4 4-4",
  dup: "M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2",
  del: "M3 4.5h10M6.5 4.5v-2h3v2M4.5 4.5l.5 9h6l.5-9",
} as const;

function icon(kind: keyof typeof ICONS): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  if (kind === "dup") {
    const r = document.createElementNS(SVG_NS, "rect");
    for (const [k, v] of Object.entries({ x: "5.5", y: "5.5", width: "8", height: "8", rx: "1" })) r.setAttribute(k, v);
    svg.append(r);
  }
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", ICONS[kind]);
  svg.append(p);
  return svg;
}

function iconButton(kind: keyof typeof ICONS, label: string, title: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = el("button", { className: "btn btn-icon", type: "button" }, icon(kind));
  b.setAttribute("aria-label", label);
  b.title = title;
  b.disabled = disabled;
  b.addEventListener("click", onClick);
  return b;
}

type TextField = "name" | "job" | "action" | "notes";

/** The Shots route, built from draft/shots.html. */
export function createShots(session: Session, onOpen: (shot: Shot) => void): Shots {
  type Undo = { shot: Shot; frame: Blob | null; index: number; sceneId: string; rev: number; later: boolean };
  let undo: Undo | null = null;
  let active = false;
  let busy = false;
  type ExportState = { kind: "idle" } | { kind: "exporting"; done: number; total: number } | { kind: "exported"; count: number; file: string } | { kind: "error"; message: string };
  let exportState: ExportState = { kind: "idle" };

  const count = el("p", { className: "meta", id: "shot-count-head" });
  const head = el("div", { className: "page-head" }, el("h1", {}, "Shots"), count);
  const table = el("div", { className: "table-wrap" });
  table.tabIndex = 0;
  table.setAttribute("role", "region");
  table.setAttribute("aria-label", "Saved shots table, scrolls sideways");
  const left = el("section", { className: "shots-main" });
  left.setAttribute("aria-label", "Saved shots");
  const exportPanel = el("aside", { className: "export", id: "export" });
  exportPanel.setAttribute("aria-labelledby", "h-export");
  const layout = el("div", { className: "shots-layout" }, left, exportPanel);
  const root = el("div", { className: "page", id: "shots-page" }, head, layout);
  root.style.maxWidth = "none";

  const store = () => session.store();
  const sceneId = () => session.scene()?.id ?? null;
  const dropUndo = () => { undo = null; };

  async function run(fn: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    try { await fn(); if (exportState.kind !== "exporting") exportState = { kind: "idle" }; await session.refresh(); } catch (e) { console.error(e); } finally { busy = false; }
  }

  // ----- actions -----
  async function saveText(shot: Shot, field: TextField, value: string): Promise<void> {
    if (shot[field] === value) return;
    dropUndo();
    await run(async () => { await (await store()).saveShot({ ...shot, [field]: value, updatedAt: new Date().toISOString() }); });
  }
  async function saveSize(shot: Shot, value: string): Promise<void> {
    const sizeLabel = value === "" ? null : (value as SizeLabel);
    if (shot.sizeLabel === sizeLabel) return;
    dropUndo();
    await run(async () => { await (await store()).saveShot({ ...shot, sizeLabel, updatedAt: new Date().toISOString() }); });
  }
  async function move(shot: Shot, by: -1 | 1): Promise<void> {
    const list = session.shots();
    const i = list.findIndex((x) => x.id === shot.id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= list.length) return;
    dropUndo();
    const ids = list.map((x) => x.id);
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    await run(async () => { await (await store()).reorderShots(shot.sceneId, ids); });
  }
  async function duplicate(shot: Shot): Promise<void> {
    dropUndo();
    await run(async () => { await (await store()).duplicateShot(shot.sceneId, shot.id); });
  }
  async function remove(shot: Shot): Promise<void> {
    const list = session.shots();
    const index = list.findIndex((x) => x.id === shot.id);
    await run(async () => {
      const db = await store();
      const frame = await db.getFrame(shot.sceneId, shot.id);
      await db.deleteShot(shot.sceneId, shot.id);
      const rest = list.filter((x) => x.id !== shot.id).map((x) => x.id);
      if (rest.length) await db.reorderShots(shot.sceneId, rest); // later shots move up one number
      undo = { shot, frame, index, sceneId: shot.sceneId, rev: session.rev() + 1, later: index < rest.length }; // the refresh after this bumps the rev once
    });
  }
  async function restore(): Promise<void> {
    const u = undo;
    if (!u) return;
    dropUndo();
    await run(async () => {
      const db = await store();
      await db.saveShot(u.shot, u.frame ?? undefined);
      const ids = (await db.listShots(u.sceneId)).filter((x) => x.id !== u.shot.id).map((x) => x.id);
      ids.splice(u.index, 0, u.shot.id);
      await db.reorderShots(u.sceneId, ids);
    });
  }

  // ----- cells -----
  function editable(shot: Shot, field: TextField, label: string, cls: string): HTMLElement {
    const d = el("div", { className: cls, textContent: shot[field] });
    d.setAttribute("contenteditable", "plaintext-only");
    d.setAttribute("role", "textbox");
    d.setAttribute("aria-label", label);
    if (field === "notes") d.setAttribute("aria-multiline", "true");
    d.title = shot[field];
    d.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !(field === "notes" && e.shiftKey)) { e.preventDefault(); d.blur(); }
      else if (e.key === "Escape") { d.textContent = shot[field]; d.blur(); }
    });
    d.addEventListener("blur", () => {
      const v = (d.textContent ?? "").replace(/\s+/g, " ").trim();
      if (v !== shot[field]) void saveText(shot, field, v); else d.textContent = shot[field];
    });
    return d;
  }

  function sizeCell(shot: Shot): HTMLElement {
    const sel = el("select", { className: "size-edit" });
    sel.setAttribute("aria-label", `Size of shot ${shot.number}`);
    sel.append(el("option", { value: "" }, "Not set"), ...SIZE_LABELS.map((s) => el("option", { value: s }, s)));
    sel.value = shot.sizeLabel ?? "";
    sel.addEventListener("change", () => { void saveSize(shot, sel.value); });
    return sel;
  }

  function row(shot: Shot, i: number, n: number): HTMLTableRowElement {
    const url = session.frameUrl(shot);
    const thumb = el("button", { className: "thumb", type: "button" });
    thumb.style.setProperty("--ar", String(shot.lens.aspect));
    thumb.setAttribute("aria-label", `Open shot ${shot.number} on the Stage`);
    thumb.title = "Open on the Stage";
    if (url) thumb.append(Object.assign(el("img"), { src: url, alt: "" }));
    thumb.addEventListener("click", () => onOpen(shot));

    const height = el("td", { className: "num" });
    if (shot.scaleConfirmed) height.textContent = heightText(shot);
    else height.append(heightText(shot), el("br"), el("span", { className: "badge warn" }, "Unverified"));

    const actions = el("div", { className: "row-actions" },
      iconButton("up", `Move up shot ${shot.number}`, "Move up", () => { void move(shot, -1); }, i === 0),
      iconButton("down", `Move down shot ${shot.number}`, "Move down", () => { void move(shot, 1); }, i === n - 1),
      iconButton("dup", `Duplicate shot ${shot.number}`, "Duplicate", () => { void duplicate(shot); }),
      iconButton("del", `Delete shot ${shot.number}`, "Delete", () => { void remove(shot); }),
    );
    const tr = el("tr", {},
      el("td", { className: "num" }, el("span", { className: "n" }, String(shot.number))),
      el("td", {}, editable(shot, "name", `Name of shot ${shot.number}`, "nm-edit")),
      el("td", {}, thumb),
      el("td", {}, el("b", {}, lensLabel(shot)), el("br"), el("span", { className: "meta" }, sensorLabel(shot))),
      height,
      el("td", {}, sizeCell(shot)),
      el("td", {}, editable(shot, "job", `Job of shot ${shot.number}`, "ed clamp")),
      el("td", {}, editable(shot, "action", `Decisive action of shot ${shot.number}`, "ed clamp")),
      el("td", {}, editable(shot, "notes", `Notes of shot ${shot.number}`, "ed clamp")),
      el("td", {}, actions),
    );
    tr.dataset.shotId = shot.id;
    return tr;
  }

  function download(bytes: Uint8Array, file: string): void {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
    const a = el("a", { href: url, download: file });
    a.style.display = "none";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  /** Read every frame, zip, and hand the zip to the browser. One zip, no File System Access API, so Safari works. */
  async function exportZip(): Promise<void> {
    const scene = session.scene();
    const list = session.shots();
    if (!scene || !list.length || exportState.kind === "exporting") return;
    exportState = { kind: "exporting", done: 0, total: list.length };
    paintExport(list);
    try {
      const db = await store();
      const frames: ExportFrame[] = [];
      for (const shot of list) {
        const blob = await db.getFrame(shot.sceneId, shot.id);
        if (!blob) throw new Error(`Shot ${shot.number} has no stored frame.`);
        frames.push({ shot, bytes: new Uint8Array(await blob.arrayBuffer()) });
        exportState = { kind: "exporting", done: frames.length, total: list.length };
        paintExport(list);
        await new Promise((r) => setTimeout(r, 0)); // let the progress bar draw
      }
      const file = exportZipName(scene);
      download(buildExportZip(scene, frames), file);
      exportState = { kind: "exported", count: list.length, file };
    } catch (e) {
      console.error(e);
      exportState = { kind: "error", message: e instanceof Error ? e.message : String(e) };
    }
    paintExport(session.shots());
  }

  const plural = (n: number) => `${n} ${n === 1 ? "shot" : "shots"}`;

  function paintExport(list: Shot[]): void {
    const scene = session.scene();
    const name = scene?.name ?? "the scene";
    const folder = scene ? exportFolderName(scene) : "scene-previz";
    const unverified = list.filter((s) => !s.scaleConfirmed).length;
    const last = String(Math.max(0, ...list.map((s) => Number(/(\d+)$/.exec(s.id)?.[1] ?? 0)))).padStart(3, "0");
    const st = exportState;
    const exporting = st.kind === "exporting";
    const btn = el("button", { className: list.length ? "btn btn-primary" : "btn", type: "button", id: "export-btn", disabled: !list.length || exporting }, exporting ? "Exporting" : "Export shot list");
    btn.addEventListener("click", () => { void exportZip(); });
    const parts: Node[] = [
      el("h2", { id: "h-export" }, "Export"),
      el("p", { className: "meta" }, list.length ? `${plural(list.length)} from ${name}. One zip download.` : "Nothing to export yet."),
    ];
    if (unverified) {
      const n = el("div", { className: "notice warn" },
        el("p", {}, el("strong", {}, "Heights unverified."), ` ${unverified} of ${list.length} shots were saved before the scale was confirmed. shot-list.md says "height unverified" for them.`),
        el("p", {}, el("a", { href: "#/" }, "Set scale"), " and update those shots to fix this."),
      );
      n.setAttribute("role", "status");
      parts.push(n);
    }
    if (st.kind === "exported") {
      const n = el("div", { className: "notice", id: "export-done" },
        el("p", {}, el("strong", {}, `${plural(st.count)} exported.`), " Your browser saved ", el("span", { className: "mono" }, st.file), "."),
      );
      n.setAttribute("role", "status");
      parts.push(n);
    }
    if (st.kind === "error") {
      const n = el("div", { className: "notice warn", id: "export-error" }, el("p", {}, el("strong", {}, "Export failed."), ` ${st.message}`));
      n.setAttribute("role", "alert");
      parts.push(n);
    }
    if (st.kind === "exporting") {
      const bar = el("progress", { value: st.done, max: st.total });
      bar.setAttribute("aria-label", "Frames added to the zip");
      const n = el("div", { id: "export-progress" }, el("p", { className: "meta" }, `Zipping frames: ${st.done} of ${st.total}.`), bar);
      n.setAttribute("role", "status");
      parts.push(n);
    }
    parts.push(el("div", {}, btn,
      el("p", { className: "hint", style: S("margin-top:var(--s2)") }, "Scene files are never included. Nothing leaves this computer."),
    ));
    const li = (file: string, hint: string) => el("li", {}, el("span", { className: "mono" }, file), el("span", { className: "hint" }, hint));
    parts.push(el("div", {},
      el("h3", { style: S("margin-bottom:var(--s2)") }, "Folder contents"),
      el("p", { className: "mono", style: S("margin-bottom:var(--s2)") }, `${folder}/`),
      el("ul", { className: "files" },
        li("shots.json", "Full records of every shot."),
        li("shot-list.md", "Table with the film-craft shot list columns."),
        li("location-sheet.md", "Filled from the scene record."),
        li("frames/shot-001.jpg", list.length ? `One frame per shot, up to shot-${last}.jpg. Exact aspect, no interface.` : "One frame per shot. Exact aspect, no interface."),
        li("floor-plan.png", "Not included yet. Top-down view with numbered cameras arrives with stand-ins."),
        li("scene-ref.json", "Scene name, file name, SHA-256 and scale source. No scene data."),
      ),
    ));
    exportPanel.replaceChildren(...parts);
  }

  function paint(): void {
    if (undo && undo.rev !== session.rev()) dropUndo();
    const scene = session.scene();
    const list = session.shots();
    const noun = plural(list.length);
    count.textContent = scene ? `${noun} on this scene.` : "";
    count.hidden = !scene;

    const parts: Node[] = [];
    if (!scene) {
      parts.push(el("div", { className: "empty-state", id: "no-scene" },
        el("h2", {}, "No scene open"),
        el("p", { className: "meta", style: S("max-width:62ch") }, "Shots belong to a scene. Open the scene file on Scenes, and its saved shots appear here."),
        el("a", { className: "btn btn-primary", href: "#/" }, "Open Scenes"),
      ));
    } else {
      if (undo) {
        const b = el("button", { className: "btn", type: "button", id: "undo-delete" }, "Undo");
        b.addEventListener("click", () => { void restore(); });
        const n = el("div", { className: "notice", id: "undo-notice", style: S("margin-bottom:var(--s3)") },
          el("p", {}, el("strong", {}, `Shot ${undo.shot.number} deleted.`), undo.later ? " The later shots moved up one number." : ""),
          el("div", { className: "actions" }, b),
        );
        n.setAttribute("role", "status");
        parts.push(n);
      }
      if (!list.length) {
        parts.push(el("div", { className: "empty-state", id: "no-shots" },
          el("h2", {}, "No shots yet"),
          el("p", { className: "meta", style: S("max-width:62ch") }, "Place the camera and pick a lens on the Stage, then save a shot. It is listed here with its frame, lens and height."),
          el("a", { className: "btn btn-primary", href: "#/stage" }, "Open Stage"),
        ));
      } else {
        const th = (t: string, cls = "") => el("th", { className: cls }, t);
        const thead = el("thead", {}, el("tr", {}, th("#", "num"), th("Name"), th("Frame"), th("Lens"), th("Height", "num"), th("Size"), th("Job"), th("Decisive action"), th("Notes"), el("th", {}, el("span", { className: "sr" }, "Actions"))));
        const tbody = el("tbody", {}, ...list.map((s, i) => row(s, i, list.length)));
        table.replaceChildren(el("table", { className: "shots-table", id: "shots-table" }, thead, tbody));
        parts.push(table,
          el("p", { className: "meta", id: "row-count", style: S("margin-top:var(--s2)") }, noun),
          el("p", { className: "hint", style: S("margin-top:var(--s1)") }, "Heights and presets use your own assumptions. Names are editable in the table."),
        );
      }
    }
    left.replaceChildren(...parts);
    paintExport(list);
  }

  session.subscribe(() => { if (active) paint(); });
  paint();

  return {
    root,
    setActive(on) { active = on; if (on) paint(); },
  };
}
