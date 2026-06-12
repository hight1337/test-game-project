// Downloads real F1 circuit centerlines from the TUMFTM racetrack-database
// (https://github.com/TUMFTM/racetrack-database) and converts them to compact
// JSON used by the game. Generated files are committed, so this only needs to
// run again to add tracks.
//
// CSV format: x_m, y_m, w_tr_right_m, w_tr_left_m (comment lines start with #)

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE =
  "https://raw.githubusercontent.com/TUMFTM/racetrack-database/master/tracks";

const TRACKS = [
  { id: "monza", file: "Monza.csv", name: "Monza", country: "Italy" },
  { id: "spa", file: "Spa.csv", name: "Spa-Francorchamps", country: "Belgium" },
  { id: "silverstone", file: "Silverstone.csv", name: "Silverstone", country: "Great Britain" },
  { id: "suzuka", file: "Suzuka.csv", name: "Suzuka", country: "Japan" },
  { id: "interlagos", file: "SaoPaulo.csv", name: "Interlagos", country: "Brazil" },
];

// Keep roughly one point every TARGET_SPACING meters of arc length.
const TARGET_SPACING = 5;

const outDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "shared",
  "src",
  "tracks",
);

function parseCsv(text) {
  const pts = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const [x, y, wr, wl] = t.split(",").map(Number);
    if ([x, y, wr, wl].some(Number.isNaN)) continue;
    pts.push({ x, y, wr, wl });
  }
  return pts;
}

function downsample(pts) {
  const out = [];
  let acc = Infinity; // always keep the first point
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) {
      const dx = pts[i].x - pts[i - 1].x;
      const dy = pts[i].y - pts[i - 1].y;
      acc += Math.hypot(dx, dy);
    }
    if (acc >= TARGET_SPACING) {
      out.push(pts[i]);
      acc = 0;
    }
  }
  // Drop a final point that sits nearly on top of the first (closed loop).
  const a = out[0];
  const b = out[out.length - 1];
  if (Math.hypot(a.x - b.x, a.y - b.y) < TARGET_SPACING * 0.6) out.pop();
  return out;
}

function recenter(pts) {
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= pts.length;
  cy /= pts.length;
  return pts.map((p) => ({ ...p, x: p.x - cx, y: p.y - cy }));
}

const round = (n) => Math.round(n * 100) / 100;

await mkdir(outDir, { recursive: true });

for (const t of TRACKS) {
  const url = `${BASE}/${t.file}`;
  process.stdout.write(`${t.name}: fetching... `);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`FAILED ${res.status} ${url}`);
    process.exitCode = 1;
    continue;
  }
  const raw = parseCsv(await res.text());
  const pts = recenter(downsample(raw));
  const json = {
    id: t.id,
    name: t.name,
    country: t.country,
    // points: [x, y, widthRight, widthLeft] in meters, closed loop
    points: pts.map((p) => [round(p.x), round(p.y), round(p.wr), round(p.wl)]),
  };
  const file = path.join(outDir, `${t.id}.json`);
  await writeFile(file, JSON.stringify(json));
  console.log(`${raw.length} -> ${pts.length} points -> ${path.basename(file)}`);
}
console.log("done");
