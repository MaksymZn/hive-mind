/**
 * @fileoverview Seeded pseudo-random number generator (PRNG).
 *
 * Why not `Math.random()`? It cannot be seeded, so the same map can never be
 * generated twice. That breaks Save/Load (we would have to store the whole
 * grid instead of one number) and makes bugs impossible to reproduce.
 *
 * C++ analogy:
 * ```cpp
 * std::mt19937 rng(seed);
 * std::uniform_real_distribution<double> dist(0.0, 1.0);
 * double r = dist(rng);
 * ```
 * Here we use Mulberry32: a tiny, fast 32-bit generator. Its state is a single
 * uint32. It is NOT cryptographically secure — fine for games, never for
 * passwords or tokens (use `crypto.getRandomValues` for that).
 *
 * @module utils/random
 */

/**
 * Creates a seeded random function that returns floats in [0, 1).
 *
 * How it works: each call adds a constant to the 32-bit state, then scrambles
 * the bits with multiplications and xor-shifts. `Math.imul` does a true 32-bit
 * integer multiply (like `uint32_t * uint32_t` in C++), because a normal JS `*`
 * works on 64-bit doubles and would lose the low bits. `>>> 0` converts the
 * result to an unsigned 32-bit integer, like `static_cast<uint32_t>(...)`.
 *
 * The returned function is a closure: it captures `state` by reference, much
 * like a C++ lambda `[state]() mutable { ... }` that owns its own copy.
 *
 * `getState()` / `setState()` expose that hidden variable so a saved game can
 * continue with exactly the same random numbers it would have produced
 * (like saving and restoring the internal state of a `std::mt19937`).
 *
 * @param {number} seed - Any integer; the same seed always gives the same sequence
 * @returns {Rng} Function returning a float in [0, 1), plus getState/setState
 */
export function createRng(seed) {
  let state = seed >>> 0;
  /** @type {Rng} */
  const next = function next() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; // divide by 2^32
  };
  next.getState = () => state;
  next.setState = (s) => {
    state = s >>> 0;
  };
  return next;
}

/**
 * @typedef {(() => number) & { getState: () => number, setState: (s: number) => void }} Rng
 */

/**
 * Returns a random 32-bit seed (used when the caller does not supply one).
 *
 * @returns {number} Unsigned 32-bit integer
 */
export function randomSeed() {
  return (Math.random() * 4294967296) >>> 0;
}
