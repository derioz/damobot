/**
 * Sticky Messages Module.
 * Manages channel sticky messages, button attachments, formatting modals, and polling reposts.
 */

import { defineModule } from "../../core/module-registry/module.js";
import { handleStickyCommand } from "./command.js";
import { handleStickyModalSubmit } from "./handler.js";
import { StickyBotDO } from "../../durableObjects/stickyBot.js";

export * from "./command.js";
export * from "./handler.js";
export * from "./modals.js";

export default defineModule({
  id: "stickies",
  name: "Sticky Messages",
  description: "Keep important messages pinned to the bottom of active channels with automatic reposting.",
  staffOnly: true,
  commands: [
    {
      name: "sticky",
      description: "Manage sticky messages in channels",
      type: 1, // CHAT_INPUT
      options: [
        {
          name: "create",
          description: "Create a sticky message in a channel (opens formatting modal)",
          type: 1, // SUB_COMMAND
          options: [
            {
              name: "channel",
              description: "The channel for the sticky message (defaults to current channel)",
              type: 7, // CHANNEL
              required: false,
            },
            {
              name: "button",
              description: "Optional interactive button to attach to the sticky",
              type: 3, // STRING
              required: false,
              choices: [
                {
                  name: "None",
                  value: "none",
                },
                {
                  name: "⚖️ Punishment Center",
                  value: "punishment_center",
                },
                {
                  name: "💰 Refund Center",
                  value: "refund_center",
                },
                {
                  name: "⚖️ Punishment Center + 💰 Refund Center",
                  value: "both",
                },
              ],
            },
          ],
        },
        {
          name: "edit",
          description: "Edit an existing sticky message in a channel",
          type: 1, // SUB_COMMAND
          options: [
            {
              name: "channel",
              description: "The channel to edit sticky message for (defaults to current channel)",
              type: 7, // CHANNEL
              required: false,
            },
          ],
        },
        {
          name: "remove",
          description: "Disable and remove the sticky message from a channel",
          type: 1, // SUB_COMMAND
          options: [
            {
              name: "channel",
              description: "The channel to remove sticky message from (defaults to current channel)",
              type: 7, // CHANNEL
              required: false,
            },
          ],
        },
        {
          name: "set",
          description: "Set and enable a sticky message in a channel",
          type: 1, // SUB_COMMAND
          options: [
            {
              name: "channel",
              description: "The channel for the sticky message",
              type: 7, // CHANNEL
              required: true,
            },
            {
              name: "message",
              description: "The sticky message content",
              type: 3, // STRING
              required: true,
            },
            {
              name: "button",
              description: "Optional interactive button to attach to the sticky",
              type: 3, // STRING
              required: false,
              choices: [
                {
                  name: "None",
                  value: "none",
                },
                {
                  name: "⚖️ Punishment Center",
                  value: "punishment_center",
                },
                {
                  name: "💰 Refund Center",
                  value: "refund_center",
                },
                {
                  name: "⚖️ Punishment Center + 💰 Refund Center",
                  value: "both",
                },
              ],
            },
          ],
        },
        {
          name: "off",
          description: "Disable and remove the sticky message from a channel",
          type: 1, // SUB_COMMAND
          options: [
            {
              name: "channel",
              description: "The channel to disable sticky message for",
              type: 7, // CHANNEL
              required: false,
            },
          ],
        },
        {
          name: "status",
          description: "Check sticky message status for a channel",
          type: 1, // SUB_COMMAND
          options: [
            {
              name: "channel",
              description: "The channel to check (defaults to current channel)",
              type: 7, // CHANNEL
              required: false,
            },
          ],
        },
      ],
    },
  ],
  handlers: {
    commands: {
      sticky: handleStickyCommand,
    },
    modals: [
      {
        matches: (id) => id.startsWith("sticky_modal_"),
        handler: handleStickyModalSubmit,
      },
    ],
  },
  scheduled: async (event, env, ctx) => {
    if (env.STICKY_BOT) {
      try {
        const doId = env.STICKY_BOT.idFromName("global");
        const stub = env.STICKY_BOT.get(doId);
        await stub.fetch("https://do/sticky/poll", {
          method: "POST",
        });
      } catch (err) {
        console.error("Scheduled sticky poll error:", err?.message || err);
      }
    }
  },
  durableObjects: {
    StickyBotDO,
  },
});
