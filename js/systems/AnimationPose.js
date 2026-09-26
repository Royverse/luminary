/**
 * js/systems/AnimationPose.js — Procedural pose for the hero (local player and peers).
 *
 * Every frame builds a target pose from what the hero is actually doing (ground
 * speed, forward airspeed, climb rate), eases every joint toward it, then layers
 * the un-smoothed oscillations (stride, breathing) on top. One code path means
 * every transition blends on its own.
 *
 * Joint conventions are documented in CharacterRig.js.
 *
 * @ai-context
 *   READS     : s.STATES, s.currentState, s.velocity, s.input.{boost,brake},
 *               s.isJumping, s.currentYaw, s.currentPitch, s.turnBank.
 *   MUTATES   : rig.joints.* rotations, rig.anim (per-rig memory), wing uniforms,
 *               emblem glow; steps rig.cape.
 */
import * as THREE from 'three';
import { clamp, damp, lerp, smoothstep, wrapAngle } from '../core/math.js';

const CHANNELS = [
    'tilt', 'hipsY', 'hipsX', 'hipsYaw', 'hipsZ', 'chestX', 'chestYaw', 'chestZ',
    'neckX', 'headX', 'headYaw',
    'shXR', 'shZR', 'elR', 'shXL', 'shZL', 'elL',
    'hipXR', 'hipZR', 'kneeR', 'ankR', 'hipXL', 'hipZL', 'kneeL', 'ankL',
];
const zeroPose = () => Object.fromEntries(CHANNELS.map(c => [c, 0]));
const _local = new THREE.Vector3();
const _invQ = new THREE.Quaternion();

/** Write `amount` of `pose` into `out` (pose only lists the channels it cares about). */
function mix(out, pose, amount) {
    if (amount <= 0) return;
    for (const k in pose) out[k] += (pose[k] - out[k]) * amount;
}

const arms = (shX, shZ, el, shXL = shX, shZL = shZ, elL = el) =>
    ({ shXR: shX, shZR: shZ, elR: el, shXL, shZL, elL });
const legs = (hipX, knee, ank, hipXL = hipX, kneeL = knee, ankL = ank, spread = 0.04) =>
    ({ hipXR: hipX, kneeR: knee, ankR: ank, hipXL, kneeL, ankL, hipZR: spread, hipZL: spread });

// Upright poses (body joint angles, tilt 0)
const STAND  = { ...arms(0.05, 0.13, 0.18), ...legs(0.02, -0.05, 0.03, 0.02, -0.05, 0.03, 0.07) };
const HOVER  = { ...arms(0.08, 0.3, 0.42), ...legs(0.36, -0.78, -0.45, 0.06, -0.12, -0.6, 0.05) };
const RISE   = { ...arms(Math.PI - 0.2, 0.12, 0.08, -0.08, 0.12, 0.15), ...legs(0.02, -0.06, -0.75, 0.02, -0.12, -0.75, 0.02), headX: 0.25 };
const SINK   = { ...arms(0.35, 0.75, 0.35), ...legs(0.22, -0.4, -0.45, 0.06, -0.16, -0.45, 0.05), headX: -0.2 };
const JUMP_UP   = { ...arms(-0.35, 0.35, 0.5, 0.6, 0.35, 0.5), ...legs(0.9, -1.3, -0.4, 0.35, -0.6, -0.35), chestX: -0.1 };
const JUMP_DOWN = { ...arms(0.2, 0.6, 0.3), ...legs(0.28, -0.42, -0.3, 0.1, -0.22, -0.3) };

// Prone poses (tilt −π/2): arm "forward" (π) now points along the flight path
const HEAD_UP = { neckX: 0.42, headX: 0.78 };
const CRUISE = { ...arms(-0.35, 0.16, 0.2), ...legs(0, -0.25, -0.95, 0, -0.05, -0.95, 0.03), ...HEAD_UP };
const SUPER  = { ...arms(Math.PI - 0.08, 0.04, 0, -0.35, 0.12, 0.1), ...legs(0, -0.06, -1.0, 0, -0.02, -1.0, 0.02), neckX: 0.38, headX: 0.7 };
const DIVE   = { ...arms(Math.PI - 0.1, 0.1, 0), ...legs(0, 0, -1.05, 0, 0, -1.05, 0.01), neckX: 0.35, headX: 0.6 };
const BRAKE  = { ...arms(0.35, 1.35, 0.35), ...legs(0.55, -0.55, -0.2, 0.45, -0.4, -0.2, 0.06), neckX: 0.25, headX: 0.45 };

/**
 * @param {number} dt
 * @param {number} time
 * @param {object} s    movement snapshot (PlayerState, or a peer's mirror of it)
 * @param {import('../entities/CharacterRig.js').CharacterRig} rig
 */
export function updateCharacterPose(dt, time, s, rig) {
    const anim = rig.anim || (rig.anim = { pose: zeroPose(), target: zeroPose(), osc: zeroPose(), phase: 0, walkW: 0, prone: 0 });
    const T = anim.target, O = anim.osc;
    for (const c of CHANNELS) { T[c] = 0; O[c] = 0; }

    const S = s.STATES, st = s.currentState;
    const grounded = st === S.WALK;
    const boosting = !!s.input.boost;
    const braking = !!s.input.brake && !grounded;

    // Velocity in the hero's own frame: forward is −Z
    _invQ.copy(rig.player.quaternion).invert();
    const v = _local.copy(s.velocity).applyQuaternion(_invQ);
    const forward = -v.z, climb = s.velocity.y;
    const groundSpeed = Math.hypot(s.velocity.x, s.velocity.z);

    // How prone (flight-flat) the hero should be: follows real forward airspeed
    let proneTgt = grounded ? 0 : Math.max(smoothstep(forward, 4, 14), (st === S.SUPERSONIC || st === S.POWERDIVE) ? 1 : 0);
    if (braking) proneTgt *= 0.3;
    anim.prone += (proneTgt - anim.prone) * damp(4, dt);
    const prone = anim.prone;

    // ── Upright layer ─────────────────────────────────────────────────
    const moving = grounded && groundSpeed > 0.8;
    anim.walkW += ((moving ? 1 : 0) - anim.walkW) * damp(8, dt);
    const breath = Math.sin(time * 1.6);

    if (grounded) {
        mix(T, STAND, 1);
        T.chestX = 0.015 * breath;
        const run = smoothstep(groundSpeed, 14, 26);
        mix(T, { chestX: -lerp(0.08, 0.3, run), headX: lerp(0.05, 0.22, run), shZR: 0.1, shZL: 0.1, elR: lerp(0.45, 1.35, run), elL: lerp(0.45, 1.35, run) }, anim.walkW);

        if (moving) anim.phase += dt * (1.5 + groundSpeed * 0.055) * Math.PI * 2;
        const w = anim.walkW, ph = anim.phase, sn = Math.sin(ph), cs = Math.cos(ph);
        const stride = lerp(0.55, 0.85, run), knee = lerp(1.0, 1.6, run), arm = lerp(0.5, 0.95, run);
        const legCycle = (sinP, cosP) => {
            const hip = stride * sinP;
            const k = -(0.12 + knee * Math.max(0, Math.cos(Math.atan2(sinP, cosP) + 0.4)));
            const stance = smoothstep(-cosP, -0.2, 0.4);
            return [hip, k, lerp(-0.35 - 0.3 * run, -(hip + k), stance)];
        };
        const [hR, kR, aR] = legCycle(sn, cs), [hL, kL, aL] = legCycle(-sn, -cs);
        O.hipXR = hR * w; O.kneeR = kR * w; O.ankR = (aR - T.ankR) * w;
        O.hipXL = hL * w; O.kneeL = kL * w; O.ankL = (aL - T.ankL) * w;
        O.shXR = -arm * sn * w;            O.shXL = arm * sn * w;
        O.elR = 0.25 * Math.max(0, -sn) * w; O.elL = 0.25 * Math.max(0, sn) * w;
        O.hipsYaw = 0.12 * sn * w;          O.chestYaw = -0.2 * sn * w;
        O.chestZ = 0.03 * sn * w;
        O.hipsY = -0.05 * (1 + Math.cos(2 * ph)) * 0.5 * w + 0.006 * breath * (1 - w);
    } else if (s.isJumping) {
        mix(T, JUMP_DOWN, 1);
        mix(T, JUMP_UP, smoothstep(climb, -4, 4));
    } else {
        mix(T, HOVER, 1);
        mix(T, RISE, smoothstep(climb, 3, 10));
        mix(T, SINK, smoothstep(-climb, 3, 10));
        O.hipsY = 0.02 * Math.sin(time * 1.3);
        O.chestX = 0.02 * Math.sin(time * 1.3 + 0.6);
        O.shZR = O.shZL = 0.03 * Math.sin(time * 0.9);
    }

    // Head follows the camera while upright (mostly faces forward when running)
    const look = (1 - prone) * (1 - 0.7 * anim.walkW);
    T.headYaw += clamp(wrapAngle(s.currentYaw - rig.player.rotation.y), -0.75, 0.75) * 0.8 * look;
    T.headX += clamp(s.currentPitch * 0.5, -0.4, 0.35) * look;

    // ── Prone (flight) layer ──────────────────────────────────────────
    if (prone > 0.001) {
        const flight = braking ? BRAKE : st === S.POWERDIVE ? DIVE : st === S.SUPERSONIC ? SUPER : CRUISE;
        const F = { ...zeroPose(), ...flight };
        F.chestYaw = -clamp(s.turnBank || 0, -1, 1) * 0.25;
        mix(T, F, prone);
        O.shXR += 0.04 * Math.sin(time * 1.1) * prone;
        O.shXL += 0.04 * Math.cos(time * 1.0) * prone;
    }
    T.tilt = -Math.PI / 2 * prone;

    // ── Ease + apply ──────────────────────────────────────────────────
    const k = damp(grounded ? 12 : 7, dt);
    const P = anim.pose;
    for (const c of CHANNELS) P[c] += (T[c] - P[c]) * (c === 'tilt' ? 1 : k);
    const q = c => P[c] + O[c];

    const J = rig.joints;
    J.body.rotation.x = q('tilt');
    J.hips.position.y = q('hipsY');
    J.hips.rotation.set(q('hipsX'), q('hipsYaw'), q('hipsZ'));
    J.chest.rotation.set(q('chestX'), q('chestYaw'), q('chestZ'));
    J.neck.rotation.x = q('neckX');
    J.head.rotation.set(q('headX'), q('headYaw'), 0);
    J.shoulderR.rotation.set(q('shXR'), 0, q('shZR'));
    J.shoulderL.rotation.set(q('shXL'), 0, -q('shZL'));
    J.elbowR.rotation.x = q('elR');
    J.elbowL.rotation.x = q('elL');
    J.hipR.rotation.set(q('hipXR'), 0, q('hipZR'));
    J.hipL.rotation.set(q('hipXL'), 0, -q('hipZL'));
    J.kneeR.rotation.x = q('kneeR');
    J.kneeL.rotation.x = q('kneeL');
    J.ankleR.rotation.x = q('ankR');
    J.ankleL.rotation.x = q('ankL');

    // ── Glow, wings, cape ─────────────────────────────────────────────
    const wu = rig.wingUniforms;
    wu.time.value = time;
    wu.boost.value += ((boosting && !grounded ? 1 : 0) - wu.boost.value) * damp(4, dt);
    rig.emblemMat.emissiveIntensity = 1.8 + 0.35 * Math.sin(time * 2.2) + wu.boost.value * 1.5;
    rig.cape.update(dt, s.velocity);
}
