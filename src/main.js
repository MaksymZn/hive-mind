/**
 * @fileoverview Main entry point for the Hive Mind simulation.
 * Similar to main() function in C++ that initializes and starts the application.
 */

import { State } from './models/State.js';
import { Renderer } from './views/Renderer.js';
import { GameLoop } from './controllers/GameLoop.js';

/**
 * Reads an optional map seed from the URL: `index.html?seed=42`.
 * Useful to replay the exact same game while debugging an algorithm.
 *
 * Security note: the URL is user input. We accept digits only and convert
 * to a number, so nothing from the URL is ever executed or inserted as HTML
 * (which would be an XSS risk with e.g. `innerHTML = param`).
 *
 * @returns {number|undefined} Seed, or undefined for a random map
 */
function readSeedFromUrl() {
  const param = new URLSearchParams(window.location.search).get('seed');
  if (param === null || !/^\d{1,10}$/.test(param)) {
    return undefined;
  }
  return Number(param) >>> 0;
}

/**
 * Initializes and starts the simulation.
 * Similar to the main() function in C++ programs.
 */
function init() {
  // Get canvas element from DOM
  const canvas = document.getElementById('gameCanvas');
  if (!canvas) {
    console.error('Canvas element not found!');
    return;
  }

  // Initialize Grid with dimensions
  // Initialize State (which contains Grid)
  const state = new State();
  
  // Initialize Renderer with canvas
  const cellSize = 8; // Pixels per grid cell
  const renderer = new Renderer(canvas, cellSize);
  
  // Initialize game state
  state.init(readSeedFromUrl());

  // Extra info for the HUD. One object reused every frame (no per-frame
  // allocation); its fields are refreshed before each render.
  const info = { scores: [], deaths: [], nests: [], tick: 0 };

  // Set up GameLoop with update and render callbacks
  const gameLoop = new GameLoop(
    () => {
      // Update callback - called at a fixed rate (TICKS_PER_SECOND)
      state.update();
    },
    () => {
      // Render callback - called every animation frame
      info.scores = state.getScores();
      info.deaths = state.getDeaths();
      info.nests = state.getNests();
      info.tick = state.getTick();
      renderer.render(state.getGrid(), state.getAnts(), info);
    }
  );
  
  // Buttons and keyboard shortcuts (Save / Load / Pause / New map)
  setupControls(state, gameLoop);

  // Start the game loop
  gameLoop.start();
}

/**
 * Wires the control buttons and keyboard shortcuts.
 *
 * Event loop note: these handlers never run in the middle of state.update().
 * JS has one main thread; a click is queued as a task and runs only after the
 * current frame callback has returned. So Load can replace the whole world
 * without any mutex — unlike a C++ program where input arrives on another
 * thread while the simulation thread is mid-update.
 *
 * Memory note: listeners are added once, for the lifetime of the page, so they
 * never pile up. If this function could run several times (e.g. on restart),
 * every call would add NEW listeners and keep old closures (and the old
 * `state`) alive — a classic leak; then you would removeEventListener first.
 *
 * @param {State} state
 * @param {GameLoop} gameLoop
 */
function setupControls(state, gameLoop) {
  const btnPause = document.getElementById('btnPause');
  const btnSave = document.getElementById('btnSave');
  const btnLoad = document.getElementById('btnLoad');
  const btnNew = document.getElementById('btnNew');
  const status = document.getElementById('status');
  if (!btnPause || !btnSave || !btnLoad || !btnNew || !status) {
    console.error('Control elements not found!');
    return;
  }

  let statusTimer = 0;
  /**
   * Shows a short message under the canvas for 3 seconds.
   * `textContent`, not `innerHTML`: the text is shown as-is and can never be
   * parsed as HTML/script (no XSS even if a message contained user input).
   * @param {string} text
   */
  const showStatus = (text) => {
    status.textContent = text;
    clearTimeout(statusTimer); // restart the timer instead of stacking timers
    statusTimer = setTimeout(() => {
      status.textContent = '';
    }, 3000);
  };

  const refreshButtons = () => {
    btnLoad.disabled = !state.hasSave();
    btnPause.lastChild.textContent = gameLoop.isPaused() ? ' Resume' : ' Pause';
  };

  const actions = {
    pause() {
      gameLoop.setPaused(!gameLoop.isPaused());
      refreshButtons();
      showStatus(gameLoop.isPaused() ? 'Paused' : 'Running');
    },
    save() {
      if (state.save()) {
        showStatus(`Saved (tick ${state.getTick()})`);
      } else {
        showStatus('Save failed: browser storage is unavailable or full');
      }
      refreshButtons();
    },
    load() {
      if (state.load()) {
        showStatus(`Loaded (tick ${state.getTick()})`);
      } else {
        showStatus(state.hasSave() ? 'Load failed: the save is damaged or from another version' : 'Nothing saved yet');
      }
      refreshButtons();
    },
    newMap() {
      state.reset();
      showStatus(`New map, seed ${state.getGrid().seed}`);
    },
  };

  btnPause.addEventListener('click', actions.pause);
  btnSave.addEventListener('click', actions.save);
  btnLoad.addEventListener('click', actions.load);
  btnNew.addEventListener('click', actions.newMap);

  // A mouse click normally leaves keyboard focus on the button; pressing
  // Space afterwards would then "click" that button (e.g. Save again)
  // instead of pausing. Cancelling mousedown keeps focus where it was.
  // Keyboard users can still Tab to a button and press Space/Enter on it.
  for (const btn of [btnPause, btnSave, btnLoad, btnNew]) {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
  }

  const keys = { ' ': actions.pause, s: actions.save, l: actions.load, n: actions.newMap };
  document.addEventListener('keydown', (e) => {
    // Leave browser shortcuts alone (Ctrl+S = save page, Ctrl+L = address bar...)
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    // Space on a focused button already "clicks" it; do not toggle twice.
    if (e.key === ' ' && e.target instanceof HTMLButtonElement) return;
    const action = keys[e.key.toLowerCase()];
    if (!action) return;
    e.preventDefault(); // e.g. Space would otherwise scroll the page
    action();
  });

  refreshButtons();
}

// Start the application when DOM is ready
// Similar to calling main() in C++
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
