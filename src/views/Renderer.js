/**
 * @fileoverview Renderer class - Handles all canvas rendering operations.
 * Similar to a graphics renderer in C++ that translates game state to pixels.
 *
 * Rendering pipeline (per frame):
 *   1. Grid -> pixel buffer: ONE pixel per cell is written into a small
 *      `width x height` ImageData (100x100 = 10 000 pixels), via a Uint32Array
 *      view so a whole RGBA pixel is written in one store.
 *   2. The small buffer is uploaded to an off-screen canvas and drawn scaled
 *      up by `cellSize` with `drawImage` (nearest-neighbour, no smoothing).
 *      Scaling is done by the browser/GPU — like rendering to a low-res
 *      texture in SDL/OpenGL and stretching it to the window.
 *   3. Ants are drawn on top as rectangles, batched per team.
 *   4. The toolbar (HUD) is drawn BELOW the map, in its own strip.
 *
 * Writing 8x8 pixels per cell by hand into an 800x800 ImageData would be
 * 640 000 pixel writes per frame; this approach does 10 000.
 *
 * @class Renderer
 */
import { WORLD_SIZE, CELL, MAX_PHEROMONE, COMBAT } from '../config.js';

/**
 * Height of the HUD strip under the map, in pixels.
 * @type {number}
 * @constant
 */
export const TOOLBAR_HEIGHT = 60;

/**
 * Byte order of this CPU. A Uint32Array view on ImageData writes 4 bytes at
 * once, so the channel order depends on endianness — exactly like
 * `*reinterpret_cast<uint32_t*>(&pixels[i]) = color;` in C++.
 * Practically every browser runs little-endian (x86, ARM), but we check
 * instead of assuming.
 * @type {boolean}
 */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/**
 * Packs r, g, b, a (0-255 each) into one 32-bit pixel matching ImageData's
 * RGBA byte order on this CPU.
 *
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} [a=255]
 * @returns {number} Unsigned 32-bit packed color
 */
function packColor(r, g, b, a = 255) {
  return LITTLE_ENDIAN
    ? ((a << 24) | (b << 16) | (g << 8) | r) >>> 0
    : ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

/**
 * Color palette. Arrays are [r, g, b].
 * @readonly
 */
const PALETTE = Object.freeze({
  floor: [27, 23, 18],
  wall: [90, 90, 100],
  food: [63, 191, 79],
  pheromone: [190, 110, 255],
  unknown: [255, 0, 255], // magenta: a cell value we do not know how to draw (debug aid)
  teams: ['#4da3ff', '#ff5a4d'], // index = teamId (0 = Blue, 1 = Red)
  teamsWounded: ['#24578f', '#8f2a22'], // darker shade for ants with health < max
  teamNames: ['Blue', 'Red'],
});

export class Renderer {
  /**
   * Creates a new Renderer instance.
   *
   * @param {HTMLCanvasElement} canvas - The canvas element to render to
   * @param {number} cellSize - The size of each grid cell in pixels
   */
  constructor(canvas, cellSize) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cellSize = cellSize;

    // Off-screen canvas holding the 1-pixel-per-cell image of the grid.
    // Allocated once and reused every frame (no per-frame garbage).
    this.buffer = document.createElement('canvas');
    this.bufferCtx = this.buffer.getContext('2d');

    // Precomputed colors (computed once, like a static palette table in C++).
    this.wallColor = packColor(...PALETTE.wall);
    this.foodColor = packColor(...PALETTE.food);
    this.unknownColor = packColor(...PALETTE.unknown);

    // Lookup table: pheromone intensity (0..255) -> color of an empty cell.
    // Instead of blending colors 10 000 times per frame, we blend 256 times
    // here and then just index the table: `pixels[i] = lut[pheromone]`.
    this.pheromoneLut = new Uint32Array(MAX_PHEROMONE + 1);
    for (let p = 0; p <= MAX_PHEROMONE; p++) {
      const t = (p / MAX_PHEROMONE) * 0.85; // never fully hides the floor
      const [fr, fg, fb] = PALETTE.floor;
      const [pr, pg, pb] = PALETTE.pheromone;
      this.pheromoneLut[p] = packColor(
        Math.round(fr + (pr - fr) * t),
        Math.round(fg + (pg - fg) * t),
        Math.round(fb + (pb - fb) * t),
      );
    }

    // FPS counter state (exponential moving average).
    this.lastFrameTime = 0;
    this.fps = 0;

    // Sets canvas size and allocates the pixel buffer.
    this.resize(WORLD_SIZE, WORLD_SIZE);
  }

  /**
   * Draws the toolbar UI with game information.
   * Similar to drawing a HUD in C++: `void drawHUD()`
   *
   * Security note: `fillText` draws plain text pixels and never parses HTML,
   * so even if a stat came from user input it could not inject a <script>
   * (unlike `element.innerHTML = text`, which is an XSS risk).
   *
   * @param {Object} [stats] - Values to display
   * @param {number[]} [stats.antsPerTeam] - Live ant count per team
   * @param {number[]} [stats.scores] - Food delivered per team
   * @param {number[]} [stats.deaths] - Ants lost in combat per team
   * @param {number} [stats.food] - Number of food cells left
   * @param {number} [stats.tick] - Simulation tick
   * @param {number|null} [stats.seed] - Map seed
   * @param {number} [stats.fps] - Frames per second
   */
  drawToolbar(stats = {}) {
    const toolbarY = this.canvas.height - TOOLBAR_HEIGHT;

    // Draw toolbar background
    this.ctx.fillStyle = '#2a2a2a';
    this.ctx.fillRect(0, toolbarY, this.canvas.width, TOOLBAR_HEIGHT);

    // Draw border. A stroke is centered on the path, so a 2px line at
    // y = toolbarY would cover toolbarY-1..toolbarY+1 and eat the map's last
    // pixel row. Inset the rectangle by half the line width to keep it inside.
    this.ctx.strokeStyle = '#444';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(1, toolbarY + 1, this.canvas.width - 2, TOOLBAR_HEIGHT - 2);

    this.ctx.font = '14px monospace';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'middle';

    const line1 = toolbarY + TOOLBAR_HEIGHT / 3;
    const line2 = toolbarY + (TOOLBAR_HEIGHT * 2) / 3;

    // Line 1: title + team counts, each in its team color
    this.ctx.fillStyle = '#fff';
    this.ctx.fillText('Hive Mind Simulation', 10, line1);
    let x = 220;
    const counts = stats.antsPerTeam ?? [];
    const scores = stats.scores ?? [];
    const deaths = stats.deaths ?? [];
    for (let team = 0; team < PALETTE.teams.length; team++) {
      const text = `${PALETTE.teamNames[team]}: ${counts[team] ?? 0} ants, ${scores[team] ?? 0} food, ${deaths[team] ?? 0} lost`;
      this.ctx.fillStyle = PALETTE.teams[team];
      this.ctx.fillText(text, x, line1);
      x += this.ctx.measureText(text).width + 24;
    }

    // Line 2: world info
    this.ctx.fillStyle = '#aaa';
    const seed = stats.seed ?? '-';
    const food = stats.food ?? 0;
    const fps = Math.round(stats.fps ?? 0);
    const tick = stats.tick ?? 0;
    this.ctx.fillText(`Food left: ${food}   Tick: ${tick}   Seed: ${seed}   FPS: ${fps}`, 10, line2);
  }

  /**
   * Renders the entire game state to the canvas.
   * This is called once per frame in the game loop.
   *
   * @param {Grid} grid - The game grid to render
   * @param {Ant[]} ants - Array of all ants to render
   * @param {Object} [info] - Extra world info from the State
   * @param {number[]} [info.scores] - Food delivered per team
   * @param {number[]} [info.deaths] - Ants lost in combat per team
   * @param {Array<{x: number, y: number} | null>} [info.nests] - Nest per team
   * @param {number} [info.tick] - Simulation tick
   */
  render(grid, ants, info = {}) {
    this._updateFps();

    const w = grid.getWidth();
    const h = grid.getHeight();
    if (w !== this.gridWidth || h !== this.gridHeight) {
      this.resize(w, h);
    }

    const food = this._renderGrid(grid);
    this._renderNests(info.nests ?? []);
    const antsPerTeam = this._renderAnts(ants);

    this.drawToolbar({
      antsPerTeam,
      scores: info.scores,
      deaths: info.deaths,
      food,
      tick: info.tick,
      seed: grid.seed,
      fps: this.fps,
    });
  }

  /**
   * Draws each nest as a 3x3-cell outline in its team color
   * (food is delivered anywhere inside this square).
   *
   * @param {Array<{x: number, y: number} | null>} nests
   * @private
   */
  _renderNests(nests) {
    const cs = this.cellSize;
    this.ctx.lineWidth = 2;
    for (let team = 0; team < nests.length; team++) {
      const nest = nests[team];
      if (!nest) continue;
      this.ctx.strokeStyle = PALETTE.teams[team] ?? '#fff';
      this.ctx.strokeRect((nest.x - 1) * cs + 1, (nest.y - 1) * cs + 1, cs * 3 - 2, cs * 3 - 2);
    }
  }

  /**
   * Step 1+2: grid -> pixel buffer -> scaled image on screen.
   *
   * Reads `grid.cells` / `grid.pheromones` directly instead of calling
   * `grid.get(x, y)` for every cell: this is the hottest loop of the frame and
   * the bounds checks in get() are useless when we walk the whole buffer.
   * Think of it as a C++ `friend` access to the raw array, kept read-only here.
   *
   * @param {Grid} grid
   * @returns {number} Number of food cells (counted for free during the pass)
   * @private
   */
  _renderGrid(grid) {
    const cells = grid.cells;
    const pheromones = grid.pheromones;
    const pixels = this.pixels;
    const lut = this.pheromoneLut;
    let food = 0;

    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c === CELL.EMPTY) {
        pixels[i] = lut[pheromones[i]];
      } else if (c === CELL.WALL) {
        pixels[i] = this.wallColor;
      } else if (c === CELL.FOOD) {
        pixels[i] = this.foodColor;
        food++;
      } else {
        pixels[i] = this.unknownColor;
      }
    }

    // Upload to the off-screen canvas, then stretch onto the visible one.
    this.bufferCtx.putImageData(this.imageData, 0, 0);
    // Must be set every frame: changing canvas.width/height resets ctx state.
    this.ctx.imageSmoothingEnabled = false; // sharp pixels, no blur
    this.ctx.drawImage(this.buffer, 0, 0, this.gridWidth * this.cellSize, this.gridHeight * this.cellSize);

    return food;
  }

  /**
   * Step 3: draw live ants, batched per team.
   * One path + one fill() per team instead of one fillRect per ant with a
   * fillStyle change each time: changing canvas state is expensive, a bit like
   * minimizing state changes / draw calls in OpenGL.
   * `beginPath` reuses the context's internal path, so no objects are allocated.
   *
   * @param {Ant[]} ants
   * @returns {number[]} Live ant count per team
   * @private
   */
  _renderAnts(ants) {
    const cs = this.cellSize;
    const size = Math.max(2, cs - 2);
    const offset = (cs - size) / 2;
    const counts = new Array(PALETTE.teams.length).fill(0);

    // Two batches per team: healthy ants in the team color, wounded ants
    // (health below max) in a darker shade, so fights are visible on screen.
    for (let team = 0; team < PALETTE.teams.length; team++) {
      for (let wounded = 0; wounded <= 1; wounded++) {
        this.ctx.beginPath();
        for (let i = 0; i < ants.length; i++) {
          const ant = ants[i];
          if (ant.getTeamId() !== team || !ant.isAlive()) continue;
          const isWounded = ant.getHealth() < COMBAT.MAX_HEALTH ? 1 : 0;
          if (isWounded !== wounded) continue;
          this.ctx.rect(ant.getX() * cs + offset, ant.getY() * cs + offset, size, size);
          counts[team]++;
        }
        this.ctx.fillStyle = wounded ? PALETTE.teamsWounded[team] : PALETTE.teams[team];
        this.ctx.fill();
      }
    }

    // Ants carrying food get a small food-colored dot in the middle
    // (one more batched path for all of them).
    const dot = Math.max(2, Math.floor(cs / 3));
    const dotOffset = (cs - dot) / 2;
    this.ctx.beginPath();
    for (let i = 0; i < ants.length; i++) {
      const ant = ants[i];
      if (!ant.isAlive() || !ant.isCarrying()) continue;
      this.ctx.rect(ant.getX() * cs + dotOffset, ant.getY() * cs + dotOffset, dot, dot);
    }
    this.ctx.fillStyle = `rgb(${PALETTE.food.join(',')})`;
    this.ctx.fill();

    return counts;
  }

  /**
   * Updates the smoothed FPS value.
   * Moving average: fps = 90% old + 10% new, so the number does not flicker.
   *
   * @private
   */
  _updateFps() {
    const now = performance.now();
    if (this.lastFrameTime > 0) {
      const dt = now - this.lastFrameTime;
      if (dt > 0) {
        const instant = 1000 / dt;
        this.fps = this.fps === 0 ? instant : this.fps * 0.9 + instant * 0.1;
      }
    }
    this.lastFrameTime = now;
  }

  /**
   * Clears the entire canvas.
   *
   * @param {string} color - The background color (default: '#000000')
   */
  clear(color = '#000000') {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Renders a single grid cell (legacy method, not used in main render loop).
   * Similar to drawing a rectangle in C++: `SDL_RenderFillRect(renderer, &rect)`
   *
   * @param {number} x - The x coordinate of the cell
   * @param {number} y - The y coordinate of the cell
   * @param {number} value - The cell value (determines color/appearance)
   */
  renderCell(x, y, value) {
    const rgb =
      value === CELL.WALL ? PALETTE.wall :
      value === CELL.FOOD ? PALETTE.food :
      value === CELL.EMPTY ? PALETTE.floor :
      PALETTE.unknown;
    this.ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    this.ctx.fillRect(x * this.cellSize, y * this.cellSize, this.cellSize, this.cellSize);
  }

  /**
   * Renders an ant at its current position (legacy method, not used in main render loop).
   *
   * @param {Ant} ant - The ant to render
   */
  renderAnt(ant) {
    const cs = this.cellSize;
    const size = Math.max(2, cs - 2);
    const offset = (cs - size) / 2;
    this.ctx.fillStyle = PALETTE.teams[ant.getTeamId()] ?? '#fff';
    this.ctx.fillRect(ant.getX() * cs + offset, ant.getY() * cs + offset, size, size);
  }

  /**
   * Sets the canvas size to match the grid dimensions and (re)allocates the
   * pixel buffer. The canvas gets an extra TOOLBAR_HEIGHT strip at the bottom
   * so the HUD never covers the map.
   *
   * @param {number} width - The grid width in cells
   * @param {number} height - The grid height in cells
   */
  resize(width, height) {
    this.gridWidth = width;
    this.gridHeight = height;

    this.canvas.width = width * this.cellSize;
    this.canvas.height = height * this.cellSize + TOOLBAR_HEIGHT;

    this.buffer.width = width;
    this.buffer.height = height;
    this.imageData = this.bufferCtx.createImageData(width, height);
    // Second "view" on the SAME memory as imageData.data (no copy):
    // like casting `uint8_t*` to `uint32_t*` in C++.
    this.pixels = new Uint32Array(this.imageData.data.buffer);
  }

  /**
   * Gets the 2D rendering context.
   *
   * @returns {CanvasRenderingContext2D} The canvas 2D context
   */
  getContext() {
    return this.ctx;
  }
}
