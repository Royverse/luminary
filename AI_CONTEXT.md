# LUMINARY — AI Context

> Share this file at the start of an AI session. It maps the codebase; open the
> files named in the tables before changing anything they own.

## What this is

A browser 3D superhero game on **Three.js 0.161** (CDN via `index.html` import map).
Native ES modules, no build step. `node scratch/server.js` serves it on port 8080.

Design intent: **less is more**. Few effects, a small HUD, a camera that never
fights the player. Prefer tuning or removing over adding.

## Conventions (everything depends on these)

* **The hero faces −Z**, same as the camera. +X is the hero's right, +Y up.
  Walking sets `player.rotation.y = atan2(-vx, -vz)`; flight follows the look yaw.
* `rig.player` = root at the feet (Physics owns it). `rig.joints.body` pivots at the
  hips; `rotation.x = −π/2` lays the hero prone for flight.
* Joint signs: `rotation.x > 0` swings a hanging limb forward (hip / shoulder /
  elbow flexion); knee flexion is negative; ankle < 0 points the toes;
  `rotation.z = side × abduction` with side +1 right, −1 left.
* Model built in metres (1.85 m hero), scaled by `CHAR_SCALE = 1.6`.
* Smoothing is framerate-independent: `v += (target - v) * damp(k, dt)`.
* Shared helpers live in `js/core/math.js` — never import from `main.js`.

## Frame loop (`GameEngine._frame`)

```
Physics → Race (multiplayer only) → Animation (pose, cape, effects) → Collectibles
→ Environment (ground follows hero) → Multiplayer → Camera → Audio → UI → render
```

Physics reports moments through events wired in `GameEngine`:
`boost` → shockwave + FOV kick + small shake + boom · `land` → dust + shake + thud ·
`impact` → shake + flash + thud.

## Ownership

| What | Owner |
|------|-------|
| Hero transform, velocity, state machine, collisions, `groundHeight`, `altitude` | `Physics.js` |
| `state.input`, `currentYaw/currentPitch`, `showWings`, `freeLook`, `showHelp` | `InputManager.js` |
| Hero meshes, wing shader | `CharacterRig.js` |
| Cape cloth (local-space Verlet, 90 Hz substeps, sphere colliders) | `CapeCloth.js` |
| Joint angles, wing uniforms, emblem glow | `AnimationPose.js` |
| Trail, shockwave, dust, blob shadow | `Animation.js` |
| Camera transform, FOV, shake, speed streaks | `CameraController.js` |
| `spatialGrid` (building AABBs) | `CityGenerator.js` |
| Rings, score, streaks | `Collectibles.js` |
| All in-game DOM | `UIManager.js` (race overlays: `RaceManager.js`; lobby: `main.js`/`MultiplayerManager.js`) |

## Key state (`PlayerState.js`)

* `STATES` — `IDLE 0` (hover) · `FLIGHT 1` · `SUPERSONIC 2` · `POWERDIVE 4` · `WALK 5`
  (numbers are part of the multiplayer wire format).
* Flight tuning: `normalSpeedCap 110`, `boostSpeedCap 240`, `diveSpeedCap 380`,
  `accelForce 280`, `boostForce 900`, drags `kDrag*`, `gravity 14`, `liftCoeff 0.75`, `jumpForce 12.5`.
* `input.jump` is a latched press so a tap shorter than a frame still jumps.
* `spatialGrid: Map<"bx,bz", AABB[]>`, `bucketSize 300`. AABB = `{cx,cz,minX,maxX,minZ,maxZ,maxY}`.

## Camera (`CameraController.js`)

Pivot = hero hips, lag capped at 0.35–1.5 m. Arm offset (walk → flight):
height 1.7 → 2.3, distance 7.5 → 7.5–9.5. The arm is ray-tested against building
AABBs and the ground: it snaps in and eases out. Shake = trauma² × smooth noise,
rotation only. FOV 70–93°.

## City + rings

Street pattern repeats every 480 m: six 50 m blocks, 24 m streets, a 60 m avenue on
`x = 480k` / `z = 480k`. The origin is an avenue intersection kept open as a plaza.
Windows are mapped in world space (4 m floors). Rings come in chains of six:
chain 0 leads down the avenue from the plaza; odd chains are avenue canyon runs;
even chains arc over rooftops. Collection tests the segment flown each frame.

## Before editing

| Goal | Open |
|------|------|
| Flight / walking feel | `PlayerState.js`, `Physics.js` |
| Poses, limbs | `AnimationPose.js`, `CharacterRig.js` |
| Cape behaviour | `CapeCloth.js` (+ `CharacterRig.js` joints) |
| Camera | `CameraController.js` |
| HUD | `index.html`, `css/style.css`, `UIManager.js` |
| City / rings | `CityGenerator.js`, `Collectibles.js`, `Environment.js` |
| Multiplayer | `MultiplayerManager.js`, `RaceManager.js`, `main.js` |

## Testing

* `tests/local-verify.spec.js` — loads `http://localhost:8080`, launches, fails on any
  console error. Skips when the dev server isn't running.
* `tests/game.spec.js` — same checks against the live Netlify site.
* Append `?debug` to the URL to expose `window.luminary = { state, engine }`.

## Deploy

Static site: `netlify deploy --prod --dir=.` (headers in `netlify.toml`).
