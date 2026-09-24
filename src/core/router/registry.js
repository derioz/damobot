/**
 * Central Interaction Route Tables.
 * Aggregates command, component, and modal handlers from the central module registry.
 */

import { registry } from "../module-registry/index.js";

/**
 * Build consolidated COMMAND_HANDLERS map from all registered modules.
 */
function buildCommandHandlers() {
  const map = {};
  for (const mod of registry.getAll()) {
    if (mod.handlers?.commands) {
      Object.assign(map, mod.handlers.commands);
    }
  }
  return map;
}

/**
 * Build consolidated COMPONENT_HANDLERS array from all registered modules.
 */
function buildComponentHandlers() {
  const handlers = [];
  for (const mod of registry.getAll()) {
    if (Array.isArray(mod.handlers?.components)) {
      handlers.push(...mod.handlers.components);
    }
  }
  return handlers;
}

/**
 * Build consolidated MODAL_HANDLERS array from all registered modules.
 */
function buildModalHandlers() {
  const handlers = [];
  for (const mod of registry.getAll()) {
    if (Array.isArray(mod.handlers?.modals)) {
      handlers.push(...mod.handlers.modals);
    }
  }
  return handlers;
}

export const COMMAND_HANDLERS = buildCommandHandlers();
export const COMPONENT_HANDLERS = buildComponentHandlers();
export const MODAL_HANDLERS = buildModalHandlers();
