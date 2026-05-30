/**
 * js/main.js — LUMINARY Bootstrapper
 *
 * Drives top-level system bootstrap and real-time multiplayer connections.
 */

import * as THREE from 'three';
import { PlayerState }  from './entities/PlayerState.js';
import { AudioManager } from './systems/AudioManager.js';
import { UIManager }    from './ui/UIManager.js';
import { InputManager } from './systems/InputManager.js';
import { GameEngine }   from './GameEngine.js';
import { MultiplayerManager } from './systems/MultiplayerManager.js';

// 🌐 Shared math utilities
export const { lerp, clamp } = THREE.MathUtils;

export const expDecay = (k, dt) => 1 - Math.exp(-k * dt);

export const wrapAngle = a => {
    while (a >  Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
};

// Seeded random number generator (mulberry32) for deterministic metropolis sync
export function createPRNG(seedString) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < seedString.length; i++) {
        h = Math.imul(h ^ seedString.charCodeAt(i), 16777619);
    }
    let s = h;
    return function() {
        let t = s + 0x6D2B79F5 | 0;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61) | 0;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

// 🌐 Bootstrap Launcher Loop
window.addEventListener('load', () => {
    const state = new PlayerState();
    const audio = new AudioManager();
    const ui = new UIManager();
    const input = new InputManager(state);
    
    // Create multiplayer manager (uses Three.js scenes)
    // We instantiate a dummy scene first just for tracking P2P connections before launch
    const dummyScene = new THREE.Scene();
    const multiplayer = new MultiplayerManager(state, dummyScene);

    const btnSolo = document.getElementById('start-btn');
    const btnHost = document.getElementById('host-mp-btn');
    const btnCopy = document.getElementById('copy-url-btn');
    const btnLaunchMP = document.getElementById('launch-mp-btn');
    const nickInput = document.getElementById('nickname-input');
    const shareInput = document.getElementById('share-url-input');
    const shareBox = document.getElementById('lobby-share-box');
    const mpDetails = document.getElementById('mp-lobby-details');
    const roomControls = document.getElementById('room-controls-row');

    // Populate nickname from state/localstorage
    nickInput.value = state.localNickname;

    // Save nickname when changed
    nickInput.addEventListener('input', () => {
        let name = nickInput.value.trim().toUpperCase();
        if (!name) name = 'HERO';
        state.localNickname = name;
        localStorage.setItem('luminary_nickname', name);
        
        // Broadcast nickname if room is active
        if (multiplayer.active && multiplayer.sendNickname) {
            multiplayer.sendNickname({ nickname: name });
        }
        
        // Update local lobby visual list
        multiplayer.updateLobbyUI();
    });

    // Check if player is joining via URL parameter ?room=stellar-room-id
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    
    if (roomParam) {
        // Guest Join Route
        console.log(`Entering Join Lobby for room: ${roomParam}`);
        state.isMultiplayer = true;
        state.isHost = false;
        state.roomID = roomParam;
        state.random = createPRNG(roomParam); // Setup deterministic city seed

        // Update Lobby GUI state
        roomControls.style.display = 'none';
        mpDetails.style.display = 'flex';
        
        // Connect to peer signaling network
        multiplayer.connect(roomParam);

        // Guest auto-launches once host sends the launch signal!
        multiplayer.onStartSession = () => {
            const loader = document.getElementById('loader');
            if (loader.style.display !== 'none' && loader.style.opacity !== '0') {
                launchSession(state, audio, ui, input, multiplayer);
            }
        };
    } else {
        // Solo launch button setup
        btnSolo.addEventListener('click', () => {
            // Setup single player seeded generator so it is randomized per load
            state.random = createPRNG(Math.random().toString());
            launchSession(state, audio, ui, input, multiplayer);
        });

        // Host room generation setup
        btnHost.addEventListener('click', () => {
            // Make sure nickname exists
            if (!nickInput.value.trim()) {
                nickInput.value = `PILOT-${Math.floor(100 + Math.random() * 900)}`;
                nickInput.dispatchEvent(new Event('input'));
            }

            const roomID = `stellar-${Math.floor(1000 + Math.random() * 9000)}`;
            console.log(`Generating host room ID: ${roomID}`);
            
            state.isMultiplayer = true;
            state.isHost = true;
            state.roomID = roomID;
            state.random = createPRNG(roomID); // Deterministic seeded city

            // Transition UI
            roomControls.style.display = 'none';
            mpDetails.style.display = 'flex';
            shareBox.style.display = 'flex';
            btnLaunchMP.style.display = 'block';

            // Generate joining link & copy to text box
            const joinURL = `${window.location.origin}${window.location.pathname}?room=${roomID}`;
            shareInput.value = joinURL;

            // Update URL search parameters without reloading
            window.history.pushState({}, '', `?room=${roomID}`);

            // Initialize connection
            multiplayer.connect(roomID);
        });

        // Host Launch Session trigger
        btnLaunchMP.addEventListener('click', () => {
            if (multiplayer.active && multiplayer.sendStart) {
                // Broadcast launch signal to all connected guests
                multiplayer.sendStart({});
            }
            launchSession(state, audio, ui, input, multiplayer);
        });
    }

    // Share link copying setup
    btnCopy.addEventListener('click', () => {
        shareInput.select();
        shareInput.setSelectionRange(0, 99999);
        navigator.clipboard.writeText(shareInput.value);
        btnCopy.textContent = 'COPIED!';
        setTimeout(() => {
            btnCopy.textContent = 'COPY';
        }, 1500);
    });
});

/** Constructs GameEngine, links MultiplayerManager, and starts the render loop */
function launchSession(state, audio, ui, input, multiplayer) {
    // Fade out loader UI card
    const loader = document.getElementById('loader');
    loader.style.opacity = '0';
    setTimeout(() => {
        loader.style.display = 'none';
    }, 600);

    // Reveal standard flying HUDs
    document.getElementById('hud').style.display          = 'flex';
    document.getElementById('mode-badge').style.display   = 'block';
    document.getElementById('instructions').style.display = 'block';

    audio.resume();

    // Core GameEngine instantiation (triggers mesh / world generation)
    const engine = new GameEngine(state, audio, ui, input);

    // If multiplayer is active, hook our Trystero P2P instance directly to GameEngine
    if (state.isMultiplayer) {
        // Point MultiplayerManager to the real WebGL scene constructed by GameEngine
        multiplayer.scene = engine.scene;
        multiplayer.raceManager = engine.race;
        engine.multiplayer = multiplayer;
        
        // Start broadcasting local player position and movements at 30Hz
        multiplayer.startBroadcasting(engine.rig);
    }

    // Hand control to loop
    engine.start();
}
