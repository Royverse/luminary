/**
 * js/world/Environment.js — Sky, lighting and the street-level ground.
 *
 * The ground texture is one 480 m tile of the city's street pattern, mapped in
 * world space so every street, avenue and plaza lines up with the buildings.
 *
 * @ai-context
 *   API : update(heroPosition) — recentres the ground plane each frame.
 */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { CITY } from './CityGenerator.js';

export class Environment {
    constructor(scene, renderer) {
        this.scene = scene;
        this.renderer = renderer;
        this._buildSky();
        this._buildLights();
        this._buildGround();
    }

    _buildSky() {
        const sky = new Sky();
        sky.scale.setScalar(10000);
        const u = sky.material.uniforms;
        // Sun just under the horizon: deep blue overhead, warm glow along one edge
        u.turbidity.value = 8;
        u.rayleigh.value = 3;
        u.mieCoefficient.value = 0.004;
        u.mieDirectionalG.value = 0.85;
        u.sunPosition.value.setFromSphericalCoords(1, Math.PI * 0.503, Math.PI * 0.5);
        this.scene.add(sky);

        // Bake the sky once so metal and glass get believable reflections
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        this.scene.environment = pmrem.fromScene(sky).texture;
        pmrem.dispose();
    }

    _buildLights() {
        this.scene.add(new THREE.HemisphereLight(0x3a5a9a, 0x0c0c18, 1.6));
        const moon = new THREE.DirectionalLight(0x9fb6ff, 1.4);
        moon.position.set(200, 400, 100);
        this.scene.add(moon);
        const rim = new THREE.DirectionalLight(0xffa066, 0.6);
        rim.position.set(-150, 250, -200);
        this.scene.add(rim);
    }

    _buildGround() {
        const PX = 1024, m = PX / CITY.PERIOD;          // pixels per metre
        const c = document.createElement('canvas');
        c.width = c.height = PX;
        const g = c.getContext('2d');

        g.fillStyle = '#0a0c13';                        // asphalt
        g.fillRect(0, 0, PX, PX);

        // Tile is offset by half a period so the avenue sits in the middle
        const blocks = CITY.BLOCK_CENTERS.map(v => (((v + CITY.PERIOD / 2) % CITY.PERIOD) + CITY.PERIOD) % CITY.PERIOD);
        const half = CITY.BLOCK / 2;
        for (const bx of blocks) for (const bz of blocks) {
            g.fillStyle = '#171a24';                    // sidewalk
            g.fillRect((bx - half) * m, (bz - half) * m, CITY.BLOCK * m, CITY.BLOCK * m);
            g.fillStyle = '#10121a';                    // lot
            g.fillRect((bx - half + 3) * m, (bz - half + 3) * m, (CITY.BLOCK - 6) * m, (CITY.BLOCK - 6) * m);
        }

        // Faint neon centre line down each avenue
        g.strokeStyle = 'rgba(64, 200, 255, 0.16)';
        g.lineWidth = 2;
        g.setLineDash([24, 18]);
        g.beginPath();
        g.moveTo(PX / 2, 0); g.lineTo(PX / 2, PX);
        g.moveTo(0, PX / 2); g.lineTo(PX, PX / 2);
        g.stroke();

        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.flipY = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;

        // A modest, subdivided plane that follows the player (snapped to the street
        // period so the texture never slides). One giant quad loses depth precision
        // when clipped and can end up drawn in front of the hero.
        const SIZE = CITY.PERIOD * 40;
        const geo = new THREE.PlaneGeometry(SIZE, SIZE, 16, 16);
        geo.rotateX(-Math.PI / 2);
        // World-space UVs: one texture repeat per street period
        const pos = geo.attributes.position, uv = geo.attributes.uv;
        for (let i = 0; i < pos.count; i++) {
            uv.setXY(i, (pos.getX(i) + CITY.PERIOD / 2) / CITY.PERIOD, (pos.getZ(i) + CITY.PERIOD / 2) / CITY.PERIOD);
        }
        this.ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.1 }));
        this.scene.add(this.ground);
    }

    /** Keep the ground centred under the player, in whole street periods. */
    update(center) {
        this.ground.position.x = Math.round(center.x / CITY.PERIOD) * CITY.PERIOD;
        this.ground.position.z = Math.round(center.z / CITY.PERIOD) * CITY.PERIOD;
    }
}
