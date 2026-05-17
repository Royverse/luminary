/**
 * js/GameEngine.js — Core loop, Scene, Renderer, Clock
 *
 * Responsibilities
 *   • Create the THREE.WebGLRenderer, PerspectiveCamera, and Scene.
 *   • Instantiate every world / entity / system object and pass them
 *     the shared scene, camera, and PlayerState references they need.
 *   • Run the requestAnimationFrame loop and call each system in the
 *     correct order once per frame.
 *
 * @ai-context
 *   OWNS      : renderer, scene, camera, cameraRig, THREE.Clock;
 *               system construction order; rAF loop.
 *   READS     : nothing from PlayerState directly.
 *   WRITES    : nothing to PlayerState directly.
 *   FRAME ORDER: Physics → Animation → CameraJuice → UIManager → render.
 *   RELATED   : ALL system files (it constructs them); main.js (calls start()).
 *   ASK FOR   : AI_CONTEXT.md for the full dependency graph before editing.
 *
 * Systems called each frame (in order):
 *   1. Physics.update(dt)
 *   2. Animation.update(dt, time)  ← pose + cape cloth sim
 *   3. CameraJuice.update(dt, time)← chase-cam + FOV + collectibles
 *   4. UIManager.update(dt, state) ← HUD DOM writes
 *   5. renderer.render(scene, cam)
 */

import * as THREE from 'three';

import { PlayerState }   from './entities/PlayerState.js';
import { AudioManager }  from './systems/AudioManager.js';
import { UIManager }     from './ui/UIManager.js';
import { InputManager }  from './systems/InputManager.js';

import { Environment }   from './world/Environment.js';
import { CityGenerator } from './world/CityGenerator.js';
import { Collectibles }  from './world/Collectibles.js';

import { CharacterRig }  from './entities/CharacterRig.js';
import { Physics }       from './systems/Physics.js';
import { Animation }     from './systems/Animation.js';
import { CameraJuice }   from './systems/CameraJuice.js';

export class GameEngine {
    /**
     * @param {PlayerState}  state
     * @param {AudioManager} audio
     * @param {UIManager}    ui
     * @param {InputManager} input
     */
    constructor(state, audio, ui, input) {
        this.state = state;
        this.audio = audio;
        this.ui    = ui;
        this.input = input;

        // ── Renderer ──────────────────────────────────────────────────
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            powerPreference: 'high-performance',
        });
        this.renderer.setSize(innerWidth, innerHeight);
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        this.renderer.toneMapping         = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.55;
        document.body.appendChild(this.renderer.domElement);

        // ── Scene ─────────────────────────────────────────────────────
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x04050f, 0.00045);

        // ── Camera + rig ──────────────────────────────────────────────
        this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.5, 9000);
        this.cameraRig = new THREE.Group();
        this.cameraRig.add(this.camera);
        this.scene.add(this.cameraRig);

        // ── Resize handler ────────────────────────────────────────────
        window.addEventListener('resize', () => {
            this.camera.aspect = innerWidth / innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(innerWidth, innerHeight);
        });

        // ── World ─────────────────────────────────────────────────────
        this.environment   = new Environment(this.scene, this.renderer);
        this.cityGenerator = new CityGenerator(this.scene, this.state);
        this.collectibles  = new Collectibles(this.scene, this.state);

        // ── Player entity ─────────────────────────────────────────────
        this.rig = new CharacterRig(this.scene, this.state);

        // ── Systems (order matters: animation before physics) ─────────
        this.animation = new Animation(
            this.state, this.rig, this.scene
        );
        this.physics = new Physics(
            this.state, this.audio, this.ui,
            this.animation, this.rig
        );
        this.cameraJuice = new CameraJuice(
            this.scene, this.camera, this.cameraRig,
            this.state, this.audio,
            this.rig, this.collectibles
        );

        // Pass the renderer canvas to InputManager so it can attach the
        // pointer-lock click listener to exactly the right element.
        this.input.attachRenderer(this.renderer.domElement);

        this.clock = null; // created in start() after user gesture
    }

    /** Called by main.js after the LAUNCH button is clicked. */
    start() {
        this.clock = new THREE.Clock();
        this._loop();
    }

    _loop() {
        requestAnimationFrame(() => this._loop());

        const dt = Math.min(this.clock.getDelta(), 0.1);

        this.physics.update(dt);
        this.animation.update(dt, this.clock.getElapsedTime());
        this.cameraJuice.update(dt, this.clock.getElapsedTime());
        this.ui.update(dt, this.state);

        this.renderer.render(this.scene, this.camera);
    }
}
