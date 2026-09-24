/**
 * Central Module Registry.
 * Holds all registered DamoBot feature modules and coordinates interaction routing,
 * command aggregation, and scheduled cron executions.
 */

class ModuleRegistry {
  constructor() {
    /** @type {Map<string, Object>} */
    this.modules = new Map();
  }

  /**
   * Register a feature module.
   *
   * @param {Object} moduleDefinition Defined with defineModule()
   */
  register(moduleDefinition) {
    if (!moduleDefinition || !moduleDefinition.id) {
      throw new Error("Cannot register invalid module definition without an 'id'.");
    }

    if (this.modules.has(moduleDefinition.id)) {
      console.warn(`[registry] Overwriting previously registered module '${moduleDefinition.id}'`);
    }

    this.modules.set(moduleDefinition.id, moduleDefinition);
  }

  /**
   * Get a module by ID.
   *
   * @param {string} id
   * @returns {Object|undefined}
   */
  get(id) {
    return this.modules.get(id);
  }

  /**
   * Check if a module is registered.
   *
   * @param {string} id
   * @returns {boolean}
   */
  has(id) {
    return this.modules.has(id);
  }

  /**
   * Return all registered modules as an array.
   *
   * @returns {Array<Object>}
   */
  getAll() {
    return Array.from(this.modules.values());
  }

  /**
   * Aggregate all Discord application commands and context menus across registered modules.
   *
   * @param {Object} [env={}] Optional environment for feature flag checks
   * @returns {Array<Object>}
   */
  getAllCommands(env = {}) {
    const commands = [];
    for (const mod of this.modules.values()) {
      const rawCommands =
        typeof mod.commands === "function" ? mod.commands(env) : mod.commands;
      if (Array.isArray(rawCommands)) {
        for (const cmd of rawCommands) {
          const resolved = typeof cmd === "function" ? cmd(env) : cmd;
          if (Array.isArray(resolved)) {
            commands.push(...resolved);
          } else if (resolved && typeof resolved === "object") {
            commands.push(resolved);
          }
        }
      }
    }
    return commands;
  }

  /**
   * Find a slash command or context menu handler.
   *
   * @param {string} commandName
   * @returns {{ module: Object, handler: Function }|null}
   */
  findCommandHandler(commandName) {
    for (const mod of this.modules.values()) {
      const handler = mod.handlers?.commands?.[commandName];
      if (typeof handler === "function") {
        return { module: mod, handler };
      }
    }
    return null;
  }

  /**
   * Find a message component interaction handler.
   * Evaluates exact matches first across modules, then prefix/custom matchers.
   *
   * @param {string} customId
   * @returns {{ module: Object, handler: Function }|null}
   */
  findComponentHandler(customId) {
    // 1. Check exact match handlers first
    for (const mod of this.modules.values()) {
      const entries = mod.handlers?.components || [];
      for (const entry of entries) {
        if (entry.id && entry.id === customId) {
          return { module: mod, handler: entry.handler };
        }
      }
    }

    // 2. Check matcher functions
    for (const mod of this.modules.values()) {
      const entries = mod.handlers?.components || [];
      for (const entry of entries) {
        if (typeof entry.matches === "function" && entry.matches(customId)) {
          return { module: mod, handler: entry.handler };
        }
        if (entry.prefix && customId.startsWith(entry.prefix)) {
          return { module: mod, handler: entry.handler };
        }
      }
    }

    return null;
  }

  /**
   * Find a modal submit interaction handler.
   *
   * @param {string} customId
   * @returns {{ module: Object, handler: Function }|null}
   */
  findModalHandler(customId) {
    for (const mod of this.modules.values()) {
      const entries = mod.handlers?.modals || [];
      for (const entry of entries) {
        if (typeof entry.matches === "function" && entry.matches(customId)) {
          return { module: mod, handler: entry.handler };
        }
        if (entry.prefix && customId.startsWith(entry.prefix)) {
          return { module: mod, handler: entry.handler };
        }
      }
    }
    return null;
  }

  /**
   * Get all registered scheduled cron tasks.
   *
   * @returns {Array<{ module: Object, scheduled: Function }>}
   */
  getScheduledTasks() {
    const tasks = [];
    for (const mod of this.modules.values()) {
      if (typeof mod.scheduled === "function") {
        tasks.push({ module: mod, scheduled: mod.scheduled });
      }
    }
    return tasks;
  }
}

export const registry = new ModuleRegistry();
