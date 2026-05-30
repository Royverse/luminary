/**
 * js/systems/MultiplayerManager.js — P2P WebRTC networking, remote peer sync, lag interpolation, and peer trail rendering.
 *
 * @ai-context
 *   OWNS      : WebRTC room connection; network state broadcasting at 30Hz; Trystero action handlers (state, nickname, start, race_finish);
 *               remote peer interpolation vectors; PeerTrail instances; floating player nickname plates and overhead 3D cone markers.
 *   READS     : state.roomID, state.isMultiplayer, state.localNickname, state.peers, state.velocity.
 *   WRITES    : state.peers (map structure populated with remote coordinates and visual rigs).
 *   RELATED   : CharacterRig.js (spawns duplicated models for peers), AnimationPose.js (runs remote limb kinematics), GameEngine.js (drives tick update).
 *   DESIGN    : Serverless, peer-to-peer over Nostr relays, hot neon pink trailing effects, and lag-free expDecay gliding.
 */

import * as THREE from 'three';
import { joinRoom } from 'trystero';
import { expDecay } from '../main.js';
import { updateCharacterPose } from './AnimationPose.js';
import { CharacterRig } from '../entities/CharacterRig.js';

class PeerTrail {
    constructor(scene, rig) {
        this.scene = scene;
        this.rig = rig;
        this.positions = [];
        this.maxLen = 40;
        
        const segs = this.maxLen;
        const verts = new Float32Array(segs * 6 * 3);
        this.geom = new THREE.BufferGeometry();
        this.geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        
        // Beautiful hot neon pink trail for opponents, contrasts with player's cyan trail!
        this.mat = new THREE.MeshBasicMaterial({
            color: 0xff0055,
            transparent: true,
            opacity: 0,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        this.mesh = new THREE.Mesh(this.geom, this.mat);
        this.mesh.frustumCulled = false;
        this.scene.add(this.mesh);
        
        for (let i = 0; i < segs; i++) {
            this.positions.push(new THREE.Vector3());
        }
    }

    update(dt, isSupersonic, velocityLength) {
        const playerMesh = this.rig.player;
        if (!playerMesh) return;

        const p = playerMesh.position;
        this.positions.unshift(p.clone());
        if (this.positions.length > this.maxLen) this.positions.pop();

        // Exp Decay smoothing for opacity
        const tgtOp = isSupersonic ? Math.min(velocityLength / 200, 0.6) : 0;
        this.mat.opacity += (tgtOp - this.mat.opacity) * (1 - Math.exp(-9 * dt));
        if (!isSupersonic && this.mat.opacity < 0.01) return;

        const pos = this.geom.attributes.position.array;
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(playerMesh.quaternion);
        for (let i = 0; i < this.positions.length - 1; i++) {
            const a = this.positions[i], b = this.positions[i+1];
            const hw = 0.6 * (1 - i / this.positions.length);
            const base = i * 18;
            pos[base+0]=a.x-right.x*hw; pos[base+1]=a.y-right.y*hw; pos[base+2]=a.z-right.z*hw;
            pos[base+3]=a.x+right.x*hw; pos[base+4]=a.y+right.y*hw; pos[base+5]=a.z+right.z*hw;
            pos[base+6]=b.x-right.x*hw; pos[base+7]=b.y-right.y*hw; pos[base+8]=b.z-right.z*hw;
            pos[base+9]=a.x+right.x*hw; pos[base+10]=a.y+right.y*hw; pos[base+11]=a.z+right.z*hw;
            pos[base+12]=b.x+right.x*hw; pos[base+13]=b.y+right.y*hw; pos[base+14]=b.z+right.z*hw;
            pos[base+15]=b.x-right.x*hw; pos[base+16]=b.y-right.y*hw; pos[base+17]=b.z-right.z*hw;
        }
        this.geom.attributes.position.needsUpdate = true;
    }

    destroy() {
        this.scene.remove(this.mesh);
        this.geom.dispose();
        this.mat.dispose();
    }
}


export class MultiplayerManager {
    /**
     * @param {import('../entities/PlayerState.js').PlayerState} state
     * @param {THREE.Scene} scene
     */
    constructor(state, scene) {
        this.state = state;
        this.scene = scene;
        this.room = null;
        
        // Action senders / receivers
        this.sendState = null;
        this.sendNickname = null;
        this.sendStart = null;
        this.sendRaceFinishAction = null;
        this.raceManager = null;
        
        this.networkInterval = null;
        this.active = false;
        
        // Callback to launch game on guest when host starts
        this.onStartSession = null;
        
        this.roomConfig = {
            appId: 'luminary-flight-engine-p2p'
        };
    }

    /**
     * Initializes the connection using Trystero Nostr strategy
     * @param {string} roomID
     */
    connect(roomID) {
        if (this.room) return;
        
        console.log(`Connecting to room: ${roomID}...`);
        this.state.roomID = roomID;
        this.state.isMultiplayer = true;

        try {
            this.room = joinRoom(this.roomConfig, roomID);
            this.active = true;

            // Setup real-time state sync actions
            const [sendState, getState] = this.room.makeAction('state');
            const [sendNickname, getNickname] = this.room.makeAction('nickname');
            const [sendStart, getStart] = this.room.makeAction('start');
            const [sendRaceFinishAction, getRaceFinish] = this.room.makeAction('race_finish');
            this.sendRaceFinishAction = sendRaceFinishAction;
            
            this.sendState = sendState;
            this.sendNickname = sendNickname;
            this.sendStart = sendStart;

            // Host signal receiver for guest launching
            getStart(() => {
                console.log('Received session start signal from host!');
                if (this.onStartSession) {
                    this.onStartSession();
                }
            });

            getRaceFinish((data, peerId) => {
                const peer = this.state.peers.get(peerId);
                const peerName = peer ? peer.nickname : 'OPPONENT';
                console.log(`Received race finish from peer ${peerName} in ${data.timeTaken}s`);
                if (this.raceManager) {
                    this.raceManager.showDefeatScreen(peerName, data.timeTaken);
                }
            });

            // Peer join handler
            this.room.onPeerJoin(peerId => {
                // If local player has already launched, tell the new peer to start!
                const loader = document.getElementById('loader');
                if (loader && loader.style.display === 'none') {
                    if (this.sendStart) {
                        this.sendStart({}, peerId);
                    }
                }

                console.log(`Peer connected: ${peerId}`);
                
                // Add peer placeholder to player state
                this.state.peers.set(peerId, {
                    nickname: 'PLAYER',
                    rig: null,
                    arrowMesh: null,
                    tagEl: null,
                    lastUpdate: performance.now(),
                    targetPos: new THREE.Vector3(),
                    targetVel: new THREE.Vector3(),
                    targetRot: [0, 0, 0], // pitch, yaw, roll
                    targetState: 0, // IDLE
                    targetWings: true,
                    targetBoost: 0,
                    // Simple local state mimic for pose solver
                    peerState: {
                        STATES: this.state.STATES,
                        currentState: 0,
                        velocity: new THREE.Vector3(),
                        input: { brake: false, boost: false },
                        walkT: 0,
                        isJumping: false,
                        isSprinting: false,
                        isStalling: false,
                        currentPitch: 0,
                        currentYaw: 0,
                        turnBank: 0,
                        simTime: 0
                    }
                });

                // Instantly share nickname with the newly joined peer
                this.sendNickname({ nickname: this.state.localNickname });
                this.updateLobbyUI();
            });

            // Peer leave handler
            this.room.onPeerLeave(peerId => {
                console.log(`Peer disconnected: ${peerId}`);
                this.removePeer(peerId);
                this.updateLobbyUI();
            });

            // Handle incoming nicknames
            getNickname((data, peerId) => {
                const peer = this.state.peers.get(peerId);
                if (peer) {
                    peer.nickname = data.nickname.substring(0, 12).toUpperCase();
                    console.log(`Peer ${peerId} set nickname: ${peer.nickname}`);
                    this.updateLobbyUI();
                }
            });

            // Handle incoming player states
            getState((data, peerId) => {
                const peer = this.state.peers.get(peerId);
                if (peer) {
                    peer.targetPos.set(data.pos[0], data.pos[1], data.pos[2]);
                    peer.targetVel.set(data.vel[0], data.vel[1], data.vel[2]);
                    peer.targetRot = data.rot;
                    peer.targetState = data.state;
                    peer.targetWings = data.wings;
                    peer.targetBoost = data.boost;
                    peer.lastUpdate = performance.now();
                }
            });

            // Broadcast nickname to anyone already in the room
            setTimeout(() => {
                this.sendNickname({ nickname: this.state.localNickname });
            }, 1000);

            this.updateLobbyUI();

        } catch (err) {
            console.error('Failed to initialize WebRTC room via Trystero:', err);
        }
    }

    /** Start real-time movement broadcasting (run at 30Hz) */
    startBroadcasting(localRig) {
        if (!this.active || !this.sendState) return;

        console.log('Starting real-time 30Hz network loop...');
        
        // Clear any old broadcast timer
        if (this.networkInterval) clearInterval(this.networkInterval);

        this.localRig = localRig;
        
        // Add local player tag & arrow
        if (!this.localTagEl) {
            this.localTagEl = document.createElement('div');
            this.localTagEl.className = 'player-tag';
            this.localTagEl.innerHTML = `<span class="player-tag-name" style="color:#00f0ff">${this.state.localNickname}</span><span class="player-tag-stat" id="tag-spd-local">0 KM/H</span>`;
            document.body.appendChild(this.localTagEl);

            const arrowGeom = new THREE.ConeGeometry(0.32, 0.75, 4);
            arrowGeom.rotateX(Math.PI);
            const arrowMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, wireframe: false, transparent: true, opacity: 0.85 });
            this.localArrowMesh = new THREE.Mesh(arrowGeom, arrowMat);
            this.scene.add(this.localArrowMesh);
        }

        this.networkInterval = setInterval(() => {
            if (!localRig || !localRig.player) return;
            
            const p = localRig.player.position;
            const v = this.state.velocity;
            
            this.sendState({
                pos: [p.x, p.y, p.z],
                vel: [v.x, v.y, v.z],
                rot: [this.state.currentPitch, this.state.currentYaw, this.state.rollAngle],
                state: this.state.currentState,
                wings: this.state.showWings,
                boost: this.state.boostWindup
            });
        }, 33.3); // ~30Hz
    }

    /**
     * Frame-by-frame updates (called inside the main WebGL render loop)
     * Performs interpolation, runs remote kinematics solvers, and positions overhead HTML name plates and 3D arrows.
     */
    update(dt) {
        if (!this.active) return;

        const now = performance.now();
        const screenWidthHalf = window.innerWidth / 2;
        const screenHeightHalf = window.innerHeight / 2;
        const camera = this.scene.getObjectByProperty('type', 'PerspectiveCamera');

        for (const [peerId, peer] of this.state.peers.entries()) {
            
            // 1. Spawning of Rig, Arrow, and Screen Tag if missing
            if (!peer.rig) {
                console.log(`Spawning visual avatar for peer: ${peer.nickname}`);
                
                // Construct standard CharacterRig mesh
                peer.rig = new CharacterRig(this.scene, peer.peerState);
                peer.trail = new PeerTrail(this.scene, peer.rig);
                
                // Create glowing overhead 3D marker (arrow)
                const arrowGeom = new THREE.ConeGeometry(0.32, 0.75, 4);
                arrowGeom.rotateX(Math.PI); // Point downwards
                const arrowMat = new THREE.MeshBasicMaterial({
                    color: 0x00f0ff,
                    wireframe: false,
                    transparent: true,
                    opacity: 0.85
                });
                peer.arrowMesh = new THREE.Mesh(arrowGeom, arrowMat);
                this.scene.add(peer.arrowMesh);

                // Create screen-space HTML tag
                peer.tagEl = document.createElement('div');
                peer.tagEl.className = 'player-tag';
                peer.tagEl.innerHTML = `<span class="player-tag-name">${peer.nickname}</span><span class="player-tag-stat" id="tag-spd-${peerId}">0 KM/H</span>`;
                document.body.appendChild(peer.tagEl);
            }

            // Sync visual configs
            peer.rig.showWings = peer.targetWings;

            // Update Peer Trail
            if (peer.trail) {
                const S = this.state.STATES;
                const isSupersonic = peer.targetState === S.SUPERSONIC || peer.targetState === S.POWERDIVE;
                peer.trail.update(dt, isSupersonic, peer.targetVel.length());
            }

            // 2. Linear Position & Rotation Interpolation (expDecay)
            const playerMesh = peer.rig.player;
            if (playerMesh) {
                // Smooth position slide
                playerMesh.position.x += (peer.targetPos.x - playerMesh.position.x) * expDecay(12, dt);
                playerMesh.position.y += (peer.targetPos.y - playerMesh.position.y) * expDecay(12, dt);
                playerMesh.position.z += (peer.targetPos.z - playerMesh.position.z) * expDecay(12, dt);

                // Smooth rotation bank
                const [pitch, yaw, roll] = peer.targetRot;
                peer.rig.bodyPivot.rotation.z += (roll - peer.rig.bodyPivot.rotation.z) * expDecay(12, dt);

                // Rotate the root towards movement pitch/yaw
                playerMesh.rotation.y += (yaw - playerMesh.rotation.y) * expDecay(12, dt);
                playerMesh.rotation.x += (pitch - playerMesh.rotation.x) * expDecay(12, dt);
            }

            // 3. Floating 3D Arrow Mesh Animation
            if (peer.arrowMesh && playerMesh) {
                // Follow remote player position with vertical hover offset
                peer.arrowMesh.position.copy(playerMesh.position);
                peer.arrowMesh.position.y += 2.6 + Math.sin(this.state.simTime * 4.5) * 0.12;
                
                // Slow rotation bobbing
                peer.arrowMesh.rotation.y += dt * 1.8;
            }

            // 4. Kinematics solver updates (runs remote Verlet cape and poses locally)
            const ps = peer.peerState;
            ps.currentState = peer.targetState;
            ps.velocity.copy(peer.targetVel);
            ps.input.boost = peer.targetBoost > 0.4;
            ps.input.brake = false;
            ps.currentPitch = peer.targetRot[0];
            ps.currentYaw = peer.targetRot[1];
            ps.simTime = this.state.simTime;
            
            // Drive character limbs and flowing cape solver!
            updateCharacterPose(dt, this.state.simTime, ps, peer.rig);

            // 5. Floating Screen-Space HTML Tag position mapping
            if (peer.tagEl && camera && playerMesh) {
                // Project 3D coordinate of name plate to 2D screen space
                const pos3D = new THREE.Vector3().copy(playerMesh.position);
                pos3D.y += 3.2; // Hover above the arrow
                
                pos3D.project(camera);
                
                // Check if the remote player is behind the camera frustum
                if (pos3D.z > 1) {
                    peer.tagEl.style.display = 'none';
                } else {
                    peer.tagEl.style.display = 'block';
                    
                    const screenX = (pos3D.x * screenWidthHalf) + screenWidthHalf;
                    const screenY = -(pos3D.y * screenHeightHalf) + screenHeightHalf;
                    
                    peer.tagEl.style.left = `${screenX}px`;
                    peer.tagEl.style.top = `${screenY}px`;
                    
                    // Update speed display in tag
                    const spdKmh = Math.round(peer.targetVel.length() * 3.6);
                    const tagSpd = document.getElementById(`tag-spd-${peerId}`);
                    if (tagSpd) tagSpd.textContent = `${spdKmh} KM/H`;
                }
            }
        }

        // Update local tag position if it exists
        if (this.localRig && this.localRig.player && this.localArrowMesh && this.localTagEl && camera) {
            const playerMesh = this.localRig.player;
            this.localArrowMesh.position.copy(playerMesh.position);
            this.localArrowMesh.position.y += 2.6 + Math.sin(this.state.simTime * 4.5) * 0.12;
            this.localArrowMesh.rotation.y += dt * 1.8;

            const pos3D = new THREE.Vector3().copy(playerMesh.position);
            pos3D.y += 3.2;
            pos3D.project(camera);
            
            if (pos3D.z > 1) {
                this.localTagEl.style.display = 'none';
            } else {
                this.localTagEl.style.display = 'block';
                const screenX = (pos3D.x * screenWidthHalf) + screenWidthHalf;
                const screenY = -(pos3D.y * screenHeightHalf) + screenHeightHalf;
                this.localTagEl.style.left = `${screenX}px`;
                this.localTagEl.style.top = `${screenY}px`;
                const spdKmh = Math.round(this.state.velocity.length() * 3.6);
                const tagSpd = document.getElementById(`tag-spd-local`);
                if (tagSpd) tagSpd.textContent = `${spdKmh} KM/H`;
            }
        }

        // 6. Update local HUD Players List Panel
        this.updateHUDPlayersPanel();
    }

    /** Destroys a remote peer's mesh assets and UI overlays */
    removePeer(peerId) {
        const peer = this.state.peers.get(peerId);
        if (peer) {
            // Clean up 3D meshes
            if (peer.rig) {
                this.scene.remove(peer.rig.player);
                if (peer.rig.cape) this.scene.remove(peer.rig.cape);
            }
            if (peer.trail) {
                peer.trail.destroy();
            }
            if (peer.arrowMesh) {
                this.scene.remove(peer.arrowMesh);
            }
            // Clean up DOM tag
            if (peer.tagEl && peer.tagEl.parentNode) {
                peer.tagEl.parentNode.removeChild(peer.tagEl);
            }
            this.state.peers.delete(peerId);
        }
    }

    /** Refresh the glassmorphic connected players HUD panel */
    updateHUDPlayersPanel() {
        const panel = document.getElementById('ui-players-panel');
        const listContainer = document.getElementById('ui-players-list');
        
        if (!panel || !listContainer) return;
        
        if (this.state.peers.size === 0) {
            panel.style.display = 'none';
            return;
        }

        panel.style.display = 'block';
        
        let html = `<div style="display:flex; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:4px; margin-bottom:4px;">
            <span>${this.state.localNickname} (YOU)</span>
            <span style="color:var(--primary)">${Math.round(this.state.velocity.length() * 3.6)} KM/H</span>
        </div>`;

        for (const [peerId, peer] of this.state.peers.entries()) {
            const spd = Math.round(peer.targetVel.length() * 3.6);
            html += `<div style="display:flex; justify-content:space-between;">
                <span>${peer.nickname}</span>
                <span style="color:var(--primary)">${spd} KM/H</span>
            </div>`;
        }

        listContainer.innerHTML = html;
    }

    /** Render the players list inside the launcher lobby card */
    updateLobbyUI() {
        const playersBox = document.getElementById('lobby-players-box');
        const statusText = document.getElementById('lobby-status-text');
        const listEl = document.getElementById('lobby-player-list');
        if (!playersBox || !listEl) return;

        if (this.state.peers.size === 0) {
            playersBox.style.display = 'none';
            if (this.state.isHost) {
                statusText.textContent = 'WAITING FOR FRIENDS TO JOIN...';
            } else {
                statusText.textContent = 'CONNECTING TO HOST LOBBY...';
            }
            return;
        }

        statusText.textContent = 'LOBBY SYNCED & READY!';
        playersBox.style.display = 'block';
        
        let listHTML = `<li class="${this.state.isHost ? 'host' : ''}">
            <span>${this.state.localNickname} (YOU)</span>
            <span style="font-size:0.5rem; opacity:0.6">${this.state.isHost ? 'HOST' : 'CLIENT'}</span>
        </li>`;

        for (const [peerId, peer] of this.state.peers.entries()) {
            listHTML += `<li>
                <span>${peer.nickname}</span>
                <span style="font-size:0.5rem; opacity:0.6">READY</span>
            </li>`;
        }

        listEl.innerHTML = listHTML;
    }

    /** Fully closes all sockets, loops, and cleans up peers */
    
    sendRaceFinish(timeTaken) {
        if (this.active && this.sendRaceFinishAction) {
            this.sendRaceFinishAction({ timeTaken });
        }
    }

    disconnect() {
        this.active = false;
        if (this.networkInterval) {
            clearInterval(this.networkInterval);
            this.networkInterval = null;
        }
        
        // Clean up all peers
        const peerIds = Array.from(this.state.peers.keys());
        peerIds.forEach(id => this.removePeer(id));
        
        if (this.room) {
            this.room.leave();
            this.room = null;
        }
        
        this.state.isMultiplayer = false;
        console.log('Successfully disconnected from multiplayer session.');
    }
}
