/**
 * js/world/Collectibles.js — Golden rings laid out as short fly-through chains.
 *
 * Chains of six turn collecting into flying a line: the first starts in the
 * plaza and runs down the avenue ahead of the spawn; the rest are either low
 * "canyon runs" along avenues or arcs above the rooftops. Placement uses the
 * seeded PRNG so every peer gets identical rings.
 *
 * @ai-context
 *   WRITES    : state.score / highScore / comboCount / lastCollectTime.
 *   API       : update(dt, time, heroCenter), onCollect(combo) callback.
 *   NOTE      : collection tests the segment flown this frame (no tunnelling at boost speed).
 */
import * as THREE from 'three';
import { clamp } from '../core/math.js';
import { CITY } from './CityGenerator.js';

const PER_CHAIN = 6, SPACING = 50, RADIUS = 5, COLLECT_RADIUS = 6.5, COMBO_WINDOW = 3.5;
const _seg = new THREE.Vector3(), _rel = new THREE.Vector3();

export class Collectibles {
    constructor(scene, state, onCollect) {
        this.scene = scene;
        this.state = state;
        this.onCollect = onCollect;
        this.rings = [];
        this._prev = null;

        this.geo = new THREE.TorusGeometry(RADIUS, 0.32, 12, 48);
        this.mat = new THREE.MeshStandardMaterial({
            color: 0xffcf4a, emissive: 0xffa31a, emissiveIntensity: 2.2, roughness: 0.25, metalness: 0.6,
        });

        const chains = Math.round(state.totalRings / PER_CHAIN);
        for (let c = 0; c < chains; c++) this._chain(c);
        state.totalRings = this.rings.length;

        this.pops = Array.from({ length: 4 }, () => {
            const m = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
                color: 0xffe08a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
            }));
            m.visible = false;
            scene.add(m);
            return { mesh: m, t: 1 };
        });
    }

    _chain(index) {
        const R = this.state.random;
        const path = [];
        if (index === 0) {
            // Welcome chain: out of the plaza, down the avenue ahead, climbing gently
            for (let i = 0; i < PER_CHAIN; i++) path.push(new THREE.Vector3(0, 10 + i * 7, -45 - i * SPACING));
        } else if (index % 2 === 1) {
            // Canyon run along an avenue, weaving slightly
            const k = Math.round((R() - 0.5) * 12);
            const alongX = R() < 0.5, dir = R() < 0.5 ? 1 : -1;
            const start = (R() - 0.5) * 2 * (CITY.EXTENT - 600);
            const y = 15 + R() * 40, phase = R() * 6;
            for (let i = 0; i < PER_CHAIN; i++) {
                const along = start + dir * i * SPACING, across = k * CITY.PERIOD + Math.sin(phase + i * 0.9) * 12;
                path.push(alongX ? new THREE.Vector3(along, y + i * 3, across) : new THREE.Vector3(across, y + i * 3, along));
            }
        } else {
            // Arc above the rooftops
            const a = R() * Math.PI * 2, d = 500 + R() * 2400;
            let heading = R() * Math.PI * 2, y = 90 + R() * 220;
            const climb = (R() - 0.5) * 16, turn = (R() - 0.5) * 0.5;
            const p = new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d);
            for (let i = 0; i < PER_CHAIN; i++) {
                y = Math.max(clamp(y + climb, 40, 420), this._roofAt(p.x, p.z) + 18);
                path.push(new THREE.Vector3(p.x, y, p.z));
                heading += turn;
                p.x -= Math.sin(heading) * SPACING;
                p.z -= Math.cos(heading) * SPACING;
            }
        }
        path.forEach((pos, i) => {
            const ring = new THREE.Mesh(this.geo, this.mat);
            ring.position.copy(pos);
            const next = path[i + 1] || pos.clone().multiplyScalar(2).sub(path[i - 1]);
            ring.lookAt(next);
            ring.userData.active = true;
            this.scene.add(ring);
            this.rings.push(ring);
        });
    }

    /** Tallest roof within a ring's reach of (x, z). */
    _roofAt(x, z) {
        const s = this.state, bs = s.bucketSize, M = RADIUS + 6;
        let top = 0;
        for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
            for (const b of s.spatialGrid.get(`${Math.floor(x / bs) + ox},${Math.floor(z / bs) + oz}`) || []) {
                if (x > b.minX - M && x < b.maxX + M && z > b.minZ - M && z < b.maxZ + M) top = Math.max(top, b.maxY);
            }
        }
        return top;
    }

    update(dt, time, hero) {
        const s = this.state;
        this.mat.emissiveIntensity = 2 + 0.45 * Math.sin(time * 3);
        if (s.comboCount > 0 && time - s.lastCollectTime > COMBO_WINDOW) s.comboCount = 0;

        // Test the whole path travelled this frame, so fast flight can't skip a ring
        const prev = this._prev || hero;
        _seg.subVectors(hero, prev);
        const segLen2 = _seg.lengthSq();
        for (const ring of this.rings) {
            if (!ring.userData.active) continue;
            _rel.subVectors(ring.position, prev);
            const t = segLen2 > 0 ? clamp(_rel.dot(_seg) / segLen2, 0, 1) : 0;
            if (_rel.addScaledVector(_seg, -t).lengthSq() > COLLECT_RADIUS * COLLECT_RADIUS) continue;
            ring.userData.active = false;
            ring.visible = false;
            s.score++;
            if (s.score > s.highScore) {
                s.highScore = s.score;
                try { localStorage.setItem('luminary_highscore', String(s.highScore)); } catch { /* storage blocked */ }
            }
            s.comboCount = s.lastCollectTime > 0 && time - s.lastCollectTime < COMBO_WINDOW ? s.comboCount + 1 : 1;
            s.lastCollectTime = time;
            this._pop(ring);
            this.onCollect(s.comboCount);
        }
        this._prev = (this._prev || new THREE.Vector3()).copy(hero);

        for (const p of this.pops) {
            if (p.t >= 1) continue;
            p.t = Math.min(1, p.t + dt * 3);
            p.mesh.scale.setScalar(1 + p.t * 0.8);
            p.mesh.material.opacity = (1 - p.t) * 0.9;
            if (p.t >= 1) p.mesh.visible = false;
        }
    }

    _pop(ring) {
        const p = this.pops.find(q => q.t >= 1) || this.pops[0];
        p.t = 0;
        p.mesh.visible = true;
        p.mesh.position.copy(ring.position);
        p.mesh.quaternion.copy(ring.quaternion);
    }
}
