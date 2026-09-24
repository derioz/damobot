/**
 * Shared Discord Interaction & API Utilities.
 * Centralized helpers for responses, components flags, modal parsing, and REST operations.
 */

import {
  InteractionResponseType,
  InteractionResponseFlags,
} from "discord-interactions";

export const IS_COMPONENTS_V2_FLAG = 32768; // 1 << 15
export const EPHEMERAL_FLAG = InteractionResponseFlags.EPHEMERAL; // 64

export const ComponentType = {
  ACTION_ROW: 1,
  BUTTON: 2,
  STRING_SELECT: 3,
  TEXT_INPUT: 4,
  USER_SELECT: 5,
  ROLE_SELECT: 6,
  MENTIONABLE_SELECT: 7,
  CHANNEL_SELECT: 8,
  SECTION: 9,
  TEXT_DISPLAY: 10,
  THUMBNAIL: 11,
  MEDIA_GALLERY: 12,
  FILE: 13,
  SEPARATOR: 14,
  CONTAINER: 17,
};

export const ButtonStyle = {
  PRIMARY: 1,
  SECONDARY: 2,
  SUCCESS: 3,
  DANGER: 4,
  LINK: 5,
};

/**
 * Standard JSON Response wrapper with application/json header.
 *
 * @param {Object} data
 * @param {number} [status=200]
 * @returns {Response}
 */
export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Ephemeral plain text response helper (Type 4).
 *
 * @param {string} content
 * @returns {Response}
 */
export function ephemeralTextResponse(content) {
  return jsonResponse({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      flags: EPHEMERAL_FLAG,
      content,
    },
  });
}

/**
 * Ephemeral Components V2 response helper (Type 4 with flags 32832).
 *
 * @param {Array|Object} components
 * @returns {Response}
 */
export function ephemeralComponentsResponse(components) {
  const componentArray = Array.isArray(components) ? components : [components];
  return jsonResponse({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      flags: EPHEMERAL_FLAG | IS_COMPONENTS_V2_FLAG,
      components: componentArray,
    },
  });
}

/**
 * Update interaction message with Components V2 (Type 7).
 * NOTE: Type 7 UPDATE_MESSAGE must NEVER include EPHEMERAL_FLAG (64),
 * as Discord rejects modifying ephemeral flags on existing messages with 400 Bad Request.
 *
 * @param {Array|Object} components
 * @returns {Response}
 */
export function updateComponentsResponse(components) {
  const componentArray = Array.isArray(components) ? components : [components];
  return jsonResponse({
    type: InteractionResponseType.UPDATE_MESSAGE,
    data: {
      flags: EPHEMERAL_FLAG | IS_COMPONENTS_V2_FLAG,
      components: componentArray,
    },
  });
}

/**
 * Discord Modal response helper (Type 9).
 *
 * @param {Object} modalData Modal definition with custom_id, title, components
 * @returns {Response}
 */
export function modalResponse(modalData) {
  return jsonResponse({
    type: InteractionResponseType.MODAL,
    data: modalData,
  });
}

/**
 * Discord Pong response helper (Type 1).
 *
 * @returns {Response}
 */
export function pongResponse() {
  return jsonResponse({
    type: InteractionResponseType.PONG,
  });
}

/**
 * Deferred channel message response helper (Type 5).
 * Acknowledges the interaction immediately and indicates a follow-up message will be sent.
 *
 * @param {boolean} [ephemeral=true]
 * @returns {Response}
 */
export function deferredChannelMessageResponse(ephemeral = true) {
  return jsonResponse({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: ephemeral ? { flags: EPHEMERAL_FLAG } : {},
  });
}

/**
 * Deferred message update response helper (Type 6).
 * Acknowledges component click immediately while background tasks run.
 *
 * @returns {Response}
 */
export function deferredUpdateMessageResponse() {
  return jsonResponse({
    type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE,
  });
}

/**
 * Extract modal field values from submitted modal components.
 * Supports both standard ActionRow inputs and modern Type 18 Label components.
 *
 * @param {Array<Object>} components
 * @returns {Record<string, string>}
 */
export function getModalValues(components = []) {
  const values = {};
  for (const row of components) {
    if (!row) continue;
    // Modern Label component (Type 18)
    if (row.component && row.component.custom_id) {
      if (row.component.value !== undefined) {
        values[row.component.custom_id] = row.component.value;
      } else if (Array.isArray(row.component.values)) {
        values[row.component.custom_id] = row.component.values;
      }
    }
    // ActionRow container (Type 1)
    if (Array.isArray(row.components)) {
      for (const comp of row.components) {
        if (!comp || !comp.custom_id) continue;
        if (comp.value !== undefined) {
          values[comp.custom_id] = comp.value;
        } else if (Array.isArray(comp.values)) {
          values[comp.custom_id] = comp.values;
        }
      }
    }
  }
  return values;
}

/**
 * Extract user object from interaction, handling both member.user (guild) and user (DM).
 *
 * @param {Object} interaction
 * @returns {Object}
 */
export function getUserFromInteraction(interaction) {
  return interaction?.member?.user || interaction?.user || {};
}

/**
 * Extract string array of role IDs from interaction member.
 *
 * @param {Object} interaction
 * @returns {string[]}
 */
export function getMemberRoles(interaction) {
  return Array.isArray(interaction?.member?.roles)
    ? interaction.member.roles.map((r) => String(r).trim())
    : [];
}

/**
 * Extract an option value by name from slash command options.
 *
 * @param {Object} interaction
 * @param {string} optionName
 * @returns {*}
 */
export function getCommandOption(interaction, optionName) {
  const options = interaction?.data?.options || [];
  const found = options.find((opt) => opt.name === optionName);
  return found ? found.value : undefined;
}

/**
 * Follow-up webhook response editor for deferred Discord interactions.
 * Discord rejects PATCH /messages/@original if flags is included.
 *
 * @param {Object} options
 * @param {Object} options.interaction
 * @param {Object} options.env
 * @param {string} [options.content]
 * @param {Array} [options.components]
 * @param {Function} [options.customFetch=fetch]
 * @returns {Promise<Response|null>}
 */
export async function editOriginalInteractionResponse({
  interaction,
  env,
  content,
  components = [],
  customFetch = fetch,
}) {
  const applicationId =
    interaction.application_id ||
    env?.DISCORD_APPLICATION_ID ||
    "1544164852132618382";
  const token = interaction.token;

  if (!applicationId || !token) {
    console.warn(
      "Cannot edit original interaction response: missing applicationId or token"
    );
    return null;
  }

  const url = `https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`;
  const body = {};
  if (content !== undefined) body.content = content;
  if (components && components.length > 0) {
    body.components = components;
  }

  try {
    let res = await customFetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    // Handle Discord HTTP 429 Rate Limit with safe backoff
    if (res.status === 429) {
      const retryAfterHeader = res.headers?.get ? res.headers.get("retry-after") : null;
      const retryAfterSec = parseFloat(retryAfterHeader || "1");
      const delayMs = Math.min(Math.max(retryAfterSec * 1000, 500), 1500);
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      res = await customFetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    }

    if (!res.ok) {
      const errText = await res.text();
      console.error(
        `Failed to edit original interaction response (${res.status}): ${errText}`
      );
    }
    return res;
  } catch (err) {
    console.error("Error editing original interaction response:", err);
    return null;
  }
}

/**
 * Generic Discord API fetch wrapper with Bot authorization.
 * Provides a standardized REST request client matching Architecture Recipe E.
 *
 * @param {Object} env Cloudflare Worker environment with DISCORD_BOT_TOKEN
 * @param {string} endpoint API endpoint path (e.g. "/channels/{id}/messages")
 * @param {RequestInit} [init={}] Fetch options
 * @param {Function} [customFetch=fetch] Custom fetch implementation
 * @returns {Promise<Response>}
 */
export async function discordFetch(env, endpoint, init = {}, customFetch = fetch) {
  const token = env?.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("Missing DISCORD_BOT_TOKEN in environment");

  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = `https://discord.com/api/v10${path}`;

  const headers = new Headers(init.headers || {});
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bot ${token}`);
  }
  if (!headers.has("Content-Type") && init.body && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }

  return await customFetch(url, {
    ...init,
    headers,
  });
}

/**
 * Post a message to a Discord channel via REST API.
 *
 * @param {Object} options
 * @param {string} options.channelId
 * @param {Object} options.env
 * @param {string} [options.content]
 * @param {Array} [options.components]
 * @param {Array} [options.embeds]
 * @param {Object} [options.message_reference]
 * @param {Object} [options.allowed_mentions]
 * @param {Function} [options.customFetch=fetch]
 * @returns {Promise<Response>}
 */
export async function sendDiscordChannelMessage({
  channelId,
  env,
  content,
  components,
  embeds,
  message_reference,
  allowed_mentions,
  customFetch = fetch,
}) {
  const token = env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("Missing DISCORD_BOT_TOKEN in environment");

  const body = {};
  if (content !== undefined) body.content = content;
  if (components !== undefined) body.components = components;
  if (embeds !== undefined) body.embeds = embeds;
  if (message_reference !== undefined) body.message_reference = message_reference;
  if (allowed_mentions !== undefined) body.allowed_mentions = allowed_mentions;

  return await customFetch(
    `https://discord.com/api/v10/channels/${channelId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
}

/**
 * Update (PATCH) an existing message in a Discord channel.
 *
 * @param {Object} options
 * @param {string} options.channelId
 * @param {string} options.messageId
 * @param {Object} options.env
 * @param {string} [options.content]
 * @param {Array} [options.components]
 * @param {Array} [options.embeds]
 * @param {Function} [options.customFetch=fetch]
 * @returns {Promise<Response>}
 */
export async function patchDiscordMessage({
  channelId,
  messageId,
  env,
  content,
  components,
  embeds,
  customFetch = fetch,
}) {
  const token = env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("Missing DISCORD_BOT_TOKEN in environment");

  const body = {};
  if (content !== undefined) body.content = content;
  if (components !== undefined) body.components = components;
  if (embeds !== undefined) body.embeds = embeds;

  return await customFetch(
    `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
}

/**
 * Delete a message in a Discord channel.
 *
 * @param {Object} options
 * @param {string} options.channelId
 * @param {string} options.messageId
 * @param {Object} options.env
 * @param {Function} [options.customFetch=fetch]
 * @returns {Promise<Response>}
 */
export async function deleteDiscordMessage({
  channelId,
  messageId,
  env,
  customFetch = fetch,
}) {
  const token = env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("Missing DISCORD_BOT_TOKEN in environment");

  return await customFetch(
    `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bot ${token}`,
      },
    }
  );
}

/**
 * Resolves a Discord user's avatar URL dynamically.
 * If user has a custom avatar, returns their avatar CDN URL (PNG or GIF).
 * If user does not have a custom avatar, calculates and returns their Discord default avatar URL.
 *
 * @param {Object} [user={}] Discord user object with id, avatar, and optional discriminator
 * @returns {string} CDN URL for the avatar
 */
export function getUserAvatarUrl(user = {}) {
  if (!user || typeof user !== "object") {
    return "https://cdn.discordapp.com/embed/avatars/0.png";
  }

  const { id, avatar, discriminator } = user;

  // Custom avatar present
  if (avatar && id) {
    const ext = String(avatar).startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/avatars/${id}/${avatar}.${ext}?size=256`;
  }

  // Fallback to Discord default avatar
  if (id) {
    if (discriminator && discriminator !== "0" && discriminator !== "#0000") {
      const discNum = parseInt(discriminator, 10);
      const index = isNaN(discNum) ? 0 : discNum % 5;
      return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
    }
    try {
      const index = Number((BigInt(id) >> 22n) % 6n);
      return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
    } catch {
      return "https://cdn.discordapp.com/embed/avatars/0.png";
    }
  }

  return "https://cdn.discordapp.com/embed/avatars/0.png";
}
