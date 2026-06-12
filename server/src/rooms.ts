import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import {
  CAR_COLORS,
  DEFAULT_LAPS,
  GO_HOLD_MAX_MS,
  GO_HOLD_MIN_MS,
  LIGHTS_MS,
  PREP_MS,
  DEFAULT_TRACK_ID,
  FINISH_TIMEOUT_MS,
  MAX_LAPS,
  MAX_PLAYERS,
  MIN_LAPS,
  NET_BROADCAST_HZ,
  TRACK_MAP,
  parseMsg,
  type ClientMsg,
  type NetCarState,
  type ResultEntry,
  type RoomInfo,
  type RoomPhase,
  type ServerMsg,
} from "@f1web/shared";

interface Client {
  id: string;
  name: string;
  color: string;
  ws: WebSocket;
  room: Room | null;
  state: NetCarState | null;
  finish: { totalMs: number; bestLapMs: number } | null;
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O — easy to read aloud
/** hard cap on race length so an abandoned room can't stay "racing" forever */
const MAX_RACE_MS = 20 * 60_000;

export class RoomManager {
  private rooms = new Map<string, Room>();

  handleConnection(ws: WebSocket) {
    (ws as unknown as { isAlive: boolean }).isAlive = true;
    ws.on("pong", () => ((ws as unknown as { isAlive: boolean }).isAlive = true));

    const client: Client = {
      id: randomUUID().slice(0, 8),
      name: "",
      color: CAR_COLORS[0],
      ws,
      room: null,
      state: null,
      finish: null,
    };

    ws.on("message", (raw) => {
      const msg = parseMsg<ClientMsg>(raw.toString());
      if (msg) this.route(client, msg);
    });
    ws.on("close", () => this.leaveRoom(client));
    ws.on("error", () => ws.close());
  }

  private route(c: Client, msg: ClientMsg) {
    switch (msg.t) {
      case "create": {
        if (c.room) this.leaveRoom(c);
        c.name = cleanName(msg.name);
        const room = new Room(this.makeCode(), () => this.rooms.delete(room.code));
        this.rooms.set(room.code, room);
        room.add(c);
        break;
      }
      case "join": {
        if (c.room) this.leaveRoom(c);
        c.name = cleanName(msg.name);
        const room = this.rooms.get(String(msg.code).toUpperCase());
        if (!room) return send(c, { t: "error", message: "Room not found" });
        if (room.phase !== "lobby")
          return send(c, { t: "error", message: "Race already in progress" });
        if (room.players.length >= MAX_PLAYERS)
          return send(c, { t: "error", message: "Room is full" });
        room.add(c);
        break;
      }
      case "leave":
        this.leaveRoom(c);
        break;
      default:
        c.room?.route(c, msg);
    }
  }

  private leaveRoom(c: Client) {
    const room = c.room;
    if (!room) return;
    c.room = null;
    room.remove(c);
  }

  private makeCode(): string {
    for (;;) {
      let code = "";
      for (let i = 0; i < 4; i++) {
        code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
  }
}

class Room {
  players: Client[] = [];
  hostId = "";
  trackId = DEFAULT_TRACK_ID;
  laps = DEFAULT_LAPS;
  phase: RoomPhase = "lobby";

  private broadcastTimer: ReturnType<typeof setInterval> | null = null;
  private countdownTimer: ReturnType<typeof setTimeout> | null = null;
  private finishTimer: ReturnType<typeof setTimeout> | null = null;
  private raceWatchdog: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly code: string,
    private onEmpty: () => void,
  ) {}

  info(): RoomInfo {
    return {
      code: this.code,
      hostId: this.hostId,
      trackId: this.trackId,
      laps: this.laps,
      phase: this.phase,
      players: this.players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    };
  }

  add(c: Client) {
    const used = new Set(this.players.map((p) => p.color));
    c.color = CAR_COLORS.find((col) => !used.has(col)) ?? CAR_COLORS[0];
    c.room = this;
    c.state = null;
    c.finish = null;
    this.players.push(c);
    if (this.players.length === 1) this.hostId = c.id;
    send(c, { t: "room", selfId: c.id, room: this.info() });
    this.broadcastLobby(c.id);
  }

  remove(c: Client) {
    const i = this.players.indexOf(c);
    if (i === -1) return;
    this.players.splice(i, 1);

    if (this.players.length === 0) {
      this.shutdown();
      return;
    }
    if (this.hostId === c.id) this.hostId = this.players[0].id;

    if (this.phase === "racing" || this.phase === "countdown") {
      this.broadcast({ t: "playerLeft", id: c.id });
      this.maybeEndRace();
    }
    this.broadcastLobby();
  }

  route(c: Client, msg: ClientMsg) {
    switch (msg.t) {
      case "selectTrack":
        if (c.id !== this.hostId || this.phase !== "lobby") return;
        if (!TRACK_MAP[msg.trackId]) return;
        this.trackId = msg.trackId;
        this.broadcastLobby();
        break;

      case "setLaps": {
        if (c.id !== this.hostId || this.phase !== "lobby") return;
        const laps = Math.round(Number(msg.laps));
        if (!Number.isFinite(laps) || laps < MIN_LAPS || laps > MAX_LAPS) return;
        this.laps = laps;
        this.broadcastLobby();
        break;
      }

      case "start":
        if (c.id !== this.hostId || this.phase !== "lobby") return;
        this.startRace();
        break;

      case "state": {
        if (this.phase !== "racing" && this.phase !== "countdown") break;
        // sanitize: a buggy/hostile client must not poison other clients
        // with NaN/Infinity or absurd values
        const s = msg.s;
        if (
          s &&
          [s.ts, s.x, s.z, s.h, s.v, s.st, s.lap, s.prog].every(
            (n) => typeof n === "number" && Number.isFinite(n),
          )
        ) {
          c.state = {
            ts: s.ts,
            x: s.x,
            z: s.z,
            h: s.h,
            v: Math.max(-50, Math.min(150, s.v)),
            st: Math.max(-1, Math.min(1, s.st)),
            lap: Math.max(0, Math.min(99, Math.round(s.lap))),
            prog: s.prog,
            fin: s.fin === true,
          };
        }
        break;
      }

      case "finished":
        if (this.phase !== "racing" || c.finish) return;
        c.finish = {
          totalMs: Number(msg.totalMs) || 0,
          bestLapMs: Number(msg.bestLapMs) || 0,
        };
        if (this.players.every((p) => p.finish)) {
          this.endRace();
        } else if (!this.finishTimer) {
          // first finisher starts the clock for everyone else
          this.finishTimer = setTimeout(() => this.endRace(), FINISH_TIMEOUT_MS);
          this.broadcast({ t: "finishCountdown", ms: FINISH_TIMEOUT_MS });
        }
        break;
    }
  }

  private startRace() {
    this.phase = "countdown";
    for (const p of this.players) {
      p.state = null;
      p.finish = null;
    }
    const gridIds = this.players.map((p) => p.id);
    this.broadcast({
      t: "countdown",
      room: this.info(),
      gridIds,
      prepMs: PREP_MS,
      lightsMs: LIGHTS_MS,
    });

    this.broadcastTimer = setInterval(() => {
      const list = this.players
        .filter((p) => p.state)
        .map((p) => ({ id: p.id, ...(p.state as NetCarState) }));
      if (list.length > 0) {
        this.broadcast({ t: "states", now: Date.now(), list });
      }
    }, 1000 / NET_BROADCAST_HZ);

    // lights out after a RANDOM hold — launches can't be timed perfectly
    const hold =
      GO_HOLD_MIN_MS + Math.random() * (GO_HOLD_MAX_MS - GO_HOLD_MIN_MS);
    this.countdownTimer = setTimeout(() => {
      this.phase = "racing";
      this.broadcast({ t: "go" });
    }, PREP_MS + LIGHTS_MS + hold);

    // a race can't hang the room forever (everyone AFK / parked)
    this.raceWatchdog = setTimeout(() => this.endRace(), MAX_RACE_MS);
  }

  private maybeEndRace() {
    if (this.phase !== "racing") return;
    if (this.players.length > 0 && this.players.every((p) => p.finish)) {
      this.endRace();
    }
  }

  private endRace() {
    if (this.phase !== "racing" && this.phase !== "countdown") return;
    this.stopTimers();
    this.phase = "finished";

    const finishers = this.players
      .filter((p) => p.finish)
      .sort((a, b) => a.finish!.totalMs - b.finish!.totalMs);
    const dnfs = this.players
      .filter((p) => !p.finish)
      .sort((a, b) => raceDistance(b) - raceDistance(a));

    const results: ResultEntry[] = [
      ...finishers.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        totalMs: p.finish!.totalMs,
        bestLapMs: p.finish!.bestLapMs || null,
        dnf: false,
      })),
      ...dnfs.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        totalMs: null,
        bestLapMs: null,
        dnf: true,
      })),
    ];

    this.broadcast({ t: "results", results });

    // room returns to the lobby, same code, ready for a rematch
    this.phase = "lobby";
    for (const p of this.players) {
      p.state = null;
      p.finish = null;
    }
    this.broadcastLobby();
  }

  private broadcastLobby(exceptId?: string) {
    const room = this.info();
    for (const p of this.players) {
      if (p.id !== exceptId) send(p, { t: "lobby", room });
    }
  }

  private broadcast(msg: ServerMsg) {
    const raw = JSON.stringify(msg);
    for (const p of this.players) {
      if (p.ws.readyState === p.ws.OPEN) p.ws.send(raw);
    }
  }

  private stopTimers() {
    if (this.broadcastTimer) clearInterval(this.broadcastTimer);
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    if (this.finishTimer) clearTimeout(this.finishTimer);
    if (this.raceWatchdog) clearTimeout(this.raceWatchdog);
    this.broadcastTimer = this.countdownTimer = this.finishTimer = null;
    this.raceWatchdog = null;
  }

  private shutdown() {
    this.stopTimers();
    this.onEmpty();
  }
}

function raceDistance(p: Client): number {
  // prog is the signed race distance from the start line
  return p.state ? p.state.prog : -1e9;
}

function cleanName(raw: unknown): string {
  const name = String(raw ?? "").trim().slice(0, 14);
  return name || "Driver";
}

function send(c: Client, msg: ServerMsg) {
  if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg));
}
