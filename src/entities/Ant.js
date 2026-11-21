/**
 * @fileoverview Ant class - Represents an autonomous agent in the simulation.
 * Similar to an entity/object in C++ that maintains its own state.
 * 
 * @class Ant
 */
import { update as blueAlgo } from '../algorithms/BlueAlgorithm.js';
import { update as redAlgo } from '../algorithms/RedAlgorithm.js';
import { COMBAT } from '../config.js';

/**
 * @typedef {import('../types.js').View} View
 * @typedef {import('../types.js').Action} Action
 */

/**
 * Decision function per team (index = teamId).
 * Like a C++ table of function pointers: `Action (*ALGORITHMS[])(const View&)`.
 * Adding a third team = adding one entry here.
 * @type {ReadonlyArray<(view: View) => Action|null>}
 */
const ALGORITHMS = Object.freeze([blueAlgo, redAlgo]);

export class Ant {
  /**
   * Creates a new Ant instance.
   * 
   * @param {number} x - Initial x coordinate
   * @param {number} y - Initial y coordinate
   * @param {number} id - Unique identifier for this ant
   * @param {number} teamId - Team identifier (0 = Blue, 1 = Red)
   */
  constructor(x, y, id, teamId) {
    this.x = x;
    this.y = y;
    this.id = id;
    this.teamId = teamId;
    /** @type {boolean} */
    this.alive = true;
    /** True while the ant carries one unit of food. @type {boolean} */
    this.carrying = false;
    /** One byte of algorithm memory (see View.memory). @type {number} */
    this.memory = 0;
    /** Hit points; the ant dies when they reach 0. @type {number} */
    this.health = COMBAT.MAX_HEALTH;
  }

  /**
   * Asks this ant's team algorithm what to do, based only on its local view.
   * This is called once per game tick by State.
   *
   * The ant does NOT move itself and does not get the Grid: State builds the
   * View (Fog of War), validates the returned Action and moves the ant.
   * That keeps algorithms pure and makes cheating through walls impossible.
   *
   * @param {View} view - The local surroundings visible to this ant (reused, do not store)
   * @returns {Action|null} The action to perform, or null to stay
   */
  update(view) {
    const algorithm = ALGORITHMS[this.teamId];
    if (!algorithm) {
      return null; // unknown team: stand still instead of crashing the loop
    }
    return algorithm(view) ?? null;
  }

  /**
   * Gets the current x coordinate.
   * 
   * @returns {number} The x coordinate
   */
  getX() {
    return this.x;
  }

  /**
   * Gets the current y coordinate.
   * 
   * @returns {number} The y coordinate
   */
  getY() {
    return this.y;
  }

  /**
   * Gets the unique identifier of this ant.
   * 
   * @returns {number} The ant's ID
   */
  getId() {
    return this.id;
  }

  /**
   * Gets the team identifier.
   * 
   * @returns {number} The team ID (0 = Blue, 1 = Red)
   */
  getTeamId() {
    return this.teamId;
  }

  /**
   * Moves the ant to a new position.
   * 
   * @param {number} newX - The new x coordinate
   * @param {number} newY - The new y coordinate
   */
  moveTo(newX, newY) {
    this.x = newX;
    this.y = newY;
  }

  /**
   * Checks if the ant is alive.
   * 
   * @returns {boolean} True if the ant is alive, false otherwise
   */
  isAlive() {
    return this.alive;
  }

  /**
   * Checks if the ant is carrying food.
   *
   * @returns {boolean} True if carrying food
   */
  isCarrying() {
    return this.carrying;
  }

  /**
   * Gets the current hit points.
   *
   * @returns {number} 0..COMBAT.MAX_HEALTH
   */
  getHealth() {
    return this.health;
  }

  /**
   * Takes damage; the ant dies when its health reaches 0.
   *
   * @param {number} amount - Hit points to subtract (> 0)
   */
  damage(amount) {
    if (!this.alive || !(amount > 0)) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health === 0) {
      this.kill();
    }
  }

  /**
   * Marks the ant as dead.
   */
  kill() {
    this.alive = false;
    this.health = 0;
  }
}
