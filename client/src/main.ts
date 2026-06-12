import * as THREE from "three";
import {
  CAR_COLORS,
  LIGHTS_MS,
  NET_SEND_HZ,
  PREP_MS,
  type ResultEntry,
  type RoomInfo,
} from "@f1web/shared";
import { Game } from "./game/game";
import { NetClient } from "./net/client";
import { Hud } from "./ui/hud";
import { Screens } from "./ui/screens";

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const hud = new Hud();
const screens = new Screens();
// devtools: renderer.info exposes GPU resource counts for leak checks
(window as unknown as Record<string, unknown>).__renderer = renderer;

let net: NetClient | null = null;
let game: Game | null = null;
let room: RoomInfo | null = null;
let selfId = "";

// ---------------------------------------------------------------------------

function endGame() {
  game?.dispose();
  game = null;
}

function leaveOnline() {
  if (net) {
    net.send({ t: "leave" });
    net.close();
    net = null;
  }
  room = null;
  selfId = "";
}

/**
 * The game server is not user-facing configuration: same origin in
 * production (it serves this page), the dev server on :8090 under Vite,
 * and a `?server=wss://...` query override for development only.
 */
function serverUrl(): string {
  const override = new URLSearchParams(location.search).get("server");
  if (override) return override;
  if (location.port === "5173") return `ws://${location.hostname}:8090`;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}`;
}

function showMenu() {
  endGame();
  leaveOnline();
  screens.showMenu({
    onPractice: startPractice,
    onCreate: (name) =>
      void connectThen(serverUrl(), (n) => n.send({ t: "create", name })),
    onJoin: (name, code) =>
      void connectThen(serverUrl(), (n) => n.send({ t: "join", code, name })),
  });
}

// ---- practice --------------------------------------------------------------

function startPractice(trackId: string, laps: number) {
  endGame();
  screens.hideAll();
  const name = localStorage.getItem("f1web.name")?.trim() || "Driver";
  const self = { id: "self", name, color: CAR_COLORS[0] };
  game = new Game({
    renderer,
    hud,
    trackId,
    laps,
    self,
    gridIndex: 0,
    onExit: () => showMenu(),
    onSelfFinished: (totalMs, bestLapMs) => {
      const results: ResultEntry[] = [
        { id: "self", name, color: self.color, totalMs, bestLapMs, dnf: false },
      ];
      const finishedGame = game;
      setTimeout(() => {
        // skip if the player already left this session via Esc
        if (game !== finishedGame) return;
        endGame();
        screens.showResults(results, "self", "BACK TO MENU", showMenu);
      }, 1800);
    },
  });
  game.startCountdown(PREP_MS, LIGHTS_MS, true);
}

// ---- multiplayer -----------------------------------------------------------

async function connectThen(server: string, action: (n: NetClient) => void) {
  try {
    leaveOnline();
    const n = new NetClient();
    await n.connect(server);
    net = n;
    wireNet(n);
    action(n);
  } catch (e) {
    screens.toast((e as Error).message);
  }
}

const lobbyHandlers = {
  onStart: () => net?.send({ t: "start" }),
  onLeave: () => showMenu(),
  onTrack: (trackId: string) => net?.send({ t: "selectTrack", trackId }),
  onLaps: (laps: number) => net?.send({ t: "setLaps", laps }),
};

function wireNet(n: NetClient) {
  n.onDisconnect = () => {
    screens.toast("Disconnected from server");
    net = null;
    showMenu();
  };

  n.on("room", (m) => {
    selfId = m.selfId;
    room = m.room;
    screens.showLobby(lobbyHandlers);
    screens.updateLobby(room, selfId);
  });

  n.on("lobby", (m) => {
    room = m.room;
    screens.updateLobby(room, selfId);
  });

  n.on("error", (m) => screens.toast(m.message));

  n.on("countdown", (m) => {
    room = m.room;
    endGame();
    screens.hideAll();
    const self = m.room.players.find((p) => p.id === selfId);
    if (!self) return;
    game = new Game({
      renderer,
      hud,
      trackId: m.room.trackId,
      laps: m.room.laps,
      self,
      gridIndex: Math.max(0, m.gridIds.indexOf(selfId)),
      onExit: () => showMenu(), // Esc = leave the race entirely
      onSelfFinished: (totalMs, bestLapMs) =>
        net?.send({ t: "finished", totalMs, bestLapMs }),
    });
    for (const p of m.room.players) {
      if (p.id !== selfId) game.addRemote(p);
    }
    // prep count + lights render locally; lights-out comes from the server
    // after its random hold
    game.startCountdown(m.prepMs, m.lightsMs, false);
  });

  n.on("go", () => game?.go());

  n.on("states", (m) => {
    if (!game) return;
    const t = performance.now();
    for (const s of m.list) {
      if (s.id !== selfId) game.pushRemoteState(s.id, t, s);
    }
  });

  n.on("playerLeft", (m) => game?.removeRemote(m.id));

  n.on("finishCountdown", (m) => game?.startFinishCountdown(m.ms));

  n.on("results", (m) => {
    endGame();
    screens.showResults(m.results, selfId, "BACK TO LOBBY", () => {
      if (net && room) {
        screens.showLobby(lobbyHandlers);
        screens.updateLobby(room, selfId);
      } else {
        showMenu();
      }
    });
  });
}

// own-car state uplink
setInterval(() => {
  if (net?.connected && game && room) {
    net.send({ t: "state", s: game.getNetState() });
  }
}, 1000 / NET_SEND_HZ);

showMenu();

// invite links: ...?join=CODE drops the visitor straight into the lobby
const inviteCode = new URLSearchParams(location.search)
  .get("join")
  ?.toUpperCase();
if (inviteCode && /^[A-Z]{4}$/.test(inviteCode)) {
  const srv = serverUrl(); // capture before stripping the query
  history.replaceState(null, "", location.pathname);
  const name = localStorage.getItem("f1web.name")?.trim() || "Driver";
  void connectThen(srv, (n) => n.send({ t: "join", code: inviteCode, name }));
}
