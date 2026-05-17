/**
 * js/ui/UIManager.js
 *
 * Owns all HUD DOM writes. The rest of the engine NEVER touches DOM
 * IDs directly — it calls UIManager methods instead.
 *
 * @ai-context
 *   OWNS      : ALL document.getElementById calls; HUD text updates;
 *               mode badge label/colour; boost vignette opacity;
 *               flashImpact() white overlay; triggerBoomFlash() orange overlay.
 *   READS     : state.displayAlt, state.displaySpeed, state.score,
 *               state.highScore, state.totalRings, state.currentState,
 *               state.input.brake, state.velocity (for vignette spdN).
 *   WRITES    : nothing to PlayerState.
 *   RELATED   : css/style.css (all visual styles); index.html (DOM IDs);
 *               PlayerState.js (fields it reads).
 *   ASK FOR   : css/style.css + index.html if adding a new HUD element.
 *
 * Public API:
 *   update(dt, state)          — called every frame by GameEngine
 *   flashImpact(strength)      — white impact flash overlay
 *   triggerBoomFlash()         — orange supersonic-boom overlay
 */

import { clamp } from '../main.js';

export class UIManager {
    constructor() {
        // Cache DOM references once
        this._alt        = document.getElementById('ui-alt');
        this._speed      = document.getElementById('ui-speed');
        this._score      = document.getElementById('ui-score');
        this._highscore  = document.getElementById('ui-highscore');
        this._modeText   = document.getElementById('mode-text');
        this._boostVig   = document.getElementById('boost-vignette');
        this._impactFlash = document.getElementById('impact-flash');
        this._boomFlash   = document.getElementById('boom-flash');
        this._scorePanel = document.getElementById('ui-score-panel');
        this._combo      = document.getElementById('ui-combo');

        this._flashTO    = null;
        this._boomFlashTO = null;
        this._pulseTO    = null;
        this._lastScore  = 0;
    }

    // ─────────────────────────────────────────────────────────────────

    /**
     * Called once per frame by GameEngine.
     * @param {number} dt
     * @param {import('../entities/PlayerState.js').PlayerState} state
     */
    update(dt, state) {
        // ── Toggle wings button binding and state sync ──────────────
        if (!this._wingsBtnBound) {
            this._toggleWingsBtn = document.getElementById('toggle-wings-btn');
            if (this._toggleWingsBtn) {
                this._toggleWingsBtn.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent canvas pointer lock on click
                    state.showWings = !state.showWings;
                });
                this._wingsBtnBound = true;
            }
        }
        if (this._toggleWingsBtn) {
            if (state.showWings) {
                this._toggleWingsBtn.textContent = 'WINGS';
                this._toggleWingsBtn.className = 'ui-toggle-btn wing';
            } else {
                this._toggleWingsBtn.textContent = 'CAPE';
                this._toggleWingsBtn.className = 'ui-toggle-btn cape';
            }
        }

        const S   = state.STATES;
        const alt = Math.max(0, state.velocity.y >= 0
            ? state.displayAlt   // updated by CameraJuice
            : state.displayAlt);

        this._alt.textContent       = Math.floor(state.displayAlt)   + ' m';
        this._speed.textContent     = Math.floor(state.displaySpeed)  + ' km/h';
        this._score.textContent     = `${state.score} / ${state.totalRings}`;
        this._highscore.textContent = state.highScore;

        // ── Score pulse animation trigger ───────────────────────────
        if (this._lastScore > 0 && state.score > this._lastScore) {
            if (this._scorePanel) {
                this._scorePanel.classList.remove('ring-pulse');
                void this._scorePanel.offsetWidth; // Trigger DOM reflow
                this._scorePanel.classList.add('ring-pulse');
                clearTimeout(this._pulseTO);
                this._pulseTO = setTimeout(() => {
                    this._scorePanel.classList.remove('ring-pulse');
                }, 450);
            }
        }
        this._lastScore = state.score;

        // ── Combo overlay indicator ──────────────────────────────────
        if (this._combo) {
            if (state.comboCount > 1) {
                this._combo.textContent = `STREAK x${state.comboCount}`;
                this._combo.style.opacity = '1';
                this._combo.style.transform = 'translateY(-50%) scale(1.1)';
            } else {
                this._combo.style.opacity = '0';
                this._combo.style.transform = 'translateY(-50%) scale(0.9)';
            }
        }

        // ── Mode badge ─────────────────────────────────────────────
        const modes = {
            [S.IDLE]:      ['HOVER',       'var(--primary)', 'rgba(0,240,255,0.12)'],
            [S.FLIGHT]:    ['FLIGHT',      'var(--primary)', 'rgba(0,240,255,0.12)'],
            [S.SUPERSONIC]:['SUPERSONIC',  'var(--danger)',  'rgba(255,0,85,0.18)'],
            [S.POWERDIVE]: ['POWER DIVE',  '#ffaa00',        'rgba(255,160,0,0.18)'],
            [S.STALL]:     ['STALL WARNING','var(--danger)', 'rgba(255,0,85,0.25)'],
            [S.WALK]:      ['GROUND WALK', 'var(--primary)', 'rgba(0,240,255,0.12)'],
        };

        const [label, col, bg] = state.freeLook
            ? ['FREE LOOK', 'var(--primary)', 'rgba(0,240,255,0.2)']
            : (state.input.brake
                ? ['AIR BRAKES', '#888', 'rgba(100,100,100,0.15)']
                : (modes[state.currentState] || modes[S.IDLE]));

        this._modeText.textContent        = label;
        this._modeText.style.color        = col;
        this._modeText.style.borderColor  = col;
        this._modeText.style.backgroundColor = bg;

        // ── Boost vignette ─────────────────────────────────────────
        const boostActive = (
            state.currentState === S.SUPERSONIC ||
            state.currentState === S.POWERDIVE
        );
        const spdN = clamp(state.velocity.length() / state.boostSpeedCap, 0, 1);
        this._boostVig.style.opacity = boostActive ? clamp(spdN, 0, 0.85) : 0;
    }

    /**
     * White flash on building / ground impact.
     * @param {number} strength  0–1
     */
    flashImpact(strength) {
        const el = this._impactFlash;
        el.style.transition = 'none';
        el.style.opacity    = clamp(strength, 0, 0.5);
        clearTimeout(this._flashTO);
        this._flashTO = setTimeout(() => {
            el.style.transition = 'opacity 0.25s';
            el.style.opacity    = 0;
        }, 40);
    }

    /** Orange overlay fired once when the supersonic boost activates. */
    triggerBoomFlash() {
        const flash = this._boomFlash;
        flash.style.transition = 'none';
        flash.style.opacity    = 0.8;
        clearTimeout(this._boomFlashTO);
        this._boomFlashTO = setTimeout(() => {
            flash.style.transition = 'opacity 0.4s ease-out';
            flash.style.opacity    = 0;
        }, 40);
    }
}
