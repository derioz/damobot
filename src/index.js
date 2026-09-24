/**
 * Damo Bot - Cloudflare Worker Entry Point.
 * Main entry point for Discord interaction dispatching, scheduled cron triggers,
 * and Durable Object class bindings.
 */

import { StickyBotDO } from "./durableObjects/stickyBot.js";
import { StaffLoaDO } from "./durableObjects/staffLoa.js";
import { PunishmentSequenceDO } from "./durableObjects/punishmentSequence.js";
import { SuggestionsDO } from "./durableObjects/suggestions.js";
import { DamoBotCore } from "./core/bot.js";

// Export Durable Object classes for Cloudflare Workers runtime
export { StickyBotDO, StaffLoaDO, PunishmentSequenceDO, SuggestionsDO };

export default {
  /**
   * Cloudflare Cron Trigger scheduled handler.
   * Dispatches to all registered modules with scheduled handlers.
   */
  async scheduled(event, env, ctx) {
    return DamoBotCore.handleScheduled(event, env, ctx);
  },

  /**
   * HTTP request handler for Discord interactions, webhook events, and health checks.
   */
  async fetch(request, env, ctx) {
    return DamoBotCore.handleFetch(request, env, ctx);
  },
};
