/**
 * js/systems/Physics.js
 *
 * All flight / walk physics, drag, stall, hover, lift,
 * ground collision, and building AABB collision.
 *
 * @ai-context
 *   OWNS      : player position integration; state machine transitions;
 *               building + ground collision resolution; stall spin;
 *               hover bob; drag / thrust / lift calculations.
 *   READS     : state.input, state.mouse, state.velocity, state.spatialGrid.
 *   WRITES    : state.velocity, state.currentState, state.isStalling,
 *               state.rollAngle, state.turnBank, state.boostWindup,
 *               state.boostPunch, state.isJumping, state.wasGrounded.
 *   CALLS     : animation.spawnShockwave(), animation.triggerLandingDust();
 *               audio.playImpactSound(), audio.playSonicBoom(), audio.updateRumble();
 *               ui.flashImpact(), ui.triggerBoomFlash().
 *   RELATED   : PlayerState.js (constants + state fields), AnimationPose.js
 *               (kinematics react to state changes), CityGenerator.js (AABB data).
 *   ASK FOR   : PlayerState.js before changing any physics constant or state field.
 *
 * Reads:  state.input, state.mouse, state.velocity, state.player.position
 * Writes: state.velocity, state.currentState, state.isStalling, …
 */

import * as THREE from 'three';
import { clamp, expDecay, wrapAngle } from '../main.js';

export class Physics {
    /**
     * @param {import('../entities/PlayerState.js').PlayerState}  state
     * @param {import('./AudioManager.js').AudioManager}          audio
     * @param {import('../ui/UIManager.js').UIManager}            ui
     * @param {import('./Animation.js').Animation}                animation
     * @param {import('../entities/CharacterRig.js').CharacterRig} rig
     */
    constructor(state, audio, ui, animation, rig) {
        this.state     = state;
        this.audio     = audio;
        this.ui        = ui;
        this.animation = animation;
        this.rig       = rig;
    }

    update(dt) {
        const s   = this.state;
        const p   = this.rig.player.position;
        const vel = s.velocity;
        s.simTime += dt;

        const isMovingH  = s.input.forward !== 0 || s.input.right !== 0;
        const isMovingV  = s.input.up !== 0;
        const isMoving   = isMovingH || isMovingV;
        const isBoosting = s.input.boost && !s.isStalling;
        const isBraking  = s.input.brake;
        const spd        = vel.length();

        // ── State machine ──────────────────────────────────────────────
        if      (p.y <= 0.05 && !isBoosting && !s.isJumping) s.currentState = s.STATES.WALK;
        else if (isBoosting && s.input.up === -1)             s.currentState = s.STATES.POWERDIVE;
        else if (s.isStalling)                                 s.currentState = s.STATES.STALL;
        else if (isBoosting)                                   s.currentState = s.STATES.SUPERSONIC;
        else if (!isMoving && spd < 3 && p.y > 0.05)         s.currentState = s.STATES.IDLE;
        else                                                   s.currentState = s.STATES.FLIGHT;

        // ── Boost windup ───────────────────────────────────────────────
        if (isBoosting) {
            s.boostWindup = 1 - (1 - s.boostWindup) * Math.exp(-s.kBoostWindup * dt);
        } else {
            s.boostWindup = s.boostWindup * Math.exp(-s.kBoostDecay * dt);
        }
        const boostFactor = 0.25 + s.boostWindup * 0.75;

        // ── Boost activation edge ──────────────────────────────────────
        if (isBoosting && !s.lastBoostState) {
            this.animation.spawnShockwave();
            this.audio.playSonicBoom();
            s.boostPunch = 1.0;
            this.ui.triggerBoomFlash();
        }
        s.lastBoostState = isBoosting;

        // ── WALK branch ────────────────────────────────────────────────
        if (s.currentState === s.STATES.WALK) {
            s.isSprinting = !!s.input.boost;
            const speed   = s.isSprinting ? 28 : 12;

            s.mouse.x    = wrapAngle(s.mouse.x || 0);
            s.currentYaw = s.mouse.x;
            s.currentPitch = s.mouse.y;

            this.rig.player.rotation.order = 'YXZ';

            const camEuler = new THREE.Euler(0, s.currentYaw, 0, 'YXZ');
            const fwd = new THREE.Vector3(0, 0, -1).applyEuler(camEuler);
            const rgt = new THREE.Vector3(1, 0, 0).applyEuler(camEuler);

            let mx = 0, mz = 0;
            if (s.input.forward) { mx += fwd.x * s.input.forward; mz += fwd.z * s.input.forward; }
            if (s.input.right)   { mx += rgt.x * s.input.right;   mz += rgt.z * s.input.right;   }

            const mag = Math.sqrt(mx*mx + mz*mz);
            if (mag > 0.05) {
                mx /= mag; mz /= mag;
                vel.x += (mx * speed - vel.x) * expDecay(10, dt);
                vel.z += (mz * speed - vel.z) * expDecay(10, dt);
                const targetAngle = Math.atan2(vel.x, vel.z);
                const diff = wrapAngle(targetAngle - this.rig.player.rotation.y);
                this.rig.player.rotation.y += diff * 12 * dt;
            } else {
                vel.x *= Math.exp(-15 * dt);
                vel.z *= Math.exp(-15 * dt);
            }

            this.rig.player.rotation.x = 0;
            this.rig.player.rotation.z = 0;
            s.rollAngle = 0;
            s.turnBank  = 0;

            if (s.input.up > 0 && !s.isJumping) {
                s.isJumping    = true;
                s.currentState = s.STATES.FLIGHT;
                vel.y = 12.5;
                p.y  += 0.1;
            } else {
                vel.y -= s.gravity * 2 * dt;
            }

        } else {
            // ── FLIGHT branch ──────────────────────────────────────────
            s.mouse.x    = wrapAngle(s.mouse.x || 0);
            s.currentYaw = s.mouse.x;
            s.currentPitch = s.mouse.y;

            this.rig.player.rotation.order = 'YXZ';
            const diffYaw = wrapAngle(s.currentYaw - this.rig.player.rotation.y);
            this.rig.player.rotation.y += diffYaw * expDecay(15, dt);
            this.rig.player.rotation.x += (s.currentPitch - this.rig.player.rotation.x) * expDecay(15, dt);
            s.mouse.dx = (s.mouse.dx || 0) + (0 - (s.mouse.dx || 0)) * expDecay(10, dt);

            s.fwdDir.set(0,0,-1).applyQuaternion(this.rig.player.quaternion);
            s.rightDir.set(1,0,0).applyQuaternion(this.rig.player.quaternion);
            s.upDir.set(0,1,0).applyQuaternion(this.rig.player.quaternion);

            // ── Stall ──────────────────────────────────────────────────
            if (!s.isStalling) {
                if (s.currentPitch > 0.9 && spd < 20 && !isBoosting && p.y > 30) {
                    s.isStalling   = true;
                    s.stallProgress = 0;
                    s.stallSpinRate = (Math.random()-0.5 < 0 ? -1 : 1) * (2 + Math.random()*2);
                }
            } else {
                s.stallProgress = Math.min(1, s.stallProgress + dt/0.8);
                s.mouse.y += (-0.3 - s.mouse.y) * expDecay(2, dt) * s.stallProgress;
                const spinTarget = s.STALL_SPIN_TARGET * Math.sign(s.stallSpinRate);
                s.stallSpinRate += (spinTarget - s.stallSpinRate) * expDecay(2.5, dt);
                s.mouse.x += s.stallSpinRate * dt;
                if (s.stallProgress > 0.9 || vel.y < -55) { s.isStalling = false; s.stallSpinRate = 0; }
            }

            // ── Hover ──────────────────────────────────────────────────
            if (s.currentState === s.STATES.IDLE) {
                if (s.hoverBlend === 0) s.hoverTargetY = p.y;
                s.hoverBlend = Math.min(1, s.hoverBlend + dt*2.5);
                s.hoverBobPhase += dt*1.4;
                const bobTarget  = s.hoverTargetY + Math.sin(s.hoverBobPhase)*1.8;
                const err        = bobTarget - p.y;
                const hoverAlpha = clamp(s.hoverBlend*dt*6, 0, 1);
                vel.y = (vel.y) + (err*8 - vel.y) * hoverAlpha;
            } else {
                s.hoverBlend = Math.max(0, s.hoverBlend - dt*3);
                const gravScale = isBoosting ? 0.3 : (s.isStalling ? 1.4 : 1.0);
                vel.y -= s.gravity * gravScale * dt;
            }

            // ── Lift ───────────────────────────────────────────────────
            if (!s.isStalling && s.currentState !== s.STATES.IDLE) {
                const fwdSpd = Math.max(0, vel.dot(s.fwdDir));
                if (fwdSpd > 0) vel.y += s.liftCoeff * fwdSpd * Math.sin(s.currentPitch) * dt;
            }

            // ── Thrust ────────────────────────────────────────────────
            if (!s.isStalling && isMoving) {
                if (isMovingH) {
                    const thrust = new THREE.Vector3(s.input.right, 0, -s.input.forward);
                    thrust.normalize().applyQuaternion(this.rig.player.quaternion);
                    thrust.y *= 0.7;
                    const force = isBoosting ? s.boostForce * boostFactor : s.accelForce;
                    vel.addScaledVector(thrust, force * dt);
                }
                if (isMovingV) vel.y += s.input.up * s.accelForce * 1.1 * dt;
            }

            // ── Drag ──────────────────────────────────────────────────
            let kF = s.kDragFwdNormal, kL = s.kDragLateral, kV = s.kDragVertWorld;
            if (isBoosting) { kF = s.kDragFwdBoost;  kL = s.kDragFwdBoost*0.9;  kV = s.kDragFwdBoost*0.6; }
            if (isBraking)  { kF = s.kDragFwdBrake;  kL = s.kDragFwdBrake;      kV = s.kDragFwdBrake*0.5; }

            const fwdSpd = vel.dot(s.fwdDir);
            const fwdVec = s.fwdDir.clone().multiplyScalar(fwdSpd);
            const rem    = vel.clone().sub(fwdVec);
            vel.copy(fwdVec).multiplyScalar(Math.exp(-kF * dt));
            vel.x += rem.x * Math.exp(-kL * dt);
            vel.z += rem.z * Math.exp(-kL * dt);
            vel.y += rem.y * Math.exp(-kV * dt);

            // ── Speed cap ─────────────────────────────────────────────
            const cap = isBoosting
                ? (s.input.up === -1 ? s.diveSpeedCap : s.boostSpeedCap)
                : s.normalSpeedCap * 1.5;
            if (vel.length() > cap) vel.multiplyScalar(cap / vel.length());

            // ── Roll / bank ───────────────────────────────────────────
            const yawDelta = wrapAngle(s.currentYaw - (s._lastYaw ?? s.currentYaw));
            s._lastYaw = s.currentYaw;
            const bankFromTurn   = -yawDelta * 18;
            const bankFromStrafe = -s.input.right * (Math.PI / 5);
            s.turnBank  += (bankFromTurn + bankFromStrafe - s.turnBank) * expDecay(8, dt);
            s.rollAngle += (s.turnBank - s.rollAngle) * expDecay(7, dt);
            this.rig.player.rotation.z = s.rollAngle;
        }

        // ── Integrate position ─────────────────────────────────────────
        p.addScaledVector(vel, dt);

        // ── Ground collision ───────────────────────────────────────────
        const GROUND_Y = 0;
        if (p.y <= GROUND_Y) {
            const impact = Math.abs(vel.y) / 80;
            if (!s.wasGrounded && impact > 0.08) {
                this.animation.triggerLandingDust(p.clone(), impact);
                this.audio.playImpactSound(impact);
                this.ui.flashImpact(impact * 0.3);
            }
            p.y   = GROUND_Y;
            vel.y = Math.max(0, vel.y);
            s.wasGrounded = true;
            s.isJumping   = false;
        } else {
            s.wasGrounded = false;
        }

        // ── Building collision ─────────────────────────────────────────
        const spdAtHit = vel.length();
        let minBuildDist = 1000;
        const bx = Math.floor(p.x / s.bucketSize);
        const bz = Math.floor(p.z / s.bucketSize);
        const hr = 2.2;

        for (let ox = -2; ox <= 2; ox++) {
            for (let oz = -2; oz <= 2; oz++) {
                const bucket = s.spatialGrid.get(`${bx+ox},${bz+oz}`);
                if (!bucket) continue;
                for (const b of bucket) {
                    const d = Math.hypot(p.x-b.cx, p.z-b.cz);
                    if (d < minBuildDist && p.y < b.maxY+80) minBuildDist = d;

                    if (p.x>b.minX-hr && p.x<b.maxX+hr && p.z>b.minZ-hr && p.z<b.maxZ+hr && p.y<b.maxY+hr) {
                        const ov = {
                            x1: b.maxX+hr-p.x, x2: p.x-(b.minX-hr),
                            z1: b.maxZ+hr-p.z, z2: p.z-(b.minZ-hr),
                            y:  b.maxY+hr-p.y,
                        };
                        const minO = Math.min(ov.x1,ov.x2,ov.z1,ov.z2,ov.y);
                        const impact = spdAtHit / 200;
                        if (impact > 0.1) { this.ui.flashImpact(impact*0.4); this.audio.playImpactSound(impact*0.6); }

                        if      (minO===ov.x1) { p.x+=ov.x1; vel.x*=-.25; vel.y*=.8; vel.z*=.8; }
                        else if (minO===ov.x2) { p.x-=ov.x2; vel.x*=-.25; vel.y*=.8; vel.z*=.8; }
                        else if (minO===ov.z1) { p.z+=ov.z1; vel.z*=-.25; vel.y*=.8; vel.x*=.8; }
                        else if (minO===ov.z2) { p.z-=ov.z2; vel.z*=-.25; vel.y*=.8; vel.x*=.8; }
                        else                   { p.y+=ov.y;  vel.y=Math.max(0,vel.y); s.isJumping=false; }
                    }
                }
            }
        }

        // ── Proximity rumble ───────────────────────────────────────────
        const rumbleTgt = (minBuildDist < 90 && spdAtHit > 8)
            ? (1 - minBuildDist/90) * 0.85 : 0;
        this.audio.updateRumble(rumbleTgt, dt);
    }
}
