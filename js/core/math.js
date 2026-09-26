/**
 * js/core/math.js — Shared math helpers.
 *
 * Every system imports from here (never from main.js) so modules can be
 * loaded on their own without bootstrapping the game.
 */
import * as THREE from 'three';

export const { lerp, clamp, smoothstep } = THREE.MathUtils;

/** Framerate-independent smoothing factor: value += (target - value) * damp(k, dt). */
export const damp = (k, dt) => 1 - Math.exp(-k * dt);

/** Wrap an angle into (-π, π]. */
export const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

/** Seeded PRNG (FNV-1a hash → mulberry32) so every peer builds the same city. */
export function createPRNG(seedString) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < seedString.length; i++) h = Math.imul(h ^ seedString.charCodeAt(i), 16777619);
    let s = h;
    return function () {
        let t = (s += 0x6D2B79F5) | 0;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Smooth 1D value noise in [-1, 1] — continuous, so camera shake never jitters. */
export function noise1(x) {
    const i = Math.floor(x), f = x - i;
    const h = n => { const s = Math.sin(n * 127.1) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };
    const u = f * f * (3 - 2 * f);
    return h(i) + (h(i + 1) - h(i)) * u;
}
