# F1 Web Racer

3D multiplayer racing in the browser. Real F1 circuit layouts, arcade handling,
room codes for racing with friends.

![stack](https://img.shields.io/badge/stack-Three.js%20%7C%20TypeScript%20%7C%20ws-blue)

## Circuits

Real centerlines and track widths from the
[TUMFTM racetrack-database](https://github.com/TUMFTM/racetrack-database)
(GPS-measured F1 circuits):

- Monza (Italy)
- Spa-Francorchamps (Belgium)
- Silverstone (Great Britain)
- Suzuka (Japan)
- Interlagos (Brazil)

## Quick start

```bash
npm install
npm run dev        # starts the race server (:8090) and the client (:5173)
```

Open <http://localhost:5173> — practice solo, or **CREATE RACE** and share the
4-letter room code. Friends on the same network open
`http://<your-ip>:5173`, enter the code and join. Up to 8 players per room.

### Controls

| Key | Action |
| --- | --- |
| W / ↑ | throttle |
| S / ↓ | brake / reverse |
| A·D / ←·→ | steer |
| R | reset to track |
| L | toggle racing-line assist |
| M | mute engine |
| Esc | leave race |

Gamepad supported: left stick = steer, RT/LT = throttle/brake, Y/△ = reset.

The racing-line assist shows the ideal line; the segment ahead of the car is
colored by your current speed vs. the next corner: green = flat works,
yellow = marginal, red = brake now. Predictions use the same grip model as
the physics.

### Roadmap

- Manual gear shifting (paddles + H-pattern option)
- Sampled engine audio, skid marks, slide/impact effects
- glTF car model and trackside props
- Time-trial ghosts and persistent best laps
- Spectator mode / mid-race rejoin
- Mobile touch controls

## How it works

```text
shared/   track data (real centerlines), wire protocol, constants
client/   Vite + Three.js: rendering, arcade physics, race logic, HUD, UI
server/   Node + ws: rooms, lobby, countdown, 20 Hz state relay, results
```

- **Physics** runs client-side at a fixed 60 Hz: kinematic bicycle model with
  lateral-grip damping, paved runoff with reduced grip, wall collisions.
  Each player simulates their own car (zero input latency); opponents are
  rendered ~120 ms in the past via snapshot interpolation, with soft
  "ghost" collisions between cars.
- **Race logic**: checkpoint gates around the lap must all be collected
  before a start-line crossing counts, so cutting or reversing gains
  nothing. Live positions compare signed race distance from the start line.
- **Server** is a thin authoritative room manager: codes, lobby settings
  (host picks circuit and laps), synced countdown/GO, state broadcast and
  final results (finish order, DNFs by distance).

## Deploying to the internet

The repo ships a single-image [Dockerfile](Dockerfile): it builds the client
and runs the Node server, which serves both the game page and the WebSocket
endpoint on one URL. Anyone opening the URL can practice solo or create/join
rooms — the menu's SERVER field defaults to the same origin automatically
(`wss://` on https).

**Render.com (simplest, free tier):**

1. Push this repo to GitHub.
2. Render → New → Web Service → connect the repo.
3. Runtime: **Docker** (it auto-detects the Dockerfile). Done — you get
   `https://your-app.onrender.com`. Free instances sleep when idle; the
   first visit takes ~30s to wake.

**Fly.io (better latency control, pick a region near your friends):**

```bash
fly launch --no-deploy   # accept the generated config, internal port 8090
fly deploy
```

**Railway / any VPS:** `docker build -t f1web . && docker run -p 8090:8090 f1web`.

Notes:

- WebSockets must be supported by the host (all of the above support them).
- Latency: pick one region close to your group; the netcode hides ~100ms
  comfortably but transatlantic racing will feel floaty.
- Split hosting also works: deploy `server/` anywhere Node runs and put
  `client/dist` on Netlify/Cloudflare Pages, setting `VITE_SERVER_URL`
  (e.g. `wss://game.example.com`) at build time for the default server field.

## Scripts

| Command | What |
| --- | --- |
| `npm run dev` | server + client dev mode, hot reload |
| `npm run build` | typecheck + production client build |
| `npm run start:server` | run the race server only |
| `npm run typecheck` | typecheck all workspaces |
| `npm run fetch-tracks` | re-download + convert circuit data |

## Notes

- Circuit layouts are factual data; circuit names are used descriptively.
  For a public release, rename tracks and avoid official F1 branding.
- Track data © TUMFTM racetrack-database contributors.
