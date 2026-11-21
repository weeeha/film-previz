import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { SparkRenderer, SplatMesh, SplatFileType } from "@sparkjsdev/spark";
import { WalkControls } from "./walk";
import { applyScale } from "../scale/scale";
import { ShotRig } from "./shotRig";
import { grabFrame, type FrameGrab } from "../camera/frameGrab";

/** Helpers and overlays (collider wireframe, markers) go on this layer. Hide it for frame grabs. */
export const HELPER_LAYER = 1;

/** The draft's viewport grey, the same in both themes. */
const CLEAR = 0x4a4d53;

function fileTypeFor(name: string): SplatFileType | undefined {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ply": return SplatFileType.PLY;
    case "spz": return SplatFileType.SPZ;
    case "splat": return SplatFileType.SPLAT;
    case "ksplat": return SplatFileType.KSPLAT;
    default: return undefined;
  }
}

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
  /** The virtual film camera. Its lens comes from the lens panel (applyLens), its pose from the camera panel. */
  readonly shotCamera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 200);
  readonly walk: WalkControls;
  /** True: the viewport shows the shot camera (the page draws the frame mask). False: the walk camera. */
  lookThrough = false;
  /** Where the look-through frame sits: centre as a share of the viewport width, the share of the width it may use, and the side margins in px. Side by side compare moves it right. */
  frameLayout = { cxFrac: 0.5, availFrac: 1, marginX: 32 };
  /** Called after the scale changed the content, so the shot camera panel can re-read its pose. */
  readonly afterScale = new Set<() => void>();
  /** How the last frame grab's sort settle went. For tests and the report. */
  lastSettle: { ok: boolean; ms: number } | null = null;
  /** Holds the splat and the collider. Both carry the 180 degree turn about x (OpenCV axes to three.js). */
  readonly content = new THREE.Group();
  private readonly spark: SparkRenderer;
  private readonly displayCamera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
  private readonly rig = new ShotRig(HELPER_LAYER);
  private running = true;
  private splat: SplatMesh | null = null;
  private collider: THREE.Mesh | null = null;
  private readonly colliderMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, wireframe: true, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
  private readonly observer: ResizeObserver;
  private last = 0;
  splatCount = 0;

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(CLEAR, 1);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";

    this.camera.layers.enable(HELPER_LAYER);
    this.spark = new SparkRenderer({ renderer: this.renderer });
    this.scene.add(this.spark);
    this.scene.add(this.content);
    this.scene.add(this.rig.group);
    this.rig.setLabel("1");
    this.shotCamera.rotation.order = "YXZ";
    this.shotCamera.position.set(0, 0.16, 0.8);
    this.shotCamera.layers.disable(HELPER_LAYER);
    this.displayCamera.layers.disable(HELPER_LAYER);

    this.walk = new WalkControls(this.camera, this.renderer.domElement);
    // Phase 0 start pose: 2 m from the room centre toward the front wall, looking at the back wall (raw units).
    this.walk.setPose(new THREE.Vector3(0, 0.16, 0.8), new THREE.Vector3(0, 0.16, 0));

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  private resize(): void {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame(t: number): void {
    const dt = this.last ? Math.min((t - this.last) / 1000, 0.1) : 0;
    this.last = t;
    if (!this.running) return;
    this.walk.update(dt);
    this.renderer.render(this.scene, this.activeCamera());
  }

  /** Stop or start drawing frames. The animation loop stays installed. */
  setRunning(on: boolean): void { this.running = on; this.last = 0; }
  get isRunning(): boolean { return this.running; }

  /** Shot number drawn beside the frustum in walk view. */
  setShotNumber(n: number | string): void { this.rig.setLabel(String(n)); }

  /** Redraw the frustum helper for the current shot camera and content scale. */
  syncRig(): void { this.rig.update(this.shotCamera, 0.5 * this.content.scale.x); }

  /** Size of the frame inside the viewport, the same rule as the page's frame mask (16 px margin, the shot's aspect). */
  frameSize(): { w: number; h: number } | null {
    const W = this.container.clientWidth, H = this.container.clientHeight;
    const ar = this.shotCamera.aspect;
    const L = this.frameLayout;
    const availW = W * L.availFrac - L.marginX;
    if (availW <= 0 || H <= 32) return null;
    const w = Math.min(availW, (H - 32) * ar);
    return { w, h: w / ar };
  }

  /**
   * The camera the viewport draws. In look-through it is a copy of the shot camera widened so the shot's frame
   * fills exactly the frame mask and the viewport shows a little more around it (dimmed by the mask).
   */
  private activeCamera(): THREE.PerspectiveCamera {
    this.syncRig();
    if (!this.lookThrough) return this.camera;
    const fs = this.frameSize();
    const W = this.container.clientWidth, H = this.container.clientHeight;
    if (!fs) return this.camera;
    const d = this.displayCamera;
    this.shotCamera.updateMatrixWorld(true);
    d.position.copy(this.shotCamera.position);
    d.quaternion.copy(this.shotCamera.quaternion);
    d.aspect = W / H;
    d.fov = (2 * Math.atan(Math.tan((this.shotCamera.fov * Math.PI) / 360) * (H / fs.h)) * 180) / Math.PI;
    const cx = W * this.frameLayout.cxFrac;
    if (Math.abs(cx - W / 2) > 0.5) d.setViewOffset(W, H, W / 2 - cx, 0, W, H); // principal point under the frame centre
    else d.clearViewOffset();
    d.updateProjectionMatrix();
    d.updateMatrixWorld(true);
    return d;
  }

  /** The camera the viewport shows right now, after one sync. Used by the tests. */
  currentCamera(): THREE.PerspectiveCamera { return this.activeCamera(); }

  /**
   * Let Spark sort the splats for `camera`, then draw once so the ordering is in use.
   * Spark sorts for the camera of the last render and does it asynchronously, so a grab taken straight after
   * a pose change would use the order for the previous view. Calls the public `update` and waits until
   * Spark reports it is not sorting, has nothing dirty, and its sort view matches this camera.
   */
  async settleSort(camera: THREE.PerspectiveCamera, timeoutMs = 90_000): Promise<boolean> {
    const t0 = performance.now();
    if (!this.splat) { this.lastSettle = { ok: true, ms: 0 }; return true; }
    const pos = new THREE.Vector3(), dir = new THREE.Vector3();
    for (;;) {
      this.scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      await this.spark.update({ scene: this.scene, camera });
      camera.getWorldPosition(pos);
      camera.getWorldDirection(dir);
      const s = this.spark;
      if (!s.sorting && !s.sortDirty && pos.distanceTo(s.sortedCenter) <= 0.001 && dir.dot(s.sortedDir) >= 0.999) break;
      if (performance.now() - t0 > timeoutMs) { this.lastSettle = { ok: false, ms: performance.now() - t0 }; return false; }
      await new Promise((r) => setTimeout(r, 40));
    }
    this.renderer.render(this.scene, camera); // puts the new ordering into the splat uniforms
    this.lastSettle = { ok: true, ms: performance.now() - t0 };
    return true;
  }

  /** One JPEG of the shot camera at widthPx wide, helpers hidden. Pauses the loop so no other view re-sorts the splats meanwhile. */
  async grabShot(widthPx: number): Promise<FrameGrab> {
    const wasRunning = this.running;
    this.running = false;
    try {
      const ok = await this.settleSort(this.shotCamera);
      if (!ok) throw new Error("The splats did not finish sorting for the shot camera. Try again.");
      return await grabFrame(this.renderer, this.scene, this.shotCamera, widthPx, this.shotCamera.aspect);
    } finally {
      this.running = wasRunning;
    }
  }

  /** `asType` forces the format, for an SPZ that turns out to be a PLY with the wrong extension. */
  async loadSplat(file: File, asType?: "ply" | "spz"): Promise<number> {
    const url = URL.createObjectURL(file);
    try {
      const fileType = asType ? (asType === "ply" ? SplatFileType.PLY : SplatFileType.SPZ) : fileTypeFor(file.name);
      const mesh = new SplatMesh({ url, fileType });
      await mesh.initialized;
      if (this.splat) { this.content.remove(this.splat); this.splat.dispose(); }
      mesh.rotation.x = Math.PI;
      this.content.add(mesh);
      this.splat = mesh;
      this.splatCount = mesh.numSplats;
      return this.splatCount;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async loadCollider(file: File): Promise<number> {
    const url = URL.createObjectURL(file);
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      let mesh: THREE.Mesh | null = null;
      gltf.scene.traverse((o) => { if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh; });
      if (!mesh) throw new Error("no mesh in collider file");
      const m: THREE.Mesh = mesh;
      m.material = this.colliderMat;
      m.visible = false; // raycasting ignores visibility, so the collider still picks
      m.layers.set(HELPER_LAYER);
      m.rotation.x = Math.PI;
      if (this.collider) { this.content.remove(this.collider); this.collider.geometry.dispose(); }
      this.content.add(m);
      this.collider = m;
      return (m.geometry.index?.count ?? m.geometry.attributes.position?.count ?? 0) / 3;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  get hasCollider(): boolean { return this.collider !== null; }

  /**
   * The collider's triangles in the metric world frame (the frame of shot poses and stand-in positions, floor at y = 0
   * once the scale is applied), 9 numbers each, or null when no collider is loaded. The mesh's own world matrix
   * carries the 180 degree turn about x, the scale and the ground shift, the same transform pickCollider reads.
   */
  colliderTriangles(): Float32Array | null {
    const m = this.collider;
    if (!m) return null;
    this.scene.updateMatrixWorld(true);
    const pos = m.geometry.attributes.position!;
    const index = m.geometry.index;
    const n = index ? index.count : pos.count;
    const out = new Float32Array(n * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(m.matrixWorld);
      out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
    }
    return out;
  }

  /** Take the collider out, for example when another scene is opened. */
  clearCollider(): void {
    if (!this.collider) return;
    this.content.remove(this.collider);
    this.collider.geometry.dispose();
    this.collider = null;
  }

  /** World-space box of the splat centres, or null when no splat is loaded. */
  splatBounds(): THREE.Box3 | null {
    if (!this.splat) return null;
    this.scene.updateMatrixWorld(true);
    const box = this.splat.getBoundingBox(true).clone();
    if (box.isEmpty()) return null;
    return box.applyMatrix4(this.splat.matrixWorld);
  }

  /**
   * Put the walk camera in a sensible place for a scene that has just opened: inside the splat bounds, a quarter
   * of the depth behind the centre and looking toward the scene front (world heading `frontHeadingDeg`, 0 looks
   * down -z), at 1.6 m when the scale is metric. With no metric scale the eye sits at about the share of the
   * height a 1.6 m eye has in a 3 m room, which is a guess and is not measured on a real export.
   */
  resetWalkView(frontHeadingDeg: number, metric: boolean): void {
    const box = this.splatBounds();
    if (!box) return;
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const h = (frontHeadingDeg * Math.PI) / 180;
    const dir = new THREE.Vector3(Math.sin(h), 0, -Math.cos(h)); // heading 0 looks down -z, 90 looks down +x (the same as applyPose)
    const depth = Math.abs(dir.x) * size.x + Math.abs(dir.z) * size.z;
    const pos = c.clone().addScaledVector(dir, -0.25 * depth);
    pos.x = THREE.MathUtils.clamp(pos.x, box.min.x, box.max.x);
    pos.z = THREE.MathUtils.clamp(pos.z, box.min.z, box.max.z);
    const eye = metric ? 1.6 : box.min.y + size.y * (1.6 / 3);
    this.walk.setEyeHeight(THREE.MathUtils.clamp(eye, box.min.y + 0.05 * size.y, box.max.y - 0.05 * size.y));
    this.walk.setPose(pos, pos.clone().add(dir));
  }

  /**
   * Raycast the collider through a point given in client (page) pixels.
   * Returns the hit in content-local coordinates (raw units, before scale and shift), or null on a miss or no collider.
   */
  pickCollider(clientX: number, clientY: number): THREE.Vector3 | null {
    if (!this.collider) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
    const ray = new THREE.Raycaster();
    ray.layers.enable(HELPER_LAYER); // the collider lives on the helper layer
    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true); // the camera is not in the scene, and the loop may be paused
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObject(this.collider, false)[0];
    return hit ? this.content.worldToLocal(hit.point.clone()) : null;
  }

  /** A raycaster through a client (page) pixel, using the camera now drawn: the shot camera in look-through, else the walk camera. Default layer only. */
  raycasterAt(clientX: number, clientY: number): THREE.Raycaster {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
    this.scene.updateMatrixWorld(true);
    const cam = this.activeCamera();
    cam.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, cam);
    return ray;
  }

  /** The first collider hit of a ray, with its face normal in world space turned toward the ray origin. */
  private colliderHit(ray: THREE.Raycaster): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
    if (!this.collider) return null;
    const saved = ray.layers.mask;
    ray.layers.enable(HELPER_LAYER); // the collider lives on the helper layer
    const hit = ray.intersectObject(this.collider, false)[0];
    ray.layers.mask = saved;
    if (!hit?.face) return null;
    const normal = hit.face.normal.clone().transformDirection(this.collider.matrixWorld);
    if (normal.dot(ray.ray.direction) > 0) normal.negate();
    return { point: hit.point.clone(), normal };
  }

  /**
   * A point on the floor under the pointer, in the metric world frame, through the camera now drawn.
   * A collider hit whose face normal points up (y above 0.7) wins; otherwise the plane y = 0.
   * Null when the ray misses or the point is over 50 m away.
   */
  pickFloor(clientX: number, clientY: number): THREE.Vector3 | null {
    const ray = this.raycasterAt(clientX, clientY);
    const hit = this.colliderHit(ray);
    let p: THREE.Vector3 | null = null;
    if (hit && hit.normal.y > 0.7) p = hit.point;
    else p = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    if (!p || p.distanceTo(ray.ray.origin) > 50) return null;
    return p;
  }

  /** Height of the floor under an x, z in the world frame: the first up-facing collider face below `fromY`, else 0. */
  floorHeightAt(x: number, z: number, fromY: number): number {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0));
    this.scene.updateMatrixWorld(true);
    const hit = this.colliderHit(ray);
    return hit && hit.normal.y > 0.7 ? hit.point.y : 0;
  }

  /** Client (page) pixel position of a content-local point. Used by the tests to aim real clicks. */
  localToClient(p: [number, number, number]): { x: number; y: number } {
    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    const v = this.content.localToWorld(new THREE.Vector3(...p)).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  /**
   * Scale and shift the content (splat and collider) and move the walk camera with it,
   * so the view stays where it was. `metric` says whether the units are now metres.
   */
  setScale(factor: number, groundOffsetM: number, metric: boolean): void {
    const oldS = this.content.scale.x, oldP = this.content.position.clone();
    const cam = this.camera.position;
    const lx = (cam.x - oldP.x) / oldS, lz = (cam.z - oldP.z) / oldS;
    applyScale(this.content, factor, groundOffsetM);
    cam.x = lx * factor + this.content.position.x;
    cam.z = lz * factor + this.content.position.z;
    const sc = this.shotCamera.position;
    const sx = (sc.x - oldP.x) / oldS, sz = (sc.z - oldP.z) / oldS;
    sc.x = sx * factor + this.content.position.x;
    sc.z = sz * factor + this.content.position.z;
    sc.y = metric ? 1.6 : 0.16;
    this.shotCamera.updateMatrixWorld(true);
    this.walk.speed = this.walk.speed / oldS * factor;
    this.walk.setEyeHeight(metric ? 1.6 : 0.16);
    this.afterScale.forEach((fn) => fn());
  }

  setColliderVisible(on: boolean): void {
    if (this.collider) this.collider.visible = on;
  }

  /** True when the canvas holds any pixel other than the clear colour. Renders one frame first. */
  hasContent(): boolean {
    this.renderer.render(this.scene, this.camera);
    const gl = this.renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(4);
    for (const fx of [0.2, 0.35, 0.5, 0.65, 0.8]) for (const fy of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      gl.readPixels(Math.floor(w * fx), Math.floor(h * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (Math.abs(px[0]! - 0x4a) > 2 || Math.abs(px[1]! - 0x4d) > 2 || Math.abs(px[2]! - 0x53) > 2) return true;
    }
    return false;
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.observer.disconnect();
    this.walk.dispose();
    this.rig.dispose();
    this.splat?.dispose();
    this.collider?.geometry.dispose();
    this.colliderMat.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
