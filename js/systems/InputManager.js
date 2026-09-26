/**
 * js/systems/InputManager.js — Keyboard, mouse (pointer lock) and touch.
 *
 * @ai-context
 *   WRITES : state.input.{forward,right,up,jump,boost,brake}; state.currentYaw/currentPitch;
 *            state.pointerLocked; state.showWings; state.freeLook; state.showHelp.
 *   NOTE   : attachRenderer(canvas) must be called once the canvas exists.
 */
import { clamp } from '../core/math.js';

const PITCH_LIMIT = Math.PI / 2.05;
const MOUSE_SENS = 0.0065;
const TOUCH_SENS = 0.007;

export class InputManager {
    constructor(state) {
        this.state = state;
        this._bindKeyboard();
        this._bindMouse();
        this._bindTouch();
    }

    attachRenderer(canvas) {
        canvas.addEventListener('click', () => {
            if (this.state.pointerLocked || matchMedia('(pointer: coarse)').matches) return;
            try { canvas.requestPointerLock()?.catch?.(() => {}); } catch { /* unsupported */ }
        });
        document.addEventListener('pointerlockchange', () => {
            this.state.pointerLocked = !!document.pointerLockElement;
            if (!this.state.pointerLocked) this.state.input.boost = false;
        });
    }

    _look(dx, dy, sens) {
        const s = this.state;
        s.currentYaw -= dx * sens;
        s.currentPitch = clamp(s.currentPitch - dy * sens, -PITCH_LIMIT, PITCH_LIMIT);
    }

    _release() {
        Object.assign(this.state.input, { forward: 0, right: 0, up: 0, boost: false, brake: false });
        this.state.freeLook = false;
    }

    // ── Keyboard ──────────────────────────────────────────────────────
    _bindKeyboard() {
        const inp = this.state.input;
        const typing = e => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
        addEventListener('keydown', e => {
            if (typing(e)) return;
            switch (e.code) {
                case 'KeyW': case 'ArrowUp':    inp.forward = 1;  break;
                case 'KeyS': case 'ArrowDown':  inp.forward = -1; break;
                case 'KeyA': case 'ArrowLeft':  inp.right = -1;   break;
                case 'KeyD': case 'ArrowRight': inp.right = 1;    break;
                case 'Space':                   inp.up = 1; if (!e.repeat) inp.jump = true; e.preventDefault(); break;
                case 'ShiftLeft': case 'ShiftRight': inp.up = -1; break;
                case 'KeyC':                    inp.brake = true; break;
                case 'KeyT': if (!e.repeat) this.state.showWings = !this.state.showWings; break;
                case 'KeyH': if (!e.repeat) this.state.showHelp = !this.state.showHelp; break;
                case 'AltLeft': case 'AltRight': this.state.freeLook = true; e.preventDefault(); break;
            }
        });
        addEventListener('keyup', e => {
            switch (e.code) {
                case 'KeyW': case 'ArrowUp': case 'KeyS': case 'ArrowDown':      inp.forward = 0; break;
                case 'KeyA': case 'ArrowLeft': case 'KeyD': case 'ArrowRight':   inp.right = 0;   break;
                case 'Space': case 'ShiftLeft': case 'ShiftRight':               inp.up = 0;      break;
                case 'KeyC':                                                     inp.brake = false; break;
                case 'AltLeft': case 'AltRight': this.state.freeLook = false; e.preventDefault(); break;
            }
        });
        // Keys held while the window loses focus would otherwise stay stuck
        addEventListener('blur', () => this._release());
    }

    // ── Mouse ─────────────────────────────────────────────────────────
    _bindMouse() {
        // Boost only once the pointer is captured, so the capture click doesn't fire it
        addEventListener('mousedown', e => { if (e.button === 0 && this.state.pointerLocked) this.state.input.boost = true; });
        addEventListener('mouseup',   e => { if (e.button === 0) this.state.input.boost = false; });
        addEventListener('mousemove', e => { if (this.state.pointerLocked) this._look(e.movementX, e.movementY, MOUSE_SENS); });
    }

    // ── Touch: joystick (left), swipe-look (right), buttons, optional gyro ──
    _bindTouch() {
        const $ = id => document.getElementById(id);
        const s = this.state, inp = s.input;
        const zone = $('joystick-zone'), knob = $('joystick-knob');
        if (!zone) return;

        const JOY_R = 65, JOY_DEAD = 14;
        let joyId = null;
        const joyMove = t => {
            const r = zone.getBoundingClientRect();
            let dx = t.clientX - (r.left + r.width / 2), dy = t.clientY - (r.top + r.height / 2);
            const d = Math.hypot(dx, dy);
            if (d < JOY_DEAD) { dx = 0; dy = 0; }
            else if (d > JOY_R) { dx *= JOY_R / d; dy *= JOY_R / d; }
            knob.style.transform = `translate(${dx}px, ${dy}px)`;
            inp.right = dx / JOY_R;
            inp.forward = -dy / JOY_R;
        };
        const findTouch = (e, id) => Array.from(e.changedTouches).find(t => t.identifier === id);
        zone.addEventListener('touchstart', e => {
            e.preventDefault();
            if (joyId !== null) return;
            joyId = e.changedTouches[0].identifier;
            joyMove(e.changedTouches[0]);
        }, { passive: false });
        zone.addEventListener('touchmove', e => {
            e.preventDefault();
            const t = findTouch(e, joyId);
            if (t) joyMove(t);
        }, { passive: false });
        const joyEnd = e => {
            if (!findTouch(e, joyId)) return;
            joyId = null;
            knob.style.transform = '';
            inp.right = inp.forward = 0;
        };
        zone.addEventListener('touchend', joyEnd);
        zone.addEventListener('touchcancel', joyEnd);

        const hold = (id, down, up) => {
            const el = $(id);
            if (!el) return;
            el.addEventListener('touchstart', e => { e.preventDefault(); down(); }, { passive: false });
            el.addEventListener('touchend', e => { e.preventDefault(); up(); }, { passive: false });
            el.addEventListener('touchcancel', e => { e.preventDefault(); up(); }, { passive: false });
        };
        hold('up-btn',    () => { inp.up = 1; inp.jump = true; }, () => { inp.up = 0; });
        hold('down-btn',  () => { inp.up = -1; },       () => { inp.up = 0; });
        hold('boost-btn', () => { inp.boost = true; },  () => { inp.boost = false; });
        hold('brake-btn', () => { inp.brake = true; },  () => { inp.brake = false; });
        hold('wings-mob-btn', () => { s.showWings = !s.showWings; }, () => {});

        // Swipe-look on the right side of the screen
        let lookId = null, lastX = 0, lastY = 0;
        addEventListener('touchstart', e => {
            for (const t of e.changedTouches) {
                if (lookId === null && t.clientX > innerWidth * 0.45 && !e.target.closest?.('button, #joystick-zone')) {
                    lookId = t.identifier; lastX = t.clientX; lastY = t.clientY;
                }
            }
        }, { passive: true });
        addEventListener('touchmove', e => {
            const t = findTouch(e, lookId);
            if (!t || this._gyro) return;
            this._look(t.clientX - lastX, t.clientY - lastY, TOUCH_SENS);
            lastX = t.clientX; lastY = t.clientY;
        }, { passive: true });
        const lookEnd = e => { if (findTouch(e, lookId)) lookId = null; };
        addEventListener('touchend', lookEnd);
        addEventListener('touchcancel', lookEnd);

        // Gyro steering (tilt the phone), calibrated to how it's held when enabled
        const gyroBtn = $('gyro-btn');
        let base = null;
        const onTilt = e => {
            if (!this._gyro) return;
            if (!base) base = { g: e.gamma ?? 0, b: e.beta ?? 0 };
            s.currentYaw = -((e.gamma ?? 0) - base.g) * 0.025;
            s.currentPitch = clamp(((e.beta ?? 0) - base.b) * 0.018, -PITCH_LIMIT, PITCH_LIMIT);
        };
        gyroBtn?.addEventListener('touchstart', async e => {
            e.preventDefault();
            if (this._gyro) {
                this._gyro = false;
                gyroBtn.className = 'mob-btn gyro-off';
                gyroBtn.textContent = 'GYRO';
                return;
            }
            try {
                if (typeof DeviceOrientationEvent?.requestPermission === 'function' &&
                    await DeviceOrientationEvent.requestPermission() !== 'granted') throw new Error('denied');
            } catch {
                gyroBtn.textContent = 'NO GYRO';
                return;
            }
            addEventListener('deviceorientation', onTilt, true);
            this._gyro = true;
            base = null;
            gyroBtn.className = 'mob-btn gyro-on';
            gyroBtn.textContent = 'GYRO ✓';
        }, { passive: false });
    }
}
