import {
  InteractionResponseType,
  InteractionResponseFlags,
} from "discord-interactions";
import {
  parseAndValidateDate,
  isoToDisplayDate,
  formatPrettyDate,
  formatPrettyDateRange,
  formatCompactDateRange,
  getTodayInChicago,
  getLoaStatus,
} from "./dateUtils.js";
import {
  formatLoaNickname,
  stripLoaPrefix,
  computeRestoredNickname,
  modifyGuildMemberNickname,
  getGuildMember,
} from "./nicknameUtils.js";
import {
  DAMO_BOT_VERSION,
  VITAL_RP_LOGO_URL,
  DEFAULT_STAFF_TEAM_ROLE_ID,
  DEFAULT_OWNER_ROLE_ID,
  DEFAULT_STAFF_LOA_ROLE_ID,
  DEFAULT_LOA_CHANNEL_ID,
  DEFAULT_LOA_LOG_CHANNEL_ID,
  loaConfig,
  canManageLOAs,
  hasStaffLoaRole,
  canViewLoaHistory,
  isLOACenterChannel,
  isLOALogChannel,
} from "../../config.js";
import { hasStaffRole } from "../../shared/permissions.js";
import {
  executeLoaRoleSwap,
  executeLoaRoleRestore,
  getGuildRoles,
} from "./roleUtils.js";
import {
  logLoaStarted,
  logLoaEnded,
  logLoaWarning,
} from "./loaLogger.js";

export const IS_COMPONENTS_V2_FLAG = 32768; // 1 << 15
export const EPHEMERAL_FLAG = InteractionResponseFlags.EPHEMERAL; // 64

export const VITAL_ORANGE = 16425472; // #FAA200

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

export const LoaCustomId = {
  BTN_START: "loa_btn_start",
  BTN_EDIT: "loa_btn_edit",
  BTN_CANCEL: "loa_btn_cancel",
  BTN_STATUS: "loa_btn_status",
  BTN_REFRESH: "loa_btn_refresh",
  BTN_ALERTS: "loa_btn_alerts",
  CANCEL_DISMISS: "loa_cancel_dismiss",
  CONFIRM_CANCEL_PREFIX: "loa_confirm_cancel:",
  CONFIRM_RETURN_PREFIX: "loa_confirm_return:",
  ALERT_TOGGLE_PREFIX: "loa_alert_toggle:",
  MODAL_START: "loa_modal_start",
  MODAL_EDIT_PREFIX: "loa_modal_edit",
};

/**
 * Build a Container component (Type 17).
 * @param {Array<Object>} components
 * @param {number} [accentColor=VITAL_ORANGE]
 * @returns {Object}
 */
export function createContainer(components = [], accentColor = VITAL_ORANGE) {
  return {
    type: ComponentType.CONTAINER,
    accent_color: accentColor,
    components,
  };
}

/**
 * Build a Text Display component (Type 10).
 * @param {string} content
 * @returns {Object}
 */
export function createTextDisplay(content) {
  return {
    type: ComponentType.TEXT_DISPLAY,
    content,
  };
}

/**
 * Build a Section component (Type 9).
 * @param {Array<Object>} components
 * @param {Object|null} [accessory=null]
 * @returns {Object}
 */
export function createSection(components = [], accessory = null) {
  const section = {
    type: ComponentType.SECTION,
    components: Array.isArray(components) ? components : [components],
  };
  if (accessory) {
    section.accessory = accessory;
  }
  return section;
}

/**
 * Build a Thumbnail component (Type 11).
 * @param {string} url
 * @param {string} [description="Vital RP Logo"]
 * @returns {Object}
 */
export function createThumbnail(url, description = "Vital RP Logo") {
  return {
    type: ComponentType.THUMBNAIL,
    media: {
      url,
    },
    description,
  };
}

/**
 * Reusable Components V2 text-only footer builder.
 *
 * Structure:
 * TextDisplay (Type 10):
 *   -# 🤖 Damo Bot • ${productName}
 *   -# ${DAMO_BOT_VERSION} • ${personalityLine || timestampText}
 *
 * @param {Object} options
 * @param {string} [options.productName="Staff LOA Manager"]
 * @param {number|string|boolean|null} [options.timestamp=null]
 * @param {string|null} [options.personalityLine=null]
 * @returns {Object} Discord Components V2 TextDisplay component
 */
export function buildDamoFooter({
  productName = "Staff LOA Manager",
  timestamp = null,
  personalityLine = null,
} = {}) {
  const lines = [`-# 🤖 Damo Bot • ${productName}`];

  if (personalityLine) {
    lines.push(`-# ${DAMO_BOT_VERSION} • ${personalityLine}`);
  } else if (typeof timestamp === "number") {
    lines.push(`-# ${DAMO_BOT_VERSION} • Updated <t:${timestamp}:R>`);
  } else if (typeof timestamp === "string") {
    lines.push(`-# ${DAMO_BOT_VERSION} • Updated ${timestamp}`);
  } else if (timestamp === true) {
    const nowSec = Math.floor(Date.now() / 1000);
    lines.push(`-# ${DAMO_BOT_VERSION} • Updated <t:${nowSec}:R>`);
  } else {
    lines.push(`-# ${DAMO_BOT_VERSION}`);
  }

  return createTextDisplay(lines.join("\n"));
}

/**
 * Build a Separator component (Type 14).
 * @param {boolean} [divider=true]
 * @param {number} [spacing=1] - 1 for small, 2 for large
 * @returns {Object}
 */
export function createSeparator(divider = true, spacing = 1) {
  return {
    type: ComponentType.SEPARATOR,
    divider,
    spacing,
  };
}

/**
 * Build an Action Row containing Buttons.
 * @param {Array<Object>} components
 * @returns {Object}
 */
export function createActionRow(components = []) {
  return {
    type: ComponentType.ACTION_ROW,
    components,
  };
}

/**
 * Build a Button component (Type 2).
 * @param {Object} options
 * @returns {Object}
 */
export function createButton({
  customId,
  label,
  style = ButtonStyle.SECONDARY,
  emoji = null,
  disabled = false,
}) {
  const btn = {
    type: ComponentType.BUTTON,
    custom_id: customId,
    label,
    style,
    disabled,
  };
  if (emoji) {
    btn.emoji = typeof emoji === "string" ? { name: emoji } : emoji;
  }
  return btn;
}

/**
 * Build the standard LOA control panel Action Row (4 controls).
 * [ 🏖️ Start LOA ] [ 👤 My LOA ] [ 🔄 Refresh ] [ 🔔 Return Alerts ]
 *
 * @returns {Array<Object>}
 */
export function createLoaControlActionRows() {
  return [
    createActionRow([
      createButton({
        customId: LoaCustomId.BTN_START,
        label: "Start LOA",
        style: ButtonStyle.PRIMARY,
        emoji: "🏖️",
      }),
      createButton({
        customId: LoaCustomId.BTN_STATUS,
        label: "My LOA",
        style: ButtonStyle.SECONDARY,
        emoji: "👤",
      }),
      createButton({
        customId: LoaCustomId.BTN_REFRESH,
        label: "Refresh",
        style: ButtonStyle.SECONDARY,
        emoji: "🔄",
      }),
      createButton({
        customId: LoaCustomId.BTN_ALERTS,
        label: "Return Alerts",
        style: ButtonStyle.SECONDARY,
        emoji: "🔔",
      }),
    ]),
  ];
}

/**
 * Helper to build standard ephemeral interaction response with plain text.
 * @param {string} content
 * @returns {Response}
 */
export function ephemeralTextResponse(content) {
  return new Response(
    JSON.stringify({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content,
        flags: EPHEMERAL_FLAG,
      },
    }),
    {
      headers: {
        "content-type": "application/json",
      },
    }
  );
}

/**
 * Helper to build public interaction response with Components V2.
 * @param {Array<Object>} components
 * @param {Array<string>} [allowedUserIds=[]]
 * @returns {Response}
 */
export function publicComponentsResponse(components, allowedUserIds = []) {
  const componentArray = Array.isArray(components) ? components : [components];
  return new Response(
    JSON.stringify({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        flags: IS_COMPONENTS_V2_FLAG,
        components: componentArray,
        allowed_mentions: {
          parse: [],
          users: allowedUserIds,
        },
      },
    }),
    {
      headers: {
        "content-type": "application/json",
      },
    }
  );
}

/**
 * Helper to build ephemeral interaction response with Components V2.
 * @param {Array<Object>} components
 * @returns {Response}
 */
export function ephemeralComponentsResponse(components) {
  const componentArray = Array.isArray(components) ? components : [components];
  return new Response(
    JSON.stringify({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        flags: EPHEMERAL_FLAG | IS_COMPONENTS_V2_FLAG, // 32832
        components: componentArray,
      },
    }),
    {
      headers: {
        "content-type": "application/json",
      },
    }
  );
}

/**
 * Helper to build an interaction update response (Type 7).
 * @param {Array<Object>} components
 * @returns {Response}
 */
export function updateComponentsResponse(components) {
  const componentArray = Array.isArray(components) ? components : [components];
  return new Response(
    JSON.stringify({
      type: InteractionResponseType.UPDATE_MESSAGE,
      data: {
        flags: EPHEMERAL_FLAG | IS_COMPONENTS_V2_FLAG,
        components: componentArray,
      },
    }),
    {
      headers: {
        "content-type": "application/json",
      },
    }
  );
}

/**
 * Helper to build a Modal interaction response (Type 9).
 * @param {Object} params
 * @param {string} params.title
 * @param {string} params.customId
 * @param {Array<Object>} params.components
 * @returns {Response}
 */
export function modalResponse({ title, customId, components }) {
  return new Response(
    JSON.stringify({
      type: InteractionResponseType.MODAL,
      data: {
        title,
        custom_id: customId,
        components,
      },
    }),
    {
      headers: {
        "content-type": "application/json",
      },
    }
  );
}

/**
 * Helper to create a Modal Text Input component wrapped in an Action Row.
 * @param {Object} options
 * @returns {Object}
 */
export function createTextInputRow({
  customId,
  label,
  style = 1, // 1 for Short, 2 for Paragraph
  placeholder = "",
  value = "",
  required = true,
  minLength = undefined,
  maxLength = undefined,
}) {
  const comp = {
    type: ComponentType.TEXT_INPUT,
    custom_id: customId,
    label,
    style,
    required,
  };
  if (placeholder) comp.placeholder = placeholder;
  if (value) comp.value = value;
  if (minLength !== undefined) comp.min_length = minLength;
  if (maxLength !== undefined) comp.max_length = maxLength;

  return {
    type: ComponentType.ACTION_ROW,
    components: [comp],
  };
}

/**
 * Extract field values from a submitted Modal interaction data.
 * @param {Array<Object>} components
 * @returns {Record<string, string>}
 */
export function getModalValues(components = []) {
  const values = {};
  for (const row of components) {
    if (Array.isArray(row.components)) {
      for (const comp of row.components) {
        if (comp.custom_id && comp.value !== undefined) {
          values[comp.custom_id] = comp.value;
        }
      }
    }
  }
  return values;
}

/**
 * Build Components V2 Container(s) for the unified public Staff LOA Center.
 *
 * Header:
 *   Section (Type 9):
 *     components: [TextDisplay]:
 *       # 🏖️ Staff LOA Center
 *       X staff members currently away
 *       Y returning today
 *     accessory: Thumbnail (Type 11) using VITAL_RP_LOGO_URL
 * Action Row:
 *   [ 🏖️ Start LOA ] [ 👤 My LOA ] [ 🔄 Refresh ] [ 🔔 Return Alerts ]
 * Separator
 * Active Staff entries (with clean name and optional avatar Thumbnail)
 * Separator
 * Footer:
 *   TextDisplay (Type 10) - text only, centralized version
 *
 * @param {Array<Object>} loas - List of active LOAs
 * @param {string|null} [recentActivity=null] - Optional subtle recent activity string
 * @param {string} [todayIso=getTodayInChicago()]
 * @returns {Array<Object>} Array of Container components
 */
export function buildLoaListContainers(
  loas = [],
  recentActivity = null,
  todayIso = getTodayInChicago()
) {
  const controlRows = createLoaControlActionRows();

  // Helper to build header section
  function createHeaderSection(page = 1, totalPages = 1) {
    const headerLines = [];
    const title =
      totalPages > 1
        ? `# 🏖️ Staff LOA Center (Page ${page} of ${totalPages})`
        : "# 🏖️ Staff LOA Center";
    headerLines.push(title);

    if (loas.length === 0) {
      headerLines.push("🟢 No staff members are currently on LOA.");
    } else {
      const activeCount = loas.filter((l) => l.start_date <= todayIso).length;
      const upcomingCount = loas.filter((l) => l.start_date > todayIso).length;

      if (upcomingCount === 0) {
        const awayText = `${activeCount} staff member${activeCount === 1 ? " is" : "s are"} currently away`;
        headerLines.push(awayText);
      } else if (activeCount > 0) {
        headerLines.push(
          `${activeCount} staff member${activeCount === 1 ? " is" : "s are"} currently away • ${upcomingCount} upcoming`
        );
      } else {
        headerLines.push(`No staff members currently away • ${upcomingCount} upcoming`);
      }

      const returningToday = loas.filter(
        (l) => l.start_date <= todayIso && l.end_date === todayIso
      ).length;
      if (returningToday > 0) {
        headerLines.push(
          `${returningToday} staff member${returningToday === 1 ? "" : "s"} returning today`
        );
      }
    }

    const textComp = createTextDisplay(headerLines.join("\n\n"));
    const accessory = VITAL_RP_LOGO_URL
      ? createThumbnail(VITAL_RP_LOGO_URL, "Vital RP Logo")
      : null;

    return createSection([textComp], accessory);
  }

  // Case 1: Empty list (Nobody currently on LOA)
  if (loas.length === 0) {
    const innerComponents = [
      createHeaderSection(1, 1),
      ...controlRows,
      createSeparator(true, 1),
    ];

    if (recentActivity) {
      innerComponents.push(createTextDisplay(`-# ${recentActivity}`));
      innerComponents.push(createSeparator(true, 1));
    }

    innerComponents.push(
      buildDamoFooter({
        productName: "Staff LOA Manager",
        personalityLine: "Suspicious levels of staff availability detected.",
      })
    );

    return [createContainer(innerComponents)];
  }

  // Case 2: Active staff on LOA
  const CHUNK_SIZE = 15;
  const totalPages = Math.ceil(loas.length / CHUNK_SIZE);
  const containers = [];

  for (let page = 0; page < totalPages; page++) {
    const chunk = loas.slice(page * CHUNK_SIZE, (page + 1) * CHUNK_SIZE);
    const innerComponents = [createHeaderSection(page + 1, totalPages)];

    // Embed control action rows at the top of the first page
    if (page === 0) {
      innerComponents.push(...controlRows);
    }

    for (const staff of chunk) {
      innerComponents.push(createSeparator(true, 1));
      const cleanDisplayName = stripLoaPrefix(staff.display_name);
      const isUpcoming = staff.start_date > todayIso;
      const isReturningToday = !isUpcoming && staff.end_date === todayIso;

      let subText;
      let statusIcon;
      if (isUpcoming) {
        statusIcon = "🟡";
        subText = `🗓️ Starts ${formatPrettyDate(staff.start_date)}`;
      } else {
        statusIcon = "🟢";
        subText = isReturningToday
          ? "↩️ Returns today"
          : `↩️ Returns ${formatPrettyDate(staff.end_date)}`;
      }

      const safeReason = (staff.reason || "").trim().slice(0, 500);

      const staffContent = [
        `${statusIcon} **${cleanDisplayName}**`,
        `**${formatCompactDateRange(staff.start_date, staff.end_date)}**`,
        `> ${safeReason}`,
        `-# ${subText}`,
      ].join("\n");

      const staffText = createTextDisplay(staffContent);

      if (staff.avatar_url) {
        innerComponents.push(
          createSection(
            [staffText],
            createThumbnail(staff.avatar_url, `${cleanDisplayName}'s avatar`)
          )
        );
      } else {
        innerComponents.push(staffText);
      }
    }

    innerComponents.push(createSeparator(true, 1));

    // Optional recent activity line (shown on last page)
    if (recentActivity && page === totalPages - 1) {
      innerComponents.push(createTextDisplay(`-# ${recentActivity}`));
      innerComponents.push(createSeparator(true, 1));
    }

    innerComponents.push(
      buildDamoFooter({
        productName: "Staff LOA Manager",
        timestamp: Math.floor(Date.now() / 1000),
      })
    );

    containers.push(createContainer(innerComponents));
  }

  return containers;
}

/**
 * Refresh the public permanent LOA dashboard message in the designated LOA channel.
 * Reads the active LOA list and metadata from the StaffLoaDO, formats the components.
 * If repost is true, creates a fresh message via POST, updates DO metadata, and deletes
 * the previous message.
 * If repost is false, updates the existing Discord message via PATCH in place, falling
 * back to POST if the message was deleted (404).
 *
 * @param {Object} params
 * @param {Object} params.env
 * @param {string} params.guildId
 * @param {string} [params.todayIso]
 * @param {string} [params.recentActivity]
 * @param {Function} [params.customFetch]
 * @param {boolean} [params.repost=false]
 * @param {Object} [params.ctx]
 * @returns {Promise<{ success: boolean, containers: Array, messageId?: string, error?: string }>}
 */
export async function refreshPublicLoaList({
  env,
  guildId,
  todayIso = getTodayInChicago(),
  recentActivity = undefined,
  customFetch = fetch,
  repost = false,
  ctx = null,
}) {
  if (!env.STAFF_LOA) {
    return { success: false, containers: [] };
  }

  const doId = env.STAFF_LOA.idFromName(guildId);
  const stub = env.STAFF_LOA.get(doId);

  // Update recent activity in DO if provided
  if (recentActivity !== undefined) {
    await stub.fetch("https://do/loa/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recentActivity: recentActivity || "" }),
    });
  }

  // Fetch active LOAs and current metadata
  const [listRes, metaRes] = await Promise.all([
    stub.fetch(`https://do/loa/list?today=${encodeURIComponent(todayIso)}`),
    stub.fetch("https://do/loa/meta"),
  ]);

  const listData = await listRes.json();
  const metaData = await metaRes.json();

  const loas = listData?.loas || [];
  const activeRecentActivity =
    recentActivity !== undefined ? recentActivity : metaData?.recentActivity || null;

  const containers = buildLoaListContainers(loas, activeRecentActivity, todayIso);

  const botToken = env.DISCORD_BOT_TOKEN;
  const channelId = String(
    env.LOA_CHANNEL_ID || loaConfig.channels?.center || DEFAULT_LOA_CHANNEL_ID
  ).trim();

  if (botToken && channelId) {
    try {
      const existingMsgId = metaData?.lastListMessageId?.trim() || null;
      const existingChannelId = metaData?.lastListChannelId?.trim() || null;
      const channelChanged = Boolean(existingChannelId && existingChannelId !== channelId);

      // 1. If not reposting, channel hasn't changed, and permanent dashboard message ID exists, update it in place via PATCH
      if (!repost && !channelChanged && existingMsgId) {
        const patchUrl = `https://discord.com/api/v10/channels/${channelId}/messages/${existingMsgId}`;
        const patchRes = await customFetch(patchUrl, {
          method: "PATCH",
          headers: {
            Authorization: `Bot ${botToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            flags: IS_COMPONENTS_V2_FLAG,
            components: containers,
            allowed_mentions: { parse: [] },
          }),
        });

        if (patchRes.ok) {
          return { success: true, containers, messageId: existingMsgId };
        }

        // If message was deleted (404), fall through to recreate it
        if (patchRes.status === 404) {
          console.info(`Existing LOA dashboard (${existingMsgId}) not found (404). Recreating replacement dashboard.`);
        } else {
          const errTxt = await patchRes.text();
          console.warn(`Failed to patch existing LOA dashboard (${patchRes.status}):`, errTxt);
          return { success: false, containers, error: errTxt };
        }
      }

      // 2. Post new message to the LOA channel via POST (initial creation, repost, or 404 recovery)
      const postUrl = `https://discord.com/api/v10/channels/${channelId}/messages`;
      const postRes = await customFetch(postUrl, {
        method: "POST",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          flags: IS_COMPONENTS_V2_FLAG,
          components: containers,
          allowed_mentions: { parse: [] },
        }),
      });

      if (postRes.ok) {
        const newMsg = await postRes.json();

        // Store new message ID and channel ID in DO metadata
        await stub.fetch("https://do/loa/meta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lastListMessageId: newMsg.id,
            lastListChannelId: channelId,
          }),
        });

        // 3. If reposting and a previous message existed in THIS channel, delete the old message
        // IMPORTANT: Never delete messages from the old channel when channel changed!
        if (repost && !channelChanged && existingMsgId && existingMsgId !== newMsg.id) {
          const deleteOldMessage = async () => {
            try {
              const deleteUrl = `https://discord.com/api/v10/channels/${channelId}/messages/${existingMsgId}`;
              const delRes = await customFetch(deleteUrl, {
                method: "DELETE",
                headers: {
                  Authorization: `Bot ${botToken}`,
                },
              });
              if (!delRes.ok && delRes.status !== 404) {
                const delErrTxt = await delRes.text();
                console.warn(`Failed to delete previous LOA dashboard (${delRes.status}):`, delErrTxt);
              }
            } catch (delErr) {
              console.warn("Exception deleting previous LOA dashboard message:", delErr?.message || delErr);
            }
          };

          if (ctx?.waitUntil) {
            ctx.waitUntil(deleteOldMessage());
          } else {
            await deleteOldMessage();
          }
        }

        return { success: true, containers, messageId: newMsg.id };
      } else {
        const errTxt = await postRes.text();
        console.warn(`Failed to post LOA dashboard (${postRes.status}):`, errTxt);
        return { success: false, containers, error: errTxt };
      }
    } catch (err) {
      console.warn("Exception refreshing public LOA dashboard message:", err?.message || err);
      return { success: false, containers, error: err?.message || String(err) };
    }
  }

  return { success: true, containers };
}

/**
 * Validate interaction access for LOA commands, buttons, and modals.
 *
 * @param {Object} interaction
 * @param {Object} env
 * @returns {{ valid: boolean, errorResponse?: Response, guildId?: string, userId?: string, displayName?: string, memberNick?: string|null, stub?: Object, todayIso?: string }}
 */
export async function validateLoaAccess(interaction, env) {
  // 1. Guild check
  const guildId =
    interaction.guild_id ||
    interaction.member?.guild_id ||
    env.DISCORD_GUILD_ID ||
    env.GUILD_ID;
  if (!guildId || !interaction.member) {
    return {
      valid: false,
      errorResponse: ephemeralTextResponse("❌ LOA commands can only be used in a server."),
    };
  }

  const user = interaction.member?.user || interaction.user;
  const userId = user?.id;
  if (!userId) {
    return {
      valid: false,
      errorResponse: ephemeralTextResponse("❌ Could not identify invoking user."),
    };
  }

  // 2. Channel check
  const currentChannelId = String(
    interaction.channel_id || interaction.channel?.id || ""
  ).trim();

  if (!isLOACenterChannel(currentChannelId, env)) {
    const loaChannelId = String(
      env.LOA_CHANNEL_ID || loaConfig.channels?.center || DEFAULT_LOA_CHANNEL_ID
    ).trim();
    if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
      console.warn(`[loa] Access denied for user ${userId} in channel ${currentChannelId} (expected ${loaChannelId})`);
    }
    return {
      valid: false,
      errorResponse: ephemeralTextResponse(
        "❌ LOA commands can only be used in the designated LOA channel."
      ),
    };
  }

  // 3. DO check
  if (!env.STAFF_LOA) {
    return {
      valid: false,
      errorResponse: ephemeralTextResponse(
        "❌ Staff LOA Durable Object binding is not configured."
      ),
    };
  }

  const doId = env.STAFF_LOA.idFromName(guildId);
  const stub = env.STAFF_LOA.get(doId);
  const todayIso = getTodayInChicago();

  // 4. Role check (Active staff OR Staff currently on LOA with active database record)
  const isStaff =
    canManageLOAs(interaction, env) || hasStaffRole(interaction, env);

  const hasLoaRole = hasStaffLoaRole(interaction, env);
  let isOnLoa = false;

  if (!isStaff && hasLoaRole && stub) {
    try {
      const curRes = await stub.fetch(
        `https://do/loa/current?userId=${encodeURIComponent(userId)}&today=${encodeURIComponent(todayIso)}`
      );
      if (curRes.ok) {
        const curData = await curRes.json();
        if (curData?.loa) {
          isOnLoa = true;
        }
      }
    } catch (_) {}
  }

  if (!isStaff && !isOnLoa) {
    if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
      console.warn(`[loa] Staff role access denied for user ${userId} in channel ${currentChannelId}`);
    }
    return {
      valid: false,
      errorResponse: ephemeralTextResponse(
        "❌ This command is only available to Vital RP staff."
      ),
    };
  }

  const memberNick = interaction.member?.nick || null;
  const displayName =
    interaction.member?.nick ||
    user?.global_name ||
    user?.username ||
    userId;

  return {
    valid: true,
    guildId,
    userId,
    displayName,
    memberNick,
    stub,
    todayIso,
    isStaff,
    isOnLoa,
    memberRoles: interaction.member?.roles || [],
  };
}

/**
 * Safely restore a staff member's nickname after an active LOA ends early or completes.
 *
 * @param {Object} params
 * @param {Object} params.env
 * @param {string} params.guildId
 * @param {string} params.userId
 * @param {Object} params.loa
 * @param {Function} [params.customFetch=fetch]
 */
export async function restoreMemberNicknameAfterLoa({
  env,
  guildId,
  userId,
  loa,
  customFetch = fetch,
}) {
  if (!loa || !loa.nickname_modified) return;

  try {
    const memberRes = await getGuildMember({
      env,
      guildId,
      userId,
      customFetch,
    });

    const currentNick = memberRes.success ? memberRes.member?.nick || null : null;
    const restoredNick = computeRestoredNickname({
      currentNickname: currentNick,
      originalNickname: loa.original_nickname,
      loaNickname: loa.loa_nickname,
    });

    await modifyGuildMemberNickname({
      env,
      guildId,
      userId,
      newNickname: restoredNick,
      reason: "Staff LOA ended early / returned",
      customFetch,
    });

    if (env.STAFF_LOA) {
      const doId = env.STAFF_LOA.idFromName(guildId);
      const stub = env.STAFF_LOA.get(doId);
      await stub.fetch("https://do/loa/nickname-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loaId: loa.id, nicknameModified: 0 }),
      });
    }
  } catch (err) {
    console.warn("Exception restoring nickname after LOA:", err?.message || err);
  }
}

/**
 * Shared logic to execute starting an LOA.
 * Updates DO record, triggers public list replacement, and returns ephemeral result.
 * If LOA starts today, automatically adds "LOA | " prefix to the member's nickname.
 */
export async function executeLoaStart({
  env,
  guildId,
  userId,
  displayName,
  memberNick = null,
  startDateVal,
  endDateVal,
  reasonVal,
  todayIso,
  stub,
  customFetch = fetch,
  ctx = null,
  memberRoles = [],
}) {
  if (!startDateVal || !endDateVal || !reasonVal) {
    return ephemeralTextResponse(
      "❌ Missing required fields. Please supply start_date, end_date, and reason."
    );
  }

  const parsedStart = parseAndValidateDate(startDateVal, todayIso);
  if (!parsedStart.valid) {
    return ephemeralTextResponse(
      `❌ Invalid Start Date\n\n${parsedStart.error || "Please enter a valid date, for example:\n`9/5/2026`, `09/05/2026`, or `9/5`"}`
    );
  }

  const parsedEnd = parseAndValidateDate(endDateVal, todayIso);
  if (!parsedEnd.valid) {
    return ephemeralTextResponse(
      `❌ Invalid End Date\n\n${parsedEnd.error || "Please enter a valid date, for example:\n`9/12/2026`, `09/12/2026`, or `9/12`"}`
    );
  }

  if (parsedEnd.isoDate < parsedStart.isoDate) {
    return ephemeralTextResponse("❌ End date cannot be before start date.");
  }

  // Duration validation from loaConfig.settings
  const startDateObj = new Date(`${parsedStart.isoDate}T00:00:00Z`);
  const endDateObj = new Date(`${parsedEnd.isoDate}T00:00:00Z`);
  const durationDays =
    Math.round((endDateObj - startDateObj) / (1000 * 60 * 60 * 24)) + 1;

  if (
    loaConfig.settings?.minimumDays &&
    durationDays < loaConfig.settings.minimumDays
  ) {
    return ephemeralTextResponse(
      `❌ LOA duration must be at least ${loaConfig.settings.minimumDays} day${loaConfig.settings.minimumDays === 1 ? "" : "s"}.`
    );
  }
  if (
    loaConfig.settings?.maximumDays &&
    durationDays > loaConfig.settings.maximumDays
  ) {
    return ephemeralTextResponse(
      `❌ LOA duration cannot exceed ${loaConfig.settings.maximumDays} days.`
    );
  }

  const trimmedReason = reasonVal.trim();
  if (!trimmedReason) {
    return ephemeralTextResponse("❌ Reason cannot be empty.");
  }

  // Determine if LOA starts today (immediately active)
  const isStartingToday = parsedStart.isoDate <= todayIso;
  let nicknameModified = 0;
  let nicknameWarning = false;
  let loaNickname = null;

  if (isStartingToday) {
    const baseName = memberNick || displayName;
    loaNickname = formatLoaNickname(baseName);
    const modRes = await modifyGuildMemberNickname({
      env,
      guildId,
      userId,
      newNickname: loaNickname,
      reason: "Staff LOA started",
      customFetch,
    });

    if (modRes.success) {
      nicknameModified = 1;
    } else {
      nicknameWarning = true;
      if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
        console.warn(`Could not update nickname for user ${userId}:`, modRes.error);
      }
    }
  }

  const newLoaId = crypto.randomUUID();

  try {
    const createRes = await stub.fetch("https://do/loa/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: newLoaId,
        guildId,
        userId,
        displayName,
        startDate: parsedStart.isoDate,
        endDate: parsedEnd.isoDate,
        reason: trimmedReason,
        todayIso,
        originalNickname: memberNick,
        loaNickname,
        nicknameModified,
      }),
    });

    const data = await createRes.json();

    if (!createRes.ok || !data.success) {
      // Revert nickname change if record creation failed
      if (nicknameModified) {
        await modifyGuildMemberNickname({
          env,
          guildId,
          userId,
          newNickname: memberNick,
          reason: "Staff LOA start failed - rollback",
          customFetch,
        });
      }

      if (data.error === "ALREADY_EXISTS") {
        return ephemeralTextResponse(
          "❌ You already have an active or upcoming LOA. You can only have one active or upcoming LOA at a time.\n\nUse My LOA to manage it."
        );
      }
      return ephemeralTextResponse(`❌ Failed to submit LOA: ${data.error || "Unknown error"}`);
    }

    let roleSwapResult = null;
    if (isStartingToday) {
      roleSwapResult = await executeLoaRoleSwap({
        env,
        guildId,
        userId,
        currentMemberRoles: memberRoles,
        stub,
        loaId: newLoaId,
        customFetch,
      });

      if (!roleSwapResult.success) {
        // Rollback nickname if modified
        if (nicknameModified) {
          await modifyGuildMemberNickname({
            env,
            guildId,
            userId,
            newNickname: memberNick,
            reason: "Staff LOA start failed - rollback",
            customFetch,
          });
        }

        // Cancel the created LOA in DO so member is not stuck on LOA
        await stub.fetch("https://do/loa/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ loaId: newLoaId, userId }),
        });

        // Audit log the failure/warning
        await logLoaWarning({
          env,
          guildId,
          userId,
          message: `Role swap failed during LOA start for ${displayName} (<@${userId}>): ${roleSwapResult.error}`,
          customFetch,
        }).catch(() => {});

        return ephemeralTextResponse(
          `❌ Leave of Absence could not be started:\n\n${roleSwapResult.error || "Role swap failed."}\n\nNo roles were removed and your LOA was cancelled.`
        );
      }

      // Role swap succeeded! Send audit log to #loa-logs
      await logLoaStarted({
        env,
        guildId,
        userId,
        loa: data.loa || {
          id: newLoaId,
          guild_id: guildId,
          user_id: userId,
          display_name: displayName,
          start_date: parsedStart.isoDate,
          end_date: parsedEnd.isoDate,
          reason: trimmedReason,
        },
        removedRoleIds: roleSwapResult.removedRoleIds || [],
        preservedRoleIds: roleSwapResult.preservedRoleIds || [],
        staffLoaRoleId: roleSwapResult.staffLoaRoleId || roleSwapResult.assignedLoaRoleId,
        isProtectedStaff: Boolean(roleSwapResult.isProtectedStaff || roleSwapResult.isProtected),
        customFetch,
      }).catch((err) => {
        console.warn("Failed to dispatch logLoaStarted embed:", err);
      });
    }

    const activityText = `🏖️ ${displayName} started an LOA • just now`;
    await refreshPublicLoaList({
      env,
      guildId,
      todayIso,
      recentActivity: activityText,
      customFetch,
      repost: true,
      ctx,
    });

    const innerComponents = [
      createTextDisplay("# 🏖️ Leave of Absence Submitted"),
      createTextDisplay(
        `Your LOA has been successfully recorded and the Staff LOA Center has been updated.\n\n**Dates**\n${formatPrettyDateRange(parsedStart.isoDate, parsedEnd.isoDate)}\n\n**Reason**\n> ${trimmedReason}`
      ),
      createSeparator(true, 1),
    ];

    if (roleSwapResult?.success) {
      if (roleSwapResult.isProtectedStaff || roleSwapResult.isProtected) {
        innerComponents.push(
          createTextDisplay(
            "🛡️ **Leadership Status**: All your server roles have been preserved during your Leave of Absence."
          )
        );
      } else {
        innerComponents.push(
          createTextDisplay(
            `✅ **Roles Updated**: ${roleSwapResult.removedRoleIds?.length || 0} staff roles temporarily removed, standard player roles preserved, and <@&${roleSwapResult.staffLoaRoleId || roleSwapResult.assignedLoaRoleId}> role assigned for channel access.`
          )
        );
      }
      innerComponents.push(createSeparator(true, 1));
    }

    if (nicknameWarning) {
      innerComponents.push(
        createTextDisplay(
          "-# ⚠️ Your LOA was created, but Damo Bot could not update your nickname."
        )
      );
      innerComponents.push(createSeparator(true, 1));
    }

    innerComponents.push(
      buildDamoFooter({
        productName: "Staff LOA Manager",
      })
    );

    return ephemeralComponentsResponse([createContainer(innerComponents)]);
  } catch (err) {
    console.error("Error creating LOA:", err);
    return ephemeralTextResponse(`❌ Error submitting LOA: ${err.message || "Internal error"}`);
  }
}

/**
 * Shared logic to execute editing an LOA.
 * Updates DO record, reconciles nickname state, triggers dashboard refresh, and returns ephemeral result.
 */
export async function executeLoaEdit({
  env,
  guildId,
  userId,
  displayName,
  memberNick = null,
  startDateVal,
  endDateVal,
  reasonVal,
  todayIso,
  stub,
  customFetch = fetch,
  ctx = null,
}) {
  if (loaConfig.settings?.allowEdit === false) {
    return ephemeralTextResponse(
      "❌ Editing existing LOAs is currently disabled by configuration."
    );
  }

  if (!startDateVal && !endDateVal && !reasonVal) {
    return ephemeralTextResponse(
      "❌ You must provide at least one field to edit (start_date, end_date, or reason)."
    );
  }

  try {
    const curRes = await stub.fetch(
      `https://do/loa/current?userId=${encodeURIComponent(userId)}&today=${encodeURIComponent(todayIso)}`
    );
    const curData = await curRes.json();
    const existing = curData?.loa;

    if (!existing) {
      return ephemeralTextResponse("❌ You do not currently have an active or upcoming LOA to edit.");
    }

    let newStartDateIso = existing.start_date;
    let newEndDateIso = existing.end_date;
    let newReason = existing.reason;

    if (startDateVal) {
      const parsed = parseAndValidateDate(startDateVal, todayIso);
      if (!parsed.valid) {
        return ephemeralTextResponse(
          `❌ Invalid Start Date\n\n${parsed.error || "Please enter a valid date, for example:\n`9/5/2026`, `09/05/2026`, or `9/5`"}`
        );
      }
      newStartDateIso = parsed.isoDate;
    }

    if (endDateVal) {
      const parsed = parseAndValidateDate(endDateVal, todayIso);
      if (!parsed.valid) {
        return ephemeralTextResponse(
          `❌ Invalid End Date\n\n${parsed.error || "Please enter a valid date, for example:\n`9/12/2026`, `09/12/2026`, or `9/12`"}`
        );
      }
      newEndDateIso = parsed.isoDate;
    }

    if (reasonVal !== undefined && reasonVal !== null) {
      const trimmed = reasonVal.trim();
      if (!trimmed) {
        return ephemeralTextResponse("❌ Reason cannot be empty.");
      }
      newReason = trimmed;
    }

    if (newEndDateIso < newStartDateIso) {
      return ephemeralTextResponse("❌ End date cannot be before start date.");
    }

    // Duration validation from loaConfig.settings
    const editStartObj = new Date(`${newStartDateIso}T00:00:00Z`);
    const editEndObj = new Date(`${newEndDateIso}T00:00:00Z`);
    const editDurationDays =
      Math.round((editEndObj - editStartObj) / (1000 * 60 * 60 * 24)) + 1;

    if (
      loaConfig.settings?.minimumDays &&
      editDurationDays < loaConfig.settings.minimumDays
    ) {
      return ephemeralTextResponse(
        `❌ LOA duration must be at least ${loaConfig.settings.minimumDays} day${loaConfig.settings.minimumDays === 1 ? "" : "s"}.`
      );
    }
    if (
      loaConfig.settings?.maximumDays &&
      editDurationDays > loaConfig.settings.maximumDays
    ) {
      return ephemeralTextResponse(
        `❌ LOA duration cannot exceed ${loaConfig.settings.maximumDays} days.`
      );
    }

    const trimmedReason = newReason.trim();
    // Reconcile nickname state if dates changed
    const wasActive = existing.start_date <= todayIso && existing.end_date >= todayIso;
    const nowActive = newStartDateIso <= todayIso && newEndDateIso >= todayIso;

    if (!wasActive && nowActive && !existing.nickname_modified) {
      // Changed from upcoming to active today -> apply nickname
      const baseName = memberNick || displayName;
      const loaNickname = formatLoaNickname(baseName);
      const modRes = await modifyGuildMemberNickname({
        env,
        guildId,
        userId,
        newNickname: loaNickname,
        reason: "Staff LOA start date moved to today",
        customFetch,
      });
      if (modRes.success) {
        await stub.fetch("https://do/loa/nickname-state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            loaId: existing.id,
            originalNickname: memberNick,
            loaNickname,
            nicknameModified: 1,
          }),
        });
      }
    } else if (wasActive && !nowActive && existing.nickname_modified) {
      // Changed from active to future -> restore nickname
      await restoreMemberNicknameAfterLoa({
        env,
        guildId,
        userId,
        loa: existing,
        customFetch,
      });
    }

    const editRes = await stub.fetch("https://do/loa/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loaId: existing.id,
        userId,
        displayName,
        startDate: newStartDateIso,
        endDate: newEndDateIso,
        reason: newReason,
        todayIso,
      }),
    });

    const editData = await editRes.json();
    if (!editRes.ok || !editData.success) {
      return ephemeralTextResponse(`❌ Failed to update LOA: ${editData.error || "Unknown error"}`);
    }

    const activityText = `✏️ ${displayName} updated their LOA • just now`;
    await refreshPublicLoaList({
      env,
      guildId,
      todayIso,
      recentActivity: activityText,
      customFetch,
      repost: false,
      ctx,
    });

    const confirmationContainer = createContainer([
      createTextDisplay("# ✏️ Leave of Absence Updated"),
      createTextDisplay(
        `Your LOA has been updated and the Staff LOA Center has been refreshed.\n\n**Dates**\n${formatPrettyDateRange(newStartDateIso, newEndDateIso)}\n\n**Reason**\n> ${newReason}`
      ),
      createSeparator(true, 1),
      buildDamoFooter({
        productName: "Staff LOA Manager",
      }),
    ]);

    return ephemeralComponentsResponse([confirmationContainer]);
  } catch (err) {
    console.error("Error editing LOA:", err);
    return ephemeralTextResponse(`❌ Error updating LOA: ${err.message || "Internal error"}`);
  }
}

/**
 * Shared logic to execute cancelling an upcoming LOA or ending an active LOA early.
 * Updates DO record, triggers dashboard refresh, and returns ephemeral result.
 * Automatically restores member nickname and dispatches return alerts.
 */
export async function executeLoaCancelOrReturn({
  env,
  guildId,
  userId,
  displayName,
  todayIso,
  stub,
  customFetch = fetch,
  ctx = null,
}) {
  try {
    const curRes = await stub.fetch(
      `https://do/loa/current?userId=${encodeURIComponent(userId)}&today=${encodeURIComponent(todayIso)}`
    );
    const curData = await curRes.json();
    const existing = curData?.loa;

    if (!existing) {
      return ephemeralTextResponse("❌ You do not currently have an active or upcoming LOA to cancel or end.");
    }

    // 1. UPCOMING LOA CANCELLED
    if (todayIso < existing.start_date) {
      const cancelRes = await stub.fetch("https://do/loa/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loaId: existing.id,
          userId,
        }),
      });
      const cancelData = await cancelRes.json();
      if (!cancelRes.ok || !cancelData.success) {
        return ephemeralTextResponse(`❌ Failed to cancel LOA: ${cancelData.error || "Unknown error"}`);
      }

      const activityText = `❌ ${displayName} cancelled their upcoming LOA • just now`;
      await refreshPublicLoaList({
        env,
        guildId,
        todayIso,
        recentActivity: activityText,
        customFetch,
        repost: true,
        ctx,
      });

      const confirmationContainer = createContainer([
        createTextDisplay("# ❌ Leave of Absence Cancelled"),
        createTextDisplay(
          `Your upcoming LOA scheduled for **${formatPrettyDateRange(existing.start_date, existing.end_date)}** has been cancelled.`
        ),
        createSeparator(true, 1),
        buildDamoFooter({
          productName: "Staff LOA Manager",
        }),
      ]);

      return ephemeralComponentsResponse([confirmationContainer]);
    }

    // 2. ACTIVE LOA ENDED EARLY
    if (todayIso >= existing.start_date && todayIso <= existing.end_date) {
      // Restore nickname if modified
      await restoreMemberNicknameAfterLoa({
        env,
        guildId,
        userId,
        loa: existing,
        customFetch,
      });

      // Restore staff roles from snapshot
      const restoreRes = await executeLoaRoleRestore({
        env,
        guildId,
        userId,
        loaRecord: existing,
        stub,
        customFetch,
      });

      await logLoaEnded({
        env,
        guildId,
        userId,
        displayName,
        reasonText: "returned early from Leave of Absence",
        restoredRoleIds: restoreRes.restoredRoleIds || [],
        failedRestoreRoleIds: restoreRes.failedRestoreRoleIds || [],
        isLegacy: restoreRes.isLegacy,
        isProtectedStaff: Boolean(restoreRes.isProtectedStaff || restoreRes.isProtected || existing.is_protected_staff || existing.isProtectedStaff),
        customFetch,
      }).catch((err) => {
        console.warn("Failed to dispatch logLoaEnded embed:", err);
      });

      if (restoreRes.failedRestoreRoleIds?.length > 0) {
        await logLoaWarning({
          env,
          guildId,
          userId,
          message: `Some roles could not be restored automatically for ${displayName} (<@${userId}>): ${restoreRes.failedRestoreRoleIds.join(", ")}`,
          customFetch,
        }).catch(() => {});
      }

      const endRes = await stub.fetch("https://do/loa/end-early", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loaId: existing.id,
          userId,
        }),
      });
      const endData = await endRes.json();
      if (!endRes.ok || !endData.success) {
        return ephemeralTextResponse(`❌ Failed to end LOA early: ${endData.error || "Unknown error"}`);
      }

      const activityText = `✅ ${displayName} returned from LOA early • just now`;
      await refreshPublicLoaList({
        env,
        guildId,
        todayIso,
        recentActivity: activityText,
        customFetch,
        repost: true,
        ctx,
      });

      const returnMsg = (restoreRes.isProtectedStaff || restoreRes.isProtected || existing.is_protected_staff || existing.isProtectedStaff)
        ? "Your Leave of Absence has ended early and your nickname has been restored. Welcome back!"
        : "Your Leave of Absence has ended early and your staff roles have been restored. Welcome back!";

      const confirmationContainer = createContainer([
        createTextDisplay("# ✅ Welcome Back"),
        createTextDisplay(returnMsg),
        createSeparator(true, 1),
        buildDamoFooter({
          productName: "Staff LOA Manager",
          personalityLine: "Welcome back, I guess.",
        }),
      ]);

      return ephemeralComponentsResponse([confirmationContainer]);
    }

    return ephemeralTextResponse("❌ You do not currently have an active or upcoming LOA to cancel or end.");
  } catch (err) {
    console.error("Error cancelling LOA:", err);
    return ephemeralTextResponse(`❌ Error cancelling LOA: ${err.message || "Internal error"}`);
  }
}

/**
 * Handle all /loa application commands.
 * The only registered command is /loa list.
 * Refreshes the permanent dashboard and responds ephemerally.
 *
 * @param {Object} interaction
 * @param {Object} env
 * @param {Object} [ctx]
 * @returns {Promise<Response>}
 */
export async function handleLoaCommand(interaction, env, ctx) {
  const access = await validateLoaAccess(interaction, env);
  if (!access.valid) {
    return access.errorResponse;
  }

  const { guildId, userId, displayName, memberNick, stub, todayIso } = access;
  const subCommand = interaction.data?.options?.[0];
  const subCommandName = subCommand?.name;
  const options = subCommand?.options || [];

  // SUBCOMMAND: /loa info member:@User
  if (subCommandName === "info") {
    return await handleLoaInfoCommand(
      {
        ...interaction,
        data: {
          ...interaction.data,
          options,
        },
      },
      env,
      ctx
    );
  }

  // SUBCOMMAND: /loa list (Single public entry point)
  if (subCommandName === "list" || !subCommandName) {
    try {
      await refreshPublicLoaList({ env, guildId, todayIso, repost: false, ctx });
      return ephemeralTextResponse("✅ Staff LOA Center refreshed.");
    } catch (err) {
      console.error("Error refreshing Staff LOA Center:", err);
      return ephemeralTextResponse(`❌ Error refreshing Staff LOA Center: ${err.message || "Internal error"}`);
    }
  }

  // Fallback internal routing for backwards-compatibility
  if (subCommandName === "start") {
    const startDateOpt = options.find((opt) => opt.name === "start_date");
    const endDateOpt = options.find((opt) => opt.name === "end_date");
    const reasonOpt = options.find((opt) => opt.name === "reason");

    return await executeLoaStart({
      env,
      guildId,
      userId,
      displayName,
      memberNick,
      startDateVal: startDateOpt?.value,
      endDateVal: endDateOpt?.value,
      reasonVal: reasonOpt?.value,
      todayIso,
      stub,
      ctx,
    });
  }

  if (subCommandName === "edit") {
    const startDateOpt = options.find((opt) => opt.name === "start_date");
    const endDateOpt = options.find((opt) => opt.name === "end_date");
    const reasonOpt = options.find((opt) => opt.name === "reason");

    return await executeLoaEdit({
      env,
      guildId,
      userId,
      displayName,
      memberNick,
      startDateVal: startDateOpt?.value,
      endDateVal: endDateOpt?.value,
      reasonVal: reasonOpt?.value,
      todayIso,
      stub,
      ctx,
    });
  }

  if (subCommandName === "cancel") {
    return await executeLoaCancelOrReturn({
      env,
      guildId,
      userId,
      displayName,
      todayIso,
      stub,
      ctx,
    });
  }

  if (subCommandName === "status") {
    return await renderMyLoaPanel({ stub, userId, todayIso });
  }

  return ephemeralTextResponse("❌ Unknown LOA subcommand. Please use `/loa list`.");
}

/**
 * Render the ephemeral "My LOA" panel with contextual action buttons.
 *
 * @param {Object} params
 * @param {Object} params.stub
 * @param {string} params.userId
 * @param {string} params.todayIso
 * @returns {Promise<Response>}
 */
export async function renderMyLoaPanel({ stub, userId, todayIso }) {
  try {
    const curRes = await stub.fetch(
      `https://do/loa/current?userId=${encodeURIComponent(userId)}&today=${encodeURIComponent(todayIso)}`
    );
    const curData = await curRes.json();
    const existing = curData?.loa;

    if (!existing) {
      const container = createContainer([
        createTextDisplay("# 🏖️ Your LOA"),
        createSeparator(true, 1),
        createTextDisplay("You do not currently have an active or upcoming LOA."),
        createSeparator(true, 1),
        createActionRow([
          createButton({
            customId: LoaCustomId.BTN_START,
            label: "Start LOA",
            style: ButtonStyle.PRIMARY,
            emoji: "🏖️",
          }),
        ]),
        createSeparator(true, 1),
        buildDamoFooter({
          productName: "Staff LOA Manager",
          personalityLine: "Miraculously, you are expected to be here.",
        }),
      ]);
      return ephemeralComponentsResponse([container]);
    }

    const status = getLoaStatus(existing, todayIso);
    const isUpcoming = todayIso < existing.start_date;

    const actionButtons = [
      createButton({
        customId: LoaCustomId.BTN_EDIT,
        label: "Edit LOA",
        style: ButtonStyle.SECONDARY,
        emoji: "✏️",
      }),
    ];

    if (isUpcoming) {
      actionButtons.push(
        createButton({
          customId: LoaCustomId.BTN_CANCEL,
          label: "Cancel LOA",
          style: ButtonStyle.DANGER,
          emoji: "❌",
        })
      );
    } else {
      actionButtons.push(
        createButton({
          customId: LoaCustomId.BTN_CANCEL,
          label: "Return Early",
          style: ButtonStyle.SUCCESS,
          emoji: "✅",
        })
      );
    }

    const container = createContainer([
      createTextDisplay("# 🏖️ Your LOA"),
      createSeparator(true, 1),
      createTextDisplay(
        `### ${status.label}\n\n**Dates**\n${formatPrettyDateRange(existing.start_date, existing.end_date)}\n\n**Reason**\n> ${existing.reason}\n\n**${isUpcoming ? "Starts" : "Returns"}**\n${formatPrettyDate(isUpcoming ? existing.start_date : existing.end_date)}`
      ),
      createSeparator(true, 1),
      createActionRow(actionButtons),
      createSeparator(true, 1),
      buildDamoFooter({
        productName: "Staff LOA Manager",
      }),
    ]);

    return ephemeralComponentsResponse([container]);
  } catch (err) {
    console.error("Error fetching My LOA status:", err);
    return ephemeralTextResponse(`❌ Error checking LOA status: ${err.message || "Internal error"}`);
  }
}

/**
 * Render the ephemeral "Return Alerts" panel allowing staff to subscribe or unsubscribe.
 *
 * @param {Object} params
 * @param {Object} params.stub
 * @param {string} params.userId
 * @param {string} params.guildId
 * @param {string} params.todayIso
 * @returns {Promise<Response>}
 */
export async function renderReturnAlertsPanel({ stub, userId, guildId, todayIso }) {
  try {
    const [listRes, userSubsRes] = await Promise.all([
      stub.fetch(`https://do/loa/list?today=${encodeURIComponent(todayIso)}`),
      stub.fetch(`https://do/loa/alerts/user?userId=${encodeURIComponent(userId)}`),
    ]);

    const listData = await listRes.json();
    const userSubsData = await userSubsRes.json();

    const loas = listData?.loas || [];
    const userSubs = new Set(userSubsData?.subscriptions || []);

    if (loas.length === 0) {
      const container = createContainer([
        createTextDisplay("# 🔔 Return Alerts"),
        createSeparator(true, 1),
        createTextDisplay("🟢 No staff members are currently on LOA to subscribe to alerts for."),
        createSeparator(true, 1),
        buildDamoFooter({ productName: "Staff LOA Manager" }),
      ]);
      return ephemeralComponentsResponse([container]);
    }

    const innerComponents = [
      createTextDisplay("# 🔔 Return Alerts"),
      createTextDisplay(
        "Subscribe to get notified in the LOA channel when a staff member returns from LOA or ends early."
      ),
      createSeparator(true, 1),
    ];

    for (const staff of loas) {
      const cleanName = stripLoaPrefix(staff.display_name);
      const isSubbed = userSubs.has(staff.id);
      innerComponents.push(
        createTextDisplay(
          `🟢 **${cleanName}**\n-# Returns ${formatPrettyDate(staff.end_date)}`
        )
      );
      innerComponents.push(
        createActionRow([
          createButton({
            customId: `${LoaCustomId.ALERT_TOGGLE_PREFIX}${staff.id}`,
            label: isSubbed ? `Stop Alerts for ${cleanName}` : `Get Alerts for ${cleanName}`,
            style: isSubbed ? ButtonStyle.DANGER : ButtonStyle.PRIMARY,
            emoji: isSubbed ? "🔕" : "🔔",
          }),
        ])
      );
      innerComponents.push(createSeparator(true, 1));
    }

    innerComponents.push(buildDamoFooter({ productName: "Staff LOA Manager" }));
    return ephemeralComponentsResponse([createContainer(innerComponents)]);
  } catch (err) {
    console.error("Error opening Return Alerts panel:", err);
    return ephemeralTextResponse(`❌ Error opening Return Alerts: ${err.message || "Internal error"}`);
  }
}

/**
 * Handle LOA button click interactions from the Staff LOA Center and private panels.
 *
 * @param {Object} interaction
 * @param {Object} env
 * @param {Object} [ctx]
 * @returns {Promise<Response>}
 */
export async function handleLoaComponent(interaction, env, ctx) {
  const access = await validateLoaAccess(interaction, env);
  if (!access.valid) {
    return access.errorResponse;
  }

  const { guildId, userId, displayName, stub, todayIso } = access;
  const customId = interaction.data?.custom_id || "";

  // 1. BUTTON: Start LOA -> opens private modal
  if (customId === LoaCustomId.BTN_START) {
    try {
      const curRes = await stub.fetch(
        `https://do/loa/current?userId=${encodeURIComponent(userId)}&today=${encodeURIComponent(todayIso)}`
      );
      const curData = await curRes.json();
      if (curData?.loa) {
        return ephemeralTextResponse(
          "❌ You already have an active or upcoming LOA. You can only have one active or upcoming LOA at a time.\n\nUse My LOA to manage it."
        );
      }

      const todayDisplay = isoToDisplayDate(todayIso);
      return modalResponse({
        title: "Start Leave of Absence",
        customId: LoaCustomId.MODAL_START,
        components: [
          createTextInputRow({
            customId: "start_date",
            label: `Start Date (e.g. ${todayDisplay} or today)`,
            placeholder: todayDisplay,
            required: true,
          }),
          createTextInputRow({
            customId: "end_date",
            label: "End Date (e.g. 9/12/2026 or 9/12)",
            placeholder: "9/12/2026",
            required: true,
          }),
          createTextInputRow({
            customId: "reason",
            label: "Reason for LOA",
            style: 2, // Paragraph
            placeholder: "Vacation / Personal / Work",
            required: true,
            maxLength: 500,
          }),
        ],
      });
    } catch (err) {
      console.error("Error opening LOA start modal:", err);
      return ephemeralTextResponse(`❌ Error initiating LOA: ${err.message || "Internal error"}`);
    }
  }

  // 2. BUTTON: My LOA -> opens private ephemeral status panel with action controls
  if (customId === LoaCustomId.BTN_STATUS) {
    return await renderMyLoaPanel({ stub, userId, todayIso });
  }

  // 3. BUTTON: Edit LOA -> looks up user's LOA and opens private edit modal
  if (customId === LoaCustomId.BTN_EDIT) {
    try {
      const curRes = await stub.fetch(
        `https://do/loa/current?userId=${encodeURIComponent(userId)}&today=${encodeURIComponent(todayIso)}`
      );
      const curData = await curRes.json();
      const existing = curData?.loa;

      if (!existing) {
        return ephemeralTextResponse("❌ You do not currently have an active or upcoming LOA to edit.");
      }

      return modalResponse({
        title: "Edit Leave of Absence",
        customId: `${LoaCustomId.MODAL_EDIT_PREFIX}:${existing.id}`,
        components: [
          createTextInputRow({
            customId: "start_date",
            label: "Start Date (e.g. 9/5/2026 or 9/5)",
            value: isoToDisplayDate(existing.start_date),
            placeholder: "9/5/2026",
            required: true,
          }),
          createTextInputRow({
            customId: "end_date",
            label: "End Date (e.g. 9/12/2026 or 9/12)",
            value: isoToDisplayDate(existing.end_date),
            placeholder: "9/12/2026",
            required: true,
          }),
          createTextInputRow({
            customId: "reason",
            label: "Reason for LOA",
            style: 2, // Paragraph
            value: existing.reason,
            placeholder: "Vacation / Personal / Work",
            required: true,
            maxLength: 500,
          }),
        ],
      });
    } catch (err) {
      console.error("Error opening LOA edit modal:", err);
      return ephemeralTextResponse(`❌ Error preparing edit: ${err.message || "Internal error"}`);
    }
  }

  // 4. BUTTON: Cancel / Return Early -> shows private confirmation dialog
  if (customId === LoaCustomId.BTN_CANCEL) {
    try {
      const curRes = await stub.fetch(
        `https://do/loa/current?userId=${encodeURIComponent(userId)}&today=${encodeURIComponent(todayIso)}`
      );
      const curData = await curRes.json();
      const existing = curData?.loa;

      if (!existing) {
        return ephemeralTextResponse("❌ You do not currently have an active or upcoming LOA to cancel or end.");
      }

      // Case A: UPCOMING LOA -> Confirmation dialog to cancel
      if (todayIso < existing.start_date) {
        const confirmContainer = createContainer([
          createTextDisplay("# ⚠️ Cancel Your LOA?"),
          createTextDisplay(
            `**Scheduled**\n${formatPrettyDateRange(existing.start_date, existing.end_date)}\n\n**Reason**\n> ${existing.reason}`
          ),
          createSeparator(true, 1),
          createActionRow([
            createButton({
              customId: LoaCustomId.CANCEL_DISMISS,
              label: "Never Mind",
              style: ButtonStyle.SECONDARY,
            }),
            createButton({
              customId: `${LoaCustomId.CONFIRM_CANCEL_PREFIX}${existing.id}`,
              label: "Cancel LOA",
              style: ButtonStyle.DANGER,
              emoji: "❌",
            }),
          ]),
        ]);

        return ephemeralComponentsResponse([confirmContainer]);
      }

      // Case B: ACTIVE LOA -> Confirmation dialog to return early
      if (todayIso >= existing.start_date && todayIso <= existing.end_date) {
        const confirmContainer = createContainer([
          createTextDisplay("# ⚠️ Return Early?"),
          createTextDisplay(
            `**Current LOA**\n${formatPrettyDateRange(existing.start_date, existing.end_date)}\n\n**Reason**\n> ${existing.reason}\n\nYour original return date is ${formatPrettyDate(existing.end_date)}.`
          ),
          createSeparator(true, 1),
          createActionRow([
            createButton({
              customId: LoaCustomId.CANCEL_DISMISS,
              label: "Never Mind",
              style: ButtonStyle.SECONDARY,
            }),
            createButton({
              customId: `${LoaCustomId.CONFIRM_RETURN_PREFIX}${existing.id}`,
              label: "I'm Back",
              style: ButtonStyle.SUCCESS,
              emoji: "✅",
            }),
          ]),
        ]);

        return ephemeralComponentsResponse([confirmContainer]);
      }

      return ephemeralTextResponse("❌ You do not currently have an active or upcoming LOA to cancel or end.");
    } catch (err) {
      console.error("Error initiating cancel/return:", err);
      return ephemeralTextResponse(`❌ Error checking LOA: ${err.message || "Internal error"}`);
    }
  }

  // 5. BUTTON: Refresh -> rebuilds/patches permanent dashboard
  if (customId === LoaCustomId.BTN_REFRESH) {
    try {
      await refreshPublicLoaList({ env, guildId, todayIso, repost: false, ctx });
      return ephemeralTextResponse("✅ Staff LOA Center refreshed.");
    } catch (err) {
      console.error("Error refreshing Staff LOA Center:", err);
      return ephemeralTextResponse(`❌ Error refreshing Staff LOA Center: ${err.message || "Internal error"}`);
    }
  }

  // 6. BUTTON: Return Alerts -> opens private subscription panel
  if (customId === LoaCustomId.BTN_ALERTS) {
    return await renderReturnAlertsPanel({ stub, userId, guildId, todayIso });
  }

  // 7. BUTTON: Toggle Return Alert
  if (customId.startsWith(LoaCustomId.ALERT_TOGGLE_PREFIX)) {
    const loaId = customId.slice(LoaCustomId.ALERT_TOGGLE_PREFIX.length);
    try {
      const toggleRes = await stub.fetch("https://do/loa/alerts/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loaId, userId, guildId }),
      });
      const toggleData = await toggleRes.json();
      return await renderReturnAlertsPanel({ stub, userId, guildId, todayIso });
    } catch (err) {
      console.error("Error toggling return alert:", err);
      return ephemeralTextResponse(`❌ Error updating alert preference: ${err.message || "Internal error"}`);
    }
  }

  // 8. BUTTON: Never Mind (Dismiss confirmation dialog)
  if (customId === LoaCustomId.CANCEL_DISMISS) {
    const container = createContainer([
      createTextDisplay("Action cancelled. No changes were made."),
    ]);
    return updateComponentsResponse([container]);
  }

  // 9. BUTTON: Confirm Cancel (Upcoming LOA)
  if (customId.startsWith(LoaCustomId.CONFIRM_CANCEL_PREFIX)) {
    const loaId = customId.slice(LoaCustomId.CONFIRM_CANCEL_PREFIX.length);
    try {
      const cancelRes = await stub.fetch("https://do/loa/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loaId, userId }),
      });
      const cancelData = await cancelRes.json();
      if (!cancelRes.ok || !cancelData.success) {
        return ephemeralTextResponse(`❌ Failed to cancel LOA: ${cancelData.error || "Unknown error"}`);
      }

      const activityText = `❌ ${displayName} cancelled their upcoming LOA • just now`;
      await refreshPublicLoaList({
        env,
        guildId,
        todayIso,
        recentActivity: activityText,
        repost: true,
        ctx,
      });

      const container = createContainer([
        createTextDisplay("# ❌ Leave of Absence Cancelled"),
        createTextDisplay("Your upcoming Leave of Absence has been cancelled."),
        createSeparator(true, 1),
        buildDamoFooter({
          productName: "Staff LOA Manager",
        }),
      ]);

      return updateComponentsResponse([container]);
    } catch (err) {
      console.error("Error confirming cancel:", err);
      return ephemeralTextResponse(`❌ Error cancelling LOA: ${err.message || "Internal error"}`);
    }
  }

  // 10. BUTTON: Confirm Return Early (Active LOA)
  if (customId.startsWith(LoaCustomId.CONFIRM_RETURN_PREFIX)) {
    if (loaConfig.settings?.allowEarlyEnd === false) {
      return ephemeralTextResponse(
        "❌ Ending LOAs early is currently disabled by configuration."
      );
    }
    const loaId = customId.slice(LoaCustomId.CONFIRM_RETURN_PREFIX.length);
    try {
      // Look up existing LOA record to restore nickname
      const curRes = await stub.fetch(
        `https://do/loa/current?userId=${encodeURIComponent(userId)}&today=${encodeURIComponent(todayIso)}`
      );
      const curData = await curRes.json();
      const existing = curData?.loa;

      if (existing) {
        await restoreMemberNicknameAfterLoa({
          env,
          guildId,
          userId,
          loa: existing,
        });

        // Restore staff roles from snapshot
        const restoreRes = await executeLoaRoleRestore({
          env,
          guildId,
          userId,
          loaRecord: existing,
          stub,
        });

        await logLoaEnded({
          env,
          guildId,
          userId,
          displayName,
          reasonText: "returned early from Leave of Absence",
          restoredRoleIds: restoreRes.restoredRoleIds || [],
          failedRestoreRoleIds: restoreRes.failedRestoreRoleIds || [],
          isLegacy: restoreRes.isLegacy,
          isProtectedStaff: Boolean(restoreRes.isProtectedStaff || restoreRes.isProtected || existing.is_protected_staff || existing.isProtectedStaff),
        }).catch((err) => {
          console.warn("Failed to dispatch logLoaEnded embed:", err);
        });

        if (restoreRes.failedRestoreRoleIds?.length > 0) {
          await logLoaWarning({
            env,
            guildId,
            userId,
            message: `Some roles could not be restored automatically for ${displayName} (<@${userId}>): ${restoreRes.failedRestoreRoleIds.join(", ")}`,
          }).catch(() => {});
        }
      }

      const endRes = await stub.fetch("https://do/loa/end-early", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loaId, userId }),
      });
      const endData = await endRes.json();
      if (!endRes.ok || !endData.success) {
        return ephemeralTextResponse(`❌ Failed to end LOA early: ${endData.error || "Unknown error"}`);
      }

      const activityText = `✅ ${displayName} returned from LOA early • just now`;
      await refreshPublicLoaList({
        env,
        guildId,
        todayIso,
        recentActivity: activityText,
        repost: true,
        ctx,
      });

      const returnMsg = (existing?.is_protected_staff || existing?.isProtectedStaff)
        ? "Your Leave of Absence has ended early and your nickname has been restored. Welcome back!"
        : "Your Leave of Absence has ended early and your staff roles have been restored. Welcome back!";

      const container = createContainer([
        createTextDisplay("# ✅ Welcome Back"),
        createTextDisplay(returnMsg),
        createSeparator(true, 1),
        buildDamoFooter({
          productName: "Staff LOA Manager",
          personalityLine: "Welcome back, I guess.",
        }),
      ]);

      return updateComponentsResponse([container]);
    } catch (err) {
      console.error("Error confirming early return:", err);
      return ephemeralTextResponse(`❌ Error ending LOA: ${err.message || "Internal error"}`);
    }
  }

  return ephemeralTextResponse("❌ Unknown component interaction.");
}

/**
 * Handle Modal submit interactions for LOA start and edit.
 *
 * @param {Object} interaction
 * @param {Object} env
 * @param {Object} [ctx]
 * @returns {Promise<Response>}
 */
export async function handleLoaModalSubmit(interaction, env, ctx) {
  const access = await validateLoaAccess(interaction, env);
  if (!access.valid) {
    return access.errorResponse;
  }

  const { guildId, userId, displayName, memberNick, stub, todayIso } = access;
  const customId = interaction.data?.custom_id || "";
  const values = getModalValues(interaction.data?.components || []);

  const startDateVal = values.start_date;
  const endDateVal = values.end_date;
  const reasonVal = values.reason;

  // 1. MODAL: Start LOA
  if (customId === LoaCustomId.MODAL_START) {
    return await executeLoaStart({
      env,
      guildId,
      userId,
      displayName,
      memberNick,
      startDateVal,
      endDateVal,
      reasonVal,
      todayIso,
      stub,
      ctx,
      memberRoles: access.memberRoles || [],
    });
  }

  // 2. MODAL: Edit LOA
  if (customId.startsWith(LoaCustomId.MODAL_EDIT_PREFIX)) {
    return await executeLoaEdit({
      env,
      guildId,
      userId,
      displayName,
      memberNick,
      startDateVal,
      endDateVal,
      reasonVal,
      todayIso,
      stub,
      ctx,
    });
  }

  return ephemeralTextResponse("❌ Unknown modal submission.");
}

/**
 * Handle /loainfo slash command (Management & Owners only).
 * Displays a member's complete LOA history and role snapshots.
 *
 * @param {Object} interaction
 * @param {Object} env
 * @param {Object} [ctx]
 * @param {Function} [customFetch=fetch]
 * @returns {Promise<Response>}
 */
export async function handleLoaInfoCommand(interaction, env, ctx, customFetch = fetch) {
  const guildId =
    interaction.guild_id ||
    interaction.member?.guild_id ||
    env?.DISCORD_GUILD_ID ||
    env?.GUILD_ID;

  if (!guildId) {
    return ephemeralTextResponse("❌ LOA info can only be viewed in a server.");
  }

  // Permission check: Management / Owner only
  if (!canViewLoaHistory(interaction, env)) {
    return ephemeralTextResponse(
      "❌ Permission denied. Only Management and Owners can view LOA history and role snapshots."
    );
  }

  if (!env?.STAFF_LOA) {
    return ephemeralTextResponse(
      "❌ Staff LOA Durable Object binding is not configured."
    );
  }

  // Extract target member
  const options = interaction.data?.options || [];
  const memberOption =
    options.find((opt) => opt.name === "member") ||
    options.find((opt) => opt.type === 6) ||
    options[0];
  const targetUserId = memberOption?.value;

  if (!targetUserId) {
    return ephemeralTextResponse("❌ Please specify a staff member to view LOA history.");
  }

  const resolvedUser =
    interaction.data?.resolved?.users?.[targetUserId] ||
    interaction.data?.resolved?.members?.[targetUserId]?.user ||
    null;
  const targetName =
    resolvedUser?.global_name ||
    resolvedUser?.username ||
    `<@${targetUserId}>`;

  const doId = env.STAFF_LOA.idFromName(guildId);
  const stub = env.STAFF_LOA.get(doId);

  try {
    const histRes = await stub.fetch(
      `https://do/loa/history?userId=${encodeURIComponent(targetUserId)}`
    );
    const histData = await histRes.json();
    const history = histData?.history || [];

    if (history.length === 0) {
      const container = createContainer([
        createTextDisplay(`# 📋 Staff LOA History: ${targetName}`),
        createTextDisplay(`No LOA records found for <@${targetUserId}>.`),
        createSeparator(true, 1),
        buildDamoFooter({
          productName: "Staff LOA Manager",
        }),
      ]);
      return ephemeralComponentsResponse([container]);
    }

    // Fetch guild roles to map role IDs to names
    const rolesRes = await getGuildRoles({ env, guildId, customFetch });
    const roleMap = rolesRes.roleMap || new Map();

    const formatRoleList = (roleIds) => {
      if (!roleIds || roleIds.length === 0) return "*None*";
      return roleIds
        .map((rid) => {
          const role = roleMap.get(rid);
          return role ? `\`@${role.name}\`` : `<@&${rid}>`;
        })
        .join(", ");
    };

    const sections = [];
    sections.push(createTextDisplay(`# 📋 Staff LOA History: ${targetName}`));
    sections.push(
      createTextDisplay(
        `Displaying **${history.length}** LOA record${history.length === 1 ? "" : "s"} for <@${targetUserId}>.`
      )
    );
    sections.push(createSeparator(true, 1));

    function safeParseRoleArray(val) {
      if (Array.isArray(val)) return val;
      if (!val || typeof val !== "string") return [];
      try {
        const parsed = JSON.parse(val);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }

    // Show up to the 5 most recent records
    const recordsToShow = history.slice(0, 5);
    for (let i = 0; i < recordsToShow.length; i++) {
      const rec = recordsToShow[i];
      let statusBadge = "⏳ Upcoming";
      if (rec.cancelled) {
        statusBadge = "❌ Cancelled";
      } else if (rec.ended_early) {
        statusBadge = "↩️ Returned Early";
      } else if (rec.is_active) {
        statusBadge = "🏖️ Active";
      } else if (rec.status === "completed") {
        statusBadge = "✅ Completed";
      }

      const dateStr = formatPrettyDateRange(rec.start_date, rec.end_date);
      let roleInfoStr = "";

      if (rec.removed_role_ids) {
        const removed = safeParseRoleArray(rec.removed_role_ids);
        roleInfoStr += `\n**Snapshot (${removed.length} roles)**: ${formatRoleList(removed)}`;
        roleInfoStr += `\n**Swap Status**: \`${rec.role_swap_status || "completed"}\``;
      } else if (rec.is_legacy_snapshot) {
        roleInfoStr += `\n*Legacy record (created before role snapshots)*`;
      }

      if (rec.restored_role_ids) {
        const restored = safeParseRoleArray(rec.restored_role_ids);
        roleInfoStr += `\n**Restored Roles (${restored.length})**: ${formatRoleList(restored)}`;
      }

      if (rec.failed_restore_role_ids) {
        const failed = safeParseRoleArray(rec.failed_restore_role_ids);
        if (failed.length > 0) {
          roleInfoStr += `\n⚠️ **Failed Restorations**: ${formatRoleList(failed)}`;
        }
      }

      sections.push(
        createTextDisplay(
          `### ${statusBadge} • ${dateStr}\n**Reason**: ${rec.reason || "*No reason provided*"}${roleInfoStr}`
        )
      );

      if (i < recordsToShow.length - 1) {
        sections.push(createSeparator(true, 1));
      }
    }

    sections.push(createSeparator(true, 1));
    sections.push(
      buildDamoFooter({
        productName: "Staff LOA Manager",
      })
    );

    return ephemeralComponentsResponse([createContainer(sections)]);
  } catch (err) {
    console.error("Error fetching LOA history:", err);
    return ephemeralTextResponse(
      `❌ Error fetching LOA history: ${err.message || "Internal error"}`
    );
  }
}

