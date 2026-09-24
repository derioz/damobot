/**
 * Staff LOA Center Module.
 * Manages Leave of Absence requests, approvals, date-rollover automation,
 * role snapshotting/swapping, and nickname tracking.
 */

import { defineModule } from "../../core/module-registry/module.js";
import {
  handleLoaCommand,
  handleLoaInfoCommand,
  handleLoaComponent,
  handleLoaModalSubmit,
} from "./loaHandler.js";
import { StaffLoaDO } from "../../durableObjects/staffLoa.js";

export * from "./loaHandler.js";
export * from "./dateUtils.js";
export * from "./nicknameUtils.js";
export * from "./roleUtils.js";
export * from "./loaLogger.js";

export default defineModule({
  id: "loa",
  name: "Staff LOA Center",
  description: "Manage Staff Leave of Absence (LOA), early returns, nickname tracking, and role snapshots.",
  staffOnly: true,
  commands: [
    {
      name: "loa",
      description: "Manage Staff Leave of Absence (LOA)",
      type: 1, // CHAT_INPUT
      options: [
        {
          name: "list",
          description: "Open or refresh the Staff LOA Center.",
          type: 1, // SUB_COMMAND
        },
      ],
    },
    {
      name: "loainfo",
      description: "View staff LOA history and role snapshots (Management/Owner only)",
      type: 1, // CHAT_INPUT
      options: [
        {
          name: "member",
          description: "The staff member whose LOA history to view",
          type: 6, // USER
          required: true,
        },
      ],
    },
  ],
  handlers: {
    commands: {
      loa: handleLoaCommand,
      loainfo: handleLoaInfoCommand,
    },
    components: [
      {
        matches: (id) => id === "damobot:loa_center",
        handler: (interaction, env, ctx) =>
          handleLoaCommand(
            {
              ...interaction,
              data: {
                name: "loa",
                options: [{ name: "list" }],
              },
            },
            env,
            ctx
          ),
      },
      {
        matches: (id) => id.startsWith("loa_"),
        handler: handleLoaComponent,
      },
    ],
    modals: [
      {
        matches: (id) => id.startsWith("loa_modal_"),
        handler: handleLoaModalSubmit,
      },
    ],
  },
  scheduled: async (event, env, ctx) => {
    if (env.STAFF_LOA) {
      const guildId = env.DISCORD_GUILD_ID || env.GUILD_ID;
      if (guildId) {
        try {
          const doId = env.STAFF_LOA.idFromName(guildId);
          const stub = env.STAFF_LOA.get(doId);
          await stub.fetch("https://do/loa/cron", {
            method: "POST",
          });
        } catch (err) {
          console.error("Scheduled LOA date-rollover error:", err?.message || err);
        }
      }
    }
  },
  durableObjects: {
    StaffLoaDO,
  },
});
