/**
 * Central Module Registry Facade.
 */

import { registry } from "./registry.js";
import { loadBuiltinModules } from "./loader.js";

// Ensure all built-in modules are registered
loadBuiltinModules();

export { defineModule } from "./module.js";
export { registry } from "./registry.js";
export { loadBuiltinModules, BUILTIN_MODULES } from "./loader.js";

export const registerModule = (mod) => registry.register(mod);
export const getModule = (id) => registry.get(id);
export const hasModule = (id) => registry.has(id);
export const getAllModules = () => registry.getAll();
export const getAllCommands = (env) => registry.getAllCommands(env);
export const findCommandHandler = (name) => registry.findCommandHandler(name);
export const findComponentHandler = (id) => registry.findComponentHandler(id);
export const findModalHandler = (id) => registry.findModalHandler(id);
export const getScheduledTasks = () => registry.getScheduledTasks();
