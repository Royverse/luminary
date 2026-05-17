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
        const joyZone = document.getElementById('joystick-zone');
        const joyKnob = document.getElementById('joystick-knob');
        let joyDrag   = false;
        const jC      = { x: 60, y: 60 };

        joyZone.addEventListener('touchstart', () => { joyDrag = true; });
        joyZone.addEventListener('touchmove', e => {
            if (!joyDrag) return;
            e.preventDefault();
            const rect = joyZone.getBoundingClientRect();
            let dx = e.touches[0].clientX - rect.left - jC.x;
            let dy = e.touches[0].clientY - rect.top  - jC.y;
            const d = Math.sqrt(dx*dx + dy*dy), dz = 15, mx = 45;
            if (d < dz) { dx = 0; dy = 0; } else if (d > mx) { dx = dx/d*mx; dy = dy/d*mx; }
            joyKnob.style.transform = `translate(${dx}px,${dy}px)`;
            this.state.input.right   =  dx / mx;
            this.state.input.forward = -dy / mx;
        }, { passive: false });
        joyZone.addEventListener('touchend', () => {
            joyDrag = false;
            joyKnob.style.transform = '';
            this.state.input.right   = 0;
            this.state.input.forward = 0;
        });

        document.getElementById('boost-btn').addEventListener('touchstart', e => { e.preventDefault(); this.state.input.boost = true;  });
        document.getElementById('boost-btn').addEventListener('touchend',   e => { e.preventDefault(); this.state.input.boost = false; });
        document.getElementById('brake-btn').addEventListener('touchstart', e => { e.preventDefault(); this.state.input.brake = true;  });
        document.getElementById('brake-btn').addEventListener('touchend',   e => { e.preventDefault(); this.state.input.brake = false; });

        let touchStartX = 0, touchStartY = 0;
        window.addEventListener('touchstart', e => {
            if (e.touches[0].clientX > window.innerWidth / 2) {
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
            }
        }, { passive: false });

        window.addEventListener('touchmove', e => {
            const touch = Array.from(e.touches).find(t => t.clientX > window.innerWidth / 2);
            if (touch && !this.state.isStalling) {
                const dx = touch.clientX - touchStartX;
                const dy = touch.clientY - touchStartY;
                touchStartX = touch.clientX;
                touchStartY = touch.clientY;
                const sens = 0.008;
                this.state.mouse.x  = (this.state.mouse.x || 0) - dx * sens;
                this.state.mouse.y  = (this.state.mouse.y || 0) - dy * sens;
                this.state.mouse.y  = clamp(this.state.mouse.y, -Math.PI / 2.05, Math.PI / 2.05);
                this.state.mouse.dx = dx;
            }
        }, { passive: false });
    }
}
