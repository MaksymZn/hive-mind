/**
 * @fileoverview Building blocks for ant algorithms (all pure functions).
 * Each helper only reads the View and returns a direction or an Action,
 * so both teams can mix and match them.
 *
 * Directions are numbered 0..7 clockwise from North, so "turn right" is
 * `(d + 1) % 8` and "turn left" is `(d + 7) % 8` — like an enum used as an
 * index into lookup tables in C++.
 *
 * ```
 *   7 0 1        NW  N  NE
 *   6 . 2   ==   W   .   E
 *   5 4 3        SW  S  SE
 * ```
 *
 * @typedef {import('../types.js').View} View
 * @typedef {import('../types.js').Action} Action
 */
import { CELL } from '../config.js';

/** View index (0..8, see types.js) of each direction 0..7. */
const VIEW_INDEX = Object.freeze([1, 2, 5, 8, 7, 6, 3, 0]);
/** Step per direction. Precomputed tables instead of branching. */
const STEP_X = Object.freeze([0, 1, 1, 1, 0, -1, -1, -1]);
const STEP_Y = Object.freeze([-1, -1, 0, 1, 1, 1, 0, -1]);

/**
 * @param {View} view
 * @param {number} d - Direction 0..7
 * @returns {boolean} True if the neighbour in direction d is not a wall
 */
export function isOpen(view, d) {
  return view.cells[VIEW_INDEX[d]] !== CELL.WALL;
}

/**
 * Builds an Action that steps in direction d and remembers it.
 * Memory stores `d + 1` so that 0 can mean "no direction yet".
 *
 * @param {number} d - Direction 0..7
 * @param {number} [pheromone] - Optional trail strength to leave behind
 * @returns {Action}
 */
export function move(d, pheromone) {
  const action = { dx: STEP_X[d], dy: STEP_Y[d], memory: d + 1 };
  if (pheromone !== undefined) action.pheromone = pheromone;
  return action;
}

/**
 * Finds an open direction as close as possible to `dir`: tries dir, then
 * dir±1, dir±2... (the side tried first is chosen by `side`).
 * This makes ants slide along walls instead of stopping at them.
 *
 * @param {View} view
 * @param {number} dir - Preferred direction 0..7
 * @param {number} side - +1 = try clockwise first, -1 = counter-clockwise first
 * @returns {number} Direction 0..7, or -1 if the ant is walled in
 */
export function nearestOpen(view, dir, side) {
  if (isOpen(view, dir)) return dir;
  for (let i = 1; i <= 4; i++) {
    const a = (dir + side * i + 8) % 8;
    const b = (dir - side * i + 8) % 8;
    if (isOpen(view, a)) return a;
    if (isOpen(view, b)) return b;
  }
  return -1;
}

/**
 * Random walk WITH MOMENTUM: keep walking the remembered direction, turn
 * left/right by 45 degrees with a small probability. A plain "random step
 * every tick" makes an ant jitter on the spot (it drifts only ~sqrt(n) cells
 * in n steps); momentum makes it travel ~n cells and explore much faster.
 *
 * @param {View} view
 * @param {number} [pheromone] - Optional trail to leave behind
 * @returns {Action}
 */
export function wander(view, pheromone) {
  const r = view.random;
  let dir;
  if (view.memory === 0) {
    dir = Math.floor(r * 8);               // first step: any direction
  } else {
    dir = (view.memory - 1) % 8;
    if (r < 0.12) dir = (dir + 7) % 8;      // 12%: turn left
    else if (r < 0.24) dir = (dir + 1) % 8; // 12%: turn right
  }
  // Another "bit" of the same random number decides which side to try first.
  const side = Math.floor(r * 1024) % 2 === 0 ? 1 : -1;
  const d = nearestOpen(view, dir, side);
  if (d < 0) return { dx: 0, dy: 0, memory: 0 };
  return move(d, pheromone);
}

/**
 * Step toward the nest by following the nest scent downhill: the open
 * neighbour with the smallest walking distance to home (View.homeDist).
 * Because the scent flows around walls, this never gets stuck in a pocket —
 * unlike "walk in a straight line toward the nest", which fails as soon as
 * a rock is in the way.
 *
 * @param {View} view
 * @returns {number} Direction 0..7, or -1 if no neighbour is closer to home
 */
export function towardHome(view) {
  let best = -1;
  let bestDist = view.homeDist[4]; // must be strictly closer than here
  for (let d = 0; d < 8; d++) {
    const dist = view.homeDist[VIEW_INDEX[d]];
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

/**
 * Direction of a neighbouring FOOD cell, if any.
 *
 * @param {View} view
 * @returns {number} Direction 0..7, or -1 if no food is visible
 */
export function foodNearby(view) {
  for (let d = 0; d < 8; d++) {
    if (view.cells[VIEW_INDEX[d]] === CELL.FOOD) return d;
  }
  return -1;
}

/**
 * Follows a pheromone trail AWAY from the nest (toward the food that the
 * trail-layers came from): among open neighbours that do not bring the ant
 * closer to home, picks the one with the strongest pheromone.
 *
 * @param {View} view
 * @param {number} threshold - Ignore trails weaker than this (0..255)
 * @returns {number} Direction 0..7, or -1 if there is no usable trail
 */
export function followTrailOutward(view, threshold) {
  const here = view.homeDist[4];
  let best = -1;
  let bestP = threshold;
  for (let d = 0; d < 8; d++) {
    if (!isOpen(view, d)) continue;
    const i = VIEW_INDEX[d];
    const p = view.pheromones[i];
    if (p < bestP) continue;
    if (view.homeDist[i] < here) continue; // would go back toward the nest
    bestP = p;
    best = d;
  }
  return best;
}
