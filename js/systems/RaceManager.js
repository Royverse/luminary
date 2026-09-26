/**
 * js/systems/RaceManager.js — Multiplayer race: countdown, finish beacon,
 * compass, and the result screen. Only created for multiplayer sessions.
 *
 * @ai-context
 *   API     : startRace(), update(dt), showDefeat(name, time), onFinish(time) callback.
 *   WRITES  : hero position/velocity (held at the start line during the countdown).
 */
import * as THREE from 'three';
import { wrapAngle } from '../core/math.js';

const FINISH = new THREE.Vector3(2880, 380, 2880);
const FINISH_RADIUS = 120;
const COUNTDOWN = [['READY', '#ffffff'], ['3', '#00f0ff'], ['2', '#ffaa00'], ['1', '#ff0055'], ['GO!', '#00ff66']];

export class RaceManager {
    constructor(state, scene, rig, ui) {
        this.state = state;
        this.scene = scene;
        this.rig   = rig;
        this.ui    = ui;
        this.phase = 'WAITING';
        this.onFinish = null;
        this._buildBeacon();
        this._buildCompass();
    }

    _buildBeacon() {
        const glow = (color, opacity) => new THREE.MeshBasicMaterial({
            color, transparent: true, opacity, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
        });
        this.beacon = new THREE.Group();
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(80, 80, 2000, 32, 1, true), glow(0xff0055, 0.22));
        const core = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 2000, 8, 1, true), glow(0xffffff, 0.6));
        pillar.position.y = core.position.y = 1000;
        this.ring = new THREE.Mesh(new THREE.TorusGeometry(FINISH_RADIUS, 6, 16, 64), glow(0xff0055, 0.8));
        this.ring.rotation.x = Math.PI / 2;
        this.ring.position.y = FINISH.y;
        this.beacon.add(pillar, core, this.ring);
        this.beacon.position.set(FINISH.x, 0, FINISH.z);
        this.scene.add(this.beacon);
    }

    _buildCompass() {
        this.compass = document.createElement('div');
        this.compass.className = 'race-compass';
        this.arrow = Object.assign(document.createElement('div'), { className: 'arrow', textContent: '▲' });
        this.dist = Object.assign(document.createElement('div'), { className: 'dist' });
        const label = Object.assign(document.createElement('div'), { className: 'label', textContent: 'FINISH BEACON' });
        this.compass.append(this.arrow, this.dist, label);
        document.body.appendChild(this.compass);
    }

    _overlay(className) {
        const el = document.createElement('div');
        el.className = `race-overlay ${className}`;
        document.body.appendChild(el);
        requestAnimationFrame(() => el.classList.add('shown'));
        return el;
    }

    startRace() {
        this.phase = 'COUNTDOWN';
        this.countdownStart = performance.now();
        this.countdownEl = this._overlay('countdown');
        this.countEl = Object.assign(document.createElement('div'), { className: 'count' });
        this.countdownEl.appendChild(this.countEl);
    }

    update(dt) {
        const hero = this.rig.player.position;
        this.ring.rotation.z += dt * 0.8;

        if (this.phase === 'COUNTDOWN') {
            hero.set(0, 0, 0);
            this.state.velocity.set(0, 0, 0);
            const step = Math.floor((performance.now() - this.countdownStart) / 1000);
            if (step >= COUNTDOWN.length) {
                this.phase = 'RACING';
                this.raceStart = performance.now();
                this.countdownEl.classList.remove('shown');
                setTimeout(() => this.countdownEl.remove(), 600);
            } else if (this.countEl.textContent !== COUNTDOWN[step][0]) {
                [this.countEl.textContent, this.countEl.style.color] = COUNTDOWN[step];
            }
        }

        const dx = FINISH.x - hero.x, dz = FINISH.z - hero.z;
        const bearing = Math.atan2(-dx, -dz);
        this.arrow.style.transform = `rotate(${-wrapAngle(bearing - this.state.currentYaw) * 180 / Math.PI}deg)`;
        this.dist.textContent = `${Math.round(hero.distanceTo(FINISH))} M`;

        if (this.phase === 'RACING' && hero.distanceTo(FINISH) < FINISH_RADIUS + 20) {
            const time = ((performance.now() - this.raceStart) / 1000).toFixed(2);
            this._result('VICTORY', 'You reached the beacon first', time, '#00f0ff');
            this.onFinish?.(time);
        }
    }

    showDefeat(name, time) {
        if (this.phase === 'FINISHED') return;
        this._result('DEFEAT', `${name} reached the beacon first`, time, '#ff0055');
    }

    _result(title, subtitle, time, color) {
        this.phase = 'FINISHED';
        const el = this._overlay('result');
        const h1 = Object.assign(document.createElement('h1'), { textContent: title });
        h1.style.color = color;
        const p = Object.assign(document.createElement('p'), { textContent: subtitle.toUpperCase() });
        const t = Object.assign(document.createElement('div'), { className: 'time', textContent: `${time}s` });
        const again = Object.assign(document.createElement('button'), { className: 'lobby-btn', textContent: 'PLAY AGAIN' });
        again.addEventListener('click', () => location.reload());
        el.append(h1, p, t, again);
        this.ui.setModal(true);
        document.exitPointerLock?.();
    }
}
