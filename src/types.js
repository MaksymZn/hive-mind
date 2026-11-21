/**
 * @fileoverview Shared JSDoc type definitions (no runtime code).
 * Similar to a C++ header with only `struct` declarations: other files refer
 * to these types with `import('../types.js').View` inside JSDoc comments.
 *
 * @module types
 */

/**
 * What one ant can see: its 3x3 neighbourhood ("Fog of War").
 * Ants never get the Grid itself, so they cannot read the whole map or talk
 * to other ants directly — only through pheromones left on cells.
 *
 * Layout of `cells` / `pheromones` (row-major, index 4 = the ant's own cell):
 * ```
 *   0 1 2      (-1,-1) (0,-1) (1,-1)
 *   3 4 5  ==  (-1, 0) (0, 0) (1, 0)
 *   6 7 8      (-1, 1) (0, 1) (1, 1)
 * ```
 * Cells outside the map are reported as CELL.WALL.
 *
 * IMPORTANT: the same View object is reused for every ant every tick (to
 * avoid allocating thousands of objects per second). An algorithm must read
 * it and return — never store a reference to it for later, just like you
 * would never keep a pointer to a temporary buffer in C++.
 *
 * @typedef {Object} View
 * @property {Uint8Array} cells - 9 cell types (CELL values)
 * @property {Uint8Array} pheromones - 9 pheromone intensities (0..255)
 * @property {number} teamId - Team of the ant looking (0 = Blue, 1 = Red)
 * @property {boolean} carrying - True if the ant is carrying food
 * @property {Uint16Array} homeDist - "Nest scent" for the 9 cells (same layout
 *   as `cells`): walking distance from each cell to the ant's OWN nest,
 *   counting steps around walls. Smaller = closer to home. Walls and cells
 *   that cannot reach the nest are NO_PATH (65535).
 *   Think of it as the smell of the nest spreading through the tunnels: the
 *   ant only senses it on the 9 cells around it, so it can follow it home
 *   step by step but still cannot see the map (Fog of War holds).
 * @property {Uint8Array} enemies - Number of ENEMY ants on each of the 9 cells
 *   (same layout as `cells`), as of the start of this tick.
 * @property {Uint8Array} allies - Number of OWN-team ants on each of the 9
 *   cells, not counting the ant itself.
 * @property {number} health - The ant's hit points (1..COMBAT.MAX_HEALTH).
 *   Every enemy in the 3x3 area at the end of a tick costs 1 HP (see COMBAT
 *   in config.js), so `enemies` and `allies` are what an algorithm needs to
 *   decide between fighting and running away.
 * @property {number} random - A random float in [0, 1), new every tick.
 *   Algorithms must use this instead of Math.random(): the State draws it
 *   from the seeded PRNG, so the same seed replays the exact same game.
 * @property {number} memory - Integer 0..255 the ant returned in its last
 *   Action (`action.memory`); 0 at spawn. One byte of private memory — like
 *   a single register — for things like "the direction I was walking".
 */

/**
 * What an ant wants to do this tick. Returned by an algorithm; the State
 * validates it before applying (an algorithm can never walk through walls or
 * teleport, even if it has a bug).
 *
 * @typedef {Object} Action
 * @property {number} dx - Horizontal step: -1, 0 or 1
 * @property {number} dy - Vertical step: -1, 0 or 1
 * @property {number} [pheromone] - Optional intensity (0..255) to leave on the
 *   cell the ant is LEAVING. The cell keeps the stronger of old and new value.
 * @property {number} [memory] - Optional integer 0..255 to remember until the
 *   next tick (comes back as `view.memory`). If omitted, memory is unchanged.
 *
 * Food rules (applied by the State after the move, not by the algorithm):
 *   - An ant that is not carrying and stands on FOOD picks it up
 *     (the cell becomes EMPTY).
 *   - An ant that is carrying and stands within 1 cell of its own nest
 *     drops the food there: +1 to its team's score.
 */

export {};
