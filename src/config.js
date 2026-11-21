/**
 * @fileoverview Configuration constants for the Hive Mind simulation.
 * 
 * This file acts like a C++ header file (`config.h`) with `#define` or `constexpr` constants.
 * In C++, you would write:
 * ```cpp
 * #define WORLD_SIZE 100
 * constexpr int ANT_COUNT = 50;
 * ```
 * 
 * In JavaScript, we use `const` declarations which are similar to `constexpr` in C++:
 * - They are compile-time constants (known at module load time)
 * - They cannot be reassigned (similar to `constexpr` immutability)
 * - They are block-scoped (similar to C++ namespace scope)
 * 
 * Using a centralized config file eliminates "Magic Numbers" scattered throughout the codebase,
 * making the code more maintainable and easier to tune. This is a best practice in both C++ and JS.
 * 
 * @module config
 */

/**
 * The size of the world grid (width and height in cells).
 * Similar to `#define WORLD_SIZE 100` or `constexpr int WORLD_SIZE = 100;` in C++.
 * 
 * @type {number}
 * @constant
 */
export const WORLD_SIZE = 100;

/**
 * The initial number of ants to spawn in the simulation.
 * Similar to `constexpr int ANT_COUNT = 50;` in C++.
 * 
 * @type {number}
 * @constant
 */
export const ANT_COUNT = 50;

/**
 * The decay rate for pheromones per game tick (0.0 to 1.0).
 * Pheromones are multiplied by this value each frame, causing them to fade over time.
 * Similar to `constexpr double PHEROMONE_DECAY = 0.98;` in C++.
 * 
 * @type {number}
 * @constant
 */
export const PHEROMONE_DECAY = 0.98;

/**
 * The maximum pheromone intensity value (0-255 range, similar to RGB color channels).
 * Pheromones are clamped to this maximum value to prevent overflow.
 * Similar to `constexpr int MAX_PHEROMONE = 255;` in C++.
 * 
 * @type {number}
 * @constant
 */
export const MAX_PHEROMONE = 255;


/**
 * Cell types stored in the static grid (Walls/Food).
 * Similar to a C++ `enum class CellType : uint8_t { Empty = 0, Wall = 1, Food = 2 };`
 * Every value must fit into one byte (0-255) because the grid is a Uint8Array.
 *
 * `Object.freeze` makes the object read-only, like `const` members in C++:
 * `CELL.WALL = 5` will silently fail (or throw in strict mode / ES modules).
 *
 * @readonly
 * @enum {number}
 */
export const CELL = Object.freeze({
  EMPTY: 0,
  WALL: 1,
  FOOD: 2,
});

/**
 * Cave generation parameters (cellular automaton, see Grid.generateLevel).
 * Similar to a `struct CaveParams { ... }` of constexpr values in C++.
 *
 * - WALL_DENSITY: chance (0..1) that a cell starts as a wall before smoothing.
 *   ~0.45 gives open caves; > 0.5 quickly turns into mostly solid rock.
 * - SMOOTH_STEPS: how many times the smoothing rule is applied.
 *   More steps = rounder, smoother caves (it converges after ~5-7 steps).
 * - FOOD_CLUSTERS: how many food piles are placed on the map.
 * - FOOD_RADIUS: radius (in cells) of each food pile.
 *
 * @readonly
 */
export const CAVE = Object.freeze({
  WALL_DENSITY: 0.45,
  SMOOTH_STEPS: 5,
  FOOD_CLUSTERS: 10,
  FOOD_RADIUS: 2,
});

/**
 * Number of teams (0 = Blue, 1 = Red).
 * @type {number}
 * @constant
 */
export const TEAM_COUNT = 2;

/**
 * Preferred nest location of each team, as a fraction of the map size
 * (0..1). The actual nest is the open cell closest to this point, because the
 * exact point may be inside rock. Index = teamId.
 * Similar to `constexpr std::array<Vec2, 2> NEST_TARGETS = {{...}};` in C++.
 * @type {ReadonlyArray<Readonly<{x: number, y: number}>>}
 */
export const NEST_TARGETS = Object.freeze([
  Object.freeze({ x: 0.2, y: 0.5 }),
  Object.freeze({ x: 0.8, y: 0.5 }),
]);

/**
 * Simulation speed: logic ticks per second, independent of the monitor's
 * refresh rate (60 Hz, 144 Hz...). One tick = every ant makes one move.
 * @type {number}
 * @constant
 */
export const TICKS_PER_SECOND = 20;

/**
 * Safety cap on logic ticks run in one animation frame. If the tab was in
 * the background or a frame took very long, we do NOT try to catch up on
 * hundreds of ticks at once (that would freeze the page and make the next
 * frame even later — the "spiral of death"); the lost time is dropped.
 * @type {number}
 * @constant
 */
export const MAX_TICKS_PER_FRAME = 5;

/**
 * Value of View.homeDist for walls and cells with no path to the nest
 * (the largest Uint16 value, like `std::numeric_limits<uint16_t>::max()`).
 * @type {number}
 * @constant
 */
export const NO_PATH = 0xFFFF;

/**
 * localStorage key for the saved game. Includes the app name so it does not
 * clash with other apps on the same origin (localhost:3000 is shared by every
 * dev project you run on that port!).
 * @type {string}
 * @constant
 */
export const SAVE_KEY = 'hive-mind/save';

/**
 * Save format version. Bump it whenever the shape of the saved data changes;
 * load() refuses saves with another version instead of misreading them
 * (like a version field in a binary file header in C++).
 * @type {number}
 * @constant
 */
export const SAVE_VERSION = 2;

/**
 * Combat rules.
 * - MAX_HEALTH: hit points of a fresh ant.
 * - Every tick, after all moves, each ant loses 1 HP for EVERY enemy ant in
 *   its 3x3 neighbourhood (its own cell included). Damage is computed for all
 *   ants first and applied afterwards ("simultaneous"), so the order of ants
 *   in the array does not decide who wins.
 * - Numbers matter: 3 ants around 1 enemy deal 3 damage per tick to it,
 *   while each of them takes only 1.
 * - An ant at 0 HP dies; food it carried is dropped on its cell.
 * @readonly
 */
export const COMBAT = Object.freeze({
  MAX_HEALTH: 5,
});
