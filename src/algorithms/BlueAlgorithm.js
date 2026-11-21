/**
 * @fileoverview Blue team algorithm - forager that COMMUNICATES with pheromones.
 * This is a pure function: it takes only what the ant can see (View) and
 * returns what it wants to do (Action). It never gets the Grid or other ants
 * ("Fog of War"); the only way to communicate is pheromones in the View.
 * Similar to a function in C++: `Action blueAlgorithm(const View& view)`
 *
 * Strategy (a state machine with 2 states: searching / carrying):
 *   Carrying food:
 *     - walk home greedily (80%) or wander (20%, to escape dead ends),
 *     - leave a strong pheromone trail on every step.
 *     => Every successful trip draws a line "food <-> nest" on the map.
 *   Searching:
 *     1. Food next to me?     -> step onto it.
 *     2. A trail next to me?  -> follow it away from the nest
 *                                (toward the food it came from).
 *     3. Otherwise            -> wander with momentum.
 *
 * Compare with RedAlgorithm.js: same rules but no pheromones. The score
 * difference shows how much the colony gains from communication.
 *
 * @typedef {import('../types.js').View} View
 * @typedef {import('../types.js').Action} Action
 */
import { wander, move, towardHome, foodNearby, followTrailOutward } from './helpers.js';

/** Strength of the trail left by a carrying ant (0..255). */
const TRAIL = 255;
/** Searching ants ignore trails weaker than this. */
const TRAIL_THRESHOLD = 20;
/** Chance (0..1) that a carrying ant wanders instead of heading home. */
const HOMING_NOISE = 0.2;

/**
 * @param {View} view - 3x3 neighbourhood of the ant (reused object — do not store it)
 * @returns {Action|null} Movement action {dx, dy, pheromone?, memory?} or null for no movement
 */
export function update(view) {
  if (view.carrying) {
    if (view.random >= HOMING_NOISE) {
      const d = towardHome(view);
      if (d >= 0) return move(d, TRAIL);
    }
    return wander(view, TRAIL);
  }

  const food = foodNearby(view);
  if (food >= 0) return move(food);

  const trail = followTrailOutward(view, TRAIL_THRESHOLD);
  if (trail >= 0) return move(trail);

  return wander(view);
}
