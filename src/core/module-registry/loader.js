/**
 * Central Module Loader.
 * Imports and registers all active DamoBot feature modules.
 */

import { registry } from "./registry.js";
import loaModule from "../../modules/loa/index.js";
import punishmentsModule from "../../modules/punishments/index.js";
import refundsModule from "../../modules/refunds/index.js";
import suggestionsModule from "../../modules/suggestions/index.js";
import referralsModule from "../../modules/referrals/index.js";
import remindersModule from "../../modules/reminders/index.js";
import stickiesModule from "../../modules/stickies/index.js";
import overviewModule from "../../modules/overview/index.js";
import adminChatModule from "../../modules/admin-chat/index.js";

export const BUILTIN_MODULES = [
  overviewModule,
  loaModule,
  punishmentsModule,
  refundsModule,
  suggestionsModule,
  referralsModule,
  remindersModule,
  stickiesModule,
  adminChatModule,
];

let loaded = false;

/**
 * Load and register all built-in modules into the module registry.
 * Idempotent: Only executes registration once.
 */
export function loadBuiltinModules() {
  if (loaded) return registry;

  for (const mod of BUILTIN_MODULES) {
    registry.register(mod);
  }

  loaded = true;
  return registry;
}

// Automatically register built-in modules on startup
loadBuiltinModules();
