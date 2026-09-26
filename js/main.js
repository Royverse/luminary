/**
 * js/main.js — Title screen, lobby and launch.
 *
 * Solo: pick a random city seed and fly. Multiplayer: the room ID seeds the
 * city so every peer builds the same world; the host starts the race.
 */
import { PlayerState }        from './entities/PlayerState.js';
import { AudioManager }       from './systems/AudioManager.js';
import { UIManager }          from './ui/UIManager.js';
import { InputManager }       from './systems/InputManager.js';
import { GameEngine }         from './GameEngine.js';
import { MultiplayerManager } from './systems/MultiplayerManager.js';
import { createPRNG }         from './core/math.js';

const $ = id => document.getElementById(id);

const state = new PlayerState();
const audio = new AudioManager();
const ui    = new UIManager();
const input = new InputManager(state);
let multiplayer = null;
let launched = false;

// Browsers only allow audio after a user gesture.
for (const type of ['pointerdown', 'keydown', 'touchstart']) addEventListener(type, () => audio.unlock(), { passive: true });

// ── Nickname ─────────────────────────────────────────────────────────
const nick = $('nickname-input');
nick.value = state.localNickname === 'HERO' ? '' : state.localNickname;
nick.addEventListener('input', () => {
    const name = nick.value.trim().toUpperCase().slice(0, 12) || 'HERO';
    state.localNickname = name;
    try { localStorage.setItem('luminary_nickname', name); } catch { /* storage blocked */ }
    multiplayer?.sendNickname(name);
    multiplayer?.renderLobby();
});

// ── Routes ───────────────────────────────────────────────────────────
const room = new URLSearchParams(location.search).get('room');
if (room) {
    openLobby(room, false);
} else {
    $('start-btn').addEventListener('click', () => {
        state.random = createPRNG(String(Math.random()));
        launch();
    });
    $('host-mp-btn').addEventListener('click', hostRoom);
    $('launch-mp-btn').addEventListener('click', () => {
        multiplayer.sendStart();
        launch();
    });
}

$('copy-url-btn').addEventListener('click', async () => {
    const btn = $('copy-url-btn');
    try { await navigator.clipboard.writeText($('share-url-input').value); btn.textContent = 'COPIED'; }
    catch { $('share-url-input').select(); btn.textContent = 'SELECTED'; }
    setTimeout(() => { btn.textContent = 'COPY'; }, 1500);
});

function openLobby(roomID, isHost) {
    Object.assign(state, { isMultiplayer: true, isHost, roomID, random: createPRNG(roomID) });
    $('room-controls-row').hidden = true;
    $('mp-lobby-details').hidden = false;
    multiplayer = new MultiplayerManager(state, ui);
    multiplayer.onStart = launch;
    multiplayer.connect(roomID);
}

function hostRoom() {
    if (!nick.value.trim()) {
        nick.value = `PILOT-${100 + Math.floor(Math.random() * 900)}`;
        nick.dispatchEvent(new Event('input'));
    }
    const roomID = `stellar-${1000 + Math.floor(Math.random() * 9000)}`;
    openLobby(roomID, true);
    $('share-url-input').value = `${location.origin}${location.pathname}?room=${roomID}`;
    $('lobby-share-box').hidden = false;
    $('launch-mp-btn').hidden = false;
    history.replaceState(null, '', `?room=${roomID}`);
}

function launch() {
    if (launched) return;
    launched = true;
    const loader = $('loader');
    loader.style.opacity = '0';
    setTimeout(() => { loader.hidden = true; }, 600);

    audio.unlock();
    ui.show();
    const engine = new GameEngine(state, audio, ui, input);
    multiplayer?.attach(engine);
    engine.start();
    if (new URLSearchParams(location.search).has('debug')) window.luminary = { state, engine };
}
