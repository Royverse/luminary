/**
 * js/entities/CharacterRig.js — The hero: skeleton, suit, energy wings and cape.
 *
 * Conventions (every system relies on these):
 *   • The model faces −Z, exactly like the camera. +X is the hero's right, +Y is up.
 *   • rig.player is the root. Its position is the feet; Physics owns its transform.
 *   • rig.joints.body pivots at the hips. rotation.x = −π/2 lays the hero prone
 *     (head forward, chest down) for flight.
 *   • A positive rotation.x swings a hanging limb forward (hip / shoulder / elbow
 *     flexion). Knee flexion is negative. A negative ankle angle points the toes.
 *   • rotation.z = side × abduction, where side is +1 for the right, −1 for the left.
 *
 * Built in metres for a 1.85 m hero, then scaled by CHAR_SCALE so he reads well
 * at chase-camera distance.
 *
 * @ai-context
 *   OWNS      : every mesh of the hero; wing shader; the CapeCloth instance.
 *   EXPOSES   : player, joints{…}, wings, wingUniforms, cape, emblemMat, eyeMat,
 *               setWingsVisible(bool), dispose().
 *   RELATED   : AnimationPose.js (drives joints), CapeCloth.js (cape simulation).
 */
import * as THREE from 'three';
import { CapeCloth } from './CapeCloth.js';

export const CHAR_SCALE = 1.6;
export const HIP_Y = 0.95;

const PALETTE = {
    suit:   0x2748b8,
    mask:   0x16265e,
    accent: 0xc4122f,   // boots, gloves and cape share one crimson
    gold:   0xe2aa36,
    skin:   0xeebd97,
    hair:   0x21160f,
    glow:   0x7ff4ff,
};

/** Adds a view-dependent rim light so the hero separates from the dark city. */
function withRim(material, color, power = 2.6, strength = 0.55) {
    material.onBeforeCompile = shader => {
        shader.uniforms.rimColor = { value: new THREE.Color(color) };
        shader.uniforms.rimParams = { value: new THREE.Vector2(power, strength) };
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform vec3 rimColor;\nuniform vec2 rimParams;')
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
                float rimF = 1.0 - saturate(dot(normal, normalize(vViewPosition)));
                totalEmissiveRadiance += rimColor * pow(rimF, rimParams.x) * rimParams.y;`);
    };
    return material;
}

/** Smooth limb segment hanging from the joint at y = 0 down to y = −len. */
function limbGeometry(rTop, rBottom, len, radial = 18) {
    const pts = [];
    const CAP = 6;
    for (let i = 0; i <= CAP; i++) {
        const a = -Math.PI / 2 + (i / CAP) * (Math.PI / 2);
        pts.push(new THREE.Vector2(Math.cos(a) * rBottom, -len + Math.sin(a) * rBottom));
    }
    for (let i = 0; i <= CAP; i++) {
        const a = (i / CAP) * (Math.PI / 2);
        pts.push(new THREE.Vector2(Math.cos(a) * rTop, Math.sin(a) * rTop));
    }
    return new THREE.LatheGeometry(pts, radial);
}

/** Lathe from [radius, y] pairs listed bottom → top, flattened front-to-back. */
function latheGeometry(profile, depthScale, radial = 28) {
    const geo = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), radial);
    geo.scale(1, 1, depthScale);
    return geo;
}

function ellipsoid(rx, ry, rz, w = 24, h = 16) {
    const geo = new THREE.SphereGeometry(1, w, h);
    geo.scale(rx, ry, rz);
    return geo;
}

function joint(parent, x, y, z) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
}

function mesh(parent, geo, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
}

export class CharacterRig {
    constructor(scene) {
        this.scene = scene;
        this.player = new THREE.Group();
        this.player.rotation.order = 'YXZ';
        this.player.scale.setScalar(CHAR_SCALE);
        scene.add(this.player);

        this._materials();
        this._buildBody();
        this._buildHead();
        this._buildArms();
        this._buildLegs();
        this._buildWings();
        this.cape = new CapeCloth(this, PALETTE.accent, withRim);
        this.setWingsVisible(true);
    }

    /** Hero's centre (hips) in world space, without relying on matrixWorld. */
    centerWorld(out) {
        return out.set(0, HIP_Y * this.player.scale.y, 0).applyQuaternion(this.player.quaternion).add(this.player.position);
    }

    setWingsVisible(show) {
        this.wings.visible = show;
        this.cape.mesh.visible = !show;
    }

    dispose() {
        this.scene.remove(this.player);
        const mats = new Set();
        this.player.traverse(o => {
            o.geometry?.dispose();
            if (o.material) mats.add(o.material);
        });
        mats.forEach(m => m.dispose());
    }

    // ── Materials ─────────────────────────────────────────────────────
    _materials() {
        const std = (color, roughness, metalness = 0) =>
            new THREE.MeshStandardMaterial({ color, roughness, metalness });
        this.mats = {
            suit:   withRim(std(PALETTE.suit, 0.42, 0.18), 0x5fd3ff, 3.2, 0.32),
            mask:   withRim(std(PALETTE.mask, 0.35, 0.2), 0x5fd3ff, 3, 0.35),
            accent: withRim(std(PALETTE.accent, 0.48, 0.1), 0xff6a7a, 3.2, 0.3),
            gold:   std(PALETTE.gold, 0.3, 0.85),
            skin:   withRim(std(PALETTE.skin, 0.55), 0xffc9a8, 3, 0.25),
            hair:   withRim(std(PALETTE.hair, 0.7), 0x6f8cff, 3, 0.3),
            lip:    std(0x8e3b33, 0.6),
            eye:    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xd8fbff, emissiveIntensity: 1.6, roughness: 0.2 }),
            emblem: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: PALETTE.glow, emissiveIntensity: 2.2, roughness: 0.25 }),
        };
        this.eyeMat = this.mats.eye;
        this.emblemMat = this.mats.emblem;
    }

    // ── Torso ─────────────────────────────────────────────────────────
    _buildBody() {
        const M = this.mats;
        const body  = joint(this.player, 0, HIP_Y, 0);
        const hips  = joint(body, 0, 0, 0);
        const chest = joint(hips, 0, 0.11, 0);

        // Pelvis: hip width tapering into the waist
        mesh(hips, latheGeometry([
            [0.0, -0.105], [0.07, -0.1], [0.125, -0.07], [0.158, -0.01],
            [0.155, 0.05], [0.138, 0.11], [0.13, 0.14], [0.0, 0.145],
        ], 0.72), M.suit);

        // Belt + buckle
        const belt = new THREE.CylinderGeometry(0.146, 0.149, 0.045, 32, 1, true);
        belt.scale(1, 1, 0.75);
        mesh(hips, belt, M.gold, 0, 0.1, 0);
        mesh(hips, new THREE.BoxGeometry(0.06, 0.04, 0.018), M.gold, 0, 0.1, -0.11);

        // Chest: V-taper from waist to broad shoulders
        mesh(chest, latheGeometry([
            [0.0, -0.03], [0.128, -0.03], [0.132, 0.03], [0.145, 0.11], [0.17, 0.19],
            [0.192, 0.265], [0.2, 0.32], [0.192, 0.365], [0.165, 0.4], [0.11, 0.428],
            [0.06, 0.44], [0.0, 0.445],
        ], 0.66), M.suit);
        // One broad chest plate (separate pecs read as outlines under the rim light)
        mesh(chest, ellipsoid(0.165, 0.09, 0.07), M.suit, 0, 0.27, -0.065);

        // Emblem: a four-point star inside a gold ring, the front of the hero
        const star = new THREE.Shape();
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2 + Math.PI / 2;
            const r = i % 2 === 0 ? 0.05 : 0.016;
            const x = Math.cos(a) * r, y = Math.sin(a) * r;
            i === 0 ? star.moveTo(x, y) : star.lineTo(x, y);
        }
        const starGeo = new THREE.ExtrudeGeometry(star, { depth: 0.012, bevelEnabled: false });
        starGeo.translate(0, 0, -0.012);
        const emblem = mesh(chest, starGeo, M.emblem, 0, 0.275, -0.142);
        emblem.rotation.x = 0.08;
        const ring = mesh(chest, new THREE.TorusGeometry(0.058, 0.0065, 8, 40), M.gold, 0, 0.275, -0.138);
        ring.rotation.x = 0.08;

        this.joints = { body, hips, chest };
    }

    // ── Head ──────────────────────────────────────────────────────────
    _buildHead() {
        const M = this.mats;
        const neck = joint(this.joints.chest, 0, 0.41, 0.005);
        mesh(neck, limbGeometry(0.052, 0.06, 0.09, 16).translate(0, 0.09, 0), M.skin);
        const head = joint(neck, 0, 0.085, -0.005);

        // Skull, jaw, chin, nose, ears
        mesh(head, ellipsoid(0.094, 0.108, 0.102, 32, 24), M.skin, 0, 0.125, 0.008);
        mesh(head, ellipsoid(0.077, 0.08, 0.081), M.skin, 0, 0.075, -0.022);
        mesh(head, ellipsoid(0.024, 0.02, 0.022, 12, 10), M.skin, 0, 0.035, -0.08);
        mesh(head, ellipsoid(0.012, 0.022, 0.016, 12, 10), M.skin, 0, 0.104, -0.097);
        for (const s of [-1, 1]) mesh(head, ellipsoid(0.011, 0.024, 0.018, 12, 10), M.skin, s * 0.094, 0.115, 0.012);

        // Domino mask band wrapped around the front of the skull
        const maskGeo = new THREE.SphereGeometry(0.1, 36, 12, Math.PI * 0.95, Math.PI * 1.1, Math.PI * 0.4, Math.PI * 0.16);
        maskGeo.scale(0.975, 1.12, 1.06);
        mesh(head, maskGeo, M.mask, 0, 0.125, 0.008);

        // Glowing eye lenses
        for (const s of [-1, 1]) {
            const eye = mesh(head, ellipsoid(0.02, 0.011, 0.008, 16, 8), M.eye, s * 0.037, 0.128, -0.093);
            eye.rotation.set(0, -s * 0.38, s * 0.14);
        }
        mesh(head, new THREE.BoxGeometry(0.03, 0.0045, 0.006), M.lip, 0, 0.054, -0.099);

        // Hair: a cap tipped back so it covers the crown and nape — the back of the head reads as hair
        const hairGeo = new THREE.SphereGeometry(0.1, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.55);
        hairGeo.scale(1.02, 1.12, 1.08);
        const hair = mesh(head, hairGeo, M.hair, 0, 0.13, 0.012);
        hair.rotation.x = 0.42;

        Object.assign(this.joints, { neck, head });
    }

    // ── Arms ──────────────────────────────────────────────────────────
    _buildArms() {
        const M = this.mats;
        const build = side => {
            const shoulder = joint(this.joints.chest, side * 0.2, 0.345, 0);
            mesh(shoulder, ellipsoid(0.07, 0.064, 0.068), M.suit, side * 0.008, -0.012, 0);
            mesh(shoulder, limbGeometry(0.064, 0.05, 0.285), M.suit);

            const elbow = joint(shoulder, 0, -0.285, 0);
            mesh(elbow, limbGeometry(0.05, 0.04, 0.25), M.suit);
            mesh(elbow, new THREE.CylinderGeometry(0.05, 0.044, 0.12, 20, 1, true), M.accent, 0, -0.19, 0);
            mesh(elbow, new THREE.CylinderGeometry(0.057, 0.05, 0.03, 20, 1, true), M.accent, 0, -0.13, 0);

            const wrist = joint(elbow, 0, -0.25, 0);
            mesh(wrist, ellipsoid(0.042, 0.055, 0.047), M.accent, 0, -0.045, -0.004);
            mesh(wrist, ellipsoid(0.017, 0.028, 0.017, 12, 10), M.accent, -side * 0.012, -0.032, -0.04);
            return { shoulder, elbow, wrist };
        };
        const r = build(1), l = build(-1);
        Object.assign(this.joints, {
            shoulderR: r.shoulder, elbowR: r.elbow, wristR: r.wrist,
            shoulderL: l.shoulder, elbowL: l.elbow, wristL: l.wrist,
        });
    }

    // ── Legs ──────────────────────────────────────────────────────────
    _buildLegs() {
        const M = this.mats;
        const build = side => {
            const hip = joint(this.joints.hips, side * 0.095, -0.02, 0);
            mesh(hip, limbGeometry(0.095, 0.065, 0.43), M.suit);

            const knee = joint(hip, 0, -0.43, 0);
            mesh(knee, limbGeometry(0.064, 0.045, 0.42), M.suit);
            mesh(knee, new THREE.CylinderGeometry(0.066, 0.049, 0.28, 20, 1, true), M.accent, 0, -0.28, 0);
            mesh(knee, new THREE.CylinderGeometry(0.074, 0.066, 0.035, 20, 1, true), M.accent, 0, -0.14, 0);

            const ankle = joint(knee, 0, -0.42, 0);
            const boot = new THREE.CapsuleGeometry(0.046, 0.16, 6, 16);
            boot.rotateX(Math.PI / 2);
            boot.scale(1, 0.8, 1);
            mesh(ankle, boot, M.accent, 0, -0.034, -0.055);
            return { hip, knee, ankle };
        };
        const r = build(1), l = build(-1);
        Object.assign(this.joints, {
            hipR: r.hip, kneeR: r.knee, ankleR: r.ankle,
            hipL: l.hip, kneeL: l.knee, ankleL: l.ankle,
        });
    }

    // ── Energy wings ──────────────────────────────────────────────────
    _buildWings() {
        const SEGS = 24, SPAN = 1.25;
        const pos = [], uv = [], idx = [];
        for (let i = 0; i <= SEGS; i++) {
            const t = i / SEGS;
            // Leading edge arcs up to a "wrist" then reaches out; trailing edge tapers to the tip
            const lx = SPAN * t;
            const ly = 0.04 + 0.62 * Math.pow(Math.sin(t * Math.PI / 2), 0.9) - 0.12 * t * t;
            const lz = 0.2 * t * t;
            const chord = 0.7 * Math.pow(1 - t, 0.8) + 0.03;
            pos.push(lx, ly, lz, lx * 0.93, ly - chord, lz + 0.06);
            uv.push(t, 1, t, 0);
            if (i < SEGS) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(idx);

        this.wingUniforms = {
            time:  { value: 0 },
            boost: { value: 0 },
            color: { value: new THREE.Color(0x2ee6ff) },
        };
        const mat = new THREE.ShaderMaterial({
            uniforms: this.wingUniforms,
            transparent: true, depthWrite: false,
            side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
            vertexShader: /* glsl */`
                uniform float time; uniform float boost;
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    vec3 p = position;
                    float flap = sin(time * 3.2) * 0.14 * (1.0 - boost);
                    p.z += flap * uv.x * 1.2 + boost * uv.x * 0.18;
                    p.y -= boost * uv.x * 0.5;
                    p.x *= 1.0 - boost * 0.12;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
                }`,
            fragmentShader: /* glsl */`
                uniform float time; uniform float boost; uniform vec3 color;
                varying vec2 vUv;
                void main() {
                    // Pointed feather tips cut into the trailing edge
                    float tooth = abs(fract(vUv.x * 7.0) - 0.5) * 2.0;
                    float edge = vUv.y - 0.28 * (1.0 - tooth) * (1.0 - vUv.x * 0.5);
                    float shape = smoothstep(0.0, 0.06, edge) * smoothstep(1.0, 0.9, vUv.y) * smoothstep(1.0, 0.8, vUv.x);
                    float shimmer = 0.75 + 0.25 * sin(vUv.x * 14.0 - time * 4.0);
                    float glow = (0.35 + 0.65 * vUv.y) * shimmer;
                    vec3 c = mix(color, vec3(1.0, 0.25, 0.6), boost * vUv.x);
                    gl_FragColor = vec4(c * glow, shape * (0.5 + 0.5 * boost));
                }`,
        });
        const wingR = new THREE.Mesh(geo, mat);
        const wingL = new THREE.Mesh(geo, mat);
        wingL.scale.x = -1;
        wingR.position.set(0.07, 0.33, 0.1);
        wingL.position.set(-0.07, 0.33, 0.1);
        this.wings = new THREE.Group();
        this.wings.add(wingR, wingL);
        this.joints.chest.add(this.wings);
    }
}
