/**
 * js/systems/Physics.js — Walking, jumping, flight, and collision.
 *
 * The flight model (thrust, lift, drag, soft speed cap) is unchanged in spirit:
 * look up to climb, boost to go supersonic, brake to stop. Physics owns the
 * hero's transform and reports discrete moments through `events` instead of
 * poking audio/UI/camera directly.
 *
 * @ai-context
 *   OWNS      : rig.player position + rotation; state.currentState; velocity;
 *               grounded/jumping flags; groundHeight; buildingProximity.
 *   EVENTS    : events.boost(), events.land(strength, position), events.impact(strength).
 *   READS     : state.input, state.currentYaw/currentPitch (from InputManager), spatialGrid.
 */
import * as THREE from 'three';
import { clamp, damp, smoothstep, wrapAngle } from '../core/math.js';

const HIT_RADIUS = 1.8;     // horizontal clearance kept from building walls (m)
const WALK_SPEED = 12;

const _thrust = new THREE.Vector3();
const _fwd = new THREE.Vector3();

export class Physics {
    /**
     * @param {import('../entities/PlayerState.js').PlayerState} state
     * @param {import('../entities/CharacterRig.js').CharacterRig} rig
     * @param {{boost:Function, land:Function, impact:Function}} events
     */
    constructor(state, rig, events) {
        this.state  = state;
        this.rig    = rig;
        this.events = events;
        this._lastYaw = state.currentYaw;
    }

    update(dt) {
        const s = this.state, S = s.STATES;
        const player = this.rig.player, p = player.position, vel = s.velocity;
        const inp = s.input;
        s.simTime += dt;

        const movingH  = inp.forward !== 0 || inp.right !== 0;
        const movingV  = inp.up !== 0;
        const boosting = inp.boost;
        const grounded = s.isGrounded && !s.isJumping;

        // ── State machine ──────────────────────────────────────────────
        const prev = s.currentState;
        if (grounded && !(boosting && movingH))    s.currentState = S.WALK;
        else if (boosting && inp.up === -1)        s.currentState = S.POWERDIVE;
        else if (boosting)                         s.currentState = S.SUPERSONIC;
        else if (!movingH && !movingV && vel.length() < 3) s.currentState = S.IDLE;
        else                                       s.currentState = S.FLIGHT;

        const fast = st => st === S.SUPERSONIC || st === S.POWERDIVE;
        if (fast(s.currentState) && !fast(prev)) {
            this.events.boost();
        }
        s.boostWindup = boosting
            ? 1 - (1 - s.boostWindup) * Math.exp(-s.kBoostWindup * dt)
            : s.boostWindup * Math.exp(-s.kBoostDecay * dt);

        s.currentYaw   = wrapAngle(s.currentYaw);
        const yawRate  = wrapAngle(s.currentYaw - this._lastYaw) / Math.max(dt, 1e-4);
        this._lastYaw  = s.currentYaw;

        if (s.currentState === S.WALK) this._walk(dt);
        else this._fly(dt, movingH, movingV, boosting, yawRate);

        this._integrate(dt);
        inp.jump = false;   // a tap shorter than a frame still jumps once
    }

    _walk(dt) {
        const s = this.state, vel = s.velocity, player = this.rig.player, inp = s.input;
        const sinY = Math.sin(s.currentYaw), cosY = Math.cos(s.currentYaw);
        // Camera-relative input: forward is −Z rotated by yaw
        let mx = -sinY * inp.forward + cosY * inp.right;
        let mz = -cosY * inp.forward - sinY * inp.right;
        const mag = Math.hypot(mx, mz);

        if (mag > 0.05) {
            mx /= mag; mz /= mag;
            const k = damp(10, dt);
            vel.x += (mx * WALK_SPEED - vel.x) * k;
            vel.z += (mz * WALK_SPEED - vel.z) * k;
            // Face the direction of travel (model faces −Z)
            const heading = Math.atan2(-vel.x, -vel.z);
            player.rotation.y += wrapAngle(heading - player.rotation.y) * damp(12, dt);
        } else {
            const k = Math.exp(-15 * dt);
            vel.x *= k; vel.z *= k;
        }
        player.rotation.x += (0 - player.rotation.x) * damp(12, dt);
        player.rotation.z += (0 - player.rotation.z) * damp(12, dt);
        s.rollAngle = s.turnBank = 0;

        if (inp.up > 0 || inp.jump) {
            s.isJumping = true;
            s.isGrounded = false;
            vel.y = s.jumpForce;
        } else {
            vel.y -= s.gravity * 2 * dt;
        }
    }

    _fly(dt, movingH, movingV, boosting, yawRate) {
        const s = this.state, S = s.STATES, vel = s.velocity, player = this.rig.player, inp = s.input;

        // Body pitch only follows the camera once there is real forward speed,
        // so hovering and vertical take-offs stay upright.
        _fwd.set(0, 0, -1).applyQuaternion(player.quaternion);
        const fwdSpeed = vel.dot(_fwd);
        const flightW = (s.currentState === S.SUPERSONIC || s.currentState === S.POWERDIVE) ? 1 : smoothstep(fwdSpeed, 4, 14);

        if (!s.freeLook) {
            player.rotation.y += wrapAngle(s.currentYaw - player.rotation.y) * damp(15, dt);
            player.rotation.x += (s.currentPitch * flightW - player.rotation.x) * damp(15, dt);
        }
        s.fwdDir.set(0, 0, -1).applyQuaternion(player.quaternion);
        s.rightDir.set(1, 0, 0).applyQuaternion(player.quaternion);

        // Hover: hold altitude with a gentle bob
        if (s.currentState === S.IDLE) {
            if (s.hoverBlend === 0) s.hoverTargetY = player.position.y;
            s.hoverBlend = Math.min(1, s.hoverBlend + dt * 2.5);
            s.hoverBobPhase += dt * 1.4;
            const err = s.hoverTargetY + Math.sin(s.hoverBobPhase) * 0.3 - player.position.y;
            vel.y += (err * 8 - vel.y) * clamp(s.hoverBlend * dt * 6, 0, 1);
        } else {
            s.hoverBlend = Math.max(0, s.hoverBlend - dt * 3);
            vel.y -= s.gravity * (boosting ? 0.3 : 1) * dt;
        }

        // Lift: look up while moving forward to climb
        if (s.currentState !== S.IDLE) {
            const f = Math.max(0, vel.dot(s.fwdDir));
            vel.y += s.liftCoeff * f * Math.sin(s.currentPitch) * dt;
        }

        // Thrust
        if (movingH) {
            _thrust.set(inp.right, 0, -inp.forward).normalize().applyQuaternion(player.quaternion);
            _thrust.y *= 0.7;
            const boostFactor = 0.25 + s.boostWindup * 0.75;
            vel.addScaledVector(_thrust, (boosting ? s.boostForce * boostFactor : s.accelForce) * dt);
        }
        if (movingV) vel.y += inp.up * s.accelForce * 1.1 * dt;

        // Drag: forward, lateral and vertical components decay separately
        let kF = s.kDragFwdNormal, kL = s.kDragLateral, kV = s.kDragVertWorld;
        if (boosting)      { kF = s.kDragFwdBoost; kL = kF * 0.9; kV = kF * 0.6; }
        if (inp.brake)     { kF = s.kDragFwdBrake; kL = kF;       kV = kF * 0.5; }
        const along = vel.dot(s.fwdDir);
        const rx = vel.x - s.fwdDir.x * along, ry = vel.y - s.fwdDir.y * along, rz = vel.z - s.fwdDir.z * along;
        const eF = Math.exp(-kF * dt), eL = Math.exp(-kL * dt), eV = Math.exp(-kV * dt);
        vel.set(s.fwdDir.x * along * eF + rx * eL, s.fwdDir.y * along * eF + ry * eV, s.fwdDir.z * along * eF + rz * eL);

        // Soft speed cap: overspeed bleeds off instead of snapping
        const cap = boosting ? (inp.up === -1 ? s.diveSpeedCap : s.boostSpeedCap) : s.normalSpeedCap * 1.5;
        const len = vel.length();
        if (len > cap) vel.multiplyScalar((len + (cap - len) * damp(s.kSpeedCapSoft, dt)) / len);

        // Bank into turns and strafes (scaled by how much we're really flying)
        const bank = clamp(-yawRate * 0.3, -1.1, 1.1) - inp.right * (Math.PI / 5);
        s.turnBank  += (bank * flightW - s.turnBank) * damp(8, dt);
        s.rollAngle += (s.turnBank - s.rollAngle) * damp(7, dt);
        player.rotation.z = s.rollAngle;
    }

    /** Move in sub-steps so fast flight can't tunnel through thin towers. */
    _integrate(dt) {
        const s = this.state, p = this.rig.player.position, vel = s.velocity;
        const steps = Math.min(8, Math.max(1, Math.ceil(vel.length() * dt / 3)));
        const h = dt / steps;
        let impact = 0, landed = 0;
        let floor = 0, nearest = Infinity;
        const wasGrounded = s.isGrounded;

        for (let i = 0; i < steps; i++) {
            p.addScaledVector(vel, h);
            floor = 0;
            const bx = Math.floor(p.x / s.bucketSize), bz = Math.floor(p.z / s.bucketSize);
            for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
                const bucket = s.spatialGrid.get(`${bx + ox},${bz + oz}`);
                if (!bucket) continue;
                for (const b of bucket) {
                    const insideX = p.x > b.minX && p.x < b.maxX, insideZ = p.z > b.minZ && p.z < b.maxZ;
                    if (insideX && insideZ && p.y >= b.maxY - 0.6) floor = Math.max(floor, b.maxY);
                    if (i === steps - 1 && p.y < b.maxY + 60) {
                        const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX), dz = Math.max(b.minZ - p.z, 0, p.z - b.maxZ);
                        nearest = Math.min(nearest, Math.hypot(dx, dz));
                    }
                    if (p.x > b.minX - HIT_RADIUS && p.x < b.maxX + HIT_RADIUS &&
                        p.z > b.minZ - HIT_RADIUS && p.z < b.maxZ + HIT_RADIUS && p.y < b.maxY) {
                        const x1 = b.maxX + HIT_RADIUS - p.x, x2 = p.x - (b.minX - HIT_RADIUS);
                        const z1 = b.maxZ + HIT_RADIUS - p.z, z2 = p.z - (b.minZ - HIT_RADIUS);
                        const y1 = b.maxY - p.y;
                        const m = Math.min(x1, x2, z1, z2, y1);
                        if (m === y1) { p.y = b.maxY; floor = Math.max(floor, b.maxY); continue; }
                        // Push out of the wall; only the velocity going INTO it bounces,
                        // so grazing a wall slides instead of stopping dead.
                        const axis = m === x1 || m === x2 ? 'x' : 'z';
                        const dir = m === x1 || m === z1 ? 1 : -1;
                        p[axis] += dir * m;
                        if (vel[axis] * dir < 0) {
                            impact = Math.max(impact, Math.abs(vel[axis]) / 150);
                            vel[axis] = -vel[axis] * 0.25;
                        }
                    }
                }
            }
            if (p.y <= floor) {
                if (!wasGrounded && vel.y < 0) landed = Math.max(landed, -vel.y / 80);
                p.y = floor;
                vel.y = Math.max(0, vel.y);
            }
        }

        s.groundHeight = floor;
        s.altitude = p.y;
        s.isGrounded = p.y <= floor + 0.01 && vel.y <= 0.01;
        if (s.isGrounded) s.isJumping = false;
        s.buildingProximity = nearest < 90 && vel.length() > 8 ? (1 - nearest / 90) : 0;

        if (landed > 0.08) this.events.land(landed, p);
        if (impact > 0.1) this.events.impact(impact);
    }
}
