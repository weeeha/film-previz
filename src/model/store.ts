// A small IndexedDB wrapper for scenes, shots and shot frames. No framework.
// Shot frames (the JPEG) are kept in their own object store, keyed by scene and shot, so the shot record stays plain JSON.
import { noScale } from "../scale/scale";
import { validateScene, validateShot } from "./schema";
import type { Scene, SceneScale, Shot } from "./types";

export const DB_NAME = "film-previz";
const DB_VERSION = 1;
const LEGACY_SCALE_PREFIX = "film-previz.scale.";

export type FigureXZ = [number, number] | null;

/** What the app knows about a file it was just given. */
export type OpenedFile = { name: string; bytes: number; sha256: string };

export type OpenResult =
  /** Same SHA-256 as a stored scene: the shots re-attach. */
  | { kind: "matched"; scene: Scene; shots: Shot[] }
  /** No stored scene has this hash. `draft` is ready for `saveScene`. */
  | { kind: "new"; draft: Scene }
  /** The file was opened for a stored scene but its hash differs. Shots are not attached, and the result carries none. */
  | { kind: "hash-mismatch"; scene: Scene; expectedSha256: string; actualSha256: string };

export type SceneSummary = { scene: Scene; shotCount: number };

export type Store = {
  saveScene(scene: Scene): Promise<void>;
  getScene(id: string): Promise<Scene | null>;
  getSceneByHash(sha256: string): Promise<Scene | null>;
  listScenes(): Promise<SceneSummary[]>;

  saveShot(shot: Shot, frame?: Blob): Promise<void>;
  getShot(sceneId: string, id: string): Promise<Shot | null>;
  /** Ordered by `number`. */
  listShots(sceneId: string): Promise<Shot[]>;
  /** `orderedIds` must hold every shot of the scene once. Shots are renumbered 1, 2, 3 in that order. */
  reorderShots(sceneId: string, orderedIds: string[]): Promise<Shot[]>;
  /** The copy goes at the end, with the next number and id, and keeps the frame. */
  duplicateShot(sceneId: string, id: string): Promise<Shot>;
  /** Removes the shot and its frame. Other shots keep their numbers. */
  deleteShot(sceneId: string, id: string): Promise<void>;
  saveFrame(sceneId: string, shotId: string, frame: Blob): Promise<void>;
  getFrame(sceneId: string, shotId: string): Promise<Blob | null>;
  nextShotNumber(sceneId: string): Promise<number>;
  nextShotId(sceneId: string): Promise<{ number: number; id: string }>;

  /**
   * Match a file from disk to a stored scene by SHA-256. When `forSceneId` names a stored scene and the
   * file's hash differs from that scene's, the result is "hash-mismatch" and no shots are attached.
   */
  openSceneFile(file: OpenedFile, forSceneId?: string): Promise<OpenResult>;

  /** Where the 1.75 m reference figure stood. Not part of the spec record, so it is kept beside the scene. */
  getFigure(sceneId: string): Promise<FigureXZ>;
  setFigure(sceneId: string, figure: FigureXZ): Promise<void>;

  /**
   * One-off move of scale entries from localStorage (`film-previz.scale.<hash>`). An entry whose file has a
   * scene record updates that scene; others wait until the file is opened and saved. Entries are removed.
   * Returns how many entries were moved.
   */
  migrateLegacyScales(storage?: Pick<Storage, "length" | "key" | "getItem" | "removeItem">): Promise<number>;
  close(): void;
};

export const sceneIdForHash = (sha256: string): string => `scene-${sha256.slice(0, 12)}`;
export const shotIdForNumber = (n: number): string => `shot-${String(n).padStart(3, "0")}`;

const fileFormat = (name: string): Scene["file"]["format"] => (name.toLowerCase().endsWith(".ply") ? "ply" : "spz");

type Pending = { hash: string; scale: SceneScale; figureXZ: FigureXZ };

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}

function upgrade(db: IDBDatabase): void {
  db.createObjectStore("scenes", { keyPath: "id" }).createIndex("bySha", "file.sha256");
  db.createObjectStore("shots", { keyPath: ["sceneId", "id"] }).createIndex("byScene", "sceneId");
  db.createObjectStore("frames");
  db.createObjectStore("sceneUi", { keyPath: "sceneId" });
  db.createObjectStore("pendingScales", { keyPath: "hash" });
}

function validScale(s: unknown): s is SceneScale {
  const v = s as Partial<SceneScale> | null;
  return !!v && (v.source === "marble" || v.source === "manual" || v.source === "none")
    && typeof v.metricScaleFactor === "number" && v.metricScaleFactor > 0
    && typeof v.groundPlaneOffsetM === "number";
}

export async function openStore(factory: IDBFactory = indexedDB, name: string = DB_NAME): Promise<Store> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = factory.open(name, DB_VERSION);
    r.onupgradeneeded = () => upgrade(r.result);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error("The database is open in another tab at an older version."));
  });

  const getAllShots = async (tx: IDBTransaction, sceneId: string): Promise<Shot[]> => {
    const rows = await req(tx.objectStore("shots").index("byScene").getAll(sceneId) as IDBRequest<Shot[]>);
    return rows.sort((a, b) => a.number - b.number);
  };

  const failIfInvalid = (kind: string, v: ReturnType<typeof validateShot>): void => {
    if (!v.ok) throw new Error(`${kind} is not valid: ${v.errors.join("; ")}`);
  };

  const store: Store = {
    async saveScene(scene) {
      const v = validateScene(scene);
      if (!v.ok) throw new Error(`Scene is not valid: ${v.errors.join("; ")}`);
      const tx = db.transaction(["scenes", "pendingScales", "sceneUi"], "readwrite");
      const fin = done(tx);
      const pending = await req(tx.objectStore("pendingScales").get(scene.file.sha256) as IDBRequest<Pending | undefined>);
      tx.objectStore("scenes").put(scene);
      if (pending) {
        tx.objectStore("pendingScales").delete(scene.file.sha256);
        tx.objectStore("sceneUi").put({ sceneId: scene.id, figureXZ: pending.figureXZ });
      }
      await fin;
    },

    async getScene(id) {
      const r = await req(db.transaction("scenes").objectStore("scenes").get(id) as IDBRequest<Scene | undefined>);
      return r ?? null;
    },

    async getSceneByHash(sha256) {
      const r = await req(db.transaction("scenes").objectStore("scenes").index("bySha").get(sha256) as IDBRequest<Scene | undefined>);
      return r ?? null;
    },

    async listScenes() {
      const tx = db.transaction(["scenes", "shots"]);
      const scenes = await req(tx.objectStore("scenes").getAll() as IDBRequest<Scene[]>);
      const out: SceneSummary[] = [];
      for (const scene of scenes) {
        const shotCount = await req(tx.objectStore("shots").index("byScene").count(scene.id));
        out.push({ scene, shotCount });
      }
      return out.sort((a, b) => a.scene.createdAt.localeCompare(b.scene.createdAt));
    },

    async saveShot(shot, frame) {
      failIfInvalid("Shot", validateShot(shot));
      const tx = db.transaction(["scenes", "shots", "frames"], "readwrite");
      const fin = done(tx);
      const scene = await req(tx.objectStore("scenes").get(shot.sceneId));
      if (!scene) {
        tx.abort();
        await fin.catch(() => undefined);
        throw new Error(`No scene ${shot.sceneId} to attach the shot to.`);
      }
      tx.objectStore("shots").put(shot);
      if (frame) tx.objectStore("frames").put(frame, [shot.sceneId, shot.id]);
      await fin;
    },

    async getShot(sceneId, id) {
      const r = await req(db.transaction("shots").objectStore("shots").get([sceneId, id]) as IDBRequest<Shot | undefined>);
      return r ?? null;
    },

    async listShots(sceneId) {
      return getAllShots(db.transaction("shots"), sceneId);
    },

    async reorderShots(sceneId, orderedIds) {
      const tx = db.transaction("shots", "readwrite");
      const fin = done(tx);
      const shots = await getAllShots(tx, sceneId);
      const have = new Set(shots.map((s) => s.id));
      if (orderedIds.length !== have.size || new Set(orderedIds).size !== have.size || !orderedIds.every((i) => have.has(i))) {
        tx.abort();
        await fin.catch(() => undefined);
        throw new Error("The new order must list every shot of the scene exactly once.");
      }
      const byId = new Map(shots.map((s) => [s.id, s]));
      const now = new Date().toISOString();
      const out = orderedIds.map((id, i) => {
        const s = byId.get(id)!;
        return s.number === i + 1 ? s : { ...s, number: i + 1, updatedAt: now };
      });
      for (const s of out) tx.objectStore("shots").put(s);
      await fin;
      return out;
    },

    async duplicateShot(sceneId, id) {
      const tx = db.transaction(["shots", "frames"], "readwrite");
      const fin = done(tx);
      const src = await req(tx.objectStore("shots").get([sceneId, id]) as IDBRequest<Shot | undefined>);
      if (!src) {
        tx.abort();
        await fin.catch(() => undefined);
        throw new Error(`No shot ${id} in scene ${sceneId}.`);
      }
      const all = await getAllShots(tx, sceneId);
      const number = Math.max(0, ...all.map((s) => s.number)) + 1;
      const newId = shotIdForNumber(number);
      const now = new Date().toISOString();
      const copy: Shot = {
        ...structuredClone(src),
        id: newId,
        number,
        name: src.name ? `${src.name} copy` : "",
        frame: { ...src.frame, file: src.frame.file.replace(src.id, newId) },
        createdAt: now,
        updatedAt: now,
      };
      const frame = await req(tx.objectStore("frames").get([sceneId, id]) as IDBRequest<Blob | undefined>);
      tx.objectStore("shots").put(copy);
      if (frame) tx.objectStore("frames").put(frame, [sceneId, newId]);
      await fin;
      return copy;
    },

    async deleteShot(sceneId, id) {
      const tx = db.transaction(["shots", "frames"], "readwrite");
      tx.objectStore("shots").delete([sceneId, id]);
      tx.objectStore("frames").delete([sceneId, id]);
      await done(tx);
    },

    async saveFrame(sceneId, shotId, frame) {
      const tx = db.transaction(["shots", "frames"], "readwrite");
      const fin = done(tx);
      const shot = await req(tx.objectStore("shots").getKey([sceneId, shotId]));
      if (shot === undefined) {
        tx.abort();
        await fin.catch(() => undefined);
        throw new Error(`No shot ${shotId} in scene ${sceneId} to attach the frame to.`);
      }
      tx.objectStore("frames").put(frame, [sceneId, shotId]);
      await fin;
    },

    async getFrame(sceneId, shotId) {
      const r = await req(db.transaction("frames").objectStore("frames").get([sceneId, shotId]) as IDBRequest<Blob | undefined>);
      return r ?? null;
    },

    async nextShotNumber(sceneId) {
      const shots = await getAllShots(db.transaction("shots"), sceneId);
      return Math.max(0, ...shots.map((s) => s.number)) + 1;
    },

    async nextShotId(sceneId) {
      const number = await store.nextShotNumber(sceneId);
      return { number, id: shotIdForNumber(number) };
    },

    async openSceneFile(file, forSceneId) {
      const hit = await store.getSceneByHash(file.sha256);
      if (hit) return { kind: "matched", scene: hit, shots: await store.listShots(hit.id) };
      if (forSceneId) {
        const expected = await store.getScene(forSceneId);
        if (expected) return { kind: "hash-mismatch", scene: expected, expectedSha256: expected.file.sha256, actualSha256: file.sha256 };
      }
      const pending = await req(db.transaction("pendingScales").objectStore("pendingScales").get(file.sha256) as IDBRequest<Pending | undefined>);
      const draft: Scene = {
        id: sceneIdForHash(file.sha256),
        name: file.name.replace(/\.[^.]+$/, "") || file.name,
        sourceKind: "other",
        sourceNote: "",
        marbleWorldId: null,
        file: { name: file.name, bytes: file.bytes, sha256: file.sha256, format: fileFormat(file.name) },
        colliderFile: null,
        importFrame: "opencv",
        scale: pending ? pending.scale : noScale(),
        frontHeadingDeg: 0,
        lightNote: "",
        markers: [],
        createdAt: new Date().toISOString(),
      };
      return { kind: "new", draft };
    },

    async getFigure(sceneId) {
      const r = await req(db.transaction("sceneUi").objectStore("sceneUi").get(sceneId) as IDBRequest<{ figureXZ: FigureXZ } | undefined>);
      return r?.figureXZ ?? null;
    },

    async setFigure(sceneId, figure) {
      const tx = db.transaction("sceneUi", "readwrite");
      tx.objectStore("sceneUi").put({ sceneId, figureXZ: figure });
      await done(tx);
    },

    async migrateLegacyScales(storage = localStorage) {
      const keys: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith(LEGACY_SCALE_PREFIX)) keys.push(k);
      }
      let moved = 0;
      for (const key of keys) {
        const hash = key.slice(LEGACY_SCALE_PREFIX.length);
        let rec: { scale?: unknown; figureXZ?: unknown } | null = null;
        try { rec = JSON.parse(storage.getItem(key) ?? "null"); } catch { rec = null; }
        if (rec && validScale(rec.scale)) {
          const f = rec.figureXZ;
          const figureXZ: FigureXZ = Array.isArray(f) && f.length === 2 && f.every((n) => typeof n === "number") ? [f[0] as number, f[1] as number] : null;
          const scene = await store.getSceneByHash(hash);
          if (scene) {
            await store.saveScene({ ...scene, scale: rec.scale });
            await store.setFigure(scene.id, figureXZ);
          } else {
            const tx = db.transaction("pendingScales", "readwrite");
            tx.objectStore("pendingScales").put({ hash, scale: rec.scale, figureXZ } satisfies Pending);
            await done(tx);
          }
          moved++;
        }
        // Written to IndexedDB (or unreadable): either way the localStorage entry goes.
        storage.removeItem(key);
      }
      return moved;
    },

    close() { db.close(); },
  };
  return store;
}

let shared: Promise<Store> | null = null;

/** The store the app uses. Opens once and moves any old localStorage scale entries on first use. */
export function appStore(): Promise<Store> {
  if (!shared) {
    shared = openStore().then(async (s) => {
      try { await s.migrateLegacyScales(); } catch (e) { console.warn("could not move the saved scale", e); }
      return s;
    });
    shared.catch(() => { shared = null; });
  }
  return shared;
}
