/** Wire format: JSON messages over a WebSocket. */

export interface NetCarState {
  /** position, meters */
  x: number;
  z: number;
  /** heading, radians */
  h: number;
  /** signed forward speed, m/s */
  v: number;
  /** visual steering angle, -1..1 */
  st: number;
  /** current lap number, 1-based; 0 before the start */
  lap: number;
  /**
   * signed race distance from the start line, meters; slightly negative on
   * the grid, grows continuously across laps — used for position ordering
   */
  prog: number;
  /** crossed the finish line — the car becomes a non-colliding ghost */
  fin: boolean;
}

export interface PlayerInfo {
  id: string;
  name: string;
  color: string;
}

export type RoomPhase = "lobby" | "countdown" | "racing" | "finished";

export interface RoomInfo {
  code: string;
  hostId: string;
  trackId: string;
  laps: number;
  phase: RoomPhase;
  players: PlayerInfo[];
}

export interface ResultEntry {
  id: string;
  name: string;
  color: string;
  /** total race time; null = did not finish */
  totalMs: number | null;
  bestLapMs: number | null;
  dnf: boolean;
}

// ---- client -> server ----------------------------------------------------

export type ClientMsg =
  | { t: "create"; name: string }
  | { t: "join"; code: string; name: string }
  | { t: "leave" }
  | { t: "selectTrack"; trackId: string }
  | { t: "setLaps"; laps: number }
  | { t: "start" }
  | { t: "state"; s: NetCarState }
  | { t: "finished"; totalMs: number; bestLapMs: number };

// ---- server -> client ----------------------------------------------------

export type ServerMsg =
  | { t: "room"; selfId: string; room: RoomInfo }
  | { t: "lobby"; room: RoomInfo }
  | { t: "countdown"; room: RoomInfo; gridIds: string[]; ms: number }
  | { t: "go" }
  | { t: "states"; now: number; list: ({ id: string } & NetCarState)[] }
  | { t: "playerLeft"; id: string }
  | { t: "results"; results: ResultEntry[] }
  | { t: "error"; message: string };

export function parseMsg<T>(raw: unknown): T | null {
  try {
    const o = JSON.parse(String(raw));
    if (o && typeof o === "object" && typeof o.t === "string") return o as T;
  } catch {
    /* malformed message — drop it */
  }
  return null;
}
