/**
 * js/systems/Animation.js — Hero pose driver + visual effects.
 *
 * Effects are deliberately few: a speed trail while supersonic, one shockwave
 * ring when the boost kicks in, dust on hard landings, and a soft blob shadow
 * that makes jumps and landings readable.
 *
 * @ai-context
 *   OWNS      : Trail (also used for peers), shockwave pool, landing dust, blob shadow.
 *   CALLS     : AnimationPose.updateCharacterPose() every frame.
 *   API       : update(dt, time), shockwave(), landingDust(position, strength).
 */
import * as THREE from 'three';
import { clamp, damp } from '../core/math.js';
import { updateCharacterPose } from './AnimationPose.js';

const _v = new THREE.Vector3();
const _right = new THREE.Vector3();

/**
 * Tapered, fading ribbon that follows a point. Sampled at a fixed rate.
 * Fades by view depth, so a chase cam never looks down a glowing tube while
 * side views (turns, free look, other players) still show the full streak.
 */
export class Trail {
    constructor(scene, color, { samples = 18, width = 0.32 } = {}) {
        this.color = new THREE.Color(color);
        this.samples = samples;
        this.width = width;
        this.points = Array.from({ length: samples }, () => new THREE.Vector3());
        this.count = 0;
        this.intensity = 0;
        this._clock = 0;

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(samples * 6), 3));
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(samples * 6), 3));
        const index = [];
        for (let i = 0; i < samples - 1; i++) { const a = i * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        geo.setIndex(index);
        const mat = new THREE.MeshBasicMaterial({
            vertexColors: true, transparent: true, depthWrite: false,
            side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        });
        // Fade by view depth in the shader, so it always uses this frame's camera
        mat.onBeforeCompile = shader => {
            shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>',
                '#include <project_vertex>\n\tvColor *= smoothstep(6.0, 20.0, -mvPosition.z);');
        };
        this.mesh = new THREE.Mesh(geo, mat);
        this.mesh.frustumCulled = false;
        this.mesh.visible = false;
        scene.add(this.mesh);
    }

    update(dt, head, right, active) {
        this.intensity += ((active ? 1 : 0) - this.intensity) * damp(active ? 8 : 4, dt);
        if (this.intensity < 0.01) { this.mesh.visible = false; this.count = 0; return; }
        this.mesh.visible = true;

        this._clock += dt;
        if (this.count === 0 || this._clock >= 1 / 50) {
            this._clock = 0;
            for (let i = this.samples - 1; i > 0; i--) this.points[i].copy(this.points[i - 1]);
            this.count = Math.min(this.count + 1, this.samples);
        }
        this.points[0].copy(head);

        const pos = this.mesh.geometry.attributes.position.array;
        const col = this.mesh.geometry.attributes.color.array;
        for (let i = 0; i < this.samples; i++) {
            const p = this.points[Math.min(i, this.count - 1)];
            const f = i < this.count ? 1 - i / this.samples : 0;
            const w = this.width * f, c = 0.7 * this.intensity * f * f * f;
            const j = i * 6;
            pos[j]     = p.x - right.x * w; pos[j + 1] = p.y - right.y * w; pos[j + 2] = p.z - right.z * w;
            pos[j + 3] = p.x + right.x * w; pos[j + 4] = p.y + right.y * w; pos[j + 5] = p.z + right.z * w;
            col[j] = col[j + 3] = this.color.r * c;
            col[j + 1] = col[j + 4] = this.color.g * c;
            col[j + 2] = col[j + 5] = this.color.b * c;
        }
        this.mesh.geometry.attributes.position.needsUpdate = true;
        this.mesh.geometry.attributes.color.needsUpdate = true;
    }

    dispose() {
        this.mesh.parent?.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
}

export class Animation {
    constructor(state, rig, scene) {
        this.state = state;
        this.rig   = rig;
        this.scene = scene;

        this.trail = new Trail(scene, 0x39d8ff);
        this._buildShockwaves();
        this._buildDust();
        this._buildShadow();
    }

    _buildShockwaves() {
        this.shockwaves = [];
        for (let i = 0; i < 2; i++) {
            const ring = new THREE.Mesh(
                new THREE.TorusGeometry(1, 0.06, 8, 64),
                new THREE.MeshBasicMaterial({ color: 0x9ff0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
            );
            ring.visible = false;
            this.scene.add(ring);
            this.shockwaves.push({ ring, t: 1 });
        }
    }

    _buildDust() {
        const count = 60;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        this.dust = new THREE.Points(geo, new THREE.PointsMaterial({
            color: 0x9fb4d8, size: 0.7, transparent: true, opacity: 0, depthWrite: false,
        }));
        this.dust.frustumCulled = false;
        this.dust.visible = false;
        this.dustVel = Array.from({ length: count }, () => new THREE.Vector3());
        this.dustT = 1;
        this.scene.add(this.dust);
    }

    _buildShadow() {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const g = c.getContext('2d');
        const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, 'rgba(0,0,0,0.55)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 64);
        const geo = new THREE.PlaneGeometry(1, 1);
        geo.rotateX(-Math.PI / 2);
        this.shadow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
            map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false,
            polygonOffset: true, polygonOffsetFactor: -2,
        }));
        this.scene.add(this.shadow);
    }

    /** One expanding ring, perpendicular to the flight path. */
    shockwave() {
        const sw = this.shockwaves.find(s => s.t >= 1) || this.shockwaves[0];
        sw.t = 0;
        sw.ring.visible = true;
        this.rig.centerWorld(sw.ring.position);
        sw.ring.quaternion.copy(this.rig.player.quaternion);
    }

    landingDust(origin, strength) {
        const pos = this.dust.geometry.attributes.position.array;
        const sc = clamp(strength, 0.3, 2);
        for (let i = 0; i < this.dustVel.length; i++) {
            const a = Math.random() * Math.PI * 2, r = Math.random();
            pos[i * 3] = origin.x + Math.cos(a) * r;
            pos[i * 3 + 1] = origin.y + 0.2;
            pos[i * 3 + 2] = origin.z + Math.sin(a) * r;
            this.dustVel[i].set(Math.cos(a) * (6 + Math.random() * 8) * sc, (1 + Math.random() * 4) * sc, Math.sin(a) * (6 + Math.random() * 8) * sc);
        }
        this.dustT = 0;
        this.dust.visible = true;
    }

    update(dt, time) {
        const s = this.state, S = s.STATES, player = this.rig.player;
        updateCharacterPose(dt, time, s, this.rig);

        // Trail from the hips while supersonic / diving
        const fast = s.currentState === S.SUPERSONIC || s.currentState === S.POWERDIVE;
        this.rig.centerWorld(_v);
        _right.set(1, 0, 0).applyQuaternion(player.quaternion);
        this.trail.update(dt, _v, _right, fast && s.velocity.length() > 60);

        for (const sw of this.shockwaves) {
            if (sw.t >= 1) continue;
            sw.t = Math.min(1, sw.t + dt * 2.2);
            const e = 1 - Math.pow(1 - sw.t, 3);
            sw.ring.scale.setScalar(2 + e * 16);
            sw.ring.material.opacity = (1 - sw.t) * 0.6;
            if (sw.t >= 1) sw.ring.visible = false;
        }

        if (this.dust.visible) {
            this.dustT += dt;
            const pos = this.dust.geometry.attributes.position.array;
            for (let i = 0; i < this.dustVel.length; i++) {
                const v = this.dustVel[i];
                v.multiplyScalar(Math.exp(-3 * dt));
                pos[i * 3] += v.x * dt; pos[i * 3 + 1] += v.y * dt; pos[i * 3 + 2] += v.z * dt;
            }
            this.dust.geometry.attributes.position.needsUpdate = true;
            this.dust.material.opacity = clamp(0.5 * (1 - this.dustT / 0.9), 0, 0.5);
            if (this.dustT > 0.9) this.dust.visible = false;
        }

        // Blob shadow on whatever is below (ground or rooftop)
        const h = player.position.y - s.groundHeight;
        this.shadow.visible = h < 40;
        if (this.shadow.visible) {
            this.rig.centerWorld(_v);
            this.shadow.position.set(_v.x, s.groundHeight + 0.05, _v.z);
            this.shadow.scale.setScalar(3.2 + h * 0.06);
            this.shadow.material.opacity = clamp(1 - h / 40, 0, 1);
        }
    }
}
