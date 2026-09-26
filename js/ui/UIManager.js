/**
 * js/ui/UIManager.js — All in-game DOM writes (HUD, help, prompts, flashes).
 *
 * The HUD is deliberately small: rings, speed, altitude, best. The controls
 * card shows at launch, tucks itself away after a while, and H brings it back.
 *
 * @ai-context
 *   API     : show(), update(dt, state), ringCollected(combo), flashImpact(strength),
 *             setPlayers([{name, speed, you}]), setModal(bool).
 *   READS   : state.velocity, score/highScore/totalRings, showHelp, pointerLocked,
 *             currentState, showWings.
 */
import { clamp, damp } from '../core/math.js';

const HELP_AUTO_HIDE = 15;

export class UIManager {
    constructor() {
        const $ = id => document.getElementById(id);
        this.el = {
            hud: $('hud'), score: $('ui-score'), total: $('ui-total'), best: $('ui-best'),
            speed: $('ui-speed'), alt: $('ui-alt'), streak: $('ui-streak'), ringsCard: $('ui-rings-card'),
            help: $('help'), helpHint: $('help-hint'), prompt: $('click-prompt'),
            boost: $('boost-vignette'), impact: $('impact-flash'),
            players: $('ui-players-panel'), playersList: $('ui-players-list'), wingsMob: $('wings-mob-btn'),
        };
        this.touch = matchMedia('(pointer: coarse)').matches;
        this.speed = 0;
        this.alt = 0;
        this.playTime = 0;
        this.modal = false;
        this._cache = new Map();
        this._streakTO = null;
    }

    show() {
        this.el.hud.style.display = 'flex';
        document.body.classList.add('playing');
    }

    /** Hide prompts while a full-screen overlay (race result) is up. */
    setModal(on) { this.modal = on; }

    _text(key, value) {
        if (this._cache.get(key) === value) return;
        this._cache.set(key, value);
        this.el[key].textContent = value;
    }

    _visible(el, on) {
        if (el && el.classList.contains('shown') !== on) el.classList.toggle('shown', on);
    }

    update(dt, s) {
        const S = s.STATES;
        this.playTime += dt;

        this.speed += (s.velocity.length() * 3.6 - this.speed) * damp(8, dt);
        this.alt   += (Math.max(0, s.altitude) - this.alt) * damp(8, dt);
        this._text('speed', String(Math.round(this.speed)));
        this._text('alt', String(Math.round(this.alt)));
        this._text('score', String(s.score));
        this._text('total', String(s.totalRings));
        this._text('best', String(s.highScore));

        if (this.playTime > HELP_AUTO_HIDE && !this._autoHid) { s.showHelp = false; this._autoHid = true; }
        this._visible(this.el.help, s.showHelp && !this.touch);
        this._visible(this.el.helpHint, !s.showHelp && !this.touch);
        this._visible(this.el.prompt, !this.touch && !s.pointerLocked && !this.modal);

        const fast = s.currentState === S.SUPERSONIC || s.currentState === S.POWERDIVE;
        const vig = fast ? clamp(s.velocity.length() / s.boostSpeedCap, 0, 0.8) : 0;
        if (this._cache.get('vig') !== vig) { this._cache.set('vig', vig); this.el.boost.style.opacity = vig.toFixed(2); }

        if (this.el.wingsMob) {
            const label = s.showWings ? 'WINGS' : 'CAPE';
            if (this.el.wingsMob.textContent !== label) {
                this.el.wingsMob.textContent = label;
                this.el.wingsMob.className = 'mob-btn ' + (s.showWings ? 'wing-active' : 'cape-active');
            }
        }
    }

    ringCollected(combo) {
        const card = this.el.ringsCard;
        card.classList.remove('ring-pulse');
        void card.offsetWidth;
        card.classList.add('ring-pulse');
        if (combo >= 2) {
            this.el.streak.textContent = `STREAK ×${combo}`;
            this._visible(this.el.streak, true);
            clearTimeout(this._streakTO);
            this._streakTO = setTimeout(() => this._visible(this.el.streak, false), 1800);
        }
    }

    flashImpact(strength) {
        const el = this.el.impact;
        el.style.transition = 'none';
        el.style.opacity = clamp(strength * 0.35, 0, 0.3);
        void el.offsetWidth;
        el.style.transition = 'opacity 0.35s ease-out';
        el.style.opacity = 0;
    }

    /** Multiplayer roster: [{ name, speed, you }] */
    setPlayers(list) {
        const panel = this.el.players;
        panel.hidden = list.length < 2;
        if (panel.hidden) return;
        const rows = list.map(p => {
            const row = document.createElement('div');
            row.className = 'player-row' + (p.you ? ' you' : '');
            const name = document.createElement('span');
            name.textContent = p.you ? `${p.name} (you)` : p.name;
            const spd = document.createElement('span');
            spd.textContent = `${p.speed} km/h`;
            row.append(name, spd);
            return row;
        });
        this.el.playersList.replaceChildren(...rows);
    }
}
