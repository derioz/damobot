/**
 * Discord UI Components & Embed Builders for Vital RP Suggestions.
 * Standardizes Suggestion Center stickies, category selection, modals,
 * ephemeral previews, and public suggestion embeds.
 */

import {
  ComponentType,
  ButtonStyle,
  createActionRow,
  createButton,
  createStringSelect,
  createContainer,
  createSection,
  createTextDisplay,
  createThumbnail,
  createSeparator,
  buildDamoFooter,
} from "../../shared/components.js";
import {
  suggestionsConfig,
  getActiveCategoryOptions,
  getCategoryById,
} from "../../config/suggestions.config.js";
import { DAMO_BOT_VERSION, VITAL_RP_LOGO_URL, VITAL_ORANGE } from "../../config.js";
import { getUserAvatarUrl } from "../../shared/discord.js";

/**
 * Build the Suggestion Center message, embed, and button for the sticky system.
 *
 * @returns {{ messageText: string, embed: Object, embeds: Array<Object>, components: Array<Object> }}
 */
export function buildSuggestionCenterSticky() {
  const title = "💡 VITAL RP • COMMUNITY SUGGESTIONS";
  const description = "Got an idea that could make Vital better?\nSend it below and let the community vote.";

  const messageText = [
    `### ${title}`,
    description,
  ].join("\n");

  const embed = {
    title,
    description,
    color: VITAL_ORANGE,
  };

  const components = [
    createActionRow([
      createButton({
        customId: "suggestions_submit",
        label: "Submit Suggestion",
        style: ButtonStyle.PRIMARY,
        emoji: { name: "💡" },
      }),
    ]),
  ];

  return { messageText, embed, embeds: [embed], components };
}

/**
 * Build the Ephemeral Category & Privacy selection container (Step 1).
 *
 * @param {Object} options
 * @param {string} [options.selectedCategoryId]
 * @param {boolean} [options.isAnonymous=false]
 * @returns {Object} Components V2 Container
 */
export function buildCategorySelectPrompt({
  selectedCategoryId = null,
  isAnonymous = false,
} = {}) {
  const categoryOptions = getActiveCategoryOptions().map((opt) => ({
    ...opt,
    default: opt.value === selectedCategoryId,
  }));

  return createContainer(
    [
      createSection(
        [
          createTextDisplay(
            "### 💡 Submit a Suggestion\nSelect a category and choose your privacy preference:"
          ),
        ],
        createThumbnail(VITAL_RP_LOGO_URL, "Vital RP Logo")
      ),
      createActionRow([
        createStringSelect({
          customId: `sug_cat_select:${isAnonymous ? "1" : "0"}`,
          options: categoryOptions,
          placeholder: "Choose a category...",
          minValues: 1,
          maxValues: 1,
        }),
      ]),
      createActionRow([
        createButton({
          customId: `sug_privacy:${selectedCategoryId || "none"}:public`,
          label: "Public",
          style: isAnonymous ? ButtonStyle.SECONDARY : ButtonStyle.PRIMARY,
          emoji: { name: "👤" },
        }),
        createButton({
          customId: `sug_privacy:${selectedCategoryId || "none"}:anon`,
          label: "Anonymous",
          style: isAnonymous ? ButtonStyle.PRIMARY : ButtonStyle.SECONDARY,
          emoji: { name: "🕶️" },
        }),
      ]),
      createTextDisplay(
        isAnonymous
          ? "-# 🕶️ **Anonymous**: Your name will be hidden on the public suggestion feed."
          : "-# 👤 **Public**: Submitted under your Discord username."
      ),
      createSeparator(1, false),
      createActionRow([
        createButton({
          customId: `sug_open_modal:${selectedCategoryId || "scripts"}:${isAnonymous ? "1" : "0"}`,
          label: "Continue to Form 📝",
          style: ButtonStyle.PRIMARY,
          disabled: !selectedCategoryId,
        }),
        createButton({
          customId: "sug_cancel",
          label: "Cancel",
          style: ButtonStyle.SECONDARY,
        }),
      ]),
      createTextDisplay(`-# Community Suggestions • Damo-Bot ${DAMO_BOT_VERSION}`),
    ],
    VITAL_ORANGE
  );
}

/**
 * Build the Discord Native Modal for entering suggestion details (Step 2).
 *
 * @param {Object} options
 * @param {string} options.categoryId
 * @param {boolean} options.isAnonymous
 * @param {string} [options.initialTitle=""]
 * @param {string} [options.initialDescription=""]
 * @param {string} [options.initialUrl=""]
 * @returns {Object} Discord Modal object (Type 9 payload)
 */
export function buildSuggestionModal({
  categoryId,
  isAnonymous,
  initialTitle = "",
  initialDescription = "",
  initialUrl = "",
  initialImageUrl = "",
}) {
  const category = getCategoryById(categoryId) || { label: "Suggestion", emoji: "💡" };
  const titleComp = {
    type: ComponentType.TEXT_INPUT,
    custom_id: "sug_title",
    style: 1, // Short
    label: "Short Title",
    placeholder: "e.g. Vehicle Favorites in Garage",
    min_length: suggestionsConfig.limits.titleMinLength,
    max_length: suggestionsConfig.limits.titleMaxLength,
    required: true,
  };
  if (initialTitle && initialTitle.trim().length >= suggestionsConfig.limits.titleMinLength) {
    titleComp.value = initialTitle.trim();
  }

  const descComp = {
    type: ComponentType.TEXT_INPUT,
    custom_id: "sug_desc",
    style: 2, // Paragraph
    label: "Detailed Description",
    placeholder: "Explain your suggestion, why it would be beneficial, and how it should work...",
    min_length: suggestionsConfig.limits.descriptionMinLength,
    max_length: suggestionsConfig.limits.descriptionMaxLength,
    required: true,
  };
  if (initialDescription && initialDescription.trim().length >= suggestionsConfig.limits.descriptionMinLength) {
    descComp.value = initialDescription.trim();
  }

  const urlComp = {
    type: ComponentType.TEXT_INPUT,
    custom_id: "sug_url",
    style: 1, // Short
    label: "Optional Reference URL (HTTPS)",
    placeholder: "https://example.com/reference-link",
    required: false,
  };
  if (initialUrl && initialUrl.trim().length > 0) {
    urlComp.value = initialUrl.trim();
  }

  const imageComp = {
    type: ComponentType.TEXT_INPUT,
    custom_id: "sug_image_url",
    style: 1, // Short
    label: "Optional Image Link (PNG, JPG, WEBP)",
    placeholder: "https://... (direct link to screenshot or image)",
    required: false,
  };
  if (initialImageUrl && initialImageUrl.trim().length > 0) {
    imageComp.value = initialImageUrl.trim();
  }

  return {
    custom_id: `sug_modal_submit:${categoryId}:${isAnonymous ? "1" : "0"}`,
    title: `New Suggestion: ${category.label}`.slice(0, 45),
    components: [
      // 1. Title Input (Required)
      {
        type: ComponentType.ACTION_ROW,
        components: [titleComp],
      },
      // 2. Description Input (Required)
      {
        type: ComponentType.ACTION_ROW,
        components: [descComp],
      },
      // 3. Optional Reference URL
      {
        type: ComponentType.ACTION_ROW,
        components: [urlComp],
      },
      // 4. Optional Image Link
      {
        type: ComponentType.ACTION_ROW,
        components: [imageComp],
      },
    ],
  };
}

/**
 * Build the public suggestion embed and interactive voting buttons.
 *
 * @param {Object} options
 * @param {Object} options.suggestion Suggestion record
 * @param {string} [options.authorDisplayName]
 * @param {string} [options.authorAvatarUrl]
 * @returns {{ embed: Object, components: Array<Object>, container: Object, actionRow: Object }}
 */
export function buildPublicSuggestionEmbed({
  suggestion,
  authorDisplayName = null,
  authorAvatarUrl = null,
}) {
  const categoryId = suggestion.category_id || suggestion.categoryId;
  const category = getCategoryById(categoryId) || {
    label: suggestion.category_label || suggestion.categoryLabel || "Suggestion",
    emoji: "💡",
  };

  const displayId = suggestion.display_id || `#${String(suggestion.id).padStart(4, "0")}`;
  const submitterName = authorDisplayName || suggestion.author_tag || "Player";
  const authorText = suggestion.is_anonymous
    ? `Submitted anonymously • ${displayId}`
    : `Submitted by ${submitterName} • ${displayId}`;

  // Dynamically resolve submitter avatar (or Discord default avatar if anonymous / no custom avatar)
  let avatarUrl = "https://cdn.discordapp.com/embed/avatars/0.png";
  if (!suggestion.is_anonymous) {
    if (authorAvatarUrl) {
      avatarUrl = authorAvatarUrl;
    } else if (suggestion.author_avatar_url || suggestion.authorAvatarUrl) {
      avatarUrl = suggestion.author_avatar_url || suggestion.authorAvatarUrl;
    } else if (suggestion.user_id || suggestion.userId) {
      avatarUrl = getUserAvatarUrl({
        id: suggestion.user_id || suggestion.userId,
        avatar: suggestion.author_avatar,
        discriminator: suggestion.author_discriminator,
      });
    }
  }

  const headerTitle = `${category.label.toUpperCase()} • ${suggestion.title}`;

  const embed = {
    title: headerTitle,
    description: suggestion.description,
    color: suggestionsConfig.branding.color,
    thumbnail: {
      url: avatarUrl,
    },
    footer: {
      text: `${authorText}\nDamo-Bot ${DAMO_BOT_VERSION}`,
      icon_url: suggestionsConfig.branding.logoUrl,
    },
    timestamp: new Date(suggestion.created_at || Date.now()).toISOString(),
  };

  // Per Damo-Bot global UI rule: Posted suggestion embeds strictly contain ONLY voting
  // buttons (👍 / 👎) and optional resource links. They NEVER include an ❌ / X delete or dismiss button.
  const buttons = [
    createButton({
      customId: `sug_vote:${suggestion.id}:up`,
      label: String(suggestion.upvotes || 0),
      style: ButtonStyle.SECONDARY,
      emoji: { name: "👍" },
    }),
    createButton({
      customId: `sug_vote:${suggestion.id}:down`,
      label: String(suggestion.downvotes || 0),
      style: ButtonStyle.SECONDARY,
      emoji: { name: "👎" },
    }),
  ];

  // Optional View Image link button
  const imgUrl = suggestion.attachment_url || suggestion.attachmentUrl;
  if (imgUrl) {
    buttons.push(
      createButton({
        label: "View Image",
        style: ButtonStyle.LINK,
        url: imgUrl,
        emoji: { name: "🖼️" },
      })
    );
  }

  // Optional View Link button
  if (suggestion.url) {
    buttons.push(
      createButton({
        label: "View Link",
        style: ButtonStyle.LINK,
        url: suggestion.url,
        emoji: { name: "🔗" },
      })
    );
  }

  const actionRow = createActionRow(buttons);
  const components = [actionRow];

  // Build native Components V2 Container to prevent Discord from rendering the
  // "Remove embed" (X) button that allows members to dismiss the embed for everyone.
  const container = createContainer(
    [
      createSection(
        [
          createTextDisplay(
            `### ${headerTitle}\n\n${suggestion.description}`
          ),
        ],
        createThumbnail(
          avatarUrl,
          `${suggestion.is_anonymous ? "Anonymous" : submitterName}'s Avatar`
        )
      ),
      createSeparator(1, false),
      actionRow,
      createTextDisplay(
        `-# ${authorText}\n-# Damo-Bot ${DAMO_BOT_VERSION}`
      ),
    ],
    suggestionsConfig.branding.color
  );

  return { embed, components, container, actionRow };
}

/**
 * Build Ephemeral Preview for the submitter to review before publishing (Step 3).
 *
 * @param {Object} options
 * @param {Object} options.draft Draft suggestion details
 * @param {string} options.authorTag
 * @param {string} [options.draftToken] Signed or encoded token for state recovery
 * @param {string} [options.authorAvatarUrl] Submitter's dynamic Discord avatar URL
 * @returns {Object} Ephemeral response payload with embed and action buttons
 */
export function buildSuggestionPreview({
  draft,
  authorTag,
  draftToken = "",
  authorAvatarUrl = null,
}) {
  const { embed } = buildPublicSuggestionEmbed({
    suggestion: {
      ...draft,
      id: 0,
      display_id: "#DRAFT",
      upvotes: 0,
      downvotes: 0,
      created_at: Date.now(),
    },
    authorDisplayName: authorTag,
    authorAvatarUrl,
  });

  const previewComponents = [
    createActionRow([
      createButton({
        customId: `sug_confirm:${draftToken}`,
        label: "Confirm & Submit",
        style: ButtonStyle.SUCCESS,
        emoji: { name: "✅" },
      }),
      createButton({
        customId: `sug_edit:${draftToken}`,
        label: "Edit / Go Back",
        style: ButtonStyle.SECONDARY,
        emoji: { name: "✏️" },
      }),
      createButton({
        customId: `sug_cancel:${draftToken}`,
        label: "Cancel",
        style: ButtonStyle.DANGER,
        emoji: { name: "❌" },
      }),
    ]),
  ];

  return {
    content: "📋 **Suggestion Preview**\nReview how your suggestion will appear publicly. Click **Confirm & Submit** to post it, **Edit** to modify, or **Cancel** to discard.",
    embeds: [embed],
    components: previewComponents,
  };
}
