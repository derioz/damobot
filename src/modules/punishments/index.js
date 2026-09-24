/**
 * Staff Punishment Center Module (Ban & Warn Logs).
 * Handles punishment logging, sequential IDs (VRP-P-XXXXXX), searchable logs,
 * player history, Google Sheets synchronization, and context menu actions.
 */

import { defineModule } from "../../core/module-registry/module.js";
import {
  handlePunishmentCommand,
  handlePunishmentComponent,
  handlePunishmentModalSubmit,
  handleUserContextPunishmentHistory,
  handleMessageContextAddToPunishment,
  openPunishmentCenter,
} from "./handlers.js";
import { handleMessageContextDefinitelyImportant } from "./easterEgg.js";
import { PunishmentSequenceDO } from "../../durableObjects/punishmentSequence.js";

export * from "./handlers.js";
export * from "./components.js";
export * from "./constants.js";
export * from "./db.js";
export * from "./formatter.js";
export * from "./pendingState.js";
export * from "./sheets.js";
export * from "./transcript.js";
export * from "./easterEgg.js";

export default defineModule({
  id: "punishments",
  name: "Punishment Center",
  description: "Log punishments and search player history with sequential IDs, searchable logs, and Google Sheets backup.",
  staffOnly: true,
  commands: [
    {
      name: "logpunishment",
      description: "Open the staff Punishment Center.",
      type: 1, // CHAT_INPUT
    },
    {
      name: "Punishment History",
      type: 2, // USER context command
    },
    {
      name: "Add to Punishment",
      type: 3, // MESSAGE context command
    },
    {
      name: "Definitely Important",
      type: 3, // MESSAGE context command
    },
  ],
  handlers: {
    commands: {
      logpunishment: handlePunishmentCommand,
      punishment: handlePunishmentCommand,
      "Punishment History": handleUserContextPunishmentHistory,
      "Add to Punishment": handleMessageContextAddToPunishment,
      "Definitely Important": handleMessageContextDefinitelyImportant,
    },
    components: [
      {
        matches: (id) =>
          id === "sticky:punishment_center" || id === "damobot:punishment_center",
        handler: (interaction, env) => openPunishmentCenter(interaction, env),
      },
      {
        matches: (id) => id.startsWith("punish_") || id.startsWith("pun:"),
        handler: handlePunishmentComponent,
      },
    ],
    modals: [
      {
        matches: (id) => id.startsWith("punish_"),
        handler: handlePunishmentModalSubmit,
      },
    ],
  },
  durableObjects: {
    PunishmentSequenceDO,
  },
});
