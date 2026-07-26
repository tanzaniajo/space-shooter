# Star Runner

A small arcade-style space shooter built with plain HTML5 Canvas and JavaScript — no build step, no dependencies.

## Play

Open `index.html` in a browser, or serve the folder locally:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Controls

- **Move:** Arrow keys or WASD
- **Shoot:** Space
- **Pause:** P

## Features

- Wave-based enemy spawns that scale in size and difficulty (drones, strikers, tanks)
- Power-ups: spread shot, rapid fire, shield, extra life
- Particle explosions, parallax starfield, and simple procedural sound effects (Web Audio API)
- High score saved to `localStorage`
