/**
 * @fileoverview GameLoop class - Manages the main game loop using requestAnimationFrame.
 * Decouples Update() (Logic) from Draw() (Rendering), similar to game loops in C++.
 *
 * Fixed timestep ("Fix Your Timestep" pattern):
 *   - Rendering runs as often as the browser allows (every animation frame).
 *   - Logic runs at a FIXED rate (TICKS_PER_SECOND), no matter the refresh rate.
 *
 * Real time since the last frame is added to an "accumulator"; while it holds
 * at least one tick's worth of time, we run one update and subtract that time.
 * On a 60 Hz screen with 20 ticks/s this runs update() on every 3rd frame;
 * on 144 Hz, on roughly every 7th — the ants move at the same speed on both.
 *
 * C++ analogy:
 * ```cpp
 * accumulator += frameTime;
 * while (accumulator >= dt) { update(); accumulator -= dt; }
 * render();
 * ```
 *
 * @class GameLoop
 */
import { TICKS_PER_SECOND, MAX_TICKS_PER_FRAME } from '../config.js';

export class GameLoop {
  /**
   * Creates a new GameLoop instance.
   *
   * @param {Function} updateCallback - Function called once per logic tick
   * @param {Function} renderCallback - Function called once per animation frame
   * @param {number} [ticksPerSecond=TICKS_PER_SECOND] - Logic rate
   */
  constructor(updateCallback, renderCallback, ticksPerSecond = TICKS_PER_SECOND) {
    this.updateCallback = updateCallback;
    this.renderCallback = renderCallback;
    this.isRunning = false;
    this.animationFrameId = null;
    this.lastTime = 0;

    /** Milliseconds per logic tick (50 ms at 20 ticks/s). */
    this.tickMs = 1000 / ticksPerSecond;

    /** Real time (ms) not yet "spent" on logic ticks. */
    this.accumulator = 0;

    /**
     * While paused, logic ticks are skipped but rendering continues, so the
     * screen still updates after e.g. loading a save during a pause.
     */
    this.paused = false;

    // Bind once: passing `(ts) => this._loop(ts)` to requestAnimationFrame
    // would create a new closure every frame (garbage for the GC). A bound
    // function is created once and reused — like storing a member function
    // pointer instead of building a new lambda each time.
    this._boundLoop = this._loop.bind(this);
  }

  /**
   * Starts the game loop.
   * Uses requestAnimationFrame for smooth rendering.
   */
  start() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.accumulator = 0;
    this.lastTime = performance.now();
    this.animationFrameId = requestAnimationFrame(this._boundLoop);
  }

  /**
   * Stops the game loop.
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Checks if the game loop is currently running.
   *
   * @returns {boolean} True if the loop is running, false otherwise
   */
  getRunning() {
    return this.isRunning;
  }

  /**
   * Pauses or resumes the simulation logic (rendering keeps going).
   *
   * @param {boolean} paused
   */
  setPaused(paused) {
    this.paused = paused;
    // Forget time collected before/while paused, otherwise resuming would
    // instantly run a burst of catch-up ticks.
    this.accumulator = 0;
  }

  /**
   * @returns {boolean} True if the simulation logic is paused
   */
  isPaused() {
    return this.paused;
  }

  /**
   * The main loop function called by requestAnimationFrame.
   *
   * @param {number} timestamp - The current timestamp from requestAnimationFrame
   * @private
   */
  _loop(timestamp) {
    if (!this.isRunning) {
      return;
    }

    // Time since last frame. Clamp negatives (timestamps can be slightly
    // out of order right after start()).
    const deltaTime = Math.max(0, timestamp - this.lastTime);
    this.lastTime = timestamp;
    if (!this.paused) {
      this.accumulator += deltaTime;
    }

    // Run as many fixed logic ticks as the elapsed time allows (capped).
    let ticks = 0;
    while (this.accumulator >= this.tickMs && ticks < MAX_TICKS_PER_FRAME) {
      this.updateCallback();
      this.accumulator -= this.tickMs;
      ticks++;
    }
    // Hit the cap (e.g. tab was hidden for a minute): drop the backlog
    // instead of fast-forwarding through it.
    if (ticks === MAX_TICKS_PER_FRAME && this.accumulator >= this.tickMs) {
      this.accumulator = 0;
    }

    // Render every frame
    this.renderCallback();

    // Schedule next frame (non-blocking, unlike a C++ `while (running)` loop)
    this.animationFrameId = requestAnimationFrame(this._boundLoop);
  }
}
