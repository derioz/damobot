/**
 * Damo Bot Feature Definitions & Overview UI Builder
 * Central catalog of all active capabilities offered by Damo Bot.
 */

import { DAMO_BOT_VERSION, VITAL_RP_LOGO_URL } from "../../config.js";
import {
  ComponentType,
  ButtonStyle,
  VITAL_ORANGE,
} from "../punishments/constants.js";

/**
 * Structured list of all current Damo Bot features.
 * Easily extensible for future capabilities.
 */
export const DAMO_BOT_FEATURES = [
  {
    id: "referrals",
    emoji: "🎟️",
    name: "Referrals",
    command: "/referral",
    summary: "Submit player referrals and let Damo-Bot automatically handle the Google Sheets tracker without manual spreadsheet entry.",
    isMinor: false,
  },
  {
    id: "loa",
    emoji: "🏖️",
    name: "Staff LOA Center",
    command: "/loa list",
    summary: "Start and manage LOAs, return early, automate LOA nickname handling, and subscribe to return alerts.",
    isMinor: false,
  },
  {
    id: "punishments",
    emoji: "⚖️",
    name: "Punishment Center",
    command: "/logpunishment",
    summary: "Log punishments and search player history with sequential IDs, Discord-searchable log entries, Google Sheets backup, and quick report/response/evidence updates.",
    isMinor: false,
  },
  {
    id: "refunds",
    emoji: "💰",
    name: "Refund Center",
    command: "/refund",
    summary: "Log player refunds across Vitcoin, Cash, S-Coin, and Other categories with sequential IDs, TicketTool tracking, and Google Sheets backup.",
    isMinor: false,
  },
  {
    id: "stickies",
    emoji: "📌",
    name: "Sticky Messages",
    command: "/sticky",
    summary: "Keep important messages pinned to the bottom of active channels with automatic reposting and optional interactive buttons.",
    isMinor: false,
  },
  {
    id: "ping",
    emoji: "🏓",
    name: "Bot Status",
    command: "/ping",
    summary: "Quick bot health check.",
    isMinor: true,
  },
];

/**
 * Format the features list into clean, scannable Discord markdown.
 *
 * @param {Array<Object>} features
 * @returns {string}
 */
export function formatFeaturesMarkdown(features = DAMO_BOT_FEATURES) {
  const majorFeatures = features.filter((f) => !f.isMinor);
  const minorFeatures = features.filter((f) => f.isMinor);

  const majorBlocks = majorFeatures.map(
    (f) => `${f.emoji} **${f.name}**\n\`${f.command}\`\n${f.summary}`
  );

  let output = majorBlocks.join("\n\n");

  if (minorFeatures.length > 0) {
    const minorLines = minorFeatures.map(
      (f) => `${f.emoji} \`${f.command}\` • ${f.summary}`
    );
    output += `\n\n${minorLines.join("\n")}`;
  }

  return output;
}

/**
 * Build the Discord Components V2 Overview Container for /damobot.
 *
 * Structure:
 * Container (Type 17, accent_color: VITAL_ORANGE):
 *   Section (Type 9):
 *     components: [TextDisplay]:
 *       # 🤖 Damo-Bot
 *       Vital RP’s unpaid digital employee.
 *     accessory: Thumbnail (Type 11) using VITAL_RP_LOGO_URL
 *   Separator (Type 14)
 *   TextDisplay (Type 10): Feature list
 *   Separator (Type 14)
 *   TextDisplay (Type 10): More coming soon
 *   Separator (Type 14)
 *   ActionRow (Type 1): Quick action buttons [ ⚖️ Punishment Center ] [ 🏖️ LOA Center ]
 *   TextDisplay (Type 10): Footer with centralized DAMO_BOT_VERSION
 *
 * @returns {Object} Components V2 Container
 */
export function buildDamoBotOverviewContainer() {
  return {
    type: ComponentType.CONTAINER,
    accent_color: VITAL_ORANGE,
    components: [
      {
        type: ComponentType.SECTION,
        components: [
          {
            type: ComponentType.TEXT_DISPLAY,
            content: "# 🤖 Damo-Bot\nVital RP’s unpaid digital employee.",
          },
        ],
        accessory: {
          type: ComponentType.THUMBNAIL,
          media: {
            url: VITAL_RP_LOGO_URL,
          },
          description: "Vital RP Logo",
        },
      },
      {
        type: ComponentType.SEPARATOR,
        divider: true,
        spacing: 1,
      },
      {
        type: ComponentType.TEXT_DISPLAY,
        content: formatFeaturesMarkdown(DAMO_BOT_FEATURES),
      },
      {
        type: ComponentType.SEPARATOR,
        divider: true,
        spacing: 1,
      },
      {
        type: ComponentType.TEXT_DISPLAY,
        content: "🚧 **More features coming soon.**\nDamon keeps finding more things for me to do.",
      },
      {
        type: ComponentType.SEPARATOR,
        divider: true,
        spacing: 1,
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.BUTTON,
            custom_id: "damobot:punishment_center",
            label: "Punishment Center",
            style: ButtonStyle.PRIMARY,
            emoji: { name: "⚖️" },
          },
          {
            type: ComponentType.BUTTON,
            custom_id: "damobot:refund_center",
            label: "Refund Center",
            style: ButtonStyle.PRIMARY,
            emoji: { name: "💰" },
          },
          {
            type: ComponentType.BUTTON,
            custom_id: "damobot:loa_center",
            label: "LOA Center",
            style: ButtonStyle.SECONDARY,
            emoji: { name: "🏖️" },
          },
        ],
      },
      {
        type: ComponentType.TEXT_DISPLAY,
        content: `-# 🤖 Damo Bot • Vital RP\n-# ${DAMO_BOT_VERSION}`,
      },
    ],
  };
}
