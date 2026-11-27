// Meshes for the stand-ins. The capsule and the floor arrow are scene content and appear in the frame grab.
// The name label and the selection ring are on the helper layer, so a grab never shows them.
import * as THREE from "three";
import type { StandIn } from "../model/types";

const FIGURE_GREY = 0xd9dce1;
const DEG = Math.PI / 180;

type Entry = {
  group: THREE.Group;
  body: THREE.Mesh;
  arrow: THREE.Mesh;
  ring: THREE.Mesh;
  label: THREE.Sprite;
  labelText: string;
  height: number;
};

function arrowGeometry(): THREE.BufferGeometry {
  // Flat triangle in the xz plane, tip 0.45 m ahead of the feet (toward -z at heading 0), base 0.10 m ahead: 0.35 m long.
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, -0.45, -0.1, 0, -0.1, 0.1, 0, -0.1], 3));
  g.setIndex([0, 1, 2]);
  return g;
}

function labelTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "rgba(20,22,25,0.75)";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#eceef1";
  ctx.font = "600 30px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.length > 18 ? text.slice(0, 17) + "..." : text, c.width / 2, c.height / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class StandInFigures {
  private readonly entries = new Map<string, Entry>();
  private readonly group = new THREE.Group();
  private readonly bodyMat = new THREE.MeshLambertMaterial({ color: FIGURE_GREY });
  private readonly arrowMat = new THREE.MeshBasicMaterial({ color: FIGURE_GREY, side: THREE.DoubleSide });
  private readonly ringMat = new THREE.MeshBasicMaterial({ color: 0x86adff, side: THREE.DoubleSide, depthTest: false, transparent: true });
  private readonly arrowGeo = arrowGeometry();
  private readonly ringGeo = new THREE.RingGeometry(0.34, 0.4, 48);

  constructor(private readonly scene: THREE.Scene, private readonly helperLayer: number) {
    this.group.name = "stand-ins";
    // Fixed world-space lights, so the figure shades the same in the Stage and in the frame grab (both render this scene).
    // Every other material in the scene is unlit, so these lights touch only the figures. A side of the body facing
    // the camera comes out a little darker than FIGURE_GREY and the top and the lit side a little lighter.
    const fill = new THREE.HemisphereLight(0xffffff, 0x6a6e75, 2);
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(-0.6, 1, 0.8);
    this.group.add(fill, key);
    scene.add(this.group);
  }

  /** Add, move, resize and remove meshes so they match `list`. `frontHeadingDeg` turns a stand-in's facing into a world heading. */
  sync(list: StandIn[], selectedId: string | null, frontHeadingDeg = 0): void {
    const keep = new Set(list.map((s) => s.id));
    for (const [id, e] of this.entries) if (!keep.has(id)) this.drop(id, e);
    for (const s of list) {
      let e = this.entries.get(s.id);
      if (!e || e.height !== s.heightM) {
        if (e) this.dropMeshes(e);
        e = this.build(s);
        this.entries.set(s.id, e);
      }
      const [x, y, z] = s.positionM;
      e.group.position.set(x, y, z);
      e.arrow.rotation.y = -(s.headingDeg + frontHeadingDeg) * DEG;
      e.ring.visible = s.id === selectedId;
      if (e.labelText !== s.label) {
        (e.label.material.map as THREE.Texture).dispose();
        e.label.material.map = labelTexture(s.label);
        e.label.material.needsUpdate = true;
        e.labelText = s.label;
      }
    }
  }

  private build(s: StandIn): Entry {
    const h = s.heightM, r = 0.12 * h;
    const group = this.entries.get(s.id)?.group ?? new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, h - 2 * r), 8, 24), this.bodyMat);
    body.position.y = h / 2;
    body.userData.standInId = s.id;
    const arrow = new THREE.Mesh(this.arrowGeo, this.arrowMat);
    arrow.position.y = 0.02;
    const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    ring.layers.set(this.helperLayer);
    ring.renderOrder = 10;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(s.label), depthTest: false, transparent: true }));
    label.scale.set(0.8, 0.2, 1);
    label.position.y = h + 0.2;
    label.layers.set(this.helperLayer);
    label.renderOrder = 11;
    group.add(body, arrow, ring, label);
    if (!group.parent) this.group.add(group);
    return { group, body, arrow, ring, label, labelText: s.label, height: h };
  }

  /** Remove the children of an entry but keep its group, for a resize. */
  private dropMeshes(e: Entry): void {
    e.body.geometry.dispose();
    (e.label.material.map as THREE.Texture | null)?.dispose();
    e.label.material.dispose();
    e.group.remove(e.body, e.arrow, e.ring, e.label);
  }

  private drop(id: string, e: Entry): void {
    this.dropMeshes(e);
    this.group.remove(e.group);
    this.entries.delete(id);
  }

  /** The stand-in under a ray, nearest first. */
  idAt(raycaster: THREE.Raycaster): string | null {
    const bodies = [...this.entries.values()].map((e) => e.body);
    const hit = raycaster.intersectObjects(bodies, false)[0];
    return hit ? (hit.object.userData.standInId as string) : null;
  }

  dispose(): void {
    for (const [id, e] of [...this.entries]) this.drop(id, e);
    this.scene.remove(this.group);
    this.bodyMat.dispose();
    this.arrowMat.dispose();
    this.ringMat.dispose();
    this.arrowGeo.dispose();
    this.ringGeo.dispose();
  }
}
