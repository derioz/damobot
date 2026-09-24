/**
 * Shared Discord Button & ActionRow Builders.
 * Strictly adheres to the Global UI Rule: No ❌ / X delete or dismiss controls.
 */

import { ComponentType, ButtonStyle } from "../discord.js";

/**
 * Build a generic Button component (Type 2).
 *
 * @param {Object} options
 * @param {string} [options.customId]
 * @param {string} [options.label]
 * @param {number} [options.style=ButtonStyle.SECONDARY]
 * @param {Object} [options.emoji]
 * @param {boolean} [options.disabled=false]
 * @param {string} [options.url]
 * @returns {Object} Discord Button component
 */
export function createButton({
  customId,
  label,
  style = ButtonStyle.SECONDARY,
  emoji,
  disabled = false,
  url,
} = {}) {
  const btn = {
    type: ComponentType.BUTTON,
    style,
    disabled: Boolean(disabled),
  };
  if (label) btn.label = label;
  if (customId) btn.custom_id = customId;
  if (emoji) btn.emoji = emoji;
  if (url) btn.url = url;
  return btn;
}

/**
 * Build a Primary Button (Blurple - Style 1).
 */
export function createPrimaryButton({
  customId,
  label,
  emoji,
  disabled = false,
}) {
  return createButton({
    customId,
    label,
    style: ButtonStyle.PRIMARY,
    emoji,
    disabled,
  });
}

/**
 * Build a Secondary Button (Grey - Style 2).
 */
export function createSecondaryButton({
  customId,
  label,
  emoji,
  disabled = false,
}) {
  return createButton({
    customId,
    label,
    style: ButtonStyle.SECONDARY,
    emoji,
    disabled,
  });
}

/**
 * Build a Success Button (Green - Style 3).
 */
export function createSuccessButton({
  customId,
  label,
  emoji,
  disabled = false,
}) {
  return createButton({
    customId,
    label,
    style: ButtonStyle.SUCCESS,
    emoji,
    disabled,
  });
}

/**
 * Build a Danger Button (Red - Style 4).
 */
export function createDangerButton({
  customId,
  label,
  emoji,
  disabled = false,
}) {
  return createButton({
    customId,
    label,
    style: ButtonStyle.DANGER,
    emoji,
    disabled,
  });
}

/**
 * Build a Link Button (Link - Style 5).
 */
export function createLinkButton({ url, label, emoji, disabled = false }) {
  return createButton({
    url,
    label,
    style: ButtonStyle.LINK,
    emoji,
    disabled,
  });
}

/**
 * Build an ActionRow component (Type 1).
 *
 * @param {Array<Object>} components Buttons or Select menus
 * @returns {Object}
 */
export function createActionRow(components = []) {
  return {
    type: ComponentType.ACTION_ROW,
    components: Array.isArray(components) ? components : [components],
  };
}

/**
 * Build a standardized Previous / Next pagination ActionRow.
 *
 * @param {Object} options
 * @param {string} options.customIdPrefix e.g. "punish_page:" or "refund_page:"
 * @param {number} options.currentPage 1-indexed current page
 * @param {number} options.totalPages Total available pages
 * @param {string} [options.queryKey=""] Optional search query key
 * @param {string} [options.extraData=""] Optional extra data to preserve in custom_id
 * @returns {Object} ActionRow component with Previous and Next buttons
 */
export function createPaginationRow({
  customIdPrefix,
  currentPage = 1,
  totalPages = 1,
  queryKey = "",
  extraData = "",
} = {}) {
  const encodedQuery = encodeURIComponent(queryKey || "");
  const suffix = extraData ? `:${extraData}` : "";

  const prevId = `${customIdPrefix}${currentPage - 1}:${encodedQuery}${suffix}`;
  const nextId = `${customIdPrefix}${currentPage + 1}:${encodedQuery}${suffix}`;

  return createActionRow([
    createSecondaryButton({
      customId: prevId,
      label: "Previous",
      emoji: { name: "⬅️" },
      disabled: currentPage <= 1,
    }),
    createSecondaryButton({
      customId: nextId,
      label: "Next",
      emoji: { name: "➡️" },
      disabled: currentPage >= totalPages,
    }),
  ]);
}
