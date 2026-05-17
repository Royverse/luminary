/**
 * js/systems/CameraJuice.js
 *
 * Chase camera spring, FOV animation, screen shake, speed lines,
 * collectibles bob + collection detection, and wind audio update.
 *
 * @ai-context
 *   OWNS      : cameraRig position (spring-driven); camera FOV + shake;
 *               speed lines Points mesh (attached to cameraRig);
 *               collectible bob animation + active flag + score writes;
 *               state.displayAlt + state.displaySpeed smoothing.
 *   READS     : state.velocity, state.currentState, state.input,
 *               state.boostPunch, state.rollAngle, state.currentYaw/Pitch,
 *               state.cameraVelocity, rig.player.position.
 *   WRITES    : state.cameraVelocity, state.displayAlt, state.displaySpeed,
 *               state.score, state.highScore, ring.userData.active.
 *   CALLS     : audio.updateWind(), audio.playCollectSound().
 *   RELATED   : PlayerState.js (camera spring constants, boostPunch);
 *               Collectibles.js (ring array); AudioManager.js (wind synth).
 *   ASK FOR   : PlayerState.js before tuning camera spring or FOV values.
 */
import * as THREE from 'three';
import { clamp, lerp, expDecay } from '../main.js';

export class CameraJuice {
    /**
     * @param {THREE.Scene}            scene
     * @param {THREE.PerspectiveCamera} camera
     * @param {THREE.Group}             cameraRig
     * @param {import('../entities/PlayerState.js').PlayerState}   state
     * @param {import('./AudioManager.js').AudioManager}           audio
     * @param {import('../entities/CharacterRig.js').CharacterRig} rig
     * @param {import('../world/Collectibles.js').Collectibles}    collectibles
     */
    constructor(scene, camera, cameraRig, state, audio, rig, collectibles) {
        this.scene       = scene;
        this.camera      = camera;
        this.cameraRig   = cameraRig;
        this.state       = state;
        this.audio       = audio;
        this.rig         = rig;
        this.collectibles = collectibles;

        this._buildSpeedLines();
    }

    _buildSpeedLines() {
        const count = 600;
        const geom  = new THREE.BufferGeometry();
        const pos   = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            pos[i*3]   = (Math.random()-0.5)*50;
            pos[i*3+1] = (Math.random()-0.5)*50;
            pos[i*3+2] = (Math.random()-0.5)*120;
        }
        geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        this._speedLines = new THREE.Points(geom, new THREE.PointsMaterial({
            color: 0xffffff, size: 0.18, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        // Attached to the cameraRig so lines move with the camera frame
        this.cameraRig.add(this._speedLines);
    }

    update(dt, time) {
        const s   = this.state;
        const spd = s.velocity.length();
        const spdN = clamp(spd / s.boostSpeedCap, 0, 1);
        const S   = s.STATES;

        // ── Collectibles: bob + collection ────────────────────────────
        for (const ring of this.collectibles.rings) {
            if (!ring.userData.active) continue;
            ring.rotation.y += 1.6 * dt;
            ring.position.y  = ring.userData.base.y + Math.sin(time * 2.1 + ring.userData.base.x) * 1.6;
            if (this.rig.player.position.distanceTo(ring.position) < 5.0) {
                ring.userData.active = false;
                ring.visible = false;
                s.score++;
                if (s.score > s.highScore) {
                    s.highScore = s.score;
                    localStorage.setItem('luminary_highscore', s.highScore.toString());
                }
                this.audio.playCollectSound();
            }
        }

        // ── Smoothed display values (read by UIManager) ───────────────
        const alt    = Math.max(0, this.rig.player.position.y);
        const spdKmH = spd * 3.6;
        s.displayAlt   += (alt    - s.displayAlt)   * Math.min(1, 12 * dt);
        s.displaySpeed += (spdKmH - s.displaySpeed) * Math.min(1, 12 * dt);

        // ── View quaternion (independent of mesh rotation) ────────────
        const viewEuler = new THREE.Euler(s.currentPitch, s.currentYaw, s.rollAngle, 'YXZ');
        const viewQuat  = new THREE.Quaternion().setFromEuler(viewEuler);

        // ── Camera spring ─────────────────────────────────────────────
        const offset    = new THREE.Vector3(0, 4, 16).applyQuaternion(viewQuat);
        const camTarget = this.rig.player.position.clone().add(offset);
        const camErr    = camTarget.clone().sub(this.cameraRig.position);

        const kCam = 45, bCam = 12;
        const camForce = camErr.multiplyScalar(kCam).addScaledVector(s.cameraVelocity, -bCam);
        s.cameraVelocity.addScaledVector(camForce, dt);

        const camSpdCap = 800;
        if (s.cameraVelocity.length() > camSpdCap) s.cameraVelocity.normalize().multiplyScalar(camSpdCap);
        this.cameraRig.position.addScaledVector(s.cameraVelocity, dt);
        this.cameraRig.quaternion.slerp(viewQuat, expDecay(14, dt));

        // ── FOV ───────────────────────────────────────────────────────
        s.boostPunch = lerp(s.boostPunch, 0, expDecay(12, dt));
        let targetFov = s.input.brake ? 64
            : s.currentState === S.POWERDIVE  ? 128
            : s.currentState === S.SUPERSONIC ? 102 : 76;
        targetFov += s.boostPunch * 45;
        this.camera.fov += (targetFov - this.camera.fov) * expDecay(5, dt);
        this.camera.updateProjectionMatrix();

        // ── Camera shake ──────────────────────────────────────────────
        if (s.boostPunch > 0.01) {
            this.camera.position.z = s.boostPunch * 3.5;
            this.camera.position.y = (Math.random()-0.5) * s.boostPunch * 2.5;
            this.camera.position.x = (Math.random()-0.5) * s.boostPunch * 2.5;
        } else if (s.input.brake) {
            this.camera.position.x = (Math.random()-0.5) * spdN * 0.8;
            this.camera.position.y = (Math.random()-0.5) * spdN * 0.8;
            this.camera.position.z = 0;
        } else if (s.currentState === S.SUPERSONIC || s.currentState === S.POWERDIVE) {
            const si = spdN * (s.currentState === S.POWERDIVE ? 0.5 : 0.22);
            this.camera.position.x = Math.sin(time * 55) * si;
            this.camera.position.y = Math.cos(time * 48) * si;
            this.camera.position.z = 0;
        } else {
            this.camera.position.x += (-this.camera.position.x) * expDecay(12, dt);
            this.camera.position.y += (-this.camera.position.y) * expDecay(12, dt);
            this.camera.position.z += (-this.camera.position.z) * expDecay(12, dt);
        }

        // ── Speed lines ───────────────────────────────────────────────
        const showLines  = spdN > 0.3 && !s.input.brake;
        const lineTgt    = showLines ? spdN * 0.8 : 0;
        const lineMat    = this._speedLines.material;
        lineMat.opacity += (lineTgt - lineMat.opacity) * expDecay(showLines ? 5 : 15, dt);
        if (showLines) {
            const sp = this._speedLines.geometry.attributes.position.array;
            for (let i = 2; i < sp.length; i += 3) { sp[i] += spd * dt * 4; if (sp[i] > 25) sp[i] = -120; }
            this._speedLines.geometry.attributes.position.needsUpdate = true;
        }

        // ── Wind audio ────────────────────────────────────────────────
        const latSpd = s.velocity.dot(s.rightDir);
        const tFreq  = 400 + spdN * 1800 + (s.input.brake ? 900 : 0);
        const tGain  = spdN * 0.85;
        const tPan   = clamp(-latSpd / 30, -1, 1);
        this.audio.updateWind(tFreq, tGain, tPan, dt);
    }
}
