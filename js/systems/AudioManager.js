/**
 * js/systems/AudioManager.js
 *
 * Encapsulates every WebAudio API node and synth.
 *
 * @ai-context
 *   OWNS      : AudioContext; wind bandpass synth; proximity rumble lowpass;
 *               collect chime; impact sawtooth; sonic boom sweep + noise.
 *   READS     : nothing from PlayerState.
 *   WRITES    : nothing to PlayerState.
 *   CALLED BY : CameraJuice (updateWind, playCollectSound);
 *               Physics (updateRumble, playImpactSound, playSonicBoom);
 *               main.js (resume on user gesture).
 *   RELATED   : Physics.js (calls impact / boom), CameraJuice.js (calls wind).
 *   ASK FOR   : No additional files needed — this module is self-contained.
 *
 * Public API used by other systems:
 *   resume()
 *   updateWind(freq, gain, pan, dt)
 *   updateRumble(targetGain, dt)
 *   playCollectSound()
 *   playImpactSound(strength)
 *   playSonicBoom()
 */

import { clamp } from '../main.js';

export class AudioManager {
    constructor() {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AC();

        // ── Shared noise buffer (2 s of white noise, looped) ─────────
        const rate = this.audioCtx.sampleRate;
        const buf  = this.audioCtx.createBuffer(1, rate * 2, rate);
        const d    = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        this._noiseBuf = buf;

        // ── Wind layer ────────────────────────────────────────────────
        const w = this._makeNoise('bandpass', 500, 1.2);
        this.windFilter = w.filter;
        this.windGain   = w.gain;

        // Insert a stereo panner between the filter and gain node
        this.windPanner = this.audioCtx.createStereoPanner();
        this.windGain.disconnect();
        this.windFilter.connect(this.windPanner);
        this.windPanner.connect(this.windGain);
        this.windGain.connect(this.audioCtx.destination);

        // ── Rumble layer ──────────────────────────────────────────────
        const r = this._makeNoise('lowpass', 140);
        this.rumbleFilter = r.filter;
        this.rumbleGain   = r.gain;
    }

    // ── Private helpers ───────────────────────────────────────────────

    /** Create a looped noise source → biquad filter → gain node chain. */
    _makeNoise(filterType, freq, Q) {
        const src    = this.audioCtx.createBufferSource();
        src.buffer   = this._noiseBuf;
        src.loop     = true;

        const filter = this.audioCtx.createBiquadFilter();
        filter.type  = filterType;
        filter.frequency.value = freq;
        if (Q) filter.Q.value = Q;

        const gain = this.audioCtx.createGain();
        gain.gain.value = 0;

        src.connect(filter);
        filter.connect(gain);
        gain.connect(this.audioCtx.destination);
        src.start();

        return { filter, gain };
    }

    // ── Public API ────────────────────────────────────────────────────

    /** Must be called inside a user-gesture handler (the LAUNCH button). */
    resume() {
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
    }

    /**
     * Smooth the wind synth parameters each frame.
     * @param {number} targetFreq  - Target filter frequency (Hz)
     * @param {number} targetGain  - Target gain (0–1)
     * @param {number} targetPan   - Target pan (-1 to 1)
     * @param {number} dt          - Delta time (seconds)
     */
    updateWind(targetFreq, targetGain, targetPan, dt) {
        if (this.audioCtx.state !== 'running') return;
        const aT = clamp(0.12, 0, 1); // fixed smoothing alpha (matches original)
        this.windFilter.frequency.value += (targetFreq - this.windFilter.frequency.value) * aT;
        this.windGain.gain.value        += (targetGain - this.windGain.gain.value)        * aT;
        this.windPanner.pan.value       += (targetPan  - this.windPanner.pan.value)       * aT;
    }

    /**
     * Smooth the building-proximity rumble gain each frame.
     * @param {number} targetGain
     * @param {number} dt
     */
    updateRumble(targetGain, dt) {
        if (this.audioCtx.state !== 'running') return;
        this.rumbleGain.gain.value += (targetGain - this.rumbleGain.gain.value) * clamp(5 * dt, 0, 1);
    }

    /** Short rising chime played when a ring is collected. */
    playCollectSound() {
        if (this.audioCtx.state !== 'running') return;
        const osc = this.audioCtx.createOscillator();
        const g   = this.audioCtx.createGain();
        osc.type  = 'sine';
        osc.frequency.setValueAtTime(900,  this.audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1800, this.audioCtx.currentTime + 0.12);
        g.gain.setValueAtTime(0.25, this.audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.15);
        osc.connect(g); g.connect(this.audioCtx.destination);
        osc.start(); osc.stop(this.audioCtx.currentTime + 0.18);
    }

    /**
     * Short sawtooth thud played on building / ground impact.
     * @param {number} strength - 0–1 normalised impact force
     */
    playImpactSound(strength) {
        if (this.audioCtx.state !== 'running') return;
        const osc = this.audioCtx.createOscillator();
        const g   = this.audioCtx.createGain();
        osc.type  = 'sawtooth';
        osc.frequency.setValueAtTime(60 + strength * 80, this.audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(20,   this.audioCtx.currentTime + 0.3);
        g.gain.setValueAtTime(clamp(strength * 0.6, 0, 0.7), this.audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001,            this.audioCtx.currentTime + 0.35);
        osc.connect(g); g.connect(this.audioCtx.destination);
        osc.start(); osc.stop(this.audioCtx.currentTime + 0.4);
    }

    /** Low boom + filtered noise burst played when boost activates. */
    playSonicBoom() {
        if (this.audioCtx.state !== 'running') return;
        const t = this.audioCtx.currentTime;

        // Sine sweep
        const osc     = this.audioCtx.createOscillator();
        const oscGain = this.audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(120, t);
        osc.frequency.exponentialRampToValueAtTime(10, t + 0.5);
        oscGain.gain.setValueAtTime(2.0,  t);
        oscGain.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
        osc.connect(oscGain); oscGain.connect(this.audioCtx.destination);
        osc.start(t); osc.stop(t + 0.6);

        // Bandpass noise burst
        const nBuf = this.audioCtx.createBuffer(1, this.audioCtx.sampleRate * 0.5, this.audioCtx.sampleRate);
        const nd   = nBuf.getChannelData(0);
        for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

        const noise       = this.audioCtx.createBufferSource();
        noise.buffer      = nBuf;
        const noiseFilter = this.audioCtx.createBiquadFilter();
        noiseFilter.type  = 'bandpass';
        noiseFilter.frequency.setValueAtTime(800, t);
        noiseFilter.frequency.exponentialRampToValueAtTime(100, t + 0.4);
        const noiseGain   = this.audioCtx.createGain();
        noiseGain.gain.setValueAtTime(1.5,  t);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.4);
        noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(this.audioCtx.destination);
        noise.start(t);
    }
}
