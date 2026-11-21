/**
 * @fileoverview Red team algorithm - forager WITHOUT communication (baseline).
 * This is a pure function: it takes only what the ant can see (View) and
 * returns what it wants to do (Action). It never gets the Grid or other ants
 * ("Fog of War").
 * Similar to a function in C++: `Action redAlgorithm(const View& view)`
 *
 * Strategy: same as Blue, minus pheromones.
 *   Carrying food: walk home greedily (80%) or wander (20%).
 *   Searching:     step onto visible food, otherwise wander with momentum.
 *
 * Every Red ant has to find food on its own. Try to make Red beat Blue,
 * for example by laying and following trails smarter than Blue does.
 *
 * @typedef {import('../types.js').View} View
 * @typedef {import('../types.js').Action} Action
 */
import { wander, move, towardHome, foodNearby } from './helpers.js';

/** Chance (0..1) that a carrying ant wanders instead of heading home. */
const HOMING_NOISE = 0.2;

/**
 * @param {View} view - 3x3 neighbourhood of the ant (reused object — do not store it)
 * @returns {Action|null} Movement action {dx, dy, memory?} or null for no movement
 */
export function update(view) {
  if (view.carrying) {
    if (view.random >= HOMING_NOISE) {
      const d = towardHome(view);
      if (d >= 0) return move(d);
    }
    return wander(view);
  }

  const food = foodNearby(view);
  if (food >= 0) return move(food);

  return wander(view);
}
