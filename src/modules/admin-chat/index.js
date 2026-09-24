/**
 * Admin Chat Mention Module.
 * Listens for bot mentions in dedicated admin channels via the /messages and /events endpoints.
 */

import { defineModule } from "../../core/module-registry/module.js";
import { handleAdminChatMessage } from "./mentionHandler.js";

export * from "./mentionHandler.js";

export default defineModule({
  id: "admin-chat",
  name: "Admin Chat Mentions",
  description: "Handles admin chat messages and bot mentions from external bridges or webhooks.",
  staffOnly: true,
  commands: [],
  handlers: {
    commands: {},
  },
});
