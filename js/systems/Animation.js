/**
 * js/systems/Animation.js
 *
 * Drives: character pose, cape cloth, trail ribbon, shockwaves, landing dust.
 * spawnShockwave() and triggerLandingDust() are called by Physics.
 *
 * @ai-context
 *   OWNS      : trail ribbon mesh; shockwave ring pool (4 instances);
 *               landing dust Points; spawnShockwave(); triggerLandingDust().
 *   READS     : state.currentState, state.velocity, state.STATES.
 *   WRITES    : nothing to PlayerState.
 *   CALLS     : AnimationPose.updateCharacterPose() every frame.
 *   RELATED   : AnimationPose.js (all kinematics live there),
 *               CharacterRig.js (mesh refs passed as `rig`),
 *               Physics.js (calls spawnShockwave / triggerLandingDust).
 *   ASK FOR   : AnimationPose.js for any pose/cloth changes;
 *               CharacterRig.js to understand rig structure.
 */
import * as THREE from 'three';
import { clamp, lerp, expDecay } from '../main.js';
import { updateCharacterPose }   from './AnimationPose.js';

export class Animation {
    constructor(state, rig, scene) {
        this.state = state;
        this.rig   = rig;
        this.scene = scene;

        this._trailPositions = [];
        this._trailMaxLen    = 40;
        this.shockwaves      = [];
        this.dustActive      = false;
        this.dustTimer       = 0;

        this._buildTrail();
        this._buildShockwavePool();
        this._buildLandingDust();
    }

    _buildTrail() {
        const segs  = this._trailMaxLen;
        const verts = new Float32Array(segs * 6 * 3);
        this._trailGeom = new THREE.BufferGeometry();
        this._trailGeom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        this._trailMat = new THREE.MeshBasicMaterial({
            color: 0x00aaff, transparent: true, opacity: 0,
            side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
        });
        this._trail = new THREE.Mesh(this._trailGeom, this._trailMat);
        this._trail.frustumCulled = false;
        this.scene.add(this._trail);
        for (let i = 0; i < segs; i++) this._trailPositions.push(new THREE.Vector3(0, 160, 0));
    }

    _buildShockwavePool() {
        for (let i = 0; i < 4; i++) {
            const group = new THREE.Group();
            const ring  = new THREE.Mesh(
                new THREE.TorusGeometry(1.5, 0.5, 16, 64),
                new THREE.MeshBasicMaterial({ color:0x00ffff, transparent:true, opacity:0, blending:THREE.AdditiveBlending, depthWrite:false })
            );
            const coneGeom = new THREE.CylinderGeometry(0, 3.5, 5, 32, 1, true);
            coneGeom.translate(0, -1.5, 0);
            const cone = new THREE.Mesh(coneGeom, new THREE.MeshBasicMaterial({
                color:0x00aaff, transparent:true, opacity:0,
                blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
            }));
            cone.rotation.x = -Math.PI / 2;
            group.add(ring, cone); group.visible = false;
            this.scene.add(group);
            this.shockwaves.push({ group, ring, cone, active: false, t: 0 });
        }
    }

    _buildLandingDust() {
        const count = 80;
        const geom  = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        const mat = new THREE.PointsMaterial({
            color:0xaabbff, size:1.4, transparent:true, opacity:0,
            blending:THREE.AdditiveBlending, depthWrite:false,
        });
        this._dustPoints = new THREE.Points(geom, mat);
        this._dustVels   = Array.from({ length: count }, () =>
            new THREE.Vector3((Math.random()-0.5)*18, Math.random()*12+4, (Math.random()-0.5)*18)
        );
        this.scene.add(this._dustPoints);
    }

    // ── Public API (called by Physics) ────────────────────────────────

    spawnShockwave() {
        const sw = this.shockwaves.find(s => !s.active);
        if (!sw) return;
        sw.active = true; sw.t = 0;
        sw.group.position.copy(this.rig.player.position);
        sw.group.quaternion.copy(this.rig.player.quaternion);
        sw.group.visible = true;
    }

    triggerLandingDust(origin, strength) {
        this.dustActive = true; this.dustTimer = 0;
        const pos = this._dustPoints.geometry.attributes.position.array;
        for (let i = 0; i < pos.length; i += 3) {
            pos[i]   = origin.x + (Math.random()-0.5)*4;
            pos[i+1] = origin.y + 0.5;
            pos[i+2] = origin.z + (Math.random()-0.5)*4;
        }
        this._dustPoints.geometry.attributes.position.needsUpdate = true;
        this._dustPoints.material.opacity = Math.min(0.7, strength * 0.5);
        const sc = clamp(strength, 0.3, 2.5);
        for (const v of this._dustVels)
            v.set((Math.random()-0.5)*20*sc, Math.random()*14*sc+2, (Math.random()-0.5)*20*sc);
    }

    // ── Per-frame update ──────────────────────────────────────────────

    update(dt, time) {
        updateCharacterPose(dt, time, this.state, this.rig);
        this.rig.wingL.visible = this.state.showWings;
        this.rig.wingR.visible = this.state.showWings;
        this.rig.cape.visible  = !this.state.showWings;
        this._updateTrail();
        this._updateShockwaves(dt);
        this._updateDust(dt);
    }

    _updateTrail() {
        const p = this.rig.player.position;
        this._trailPositions.unshift(p.clone());
        if (this._trailPositions.length > this._trailMaxLen) this._trailPositions.pop();

        const S = this.state.STATES;
        const visible = this.state.currentState === S.SUPERSONIC || this.state.currentState === S.POWERDIVE;
        const tgtOp   = visible ? clamp(this.state.velocity.length() / 200, 0, 0.6) : 0;
        this._trailMat.opacity = lerp(this._trailMat.opacity, tgtOp, 0.15);
        if (!visible && this._trailMat.opacity < 0.01) return;

        const pos   = this._trailGeom.attributes.position.array;
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.rig.player.quaternion);
        for (let i = 0; i < this._trailPositions.length - 1; i++) {
            const a = this._trailPositions[i], b = this._trailPositions[i+1];
            const hw = 0.6 * (1 - i / this._trailPositions.length);
            const base = i * 18;
            pos[base+0]=a.x-right.x*hw; pos[base+1]=a.y-right.y*hw; pos[base+2]=a.z-right.z*hw;
            pos[base+3]=a.x+right.x*hw; pos[base+4]=a.y+right.y*hw; pos[base+5]=a.z+right.z*hw;
            pos[base+6]=b.x-right.x*hw; pos[base+7]=b.y-right.y*hw; pos[base+8]=b.z-right.z*hw;
            pos[base+9]=a.x+right.x*hw; pos[base+10]=a.y+right.y*hw; pos[base+11]=a.z+right.z*hw;
            pos[base+12]=b.x+right.x*hw; pos[base+13]=b.y+right.y*hw; pos[base+14]=b.z+right.z*hw;
            pos[base+15]=b.x-right.x*hw; pos[base+16]=b.y-right.y*hw; pos[base+17]=b.z-right.z*hw;
        }
        this._trailGeom.attributes.position.needsUpdate = true;
    }

    _updateShockwaves(dt) {
        for (const sw of this.shockwaves) {
            if (!sw.active) continue;
            sw.t += dt * 2.2;
            const s  = 1 + sw.t * 35;
            sw.group.scale.set(s, s, s);
            const op = Math.max(0, 1.0 - sw.t * 1.8);
            sw.ring.material.opacity  = op;
            sw.cone.material.opacity  = op * 0.45;
            if (sw.t > 0.55) { sw.active = false; sw.group.visible = false; }
        }
    }

    _updateDust(dt) {
        if (!this.dustActive) return;
        this.dustTimer += dt;
        if (this.dustTimer > 1.2) { this.dustActive = false; this._dustPoints.material.opacity = 0; return; }
        const pos = this._dustPoints.geometry.attributes.position.array;
        for (let i = 0; i < this._dustVels.length; i++) {
            const v = this._dustVels[i];
            pos[i*3]+=v.x*dt; pos[i*3+1]+=v.y*dt; pos[i*3+2]+=v.z*dt;
            v.y -= 18 * dt;
        }
        this._dustPoints.geometry.attributes.position.needsUpdate = true;
        this._dustPoints.material.opacity = clamp((1 - this.dustTimer/1.2)*0.7, 0, 0.7);
    }
}
