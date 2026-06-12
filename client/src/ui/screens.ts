import {
  DEFAULT_LAPS,
  MAX_LAPS,
  MAX_PLAYERS,
  MIN_LAPS,
  TRACKS,
  type ResultEntry,
  type RoomInfo,
} from "@f1web/shared";
import { formatTime } from "../game/utils";

export interface MenuHandlers {
  onPractice: (trackId: string, laps: number) => void;
  onCreate: (name: string) => void;
  onJoin: (name: string, code: string) => void;
}

export interface LobbyHandlers {
  onStart: () => void;
  onLeave: () => void;
  onTrack: (trackId: string) => void;
  onLaps: (laps: number) => void;
}

const LS_NAME = "f1web.name";

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
    this.root.innerHTML = `
      <div class="screen"><div class="panel">
        <div class="brand">
          <span class="kicker">LIGHTS OUT</span>
          <h1>F1 <em>WEB RACER</em></h1>
          <div class="sub">Real circuits &middot; up to ${MAX_PLAYERS} drivers &middot; in your browser</div>
        </div>
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
        <button id="m-create">CREATE RACE</button>
        <div class="join-box">
          <label>GOT A CODE FROM A FRIEND? ENTER IT HERE</label>
          <div class="join-row">
            <input id="m-code" maxlength="4" placeholder="ABCD" autocomplete="off" />
            <button id="m-join">JOIN RACE</button>
          </div>
        </div>
      </div></div>`;

    const $ = (id: string) => document.getElementById(id)!;
    const nameEl = $("m-name") as HTMLInputElement;
    const codeEl = $("m-code") as HTMLInputElement;
    nameEl.value = localStorage.getItem(LS_NAME) ?? "";

    const grab = () => {
      const name = nameEl.value.trim() || "Driver";
      localStorage.setItem(LS_NAME, name);
      return name;
    };

    $("m-practice").onclick = () =>
      h.onPractice(
        ($("m-track") as HTMLSelectElement).value,
        Number(($("m-laps") as HTMLSelectElement).value),
      );
    $("m-create").onclick = () => h.onCreate(grab());
    const join = () => {
      const code = codeEl.value.trim().toUpperCase();
      if (code.length !== 4) {
        this.toast("Enter the 4-letter room code");
        return;
      }
      h.onJoin(grab(), code);
    };
    $("m-join").onclick = join;
    codeEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") join();
    });
  }

  // ---- lobby ---------------------------------------------------------------

  showLobby(h: LobbyHandlers) {
    this.current = "lobby";
    this.root.innerHTML = `
      <div class="screen"><div class="panel">
        <div class="brand">
          <span class="kicker">PIT WALL</span>
          <h1>RACE <em>LOBBY</em></h1>
          <div class="sub" id="l-sub"></div>
        </div>
        <div class="room-code" id="l-code" title="Click to copy the invite link"></div>
        <div class="room-code-hint" id="l-code-hint">click to copy an invite link — friends join in one click</div>
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
    $("l-code").onclick = async () => {
      const code = $("l-code").textContent ?? "";
      if (!code) return;
      const invite = `${location.origin}${location.pathname}?join=${code}`;
      try {
        await navigator.clipboard.writeText(invite);
        const hint = $("l-code-hint");
        hint.textContent = "invite link copied — send it to your friends";
        setTimeout(() => {
          hint.textContent =
            "click to copy an invite link — friends join in one click";
        }, 2200);
      } catch {
        this.toast("Copy failed — share the code manually");
      }
    };
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
    const filled = room.players
      .map(
        (p, i) => `
        <li>
          <span class="player-slot-num">P${i + 1}</span>
          <span class="player-dot" style="background:${p.color}"></span>
          <span class="player-name">${escapeHtml(p.name)}${p.id === selfId ? " (you)" : ""}</span>
          ${p.id === room.hostId ? '<span class="player-host">HOST</span>' : ""}
        </li>`,
      )
      .join("");
    // pad with ghost slots (at least a 6-slot grid, up to the player cap)
    const totalSlots = Math.min(MAX_PLAYERS, Math.max(6, room.players.length + 1));
    const empties = Array.from(
      { length: totalSlots - room.players.length },
      (_, i) => `
        <li class="empty">
          <span class="player-slot-num">P${room.players.length + i + 1}</span>
          <span>WAITING FOR DRIVER</span>
        </li>`,
    ).join("");
    list.innerHTML = filled + empties;

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
    const fastest = results.reduce<number | null>(
      (best, r) =>
        r.bestLapMs !== null && (best === null || r.bestLapMs < best)
          ? r.bestLapMs
          : best,
      null,
    );
    const rows = results
      .map((r, i) => {
        const podium = !r.dnf && i < 3 ? ` p${i + 1}` : "";
        const me = r.id === selfId ? " me" : "";
        const hasFl = fastest !== null && r.bestLapMs === fastest;
        return `
        <li class="${podium}${me}">
          <span class="rank">${r.dnf ? "&mdash;" : "P" + (i + 1)}</span>
          <span class="player-dot" style="background:${r.color}"></span>
          <span class="result-driver">${escapeHtml(r.name)}${r.id === selfId ? " (you)" : ""}</span>
          <span class="result-times">
            <div class="result-total${r.dnf ? " dnf" : ""}">${r.dnf ? "DNF" : formatTime(r.totalMs)}</div>
            <div class="result-best${hasFl ? " fastest" : ""}">
              ${hasFl ? '<span class="fl">FASTEST LAP</span>' : ""}${formatTime(r.bestLapMs)}
            </div>
          </span>
        </li>`;
      })
      .join("");
    this.root.innerHTML = `
      <div class="screen"><div class="panel">
        <div class="brand">
          <span class="kicker">CHEQUERED FLAG</span>
          <h1>RACE <em>RESULTS</em></h1>
        </div>
        <div class="results-flag"></div>
        <ul class="results-list">${rows}</ul>
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
