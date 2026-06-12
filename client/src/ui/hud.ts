import { TOP_SPEED } from "../game/physics";
import { Track } from "../game/track";
import { formatTime } from "../game/utils";

// tachometer dial: 0-12 (x1000 rpm), redline at 10.5
const DIAL_MAX = 12;
const REDLINE = 10.5;
const DIAL_START = (135 * Math.PI) / 180; // lower-left, sweeping clockwise
const DIAL_SWEEP = (270 * Math.PI) / 180;
const GEARS = 8;
const IDLE_RPM = 4; // x1000
const SHIFT_RPM = 11.8; // x1000 at the top of each gear

export interface HudCar {
  x: number;
  z: number;
  color: string;
  self: boolean;
}

export interface HudState {
  speedKmh: number;
  lap: number;
  totalLaps: number;
  pos: number;
  posTotal: number;
  curMs: number;
  lastMs: number | null;
  bestMs: number | null;
  wrongWay: boolean;
}

export class Hud {
  private root = document.getElementById("hud")!;
  private elPos = document.getElementById("hud-pos")!;
  private elLap = document.getElementById("hud-lap")!;
  private elSpeed = document.getElementById("speed-val")!;
  private speedo = document.getElementById("speedo") as HTMLCanvasElement;
  private spCtx = this.speedo.getContext("2d")!;
  private dialFace: HTMLCanvasElement | null = null;
  private elCur = document.getElementById("time-cur")!;
  private elLast = document.getElementById("time-last")!;
  private elBest = document.getElementById("time-best")!;
  private elCenter = document.getElementById("hud-center")!;
  private elWrong = document.getElementById("hud-wrongway")!;
  private map = document.getElementById("minimap") as HTMLCanvasElement;
  private mapCtx = this.map.getContext("2d")!;
  private mapBg: HTMLCanvasElement | null = null;
  private mapScale = 1;
  private mapOx = 0;
  private mapOy = 0;

  setVisible(v: boolean) {
    this.root.classList.toggle("hidden", !v);
  }

  /** pre-render the track outline for the minimap */
  setTrack(track: Track) {
    const W = this.map.width;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of track.samples) {
      minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z);
    }
    const pad = 14;
    this.mapScale = Math.min(
      (W - pad * 2) / (maxX - minX),
      (W - pad * 2) / (maxZ - minZ),
    );
    this.mapOx = (W - (maxX - minX) * this.mapScale) / 2 - minX * this.mapScale;
    this.mapOy = (W - (maxZ - minZ) * this.mapScale) / 2 - minZ * this.mapScale;

    this.mapBg = document.createElement("canvas");
    this.mapBg.width = W;
    this.mapBg.height = W;
    const c = this.mapBg.getContext("2d")!;
    c.strokeStyle = "rgba(255,255,255,0.85)";
    c.lineWidth = 3;
    c.lineJoin = "round";
    c.beginPath();
    track.samples.forEach((s, i) => {
      const px = s.x * this.mapScale + this.mapOx;
      const py = s.z * this.mapScale + this.mapOy;
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    });
    c.closePath();
    c.stroke();
    // start line tick
    const s0 = track.samples[0];
    c.strokeStyle = "#e10600";
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(
      (s0.x - s0.nx * 6) * this.mapScale + this.mapOx,
      (s0.z - s0.nz * 6) * this.mapScale + this.mapOy,
    );
    c.lineTo(
      (s0.x + s0.nx * 6) * this.mapScale + this.mapOx,
      (s0.z + s0.nz * 6) * this.mapScale + this.mapOy,
    );
    c.stroke();
  }

  update(s: HudState, cars: HudCar[]) {
    this.elSpeed.textContent = String(Math.round(Math.abs(s.speedKmh)));
    this.drawSpeedo(s.speedKmh);
    this.elLap.textContent =
      s.lap > 0 ? `LAP ${Math.min(s.lap, s.totalLaps)}/${s.totalLaps}` : "READY";
    this.elPos.textContent = s.posTotal > 1 ? `P${s.pos}` : "";
    this.elCur.textContent = formatTime(s.curMs);
    this.elLast.textContent = formatTime(s.lastMs);
    this.elBest.textContent = formatTime(s.bestMs);
    this.elWrong.classList.toggle("hidden", !s.wrongWay);
    this.drawMap(cars);
  }

  centerText(text: string, color = "#ffffff") {
    this.elCenter.textContent = text;
    this.elCenter.style.color = color;
    this.elCenter.classList.toggle("hidden", text === "");
  }

  // ---- speedometer gauge ---------------------------------------------------

  private drawSpeedo(kmhSigned: number) {
    const W = this.speedo.width;
    const H = this.speedo.height;
    const cx = W / 2;
    const cy = 78;
    const R = 54;
    if (!this.dialFace) this.dialFace = renderDialFace(W, H, cx, cy, R);

    const ctx = this.spCtx;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(this.dialFace, 0, 0);

    // fake-gearbox rpm, matching the audio model
    const ms = Math.abs(kmhSigned) / 3.6;
    const gearLen = TOP_SPEED / GEARS;
    const frac = (ms % gearLen) / gearLen;
    const rpm =
      ms < 0.6 ? IDLE_RPM : Math.min(DIAL_MAX, 5 + frac * (SHIFT_RPM - 5));
    const ang = DIAL_START + (rpm / DIAL_MAX) * DIAL_SWEEP;

    // needle with a soft glow
    ctx.shadowColor = "rgba(225,6,0,0.8)";
    ctx.shadowBlur = 7;
    ctx.strokeStyle = "#ff2a20";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(ang) * 8, cy - Math.sin(ang) * 8);
    ctx.lineTo(cx + Math.cos(ang) * (R - 8), cy + Math.sin(ang) * (R - 8));
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#34343f";
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();

    // gear in the dial's free lower wedge
    const gear =
      kmhSigned < -1
        ? "R"
        : ms < 0.6
          ? "N"
          : String(Math.min(GEARS, Math.floor(ms / gearLen) + 1));
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 21px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(gear, cx, cy + 38);

    // digital speed in a small pill below the dial
    ctx.fillStyle = "rgba(12,12,18,0.68)";
    ctx.beginPath();
    ctx.roundRect(cx - 46, H - 42, 92, 40, 11);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "italic 800 25px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(String(Math.round(Math.abs(kmhSigned))), cx, H - 16);
    ctx.fillStyle = "#9b9ba6";
    ctx.font = "700 9px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText("KM/H", cx, H - 5);
  }

  private drawMap(cars: HudCar[]) {
    if (!this.mapBg) return;
    const ctx = this.mapCtx;
    ctx.clearRect(0, 0, this.map.width, this.map.height);
    ctx.drawImage(this.mapBg, 0, 0);
    for (const car of cars) {
      ctx.beginPath();
      ctx.arc(
        car.x * this.mapScale + this.mapOx,
        car.z * this.mapScale + this.mapOy,
        car.self ? 6 : 4.5,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = car.color;
      if (car.self) {
        ctx.shadowColor = "rgba(255,255,255,0.9)";
        ctx.shadowBlur = 8;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
      if (car.self) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }
}

/** static tach face: background, tick marks, labels outside the arc, redline */
function renderDialFace(
  W: number,
  H: number,
  cx: number,
  cy: number,
  R: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // circular dial plate (the glass card behind comes from CSS)
  const plate = ctx.createRadialGradient(cx, cy, 6, cx, cy, R + 20);
  plate.addColorStop(0, "rgba(40,40,56,0.9)");
  plate.addColorStop(0.85, "rgba(16,16,24,0.75)");
  plate.addColorStop(1, "rgba(16,16,24,0)");
  ctx.fillStyle = plate;
  ctx.beginPath();
  ctx.arc(cx, cy, R + 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, R + 7, 0, Math.PI * 2);
  ctx.stroke();

  // arc track + redline zone
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.arc(cx, cy, R, DIAL_START, DIAL_START + DIAL_SWEEP);
  ctx.stroke();
  ctx.strokeStyle = "#e10600";
  ctx.beginPath();
  ctx.arc(
    cx,
    cy,
    R,
    DIAL_START + (REDLINE / DIAL_MAX) * DIAL_SWEEP,
    DIAL_START + DIAL_SWEEP,
  );
  ctx.stroke();

  // ticks inside the arc, number labels OUTSIDE it
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let v = 0; v <= DIAL_MAX; v += 1) {
    const ang = DIAL_START + (v / DIAL_MAX) * DIAL_SWEEP;
    const major = v % 2 === 0;
    const r1 = R - (major ? 10 : 6);
    ctx.strokeStyle = major ? "#fff" : "rgba(255,255,255,0.5)";
    ctx.lineWidth = major ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
    ctx.lineTo(cx + Math.cos(ang) * (R - 3), cy + Math.sin(ang) * (R - 3));
    ctx.stroke();
    if (major) {
      ctx.fillStyle = v >= REDLINE ? "#ff6b66" : "#cfcfd6";
      ctx.font = "700 10px 'Segoe UI', system-ui, sans-serif";
      ctx.fillText(
        String(v),
        cx + Math.cos(ang) * (R + 13),
        cy + Math.sin(ang) * (R + 13),
      );
    }
  }

  ctx.fillStyle = "#9b9ba6";
  ctx.font = "700 8px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText("RPM x1000", cx, cy - 22);
  return canvas;
}
