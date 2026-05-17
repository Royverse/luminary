/**
 * js/entities/PlayerState.js
 *
 * Central data store — the single source of truth for every mutable
 * game variable. NO logic lives here. This is a plain data container.
 *
 * @ai-context
 *   OWNS      : ALL mutable game variables and physics constants.
 *   READS     : nothing (no imports except THREE).
 *   WRITES    : nothing (other systems write TO it).
 *   RELATED   : AI_CONTEXT.md §PlayerState Field Index for full field docs.
 *   ASK FOR   : This file any time you are editing Physics, Animation,
 *               CameraJuice, or InputManager — it defines the contract.
 *
 *   FIELD WRITERS (do not write to these fields in the wrong system):
 *     input / mouse / pointerLocked  ← InputManager only
 *     spatialGrid                    ← CityGenerator only
 *     displayAlt / displaySpeed      ← CameraJuice only
 *     score / highScore              ← CameraJuice only
 *     velocity / currentState / roll ← Physics only
 */

import * as THREE from 'three';

export class PlayerState {
    constructor() {

        // ── Flight states ────────────────────────────────────────────
        this.STATES = Object.freeze({
            IDLE:      0,
            FLIGHT:    1,
            SUPERSONIC:2,
            STALL:     3,
            POWERDIVE: 4,
            WALK:      5,
        });
        this.currentState = this.STATES.IDLE;

        // ── Speed / force constants ──────────────────────────────────
        this.normalSpeedCap  = 110;
        this.boostSpeedCap   = 240;
        this.diveSpeedCap    = 380;
        this.accelForce      = 280;
        this.boostForce      = 900;

        // ── Drag coefficients ────────────────────────────────────────
        this.kDragFwdNormal  = 1.4;
        this.kDragFwdBoost   = 0.5;
        this.kDragFwdBrake   = 9.0;
        this.kDragLateral    = 3.8;
        this.kDragVertWorld  = 0.8;
        this.gravity         = 14.0;
        this.liftCoeff       = 0.75;

        // ── Boost windup ─────────────────────────────────────────────
        this.boostWindup     = 0;
        this.kBoostWindup    = 4.5;
        this.kBoostDecay     = 3.0;

        // ── Hover bob ────────────────────────────────────────────────
        this.hoverBobPhase   = 0;
        this.hoverTargetY    = 0;
        this.hoverBlend      = 0;

        // ── Orientation ──────────────────────────────────────────────
        this.currentYaw      = 0;
        this.currentPitch    = 0;
        this.rollAngle       = 0;
        this.turnBank        = 0;
        this._lastYaw        = 0;

        // ── Stall ────────────────────────────────────────────────────
        this.isStalling      = false;
        this.stallProgress   = 0;
        this.stallSpinRate   = 0;
        this.STALL_SPIN_TARGET = 3.5;

        // ── Dynamics ─────────────────────────────────────────────────
        this.boostPunch      = 0;
        this.velocity        = new THREE.Vector3();
        this.cameraVelocity  = new THREE.Vector3();

        // ── Direction basis vectors (updated each frame by Physics) ──
        this.fwdDir   = new THREE.Vector3(0, 0, -1);
        this.rightDir = new THREE.Vector3(1, 0, 0);
        this.upDir    = new THREE.Vector3(0, 1, 0);

        // ── Input snapshot (written by InputManager) ─────────────────
        this.input = { forward: 0, right: 0, up: 0, boost: false, brake: false };

        // ── Mouse state (written by InputManager) ────────────────────
        this.mouse = { x: 0, y: 0, dx: 0 };
        this.pointerLocked = false;

        // ── Walking / jumping ────────────────────────────────────────
        this.walkT           = 0;
        this.simTime         = 0;
        this.isJumping       = false;
        this.jumpVelocity    = 0;
        this.isSprinting     = false;

        // ── Score ────────────────────────────────────────────────────
        this.score           = 0;
        this.highScore       = parseInt(localStorage.getItem('luminary_highscore') || '0');
        this.totalRings      = 150;

        // ── Double-tap tracking ──────────────────────────────────────
        this.lastTap         = { A: 0, D: 0 };

        // ── Smoothed display values ──────────────────────────────────
        this.displaySpeed    = 0;
        this.displayAlt      = 0;

        // ── Boost edge detection ─────────────────────────────────────
        this.lastBoostState  = false;

        // ── Ground landing ───────────────────────────────────────────
        this.wasGrounded     = false;

        // ── Spatial grid (populated by CityGenerator) ────────────────
        this.bucketSize      = 300;
        this.spatialGrid     = new Map();

        // ── Wing shader uniforms (set by CharacterRig, read by Animation) ──
        this.wingUniforms    = null;
        this.showWings       = true;
    }
}
