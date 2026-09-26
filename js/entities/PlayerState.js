/**
 * js/entities/PlayerState.js — Shared game state. Plain data, no logic.
 *
 * @ai-context
 *   WRITERS   : input + currentYaw/currentPitch + showWings/freeLook/showHelp ← InputManager
 *               velocity, currentState, grounded/jumping, roll, groundHeight   ← Physics
 *               spatialGrid                                                     ← CityGenerator
 *               score / highScore / combo                                       ← Collectibles
 */
import * as THREE from 'three';

function stored(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

export class PlayerState {
    constructor() {
        // Numbers are part of the multiplayer wire format — keep them stable.
        this.STATES = Object.freeze({ IDLE: 0, FLIGHT: 1, SUPERSONIC: 2, POWERDIVE: 4, WALK: 5 });
        this.currentState = this.STATES.WALK;

        // ── Flight tuning ─────────────────────────────────────────────
        this.normalSpeedCap = 110;
        this.boostSpeedCap  = 240;
        this.diveSpeedCap   = 380;
        this.accelForce     = 280;
        this.boostForce     = 900;
        this.kDragFwdNormal = 1.4;
        this.kDragFwdBoost  = 0.5;
        this.kDragFwdBrake  = 9.0;
        this.kDragLateral   = 3.8;
        this.kDragVertWorld = 0.8;
        this.kSpeedCapSoft  = 5.0;
        this.gravity        = 14.0;
        this.liftCoeff      = 0.75;
        this.jumpForce      = 12.5;
        this.kBoostWindup   = 4.5;
        this.kBoostDecay    = 3.0;

        // ── Dynamics (Physics) ────────────────────────────────────────
        this.velocity       = new THREE.Vector3();
        this.fwdDir         = new THREE.Vector3(0, 0, -1);
        this.rightDir       = new THREE.Vector3(1, 0, 0);
        this.boostWindup    = 0;
        this.rollAngle      = 0;
        this.turnBank       = 0;
        this.hoverBobPhase  = 0;
        this.hoverTargetY   = 0;
        this.hoverBlend     = 0;
        this.isJumping      = false;
        this.isGrounded     = true;
        this.groundHeight   = 0;
        this.altitude       = 0;
        this.buildingProximity = 0;
        this.simTime        = 0;

        // ── Input (InputManager) ──────────────────────────────────────
        this.input          = { forward: 0, right: 0, up: 0, jump: false, boost: false, brake: false };  // jump: latched press
        this.currentYaw     = 0;   // look direction; the camera and flight follow it
        this.currentPitch   = 0;
        this.pointerLocked  = false;
        this.showWings      = true;
        this.freeLook       = false;
        this.showHelp       = true;

        // ── Rings (Collectibles) ──────────────────────────────────────
        this.score           = 0;
        this.highScore       = parseInt(stored('luminary_highscore', '0'), 10) || 0;
        this.totalRings      = 150;
        this.comboCount      = 0;
        this.lastCollectTime = 0;

        // ── World (CityGenerator) ─────────────────────────────────────
        this.bucketSize  = 300;
        this.spatialGrid = new Map();
        this.random      = Math.random;

        // ── Multiplayer ───────────────────────────────────────────────
        this.isMultiplayer = false;
        this.isHost        = false;
        this.roomID        = null;
        this.localNickname = stored('luminary_nickname', 'HERO');
        this.peers         = new Map();
    }
}
