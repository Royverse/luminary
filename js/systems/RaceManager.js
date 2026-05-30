/**
 * js/systems/RaceManager.js — Race state coordinator, waypoint compass HUD, countdown intro, and victory overlays.
 *
 * @ai-context
 *   OWNS      : Race state (WAITING, COUNTDOWN, RACING, FINISHED); Finish Beacon 3D meshes (pillar, core, rings);
 *               minimalist HTML screen-space countdown overlay and direction HUD arrow/distance element.
 *   READS     : state.isMultiplayer, state.multiplayer, state.simTime, state.velocity, state.localNickname.
 *   WRITES    : state.velocity (frozen to 0 during countdown), state.isJumping (locked during countdown),
 *               rig.player.position (reset to [0,0,0] during countdown).
 *   RELATED   : MultiplayerManager.js (relays finished_race events), GameEngine.js (instantiates and runs update tick).
 *   DESIGN    : Minimalist, glowing cyber-neon typography, additive blending lasers, and a 100% fair relative heading compass.
 */

import * as THREE from 'three';

export class RaceManager {
    /**
     * @param {import('../entities/PlayerState.js').PlayerState} state
     * @param {THREE.Scene} scene
     * @param {import('../entities/CharacterRig.js').CharacterRig} rig
     * @param {import('../ui/UIManager.js').UIManager} ui
     */
    constructor(state, scene, rig, ui) {
        this.state = state;
        this.scene = scene;
        this.rig = rig;
        this.ui = ui;

        // Finish position: opposite corner, high altitude
        this.finishPos = new THREE.Vector3(3000, 380, 3000);
        this.finishRadius = 120;

        this.raceStartTime = 0;
        this.raceState = 'WAITING'; // WAITING, RACING, FINISHED
        this.winnerId = null; // null if you win, peerId if peer wins
        
        this.beaconMesh = null;
        this.ringMesh = null;
        this.arrowIndicator = null;
        
        this._buildFinishBeacon();
        this._buildDirectionHUD();
    }

    _buildFinishBeacon() {
        // Colossal neon pillar extending from ground to sky
        const cylGeom = new THREE.CylinderGeometry(80, 80, 2000, 32, 1, true);
        const cylMat = new THREE.MeshBasicMaterial({
            color: 0xff0055, // Hot neon pink finish beacon
            transparent: true,
            opacity: 0.25,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        
        this.beaconMesh = new THREE.Group();
        const cylinder = new THREE.Mesh(cylGeom, cylMat);
        cylinder.position.y = 1000; // Center of 2000 height
        this.beaconMesh.add(cylinder);

        // Core bright neon laser beam inside the pillar
        const coreGeom = new THREE.CylinderGeometry(8, 8, 2000, 8, 1, true);
        const coreMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.7,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        const core = new THREE.Mesh(coreGeom, coreMat);
        core.position.y = 1000;
        this.beaconMesh.add(core);

        // Rings wrapping the checkpoint
        const ringGeom = new THREE.TorusGeometry(this.finishRadius, 6, 16, 64);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0xff0055,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        this.ringMesh = new THREE.Mesh(ringGeom, ringMat);
        this.ringMesh.rotation.x = Math.PI / 2;
        this.ringMesh.position.y = this.finishPos.y;
        
        this.beaconMesh.position.set(this.finishPos.x, 0, this.finishPos.z);
        this.scene.add(this.beaconMesh);
        this.scene.add(this.ringMesh);
    }

    _buildDirectionHUD() {
        // Floating arrow overlay to guide players
        const arrowBox = document.createElement('div');
        arrowBox.id = 'race-direction-hud';
        arrowBox.style.cssText = `
            position: absolute;
            bottom: 40px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            flex-direction: column;
            align-items: center;
            color: #fff;
            font-family: 'Outfit', sans-serif;
            text-shadow: 0 0 10px rgba(255, 0, 85, 0.8);
            font-weight: 800;
            pointer-events: none;
            z-index: 1000;
        `;
        arrowBox.innerHTML = `
            <div id="race-arrow" style="font-size: 2rem; transform: rotate(0deg); transition: transform 0.1s ease; margin-bottom: 4px;">▲</div>
            <div id="race-distance" style="font-size: 1.2rem; letter-spacing: 2px;">4,500 M</div>
            <div style="font-size: 0.65rem; opacity: 0.7; letter-spacing: 1px; margin-top: 2px;">NEON FINISH BEACON</div>
        `;
        document.body.appendChild(arrowBox);
        this.arrowIndicator = document.getElementById('race-arrow');
    }

    startRace() {
        this.raceState = 'COUNTDOWN';
        this.countdownStart = performance.now();
        this._buildCountdownOverlay();
        console.log('Race countdown started...');
    }

    _buildCountdownOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'race-countdown-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            display: flex;
            justify-content: center;
            align-items: center;
            background: rgba(4, 5, 15, 0.4);
            backdrop-filter: blur(4px);
            z-index: 9998;
            pointer-events: none;
            transition: opacity 0.5s ease;
        `;
        overlay.innerHTML = `
            <div id="countdown-number" style="
                font-size: 8rem;
                font-weight: 200;
                color: #fff;
                font-family: 'Outfit', sans-serif;
                text-shadow: 0 0 40px rgba(255, 0, 85, 0.8);
                transform: scale(0.8);
                opacity: 0;
                transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.2s ease;
            ">READY</div>
        `;
        document.body.appendChild(overlay);
        this.countdownEl = document.getElementById('countdown-number');
        this.countdownOverlay = overlay;
        this.lastCountVal = -1;
    }

    update(dt, camera) {
        if (!this.rig.player) return;
        
        const playerPos = this.rig.player.position;
        const dist = playerPos.distanceTo(this.finishPos);

        // Handle Countdown Sequence
        if (this.raceState === 'COUNTDOWN') {
            // Freeze player position and velocity during countdown
            this.rig.player.position.set(0, 0, 0);
            this.state.velocity.set(0, 0, 0);
            this.state.isJumping = false;
            
            const elapsed = (performance.now() - this.countdownStart) / 1000;
            let currentVal = 'READY';
            let color = '#fff';
            let glow = 'rgba(255, 0, 85, 0.8)';
            
            if (elapsed < 1.0) {
                currentVal = 'READY';
            } else if (elapsed < 2.0) {
                currentVal = '3';
                color = '#00f0ff'; // Neon blue
                glow = 'rgba(0, 240, 255, 0.8)';
            } else if (elapsed < 3.0) {
                currentVal = '2';
                color = '#ffaa00'; // Gold
                glow = 'rgba(255, 170, 0, 0.8)';
            } else if (elapsed < 4.0) {
                currentVal = '1';
                color = '#ff0055'; // Pink
                glow = 'rgba(255, 0, 85, 0.8)';
            } else if (elapsed < 5.0) {
                currentVal = 'GO!';
                color = '#00ff66'; // Neon green
                glow = 'rgba(0, 255, 102, 0.8)';
            } else {
                // Countdown complete! Start the race
                this.raceState = 'RACING';
                this.raceStartTime = performance.now();
                if (this.countdownOverlay) {
                    this.countdownOverlay.style.opacity = '0';
                    setTimeout(() => this.countdownOverlay.remove(), 500);
                }
                return;
            }

            if (this.countdownEl && currentVal !== this.lastCountVal) {
                this.lastCountVal = currentVal;
                this.countdownEl.style.opacity = '0';
                this.countdownEl.style.transform = 'scale(0.5)';
                
                setTimeout(() => {
                    this.countdownEl.textContent = currentVal;
                    this.countdownEl.style.color = color;
                    this.countdownEl.style.textShadow = `0 0 40px ${glow}`;
                    this.countdownEl.style.opacity = '1';
                    this.countdownEl.style.transform = 'scale(1.2)';
                }, 50);
            }
        }

        // Spin the rings at the checkpoint
        if (this.ringMesh) {
            this.ringMesh.rotation.z += dt * 0.8;
            this.ringMesh.position.y = this.finishPos.y + Math.sin(this.state.simTime * 3) * 6;
        }

        // Update direction HUD
        if (this.arrowIndicator) {
            // Translate beacon position into the player's local reference frame
            const localTarget = this.finishPos.clone().sub(playerPos);
            localTarget.applyQuaternion(this.rig.player.quaternion.clone().invert());
            
            // Compute yaw relative heading:
            // localTarget.x is horizontal offset (- left, + right)
            // -localTarget.z is forward distance (+ forward, - backward)
            const deg = Math.atan2(localTarget.x, -localTarget.z) * (180 / Math.PI);

            this.arrowIndicator.style.transform = `rotate(${deg}deg)`;
            
            const distText = document.getElementById('race-distance');
            if (distText) {
                distText.textContent = `${Math.round(dist)} M`;
            }
        }

        // Win detection
        if (this.raceState === 'RACING') {
            if (dist < this.finishRadius + 20) {
                this.raceState = 'FINISHED';
                const timeTaken = ((performance.now() - this.raceStartTime) / 1000).toFixed(2);
                
                // Trigger local victory if no one has finished yet
                if (!this.winnerId) {
                    this.showVictoryScreen(timeTaken);
                    
                    // Broadcast finish event if multiplayer
                    if (this.state.isMultiplayer && this.state.multiplayer) {
                        this.state.multiplayer.sendRaceFinish(timeTaken);
                    }
                }
            }
        }
    }

    showVictoryScreen(timeTaken) {
        this.raceState = 'FINISHED';
        
        const overlay = document.createElement('div');
        overlay.id = 'race-result-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(4, 5, 15, 0.85);
            backdrop-filter: blur(15px);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            color: #fff;
            font-family: 'Outfit', sans-serif;
            z-index: 9999;
            opacity: 0;
            transition: opacity 0.8s ease;
        `;
        overlay.innerHTML = `
            <h1 style="font-size: 5rem; margin: 0; background: linear-gradient(45deg, #00f0ff, #ff0055); -webkit-background-clip: text; -webkit-text-fill-color: transparent; text-shadow: 0 0 50px rgba(0, 240, 255, 0.4); letter-spacing: 4px; font-weight: 900;">VICTORY</h1>
            <p style="font-size: 1.5rem; letter-spacing: 2px; margin-top: 10px; opacity: 0.9;">YOU REACHED THE BEACON FIRST!</p>
            <p style="font-size: 2rem; color: #00f0ff; font-weight: 700; margin-top: 20px;">TIME: ${timeTaken}s</p>
            <button onclick="window.location.reload()" style="margin-top: 40px; padding: 12px 30px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #fff; border-radius: 8px; font-family: inherit; font-size: 1rem; cursor: pointer; backdrop-filter: blur(5px); letter-spacing: 1px; transition: all 0.3s;">PLAY AGAIN</button>
        `;
        document.body.appendChild(overlay);
        
        // Trigger fade in
        setTimeout(() => overlay.style.opacity = '1', 50);
        
        // Unlock pointer
        document.exitPointerLock();
    }

    showDefeatScreen(peerName, timeTaken) {
        this.raceState = 'FINISHED';
        this.winnerId = 'PEER';
        
        const overlay = document.createElement('div');
        overlay.id = 'race-result-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(4, 5, 15, 0.85);
            backdrop-filter: blur(15px);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            color: #fff;
            font-family: 'Outfit', sans-serif;
            z-index: 9999;
            opacity: 0;
            transition: opacity 0.8s ease;
        `;
        overlay.innerHTML = `
            <h1 style="font-size: 5rem; margin: 0; background: linear-gradient(45deg, #ff0055, #880022); -webkit-background-clip: text; -webkit-text-fill-color: transparent; text-shadow: 0 0 50px rgba(255, 0, 85, 0.4); letter-spacing: 4px; font-weight: 900;">DEFEAT</h1>
            <p style="font-size: 1.5rem; letter-spacing: 2px; margin-top: 10px; opacity: 0.9;">${peerName} REACHED THE BEACON FIRST!</p>
            <p style="font-size: 2rem; color: #ff0055; font-weight: 700; margin-top: 20px;">WINNING TIME: ${timeTaken}s</p>
            <button onclick="window.location.reload()" style="margin-top: 40px; padding: 12px 30px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #fff; border-radius: 8px; font-family: inherit; font-size: 1rem; cursor: pointer; backdrop-filter: blur(5px); letter-spacing: 1px; transition: all 0.3s;">PLAY AGAIN</button>
        `;
        document.body.appendChild(overlay);
        
        // Trigger fade in
        setTimeout(() => overlay.style.opacity = '1', 50);
        
        document.exitPointerLock();
    }

    
    showToast(msg) {
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            top: 20%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(255, 0, 85, 0.2);
            border: 1px solid #ff0055;
            box-shadow: 0 0 20px rgba(255, 0, 85, 0.4);
            padding: 15px 35px;
            color: #fff;
            font-family: 'Outfit', sans-serif;
            font-size: 1.5rem;
            font-weight: 800;
            letter-spacing: 2px;
            border-radius: 8px;
            z-index: 10000;
            pointer-events: none;
            backdrop-filter: blur(10px);
            opacity: 0;
            transition: opacity 0.5s ease, transform 0.5s ease;
        `;
        toast.textContent = msg;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translate(-50%, -50%) scale(1.1)';
        }, 50);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translate(-50%, -50%) scale(0.9)';
            setTimeout(() => toast.remove(), 500);
        }, 3000);
    }

    destroy() {
        if (this.beaconMesh) this.scene.remove(this.beaconMesh);
        if (this.ringMesh) this.scene.remove(this.ringMesh);
        const hud = document.getElementById('race-direction-hud');
        if (hud) hud.remove();
        const overlay = document.getElementById('race-result-overlay');
        if (overlay) overlay.remove();
    }
}
