// The scene that is open now and its shots, shared by the Stage strip and the Shots view.
import { appStore, type Store } from "./store";
import type { Scene, Shot } from "./types";

export type Session = {
  scene(): Scene | null;
  shots(): Shot[];
  /** Object URL of the stored frame, or null while there is none. */
  frameUrl(shot: Shot): string | null;
  /** The shot being edited on the Stage, or null. */
  editingId(): string | null;
  setEditing(id: string | null): void;
  /** Changes on every reload of the list. Lets a view tell its own change from someone else's. */
  rev(): number;
  /** Open a scene by id (null closes). */
  setScene(sceneId: string | null): Promise<void>;
  /** Read the scene record and the shots again from the store. */
  refresh(): Promise<void>;
  store(): Promise<Store>;
  subscribe(fn: () => void): () => void;
};

export function createSession(getStore: () => Promise<Store> = appStore): Session {
  let scene: Scene | null = null;
  let shots: Shot[] = [];
  let editing: string | null = null;
  let rev = 0;
  const urls = new Map<string, { url: string; key: string }>();
  const subs = new Set<() => void>();
  const notify = () => subs.forEach((f) => f());

  async function refresh(): Promise<void> {
    const s = await getStore();
    if (!scene) {
      shots = [];
    } else {
      scene = (await s.getScene(scene.id)) ?? scene;
      shots = await s.listShots(scene.id);
    }
    const keep = new Set<string>();
    for (const sh of shots) {
      const key = `${sh.updatedAt}|${sh.frame.file}`;
      keep.add(sh.id);
      const have = urls.get(sh.id);
      if (have && have.key === key) continue;
      if (have) URL.revokeObjectURL(have.url);
      urls.delete(sh.id);
      const blob = await s.getFrame(sh.sceneId, sh.id);
      if (blob) urls.set(sh.id, { url: URL.createObjectURL(blob), key });
    }
    for (const [id, v] of urls) if (!keep.has(id)) { URL.revokeObjectURL(v.url); urls.delete(id); }
    if (editing && !shots.some((x) => x.id === editing)) editing = null;
    rev++;
    notify();
  }

  return {
    scene: () => scene,
    shots: () => shots,
    frameUrl: (sh) => urls.get(sh.id)?.url ?? null,
    editingId: () => editing,
    setEditing(id) { if (id !== editing) { editing = id; notify(); } },
    rev: () => rev,
    async setScene(id) {
      if (id === (scene?.id ?? null)) { await refresh(); return; }
      editing = null;
      for (const v of urls.values()) URL.revokeObjectURL(v.url);
      urls.clear();
      scene = id ? await (await getStore()).getScene(id) : null;
      await refresh();
    },
    refresh,
    store: getStore,
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}
