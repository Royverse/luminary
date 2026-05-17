/**
 * js/world/Environment.js
 *
 * Builds the static, non-interactive world elements:
 *   • Procedural Sky (Three.js Sky add-on)
 *   • PMREM environment map for PBR reflections
 *   • Ambient + directional lighting
 *   • Ground plane with canvas-drawn grid texture
 *
 * Constructor params:
 *   scene    — THREE.Scene
 *   renderer — THREE.WebGLRenderer  (needed for PMREMGenerator)
 */

import * as THREE from 'three';
import { Sky }    from 'three/addons/objects/Sky.js';

export class Environment {
    /**
     * @param {THREE.Scene}          scene
     * @param {THREE.WebGLRenderer}  renderer
     */
    constructor(scene, renderer) {
        this.scene    = scene;
        this.renderer = renderer;

        this._buildSky();
        this._buildLights();
        this._buildGround();
    }

    // ─────────────────────────────────────────────────────────────────

    _buildSky() {
        this.sky = new Sky();
        this.sky.scale.setScalar(10000);
        this.scene.add(this.sky);

        const su = this.sky.material.uniforms;
        su.turbidity.value        = 6;
        su.rayleigh.value         = 0.8;
        su.mieCoefficient.value   = 0.008;
        su.mieDirectionalG.value  = 0.92;

        const sun = new THREE.Vector3().setFromSphericalCoords(
            1,
            Math.PI * 0.52,
            2 * Math.PI * 0.25
        );
        su.sunPosition.value.copy(sun);

        // Bake the sky into a PMREM cube so PBR materials get realistic reflections
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        this.scene.environment = pmrem.fromScene(this.sky).texture;
    }

    _buildLights() {
        this.scene.add(new THREE.AmbientLight(0x0d1428, 2.0));

        const dir = new THREE.DirectionalLight(0x3355cc, 1.2);
        dir.position.set(200, 400, 100);
        this.scene.add(dir);
    }

    _buildGround() {
        // Canvas-drawn grid texture
        const gc  = document.createElement('canvas');
        gc.width  = gc.height = 1024;
        const gx  = gc.getContext('2d');

        gx.fillStyle = '#08080b';
        gx.fillRect(0, 0, 1024, 1024);

        for (let j = 0; j < 1024; j += 128) {
            gx.strokeStyle = '#12121a';
            gx.lineWidth   = 8;
            gx.beginPath(); gx.moveTo(j,    0); gx.lineTo(j,    1024); gx.stroke();
            gx.beginPath(); gx.moveTo(0,    j); gx.lineTo(1024, j);    gx.stroke();
        }

        const gTex = new THREE.CanvasTexture(gc);
        gTex.wrapS = gTex.wrapT = THREE.RepeatWrapping;
        gTex.repeat.set(180, 180);

        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(70000, 70000),
            new THREE.MeshStandardMaterial({ map: gTex, roughness: 0.9, metalness: 0.15 })
        );
        ground.rotation.x = -Math.PI / 2;
        this.scene.add(ground);
    }
}
