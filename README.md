# ⚡ LUMINARY

A caped hero, a neon city at dusk, and golden rings to chase. Walk the plaza, jump, take off, and fly — solo or racing a friend. Built with vanilla **Three.js** and plain ES modules; no build step.

---

## What's in it

* **A hero who reads well from every angle** — a procedural, rigged superhero (masked face forward, hair and cape behind) with a pose system that follows what he's actually doing: running, jumping, climbing with a fist raised, prone cruising, one-fist supersonic, head-first dives.
* **Cape or energy wings** (`T`) — the cape is a Verlet cloth simulated in the hero's own frame, so it stays stable at 1,300 km/h.
* **Flight that feels good** — look up to climb, click to boost into supersonic, `C` to brake, hover when you let go.
* **A calm, modern chase camera** — spring-arm follow with capped lag, collision against buildings, event-driven shake only (landings, crashes, boost), and a comfortable FOV.
* **A real city** — a street grid with avenues, an open plaza at the spawn, and towers with properly sized floors of lit windows.
* **Rings as fly-through chains** — the first chain leads you down the avenue from the plaza; each ring in a streak climbs a musical scale.
* **Serverless multiplayer races** — WebRTC via Trystero over public Nostr relays. The room ID seeds the city, so everyone flies the same world.

---

## Controls

| Input | Action |
| :--- | :--- |
| Mouse | Steer & look (click the game to capture the mouse) |
| <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> | Move |
| <kbd>Space</kbd> | Jump · fly up |
| <kbd>Shift</kbd> | Fly down |
| Left click | Boost (supersonic; with <kbd>Shift</kbd> for a power dive) |
| <kbd>C</kbd> | Brake |
| <kbd>T</kbd> | Wings / cape |
| <kbd>Alt</kbd> (hold) | Look around the hero while flying straight |
| <kbd>H</kbd> | Show / hide controls |
| <kbd>Esc</kbd> | Release the mouse |

Touch devices get a joystick, altitude buttons, boost/brake, and optional gyro steering.

---

## Project layout

```
index.html                 Page shell, import map (three, trystero), HUD markup
css/style.css              All styling
js/
├── main.js                Title screen, lobby, launch
├── GameEngine.js          Renderer, scene, frame loop, event wiring
├── core/math.js           Shared helpers (damp, wrapAngle, seeded PRNG, noise)
├── entities/
│   ├── PlayerState.js     Shared state (plain data)
│   ├── CharacterRig.js    The hero: skeleton, suit, wings
│   └── CapeCloth.js       Cape cloth simulation
├── systems/
│   ├── Physics.js         Walk / jump / flight / collisions
│   ├── AnimationPose.js   Procedural poses (local hero and peers)
│   ├── Animation.js       Pose driver + trail, shockwave, dust, blob shadow
│   ├── CameraController.js Spring-arm chase camera
│   ├── InputManager.js    Keyboard, mouse, touch, gyro
│   ├── AudioManager.js    Procedural WebAudio
│   ├── MultiplayerManager.js  P2P rooms and remote heroes
│   └── RaceManager.js     Multiplayer race: countdown, beacon, results
├── ui/UIManager.js        HUD and overlays
└── world/
    ├── Environment.js     Sky, lights, street-level ground
    ├── CityGenerator.js   Instanced towers on the street grid
    └── Collectibles.js    Ring chains
```

`AI_CONTEXT.md` has the detailed map (frame order, ownership, conventions).

---

## Running

```bash
npm start            # dev server on http://localhost:8080 (node scratch/server.js)
npm test             # Playwright checks (local spec skips if the dev server isn't running)
```

Any static server works too (`npx serve .`). The page loads Three.js from jsDelivr, and Trystero from esm.run only when you host or join a race.

### Deploying

The site is static. With the Netlify CLI:

```bash
netlify deploy --prod --dir=.
```
