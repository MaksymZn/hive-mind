/**
 * @fileoverview Grid class - Represents a 2D grid/matrix for the simulation map.
 * Similar to a 2D array in C++: `int map[height][width]`
 *
 * Memory layout: both layers are stored as ONE flat, contiguous byte buffer
 * in row-major order (exactly how C++ lays out `uint8_t map[height][width]`):
 *
 *   index = y * width + x
 *
 * Why not `Array<Array<number>>`? A JS array of arrays is like
 * `std::vector<std::vector<double>*>`: every row is a separate heap object,
 * every element is a 64-bit double (or a tagged pointer), and rows are scattered
 * in memory -> cache misses. A `Uint8Array` is a single `uint8_t*` block:
 * 1 byte per cell, contiguous, zero-initialized (like `calloc`).
 *
 * @class Grid
 */
import { CELL, CAVE, PHEROMONE_DECAY, MAX_PHEROMONE } from '../config.js';
import { createRng, randomSeed } from '../utils/random.js';
import { bytesToBase64, base64ToBytes } from '../utils/base64.js';

export class Grid {
  /**
   * Creates a new Grid instance.
   *
   * @param {number} width - The width of the grid (number of columns)
   * @param {number} height - The height of the grid (number of rows)
   */
  constructor(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError(`Grid size must be positive integers, got ${width}x${height}`);
    }

    /** @type {number} */
    this.width = width;
    /** @type {number} */
    this.height = height;

    // Static layer (Walls/Food): one byte per cell, values from CELL.
    // C++: `uint8_t* cells = new uint8_t[width * height]();`
    // Fixed size: unlike Array.push, a typed array never reallocates.
    /** @type {Uint8Array} */
    this.cells = new Uint8Array(width * height);

    // Pheromone layer: intensity 0..MAX_PHEROMONE per cell.
    // NOTE: Uint8Array, not Uint8ClampedArray. Uint8ClampedArray ROUNDS on write,
    // so 1 * 0.98 = 0.98 would round back to 1 and trails would never fully fade.
    // Uint8Array truncates (like a C++ cast `(uint8_t)0.98 == 0`), so decay reaches 0.
    /** @type {Uint8Array} */
    this.pheromones = new Uint8Array(width * height);

    /**
     * Seed of the last generated level (null until generateLevel is called).
     * Saving this one number is enough to rebuild the exact same map.
     * @type {number|null}
     */
    this.seed = null;
  }

  /**
   * Converts 2D coordinates to a flat array index (row-major).
   * C++: `inline size_t index(int x, int y) { return y * width + x; }`
   * No bounds checking here — callers must check first.
   *
   * @param {number} x - The x coordinate (column)
   * @param {number} y - The y coordinate (row)
   * @returns {number} Flat index into `cells` / `pheromones`
   * @private
   */
  _index(x, y) {
    return y * this.width + x;
  }

  /**
   * Generates the level using procedural generation.
   * Similar to a level generation function in C++: `void generateLevel(uint32_t seed)`
   *
   * Algorithm: cellular automaton ("4-5 rule"), in four passes:
   *   1. Noise:     every cell becomes a wall with probability CAVE.WALL_DENSITY.
   *   2. Smoothing: repeat CAVE.SMOOTH_STEPS times — a cell surrounded by
   *                 many walls becomes a wall, a cell with few walls opens up.
   *                 Random noise "clumps" into rounded caves.
   *   3. Connect:   find all separate caves (flood fill) and fill every cave
   *                 except the biggest one, so every open cell is reachable.
   *   4. Food:      place CAVE.FOOD_CLUSTERS round piles of food on open cells.
   *
   * The map border is always a wall, so ants can never walk off the grid.
   *
   * @param {number} [seed] - PRNG seed; same seed => same map. Random if omitted.
   */
  generateLevel(seed = randomSeed()) {
    this.seed = seed >>> 0;
    const rng = createRng(this.seed);

    this.pheromones.fill(0);
    this._fillNoise(rng);
    this._smooth(CAVE.SMOOTH_STEPS);
    this._keepLargestCave();
    this._placeFood(rng);
  }

  /**
   * Checks whether (x, y) lies on the outer border of the grid.
   *
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   * @private
   */
  _isBorder(x, y) {
    return x === 0 || y === 0 || x === this.width - 1 || y === this.height - 1;
  }

  /**
   * Pass 1: random noise. Border cells are always walls.
   *
   * @param {() => number} rng - Seeded random function returning [0, 1)
   * @private
   */
  _fillNoise(rng) {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const wall = this._isBorder(x, y) || rng() < CAVE.WALL_DENSITY;
        this.cells[this._index(x, y)] = wall ? CELL.WALL : CELL.EMPTY;
      }
    }
  }

  /**
   * Pass 2: smoothing with the "4-5 rule".
   * For each inner cell count walls among its 8 neighbours:
   *   > 4 walls -> becomes WALL,  < 4 walls -> becomes EMPTY,  exactly 4 -> unchanged.
   *
   * Double buffering: every cell must be computed from the OLD state, so we
   * read from `src` and write into `dst`, then swap them — the same trick as
   * swapping front/back buffers in graphics (`std::swap(src, dst)` swaps two
   * pointers, no data is copied). Updating in place would let already-updated
   * cells affect their neighbours and skew the caves toward one corner.
   *
   * No bounds checks in the inner loop: we only visit inner cells
   * (1..width-2), so all 8 neighbours always exist.
   *
   * @param {number} steps - Number of smoothing iterations
   * @private
   */
  _smooth(steps) {
    const w = this.width;
    let src = this.cells;
    let dst = new Uint8Array(src.length); // one temporary buffer for all steps

    for (let s = 0; s < steps; s++) {
      dst.set(src); // copy borders (they never change)
      for (let y = 1; y < this.height - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          const walls =
            src[i - w - 1] + src[i - w] + src[i - w + 1] +
            src[i - 1]                  + src[i + 1] +
            src[i + w - 1] + src[i + w] + src[i + w + 1];
          // Works because CELL.WALL === 1 and CELL.EMPTY === 0 at this stage
          // (food is placed later), so the sum equals the number of walls.
          if (walls > 4) dst[i] = CELL.WALL;
          else if (walls < 4) dst[i] = CELL.EMPTY;
          else dst[i] = src[i];
        }
      }
      const tmp = src; src = dst; dst = tmp; // swap pointers
    }

    // Keep the original buffer object: other code may hold a reference to
    // `this.cells`, so copy the result into it instead of reassigning.
    if (src !== this.cells) {
      this.cells.set(src);
    }
  }

  /**
   * Pass 3: keep only the biggest connected cave.
   *
   * Flood fill (BFS): start at an unvisited open cell, visit every open cell
   * reachable through up/down/left/right moves, and tag them all with the same
   * region id. Repeat until every open cell is tagged.
   *
   * The queue is a preallocated Int32Array with head/tail indices — like a
   * fixed-size ring buffer in C++. Using a JS Array with `shift()` would be
   * O(n) per pop (it moves every element), turning BFS into O(n²).
   * Each cell enters the queue at most once, so size = width * height is enough.
   *
   * @private
   */
  _keepLargestCave() {
    const w = this.width;
    const n = this.cells.length;
    const region = new Int32Array(n); // 0 = not visited yet
    const queue = new Int32Array(n);
    // NEIGHBOUR_OFFSETS: up, down, left, right as flat-index deltas.
    const offsets = new Int32Array([-w, w, -1, 1]);
    let regionId = 0;
    let bestId = 0;
    let bestSize = 0;

    for (let start = 0; start < n; start++) {
      if (this.cells[start] !== CELL.EMPTY || region[start] !== 0) continue;

      regionId++;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      region[start] = regionId;

      while (head < tail) {
        const i = queue[head++];
        // Border cells are walls, so an open cell is never on the edge and
        // i±1, i±w are always inside the array.
        // Offsets are kept in a preallocated array (see NEIGHBOUR_OFFSETS
        // below): creating `[i - w, i + w, ...]` here would allocate a new
        // heap object for every visited cell and feed the garbage collector.
        for (let k = 0; k < 4; k++) {
          const j = i + offsets[k];
          if (this.cells[j] === CELL.EMPTY && region[j] === 0) {
            region[j] = regionId;
            queue[tail++] = j;
          }
        }
      }

      const size = tail; // every cell that entered the queue belongs to this region
      if (size > bestSize) {
        bestSize = size;
        bestId = regionId;
      }
    }

    // Fill every smaller cave with rock.
    for (let i = 0; i < n; i++) {
      if (this.cells[i] === CELL.EMPTY && region[i] !== bestId) {
        this.cells[i] = CELL.WALL;
      }
    }
  }

  /**
   * Pass 4: place round piles of food on open cells.
   * For each pile, pick a random open cell (up to 100 tries), then turn every
   * open cell within CAVE.FOOD_RADIUS (circle: dx² + dy² <= r²) into FOOD.
   * Food never replaces walls, so it is always reachable.
   *
   * @param {() => number} rng - Seeded random function returning [0, 1)
   * @private
   */
  _placeFood(rng) {
    const r = CAVE.FOOD_RADIUS;
    for (let c = 0; c < CAVE.FOOD_CLUSTERS; c++) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const cx = Math.floor(rng() * this.width);
        const cy = Math.floor(rng() * this.height);
        if (this.get(cx, cy) !== CELL.EMPTY) continue;

        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy * dy <= r * r && this.get(cx + dx, cy + dy) === CELL.EMPTY) {
              this.set(cx + dx, cy + dy, CELL.FOOD);
            }
          }
        }
        break;
      }
    }
  }

  /**
   * Counts how many cells have the given type (useful for stats and the HUD).
   *
   * @param {number} type - One of CELL
   * @returns {number} Number of matching cells
   */
  count(type) {
    let total = 0;
    for (let i = 0; i < this.cells.length; i++) {
      if (this.cells[i] === type) total++;
    }
    return total;
  }

  /**
   * Gets the static grid value at a specific position.
   *
   * @param {number} x - The x coordinate (column)
   * @param {number} y - The y coordinate (row)
   * @returns {number|undefined} The value at the specified position, or undefined if out of bounds
   */
  get(x, y) {
    if (!this.isValidPosition(x, y)) {
      return undefined;
    }
    return this.cells[this._index(x, y)];
  }

  /**
   * Sets the static grid value at a specific position.
   * Out-of-bounds writes are ignored. In C++ such a write would be undefined
   * behavior; in JS a typed array silently drops it — or, worse, a wrong
   * x (e.g. x = width) would wrap into the NEXT row. Hence the explicit check.
   *
   * @param {number} x - The x coordinate (column)
   * @param {number} y - The y coordinate (row)
   * @param {number} value - The value to set (one of CELL)
   */
  set(x, y, value) {
    if (!this.isValidPosition(x, y)) {
      return;
    }
    this.cells[this._index(x, y)] = value;
  }

  /**
   * Applies decay to pheromones across the entire grid.
   * Called once per game tick to fade pheromone trails.
   *
   * One linear pass over a contiguous buffer — the most cache-friendly loop
   * possible (like iterating a `std::vector<uint8_t>` by index).
   * Writing a float into a Uint8Array truncates it toward zero.
   */
  decay() {
    const p = this.pheromones;
    for (let i = 0; i < p.length; i++) {
      if (p[i] !== 0) {
        p[i] = p[i] * PHEROMONE_DECAY;
      }
    }
  }

  /**
   * Gets the pheromone value at a specific position.
   *
   * @param {number} x - The x coordinate (column)
   * @param {number} y - The y coordinate (row)
   * @returns {number} The pheromone intensity (0-255), 0 if out of bounds
   */
  getPheromone(x, y) {
    if (!this.isValidPosition(x, y)) {
      return 0;
    }
    return this.pheromones[this._index(x, y)];
  }

  /**
   * Sets the pheromone value at a specific position.
   * The value is clamped to [0, MAX_PHEROMONE] explicitly: a plain Uint8Array
   * would wrap 300 to 44 (300 % 256), the same overflow as `(uint8_t)300` in C++.
   *
   * @param {number} x - The x coordinate (column)
   * @param {number} y - The y coordinate (row)
   * @param {number} value - The pheromone intensity (0-255)
   */
  setPheromone(x, y, value) {
    if (!this.isValidPosition(x, y)) {
      return;
    }
    // NaN fails both comparisons; treat it as 0.
    const clamped = value > MAX_PHEROMONE ? MAX_PHEROMONE : value > 0 ? value : 0;
    this.pheromones[this._index(x, y)] = clamped;
  }

  /**
   * Gets the value at a specific grid position (legacy method, use get() instead).
   *
   * @param {number} x - The x coordinate (column)
   * @param {number} y - The y coordinate (row)
   * @returns {number|undefined} The value at the specified position
   */
  getCell(x, y) {
    return this.get(x, y);
  }

  /**
   * Sets the value at a specific grid position (legacy method, use set() instead).
   *
   * @param {number} x - The x coordinate (column)
   * @param {number} y - The y coordinate (row)
   * @param {number} value - The value to set
   */
  setCell(x, y, value) {
    this.set(x, y, value);
  }

  /**
   * Checks if the given coordinates are within grid bounds.
   * Also rejects non-integers: `cells[1.5]` would not throw in JS, it would
   * just read a nonexistent property and return undefined.
   *
   * @param {number} x - The x coordinate (column)
   * @param {number} y - The y coordinate (row)
   * @returns {boolean} True if coordinates are valid, false otherwise
   */
  isValidPosition(x, y) {
    return (
      Number.isInteger(x) && Number.isInteger(y) &&
      x >= 0 && x < this.width &&
      y >= 0 && y < this.height
    );
  }

  /**
   * Gets the width of the grid.
   *
   * @returns {number} The width of the grid
   */
  getWidth() {
    return this.width;
  }

  /**
   * Gets the height of the grid.
   *
   * @returns {number} The height of the grid
   */
  getHeight() {
    return this.height;
  }

  /**
   * Clears all cells in the grid (sets them to a default value).
   * Pheromones are always reset to 0.
   * `TypedArray.fill` is the JS equivalent of `memset` / `std::fill`:
   * it reuses the existing buffer, no new allocation.
   *
   * @param {number} defaultValue - The default value to set (default: CELL.EMPTY)
   */
  clear(defaultValue = CELL.EMPTY) {
    this.cells.fill(defaultValue);
    this.pheromones.fill(0);
  }

  /**
   * Converts the grid into a plain JSON-safe object (for Save).
   * The seed alone is NOT enough: eaten food and pheromone trails change the
   * map after generation, so both byte layers are stored (as base64 text).
   *
   * @returns {{width: number, height: number, seed: number|null, cells: string, pheromones: string}}
   */
  serialize() {
    return {
      width: this.width,
      height: this.height,
      seed: this.seed,
      cells: bytesToBase64(this.cells),
      pheromones: bytesToBase64(this.pheromones),
    };
  }

  /**
   * Builds a Grid from data produced by serialize() (for Load).
   *
   * The data comes from localStorage, which the user (or another version of
   * this app) can change freely, so it is treated as UNTRUSTED input: every
   * field is checked and anything wrong throws an Error. Never "fix up" bad
   * data silently — a half-valid map would cause bugs far away from here.
   *
   * @param {*} data
   * @returns {Grid} A new Grid (the current one is not touched)
   * @throws {Error} If the data is malformed
   */
  static deserialize(data) {
    if (typeof data !== 'object' || data === null) {
      throw new Error('grid: not an object');
    }
    const { width, height, seed, cells, pheromones } = data;
    // The constructor validates width/height (positive integers).
    // Upper bound stops a crafted save from allocating gigabytes.
    if (width * height > 4_000_000) {
      throw new Error('grid: too large');
    }
    const grid = new Grid(width, height);

    if (seed !== null && !(Number.isInteger(seed) && seed >= 0 && seed <= 0xFFFFFFFF)) {
      throw new Error('grid: bad seed');
    }
    if (typeof cells !== 'string' || typeof pheromones !== 'string') {
      throw new Error('grid: layers must be base64 strings');
    }

    const cellBytes = base64ToBytes(cells);
    const pheromoneBytes = base64ToBytes(pheromones);
    if (cellBytes.length !== grid.cells.length || pheromoneBytes.length !== grid.pheromones.length) {
      throw new Error('grid: layer size does not match width * height');
    }
    const valid = new Set(Object.values(CELL));
    for (let i = 0; i < cellBytes.length; i++) {
      if (!valid.has(cellBytes[i])) {
        throw new Error(`grid: unknown cell value ${cellBytes[i]} at index ${i}`);
      }
    }

    grid.cells.set(cellBytes);
    grid.pheromones.set(pheromoneBytes); // any byte 0..255 is a valid intensity
    grid.seed = seed;
    return grid;
  }
}
