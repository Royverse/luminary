/**
 * js/world/CityGenerator.js — Instanced city on a real street grid.
 *
 * Layout: a 480 m pattern of six 50 m blocks separated by 24 m streets and a
 * 60 m avenue. Avenues run through x = 480k and z = 480k, so the spawn point
 * (origin) is an avenue intersection, kept open as a plaza. Towers are tallest
 * around the plaza and fall off toward the edge of the city.
 *
 * Windows are mapped in world space (4 m floors, 4 m bays) so every tower gets
 * correctly sized floors instead of one texture stretched over its whole face.
 *
 * @ai-context
 *   WRITES    : state.spatialGrid — Map<"bx,bz", AABB[]> (AABB: cx,cz,minX,maxX,minZ,maxZ,maxY).
 *   READS     : state.random (seeded, so every peer builds the same city), state.bucketSize.
 *   EXPORTS   : CITY (layout constants, used by Environment + Collectibles).
 */
import * as THREE from 'three';

export const CITY = {
    PERIOD: 480,                                   // metres per repeat of the street pattern
    BLOCK_CENTERS: [55, 129, 203, 277, 351, 425],  // block centres within one period
    BLOCK: 50,
    AVENUE_HALF: 30,
    EXTENT: 3300,                                  // city half-size
    PLAZA: 160,                                    // open radius around the spawn point
};

/** Every block centre along one axis. */
export function blockCenters() {
    const out = [];
    for (let k = -8; k <= 8; k++) {
        for (const c of CITY.BLOCK_CENTERS) {
            const v = k * CITY.PERIOD + c;
            if (Math.abs(v) < CITY.EXTENT) out.push(v);
        }
    }
    return out.sort((a, b) => a - b);
}

export class CityGenerator {
    constructor(scene, state) {
        this.scene = scene;
        this.state = state;
        this._build();
    }

    _addToGrid(b) {
        const bs = this.state.bucketSize;
        const key = `${Math.floor(b.cx / bs)},${Math.floor(b.cz / bs)}`;
        if (!this.state.spatialGrid.has(key)) this.state.spatialGrid.set(key, []);
        this.state.spatialGrid.get(key).push(b);
    }

    _windowTexture() {
        // One tile = 8 floors × 8 bays (32 m × 32 m)
        const R = this.state.random;
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        const g = c.getContext('2d');
        g.fillStyle = '#000000';
        g.fillRect(0, 0, 256, 256);
        const palette = ['#2f6dff', '#2f6dff', '#2f6dff', '#3fd8ef', '#ffd9a0', '#ffd9a0', '#ffffff'];
        for (let row = 0; row < 8; row++) {
            const floorLit = R() < 0.15;
            for (let col = 0; col < 8; col++) {
                if (!floorLit && R() > 0.42) continue;
                g.globalAlpha = 0.35 + R() * 0.65;
                g.fillStyle = palette[Math.floor(R() * palette.length)];
                g.fillRect(col * 32 + 5, row * 32 + 7, 22, 17);
            }
        }
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        return tex;
    }

    _build() {
        const R = this.state.random;
        const mat = new THREE.MeshStandardMaterial({
            color: 0xffffff, roughness: 0.2, metalness: 0.6,
            emissive: 0xffffff, emissiveIntensity: 1.0, emissiveMap: this._windowTexture(),
        });
        // Windows use world-space UVs: horizontal = along the face, vertical = height.
        mat.onBeforeCompile = shader => {
            const decl = 'varying vec3 vCityPos;\nvarying vec3 vCityNormal;\nvarying float vCitySeed;';
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', `#include <common>\n${decl}`)
                .replace('#include <begin_vertex>', `#include <begin_vertex>
                    vCityPos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
                    vCityNormal = normal;
                    vCitySeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);`);
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', `#include <common>\n${decl}`)
                .replace('#include <emissivemap_fragment>', `
                    vec2 face = abs(vCityNormal.x) > 0.5 ? vCityPos.zy : vCityPos.xy;
                    float wall = 1.0 - step(0.5, abs(vCityNormal.y));
                    vec2 wuv = face / 32.0 + vec2(floor(vCitySeed * 8.0) * 0.125, floor(fract(vCitySeed * 7.0) * 8.0) * 0.125);
                    totalEmissiveRadiance *= texture2D(emissiveMap, wuv).rgb * wall * (0.45 + vCitySeed * 0.75);`);
        };

        const geo = new THREE.BoxGeometry(1, 1, 1);
        geo.translate(0, 0.5, 0);

        const centers = blockCenters();
        const cells = [];
        for (const x of centers) for (const z of centers) {
            if (Math.hypot(x, z) < CITY.PLAZA) continue;
            cells.push([x, z]);
        }

        this.city = new THREE.InstancedMesh(geo, mat, cells.length);
        const dummy = new THREE.Object3D();
        const col = new THREE.Color();
        let n = 0;
        for (const [x, z] of cells) {
            if (R() < 0.08) continue;                        // the odd empty lot
            const d = Math.hypot(x, z);
            const core = Math.max(0, 1 - d / 1800);
            const h = 25 + R() * 55 + Math.pow(core, 3) * 750 * (0.55 + R() * 0.45);
            const w = 28 + R() * 18, depth = 28 + R() * 18;
            const ox = (R() - 0.5) * (CITY.BLOCK - w), oz = (R() - 0.5) * (CITY.BLOCK - depth);
            const cx = x + ox, cz = z + oz;

            dummy.position.set(cx, 0, cz);
            dummy.scale.set(w, h, depth);
            dummy.updateMatrix();
            this.city.setMatrixAt(n, dummy.matrix);
            col.setHSL(0.6 + (R() - 0.5) * 0.08, 0.25, 0.1 + R() * 0.18);
            this.city.setColorAt(n, col);
            n++;

            this._addToGrid({ cx, cz, minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - depth / 2, maxZ: cz + depth / 2, maxY: h });
        }
        this.city.count = n;
        this.city.instanceMatrix.needsUpdate = true;
        this.city.instanceColor.needsUpdate = true;
        this.city.computeBoundingSphere();
        this.scene.add(this.city);
    }
}
