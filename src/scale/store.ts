import { noScale, type SceneScale } from "./scale";

export type ScaleStore = {
  get(): SceneScale;
  set(next: SceneScale): void;
  subscribe(fn: (s: SceneScale) => void): () => void;
};

export function createScaleStore(): ScaleStore {
  let current = noScale();
  const subs = new Set<(s: SceneScale) => void>();
  return {
    get: () => current,
    set(next) { current = next; subs.forEach((fn) => fn(current)); },
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}

/** The scale of the scene that is open now. Later views read and subscribe to this. */
export const sceneScale = createScaleStore();
