/**
 * @fileoverview State class - Central state object that holds the "World Truth".
 * Similar to a global state structure in C++ that maintains all game data.
 *
 * The State is the only place that both sees the whole map AND moves ants.
 * Ants (and their algorithms) only get a small View and return an Action;
 * the State checks the Action and applies it. Think of it as a server that
 * never trusts its clients: an algorithm bug cannot move an ant into a wall.
 *
 * @class State
 */
import { Grid } from './Grid.js';
import { Ant } from '../entities/Ant.js';
import {
  WORLD_SIZE, ANT_COUNT, CELL, TEAM_COUNT, NEST_TARGETS, NO_PATH, SAVE_KEY, SAVE_VERSION, COMBAT,
} from '../config.js';
import { createRng } from '../utils/random.js';

/**
 * @typedef {import('../types.js').View} View
 * @typedef {import('../types.js').Action} Action
 */

export class State {
  /**
   * Creates a new State instance.
   */
  constructor() {
    this.grid = new Grid(WORLD_SIZE, WORLD_SIZE);
    /** @type {Ant[]} */
    this.ants = [];

    /** Next free ant id (ids are never reused, like an auto-increment key). */
    this.nextAntId = 0;

    /** Number of update() calls since init — the simulation "clock". */
    this.tick = 0;

    /**
     * Nest position of each team (index = teamId), or null if the map had no
     * open cell for it.
     * @type {Array<{x: number, y: number} | null>}
     */
    this.nests = [];

    /**
     * Food delivered to the nest, per team (index = teamId).
     * @type {number[]}
     */
    this.scores = new Array(TEAM_COUNT).fill(0);

    /**
     * Ants lost in combat, per team (index = teamId).
     * @type {number[]}
     */
    this.deaths = new Array(TEAM_COUNT).fill(0);

    /**
     * Spatial index "which ants stand on cell i", rebuilt every tick.
     * An intrusive singly linked list stored in two flat arrays — the classic
     * C/C++ trick that avoids allocating a list object per cell:
     *   cellHead[cell] = index of the first ant on that cell (-1 = empty)
     *   antNext[i]     = index of the next ant on the same cell (-1 = end)
     * Finding the neighbours of an ant is then 9 short lists instead of a
     * scan over all ants: O(n) per tick instead of O(n²) — with 1000 ants
     * that is ~9 000 checks instead of ~1 000 000.
     */
    this.cellHead = new Int32Array(0);
    this.antNext = new Int32Array(0);
    /** Damage per ant for the current tick (see _resolveCombat). */
    this.damageBuf = new Int32Array(0);

    /**
     * Per team: walking distance from every cell to that team's nest
     * (the "nest scent", see View.homeDist). Computed once in init(),
     * because walls never change. Index = teamId, then y * width + x.
     * @type {Uint16Array[]}
     */
    this.homeDist = [];

    /**
     * Seeded PRNG for everything random during the simulation (View.random).
     * Re-created in init() from the map seed, so one seed = one exact replay.
     * @type {() => number}
     */
    this.rng = createRng(0);

    /**
     * One reusable View, filled for each ant in turn (see types.js).
     * Allocated once: 2 small typed arrays instead of 2 * ants * 20 per second.
     * All fields are created here, in a fixed order, so V8 gives the object one
     * stable "hidden class" (like a fixed C++ struct layout) and property
     * access stays fast.
     * @type {View}
     */
    this.view = {
      cells: new Uint8Array(9),
      pheromones: new Uint8Array(9),
      teamId: 0,
      carrying: false,
      homeDist: new Uint16Array(9),
      enemies: new Uint8Array(9),
      allies: new Uint8Array(9),
      health: 0,
      random: 0,
      memory: 0,
    };
  }

  /**
   * Initializes the game state (spawns ants, generates level).
   * Similar to an initialization function in C++: `void init(uint32_t seed)`
   *
   * @param {number} [seed] - Map seed; random if omitted
   */
  init(seed) {
    // Generate the level
    this.grid.generateLevel(seed);

    // Separate random stream for the simulation, derived from the map seed.
    // XOR with a constant so it does not repeat the map generator's numbers.
    this.rng = createRng(this.grid.seed ^ 0x9E3779B9);
    this.scores.fill(0);
    this.deaths.fill(0);

    // Place one nest per team, then spawn ants around it.
    this.nests = [];
    for (let team = 0; team < TEAM_COUNT; team++) {
      const target = NEST_TARGETS[team];
      this.nests.push(this._findNest(
        Math.floor(target.x * this.grid.getWidth()),
        Math.floor(target.y * this.grid.getHeight()),
      ));
    }

    // Nest scent: one distance map per team.
    this.homeDist = this.nests.map((nest) => this._distanceField(nest));

    // Split ANT_COUNT between teams: 50 -> 25 + 25, 51 -> 26 + 25.
    for (let team = 0; team < TEAM_COUNT; team++) {
      const nest = this.nests[team];
      if (!nest) continue; // no room on this map
      const count = Math.floor(ANT_COUNT / TEAM_COUNT) + (team < ANT_COUNT % TEAM_COUNT ? 1 : 0);
      const spots = this._spawnSpots(nest, count);
      for (let i = 0; i < count; i++) {
        const spot = spots[i % spots.length];
        this.addAnt(new Ant(spot.x, spot.y, this.nextAntId++, team));
      }
    }
  }

  /**
   * Finds the open (EMPTY) cell closest to (tx, ty).
   * A simple linear scan over all cells: O(width * height), run once per
   * nest at startup, so there is no need for anything smarter.
   * Distance is compared squared (dx² + dy²) — no Math.sqrt needed to compare.
   *
   * @param {number} tx - Target x
   * @param {number} ty - Target y
   * @returns {{x: number, y: number} | null} Nearest open cell, or null if none
   * @private
   */
  _findNest(tx, ty) {
    let best = null;
    let bestDist = Infinity;
    for (let y = 0; y < this.grid.getHeight(); y++) {
      for (let x = 0; x < this.grid.getWidth(); x++) {
        if (this.grid.get(x, y) !== CELL.EMPTY) continue;
        const d = (x - tx) * (x - tx) + (y - ty) * (y - ty);
        if (d < bestDist) {
          bestDist = d;
          best = { x, y };
        }
      }
    }
    return best;
  }

  /**
   * Builds the "nest scent" map: walking distance (in moves) from every cell
   * to `nest`, going around walls. Same BFS idea as Grid._keepLargestCave,
   * but storing the step count instead of a region id. 8 neighbours, because
   * ants may also move diagonally.
   *
   * Uint16Array: distances in a 100x100 cave can exceed 255, so one byte is
   * not enough; 2 bytes (max 65 535) is plenty. Unreached cells stay NO_PATH.
   *
   * @param {{x: number, y: number} | null} nest
   * @returns {Uint16Array} Distance per cell (index y * width + x)
   * @private
   */
  _distanceField(nest) {
    const w = this.grid.getWidth();
    const h = this.grid.getHeight();
    const dist = new Uint16Array(w * h).fill(NO_PATH);
    if (!nest) return dist;

    const queue = new Int32Array(w * h); // preallocated ring-buffer style queue
    let head = 0;
    let tail = 0;
    const start = nest.y * w + nest.x;
    dist[start] = 0;
    queue[tail++] = start;

    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          const cell = this.grid.get(nx, ny);
          if (cell === undefined || cell === CELL.WALL) continue;
          const j = ny * w + nx;
          if (dist[j] !== NO_PATH) continue;
          dist[j] = dist[i] + 1;
          queue[tail++] = j;
        }
      }
    }
    return dist;
  }

  /**
   * Collects up to `count` open cells nearest to the nest (by walking
   * distance), using BFS — the same flood fill idea as in Grid, but stopping
   * early. Ants spawn on these cells, one per cell. If the cave is smaller than
   * `count`, the caller wraps around and several ants share a cell.
   *
   * @param {{x: number, y: number}} nest
   * @param {number} count
   * @returns {Array<{x: number, y: number}>} At least one spot (the nest itself)
   * @private
   */
  _spawnSpots(nest, count) {
    const w = this.grid.getWidth();
    const visited = new Uint8Array(w * this.grid.getHeight());
    const queue = [nest]; // small and short-lived, a plain array is fine here
    let head = 0;          // index instead of queue.shift() (shift is O(n))
    visited[nest.y * w + nest.x] = 1;
    const spots = [];

    while (head < queue.length && spots.length < count) {
      const { x, y } = queue[head++];
      if (this.grid.get(x, y) === CELL.EMPTY) spots.push({ x, y });

      // 4 neighbours; walls block the flood (food does not)
      const next = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      for (const [nx, ny] of next) {
        const cell = this.grid.get(nx, ny);
        if (cell === undefined || cell === CELL.WALL || visited[ny * w + nx]) continue;
        visited[ny * w + nx] = 1;
        queue.push({ x: nx, y: ny });
      }
    }
    return spots.length > 0 ? spots : [nest];
  }

  /**
   * Updates the game state for one game tick.
   * Similar to an update function in C++: `void update()`
   *
   * Order matters:
   *   1. Pheromones fade (so trails written this tick start at full strength).
   *   2. Each live ant looks around (View), decides (Action), State applies it,
   *      then food rules run (pick up / deliver).
   *   3. Combat: every ant takes damage from adjacent enemies (simultaneously).
   *   4. Dead ants are removed from the array.
   *
   * Ants move one after another (in array order), not all at once, so an ant
   * later in the array already sees food picked up by an earlier one.
   * The ants listed in a View (enemies/allies) are a snapshot from the START
   * of the tick, like a radar image taken once per turn.
   */
  update() {
    this.tick++;

    // 1. Process pheromone decay
    this.grid.decay();

    // Snapshot of who stands where (for View.enemies / View.allies)
    this._buildOccupancy();

    // 2. Update all ants
    // Indexed loop: fastest form in V8, and ants appended during the loop
    // (none yet) would also get their turn.
    for (let i = 0; i < this.ants.length; i++) {
      const ant = this.ants[i];
      if (!ant.isAlive()) continue;
      this._fillView(ant);
      const action = ant.update(this.view);
      this._applyAction(ant, action);
      this._handleFood(ant);
    }

    // 3. Combat (positions after all moves)
    this._resolveCombat();

    // 4. Remove dead ants
    this._removeDead();
  }

  /**
   * Rebuilds the spatial index (cellHead / antNext) from current positions.
   * Buffers are reused between ticks and only grow when needed — doubling the
   * capacity like `std::vector` does, so growth happens rarely.
   *
   * @private
   */
  _buildOccupancy() {
    const w = this.grid.getWidth();
    const cellCount = w * this.grid.getHeight();
    if (this.cellHead.length !== cellCount) {
      this.cellHead = new Int32Array(cellCount);
    }
    if (this.antNext.length < this.ants.length) {
      this.antNext = new Int32Array(Math.max(64, this.ants.length * 2));
    }
    this.cellHead.fill(-1);
    for (let i = 0; i < this.ants.length; i++) {
      const ant = this.ants[i];
      if (!ant.isAlive()) continue;
      const c = ant.getY() * w + ant.getX();
      this.antNext[i] = this.cellHead[c]; // push to the front of the cell's list
      this.cellHead[c] = i;
    }
  }

  /**
   * Combat step. Two passes, so the result does not depend on ant order:
   *   pass 1 — for every ant, count enemies in its 3x3 area (= its damage);
   *   pass 2 — apply all damage at once.
   * If damage were applied immediately, an ant killed early in pass 1 would
   * not hit back, and whoever is first in the array would win every duel.
   *
   * A dying ant that carried food drops it on its cell (if the cell is free),
   * so the food is not lost — the winner can pick it up.
   *
   * @private
   */
  _resolveCombat() {
    this._buildOccupancy();
    const ants = this.ants;
    const w = this.grid.getWidth();
    if (this.damageBuf.length < ants.length) {
      this.damageBuf = new Int32Array(Math.max(64, ants.length * 2));
    }
    const damage = this.damageBuf;

    // Pass 1: count adjacent enemies
    for (let i = 0; i < ants.length; i++) {
      damage[i] = 0;
      const ant = ants[i];
      if (!ant.isAlive()) continue;
      const team = ant.getTeamId();
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = ant.getX() + dx;
          const y = ant.getY() + dy;
          if (!this.grid.isValidPosition(x, y)) continue;
          for (let j = this.cellHead[y * w + x]; j !== -1; j = this.antNext[j]) {
            if (ants[j].getTeamId() !== team) damage[i]++;
          }
        }
      }
    }

    // Pass 2: apply damage
    for (let i = 0; i < ants.length; i++) {
      if (damage[i] === 0) continue;
      const ant = ants[i];
      ant.damage(damage[i]);
      if (ant.isAlive()) continue;
      this.deaths[ant.getTeamId()]++;
      if (ant.isCarrying()) {
        ant.carrying = false;
        if (this.grid.get(ant.getX(), ant.getY()) === CELL.EMPTY) {
          this.grid.set(ant.getX(), ant.getY(), CELL.FOOD);
        }
      }
    }
  }

  /**
   * Fills the shared View with the 3x3 neighbourhood of `ant`.
   * Out-of-map cells are reported as walls.
   *
   * @param {Ant} ant
   * @private
   */
  _fillView(ant) {
    const v = this.view;
    v.teamId = ant.getTeamId();
    v.carrying = ant.isCarrying();
    v.random = this.rng();
    v.memory = ant.memory;
    v.health = ant.getHealth();
    const home = this.homeDist[v.teamId];
    const w = this.grid.getWidth();
    let k = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = ant.getX() + dx;
        const y = ant.getY() + dy;
        const cell = this.grid.get(x, y);
        v.cells[k] = cell === undefined ? CELL.WALL : cell;
        v.pheromones[k] = this.grid.getPheromone(x, y);
        v.homeDist[k] = cell === undefined || !home ? NO_PATH : home[y * w + x];
        let enemies = 0;
        let allies = 0;
        if (cell !== undefined) {
          for (let j = this.cellHead[y * w + x]; j !== -1; j = this.antNext[j]) {
            const other = this.ants[j];
            if (other === ant) continue;
            if (other.getTeamId() === v.teamId) allies++;
            else enemies++;
          }
        }
        v.enemies[k] = Math.min(enemies, 255);
        v.allies[k] = Math.min(allies, 255);
        k++;
      }
    }
  }

  /**
   * Validates and applies an Action.
   * - null/undefined: the ant stays.
   * - dx, dy must each be -1, 0 or 1 (anything else is ignored as invalid).
   * - pheromone (optional) is left on the ant's current cell, keeping the
   *   stronger of the old and new values (two ants on one trail reinforce it
   *   instead of the second one erasing it).
   * - Moving into a wall or off the map is blocked; the ant stays in place.
   *
   * @param {Ant} ant
   * @param {Action|null|undefined} action
   * @private
   */
  _applyAction(ant, action) {
    if (!action) return;
    const { dx, dy, pheromone, memory } = action;

    // Memory is saved even if the move itself turns out invalid.
    if (Number.isInteger(memory) && memory >= 0 && memory <= 255) {
      ant.memory = memory;
    }

    if (!State._isStep(dx) || !State._isStep(dy)) return;

    const x = ant.getX();
    const y = ant.getY();

    if (typeof pheromone === 'number' && pheromone > 0) {
      this.grid.setPheromone(x, y, Math.max(this.grid.getPheromone(x, y), pheromone));
    }

    const target = this.grid.get(x + dx, y + dy);
    if (target === undefined || target === CELL.WALL) return;
    ant.moveTo(x + dx, y + dy);
  }

  /**
   * Food rules, run after the ant's move (see types.js, Action):
   *   - not carrying + standing on FOOD -> pick it up, the cell becomes EMPTY;
   *   - carrying + within 1 cell of own nest -> deliver, team score + 1.
   *
   * @param {Ant} ant
   * @private
   */
  _handleFood(ant) {
    const x = ant.getX();
    const y = ant.getY();
    if (!ant.carrying) {
      if (this.grid.get(x, y) === CELL.FOOD) {
        this.grid.set(x, y, CELL.EMPTY);
        ant.carrying = true;
      }
      return;
    }
    const nest = this.nests[ant.getTeamId()];
    if (nest && Math.abs(nest.x - x) <= 1 && Math.abs(nest.y - y) <= 1) {
      ant.carrying = false;
      this.scores[ant.getTeamId()]++;
    }
  }

  /**
   * True for -1, 0 and 1 only (rejects 2, 0.5, NaN, "1", undefined...).
   *
   * @param {*} d
   * @returns {boolean}
   * @private
   */
  static _isStep(d) {
    return d === -1 || d === 0 || d === 1;
  }

  /**
   * Removes dead ants in place, without allocating a new array.
   * This is the C++ erase-remove idiom:
   * ```cpp
   * ants.erase(std::remove_if(ants.begin(), ants.end(),
   *            [](const Ant& a) { return !a.isAlive(); }), ants.end());
   * ```
   * `ants.filter(...)` would also work, but creates a new array every tick.
   *
   * @private
   */
  _removeDead() {
    const ants = this.ants;
    let write = 0;
    for (let read = 0; read < ants.length; read++) {
      if (ants[read].isAlive()) {
        ants[write++] = ants[read];
      }
    }
    ants.length = write; // truncate, like vector::resize
  }

  /**
   * Gets the game grid.
   *
   * @returns {Grid} The game grid
   */
  getGrid() {
    return this.grid;
  }

  /**
   * Gets all ants in the simulation.
   *
   * @returns {Ant[]} Array of all ants
   */
  getAnts() {
    return this.ants;
  }

  /**
   * Gets the nest positions (index = teamId).
   *
   * @returns {Array<{x: number, y: number} | null>}
   */
  getNests() {
    return this.nests;
  }

  /**
   * Gets the food delivered per team (index = teamId).
   *
   * @returns {number[]}
   */
  getScores() {
    return this.scores;
  }

  /**
   * Gets the ants lost in combat per team (index = teamId).
   *
   * @returns {number[]}
   */
  getDeaths() {
    return this.deaths;
  }

  /**
   * Gets the number of ticks since init.
   *
   * @returns {number}
   */
  getTick() {
    return this.tick;
  }

  /**
   * Adds an ant to the simulation.
   *
   * @param {Ant} ant - The ant to add
   */
  addAnt(ant) {
    this.ants.push(ant);
  }

  /**
   * Removes an ant from the simulation.
   *
   * @param {number} antId - The ID of the ant to remove
   */
  removeAnt(antId) {
    this.ants = this.ants.filter(ant => ant.getId() !== antId);
  }

  /**
   * Converts the whole world into a plain, JSON-safe object.
   * Everything needed to continue EXACTLY where we stopped is included,
   * including the PRNG state: after Load the game plays out the same way it
   * would have without saving.
   * Not saved: homeDist (recomputed from walls + nests on load).
   *
   * @returns {Object} Snapshot (see restore() for the format checks)
   */
  serialize() {
    return {
      version: SAVE_VERSION,
      tick: this.tick,
      nextAntId: this.nextAntId,
      rngState: this.rng.getState(),
      scores: [...this.scores],
      deaths: [...this.deaths],
      nests: this.nests.map((n) => (n ? { x: n.x, y: n.y } : null)),
      grid: this.grid.serialize(),
      ants: this.ants.map((a) => ({
        x: a.getX(),
        y: a.getY(),
        id: a.getId(),
        teamId: a.getTeamId(),
        carrying: a.isCarrying(),
        memory: a.memory,
        health: a.getHealth(),
      })),
    };
  }

  /**
   * Replaces the current world with a snapshot from serialize().
   *
   * All-or-nothing: everything is parsed and checked into local variables
   * first and only then assigned to `this`. If any check throws, the running
   * game is left exactly as it was — the same idea as the "strong exception
   * guarantee" in C++ (build the new object, then swap).
   *
   * @param {*} data - Untrusted snapshot (e.g. from localStorage)
   * @throws {Error} If the snapshot is malformed (the state is unchanged)
   */
  restore(data) {
    const isUint = (v, max = Number.MAX_SAFE_INTEGER) => Number.isInteger(v) && v >= 0 && v <= max;
    if (typeof data !== 'object' || data === null) throw new Error('save: not an object');
    if (data.version !== SAVE_VERSION) {
      throw new Error(`save: version ${data.version} is not supported (expected ${SAVE_VERSION})`);
    }

    const grid = Grid.deserialize(data.grid);
    const isOpenCell = (x, y) => {
      const c = grid.get(x, y);
      return c !== undefined && c !== CELL.WALL;
    };

    if (!isUint(data.tick)) throw new Error('save: bad tick');
    if (!isUint(data.nextAntId)) throw new Error('save: bad nextAntId');
    if (!isUint(data.rngState, 0xFFFFFFFF)) throw new Error('save: bad rngState');

    if (!Array.isArray(data.scores) || data.scores.length !== TEAM_COUNT || !data.scores.every((s) => isUint(s))) {
      throw new Error('save: bad scores');
    }
    if (!Array.isArray(data.deaths) || data.deaths.length !== TEAM_COUNT || !data.deaths.every((s) => isUint(s))) {
      throw new Error('save: bad deaths');
    }

    if (!Array.isArray(data.nests) || data.nests.length !== TEAM_COUNT) throw new Error('save: bad nests');
    const nests = data.nests.map((n, team) => {
      if (n === null) return null;
      if (typeof n !== 'object' || !isOpenCell(n.x, n.y)) throw new Error(`save: bad nest for team ${team}`);
      return { x: n.x, y: n.y };
    });

    if (!Array.isArray(data.ants) || data.ants.length > grid.cells.length * 4) throw new Error('save: bad ants');
    const ids = new Set();
    const ants = data.ants.map((a, i) => {
      if (typeof a !== 'object' || a === null) throw new Error(`save: ant #${i} is not an object`);
      if (!isOpenCell(a.x, a.y)) throw new Error(`save: ant #${i} is outside the map or in a wall`);
      if (!isUint(a.id) || a.id >= data.nextAntId || ids.has(a.id)) throw new Error(`save: ant #${i} has a bad id`);
      if (!isUint(a.teamId, TEAM_COUNT - 1)) throw new Error(`save: ant #${i} has a bad team`);
      if (typeof a.carrying !== 'boolean') throw new Error(`save: ant #${i} has a bad carrying flag`);
      if (!isUint(a.memory, 255)) throw new Error(`save: ant #${i} has bad memory`);
      if (!isUint(a.health, COMBAT.MAX_HEALTH) || a.health === 0) throw new Error(`save: ant #${i} has bad health`);
      ids.add(a.id);
      const ant = new Ant(a.x, a.y, a.id, a.teamId);
      ant.carrying = a.carrying;
      ant.memory = a.memory;
      ant.health = a.health;
      return ant;
    });

    // --- Everything is valid: commit ("swap") ---
    this.grid = grid;
    this.tick = data.tick;
    this.nextAntId = data.nextAntId;
    this.scores = [...data.scores];
    this.deaths = [...data.deaths];
    this.rng = createRng(0);
    this.rng.setState(data.rngState);
    this.nests = nests;
    this.homeDist = nests.map((nest) => this._distanceField(nest));
    this.ants = ants;
  }

  /**
   * Returns window.localStorage, or the storage passed in (tests pass a fake
   * object with the same getItem/setItem methods — dependency injection,
   * like passing an interface reference in C++).
   * Note: merely READING `window.localStorage` can throw (SecurityError) when
   * the browser blocks storage, so callers do this inside try/catch.
   *
   * @param {Storage} [storage]
   * @returns {Storage}
   * @private
   */
  static _storage(storage) {
    return storage ?? window.localStorage;
  }

  /**
   * Saves the current state to localStorage.
   * Can fail: storage disabled (private mode / settings) or full
   * (QuotaExceededError, the limit is ~5 MB per origin). A save is ~30 KB.
   *
   * @param {Storage} [storage] - Defaults to window.localStorage
   * @returns {boolean} True if save was successful, false otherwise
   */
  save(storage) {
    try {
      State._storage(storage).setItem(SAVE_KEY, JSON.stringify(this.serialize()));
      return true;
    } catch (err) {
      console.warn('Save failed:', err);
      return false;
    }
  }

  /**
   * Loads state from localStorage.
   * Uses JSON.parse, never eval(): parsing data cannot run code. On any
   * problem (no save, broken JSON, failed checks) the current game continues
   * unchanged and false is returned.
   *
   * @param {Storage} [storage] - Defaults to window.localStorage
   * @returns {boolean} True if load was successful, false otherwise
   */
  load(storage) {
    try {
      const text = State._storage(storage).getItem(SAVE_KEY);
      if (text === null) return false; // nothing saved yet
      this.restore(JSON.parse(text));
      return true;
    } catch (err) {
      console.warn('Load failed:', err);
      return false;
    }
  }

  /**
   * Checks whether a saved game exists.
   *
   * @param {Storage} [storage] - Defaults to window.localStorage
   * @returns {boolean}
   */
  hasSave(storage) {
    try {
      return State._storage(storage).getItem(SAVE_KEY) !== null;
    } catch {
      return false;
    }
  }

  /**
   * Resets the state to initial values.
   *
   * @param {number} [seed] - Map seed for the new world; random if omitted
   */
  reset(seed) {
    this.ants = [];
    this.nextAntId = 0;
    this.tick = 0;
    this.grid.clear();
    this.init(seed);
  }
}
