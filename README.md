<!-- markdownlint-disable MD033 MD041 -->
<div align="center">

# 🏁 F1 Web Racer

**Multiplayer Formula 1 racing in your browser — real circuits, room codes, zero installs.**

![Three.js](https://img.shields.io/badge/Three.js-000000?logo=three.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?logo=node.js&logoColor=white)
![WebSocket](https://img.shields.io/badge/WebSocket-realtime-e10600)

</div>

---

## ✨ Features

- 🏎️ **Online races for up to 12 drivers** — create a lobby, share a 4-letter code, lights out
- 🌍 **5 real F1 circuits** built from GPS measurements: Monza, Spa-Francorchamps, Silverstone, Suzuka, Interlagos
- ⚙️ **Simcade physics** — aero downforce, grip-budget cornering, friction-aware braking, momentum-exchange car contact
- 🟢 **Racing-line assist** that colors your braking zones live (green / yellow / red), plus real 150-100-50 brake markers
- 📊 **Broadcast-style HUD** — tachometer with gears, minimap, lap timing, live positions
- 🎮 **Keyboard & gamepad** support with analog steering and triggers
- 💨 The details: F1 start-light sequence, tire smoke, painted starting grid, finish countdown, DNF rules

## 🚀 Quick start

```bash
npm install
npm run dev      # server :8090 + client :5173
```

Open <http://localhost:5173> — practice solo or **CREATE RACE** and share the code.

Production build (one container serves everything):

```bash
docker build -t f1web .
docker run -p 8090:8090 f1web
```

## 🎮 Controls

| Input | Action |
| --- | --- |
| `W` / `↑` | Throttle |
| `S` / `↓` | Brake / reverse |
| `A` `D` / `←` `→` | Steer |
| `R` | Reset to track |
| `L` | Toggle racing line |
| `M` | Mute engine |
| `Esc` | Leave race |
| 🎮 Left stick / RT / LT / △ | Steer / throttle / brake / reset |

## 🧱 Under the hood

```text
shared/   real track centerlines, typed wire protocol
client/   Three.js renderer, 60 Hz physics, race logic, HUD
server/   Node room server: lobbies, countdown, 20 Hz state relay, results
```

Each player simulates their own car locally for zero input latency; opponents
render through jitter-smoothed snapshot interpolation. Checkpoint gates make
cut laps worthless, and all driver aids derive from the same grip model as
the physics — tuning one constant retunes the game.

## 📦 Credits

Circuit centerline data from the open
[TUMFTM racetrack-database](https://github.com/TUMFTM/racetrack-database).
Circuit names are used descriptively; this is a fan project, not affiliated
with Formula 1.
