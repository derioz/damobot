/**
 * Interaction Handlers for Vital RP Suggestions.
 * Manages button clicks, modal submissions, previews, publishing, and voting.
 */

import {
  InteractionResponseType,
  InteractionResponseFlags,
} from "discord-interactions";
import {
  suggestionsConfig,
  getCategoryById,
} from "../../config/suggestions.config.js";
import {
  buildSuggestionCenterSticky,
  buildCategorySelectPrompt,
  buildSuggestionModal,
  buildSuggestionPreview,
  buildPublicSuggestionEmbed,
} from "./components.js";
import {
  jsonResponse,
  ephemeralTextResponse,
  ephemeralComponentsResponse,
  updateComponentsResponse,
  getUserFromInteraction,
  getUserAvatarUrl,
  getModalValues,
  ComponentType,
  ButtonStyle,
  IS_COMPONENTS_V2_FLAG,
} from "../../shared/discord.js";
import {
  createButton,
  createActionRow,
} from "../../shared/components.js";

/**
 * Validate that a URL uses safe HTTPS scheme and is well-formed.
 *
 * @param {string} urlStr
 * @returns {boolean}
 */
export function isValidSuggestionUrl(urlStr) {
  if (!urlStr || typeof urlStr !== "string") return false;
  const trimmed = urlStr.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" && parsed.hostname.includes(".");
  } catch {
    return false;
  }
}

/**
 * Format remaining seconds into a human-readable duration.
 *
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatCooldownTime(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  if (mins > 0 && secs > 0) {
    return `${mins} minute${mins === 1 ? "" : "s"} and ${secs} second${secs === 1 ? "" : "s"}`;
  }
  if (mins > 0) {
    return `${mins} minute${mins === 1 ? "" : "s"}`;
  }
  return `${secs} second${secs === 1 ? "" : "s"}`;
}

/**
 * Base64URL encoder for ephemeral draft tokens.
 */
function encodeDraft(data) {
  const json = JSON.stringify(data);
  return Buffer.from(json, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Base64URL decoder for ephemeral draft tokens.
 */
function decodeDraft(token) {
  try {
    if (!token) return null;
    let base64 = token.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) {
      base64 += "=";
    }
    const json = Buffer.from(base64, "base64").toString("utf-8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Handle initial click on "💡 Submit Suggestion" button from the Suggestion Center sticky.
 *
 * @param {Object} interaction
 * @param {Object} env
 * @returns {Promise<Response>}
 */
export async function handleSuggestionCenterClick(interaction, env) {
  try {
    const container = buildCategorySelectPrompt({
      selectedCategoryId: null,
      isAnonymous: false,
    });
    return ephemeralComponentsResponse(container);
  } catch (err) {
    console.error("handleSuggestionCenterClick error:", err?.stack || err?.message || err);
    return ephemeralTextResponse("❌ An error occurred while opening the suggestion prompt.");
  }
}

/**
 * Handle Suggestion component interactions (category select, privacy toggles, preview confirm/edit/cancel, and voting).
 *
 * @param {Object} interaction
 * @param {Object} env
 * @param {Object} ctx
 * @returns {Promise<Response>}
 */
export async function handleSuggestionComponent(interaction, env, ctx) {
  const customId = interaction.data?.custom_id || "";
  const user = getUserFromInteraction(interaction);
  const userId = user.id;

  // 1. Category Selection Dropdown
  if (customId.startsWith("sug_cat_select:")) {
    const isAnonymous = customId.split(":")[1] === "1";
    const selectedCategoryId = interaction.data?.values?.[0] || null;

    const container = buildCategorySelectPrompt({
      selectedCategoryId,
      isAnonymous,
    });

    return updateComponentsResponse([container]);
  }

  // 2. Privacy Preference Toggle
  if (customId.startsWith("sug_privacy:")) {
    const parts = customId.split(":");
    const selectedCategoryId = parts[1] === "none" ? null : parts[1];
    const isAnonymous = parts[2] === "anon";

    const container = buildCategorySelectPrompt({
      selectedCategoryId,
      isAnonymous,
    });

    return updateComponentsResponse([container]);
  }

  // 3. Open Suggestion Form Modal
  if (customId.startsWith("sug_open_modal:")) {
    const parts = customId.split(":");
    const categoryId = parts[1] || "scripts";
    const isAnonymous = parts[2] === "1";

    const modal = buildSuggestionModal({
      categoryId,
      isAnonymous,
    });

    return jsonResponse({
      type: InteractionResponseType.MODAL,
      data: modal,
    });
  }

  // 4. Disallow / reject any delete action on published suggestions
  if (
    customId.startsWith("sug_delete") ||
    customId.startsWith("sug_remove")
  ) {
    return ephemeralTextResponse("❌ Published suggestions cannot be deleted.");
  }

  // 5. Cancel Submission (Draft/Modal flow only)
  if (customId.startsWith("sug_cancel")) {
    // If somehow triggered on a non-ephemeral / public channel message, strictly prevent deletion
    if (interaction.message && !(interaction.message.flags & InteractionResponseFlags.EPHEMERAL)) {
      return ephemeralTextResponse("❌ Published suggestions cannot be deleted.");
    }

    if (env.SUGGESTIONS) {
      try {
        const doId = env.SUGGESTIONS.idFromName("global");
        const stub = env.SUGGESTIONS.get(doId);
        await stub.fetch("https://do/suggestions/draft/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        });
      } catch (_) {}
    }

    return jsonResponse({
      type: InteractionResponseType.UPDATE_MESSAGE,
      data: {
        content: "❌ **Suggestion cancelled.** No suggestion was posted.",
        embeds: [],
        components: [],
      },
    });
  }

  // 5. Edit from Preview
  if (customId.startsWith("sug_edit:")) {
    const draftToken = customId.slice("sug_edit:".length);
    let draft = null;

    if (env.SUGGESTIONS) {
      try {
        const doId = env.SUGGESTIONS.idFromName("global");
        const stub = env.SUGGESTIONS.get(doId);
        const res = await stub.fetch(`https://do/suggestions/draft/get?userId=${draftToken}`);
        if (res.ok) {
          draft = await res.json();
        }
      } catch (err) {
        console.error("Error retrieving suggestion draft:", err);
      }
    }

    if (!draft) {
      draft = decodeDraft(draftToken);
    }

    if (!draft) {
      return ephemeralTextResponse("⚠️ **Session Expired.** Please click Submit Suggestion again.");
    }

    const modal = buildSuggestionModal({
      categoryId: draft.categoryId,
      isAnonymous: draft.isAnonymous,
      initialTitle: draft.title,
      initialDescription: draft.description,
      initialUrl: draft.url || "",
      initialImageUrl: draft.attachmentUrl || draft.attachment_url || "",
    });

    return jsonResponse({
      type: InteractionResponseType.MODAL,
      data: modal,
    });
  }

  // 6. Confirm and Publish Suggestion
  if (customId.startsWith("sug_confirm:")) {
    const draftToken = customId.slice("sug_confirm:".length);
    let draft = null;

    if (env.SUGGESTIONS) {
      try {
        const doId = env.SUGGESTIONS.idFromName("global");
        const stub = env.SUGGESTIONS.get(doId);
        const res = await stub.fetch(`https://do/suggestions/draft/get?userId=${draftToken}`);
        if (res.ok) {
          draft = await res.json();
        }
      } catch (err) {
        console.error("Error retrieving suggestion draft:", err);
      }
    }

    if (!draft) {
      draft = decodeDraft(draftToken);
    }

    if (!draft) {
      return ephemeralTextResponse("⚠️ **Session Expired.** Please start a new suggestion.");
    }

    if (!env.SUGGESTIONS) {
      return ephemeralTextResponse("❌ Suggestions Durable Object is not configured.");
    }

    const channelId = suggestionsConfig.channels.getActiveChannelId(env);
    const guildId = interaction.guild_id || env.DISCORD_GUILD_ID || null;
    const authorTag = user.username ? `${user.username}` : "Player";

    try {
      const doId = env.SUGGESTIONS.idFromName("global");
      const stub = env.SUGGESTIONS.get(doId);

      // A. Double-check cooldown
      const cooldownRes = await stub.fetch(
        `https://do/suggestions/cooldown?userId=${userId}&cooldownSeconds=${suggestionsConfig.cooldownSeconds}`
      );
      const { onCooldown, remainingSeconds } = await cooldownRes.json();
      if (onCooldown) {
        return jsonResponse({
          type: InteractionResponseType.UPDATE_MESSAGE,
          data: {
            content: `⏳ **You are on cooldown.** You can submit another suggestion in **${formatCooldownTime(
              remainingSeconds
            )}**.`,
            embeds: [],
            components: [],
          },
        });
      }

      // B. Create Suggestion Record in DO
      const createRes = await stub.fetch("https://do/suggestions/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          authorTag,
          isAnonymous: draft.isAnonymous ? 1 : 0,
          categoryId: draft.categoryId,
          categoryLabel: draft.categoryLabel,
          title: draft.title,
          description: draft.description,
          url: draft.url || null,
          attachmentUrl: draft.attachmentUrl || null,
          attachmentName: draft.attachmentName || null,
          channelId,
          guildId,
          setCooldown: true,
        }),
      });

      if (!createRes.ok) {
        const errText = await createRes.text();
        throw new Error(`Failed to create suggestion in DO: ${errText}`);
      }

      const suggestion = await createRes.json();

      // C. Post Public Suggestion to Channel via Discord REST API
      // The draft/preview and final posted suggestion are built from the exact same shared embed builder
      const authorAvatarUrl = getUserAvatarUrl(user) || draft?.authorAvatarUrl || null;
      const { embed, actionRow } = buildPublicSuggestionEmbed({
        suggestion,
        authorDisplayName: authorTag,
        authorAvatarUrl,
      });

      const postRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          embeds: [embed],
          components: [actionRow],
          allowed_mentions: { parse: [] }, // Never allow @everyone, @here, or role pings
        }),
      });

      if (!postRes.ok) {
        const errText = await postRes.text();
        throw new Error(`Failed to post suggestion to channel ${channelId} (${postRes.status}): ${errText}`);
      }

      const postedMessage = await postRes.json();

      // D. Link posted message ID in DO
      await stub.fetch("https://do/suggestions/update-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestionId: suggestion.id,
          messageId: postedMessage.id,
        }),
      });

      // E. Reposition Suggestion Center Sticky to the bottom of the channel
      if (env.STICKY_BOT) {
        try {
          const stickyDoId = env.STICKY_BOT.idFromName("global");
          const stickyStub = env.STICKY_BOT.get(stickyDoId);
          await stickyStub.fetch("https://do/sticky/refresh", {
            method: "POST",
          });
        } catch (err) {
          console.warn("Non-fatal error refreshing sticky message:", err?.message);
        }
      }

      // F. Update ephemeral message with success
      return jsonResponse({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: {
          content: `✅ **Suggestion Submitted!**\nYour suggestion has been published in <#${channelId}> as **${suggestion.display_id}**.`,
          embeds: [],
          components: [],
        },
      });
    } catch (err) {
      console.error("Error publishing suggestion:", err);
      return jsonResponse({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: {
          content: `❌ **Failed to submit suggestion:** ${err.message}`,
          embeds: [],
          components: [],
        },
      });
    }
  }

  /**
   * Recursively update vote button labels inside components or nested containers.
   *
   * @param {Array<Object>} components
   * @param {string} suggestionId
   * @param {number} upvotes
   * @param {number} downvotes
   * @returns {Array<Object>}
   */
  function updateVoteButtonsInComponents(components, suggestionId, upvotes, downvotes) {
    if (!Array.isArray(components)) return [];
    return components.map((comp) => {
      if (comp.type === ComponentType.ACTION_ROW && Array.isArray(comp.components)) {
        return {
          ...comp,
          components: comp.components.map((btn) => {
            if (btn.custom_id === `sug_vote:${suggestionId}:up`) {
              return { ...btn, label: String(upvotes) };
            }
            if (btn.custom_id === `sug_vote:${suggestionId}:down`) {
              return { ...btn, label: String(downvotes) };
            }
            return btn;
          }),
        };
      }
      if (comp.type === ComponentType.CONTAINER && Array.isArray(comp.components)) {
        return {
          ...comp,
          components: updateVoteButtonsInComponents(
            comp.components,
            suggestionId,
            upvotes,
            downvotes
          ),
        };
      }
      return comp;
    });
  }

  // 7. Voting (👍 / 👎)
  if (customId.startsWith("sug_vote:")) {
    const parts = customId.split(":");
    const suggestionId = parts[1];
    const voteType = parts[2]; // "up" or "down"

    if (!env.SUGGESTIONS) {
      return ephemeralTextResponse("❌ Suggestions system is currently unavailable.");
    }

    try {
      const doId = env.SUGGESTIONS.idFromName("global");
      const stub = env.SUGGESTIONS.get(doId);

      const voteRes = await stub.fetch("https://do/suggestions/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestionId,
          userId,
          voteType,
        }),
      });

      const voteData = await voteRes.json();

      if (!voteData.ok) {
        return ephemeralTextResponse(`❌ ${voteData.error || "Could not record vote."}`);
      }

      // Reconstruct updated message components (supports both Container and ActionRow)
      const existingComponents = interaction.message?.components || [];
      const updatedComponents = updateVoteButtonsInComponents(
        existingComponents,
        suggestionId,
        voteData.upvotes,
        voteData.downvotes
      );

      // Update public message components directly with Type 7
      const updateData = {
        components: updatedComponents,
      };
      if (interaction.message?.flags && (interaction.message.flags & IS_COMPONENTS_V2_FLAG)) {
        updateData.flags = IS_COMPONENTS_V2_FLAG;
      }

      return jsonResponse({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: updateData,
      });
    } catch (err) {
      console.error("Error handling suggestion vote:", err);
      return ephemeralTextResponse("❌ An error occurred while processing your vote.");
    }
  }

  return ephemeralTextResponse("Unknown suggestion action.");
}

/**
 * Handle Modal Submission for a suggestion.
 * Validates text length and URL scheme, and returns an Ephemeral Preview.
 *
 * @param {Object} interaction
 * @param {Object} env
 * @returns {Promise<Response>}
 */
export async function handleSuggestionModalSubmit(interaction, env) {
  const customId = interaction.data?.custom_id || "";
  const parts = customId.split(":");
  const categoryId = parts[1] || "scripts";
  const isAnonymous = parts[2] === "1";

  const user = getUserFromInteraction(interaction);
  const authorTag = user.username ? `${user.username}` : "Player";
  const authorAvatarUrl = getUserAvatarUrl(user);

  const values = getModalValues(interaction.data?.components || []);
  const title = (values.sug_title || "").trim();
  const description = (values.sug_desc || "").trim();
  const rawUrl = (values.sug_url || "").trim();

  // 1. Validate Title Length
  if (
    title.length < suggestionsConfig.limits.titleMinLength ||
    title.length > suggestionsConfig.limits.titleMaxLength
  ) {
    return ephemeralTextResponse(
      `❌ **Invalid Title:** Title must be between ${suggestionsConfig.limits.titleMinLength} and ${suggestionsConfig.limits.titleMaxLength} characters (currently ${title.length}).`
    );
  }

  // 2. Validate Description Length
  if (
    description.length < suggestionsConfig.limits.descriptionMinLength ||
    description.length > suggestionsConfig.limits.descriptionMaxLength
  ) {
    return ephemeralTextResponse(
      `❌ **Invalid Description:** Description must be between ${suggestionsConfig.limits.descriptionMinLength} and ${suggestionsConfig.limits.descriptionMaxLength} characters (currently ${description.length}).`
    );
  }

  // 3. Validate URL (if provided)
  let cleanUrl = null;
  if (rawUrl) {
    if (!isValidSuggestionUrl(rawUrl)) {
      return ephemeralTextResponse(
        "❌ **Invalid URL:** The provided link must be a valid, secure `https://` web address (e.g. `https://example.com`)."
      );
    }
    cleanUrl = rawUrl;
  }

  // 4. Validate Image URL (if provided)
  let attachmentUrl = null;
  let attachmentName = null;
  const rawImageUrl = (values.sug_image_url || "").trim();
  if (rawImageUrl) {
    if (!isValidSuggestionUrl(rawImageUrl)) {
      return ephemeralTextResponse(
        "❌ **Invalid Image URL:** The provided image link must be a valid, secure `https://` address."
      );
    }
    attachmentUrl = rawImageUrl;
    attachmentName = "image.png";
  }

  const category = getCategoryById(categoryId) || { label: "Suggestion", emoji: "💡" };

  // 5. Construct draft payload & save to DO
  const draft = {
    userId: user.id,
    categoryId,
    categoryLabel: category.label,
    isAnonymous,
    title,
    description,
    url: cleanUrl,
    attachmentUrl,
    attachmentName,
    authorAvatarUrl,
  };

  if (env?.SUGGESTIONS) {
    try {
      const doId = env.SUGGESTIONS.idFromName("global");
      const stub = env.SUGGESTIONS.get(doId);
      await stub.fetch("https://do/suggestions/draft/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, draft }),
      });
    } catch (err) {
      console.error("Failed to save suggestion draft to DO:", err);
    }
  }

  // Use user.id as token: short, clean, guaranteed <= 30 chars (well within Discord 100 limit)
  const draftToken = user.id;

  // 6. Return Ephemeral Preview
  const previewData = buildSuggestionPreview({
    draft,
    authorTag,
    draftToken,
    authorAvatarUrl,
  });

  return jsonResponse({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      flags: InteractionResponseFlags.EPHEMERAL,
      content: previewData.content,
      embeds: previewData.embeds,
      components: previewData.components,
    },
  });
}
