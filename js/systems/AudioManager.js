/**
 * js/systems/AudioManager.js — Procedural WebAudio: wind, building rumble,
 * ring chimes, impacts and the sonic boom.
 *
 * The AudioContext is created on the first user gesture (browsers block it
 * before that). Everything runs through a master compressor so stacked
 * sounds never clip, and continuous parameters use setTargetAtTime so they
 * glide instead of zippering.
 *
 * @ai-context
 *   API : unlock(), update(dt, state), playCollect(combo), playImpact(strength), playSonicBoom().
 */
import { clamp } from '../core/math.js';

const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

export class AudioManager {
    constructor() {
        this.ctx = null;
    }

    /** Create or resume the context. Safe to call on every gesture. */
    unlock() {
        if (!this.ctx) this._init();
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    }

    get ready() { return !!this.ctx && this.ctx.state === 'running'; }

    _init() {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = this.ctx = new AC();

        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 6;
        this.master = ctx.createGain();
        this.master.gain.value = 0.8;
        this.master.connect(comp).connect(ctx.destination);

        const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        this.noise = buf;

        const loop = (type, freq, q) => {
            const src = ctx.createBufferSource();
            src.buffer = buf; src.loop = true;
            const filter = ctx.createBiquadFilter();
            filter.type = type; filter.frequency.value = freq;
            if (q) filter.Q.value = q;
            const gain = ctx.createGain();
            gain.gain.value = 0;
            src.connect(filter);
            src.start();
            return { filter, gain };
        };
        const wind = loop('bandpass', 500, 1.2);
        this.windFilter = wind.filter;
        this.windGain = wind.gain;
        this.windPan = ctx.createStereoPanner();
        wind.filter.connect(this.windPan).connect(wind.gain).connect(this.master);

        const rumble = loop('lowpass', 140);
        this.rumbleGain = rumble.gain;
        rumble.filter.connect(rumble.gain).connect(this.master);
    }

    update(dt, s) {
        if (!this.ready) return;
        const t = this.ctx.currentTime;
        const spdN = clamp(s.velocity.length() / s.boostSpeedCap, 0, 1);
        this.windFilter.frequency.setTargetAtTime(400 + spdN * 1800 + (s.input.brake ? 900 : 0), t, 0.1);
        this.windGain.gain.setTargetAtTime(spdN * 0.6, t, 0.1);
        this.windPan.pan.setTargetAtTime(clamp(-s.velocity.dot(s.rightDir) / 30, -1, 1), t, 0.1);
        this.rumbleGain.gain.setTargetAtTime(s.buildingProximity * 0.6, t, 0.15);
    }

    /** Bell chime; each ring in a streak climbs the pentatonic scale. */
    playCollect(combo = 1) {
        if (!this.ready) return;
        const ctx = this.ctx, t = ctx.currentTime;
        const f = 660 * Math.pow(2, PENTATONIC[Math.min(combo - 1, PENTATONIC.length - 1)] / 12);
        for (const [mult, vol] of [[1, 0.22], [2, 0.06]]) {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.frequency.value = f * mult;
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
            o.connect(g).connect(this.master);
            o.start(t); o.stop(t + 0.45);
        }
    }

    /** Low thud for landings and wall hits. */
    playImpact(strength) {
        if (!this.ready) return;
        const ctx = this.ctx, t = ctx.currentTime, s = clamp(strength, 0, 1);
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(110 + s * 60, t);
        o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
        g.gain.setValueAtTime(0.6 * s + 0.05, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.connect(g).connect(this.master);
        o.start(t); o.stop(t + 0.32);
        this._noiseBurst(t, 700, 250, 0.12, 0.3 * s);
    }

    /** Deep boom + swept air burst when the boost kicks in. */
    playSonicBoom() {
        if (!this.ready) return;
        const ctx = this.ctx, t = ctx.currentTime;
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(120, t);
        o.frequency.exponentialRampToValueAtTime(30, t + 0.5);
        g.gain.setValueAtTime(0.9, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        o.connect(g).connect(this.master);
        o.start(t); o.stop(t + 0.55);
        this._noiseBurst(t, 900, 150, 0.45, 0.5);
    }

    _noiseBurst(t, fromHz, toHz, dur, vol) {
        const ctx = this.ctx;
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.setValueAtTime(fromHz, t);
        f.frequency.exponentialRampToValueAtTime(toHz, t + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f).connect(g).connect(this.master);
        src.start(t, Math.random()); src.stop(t + dur + 0.05);
    }
}
