import * as THREE from "three";
import { DOWNFORCE, DOWNFORCE_MAX, GRIP_BASE } from "./physics";
import { KERB_W, RUNOFF, Track } from "./track";

export interface TrackVisual {
  group: THREE.Group;
  /** 5 start lights, index 0..4; tint via setStartLights */
  setStartLights: (lit: number, green: boolean) => void;
  dispose: () => void;
}

const ROAD_Y = 0.02;

export function buildTrackVisual(track: Track): TrackVisual {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];

  group.add(buildRoad(track, disposables));
  group.add(buildEdgeLines(track, disposables));
  group.add(buildKerbs(track, disposables));
  group.add(buildWalls(track, disposables));
  group.add(buildStartLine(track, disposables));
  group.add(buildGridSlots(track, disposables));
  group.add(buildBrakeMarkers(track, disposables));

  const { gantry, setStartLights } = buildGantry(track, disposables);
  group.add(gantry);
  setStartLights(0, false);

  return {
    group,
    setStartLights,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

function buildRoad(track: Track, disposables: { dispose(): void }[]) {
  const s = track.samples;
  const m = s.length;
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();

  // 6 verts per sample: paved runoff | racing surface | paved runoff,
  // with duplicated boundary verts so the color edge stays crisp
  const V = 6;
  for (let i = 0; i < m; i++) {
    const p = s[i];
    const offsets = [
      p.wn + RUNOFF, p.wn, p.wn, -p.wp, -p.wp, -(p.wp + RUNOFF),
    ];
    for (const o of offsets) {
      pos.push(p.x + p.nx * o, ROAD_Y, p.z + p.nz * o);
      uv.push(o / 9, p.dist / 9); // tiling coords for the asphalt grain
    }
    // subtle banded shade variation so the asphalt isn't flat
    const wobble = 0.018 * Math.sin(i * 0.7) + (0.012 * ((i * 7919) % 13)) / 13;
    const road = 0.21 + wobble;
    const runoff = 0.31 + wobble;
    c.setRGB(runoff, runoff, runoff + 0.008);
    col.push(c.r, c.g, c.b, c.r, c.g, c.b); // runoff pair (outer, inner)
    c.setRGB(road, road, road + 0.012);
    col.push(c.r, c.g, c.b, c.r, c.g, c.b); // racing surface pair
    c.setRGB(runoff, runoff, runoff + 0.008);
    col.push(c.r, c.g, c.b, c.r, c.g, c.b); // runoff pair
    const j = (i + 1) % m;
    for (const k of [0, 2, 4]) {
      const a = i * V + k;
      const b = j * V + k;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // track direction (CW vs CCW) varies per circuit, so the winding isn't
  // guaranteed — render both faces
  const grain = makeAsphaltTexture();
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    map: grain, // near-white noise, multiplies the vertex tint
    side: THREE.DoubleSide,
  });
  disposables.push(geo, mat, grain);
  return new THREE.Mesh(geo, mat);
}

/** subtle tiling noise so the asphalt has visible grain */
function makeAsphaltTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(128, 128);
  let seed = 9001;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < img.data.length; i += 4) {
    const n = 205 + rand() * 50;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** continuous white boundary lines at the racing-surface edges */
function buildEdgeLines(track: Track, disposables: { dispose(): void }[]) {
  const s = track.samples;
  const m = s.length;
  const pos: number[] = [];
  const idx: number[] = [];

  for (const side of [1, -1]) {
    const offset = pos.length / 3;
    for (let i = 0; i <= m; i++) {
      const p = s[i % m];
      const w = side === 1 ? p.wn : p.wp;
      for (const o of [w - 0.45, w - 0.12]) {
        pos.push(
          p.x + p.nx * side * o,
          ROAD_Y + 0.008,
          p.z + p.nz * side * o,
        );
      }
      if (i > 0) {
        const a = offset + (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xdedede,
    side: THREE.DoubleSide,
  });
  disposables.push(geo, mat);
  return new THREE.Mesh(geo, mat);
}

function buildKerbs(track: Track, disposables: { dispose(): void }[]) {
  const s = track.samples;
  const m = s.length;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const red = new THREE.Color(0xd8262a);
  const white = new THREE.Color(0xe8e8e8);

  // mark kerb zones around tight-enough corners, padded a few samples
  const kerb = new Array<boolean>(m).fill(false);
  for (let i = 0; i < m; i++) {
    if (Math.abs(s[i].curv) > 0.011) {
      for (let k = -4; k <= 4; k++) kerb[(i + k + m) % m] = true;
    }
  }

  // raised profile: road edge -> crest at mid-kerb -> back down outside,
  // so kerbs read as 3D rumble strips instead of painted stripes
  const V = 3; // verts per sample
  for (const side of [1, -1]) {
    let run: number[] = [];
    const flush = () => {
      if (run.length < 2) {
        run = [];
        return;
      }
      const base = pos.length / 3;
      for (let r = 0; r < run.length; r++) {
        const i = run[r];
        const p = s[i];
        const w = side === 1 ? p.wn : p.wp;
        const ix = p.x + p.nx * side * w;
        const iz = p.z + p.nz * side * w;
        const mx = ix + p.nx * side * KERB_W * 0.45;
        const mz = iz + p.nz * side * KERB_W * 0.45;
        const ox = ix + p.nx * side * KERB_W;
        const oz = iz + p.nz * side * KERB_W;
        pos.push(ix, ROAD_Y + 0.012, iz, mx, ROAD_Y + 0.085, mz, ox, ROAD_Y + 0.015, oz);
        const c = Math.floor(i / 2) % 2 === 0 ? red : white;
        for (let v = 0; v < V; v++) col.push(c.r, c.g, c.b);
        if (r > 0) {
          const a = base + (r - 1) * V;
          for (const k of [0, 1]) {
            idx.push(a + k, a + k + 1, a + k + V, a + k + V, a + k + 1, a + k + V + 1);
          }
        }
      }
      run = [];
    };
    for (let i = 0; i < m; i++) {
      if (kerb[i]) run.push(i);
      else flush();
    }
    flush();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  disposables.push(geo, mat);
  return new THREE.Mesh(geo, mat);
}

function buildWalls(track: Track, disposables: { dispose(): void }[]) {
  const s = track.samples;
  const m = s.length;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  // unlit, pre-shaded barrier blocks: alternating red/white sections with a
  // darker base — reads cleanly at speed from any angle
  const blockA = new THREE.Color(0xe4e4e8);
  const blockB = new THREE.Color(0xd23434);
  const tmp = new THREE.Color();
  const H = 1.0;
  const BLOCK = 12; // samples per color block (~36m)

  for (const side of [1, -1]) {
    const offset = pos.length / 3;
    for (let i = 0; i <= m; i++) {
      const p = s[i % m];
      const w = (side === 1 ? p.wn : p.wp) + RUNOFF;
      const x = p.x + p.nx * side * w;
      const z = p.z + p.nz * side * w;
      pos.push(x, 0, z, x, H, z);
      const c = Math.floor(i / BLOCK) % 2 === 0 ? blockA : blockB;
      tmp.copy(c).multiplyScalar(0.72); // shaded base
      col.push(tmp.r, tmp.g, tmp.b, c.r, c.g, c.b);
      if (i > 0) {
        const a = offset + (i - 1) * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  disposables.push(geo, mat);
  return new THREE.Mesh(geo, mat);
}

function buildStartLine(track: Track, disposables: { dispose(): void }[]) {
  const s0 = track.samples[0];
  const width = s0.wn + s0.wp + RUNOFF * 2; // span the full paved surface

  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 32;
  const ctx = canvas.getContext("2d")!;
  const cell = 8;
  for (let y = 0; y < canvas.height / cell; y++) {
    for (let x = 0; x < canvas.width / cell; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? "#f2f2f2" : "#101010";
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);

  const geo = new THREE.PlaneGeometry(width, 4);
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  disposables.push(geo, mat, tex);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = -Math.atan2(s0.tx, s0.tz);
  // center the strip on the road (widths can be asymmetric)
  mesh.position.set(
    s0.x + s0.nx * (s0.wn - s0.wp) * 0.5,
    ROAD_Y + 0.02,
    s0.z + s0.nz * (s0.wn - s0.wp) * 0.5,
  );
  return mesh;
}

/**
 * Painted starting-grid boxes behind the line — 12 slots in two staggered
 * columns, matching the spawn poses from Track.gridSlot().
 */
function buildGridSlots(track: Track, disposables: { dispose(): void }[]) {
  const pos: number[] = [];
  const idx: number[] = [];
  const Y = ROAD_Y + 0.006;
  const LINE_W = 0.18; // painted line thickness
  const BOX_W = 2.6; // slot width
  const BOX_L = 4.6; // side-line length

  // one painted bar from (ax,az) to (bx,bz), `w` wide
  const bar = (ax: number, az: number, bx: number, bz: number, w: number) => {
    let px = bz - az;
    let pz = -(bx - ax);
    const l = Math.hypot(px, pz) || 1;
    px = (px / l) * w * 0.5;
    pz = (pz / l) * w * 0.5;
    const base = pos.length / 3;
    pos.push(
      ax + px, Y, az + pz,
      ax - px, Y, az - pz,
      bx + px, Y, bz + pz,
      bx - px, Y, bz - pz,
    );
    idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  };

  for (let slot = 0; slot < 12; slot++) {
    const g = track.gridSlot(slot);
    const fx = Math.sin(g.heading);
    const fz = Math.cos(g.heading);
    const lx = fz;
    const lz = -fx;
    // front bar sits ahead of the car's nose
    const frontX = g.x + fx * (BOX_L * 0.55);
    const frontZ = g.z + fz * (BOX_L * 0.55);
    bar(
      frontX + lx * (BOX_W / 2), frontZ + lz * (BOX_W / 2),
      frontX - lx * (BOX_W / 2), frontZ - lz * (BOX_W / 2),
      LINE_W,
    );
    // two side lines running back from the front bar
    for (const side of [1, -1]) {
      const sx = frontX + lx * side * (BOX_W / 2);
      const sz = frontZ + lz * side * (BOX_W / 2);
      bar(sx, sz, sx - fx * BOX_L, sz - fz * BOX_L, LINE_W);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xe6e6e6,
    side: THREE.DoubleSide,
  });
  disposables.push(geo, mat);
  return new THREE.Mesh(geo, mat);
}

/**
 * Trackside braking boards (150/100/50) before every braking-zone corner,
 * on the outside of the turn — reference points for drivers who race with
 * the assist line off, like the real thing.
 */
function buildBrakeMarkers(track: Track, disposables: { dispose(): void }[]) {
  const group = new THREE.Group();
  const s = track.samples;
  const m = s.length;

  // corner = sample whose grip-model speed ceiling is low enough to need
  // real braking on approach
  const slow = new Array<boolean>(m);
  for (let i = 0; i < m; i++) {
    const c = Math.abs(s[i].curv);
    let vMax = 999;
    if (c > DOWNFORCE * 1.05) {
      let v2 = GRIP_BASE / (c - DOWNFORCE);
      if (DOWNFORCE * v2 > DOWNFORCE_MAX) v2 = (GRIP_BASE + DOWNFORCE_MAX) / c;
      vMax = Math.sqrt(v2);
    }
    slow[i] = vMax < 58; // ~210 km/h
  }

  // zone starts, merging anything closer than ~90m into one zone
  const starts: number[] = [];
  for (let i = 0; i < m; i++) {
    if (slow[i] && !slow[(i - 1 + m) % m]) {
      const prev = starts.length ? starts[starts.length - 1] : -1e9;
      if (i - prev > 30) starts.push(i);
    }
  }

  const labels = ["50", "100", "150"];
  const textures = labels.map((t) => makeBoardTexture(t));
  textures.forEach((t) => disposables.push(t));
  const boardGeo = new THREE.PlaneGeometry(2.6, 1.8);
  const postGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.8);
  const postMat = new THREE.MeshLambertMaterial({ color: 0x33333c });
  disposables.push(boardGeo, postGeo, postMat);
  const mats = textures.map((tex) => {
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    disposables.push(mat);
    return mat;
  });

  const SPACING_M = track.length / m;
  for (const start of starts) {
    // boards go on the outside of the upcoming corner
    const apex = s[(start + 8) % m];
    const outside = Math.sign(apex.curv) || 1;
    for (let b = 0; b < labels.length; b++) {
      const back = Math.round((50 + b * 50) / SPACING_M);
      const i = (start - back + m) % m;
      const p = s[i];
      const w = (outside === 1 ? p.wn : p.wp) + RUNOFF - 0.6;
      const x = p.x + p.nx * outside * w;
      const z = p.z + p.nz * outside * w;
      const facing = Math.atan2(p.tx, p.tz) + Math.PI; // face oncoming cars

      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(x, 0.9, z);
      group.add(post);
      const board = new THREE.Mesh(boardGeo, mats[b]);
      board.position.set(x, 2.7, z);
      board.rotation.y = facing;
      group.add(board);
    }
  }
  return group;
}

function makeBoardTexture(label: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 176;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f5f5f7";
  ctx.fillRect(0, 0, 256, 176);
  ctx.strokeStyle = "#101014";
  ctx.lineWidth = 14;
  ctx.strokeRect(0, 0, 256, 176);
  ctx.fillStyle = "#101014";
  ctx.font = "900 104px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 128, 96);
  return new THREE.CanvasTexture(canvas);
}

const LIGHT_OFF = 0x230a0a;
const LIGHT_RED = 0xff2014;
const LIGHT_GREEN = 0x2bee54;

function buildGantry(track: Track, disposables: { dispose(): void }[]) {
  const s0 = track.samples[0];
  const gantry = new THREE.Group();
  const heading = Math.atan2(s0.tx, s0.tz);
  const cxp = s0.x + s0.nx * ((s0.wn - s0.wp) * 0.5);
  const czp = s0.z + s0.nz * ((s0.wn - s0.wp) * 0.5);
  const span = s0.wn + s0.wp + RUNOFF * 2;

  const darkMat = new THREE.MeshLambertMaterial({ color: 0x23232b });
  const blackMat = new THREE.MeshLambertMaterial({ color: 0x0e0e12 });
  const poleGeo = new THREE.CylinderGeometry(0.16, 0.2, 6.7);
  const barGeo = new THREE.BoxGeometry(span + 2, 0.45, 0.45);
  const housingGeo = new THREE.BoxGeometry(7.6, 2.1, 0.55);
  const podGeo = new THREE.BoxGeometry(1.2, 1.9, 0.35);
  const bulbGeo = new THREE.CircleGeometry(0.31, 18);
  disposables.push(darkMat, blackMat, poleGeo, barGeo, housingGeo, podGeo, bulbGeo);

  // support posts outside the walls + truss bar over the track
  for (const side of [1, -1]) {
    const pole = new THREE.Mesh(poleGeo, darkMat);
    const w = (side === 1 ? s0.wn : s0.wp) + RUNOFF + 0.8;
    pole.position.set(s0.x + s0.nx * side * w, 3.35, s0.z + s0.nz * side * w);
    gantry.add(pole);
  }
  const bar = new THREE.Mesh(barGeo, darkMat);
  bar.position.set(cxp, 6.5, czp);
  bar.rotation.y = heading;
  gantry.add(bar);

  // light housing hanging under the bar, facing the grid
  const housing = new THREE.Mesh(housingGeo, darkMat);
  housing.position.set(cxp, 5.3, czp);
  housing.rotation.y = heading;
  gantry.add(housing);

  // glow sprite texture: soft radial falloff
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = glowCanvas.height = 64;
  const gctx = glowCanvas.getContext("2d")!;
  const grad = gctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  gctx.fillStyle = grad;
  gctx.fillRect(0, 0, 64, 64);
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  disposables.push(glowTex);

  // 5 pods x 2 bulbs, real F1 style; bulbs face back toward the grid
  const backX = Math.sin(heading);
  const backZ = Math.cos(heading);
  const columns: { bulbs: THREE.MeshBasicMaterial[]; glows: THREE.Sprite[] }[] = [];
  for (let i = 0; i < 5; i++) {
    const off = (i - 2) * 1.45;
    const px = cxp + s0.nx * off;
    const pz = czp + s0.nz * off;
    const pod = new THREE.Mesh(podGeo, blackMat);
    pod.position.set(px - backX * 0.18, 5.3, pz - backZ * 0.18);
    pod.rotation.y = heading;
    gantry.add(pod);

    const bulbs: THREE.MeshBasicMaterial[] = [];
    const glows: THREE.Sprite[] = [];
    for (const dy of [0.42, -0.42]) {
      const mat = new THREE.MeshBasicMaterial({
        color: LIGHT_OFF,
        side: THREE.DoubleSide,
      });
      disposables.push(mat);
      const bulb = new THREE.Mesh(bulbGeo, mat);
      bulb.position.set(px - backX * 0.4, 5.3 + dy, pz - backZ * 0.4);
      bulb.rotation.y = heading + Math.PI;
      gantry.add(bulb);
      bulbs.push(mat);

      const glowMat = new THREE.SpriteMaterial({
        map: glowTex,
        color: LIGHT_RED,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      });
      disposables.push(glowMat);
      const glow = new THREE.Sprite(glowMat);
      glow.scale.setScalar(1.9);
      glow.position.set(px - backX * 0.6, 5.3 + dy, pz - backZ * 0.6);
      glow.visible = false;
      gantry.add(glow);
      glows.push(glow);
    }
    columns.push({ bulbs, glows });
  }

  const setStartLights = (lit: number, green: boolean) => {
    columns.forEach((colm, i) => {
      const on = green || i < lit;
      const color = green ? LIGHT_GREEN : on ? LIGHT_RED : LIGHT_OFF;
      for (const b of colm.bulbs) b.color.set(color);
      for (const gl of colm.glows) {
        gl.visible = on;
        (gl.material as THREE.SpriteMaterial).color.set(
          green ? LIGHT_GREEN : LIGHT_RED,
        );
      }
    });
  };

  return { gantry, setStartLights };
}
