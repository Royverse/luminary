/**
 * js/world/CityGenerator.js
 *
 * Generates the instanced city mesh and populates the spatial grid
 * on PlayerState so Physics can do fast AABB building-collision lookups.
 *
 * @ai-context
 *   OWNS      : InstancedMesh of 10k buildings; canvas window texture;
 *               state.spatialGrid population (AABB entries).
 *   READS     : state.bucketSize (300 units).
 *   WRITES    : state.spatialGrid — Map<"bx,bz", AABB[]>.
 *   RELATED   : Physics.js (reads spatialGrid for collision, constant hr=2.2);
 *               PlayerState.js (spatialGrid + bucketSize fields).
 *   ASK FOR   : Physics.js if changing building AABB shape or collision radius.
 *   NOTE      : Building AABB keys are "${bucketX},${bucketZ}" using integer
 *               floor(worldPos / bucketSize). Physics looks up ±2 buckets.
 */

import * as THREE from 'three';

export class CityGenerator {
    /**
     * @param {THREE.Scene}   scene
     * @param {import('../entities/PlayerState.js').PlayerState} state
     */
    constructor(scene, state) {
        this.scene = scene;
        this.state = state;

        this._buildCity();
    }

    // ─────────────────────────────────────────────────────────────────

    /** Add a building AABB entry to the state's spatial hash-grid. */
    _addToGrid(b) {
        const key = this._bucketKey(b.cx, b.cz);
        if (!this.state.spatialGrid.has(key)) this.state.spatialGrid.set(key, []);
        this.state.spatialGrid.get(key).push(b);
    }

    _bucketKey(x, z) {
        return `${Math.floor(x / this.state.bucketSize)},${Math.floor(z / this.state.bucketSize)}`;
    }

    _buildCity() {
        // ── Window texture ────────────────────────────────────────────
        const wc  = document.createElement('canvas');
        wc.width  = wc.height = 512;
        const wx  = wc.getContext('2d');

        wx.fillStyle = '#030306';
        wx.fillRect(0, 0, 512, 512);

        for (let wy = 6; wy < 512; wy += 26) {
            for (let wxx = 6; wxx < 512; wxx += 22) {
                if (wxx % 100 < 14 || wy % 100 < 10) continue;
                if (Math.random() > 0.38) {
                    wx.fillStyle   = Math.random() > 0.12 ? '#1a66ff' : '#ffddaa';
                    wx.globalAlpha = Math.random() * 0.75 + 0.25;
                    wx.fillRect(wxx, wy, 14, 19);
                }
            }
        }

        const winTex = new THREE.CanvasTexture(wc);
        winTex.wrapS = winTex.wrapT = THREE.RepeatWrapping;

        // ── Shared material + geometry ────────────────────────────────
        const buildMat = new THREE.MeshStandardMaterial({
            color:             0xffffff,
            roughness:         0.15,
            metalness:         0.65,
            emissiveMap:       winTex,
            emissive:          0xffffff,
            emissiveIntensity: 0.9,
        });

        const buildGeom = new THREE.BoxGeometry(1, 1, 1);
        buildGeom.translate(0, 0.5, 0); // pivot at base

        // ── Instanced mesh ────────────────────────────────────────────
        const instanceCount = 10000;
        this.city = new THREE.InstancedMesh(buildGeom, buildMat, instanceCount);

        const dummy = new THREE.Object3D();
        const col   = new THREE.Color();
        const R = 45, base = 50;
        let idx = 0;

        for (let gx = -R; gx < R && idx < instanceCount; gx++) {
            for (let gz = -R; gz < R && idx < instanceCount; gz++) {
                if (Math.random() < 0.1) continue;

                const swX = (gx % 8 === 0) ? 60 : 26;
                const swZ = (gz % 8 === 0) ? 60 : 26;
                const px  = gx * (base + swX);
                const pz  = gz * (base + swZ);

                const nd = Math.max(0, 1 - Math.sqrt(gx * gx + gz * gz) / (R * 0.5));
                const h  = 40 + Math.random() * 60 + Math.pow(nd, 3) * 900;

                // Vary footprint aspect ratio
                const st = Math.random();
                let w, d;
                if      (st < 0.3) { w = 46; d = 20; }
                else if (st < 0.6) { w = 20; d = 46; }
                else               { w = 36; d = 36; }

                dummy.position.set(px, 0, pz);
                dummy.scale.set(w, h, d);
                dummy.updateMatrix();
                this.city.setMatrixAt(idx, dummy.matrix);

                // Register building in the spatial grid for collision
                this._addToGrid({
                    cx:   px,   cz:  pz,
                    minX: px - w / 2, maxX: px + w / 2,
                    minZ: pz - d / 2, maxZ: pz + d / 2,
                    maxY: h,
                });

                // Slightly randomised dark-blue tint per building
                const shade = 0.08 + Math.random() * 0.28;
                col.setHSL(0.6 + (Math.random() - 0.5) * 0.1, 0.2, shade);
                this.city.setColorAt(idx, col);

                idx++;
            }
        }

        this.city.instanceColor.needsUpdate = true;
        this.scene.add(this.city);
    }
}
