# ⚡ LUMINARY — 3D Flight Engine

> [!NOTE]
> Welcome to **LUMINARY**, a high-octane, premium 3D browser flight experience built on top of vanilla **Three.js** and clean **ES6 modular architecture**. Fly through a dynamically generated neon metropolis, gather glowing energy rings, dodge skyscrapers, and switch between high-speed flying modes!

---

## 🌌 The Vibe & Features

Luminary is designed to look and feel extremely premium, featuring:
*   **🚀 High-Velocity Flight Physics:** Dynamic drag coefficients, lift equations, air brakes, power dives, and supersonic boom shockwaves.
*   **🕸️ Serverless P2P WebRTC Multiplayer:** Real-time movement synchronization via Trystero and public Nostr relays (Damus/Nos.lol). Highly resilient against firewalls with 0% server costs!
*   **🎲 Seeded Deterministic Metropolis:** Replaces standard randomness with a Mulberry32 PRNG seeded by the WebRTC `roomID`. Both clients automatically generate the *exact same skyscraper architecture and collectible rings* locally, completely eliminating large world sync payloads!
*   **🏁 Competitive Point-to-Point Racing:** Dash across the generated city to a towering, neon-pink sky laser Finish Beacon, guided by a 100% fair relative 3D compass HUD.
*   **💫 Peer Visual Supersonic Sync:** connected players leave gorgeous hot-pink supersonic trails behind them when boosting, making it incredibly clean to track competitors at high altitudes.
*   **👗 Procedural Verlet cape cloth simulation** that reacts beautifully to flight drag, velocity, and gravity.
*   **✨ Mutually Exclusive Flight Customization:** Switch between a sweeping crimson cape or glowing cyan-magenta energy wings on the fly!
*   **🎥 Free Look Camera System:** Hold the `ALT` key to orbit the camera fully around the hero to check out your flight from the front without steering off-course.

---

## 🕹️ Controls (How to Fly)

| Command | Action |
| :--- | :--- |
| <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> | **Steer / Move Around** (Ground Walk / Air) |
| <kbd>SPACE</kbd> / <kbd>SHIFT</kbd> | **Boost Altitude** / **Dive Altitude** |
| <kbd>MOUSE</kbd> | **Camera Steering** (Steer flight vector / Look on ground) |
| <kbd>LMB</kbd> (Left Mouse Button) | **Supersonic Boost** 🚀 (Triggers boom flash + shockwave) |
| <kbd>C</kbd> | **Air Brakes** 🛑 (Engages high-coefficient drag) |
| <kbd>T</kbd> | **Toggle Cape / Wings Mode** 🎛️ (Cyberpunk toggle) |
| <kbd>ALT</kbd> (Hold) | **Unlock Free Look** 👁️ (Orbit around character while flying straight) |

---

## 📁 Scalable Directory Architecture

```
/
├── index.html                 # Launcher bootstrap page
├── netlify.toml               # Single-page app production config
├── css/
│   └── style.css              # Glassmorphic premium UI styles
├── js/
│   ├── main.js                # Core bootstrapper
│   ├── GameEngine.js          # Clock, Scene, WebGLRenderer, rAF Loop
│   ├── entities/
│   │   ├── CharacterRig.js    # Character mesh builder & Cape Verlet solver
│   │   └── PlayerState.js     # Single source of truth data store
│   ├── systems/
│   │   ├── Animation.js       # Effect manager (shockwaves, trails, dust)
│   │   ├── AnimationPose.js   # Character skeleton dynamic pose solver
│   │   ├── AudioManager.js    # Synths & procedural audio (Wind rumble)
│   │   ├── InputManager.js    # Mouse, keyboard & mobile touch listeners
│   │   ├── MultiplayerManager.js # [NEW] WebRTC state sync, nickname broadcasting & peer trail rendering
│   │   ├── Physics.js         # Aerospace lift, drag, AABB building collision
│   │   └── RaceManager.js        # [NEW] Checkpoint laser beacon, waypoint compass HUD & winner arbitration overlays
│   ├── ui/
│   │   └── UIManager.js       # HTML HUD DOM reads / writes
│   └── world/
│       ├── CityGenerator.js   # Procedural architectural builder
│       ├── Collectibles.js    # Ring positions & meshes
│       └── Environment.js     # Directional lighting & volumetric fog
└── tests/
    └── game.spec.js           # Automated Playwright visual QA suite
```

---

## 🚀 Running & Deploying

### Local Development
You can run this project locally without any complex build pipeline. Just start a simple local server in the project folder:
```bash
# Using standard Python server
python -m http.server 8080

# Or Node.js static server
npx serve .
```

### Production Deployment
Luminary is completely production-ready with continuous deployment integrated out of the box!
```bash
# Deploy instantly to Netlify production
netlify deploy --prod --dir=.
```

> [!TIP]
> Before pushing changes, run the automated Playwright sanity suite using `npx playwright test` to guarantee that your modifications haven't introduced any console errors or WebGL compiler exceptions. Stay fly! 🚀
