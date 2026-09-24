/**
 * Referral System Module.
 * Manages player referral submissions, duplicate checking, and Google Sheets integration.
 */

import { defineModule } from "../../core/module-registry/module.js";
import { handleReferralCommand } from "./command.js";

export * from "./command.js";

export default defineModule({
  id: "referrals",
  name: "Referral System",
  description: "Submit player referrals with duplicate protection and Google Sheets tracking.",
  staffOnly: false, // Community-facing feature
  commands: [
    {
      name: "referral",
      description: "Submit the person who referred you to the server",
      type: 1, // CHAT_INPUT
      options: [
        {
          name: "referrer",
          description: "The Discord user who referred you",
          type: 6, // USER
          required: true,
        },
      ],
    },
  ],
  handlers: {
    commands: {
      referral: handleReferralCommand,
    },
  },
});
