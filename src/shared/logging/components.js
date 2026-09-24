/**
 * Shared Logging Discord UI Components.
 * Standardizes log pagination rows, player history buttons, and media embeds.
 */

import {
  createActionRow,
  createSecondaryButton,
  createLinkButton,
  createPaginationRow,
} from "../components/buttons.js";
import { isValidUrl } from "./utilities.js";

export { createPaginationRow };

/**
 * Build a standard Player History button.
 *
 * @param {Object} options
 * @param {string} options.customIdPrefix e.g. "punish_hist:" or "jail_hist:"
 * @param {string} options.identifier Player Discord ID or Name
 * @param {string} [options.label="Player History"]
 * @returns {Object} Discord Button component
 */
export function createPlayerHistoryButton({
  customIdPrefix,
  identifier,
  label = "Player History",
}) {
  return createSecondaryButton({
    customId: `${customIdPrefix}${identifier}`,
    label,
    emoji: { name: "👤" },
  });
}

/**
 * Build an optional link button if URL is valid.
 *
 * @param {Object} options
 * @param {string} options.url
 * @param {string} options.label
 * @param {Object} [options.emoji]
 * @returns {Object|null} Button component or null if invalid URL
 */
export function createLinkButtonIfValid({ url, label, emoji }) {
  if (!url || !isValidUrl(url)) return null;
  return createLinkButton({
    url: url.trim(),
    label,
    emoji,
  });
}

/**
 * Build standard log embeds for attached media (e.g. Evidence Image).
 *
 * @param {string} imageUrl
 * @returns {Array<Object>}
 */
export function createEvidenceEmbed(imageUrl) {
  if (imageUrl && isValidUrl(imageUrl)) {
    return [
      {
        image: {
          url: imageUrl.trim(),
        },
      },
    ];
  }
  return [];
}
