# LUMINARY — Flight Engine | AI Context Document

> **Start every AI session by sharing this file.**
> It is the complete map of the codebase. Use the tables at the bottom
> to know which additional files to request before making any change.
> If something is unclear, **ask for the relevant source file** rather
> than assuming its contents.

---

## What This Project Is

LUMINARY is a browser-based 3D superhero flight game built with **Three.js v0.161**.
No build step — static files served by `scratch/server.js` (Node.js, port 8080).
The `index.html` hosts an `importmap` so bare `three` / `three/addons/` specifiers
resolve to the CDN at runtime. All modules are native ES6.

**Controls:** WASD move · SPACE/SHIFT up/down · Mouse look/steer · LMB supersonic boost · C air-brakes · T wings/cape toggle · ALT hold to Free Look · ESC release pointer lock.

---

## Complete File Tree

```
project-mootsana/
├── index.html              HTML shell only — no game logic. Hosts importmap + DOM.
├── css/
│   └── style.css           All CSS. HUD, loader, overlays, mobile controls.
├── scratch/
│   └── server.js           Dev server. Sets COOP + COEP headers required by SharedArrayBuffer.
└── js/
    ├── main.js             ENTRY POINT. Wires all systems. Exports shared math utilities.
    ├── GameEngine.js       Core rAF loop. Creates scene/camera/renderer. Calls all systems.
    ├── entities/
    │   ├── PlayerState.js  CENTRAL DATA STORE. All mutable state. Zero logic. Zero imports.
    │   └── CharacterRig.js Three.js meshes: humanoid body, GLSL wings, cape cloth geometry.
    ├── world/
    │   ├── Environment.js  Sky (Three Sky add-on), PMREM bake, lights, ground. Built once.
    │   ├── CityGenerator.js 10k instanced buildings. Writes AABB entries to state.spatialGrid.
    │   └── Collectibles.js 150 energy ring meshes. Exposes this.rings[].
    ├── systems/
    │   ├── InputManager.js Keyboard, pointer-lock mouse, mobile joystick/touch.
    │   ├── Physics.js      Flight/walk physics, drag, stall, hover, collisions.
    │   ├── Animation.js    Trail ribbon, shockwaves, landing dust. Delegates pose to AnimationPose.
    │   ├── AnimationPose.js Character kinematics + cape cloth solver. Pure exported function.
    │   ├── CameraJuice.js  Chase camera spring, FOV, shake, speed lines, collectibles update.
    │   └── AudioManager.js WebAudio API. Wind, rumble, collect chime, impact, sonic boom.
    └── ui/
        └── UIManager.js    ALL DOM writes. HUD values, mode badge, flash overlays.
```

---

## Module Dependency Graph

```
THREE (CDN importmap)
    │
    ▼
main.js ──exports──▶ lerp, clamp, expDecay, wrapAngle   ◀── imported by all systems
    │
    │  GameEngine instantiates in this exact order:
    │
    ├─ 1. Environment(scene, renderer)
    ├─ 2. CityGenerator(scene, state)     ← writes state.spatialGrid
    ├─ 3. Collectibles(scene, state)      ← exposes .rings[]
    ├─ 4. CharacterRig(scene, state)      ← exposes all mesh pivots + wingUniforms
    ├─ 5. Animation(state, rig, scene)
    ├─ 6. Physics(state, audio, ui, animation, rig)
    ├─ 7. CameraJuice(scene, camera, cameraRig, state, audio, rig, collectibles)
    └─ 8. input.attachRenderer(domElement)
```

**Rule:** No system imports another system. Cross-system calls go through
`state` (data) or explicit constructor injection (method calls).

---

## Frame Loop Order — `GameEngine._loop()` (every rAF)

```
dt = clock.getDelta()  [capped at 0.1 s]

1. Physics.update(dt)
     → resolves movement, collisions
     → calls animation.spawnShockwave() on boost start
     → calls animation.triggerLandingDust() on landing
     → calls audio.updateRumble(), audio.playImpactSound(), etc.
     → calls ui.flashImpact(), ui.triggerBoomFlash()

2. Animation.update(dt, time)
     → calls AnimationPose.updateCharacterPose() — kinematics + cloth
     → updates trail ribbon, shockwave ring pool, landing dust particles

3. CameraJuice.update(dt, time)
     → spring-drives cameraRig toward offset from player
     → animates FOV, screen shake, speed lines
     → bobs collectibles, detects ring collection
     → calls audio.updateWind()
     → writes state.displayAlt / state.displaySpeed

4. UIManager.update(dt, state)
     → reads state (display values, score, currentState, input.brake)
     → writes DOM: HUD, mode badge, boost vignette opacity

5. renderer.render(scene, camera)
```

---

## PlayerState Field Index

> **Always open `PlayerState.js` when editing Physics, Animation, or CameraJuice.**

### Flight Constants (edit here, not inside Physics.js)
| Field | Default | Meaning |
|-------|---------|---------|
| `normalSpeedCap` | 110 | m/s cap in normal flight |
| `boostSpeedCap` | 240 | m/s cap while boosting |
| `diveSpeedCap` | 380 | m/s cap in power dive |
| `accelForce` | 280 | Thrust force (N equivalent) |
| `boostForce` | 900 | Boost thrust force |
| `gravity` | 14.0 | Downward gravity (m/s²) |
| `liftCoeff` | 0.75 | Aerodynamic lift multiplier |
| `kDragFwdNormal` | 1.4 | Forward drag in flight |
| `kDragFwdBoost` | 0.5 | Forward drag while boosting |
| `kDragFwdBrake` | 9.0 | Forward drag on air brake |
| `kDragLateral` | 3.8 | Lateral drag |
| `kBoostWindup` | 4.5 | Boost buildup rate |
| `kBoostDecay` | 3.0 | Boost decay rate |

### Input Snapshot (written by InputManager only)
| Field | Type | Notes |
|-------|------|-------|
| `input.forward` | -1/0/1 | W/S key or joystick Y |
| `input.right` | -1/0/1 | A/D key or joystick X |
| `input.up` | -1/0/1 | SPACE / SHIFT |
| `input.boost` | bool | LMB / boost button |
| `input.brake` | bool | C key / brake button |
| `mouse.x` | radians | Yaw accumulator |
| `mouse.y` | radians | Pitch accumulator (clamped ±π/2.05) |
| `mouse.dx` | px/frame | Horizontal mouse delta |
| `pointerLocked` | bool | Pointer lock state |

### Dynamic Flight State (written by Physics)
| Field | Notes |
|-------|-------|
| `currentState` | IDLE=0 FLIGHT=1 SUPERSONIC=2 STALL=3 POWERDIVE=4 WALK=5 |
| `velocity` | THREE.Vector3, world space m/s |
| `fwdDir / rightDir / upDir` | Player orientation basis (updated each frame) |
| `currentYaw / currentPitch` | Mirror of mouse.x / mouse.y after wrapAngle |
| `rollAngle / turnBank` | Camera/body roll from yaw delta |
| `isStalling / stallProgress / stallSpinRate` | Stall dynamics |
| `isJumping / isSprinting / wasGrounded / isGrounded` | Ground and building rooftop grounded states |
| `boostWindup` | 0–1 exponential buildup |
| `boostPunch` | 0–1 decay used for FOV kick + shake |
| `hoverBobPhase / hoverTargetY / hoverBlend` | Hover oscillation |
| `simTime` | Accumulated seconds; used by cape wind oscillation |
| `lastBoostState` | Edge detection for sonic boom trigger |
| `showWings` | Bool (mutually exclusive wings vs cape toggle) |
| `freeLook` | Bool (ALT key camera free look state flag) |

### Spatial Grid (written by CityGenerator, read by Physics)
```js
state.spatialGrid  // Map<"bx,bz", Array<AABB>>
// Each AABB: { cx, cz, minX, maxX, minZ, maxZ, maxY }
state.bucketSize   // 300 — world units per cell
```

---

## Ownership Contracts

These rules must never be broken. If you are tempted to break one,
request the owning file and work within it instead.

| What | Owned exclusively by |
|------|---------------------|
| All DOM reads/writes | `UIManager.js` |
| `state.input` + `state.mouse` writes | `InputManager.js` |
| `state.spatialGrid` population | `CityGenerator.js` |
| Player position integration (`p.addScaledVector`) | `Physics.js` |
| Cape cloth particle simulation (Verlet + constraints) | `AnimationPose.js` |
| Wing GLSL shader source | `CharacterRig.js` |
| Wing uniform `time` + `boost` updates | `AnimationPose.js` |
| Collectible `active` flag + score writes | `CameraJuice.js` |
| `displayAlt` + `displaySpeed` smoothing | `CameraJuice.js` |
| Trail ribbon, shockwave pool, landing dust | `Animation.js` |
| Speed lines mesh | `CameraJuice.js` |
| Camera spring (`cameraVelocity`, `cameraRig` position) | `CameraJuice.js` |

---

## Before Editing — Required Context Table

> If you only have this file open, use this table to know what to request.

| Goal | Request these files |
|------|---------------------|
| Tune flight feel (speed, drag, gravity) | `PlayerState.js` · `Physics.js` |
| Fix stall / hover / boost behaviour | `PlayerState.js` · `Physics.js` |
| Change walking / jumping | `PlayerState.js` · `Physics.js` · `AnimationPose.js` |
| Edit character pose or limb angles | `AnimationPose.js` · `CharacterRig.js` |
| Fix cape clipping or cloth behaviour | `AnimationPose.js` · `CharacterRig.js` |
| Edit wing shader (GLSL) | `CharacterRig.js` |
| Change wing animation timing | `AnimationPose.js` (wingUniforms.time/boost) |
| Camera spring / follow offset | `CameraJuice.js` · `PlayerState.js` |
| FOV values or screen shake | `CameraJuice.js` |
| HUD layout or display values | `UIManager.js` · `css/style.css` |
| Key bindings or mouse sensitivity | `InputManager.js` |
| Audio synths / sound design | `AudioManager.js` |
| City density, building height, footprint | `CityGenerator.js` |
| Building collision radius | `Physics.js` (constant `hr`) · `CityGenerator.js` |
| Ring count, placement, collection radius | `Collectibles.js` · `PlayerState.js` (totalRings) · `CameraJuice.js` |
| Trail / shockwave / dust effects | `Animation.js` |
| Speed lines | `CameraJuice.js` |
| Add a new game state | `PlayerState.js` (STATES enum) · `Physics.js` · `AnimationPose.js` · `UIManager.js` |
| Add a new sound | `AudioManager.js` · caller file |
| Add a new HUD element | `index.html` (DOM) · `css/style.css` · `UIManager.js` |

---

## Key Patterns & Conventions

```js
// Shared math — ALWAYS import from main.js, never redefine
import { lerp, clamp, expDecay, wrapAngle } from '../main.js';

// Exponential smoothing (framerate-independent)
// Higher k = faster. Typical values: 4 (slow) → 15 (snappy)
value += (target - value) * expDecay(k, dt);

// Wrap angle into (-π, π]
angle = wrapAngle(angle);
```

```
Cape cloth: Verlet integration + 10 constraint iterations per frame.
  Top row (y=0) = pinned to rig.leftPin / rig.rightPin world positions.
  12 spherical body colliders push particles out each iteration.
  Cloth mesh vertex buffer written directly from particles[].pos each frame.

Camera: Spring-damper tracking point at offset (0, 4, 16) in view space.
  kCam=45 (spring stiffness), bCam=12 (damping). Velocity capped at 800 m/s.
  Rig quaternion slerped toward viewQuat at expDecay(14, dt).

Building collision: Spatial hash ±2 buckets (~600 world units).
  Hit radius hr=2.2. AABB overlap resolved along minimum-penetration axis.
```

---

## What This Document Does NOT Cover

- The Three.js API itself — refer to https://threejs.org/docs/
- CSS layout details — open `css/style.css`
- The dev server — open `scratch/server.js`
- Netlify deployment — see `netlify.toml` and `README.md`

---

## Automated QA & Visual Verification (Playwright)

To guarantee that code modifications do not break the 3D canvas or introduce silent WebGL compilation/runtime crashes, a fully integrated **Playwright Automated QA Suite** is active in the repository.

### Test Structure & Configuration
*   **Test Script:** [`tests/game.spec.js`](file:///c:/Users/User/.gemini/antigravity/playground/warped-planck/project-mootsana/tests/game.spec.js)
*   **Playwright Config:** [`playwright.config.js`](file:///c:/Users/User/.gemini/antigravity/playground/warped-planck/project-mootsana/playwright.config.js)
*   **Command to Run Tests:**
    ```bash
    npx playwright test
    ```

### Capabilities & Assertions
1.  **Direct DOM & Render Verification:** Checks page title, detects loader screen (`#loader`), triggers the `#start-btn` launch click, expects the loader to fade out successfully, and asserts the injection of the 3D `<canvas>` element and `#hud`.
2.  **PointerLock Mocking:** In headless environments, pointer lock triggers exceptions or browser permission warnings. The test initializes a clean Javascript proxy overlaying `Element.prototype.requestPointerLock` to ensure silent rendering continuation.
3.  **Real-Time Console & Exception Listening:** Watches all `pageerror` and `console` event listeners. The test will **automatically fail** if *any* Javascript warning, unhandled exception, or WebGL shader compile warning is thrown.
4.  **Visual Artefacts:** Saves visual verification frames inside the [`artifacts/`](file:///c:/Users/User/.gemini/antigravity/playground/warped-planck/project-mootsana/artifacts) folder:
    *   `artifacts/loading_screen.png` — loading card state
    *   `artifacts/gameplay_verification.png` — active 3D city scene rendering check

---

## Standard Development & Deployment Loop

All participating parties—including developers and AI assistants (e.g., Antigravity)—must follow this pipeline whenever modifying codebase features or state:

```
1. Feature Code Modification (in Physics, Animation, etc.)
               │
               ▼
2. Run Playwright Tests (npx playwright test)
               │
        ┌──────┴──────┐
        ▼             ▼
     [FAIL]        [PASS] (Zero WebGL compile warnings or console errors)
        │             │
  Fix typos/mesh      ▼
  warnings      3. Commit & Push Code (git add & commit & push origin main)
                      │
                      ▼
                4. Live Production Deploy (netlify deploy --prod)
```

> [!NOTE]
> Running `npx playwright test` automatically ensures the live staging site matches our modular contracts perfectly. Keep it green!

