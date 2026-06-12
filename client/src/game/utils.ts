export const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const TAU = Math.PI * 2;

/** wrap angle to (-PI, PI] */
export function wrapAngle(a: number): number {
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  if (a <= -Math.PI) a += TAU;
  return a;
}

/** interpolate between angles along the shortest arc */
export function angleLerp(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

/** frame-rate independent smoothing factor */
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

export function formatTime(ms: number | null | undefined): string {
  if (ms == null || !isFinite(ms)) return "--:--.---";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const t = Math.floor(ms % 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(t).padStart(3, "0")}`;
}
