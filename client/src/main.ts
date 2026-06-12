import * as THREE from "three";
import {
  CAR_COLORS,
  NET_SEND_HZ,
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
let countdownAnim: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------

function endGame() {
  if (countdownAnim) {
    clearInterval(countdownAnim);
    countdownAnim = null;
  }
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

function showMenu() {
  endGame();
  leaveOnline();
  screens.showMenu({
    onPractice: startPractice,
    onCreate: (name, server) =>
      void connectThen(server, (n) => n.send({ t: "create", name })),
    onJoin: (name, server, code) =>
      void connectThen(server, (n) => n.send({ t: "join", code, name })),
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
      setTimeout(() => {
        endGame();
        screens.showResults(results, "self", "BACK TO MENU", showMenu);
      }, 1800);
    },
  });
  game.startPracticeCountdown();
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
    // drive the start lights over the countdown window; GO comes from the server
    const t0 = performance.now();
    countdownAnim = setInterval(() => {
      game?.setCountdownProgress((performance.now() - t0) / m.ms);
    }, 110);
  });

  n.on("go", () => {
    if (countdownAnim) {
      clearInterval(countdownAnim);
      countdownAnim = null;
    }
    game?.go();
  });

  n.on("states", (m) => {
    if (!game) return;
    const t = performance.now();
    for (const s of m.list) {
      if (s.id !== selfId) game.pushRemoteState(s.id, t, s);
    }
  });

  n.on("playerLeft", (m) => game?.removeRemote(m.id));

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
