/**
 * js/GameEngine.js — Renderer, scene, and the frame loop.
 *
 * Frame order: Physics → Race → Animation (pose, cape, effects) → Rings →
 * Multiplayer → Camera → Audio → HUD → render.
 *
 * @ai-context
 *   OWNS      : renderer, scene, camera, clock; construction order; event wiring
 *               between Physics and the feedback systems (effects, audio, camera, HUD).
 */
import * as THREE from 'three';
import { Environment }      from './world/Environment.js';
import { CityGenerator }    from './world/CityGenerator.js';
import { Collectibles }     from './world/Collectibles.js';
import { CharacterRig }     from './entities/CharacterRig.js';
import { Physics }          from './systems/Physics.js';
import { Animation }        from './systems/Animation.js';
import { CameraController } from './systems/CameraController.js';
import { RaceManager }      from './systems/RaceManager.js';

const _hero = new THREE.Vector3();

export class GameEngine {
    constructor(state, audio, ui, input) {
        this.state = state;
        this.audio = audio;
        this.ui    = ui;
        this.input = input;

        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        this.renderer.setSize(innerWidth, innerHeight);
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.6;
        document.body.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x05060f, 0.00042);
        this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.3, 9000);

        addEventListener('resize', () => {
            this.camera.aspect = innerWidth / innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(innerWidth, innerHeight);
        });

        this.environment = new Environment(this.scene, this.renderer);
        this.city        = new CityGenerator(this.scene, state);
        this.rig         = new CharacterRig(this.scene);
        this.animation   = new Animation(state, this.rig, this.scene);
        this.cameraCtl   = new CameraController(this.scene, this.camera, state, this.rig);
        this.collectibles = new Collectibles(this.scene, state, combo => {
            audio.playCollect(combo);
            ui.ringCollected(combo);
        });
        this.physics = new Physics(state, this.rig, {
            boost: () => {
                this.animation.shockwave();
                this.cameraCtl.kick();
                this.cameraCtl.addTrauma(0.25);
                audio.playSonicBoom();
            },
            land: (strength, position) => {
                this.animation.landingDust(position, strength);
                this.cameraCtl.addTrauma(Math.min(0.6, strength * 0.7));
                audio.playImpact(strength * 0.8);
            },
            impact: strength => {
                this.cameraCtl.addTrauma(Math.min(0.9, strength));
                ui.flashImpact(strength);
                audio.playImpact(strength);
            },
        });

        input.attachRenderer(this.renderer.domElement);
        this.race = state.isMultiplayer ? new RaceManager(state, this.scene, this.rig, ui) : null;
        this.multiplayer = null;
    }

    start() {
        this.clock = new THREE.Clock();
        this.race?.startRace();
        this.renderer.setAnimationLoop(() => this._frame());
    }

    _frame() {
        const dt = Math.min(this.clock.getDelta(), 0.1);
        const time = this.clock.elapsedTime;
        const s = this.state;

        s.showWings !== this.rig.wings.visible && this.rig.setWingsVisible(s.showWings);
        this.physics.update(dt);
        this.race?.update(dt);
        this.animation.update(dt, time);
        this.collectibles.update(dt, time, this.rig.centerWorld(_hero));
        this.environment.update(_hero);
        this.multiplayer?.update(dt, this.camera);
        this.cameraCtl.update(dt, time);
        this.audio.update(dt, s);
        this.ui.update(dt, s);

        this.renderer.render(this.scene, this.camera);
    }
}
