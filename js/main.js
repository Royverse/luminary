/**
 * js/main.js — LUMINARY Bootstrapper
 *
 * Sole responsibility: instantiate all top-level systems, wire them
 * together, and kick off the game loop when the user clicks LAUNCH.
 *
 * @ai-context
 *   OWNS      : shared math exports (lerp, clamp, expDecay, wrapAngle);
 *               LAUNCH button callback; top-level system instantiation.
 *   READS     : nothing from PlayerState.
 *   WRITES    : nothing to PlayerState.
 *   RELATED   : GameEngine.js (instantiation order), PlayerState.js (created here).
 *   ASK FOR   : GameEngine.js if changing system wiring or startup order.
 */

import * as THREE from 'three';
import { PlayerState }  from './entities/PlayerState.js';
import { AudioManager } from './systems/AudioManager.js';
import { UIManager }    from './ui/UIManager.js';
import { InputManager } from './systems/InputManager.js';
import { GameEngine }   from './GameEngine.js';

// ── Shared math utilities (used across every module) ─────────────────────────
// Re-exported here so every module can import from one canonical location.
export const { lerp, clamp } = THREE.MathUtils;

/** 1 - e^(-k·dt)  — framerate-independent exponential smoothing factor */
export const expDecay = (k, dt) => 1 - Math.exp(-k * dt);

/** Wrap an angle into (−π, π] */
export const wrapAngle = a => {
    while (a >  Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
};

// ── Bootstrap ─────────────────────────────────────────────────────────────────
window.addEventListener('load', () => {
    const state   = new PlayerState();
    const audio   = new AudioManager();
    const ui      = new UIManager();
    const input   = new InputManager(state);
    const engine  = new GameEngine(state, audio, ui, input);

    // Show the LAUNCH button once everything is built
    const btn = document.getElementById('start-btn');
    btn.style.display = 'block';

    btn.addEventListener('click', () => {
        // Fade out and remove the loader overlay
        const loader = document.getElementById('loader');
        loader.style.opacity = '0';
        setTimeout(() => (loader.style.display = 'none'), 600);

        // Reveal HUD elements
        document.getElementById('hud').style.display          = 'flex';
        document.getElementById('mode-badge').style.display   = 'block';
        document.getElementById('instructions').style.display = 'block';

        // Resume the AudioContext (browsers suspend it until a user gesture)
        audio.resume();

        // Hand control over to the game engine
        engine.start();
    });
});
