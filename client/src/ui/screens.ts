import {
  DEFAULT_LAPS,
  MAX_LAPS,
  MIN_LAPS,
  TRACKS,
  type ResultEntry,
  type RoomInfo,
} from "@f1web/shared";
import { formatTime } from "../game/utils";

export interface MenuHandlers {
  onPractice: (trackId: string, laps: number) => void;
  onCreate: (name: string, server: string) => void;
  onJoin: (name: string, server: string, code: string) => void;
}

export interface LobbyHandlers {
  onStart: () => void;
  onLeave: () => void;
  onTrack: (trackId: string) => void;
  onLaps: (laps: number) => void;
}

const LS_NAME = "f1web.name";
const LS_SERVER = "f1web.server";

export class Screens {
  private root = document.getElementById("screens")!;
  private toastEl = document.getElementById("toast")!;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private current = "";

  hideAll() {
    this.current = "";
    this.root.innerHTML = "";
  }

  toast(message: string) {
    this.toastEl.textContent = message;
    this.toastEl.classList.remove("hidden");
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(
      () => this.toastEl.classList.add("hidden"),
      2800,
    );
  }

  // ---- main menu -----------------------------------------------------------

  showMenu(h: MenuHandlers) {
    this.current = "menu";
    // build-time override > same-origin (production: the server also hosts
    // this page) > vite dev server convention (game server on :8090)
    const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
    const defaultServer =
      (import.meta.env.VITE_SERVER_URL as string | undefined) ||
      (location.port === "5173"
        ? `ws://${location.hostname}:8090`
        : `${wsProto}//${location.host}`);
    this.root.innerHTML = `
      <div class="screen"><div class="panel">
        <h1>F1 <em>WEB RACER</em></h1>
        <div class="sub">3D multiplayer racing on real circuits — in your browser</div>
        <div class="field"><label>DRIVER NAME</label>
          <input id="m-name" maxlength="14" placeholder="Your name" /></div>
        <div class="row">
          <div class="field"><label>CIRCUIT</label>
            <select id="m-track">${trackOptions()}</select></div>
          <div class="field"><label>LAPS</label>
            <select id="m-laps">${lapOptions()}</select></div>
        </div>
        <button id="m-practice" class="secondary">PRACTICE SOLO</button>
        <div class="divider"><span>RACE WITH FRIENDS</span></div>
        <div class="field"><label>SERVER</label><input id="m-server" /></div>
        <button id="m-create">CREATE RACE</button>
        <div class="row" style="align-items:flex-end">
          <div class="field" style="margin-bottom:0"><label>ROOM CODE</label>
            <input id="m-code" maxlength="4" placeholder="ABCD"
              style="text-transform:uppercase;letter-spacing:6px;text-align:center" /></div>
          <button id="m-join" class="secondary" style="margin-top:0">JOIN</button>
        </div>
      </div></div>`;

    const $ = (id: string) => document.getElementById(id)!;
    const nameEl = $("m-name") as HTMLInputElement;
    const serverEl = $("m-server") as HTMLInputElement;
    const codeEl = $("m-code") as HTMLInputElement;
    nameEl.value = localStorage.getItem(LS_NAME) ?? "";
    serverEl.value = localStorage.getItem(LS_SERVER) ?? defaultServer;

    const grab = () => {
      const name = nameEl.value.trim() || "Driver";
      const server = serverEl.value.trim() || defaultServer;
      localStorage.setItem(LS_NAME, name);
      localStorage.setItem(LS_SERVER, server);
      return { name, server };
    };

    $("m-practice").onclick = () =>
      h.onPractice(
        ($("m-track") as HTMLSelectElement).value,
        Number(($("m-laps") as HTMLSelectElement).value),
      );
    $("m-create").onclick = () => {
      const { name, server } = grab();
      h.onCreate(name, server);
    };
    $("m-join").onclick = () => {
      const { name, server } = grab();
      const code = codeEl.value.trim().toUpperCase();
      if (code.length !== 4) {
        this.toast("Enter the 4-letter room code");
        return;
      }
      h.onJoin(name, server, code);
    };
  }

  // ---- lobby ---------------------------------------------------------------

  showLobby(h: LobbyHandlers) {
    this.current = "lobby";
    this.root.innerHTML = `
      <div class="screen"><div class="panel">
        <h1>RACE <em>LOBBY</em></h1>
        <div class="sub" id="l-sub"></div>
        <div class="room-code" id="l-code"></div>
        <div class="room-code-hint">share this code with your friends</div>
        <ul class="player-list" id="l-players"></ul>
        <div class="row" id="l-settings">
          <div class="field"><label>CIRCUIT</label>
            <select id="l-track">${trackOptions()}</select></div>
          <div class="field"><label>LAPS</label>
            <select id="l-laps">${lapOptions()}</select></div>
        </div>
        <div class="field hidden" id="l-settings-ro">
          <label>RACE SETTINGS</label>
          <div class="settings-ro" id="l-settings-text"></div>
        </div>
        <button id="l-start">START RACE</button>
        <button id="l-leave" class="secondary">LEAVE</button>
      </div></div>`;

    const $ = (id: string) => document.getElementById(id)!;
    ($("l-track") as HTMLSelectElement).onchange = (e) =>
      h.onTrack((e.target as HTMLSelectElement).value);
    ($("l-laps") as HTMLSelectElement).onchange = (e) =>
      h.onLaps(Number((e.target as HTMLSelectElement).value));
    $("l-start").onclick = () => h.onStart();
    $("l-leave").onclick = () => h.onLeave();
  }

  updateLobby(room: RoomInfo, selfId: string) {
    if (this.current !== "lobby") return;
    const $ = (id: string) => document.getElementById(id);
    const isHost = room.hostId === selfId;

    $("l-code")!.textContent = room.code;
    $("l-sub")!.textContent = isHost
      ? "you are the host — pick a circuit and start the race"
      : "waiting for the host to start the race";

    const list = $("l-players")!;
    list.innerHTML = room.players
      .map(
        (p) => `
        <li>
          <span class="player-dot" style="background:${p.color}"></span>
          <span>${escapeHtml(p.name)}${p.id === selfId ? " (you)" : ""}</span>
          ${p.id === room.hostId ? '<span class="player-host">HOST</span>' : ""}
        </li>`,
      )
      .join("");

    // only the host gets the settings controls; everyone else sees a summary
    $("l-settings")!.classList.toggle("hidden", !isHost);
    $("l-settings-ro")!.classList.toggle("hidden", isHost);
    if (isHost) {
      ($("l-track") as HTMLSelectElement).value = room.trackId;
      ($("l-laps") as HTMLSelectElement).value = String(room.laps);
    } else {
      const track = TRACKS.find((t) => t.id === room.trackId);
      $("l-settings-text")!.textContent =
        `${track ? `${track.name} — ${track.country}` : room.trackId} · ${room.laps} lap${room.laps > 1 ? "s" : ""}`;
    }

    const start = $("l-start") as HTMLButtonElement;
    start.style.display = isHost ? "" : "none";
    start.disabled = room.phase !== "lobby";
  }

  // ---- results -------------------------------------------------------------

  showResults(
    results: ResultEntry[],
    selfId: string,
    closeLabel: string,
    onClose: () => void,
  ) {
    this.current = "results";
    const rows = results
      .map(
        (r, i) => `
        <tr class="${r.id === selfId ? "me" : ""}">
          <td>${r.dnf ? "—" : "P" + (i + 1)}</td>
          <td><span class="player-dot" style="display:inline-block;background:${r.color}"></span>
              &nbsp;${escapeHtml(r.name)}</td>
          <td>${r.dnf ? "DNF" : formatTime(r.totalMs)}</td>
          <td>${formatTime(r.bestLapMs)}</td>
        </tr>`,
      )
      .join("");
    this.root.innerHTML = `
      <div class="screen"><div class="panel">
        <h1>RACE <em>RESULTS</em></h1>
        <div class="sub">&nbsp;</div>
        <table class="results-table">
          <thead><tr><th>POS</th><th>DRIVER</th><th>TIME</th><th>BEST LAP</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <button id="r-close">${closeLabel}</button>
      </div></div>`;
    document.getElementById("r-close")!.onclick = onClose;
  }
}

function trackOptions(): string {
  return TRACKS.map(
    (t) => `<option value="${t.id}">${t.name} — ${t.country}</option>`,
  ).join("");
}

function lapOptions(): string {
  let out = "";
  for (let i = MIN_LAPS; i <= MAX_LAPS; i++) {
    out += `<option value="${i}" ${i === DEFAULT_LAPS ? "selected" : ""}>${i}</option>`;
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
