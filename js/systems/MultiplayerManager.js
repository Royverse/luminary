/**
 * js/systems/MultiplayerManager.js — Serverless P2P rooms (Trystero over Nostr).
 *
 * Trystero is imported lazily, so solo play never depends on it loading.
 * Peers send their transform ~30×/s; each remote hero is a full CharacterRig
 * posed locally from that snapshot and smoothed toward it.
 *
 * @ai-context
 *   API     : connect(roomID), attach(engine), update(dt, camera), sendNickname(name),
 *             sendStart(), renderLobby(), onStart callback.
 *   WRITES  : state.peers (id → peer record with rig, trail, tag, targets).
 */
import * as THREE from 'three';
import { damp, wrapAngle } from '../core/math.js';
import { updateCharacterPose } from './AnimationPose.js';
import { CharacterRig } from '../entities/CharacterRig.js';
import { Trail } from './Animation.js';

const SEND_INTERVAL = 1000 / 30;
const _right = new THREE.Vector3();
const _center = new THREE.Vector3();
const _screen = new THREE.Vector3();

const cleanName = n => String(n ?? '').replace(/[^\w .\-]/g, '').slice(0, 12).toUpperCase() || 'PLAYER';
const isVec = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);

export class MultiplayerManager {
    constructor(state, ui) {
        this.state = state;
        this.ui = ui;
        this.room = null;
        this.send = {};
        this.engine = null;
        this.onStart = null;
        this._rosterClock = 0;
    }

    async connect(roomID) {
        try {
            const { joinRoom } = await import('trystero');
            this.room = joinRoom({ appId: 'luminary-flight-engine-p2p' }, roomID);
        } catch (err) {
            console.warn('Multiplayer unavailable:', err);
            this._status('COULD NOT REACH THE MULTIPLAYER SERVICE');
            return;
        }
        const action = name => {
            const [send, receive] = this.room.makeAction(name);
            this.send[name] = send;
            return receive;
        };
        const onState = action('state'), onNick = action('nickname'), onStart = action('start'), onFinish = action('race_finish');

        onStart(() => this.onStart?.());
        onFinish((data, id) => {
            const name = this.state.peers.get(id)?.nickname ?? 'OPPONENT';
            this.engine?.race?.showDefeat(name, String(data?.timeTaken ?? '—'));
        });
        onNick((data, id) => {
            const peer = this.state.peers.get(id);
            if (!peer) return;
            peer.nickname = cleanName(data?.nickname);
            if (peer.tag) peer.tag.textContent = peer.nickname;
            this.renderLobby();
        });
        onState((d, id) => {
            const peer = this.state.peers.get(id);
            if (!peer || !isVec(d?.pos, 3) || !isVec(d?.vel, 3) || !isVec(d?.rot, 3)) return;
            peer.targetPos.fromArray(d.pos);
            peer.mirror.velocity.fromArray(d.vel);
            peer.targetRot = d.rot;
            if (isVec(d.look, 2)) [peer.mirror.currentPitch, peer.mirror.currentYaw] = d.look;
            peer.mirror.currentState = Number.isInteger(d.state) ? d.state : 0;
            peer.mirror.input.boost = !!d.boost;
            peer.mirror.isJumping = !!d.jump;
            peer.wings = d.wings !== false;
            peer.seen = true;
        });

        this.room.onPeerJoin(id => {
            this.state.peers.set(id, {
                nickname: 'PLAYER', rig: null, trail: null, tag: null, seen: false, wings: true,
                targetPos: new THREE.Vector3(), targetRot: [0, 0, 0],
                mirror: {
                    STATES: this.state.STATES, currentState: 0, velocity: new THREE.Vector3(),
                    input: { boost: false, brake: false }, isJumping: false,
                    currentYaw: 0, currentPitch: 0, turnBank: 0,
                },
            });
            this.send.nickname({ nickname: this.state.localNickname }, id);
            if (this.engine) this.send.start({}, id);   // late joiner: pull them into the session
            this.renderLobby();
        });
        this.room.onPeerLeave(id => {
            this._removePeer(id);
            this.renderLobby();
        });
        this.renderLobby();
    }

    sendNickname(name) { this.send.nickname?.({ nickname: name }); }
    sendStart() { this.send.start?.({}); }

    /** Called once the local game has launched. */
    attach(engine) {
        this.engine = engine;
        engine.multiplayer = this;
        if (engine.race) engine.race.onFinish = time => this.send.race_finish?.({ timeTaken: time });
        clearInterval(this._timer);
        this._timer = setInterval(() => this._broadcast(), SEND_INTERVAL);
    }

    _broadcast() {
        if (!this.send.state) return;
        const s = this.state, player = this.engine.rig.player, p = player.position, r = player.rotation, v = s.velocity;
        this.send.state({
            pos: [p.x, p.y, p.z], vel: [v.x, v.y, v.z], rot: [r.x, r.y, r.z],
            look: [s.currentPitch, s.currentYaw], state: s.currentState,
            wings: s.showWings, boost: s.input.boost, jump: s.isJumping,
        });
    }

    update(dt, camera) {
        const S = this.state.STATES, time = this.state.simTime;
        for (const peer of this.state.peers.values()) {
            if (!peer.seen) continue;
            if (!peer.rig) this._spawn(peer);
            const player = peer.rig.player, k = damp(12, dt);

            player.position.lerp(peer.targetPos, k);
            const [rx, ry, rz] = peer.targetRot;
            player.rotation.x += wrapAngle(rx - player.rotation.x) * k;
            player.rotation.y += wrapAngle(ry - player.rotation.y) * k;
            player.rotation.z += wrapAngle(rz - player.rotation.z) * k;
            peer.mirror.turnBank = player.rotation.z;
            if (peer.rig.wings.visible !== peer.wings) peer.rig.setWingsVisible(peer.wings);

            updateCharacterPose(dt, time, peer.mirror, peer.rig);

            const st = peer.mirror.currentState;
            peer.rig.centerWorld(_center);
            _right.set(1, 0, 0).applyQuaternion(player.quaternion);
            peer.trail.update(dt, _center, _right, (st === S.SUPERSONIC || st === S.POWERDIVE) && peer.mirror.velocity.length() > 60);

            _screen.copy(_center).setY(_center.y + 3.2).project(camera);
            const onScreen = _screen.z < 1 && Math.abs(_screen.x) < 1.2 && Math.abs(_screen.y) < 1.2;
            peer.tag.style.display = onScreen ? 'block' : 'none';
            if (onScreen) {
                peer.tag.style.left = `${(_screen.x + 1) * innerWidth / 2}px`;
                peer.tag.style.top = `${(1 - _screen.y) * innerHeight / 2}px`;
            }
        }

        this._rosterClock -= dt;
        if (this._rosterClock <= 0) {
            this._rosterClock = 0.5;
            const kmh = v => Math.round(v.length() * 3.6);
            this.ui.setPlayers([
                { name: this.state.localNickname, speed: kmh(this.state.velocity), you: true },
                ...[...this.state.peers.values()].map(p => ({ name: p.nickname, speed: kmh(p.mirror.velocity) })),
            ]);
        }
    }

    _spawn(peer) {
        peer.rig = new CharacterRig(this.engine.scene);
        peer.rig.player.position.copy(peer.targetPos);
        peer.trail = new Trail(this.engine.scene, 0xff2d6f);
        peer.tag = Object.assign(document.createElement('div'), { className: 'player-tag', textContent: peer.nickname });
        document.body.appendChild(peer.tag);
    }

    _removePeer(id) {
        const peer = this.state.peers.get(id);
        if (!peer) return;
        peer.rig?.dispose();
        peer.trail?.dispose();
        peer.tag?.remove();
        this.state.peers.delete(id);
    }

    _status(text) {
        const el = document.getElementById('lobby-status-text');
        if (el) el.textContent = text;
    }

    /** Players list inside the lobby card. */
    renderLobby() {
        const box = document.getElementById('lobby-players-box'), list = document.getElementById('lobby-player-list');
        if (!box || !list) return;
        if (this.state.peers.size === 0) {
            box.hidden = true;
            this._status(this.state.isHost ? 'WAITING FOR A FRIEND TO JOIN…' : 'CONNECTING TO THE HOST…');
            return;
        }
        this._status(this.state.isHost ? 'READY — START WHEN YOU ARE' : 'READY — WAITING FOR THE HOST TO START');
        box.hidden = false;
        const row = (name, role, host) => {
            const li = document.createElement('li');
            if (host) li.className = 'host';
            const n = document.createElement('span');
            n.textContent = name;
            const r = document.createElement('small');
            r.textContent = role;
            li.append(n, r);
            return li;
        };
        list.replaceChildren(
            row(`${this.state.localNickname} (YOU)`, this.state.isHost ? 'HOST' : 'GUEST', this.state.isHost),
            ...[...this.state.peers.values()].map(p => row(p.nickname, 'READY', false)),
        );
    }
}
