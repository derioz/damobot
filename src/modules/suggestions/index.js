/**
 * Community Suggestions Module.
 * Manages player suggestion submissions, voting, sequential IDs, and sticky integration.
 */

import { defineModule } from "../../core/module-registry/module.js";
import { handleSuggestionsCommand } from "./commands.js";
import {
  handleSuggestionCenterClick,
  handleSuggestionComponent,
  handleSuggestionModalSubmit,
} from "./handlers.js";
import { SuggestionsDO } from "../../durableObjects/suggestions.js";

export * from "./commands.js";
export * from "./handlers.js";
export * from "./components.js";

export default defineModule({
  id: "suggestions",
  name: "Community Suggestions",
  description: "Vital RP Community Suggestions system with voting and sticky integration.",
  staffOnly: false, // Community-facing feature
  commands: [
    {
      name: "suggestions",
      description: "Vital RP Community Suggestions",
      type: 1, // CHAT_INPUT
      options: [
        {
          name: "mine",
          description: "View your submitted suggestions and their current vote counts",
          type: 1, // SUB_COMMAND
        },
        {
          name: "top",
          description: "View top community suggestions ranked by score",
          type: 1, // SUB_COMMAND
        },
        {
          name: "recent",
          description: "View recently submitted community suggestions",
          type: 1, // SUB_COMMAND
        },
        {
          name: "setup",
          description: "Configure or move the Suggestion Center sticky (Superadmin only)",
          type: 1, // SUB_COMMAND
          options: [
            {
              name: "channel",
              description: "Target channel for the Suggestion Center sticky (defaults to active suggestions channel)",
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
      suggestions: handleSuggestionsCommand,
    },
    components: [
      {
        matches: (id) =>
          id === "suggestions_submit" || id === "sticky:suggestions_submit",
        handler: (interaction, env) => handleSuggestionCenterClick(interaction, env),
      },
      {
        matches: (id) => id.startsWith("sug_"),
        handler: handleSuggestionComponent,
      },
    ],
    modals: [
      {
        matches: (id) => id.startsWith("sug_modal_"),
        handler: handleSuggestionModalSubmit,
      },
    ],
  },
  durableObjects: {
    SuggestionsDO,
  },
});
