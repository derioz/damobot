/**
 * Standard Module Definition Specification and Validator.
 * Every DamoBot feature module must conform to this interface.
 */

/**
 * Validates and freezes a module definition object.
 *
 * @param {Object} definition
 * @param {string} definition.id Unique identifier (e.g. "loa", "punishments", "suggestions")
 * @param {string} definition.name Human-readable module name
 * @param {string} [definition.description] Brief summary of the module's responsibilities
 * @param {boolean} definition.staffOnly Explicit declaration of staff-only access (REQUIRED)
 * @param {Array<Object>} [definition.commands=[]] Discord application commands and context menus
 * @param {Object} [definition.handlers={}] Interaction handlers
 * @param {Object} [definition.handlers.commands={}] Command name -> async handler function
 * @param {Array<Object>} [definition.handlers.components=[]] Component matchers and handlers
 * @param {Array<Object>} [definition.handlers.modals=[]] Modal matchers and handlers
 * @param {Function} [definition.scheduled=null] Cloudflare Cron Trigger scheduled task
 * @param {Object} [definition.durableObjects={}] Durable Object classes exported by this module
 * @param {Object} [definition.permissions={}] Optional permission rules / error messages
 * @returns {Object} Validated and frozen module definition
 */
export function defineModule(definition) {
  if (!definition || typeof definition !== "object") {
    throw new TypeError("Module definition must be a valid object.");
  }

  // 1. Validate ID
  if (!definition.id || typeof definition.id !== "string" || !definition.id.trim()) {
    throw new Error("Module must have a non-empty string 'id'.");
  }
  const id = definition.id.trim();

  // 2. Validate Name
  if (!definition.name || typeof definition.name !== "string" || !definition.name.trim()) {
    throw new Error(`Module '${id}' must have a non-empty string 'name'.`);
  }
  const name = definition.name.trim();

  // 3. STRICT CHECK: staffOnly MUST be an explicit boolean
  if (typeof definition.staffOnly !== "boolean") {
    throw new TypeError(
      `Module '${id}' (${name}) MUST explicitly define 'staffOnly: true' or 'staffOnly: false'. Undefined or non-boolean staffOnly is not permitted.`
    );
  }

  // 4. Validate and normalize commands (can be Array or function (env) => Array)
  const commands =
    typeof definition.commands === "function" || Array.isArray(definition.commands)
      ? definition.commands
      : [];

  // 5. Normalize handlers
  const rawHandlers = definition.handlers || {};
  const commandHandlers = rawHandlers.commands && typeof rawHandlers.commands === "object"
    ? rawHandlers.commands
    : {};
  const componentHandlers = Array.isArray(rawHandlers.components)
    ? rawHandlers.components
    : [];
  const modalHandlers = Array.isArray(rawHandlers.modals)
    ? rawHandlers.modals
    : [];

  const moduleDef = {
    id,
    name,
    description: definition.description || "",
    staffOnly: definition.staffOnly,
    commands,
    handlers: {
      commands: commandHandlers,
      components: componentHandlers,
      modals: modalHandlers,
    },
    scheduled: typeof definition.scheduled === "function" ? definition.scheduled : null,
    durableObjects: definition.durableObjects || {},
    permissions: definition.permissions || {},
  };

  return Object.freeze(moduleDef);
}
