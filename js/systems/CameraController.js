/**
 * js/systems/CameraController.js — Third-person spring-arm camera.
 *
 * Follows common third-person practice (Unreal SpringArm, Cinemachine, and
 * Squirrel Eiserloh's "Juicing Your Cameras With Math", GDC 2016):
 *   • Rotation comes straight from the mouse, only lightly smoothed.
 *   • Position tracks the hero's hips with a small lag that is capped in metres,
 *     so a boost surges the hero ahead but can never leave him behind.
 *   • The arm snaps in when a building or the ground is in the way, then eases out.
 *   • Shake = trauma² × smooth noise, rotation only, fed by events (impacts,
 *     landings, boost) — never continuous random jitter.
 *   • FOV stays in a comfortable 70–93° band.
 *
 * @ai-context
 *   OWNS      : camera transform + FOV; speed-line streaks (child of camera).
 *   API       : update(dt, time), addTrauma(0..1), kick() (boost FOV punch), snap().
 *   READS     : state.currentYaw/currentPitch/rollAngle, velocity, currentState,
 *               input.brake, spatialGrid (arm collision).
 */
import * as THREE from 'three';
import { clamp, damp, lerp, noise1, smoothstep, wrapAngle } from '../core/math.js';

const _target = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _dir    = new THREE.Vector3();
const _euler  = new THREE.Euler(0, 0, 0, 'YXZ');
const _viewQ  = new THREE.Quaternion();

const STREAKS = 80;

/** Slab test: distance at which the ray enters the box, or Infinity. No allocations. */
const _span = { lo: 0, hi: 0 };
function clipAxis(org, dir, lo, hi) {
    if (Math.abs(dir) < 1e-8) {
        if (org < lo || org > hi) _span.lo = Infinity;
        return;
    }
    let a = (lo - org) / dir, b = (hi - org) / dir;
    if (a > b) { const tmp = a; a = b; b = tmp; }
    if (a > _span.lo) _span.lo = a;
    if (b < _span.hi) _span.hi = b;
}
function rayBox(o, d, x0, x1, y0, y1, z0, z1, tMax) {
    _span.lo = 0; _span.hi = tMax;
    clipAxis(o.x, d.x, x0, x1);
    clipAxis(o.y, d.y, y0, y1);
    clipAxis(o.z, d.z, z0, z1);
    return _span.lo <= _span.hi ? _span.lo : Infinity;
}

export class CameraController {
    constructor(scene, camera, state, rig) {
        this.camera = camera;
        this.state  = state;
        this.rig    = rig;
        scene.add(camera);

        this.pivot = new THREE.Vector3();
        this.yaw = state.currentYaw;
        this.pitch = state.currentPitch;
        this.roll = 0;
        this.arm = null;
        this.trauma = 0;
        this.fovKick = 0;
        this.flightBlend = 0;
        this.fov = camera.fov;

        this._buildSpeedLines();
        this.snap();
    }

    /** Add screen shake. Small hits ≈ 0.2, big crashes ≈ 0.8. */
    addTrauma(amount) { this.trauma = Math.min(1, this.trauma + amount); }

    /** Brief FOV punch when the boost kicks in. */
    kick() { this.fovKick = 1; }

    /** Jump straight to the hero (spawn, teleport). */
    snap() {
        this.rig.centerWorld(this.pivot);
        this.arm = null;
    }

    update(dt, time) {
        const s = this.state, S = s.STATES;
        const speed  = s.velocity.length();
        const speedN = clamp(speed / s.boostSpeedCap, 0, 1);
        const flying = s.currentState !== S.WALK;
        this.flightBlend += ((flying ? 1 : 0) - this.flightBlend) * damp(2.5, dt);
        const fb = this.flightBlend;

        // Orientation: direct from input, lightly smoothed; only a hint of the bank
        this.yaw   += wrapAngle(s.currentYaw - this.yaw) * damp(22, dt);
        this.pitch += (s.currentPitch - this.pitch) * damp(22, dt);
        this.roll  += (s.rollAngle * 0.3 - this.roll) * damp(6, dt);

        // Pivot: hips, with lag capped in metres
        this.rig.centerWorld(_target);
        this.pivot.lerp(_target, damp(12, dt));
        _offset.subVectors(this.pivot, _target);
        const maxLag = lerp(0.35, 1.5, speedN);
        if (_offset.lengthSq() > maxLag * maxLag) this.pivot.copy(_target).add(_offset.setLength(maxLag));

        // Arm: behind and above, pulled back a little with speed
        _viewQ.setFromEuler(_euler.set(this.pitch, this.yaw, this.roll));
        _offset.set(0, lerp(1.7, 2.3, fb), lerp(7.5, 7.5 + 2 * speedN, fb)).applyQuaternion(_viewQ);
        const want = _offset.length();
        _dir.copy(_offset).divideScalar(want);
        const free = this._castArm(this.pivot, _dir, want);
        if (this.arm === null || free < this.arm) this.arm = free;
        else this.arm += (free - this.arm) * damp(2.5, dt);
        this.camera.position.copy(this.pivot).addScaledVector(_dir, this.arm);

        // Shake: trauma² × smooth noise, rotational only
        this.trauma = Math.max(0, this.trauma - dt * 1.4);
        const shake = this.trauma * this.trauma, t = time * 16;
        this.camera.quaternion.setFromEuler(_euler.set(
            this.pitch + 0.03 * shake * noise1(t + 11.3),
            this.yaw   + 0.03 * shake * noise1(t + 47.9),
            this.roll  + 0.045 * shake * noise1(t + 83.1),
        ));

        // FOV: gentle speed widening, small boost punch
        this.fovKick = Math.max(0, this.fovKick - dt * 1.6);
        let fov = lerp(70, 72 + 9 * speedN, fb) + 6 * this.fovKick * this.fovKick;
        if (s.currentState === S.POWERDIVE) fov += 6;
        if (s.input.brake && flying) fov -= 4;
        this.fov += (fov - this.fov) * damp(4, dt);
        if (Math.abs(this.camera.fov - this.fov) > 0.01) {
            this.camera.fov = this.fov;
            this.camera.updateProjectionMatrix();
        }

        this._updateSpeedLines(dt, speed, speedN);
    }

    /** Distance the arm can extend along `dir` before hitting ground or a building. */
    _castArm(o, dir, maxLen) {
        const R = 0.6, s = this.state;
        let t = maxLen;
        if (dir.y < 0) t = Math.min(t, Math.max(0, (o.y - 0.8) / -dir.y));

        const bx = Math.floor(o.x / s.bucketSize), bz = Math.floor(o.z / s.bucketSize);
        for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
            const bucket = s.spatialGrid.get(`${bx + ox},${bz + oz}`);
            if (!bucket) continue;
            for (const b of bucket) {
                const x0 = b.minX - R, x1 = b.maxX + R, z0 = b.minZ - R, z1 = b.maxZ + R, y1 = b.maxY + R;
                if (o.x > x0 && o.x < x1 && o.z > z0 && o.z < z1 && o.y < y1) continue;
                t = Math.min(t, rayBox(o, dir, x0, x1, -1, y1, z0, z1, t));
            }
        }
        return Math.max(1.2, t - 0.2);
    }

    // ── Speed streaks: thin lines in camera space that rush past at high speed ──
    _buildSpeedLines() {
        this._streaks = new Float32Array(STREAKS * 3);
        for (let i = 0; i < STREAKS; i++) {
            const a = Math.random() * Math.PI * 2, r = 2.5 + Math.random() * 12;
            this._streaks.set([Math.cos(a) * r, Math.sin(a) * r * 0.7, -5 - Math.random() * 110], i * 3);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(STREAKS * 6), 3));
        const col = new Float32Array(STREAKS * 6);
        for (let i = 0; i < STREAKS; i++) col.set([0.75, 0.92, 1, 0, 0, 0], i * 6);
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
            vertexColors: true, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        this.lines.frustumCulled = false;
        this.lines.visible = false;
        this.camera.add(this.lines);
    }

    _updateSpeedLines(dt, speed, speedN) {
        const mat = this.lines.material;
        const target = this.state.input.brake ? 0 : smoothstep(speedN, 0.45, 0.95) * 0.5;
        mat.opacity += (target - mat.opacity) * damp(5, dt);
        this.lines.visible = mat.opacity > 0.01;
        if (!this.lines.visible) return;

        const pos = this.lines.geometry.attributes.position.array, S = this._streaks;
        const len = clamp(speed * 0.045, 1, 9);
        for (let i = 0; i < STREAKS; i++) {
            let z = S[i * 3 + 2] + speed * dt;
            if (z > -2) z -= 110;
            S[i * 3 + 2] = z;
            const x = S[i * 3], y = S[i * 3 + 1], j = i * 6;
            pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
            pos[j + 3] = x; pos[j + 4] = y; pos[j + 5] = z - len;
        }
        this.lines.geometry.attributes.position.needsUpdate = true;
    }
}
