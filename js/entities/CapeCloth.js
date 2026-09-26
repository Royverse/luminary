/**
 * js/entities/CapeCloth.js — Verlet cloth cape, simulated in the hero's local frame.
 *
 * Working in the hero's frame keeps the cape stable at any flight speed:
 * world velocity becomes wind, acceleration becomes an inertial kick, and the
 * pinned top edge never has to chase the hero across hundreds of metres per frame.
 * Fixed 90 Hz sub-steps make it frame-rate independent.
 *
 * @ai-context
 *   OWNED BY  : CharacterRig (rig.cape). Mesh is a child of rig.player.
 *   API       : update(dt, velocityWorld), mesh.
 *   TUNING    : COLS/ROWS resolution, TOP_W/BOTTOM_W/LENGTH shape, COLLIDERS body shape.
 */
import * as THREE from 'three';

const COLS = 12, ROWS = 15;
const TOP_W = 0.36, BOTTOM_W = 0.98, LENGTH = 1.18;   // model metres
const STEP = 1 / 90, MAX_STEPS = 4, ITERATIONS = 6, DAMPING = 0.985;

// [bone, x, y, z, radius] — spheres that keep the cape off the back and legs
const COLLIDERS = [
    ['chest', 0, 0.30, 0.035, 0.115], ['chest', 0.1, 0.29, 0.02, 0.105], ['chest', -0.1, 0.29, 0.02, 0.105],
    ['chest', 0, 0.14, 0.03, 0.105],
    ['hips', 0, 0, 0.03, 0.125], ['hips', 0.08, -0.06, 0.03, 0.1], ['hips', -0.08, -0.06, 0.03, 0.1],
    ['hipR', 0, -0.12, 0.01, 0.088], ['hipL', 0, -0.12, 0.01, 0.088],
    ['hipR', 0, -0.3, 0.005, 0.072], ['hipL', 0, -0.3, 0.005, 0.072],
    ['kneeR', 0, -0.1, 0, 0.064], ['kneeL', 0, -0.1, 0, 0.064],
    ['kneeR', 0, -0.28, 0, 0.055], ['kneeL', 0, -0.28, 0, 0.055],
    ['head', 0, 0.12, 0.01, 0.115],
    ['shoulderR', 0, 0, 0, 0.06], ['shoulderL', 0, 0, 0, 0.06],
];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _g = new THREE.Vector3();
const _air = new THREE.Vector3();
const _dv = new THREE.Vector3();
const _inertial = new THREE.Vector3();

export class CapeCloth {
    constructor(rig, color, withRim) {
        this.rig = rig;
        this.scale = rig.player.scale.x;   // world metres per model metre
        const count = (COLS + 1) * (ROWS + 1);
        this.pos  = new Float32Array(count * 3);
        this.prev = new Float32Array(count * 3);

        // Top edge follows an arc across the upper back (chest space)
        this.anchorsChest = [];
        for (let c = 0; c <= COLS; c++) {
            const u = (c / COLS) * 2 - 1;
            this.anchorsChest.push(new THREE.Vector3(TOP_W / 2 * u, 0.405 - 0.035 * u * u, 0.06 + 0.028 * (1 - u * u)));
        }
        this.anchors     = this.anchorsChest.map(() => new THREE.Vector3());
        this.anchorsPrev = this.anchorsChest.map(() => new THREE.Vector3());

        const cons = [];
        const idx = (c, r) => r * (COLS + 1) + c;
        const rowW = r => (TOP_W + (BOTTOM_W - TOP_W) * (r / ROWS)) / COLS;
        const h = LENGTH / ROWS;
        for (let r = 0; r <= ROWS; r++) {
            for (let c = 0; c <= COLS; c++) {
                if (c < COLS && r > 0) cons.push(idx(c, r), idx(c + 1, r), rowW(r));
                if (r < ROWS) cons.push(idx(c, r), idx(c, r + 1), h);
                if (c < COLS && r < ROWS) {
                    const d = Math.hypot((rowW(r) + rowW(r + 1)) / 2, h);
                    cons.push(idx(c, r), idx(c + 1, r + 1), d, idx(c + 1, r), idx(c, r + 1), d);
                }
            }
        }
        this.constraints = new Float32Array(cons);

        this.colliders = COLLIDERS.map(([bone, x, y, z, r]) => ({
            bone: rig.joints[bone], offset: new THREE.Vector3(x, y, z), r, c: new THREE.Vector3(),
        }));

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
        const uv = [], index = [];
        for (let r = 0; r <= ROWS; r++) for (let c = 0; c <= COLS; c++) uv.push(c / COLS, 1 - r / ROWS);
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
            const i = idx(c, r);
            index.push(i, i + COLS + 1, i + 1, i + 1, i + COLS + 1, i + COLS + 2);
        }
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(index);

        const mat = withRim(new THREE.MeshStandardMaterial({
            color, roughness: 0.62, metalness: 0.05, side: THREE.DoubleSide,
        }), 0xff5a6e, 2.4, 0.35);
        this.mesh = new THREE.Mesh(geo, mat);
        this.mesh.frustumCulled = false;
        rig.player.add(this.mesh);

        this._accel = new THREE.Vector3();
        this._lastVel = new THREE.Vector3();
        this._hasLastVel = false;
        this._time = 0;
        this._acc = 0;
        this._needsReset = true;
    }

    /** Anchors + colliders in the player's local frame (model units). */
    _sampleBody() {
        const player = this.rig.player;
        player.updateMatrixWorld(true);
        const inv = _m.copy(player.matrixWorld).invert();
        const chest = this.rig.joints.chest.matrixWorld;
        for (let i = 0; i < this.anchors.length; i++) {
            this.anchorsPrev[i].copy(this.anchors[i]);
            this.anchors[i].copy(this.anchorsChest[i]).applyMatrix4(chest).applyMatrix4(inv);
        }
        for (const col of this.colliders) col.c.copy(col.offset).applyMatrix4(col.bone.matrixWorld).applyMatrix4(inv);
    }

    _hangStraight() {
        const h = LENGTH / ROWS;
        for (let r = 0; r <= ROWS; r++) {
            for (let c = 0; c <= COLS; c++) {
                const a = this.anchors[c], i = (r * (COLS + 1) + c) * 3;
                const spread = 1 + ((BOTTOM_W / TOP_W) - 1) * (r / ROWS);
                this.pos[i]     = this.prev[i]     = a.x * spread;
                this.pos[i + 1] = this.prev[i + 1] = a.y - r * h;
                this.pos[i + 2] = this.prev[i + 2] = a.z + 0.02 * r;
            }
        }
    }

    /**
     * @param {number} dt
     * @param {THREE.Vector3} velocity  hero velocity in world space (m/s)
     */
    update(dt, velocity) {
        if (!this.mesh.visible) { this._needsReset = true; return; }
        this._sampleBody();
        if (this._needsReset) {
            this.anchorsPrev.forEach((p, i) => p.copy(this.anchors[i]));
            this._hangStraight();
            this._hasLastVel = false;
            this._accel.set(0, 0, 0);
            this._needsReset = false;
        }

        // External accelerations, expressed in the player's frame (model units)
        const invQ = _q.copy(this.rig.player.quaternion).invert();
        const g = _g.set(0, -9.8 / this.scale, 0).applyQuaternion(invQ);
        const speed = velocity.length();
        const air = _air.set(0, 0, 0);
        if (speed > 0.01) air.copy(velocity).applyQuaternion(invQ).multiplyScalar(-Math.min(60, speed * 0.24) / speed);
        if (this._hasLastVel && dt > 0) this._accel.lerp(_dv.subVectors(velocity, this._lastVel).divideScalar(dt), 0.3);
        this._lastVel.copy(velocity);
        this._hasLastVel = true;
        const inertial = _inertial.copy(this._accel).applyQuaternion(invQ).multiplyScalar(-0.35 / this.scale).clampLength(0, 20);
        const flutter = Math.min(22, speed * 0.09);
        const ax = g.x + air.x + inertial.x, ay = g.y + air.y + inertial.y, az = g.z + air.z + inertial.z;

        this._acc = Math.min(this._acc + dt, STEP * MAX_STEPS);
        const steps = Math.floor(this._acc / STEP);
        this._acc -= steps * STEP;

        const P = this.pos, Q = this.prev, C = this.constraints, h2 = STEP * STEP;
        const firstFree = COLS + 1, n = P.length / 3;
        for (let s = 0; s < steps; s++) {
            this._time += STEP;
            const t = this._time;
            const k = (s + 1) / steps;
            for (let c = 0; c <= COLS; c++) {
                const a = this.anchors[c], b = this.anchorsPrev[c], i = c * 3;
                P[i] = Q[i] = b.x + (a.x - b.x) * k;
                P[i + 1] = Q[i + 1] = b.y + (a.y - b.y) * k;
                P[i + 2] = Q[i + 2] = b.z + (a.z - b.z) * k;
            }
            for (let p = firstFree; p < n; p++) {
                const i = p * 3, row = Math.floor(p / (COLS + 1)) / ROWS, col = p % (COLS + 1);
                const f = flutter * row;
                const fx = Math.sin(t * 13.0 + col * 0.8 + row * 5.0) * f * 0.5;
                const fy = Math.cos(t * 17.0 + col * 1.3 + row * 3.0) * f;
                for (let d = 0; d < 3; d++) {
                    const cur = P[i + d];
                    const vel = (cur - Q[i + d]) * DAMPING;
                    Q[i + d] = cur;
                    P[i + d] = cur + vel + (d === 0 ? ax + fx : d === 1 ? ay + fy : az) * h2;
                }
            }
            for (let it = 0; it < ITERATIONS; it++) {
                for (let c = 0; c < C.length; c += 3) {
                    const i1 = C[c] * 3, i2 = C[c + 1] * 3, rest = C[c + 2];
                    const dx = P[i2] - P[i1], dy = P[i2 + 1] - P[i1 + 1], dz = P[i2 + 2] - P[i1 + 2];
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (dist < 1e-6) continue;
                    const pinned1 = C[c] < firstFree, pinned2 = C[c + 1] < firstFree;
                    const diff = (dist - rest) / dist;
                    const w1 = pinned1 ? 0 : pinned2 ? 1 : 0.5, w2 = pinned2 ? 0 : pinned1 ? 1 : 0.5;
                    P[i1] += dx * diff * w1; P[i1 + 1] += dy * diff * w1; P[i1 + 2] += dz * diff * w1;
                    P[i2] -= dx * diff * w2; P[i2 + 1] -= dy * diff * w2; P[i2 + 2] -= dz * diff * w2;
                }
                for (const col of this.colliders) {
                    const cx = col.c.x, cy = col.c.y, cz = col.c.z, r = col.r;
                    for (let p = firstFree; p < n; p++) {
                        const i = p * 3;
                        const dx = P[i] - cx, dy = P[i + 1] - cy, dz = P[i + 2] - cz;
                        const d2 = dx * dx + dy * dy + dz * dz;
                        if (d2 < r * r && d2 > 1e-10) {
                            const d = Math.sqrt(d2), push = (r - d) / d;
                            P[i] += dx * push; P[i + 1] += dy * push; P[i + 2] += dz * push;
                        }
                    }
                }
            }
        }

        // Recover from any numerical blow-up (e.g. a huge frame hitch)
        if (!Number.isFinite(P[P.length - 1]) || Math.abs(P[P.length - 2]) > 5) this._needsReset = true;

        const g2 = this.mesh.geometry;
        g2.attributes.position.needsUpdate = true;
        g2.computeVertexNormals();
    }
}
