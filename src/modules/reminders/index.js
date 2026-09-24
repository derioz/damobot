/**
 * Ticket Reminders Module.
 * Manages ticket reminder creation, cancellation, and cron delivery within ticket threads.
 */

import { defineModule } from "../../core/module-registry/module.js";
import {
  handleRemindCommand,
  handleRemindComponent,
} from "./handlers.js";
import { processDueTicketReminders } from "./cron.js";
import { isRemindersEnabled } from "./constants.js";

export * from "./handlers.js";
export * from "./cron.js";
export * from "./db.js";
export * from "./time.js";
export * from "./permissions.js";
export * from "./constants.js";

export default defineModule({
  id: "reminders",
  name: "Ticket Reminders",
  description: "Manage ticket reminders inside support ticket threads with scheduled delivery.",
  staffOnly: true,
  commands: (env) => {
    if (!isRemindersEnabled(env || process.env)) {
      return [];
    }
    return [
      {
        name: "remind",
        description: "Manage ticket reminders inside a ticket thread",
        type: 1, // CHAT_INPUT
        options: [
          {
            name: "create",
            description: "Set a reminder for this ticket thread",
            type: 1, // SUB_COMMAND
            options: [
              {
                name: "time",
                description:
                  "Duration before reminder is due (e.g. 30m, 1h, 2h, 6h, 12h, 24h, 2d, 3d, 7d)",
                type: 3, // STRING
                required: true,
              },
              {
                name: "message",
                description:
                  "Custom reminder note (default: Check on this ticket and close it if appropriate)",
                type: 3, // STRING
                required: false,
              },
              {
                name: "generic",
                description:
                  "Ping Support Staff and Moderator roles instead of only you (Admin only)",
                type: 5, // BOOLEAN
                required: false,
              },
            ],
          },
          {
            name: "list",
            description: "List your active pending ticket reminders",
            type: 1, // SUB_COMMAND
          },
          {
            name: "cancel",
            description: "Cancel a pending ticket reminder",
            type: 1, // SUB_COMMAND
            options: [
              {
                name: "id",
                description:
                  "Optional reminder ID to cancel (cancels current thread reminder if omitted)",
                type: 3, // STRING
                required: false,
              },
            ],
          },
        ],
      },
    ];
  },
  handlers: {
    commands: {
      remind: handleRemindCommand,
    },
    components: [
      {
        matches: (id) => id.startsWith("remind_"),
        handler: handleRemindComponent,
      },
    ],
  },
  scheduled: async (event, env, ctx) => {
    try {
      await processDueTicketReminders(env, ctx);
    } catch (err) {
      console.error("Scheduled ticket reminders error:", err?.message || err);
    }
  },
});
