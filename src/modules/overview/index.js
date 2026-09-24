/**
 * Bot Status & Overview Module.
 * Features the /damobot interactive capability menu and /ping health check.
 */

import { defineModule } from "../../core/module-registry/module.js";
import { handleDamoBotCommand } from "./handler.js";
import { jsonResponse } from "../../shared/discord.js";

export * from "./features.js";
export * from "./handler.js";

export default defineModule({
  id: "overview",
  name: "Bot Status & Overview",
  description: "See everything Damo-Bot can do and check bot responsiveness.",
  staffOnly: false, // Community and staff accessible
  commands: [
    {
      name: "ping",
      description: "Ping test for Damo Bot",
      type: 1, // CHAT_INPUT
    },
    {
      name: "damobot",
      description: "See everything Damo-Bot can do.",
      type: 1, // CHAT_INPUT
    },
  ],
  handlers: {
    commands: {
      ping: () =>
        jsonResponse({
          type: 4,
          data: { content: "🏓 Pong! Damo Bot is online." },
        }),
      damobot: handleDamoBotCommand,
    },
  },
});
