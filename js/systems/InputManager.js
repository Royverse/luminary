/**
 * js/systems/InputManager.js
 *
 * Handles all user input: keyboard, mouse (+ pointer lock), and
 * mobile joystick / touch-look / action buttons.
 *
 * @ai-context
 *   OWNS      : ALL input event listeners; state.input writes;
 *               state.mouse writes; state.pointerLocked writes.
 *   READS     : state.isStalling (gates mouse during stall).
 *   WRITES    : state.input.{forward,right,up,boost,brake};
 *               state.mouse.{x,y,dx}; state.pointerLocked.
 *   RELATED   : PlayerState.js (field definitions); index.html (mobile DOM IDs).
 *   ASK FOR   : PlayerState.js for field names; index.html if mobile button IDs change.
 *   NOTE      : attachRenderer(domElement) MUST be called by GameEngine after
 *               the canvas is appended to the DOM.
 *
 * Writes exclusively to state.input and state.mouse.
 * Reads state.isStalling to gate mouse steering during a stall.
 */

import { clamp }    from '../main.js';

export class InputManager {
    /**
     * @param {import('../entities/PlayerState.js').PlayerState} state
     */
    constructor(state) {
        this.state = state;
        this._prevX = 0;
        this._prevY = 0;

        this._bindKeyboard();
        this._bindMouse();
        this._bindMobile();
    }

    /**
     * Called by GameEngine once the renderer canvas is in the DOM.
     * @param {HTMLCanvasElement} domElement
     */
    attachRenderer(domElement) {
        this._domElement = domElement;

        domElement.addEventListener('click', () => {
            try {
                const p = domElement.requestPointerLock();
                if (p) p.catch(() => {});
            } catch (_) {}
        });

        document.addEventListener('pointerlockchange', () => {
            this.state.pointerLocked = !!document.pointerLockElement;
        });
    }

    // ── Keyboard ──────────────────────────────────────────────────────

    _bindKeyboard() {
        window.addEventListener('keydown', e => {
            switch (e.code) {
                case 'KeyW':     this.state.input.forward =  1;    break;
                case 'KeyS':     this.state.input.forward = -1;    break;
                case 'KeyA':     this.state.input.right   = -1;    break;
                case 'KeyD':     this.state.input.right   =  1;    break;
                case 'Space':    this.state.input.up      =  1;    break;
                case 'ShiftLeft':this.state.input.up      = -1;    break;
                case 'KeyC':     this.state.input.brake   = true;  break;
                case 'KeyT':     this.state.showWings     = !this.state.showWings; break;
                case 'AltLeft':  case 'AltRight':
                    this.state.freeLook = true;
                    e.preventDefault();
                    break;
            }
        });

        window.addEventListener('keyup', e => {
            switch (e.code) {
                case 'KeyW': case 'KeyS':     this.state.input.forward = 0;     break;
                case 'KeyA': case 'KeyD':     this.state.input.right   = 0;     break;
                case 'Space': case 'ShiftLeft':this.state.input.up     = 0;     break;
                case 'KeyC':                  this.state.input.brake   = false; break;
                case 'AltLeft':  case 'AltRight':
                    this.state.freeLook = false;
                    e.preventDefault();
                    break;
            }
        });
    }

    // ── Mouse ─────────────────────────────────────────────────────────

    _bindMouse() {
        window.addEventListener('mousedown', e => {
            if (e.button === 0) this.state.input.boost = true;
        });
        window.addEventListener('mouseup', e => {
            if (e.button === 0) this.state.input.boost = false;
        });

        window.addEventListener('mousemove', e => {
            const locked = this.state.pointerLocked;
            const dx = locked ? e.movementX : (e.clientX - this._prevX);
            const dy = locked ? e.movementY : (e.clientY - this._prevY);
            this._prevX = e.clientX;
            this._prevY = e.clientY;

            this.state.mouse.dx = dx;

            if (locked && !this.state.isStalling) {
                const sens = 0.0065;
                this.state.mouse.x  = (this.state.mouse.x || 0) - dx * sens;
                this.state.mouse.y  = (this.state.mouse.y || 0) - dy * sens;
                this.state.mouse.y  = clamp(this.state.mouse.y, -Math.PI / 2.05, Math.PI / 2.05);
            }
        });
    }

    // ── Mobile ────────────────────────────────────────────────────────

    _bindMobile() {
        // ── Joystick (left thumb) ─────────────────────────────────────
        const joyZone = document.getElementById('joystick-zone');
        const joyKnob = document.getElementById('joystick-knob');
        const JOY_R   = 65;   // outer radius  (half of 130px)
        const JOY_DZ  = 14;   // dead-zone radius
        let   joyId   = null; // active touch identifier

        joyZone.addEventListener('touchstart', e => {
            e.preventDefault();
            if (joyId !== null) return;
            const t = e.changedTouches[0];
            joyId = t.identifier;
            this._updateJoy(t, joyZone, joyKnob, JOY_R, JOY_DZ);
        }, { passive: false });

        joyZone.addEventListener('touchmove', e => {
            e.preventDefault();
            const t = Array.from(e.changedTouches).find(t => t.identifier === joyId);
            if (t) this._updateJoy(t, joyZone, joyKnob, JOY_R, JOY_DZ);
        }, { passive: false });

        const joyEnd = e => {
            const t = Array.from(e.changedTouches).find(t => t.identifier === joyId);
            if (!t) return;
            joyId = null;
            joyKnob.style.transform = '';
            this.state.input.right   = 0;
            this.state.input.forward = 0;
        };
        joyZone.addEventListener('touchend',    joyEnd);
        joyZone.addEventListener('touchcancel', joyEnd);

        // ── Altitude buttons (right thumb, top cluster) ───────────────
        const upBtn   = document.getElementById('up-btn');
        const downBtn = document.getElementById('down-btn');

        upBtn.addEventListener('touchstart',   e => { e.preventDefault(); this.state.input.up =  1; }, { passive: false });
        upBtn.addEventListener('touchend',     e => { e.preventDefault(); this.state.input.up =  0; }, { passive: false });
        upBtn.addEventListener('touchcancel',  e => { e.preventDefault(); this.state.input.up =  0; }, { passive: false });

        downBtn.addEventListener('touchstart',  e => { e.preventDefault(); this.state.input.up = -1; }, { passive: false });
        downBtn.addEventListener('touchend',    e => { e.preventDefault(); this.state.input.up =  0; }, { passive: false });
        downBtn.addEventListener('touchcancel', e => { e.preventDefault(); this.state.input.up =  0; }, { passive: false });

        // ── Action buttons (bottom row) ───────────────────────────────
        const bindAction = (id, onStart, onEnd) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('touchstart',  e => { e.preventDefault(); onStart(); }, { passive: false });
            el.addEventListener('touchend',    e => { e.preventDefault(); onEnd();   }, { passive: false });
            el.addEventListener('touchcancel', e => { e.preventDefault(); onEnd();   }, { passive: false });
        };

        bindAction('boost-btn',
            () => { this.state.input.boost = true;  },
            () => { this.state.input.boost = false; }
        );
        bindAction('brake-btn',
            () => { this.state.input.brake = true;  },
            () => { this.state.input.brake = false; }
        );

        // Wings toggle (mobile) — keeps in sync with desktop T-key toggle
        const wingsMobBtn    = document.getElementById('wings-mob-btn');
        const gyroIndicator  = document.getElementById('gyro-indicator');

        const syncWingsMob = () => {
            const wings = this.state.showWings;
            wingsMobBtn.textContent = wings ? 'WINGS' : 'CAPE';
            wingsMobBtn.className   = 'mob-btn ' + (wings ? 'wing-active' : 'cape-active');
        };
        syncWingsMob();

        wingsMobBtn.addEventListener('touchstart', e => {
            e.preventDefault();
            this.state.showWings = !this.state.showWings;
            syncWingsMob();
        }, { passive: false });

        // ── Gyroscope steering ────────────────────────────────────────
        this._gyroEnabled = false;
        const gyroBtn = document.getElementById('gyro-btn');

        // Calibration baseline (set when gyro activates)
        let gyroBaseGamma = null;  // side-tilt  → yaw
        let gyroBaseBeta  = null;  // fwd-tilt   → pitch
        const GYRO_YAW_SENS   = 0.025;  // rad per degree
        const GYRO_PITCH_SENS = 0.018;
        const GYRO_CLAMP      = Math.PI / 2.05;

        const onDeviceOrientation = e => {
            if (!this._gyroEnabled || this.state.isStalling) return;

            // Calibrate on first reading after activation
            if (gyroBaseGamma === null) {
                gyroBaseGamma = e.gamma ?? 0;
                gyroBaseBeta  = e.beta  ?? 0;
            }

            const dGamma = (e.gamma ?? 0) - gyroBaseGamma;   // left/right tilt
            const dBeta  = (e.beta  ?? 0) - gyroBaseBeta;    // fwd/back tilt

            // Yaw: tilt phone left/right  (-gamma is natural)
            this.state.mouse.x = -(dGamma * GYRO_YAW_SENS);

            // Pitch: tilt phone fwd/back
            this.state.mouse.y = clamp(dBeta * GYRO_PITCH_SENS, -GYRO_CLAMP, GYRO_CLAMP);
        };

        const enableGyro = async () => {
            // iOS 13+ needs permission
            if (typeof DeviceOrientationEvent !== 'undefined' &&
                typeof DeviceOrientationEvent.requestPermission === 'function') {
                try {
                    const perm = await DeviceOrientationEvent.requestPermission();
                    if (perm !== 'granted') return false;
                } catch { return false; }
            }
            window.addEventListener('deviceorientation', onDeviceOrientation, true);
            return true;
        };

        gyroBtn.addEventListener('touchstart', async e => {
            e.preventDefault();
            if (!this._gyroEnabled) {
                const ok = await enableGyro();
                if (!ok) {
                    gyroBtn.textContent = 'NO GYRO';
                    return;
                }
                this._gyroEnabled = true;
                gyroBaseGamma = null; // re-calibrate on first event
                gyroBaseBeta  = null;
                gyroBtn.className = 'mob-btn gyro-on';
                gyroBtn.textContent = 'GYRO ✓';
                gyroIndicator.classList.add('visible');
            } else {
                this._gyroEnabled = false;
                gyroBtn.className = 'mob-btn gyro-off';
                gyroBtn.textContent = 'GYRO';
                gyroIndicator.classList.remove('visible');
                // Reset steering to neutral so plane doesn't drift
                this.state.mouse.x = 0;
                this.state.mouse.y = 0;
            }
        }, { passive: false });

        // ── Right-side swipe look (fallback when gyro is OFF) ─────────
        // Uses a dedicated single-touch tracker to avoid collisions
        // with the joystick, which lives on the left half of screen.
        let lookId      = null;
        let lookStartX  = 0;
        let lookStartY  = 0;
        const LOOK_SENS = 0.007;

        window.addEventListener('touchstart', e => {
            // Only track a NEW touch that starts on the RIGHT half and
            // is not already captured by joystick zone or action buttons
            for (const t of e.changedTouches) {
                if (t.clientX > window.innerWidth * 0.45 && lookId === null &&
                    !joyZone.contains(e.target) ) {
                    lookId     = t.identifier;
                    lookStartX = t.clientX;
                    lookStartY = t.clientY;
                }
            }
        }, { passive: true });

        window.addEventListener('touchmove', e => {
            if (this._gyroEnabled) return; // gyro takes priority
            const t = Array.from(e.changedTouches).find(t => t.identifier === lookId);
            if (!t || this.state.isStalling) return;

            const dx = t.clientX - lookStartX;
            const dy = t.clientY - lookStartY;
            lookStartX = t.clientX;
            lookStartY = t.clientY;

            this.state.mouse.x  = (this.state.mouse.x  || 0) - dx * LOOK_SENS;
            this.state.mouse.y  = clamp(
                (this.state.mouse.y || 0) - dy * LOOK_SENS,
                -Math.PI / 2.05,
                 Math.PI / 2.05
            );
            this.state.mouse.dx = dx;
        }, { passive: true });

        window.addEventListener('touchend',    e => { for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null; });
        window.addEventListener('touchcancel', e => { for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null; });
    }

    // ── Joystick position helper ──────────────────────────────────────
    _updateJoy(touch, zone, knob, maxR, dz) {
        const rect = zone.getBoundingClientRect();
        const cx = rect.left + rect.width  / 2;
        const cy = rect.top  + rect.height / 2;
        let   dx = touch.clientX - cx;
        let   dy = touch.clientY - cy;
        const d  = Math.sqrt(dx * dx + dy * dy);

        if (d < dz) { dx = 0; dy = 0; }
        else if (d > maxR) { dx = dx / d * maxR; dy = dy / d * maxR; }

        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        this.state.input.right   =  dx / maxR;
        this.state.input.forward = -dy / maxR;
    }
}
