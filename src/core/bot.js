/**
 * Damo Bot Core Engine.
 * Central coordinator for Cloudflare Worker interaction dispatching,
 * cron triggers from registered modules, and HTTP endpoints.
 */

import { verifyKey } from "discord-interactions";
import { dispatchInteraction } from "./router/dispatch.js";
import { registry } from "./module-registry/index.js";
import { validateBotConfig } from "../config/validate.js";
import { handleAdminChatMessage } from "../modules/admin-chat/mentionHandler.js";

// Validate bot configuration on startup
validateBotConfig();

export const DamoBotCore = {
  /**
   * Cloudflare Cron Trigger scheduled handler.
   * Dispatches cron events to all registered modules that define a scheduled handler.
   */
  async handleScheduled(event, env, ctx) {
    const tasks = registry.getScheduledTasks();
    const promises = tasks.map(({ module: mod, scheduled }) =>
      (async () => {
        try {
          await scheduled(event, env, ctx);
        } catch (err) {
          console.error(
            `Scheduled error in module '${mod.id}':`,
            err?.message || err
          );
        }
      })()
    );

    await Promise.allSettled(promises);
  },

  /**
   * HTTP request handler for Discord interactions and health checks.
   */
  async handleFetch(request, env, ctx) {
    const url = new URL(request.url);

    // Health check endpoint
    if (request.method === "GET" && url.pathname === "/") {
      return new Response("Damo Bot is running!", {
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }

    // Discord Interactions endpoint
    if (request.method === "POST" && url.pathname === "/") {
      const signature = request.headers.get("x-signature-ed25519");
      const timestamp = request.headers.get("x-signature-timestamp");

      if (!signature || !timestamp || !env.DISCORD_PUBLIC_KEY) {
        return new Response("Invalid request signature", { status: 401 });
      }

      const rawBody = await request.text();
      const isValid = await verifyKey(
        rawBody,
        signature,
        timestamp,
        env.DISCORD_PUBLIC_KEY
      );

      if (!isValid) {
        return new Response("Invalid request signature", { status: 401 });
      }

      let interaction;
      try {
        interaction = JSON.parse(rawBody);
      } catch {
        return new Response("Invalid request body", { status: 400 });
      }

      return await dispatchInteraction(interaction, env, ctx);
    }

    // Message event endpoint (for gateway forwarders, bot bridges, or message webhooks)
    if (
      request.method === "POST" &&
      (url.pathname === "/messages" || url.pathname === "/events")
    ) {
      const authHeader = request.headers.get("authorization");
      if (
        env.MESSAGE_ENDPOINT_SECRET &&
        authHeader !== `Bearer ${env.MESSAGE_ENDPOINT_SECRET}`
      ) {
        return new Response("Unauthorized", { status: 401 });
      }

      try {
        const payload = await request.json();
        const message = payload.message || payload.d || payload;
        const result = await handleAdminChatMessage(message, env);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err?.message || err }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};
