import * as THREE from "three";
import { RUNOFF, Track } from "./track";

export interface World {
  scene: THREE.Scene;
  dispose: () => void;
}

/** sky, lights, ground, trees, grandstands and banners around a track */
export function buildWorld(track: Track): World {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87bfe8);
  scene.fog = new THREE.Fog(0x9cc8e8, 600, 2400);

  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x3e5f33, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3d6, 1.5);
  sun.position.set(300, 500, 200);
  scene.add(sun);

  const disposables: { dispose(): void }[] = [];
  const rand = makeRandom(424243);

  scene.add(buildSky(disposables));
  scene.add(buildClouds(disposables, rand));
  scene.add(buildGround(disposables));
  scene.add(buildTrees(track, disposables, rand));
  scene.add(buildGrandstands(track, disposables, rand));
  scene.add(buildBanners(track, disposables, rand));

  return {
    scene,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}

function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

/** vertical gradient dome — deeper blue overhead, hazy at the horizon */
function buildSky(disposables: { dispose(): void }[]) {
  const geo = new THREE.SphereGeometry(2900, 24, 12);
  const posAttr = geo.getAttribute("position");
  const colors: number[] = [];
  const top = new THREE.Color(0x4a93d8);
  const horizon = new THREE.Color(0xb8d9ee);
  const c = new THREE.Color();
  for (let i = 0; i < posAttr.count; i++) {
    const t = Math.max(0, Math.min(1, posAttr.getY(i) / 2900));
    c.copy(horizon).lerp(top, Math.pow(t, 0.55));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  });
  disposables.push(geo, mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1;
  return mesh;
}

function buildClouds(disposables: { dispose(): void }[], rand: () => number) {
  const group = new THREE.Group();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  for (let i = 0; i < 14; i++) {
    const x = 24 + Math.random() * 80;
    const y = 44 + Math.random() * 36;
    const r = 14 + Math.random() * 22;
    const g = ctx.createRadialGradient(x, y, 2, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  disposables.push(tex, mat);
  for (let i = 0; i < 10; i++) {
    const sprite = new THREE.Sprite(mat);
    const ang = rand() * Math.PI * 2;
    const dist = 900 + rand() * 1300;
    sprite.position.set(
      Math.cos(ang) * dist,
      230 + rand() * 200,
      Math.sin(ang) * dist,
    );
    const sc = 320 + rand() * 380;
    sprite.scale.set(sc, sc * 0.42, 1);
    group.add(sprite);
  }
  return group;
}

function buildGround(disposables: { dispose(): void }[]) {
  // subtle mottled grass so the infield isn't a flat color
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#4d8a3d";
  ctx.fillRect(0, 0, 256, 256);
  let seed = 77;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 1600; i++) {
    const g = 120 + rnd() * 40;
    ctx.fillStyle = `rgba(${50 + rnd() * 30},${g},${45 + rnd() * 25},0.5)`;
    ctx.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 4, 2 + rnd() * 4);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(140, 140);

  const geo = new THREE.CircleGeometry(3200, 48);
  const mat = new THREE.MeshLambertMaterial({ map: tex, color: 0xdfffd0 });
  disposables.push(geo, mat, tex);
  const ground = new THREE.Mesh(geo, mat);
  ground.rotation.x = -Math.PI / 2;
  return ground;
}

/** low-poly trees scattered outside the walls, deterministic placement */
function buildTrees(
  track: Track,
  disposables: { dispose(): void }[],
  rand: () => number,
) {
  const group = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.38, 2.4, 7);
  const crownGeo = new THREE.ConeGeometry(2.4, 5.5, 8);
  const crown2Geo = new THREE.ConeGeometry(1.8, 3.6, 8);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2c });
  const crownMat = new THREE.MeshLambertMaterial({ color: 0x2f6b2a });
  const crown2Mat = new THREE.MeshLambertMaterial({ color: 0x3d7c33 });
  disposables.push(trunkGeo, crownGeo, crown2Geo, trunkMat, crownMat, crown2Mat);

  const spots: { x: number; z: number; s: number }[] = [];
  const samples = track.samples;
  for (let i = 0; i < samples.length; i += 14) {
    const p = samples[i];
    for (const side of [1, -1]) {
      if (rand() < 0.45) continue;
      const w = (side === 1 ? p.wn : p.wp) + RUNOFF;
      const d = w + 12 + rand() * 60;
      const x = p.x + p.nx * side * d + (rand() - 0.5) * 14;
      const z = p.z + p.nz * side * d + (rand() - 0.5) * 14;
      const near = track.nearest(x, z, i);
      const sNear = samples[near.idx];
      const limit = (near.lateral > 0 ? sNear.wn : sNear.wp) + RUNOFF + 6;
      if (Math.abs(near.lateral) < limit) continue;
      spots.push({ x, z, s: 0.8 + rand() * 0.8 });
    }
  }

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, spots.length);
  const crowns2 = new THREE.InstancedMesh(crown2Geo, crown2Mat, spots.length);
  const mat4 = new THREE.Matrix4();
  spots.forEach((t, i) => {
    mat4.makeScale(t.s, t.s, t.s);
    mat4.setPosition(t.x, 1.2 * t.s, t.z);
    trunks.setMatrixAt(i, mat4);
    mat4.setPosition(t.x, 4.2 * t.s, t.z);
    crowns.setMatrixAt(i, mat4);
    mat4.setPosition(t.x, 7.0 * t.s, t.z);
    crowns2.setMatrixAt(i, mat4);
  });
  group.add(trunks, crowns, crowns2);
  return group;
}

/** a few grandstands with a noisy "crowd" texture, facing the track */
function buildGrandstands(
  track: Track,
  disposables: { dispose(): void }[],
  rand: () => number,
) {
  const group = new THREE.Group();
  const s = track.samples;
  const m = s.length;

  // crowd: random colored specks on dark steps
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#2c2c34";
  ctx.fillRect(0, 0, 128, 64);
  const palette = ["#e3483e", "#3d6fd4", "#e8d34c", "#e8e8ee", "#43b65a", "#d97c2e", "#9b59d0"];
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = palette[Math.floor(rand() * palette.length)];
    ctx.fillRect(rand() * 128, rand() * 64, 2, 2);
  }
  const crowdTex = new THREE.CanvasTexture(canvas);
  crowdTex.wrapS = THREE.RepeatWrapping;
  crowdTex.repeat.set(2, 1);

  const standGeo = new THREE.BoxGeometry(26, 0.8, 8);
  const seatGeo = new THREE.PlaneGeometry(26, 9);
  const roofGeo = new THREE.BoxGeometry(27, 0.25, 9);
  const postGeo = new THREE.CylinderGeometry(0.12, 0.12, 7);
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x8d939e });
  const seatMat = new THREE.MeshLambertMaterial({ map: crowdTex });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0xe8e8ec });
  disposables.push(standGeo, seatGeo, roofGeo, postGeo, frameMat, seatMat, roofMat, crowdTex);

  // 6 stands spread around the lap, placed where there's room
  let placed = 0;
  for (let attempt = 0; attempt < 24 && placed < 6; attempt++) {
    const i = Math.floor(((attempt * 0.41 + rand() * 0.05) % 1) * m);
    const p = s[i];
    const side = attempt % 2 === 0 ? 1 : -1;
    const w = (side === 1 ? p.wn : p.wp) + RUNOFF;
    const d = w + 14;
    const x = p.x + p.nx * side * d;
    const z = p.z + p.nz * side * d;
    const near = track.nearest(x, z, i);
    const sNear = s[near.idx];
    const clear = (near.lateral > 0 ? sNear.wn : sNear.wp) + RUNOFF + 9;
    if (Math.abs(near.lateral) < clear) continue;

    const stand = new THREE.Group();
    const facing = Math.atan2(p.nx * side, p.nz * side) + Math.PI;
    const base = new THREE.Mesh(standGeo, frameMat);
    base.position.y = 0.4;
    stand.add(base);
    const seats = new THREE.Mesh(seatGeo, seatMat);
    seats.position.set(0, 3.1, 1.8);
    seats.rotation.x = -0.62;
    stand.add(seats);
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(0, 7.0, 1.5);
    stand.add(roof);
    for (const px of [-12, 0, 12]) {
      const post = new THREE.Mesh(postGeo, frameMat);
      post.position.set(px, 3.5, 4.8);
      stand.add(post);
    }
    stand.position.set(x, 0, z);
    stand.rotation.y = facing;
    group.add(stand);
    placed++;
  }
  return group;
}

/** sponsor-style banner boards riding the top of the barriers on straights */
function buildBanners(
  track: Track,
  disposables: { dispose(): void }[],
  rand: () => number,
) {
  const group = new THREE.Group();
  const s = track.samples;
  const m = s.length;
  const texts = ["F1 WEB RACER", "TURBO COLA", "PIT-STOP", "WEB GP", "VROOM"];
  const colors = [
    ["#e10600", "#ffffff"],
    ["#143a8c", "#ffd23c"],
    ["#0e0e12", "#3ddc6a"],
    ["#e8e8ec", "#16161c"],
    ["#d97c2e", "#16161c"],
  ];

  const mats = texts.map((t, i) => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 40;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = colors[i][0];
    ctx.fillRect(0, 0, 256, 40);
    ctx.fillStyle = colors[i][1];
    ctx.font = "900 26px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(t, 128, 21);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    disposables.push(tex, mat);
    return mat;
  });
  const geo = new THREE.PlaneGeometry(7, 0.85);
  disposables.push(geo);

  for (let i = 0; i < m; i += 26) {
    const p = s[i];
    if (Math.abs(p.curv) > 0.004) continue; // straights only
    if (rand() < 0.4) continue;
    const side = rand() < 0.5 ? 1 : -1;
    const w = (side === 1 ? p.wn : p.wp) + RUNOFF;
    const banner = new THREE.Mesh(geo, mats[Math.floor(rand() * mats.length)]);
    // seated on the barrier top, readable side toward the track
    banner.position.set(p.x + p.nx * side * w, 1.41, p.z + p.nz * side * w);
    banner.rotation.y = Math.atan2(-side * p.nx, -side * p.nz);
    group.add(banner);
  }
  return group;
}
