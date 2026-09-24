/**
 * Central Discord Interaction Dispatcher.
 * Routes verified Discord interactions to handlers registered in the module registry.
 */

import { InteractionType } from "discord-interactions";
import { pongResponse, ephemeralTextResponse } from "../../shared/discord.js";
import { registry } from "../module-registry/index.js";

/**
 * Dispatch an incoming verified Discord interaction.
 *
 * @param {Object} interaction Discord interaction payload
 * @param {Object} env Cloudflare Worker environment
 * @param {Object} ctx Execution context
 * @returns {Promise<Response>}
 */
export async function dispatchInteraction(interaction, env, ctx) {
  try {
    // 1. Discord PING check (Type 1)
    if (interaction.type === InteractionType.PING) {
      return pongResponse();
    }

    // 2. Application Commands / Slash Commands / Context Menus (Type 2)
    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      const commandName = interaction.data?.name;
      const match = registry.findCommandHandler(commandName);

      if (match && typeof match.handler === "function") {
        return await match.handler(interaction, env, ctx);
      }

      if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
        console.warn(`[router] unknown_command_name="${commandName}"`);
      }
      return new Response("Unknown command", { status: 400 });
    }

    // 3. Message Components: Buttons & Select Menus (Type 3)
    if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
      const customId = interaction.data?.custom_id || "";
      const match = registry.findComponentHandler(customId);

      if (match && typeof match.handler === "function") {
        return await match.handler(interaction, env, ctx);
      }

      if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
        console.warn(`[router] unhandled_component_id=${customId.slice(0, 40)}`);
      }
      return ephemeralTextResponse(
        "❌ **This action is no longer valid.**\n\nPlease reopen the command and try again."
      );
    }

    // 4. Modal Submissions (Type 5)
    if (interaction.type === InteractionType.MODAL_SUBMIT) {
      const customId = interaction.data?.custom_id || "";
      const match = registry.findModalHandler(customId);

      if (match && typeof match.handler === "function") {
        return await match.handler(interaction, env, ctx);
      }

      if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
        console.warn(`[router] unhandled_modal_id=${customId.slice(0, 40)}`);
      }
      return new Response("Unknown modal interaction", { status: 400 });
    }

    return new Response("Interaction type not supported", { status: 400 });
  } catch (err) {
    if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
      console.error(
        `[router] unhandled_interaction_error type=${interaction?.type} id=${interaction?.id}:`,
        err?.stack || err?.message || err
      );
    }
    return ephemeralTextResponse(
      "❌ An unexpected error occurred while processing this request. Please try again later."
    );
  }
}
