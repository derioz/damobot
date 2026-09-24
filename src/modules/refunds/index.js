/**
 * Staff Refund Center Module.
 * Manages player refund logging, category tracking (Vitcoin, Cash, S-Coin, Other),
 * sequential IDs (VRP-R-XXXXXX), and Google Sheets synchronization.
 */

import { defineModule } from "../../core/module-registry/module.js";
import {
  handleRefundCommand,
  handleRefundComponent,
  handleRefundModalSubmit,
  openRefundCenter,
} from "./handlers.js";

export * from "./handlers.js";
export * from "./components.js";
export * from "./constants.js";
export * from "./db.js";
export * from "./formatter.js";
export * from "./sheets.js";

export default defineModule({
  id: "refunds",
  name: "Refund Center",
  description: "Log player refunds across Vitcoin, Cash, S-Coin, and Other categories with sequential IDs and Google Sheets backup.",
  staffOnly: true,
  commands: [
    {
      name: "refund",
      description: "Open the staff Refund Center or log a refund.",
      type: 1, // CHAT_INPUT
      options: [
        {
          name: "log",
          description: "Log a player refund.",
          type: 1, // SUB_COMMAND
        },
        {
          name: "edit",
          description: "Edit an existing refund record.",
          type: 1, // SUB_COMMAND
          options: [
            {
              name: "id",
              description: "The Refund ID to edit (e.g. VRP-R-000001)",
              type: 3, // STRING
              required: true,
            },
          ],
        },
      ],
    },
  ],
  handlers: {
    commands: {
      refund: handleRefundCommand,
    },
    components: [
      {
        matches: (id) =>
          id === "sticky:refund_center" || id === "damobot:refund_center",
        handler: (interaction, env) => openRefundCenter(interaction, env),
      },
      {
        matches: (id) => id.startsWith("refund_"),
        handler: handleRefundComponent,
      },
    ],
    modals: [
      {
        matches: (id) => id.startsWith("refund_"),
        handler: handleRefundModalSubmit,
      },
    ],
  },
});
