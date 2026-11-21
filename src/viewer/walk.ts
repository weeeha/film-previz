import * as THREE from "three";

// Walk camera: drag the mouse to look, W A S D to move on the floor plane.
// Units are scene units. In the phase 0 test set these are raw units (metric / 2.5).
export class WalkControls {
  eyeHeight: number;
  speed: number;
  /** When false, drag and keys are ignored (the Stage looks through the shot camera instead). */
  enabled = true;
  private yaw = 0;
  private pitch = 0;
  private keys = new Set<string>();
  private dragging = false;
  private readonly cleanup: Array<() => void> = [];

  constructor(readonly camera: THREE.PerspectiveCamera, dom: HTMLElement, eyeHeight = 0.16, speed = 0.5) {
    this.eyeHeight = eyeHeight;
    this.speed = speed;
    camera.rotation.order = "YXZ";
    camera.position.y = eyeHeight;

    const on = <K extends keyof HTMLElementEventMap>(target: HTMLElement | Window, type: string, fn: (e: never) => void) => {
      target.addEventListener(type, fn as EventListener);
      this.cleanup.push(() => target.removeEventListener(type, fn as EventListener));
    };
    on(dom, "pointerdown", (e: PointerEvent) => { if (!this.enabled) return; this.dragging = true; dom.setPointerCapture(e.pointerId); });
    on(dom, "pointerup", (e: PointerEvent) => { this.dragging = false; if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId); });
    on(dom, "pointermove", (e: PointerEvent) => {
      if (!this.dragging) return;
      this.yaw -= e.movementX * 0.003;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - e.movementY * 0.003));
      this.apply();
    });
    on(window, "keydown", (e: KeyboardEvent) => { if (this.enabled && !isTyping(e)) this.keys.add(e.code); });
    on(window, "keyup", (e: KeyboardEvent) => { this.keys.delete(e.code); });
    on(window, "blur", () => { this.keys.clear(); });
  }

  setEyeHeight(h: number): void {
    this.eyeHeight = h;
    this.camera.position.y = h;
  }

  /** Put the camera at a position (y is replaced by the eye height) looking toward a point. */
  setPose(position: THREE.Vector3, lookAt: THREE.Vector3): void {
    this.camera.position.set(position.x, this.eyeHeight, position.z);
    const dx = lookAt.x - position.x, dy = lookAt.y - this.eyeHeight, dz = lookAt.z - position.z;
    this.yaw = Math.atan2(-dx, -dz);
    this.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    this.apply();
  }

  private apply(): void {
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  update(dt: number): void {
    if (!this.enabled) { this.camera.position.y = this.eyeHeight; return; }
    const f = (this.keys.has("KeyW") ? 1 : 0) - (this.keys.has("KeyS") ? 1 : 0);
    const r = (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0);
    if (f || r) {
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      // forward on the floor plane is (-sin yaw, -cos yaw), right is (cos yaw, -sin yaw)
      this.camera.position.x += (-sin * f + cos * r) * this.speed * dt;
      this.camera.position.z += (-cos * f - sin * r) * this.speed * dt;
    }
    this.camera.position.y = this.eyeHeight;
  }

  dispose(): void {
    this.cleanup.forEach((fn) => fn());
    this.cleanup.length = 0;
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target;
  return t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}
