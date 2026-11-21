import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

const status = document.getElementById("status");
const params = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 200);
camera.position.set(0, 0, 4);

const spark = new SparkRenderer({ renderer });
scene.add(spark);

addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

let current = null;
function setMesh(mesh) {
  if (current) { scene.remove(current); current.dispose?.(); }
  current = mesh;
  scene.add(mesh);
}

// Procedural test splats: a few hundred coloured points on a sphere.
function demoSplats() {
  return new SplatMesh({
    constructSplats: (splats) => {
      const c = new THREE.Vector3(), s = new THREE.Vector3(0.06, 0.06, 0.06);
      const q = new THREE.Quaternion(), col = new THREE.Color();
      for (let i = 0; i < 400; i++) {
        c.randomDirection().multiplyScalar(1);
        col.setHSL(i / 400, 0.8, 0.55);
        splats.pushSplat(c, s, q, 0.9, col);
      }
    },
  });
}

async function loadFile(file) {
  status.textContent = "loading " + file.name;
  const mesh = new SplatMesh({ fileBytes: await file.arrayBuffer(), fileName: file.name });
  await mesh.initialized;
  setMesh(mesh);
  status.textContent = `${file.name}: ${mesh.numSplats} splats`;
}

async function loadUrl(url) {
  status.textContent = "loading " + url;
  const mesh = new SplatMesh({ url });
  await mesh.initialized;
  setMesh(mesh);
  status.textContent = `${url}: ${mesh.numSplats} splats`;
}

document.getElementById("file").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (f) loadFile(f).catch((err) => { status.textContent = "failed: " + err.message; console.error(err); });
});

if (params.get("demo")) {
  const m = demoSplats();
  setMesh(m);
  m.initialized.then(() => { status.textContent = `demo: ${m.numSplats} splats`; window.__demoCount = m.numSplats; });
} else if (params.get("src")) {
  loadUrl(params.get("src")).catch((err) => { status.textContent = "failed: " + err.message; console.error(err); });
}

renderer.setAnimationLoop(() => {
  if (current) current.rotation.y += 0.005;
  renderer.render(scene, camera);
});
