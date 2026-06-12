import * as THREE from "three";
import { RUNOFF, Track } from "./track";

export interface World {
  scene: THREE.Scene;
  dispose: () => void;
}

/** sky, lights, ground and scattered trees around a track */
export function buildWorld(track: Track): World {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fc4e8);
  scene.fog = new THREE.Fog(0x8fc4e8, 600, 2200);

  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x3e5f33, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3d6, 1.45);
  sun.position.set(300, 500, 200);
  scene.add(sun);

  const disposables: { dispose(): void }[] = [];

  const groundGeo = new THREE.CircleGeometry(3200, 48);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x4d8a3d });
  disposables.push(groundGeo, groundMat);
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  scene.add(buildTrees(track, disposables));

  return {
    scene,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}

/** low-poly trees scattered outside the walls, deterministic placement */
function buildTrees(track: Track, disposables: { dispose(): void }[]) {
  const group = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.4);
  const crownGeo = new THREE.ConeGeometry(2.4, 5.5, 7);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2c });
  const crownMat = new THREE.MeshLambertMaterial({ color: 0x2f6b2a });
  disposables.push(trunkGeo, crownGeo, trunkMat, crownMat);

  const spots: { x: number; z: number; s: number }[] = [];
  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  const samples = track.samples;
  for (let i = 0; i < samples.length; i += 14) {
    const p = samples[i];
    for (const side of [1, -1]) {
      if (rand() < 0.45) continue;
      const w = (side === 1 ? p.wn : p.wp) + RUNOFF;
      const d = w + 12 + rand() * 60;
      const x = p.x + p.nx * side * d + (rand() - 0.5) * 14;
      const z = p.z + p.nz * side * d + (rand() - 0.5) * 14;
      // keep clear of other parts of the track (hairpins, parallel straights)
      const near = track.nearest(x, z, i);
      const s = samples[near.idx];
      const limit = (near.lateral > 0 ? s.wn : s.wp) + RUNOFF + 6;
      if (Math.abs(near.lateral) < limit) continue;
      spots.push({ x, z, s: 0.8 + rand() * 0.8 });
    }
  }

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, spots.length);
  const mat4 = new THREE.Matrix4();
  spots.forEach((t, i) => {
    mat4.makeScale(t.s, t.s, t.s);
    mat4.setPosition(t.x, 1.2 * t.s, t.z);
    trunks.setMatrixAt(i, mat4);
    mat4.makeScale(t.s, t.s, t.s);
    mat4.setPosition(t.x, (2.4 + 2.2) * t.s, t.z);
    crowns.setMatrixAt(i, mat4);
  });
  group.add(trunks, crowns);
  return group;
}
