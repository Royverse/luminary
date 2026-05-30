/**
 * js/world/Collectibles.js
 *
 * Creates and owns the 150 energy-ring meshes.
 *
 * @ai-context
 *   OWNS      : ring Mesh array (this.rings[]); ring geometry + material.
 *   READS     : state.totalRings (ring count).
 *   WRITES    : nothing to PlayerState.
 *   EXPOSES   : this.rings[] — iterated by CameraJuice each frame for
 *               bob animation and collection detection.
 *   RELATED   : CameraJuice.js (animates + collects rings);
 *               PlayerState.js (totalRings, score, highScore).
 *   ASK FOR   : CameraJuice.js if changing collection radius or bob math.
 */

import * as THREE from 'three';

export class Collectibles {
    /**
     * @param {THREE.Scene}   scene
     * @param {import('../entities/PlayerState.js').PlayerState} state
     */
    constructor(scene, state) {
        this.scene = scene;
        this.state = state;

        /** @type {THREE.Mesh[]} */
        this.rings = [];

        this._createRings();
    }

    // ─────────────────────────────────────────────────────────────────

    _createRings() {
        const geom = new THREE.TorusGeometry(3.5, 0.45, 8, 28);
        const mat  = new THREE.MeshStandardMaterial({
            color:             0xffcc00,
            emissive:          0xff8800,
            emissiveIntensity: 2.5,
            roughness:         0.1,
            metalness:         0.9,
        });

        for (let i = 0; i < this.state.totalRings; i++) {
            const ring = new THREE.Mesh(geom, mat);

            ring.position.set(
                (this.state.random() - 0.5) * 3800,
                35 + Math.pow(this.state.random(), 2) * 380,
                (this.state.random() - 0.5) * 3800
            );
            ring.rotation.y = this.state.random() * Math.PI;
            ring.rotation.x = (this.state.random() - 0.5) * 0.5;

            ring.userData = {
                active: true,
                base:   ring.position.clone(),
            };

            this.scene.add(ring);
            this.rings.push(ring);
        }
    }
}
