import {
  InteractionResponseType,
  InteractionResponseFlags,
} from "discord-interactions";
import {
  DEFAULT_REFUND_LOG_CHANNEL_ID,
  DEFAULT_STAFF_TEAM_ROLE_ID,
  DEFAULT_OWNER_ROLE_ID,
  RefundCustomId,
  SyncStatus,
  AuditAction,
  ComponentType,
  ButtonStyle,
  IS_COMPONENTS_V2_FLAG,
  EPHEMERAL_FLAG,
  buildRefundPlayerHistoryCustomId,
  buildRefundHistoryPageCustomId,
  parseRefundComponentCustomId,
  refundConfig,
  getRefundCategoryConfig,
} from "./constants.js";
import {
  canManageRefunds,
  extractUserId,
  hasAnyRole,
  isSuperadmin,
} from "../../config/helpers.js";
import {
  formatRefundLog,
  createRefundActionRow,
  isValidUrl,
  normalizeUrl,
} from "./formatter.js";
import {
  buildRefundCenterContainer,
  buildRefundUserSelectPrompt,
  buildRefundModal,
  buildManualRefundModal,
  buildSearchRefundModal,
  buildEditRefundModal,
  buildRefundSearchResultsContainer,
  buildPlayerRefundHistoryContainer,
  buildRefundRecordNotFoundContainer,
  buildRefundHistoryUnavailableContainer,
  buildNoRefundHistoryContainer,
} from "./components.js";
import {
  appendRefundRecord,
  updateRefundSyncStatus,
  searchRefunds,
  getPlayerRefundHistory,
  getRefundsByPlayerDiscordId,
  getRecentRefunds,
  getMyRefunds,
  getRefundById,
  updateRefundRecord,
  getRefundAudits,
} from "./db.js";
import {
  ephemeralTextResponse,
  ephemeralComponentsResponse,
  updateComponentsResponse,
  deferredChannelMessageResponse,
  editOriginalInteractionResponse,
  verifyStaffRole,
  getModalValues,
} from "../../shared/index.js";

export {
  ephemeralTextResponse,
  ephemeralComponentsResponse,
  updateComponentsResponse,
  deferredChannelMessageResponse,
  editOriginalInteractionResponse,
  verifyStaffRole,
  getModalValues,
};

/**
 * Verify staff role or superadmin permission for Refund Center features.
 *
 * @param {Object} interaction
 * @param {Object} env
 * @returns {{ isStaff: boolean, errorResponse: Response|null }}
 */
function verifyRefundStaff(interaction, env) {
  if (canManageRefunds(interaction, env)) {
    return { isStaff: true, errorResponse: null };
  }
  return verifyStaffRole(interaction, env);
}

/**
 * Check if the interacting user has permission to edit a specific refund record.
 * Permission is granted to:
 * 1. The original staff member who entered the refund (matching staffDiscordId).
 * 2. Bot Superadmins.
 * 3. Management and Owner roles.
 *
 * @param {Object} interaction
 * @param {Object} env
 * @param {Object} record
 * @returns {boolean}
 */
export function canEditRefundRecord(interaction, env, record) {
  const userId = extractUserId(interaction);
  if (!userId || !record) return false;

  // 1. Author who entered the refund
  if (record.staffDiscordId && String(record.staffDiscordId).trim() === userId) {
    return true;
  }

  // 2. Superadmin bypass
  if (isSuperadmin(interaction)) {
    return true;
  }

  // 3. Manager / Owner roles
  const managerRoles = [
    ...(refundConfig.roles?.managers || []),
    DEFAULT_OWNER_ROLE_ID,
  ];
  if (env?.OWNER_ROLE_ID) managerRoles.push(env.OWNER_ROLE_ID);
  if (env?.VRP_MANAGEMENT_ROLE_ID) managerRoles.push(env.VRP_MANAGEMENT_ROLE_ID);

  return hasAnyRole(interaction, managerRoles);
}

/**
 * Asynchronously execute refund player history lookup after immediate acknowledgment.
 *
 * Supports:
 * - Direct Player Discord ID (snowflake digits): e.g. "399373087172198400"
 * - Compound key: e.g. "VRP-R-000003:399373087172198400"
 * - Refund ID: e.g. "VRP-R-000003" or "REF-000021" (resolves record then searches by Player Discord ID)
 *
 * @param {Object} options
 * @param {Object} options.interaction
 * @param {Object} options.env
 * @param {string} options.refundId
 */
export async function executeRefundPlayerHistoryLookup({
  interaction,
  env,
  refundId,
}) {
  try {
    const rawKey = String(refundId || "").trim();
    if (!rawKey) {
      await editOriginalInteractionResponse({
        interaction,
        env,
        content:
          "⚠️ **Refund History Unavailable**\n\nNo refund or player identifier was provided.",
        components: [buildRefundHistoryUnavailableContainer()],
      });
      return;
    }

    let targetPlayerDiscordId = "";
    let targetPlayerName = "";
    let targetRecord = null;

    // 1. Check if rawKey is compound: "refundId:playerDiscordId"
    if (rawKey.includes(":")) {
      const parts = rawKey.split(":");
      if (/^\d{17,20}$/.test(parts[1])) {
        targetPlayerDiscordId = parts[1];
      } else if (/^\d{17,20}$/.test(parts[0])) {
        targetPlayerDiscordId = parts[0];
      }
    }

    // 2. Check if rawKey is directly a Discord snowflake ID (17-20 digits)
    if (!targetPlayerDiscordId && /^\d{17,20}$/.test(rawKey)) {
      targetPlayerDiscordId = rawKey;
    }

    // 3. If still not resolved to a Discord ID, look up as Refund ID
    if (!targetPlayerDiscordId) {
      targetRecord = await getRefundById({ env, refundId: rawKey });
      if (!targetRecord) {
        if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
          console.warn(`[refund-history] refund record not found: ${rawKey}`);
        }
        await editOriginalInteractionResponse({
          interaction,
          env,
          content:
            "⚠️ **Refund Record Not Found**\n\nThis refund record could no longer be found.\n\nPlease reopen the Refund Center and try again.",
          components: [buildRefundRecordNotFoundContainer()],
        });
        return;
      }

      targetPlayerName = targetRecord.playerName || "";
      const rawDiscordId = String(targetRecord.playerDiscordId || "").trim();
      const hasValidDiscordId =
        rawDiscordId.length > 0 &&
        rawDiscordId !== "N/A" &&
        rawDiscordId !== "None" &&
        /^\d{17,20}$/.test(rawDiscordId);

      if (!hasValidDiscordId) {
        if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
          console.warn(`[refund-history] missing playerDiscordId for refund=${rawKey}`);
        }
        await editOriginalInteractionResponse({
          interaction,
          env,
          content:
            "⚠️ **Refund History Unavailable**\n\nThis refund record does not have a Discord user attached, so Damo-Bot cannot reliably search this player's refund history.",
          components: [buildRefundHistoryUnavailableContainer()],
        });
        return;
      }

      targetPlayerDiscordId = rawDiscordId;
    }

    // 4. Search refund records strictly for that exact Player Discord ID
    const records = await getRefundsByPlayerDiscordId({
      env,
      playerDiscordId: targetPlayerDiscordId,
    });

    if (records.length === 0) {
      await editOriginalInteractionResponse({
        interaction,
        env,
        content:
          "ℹ️ **No Refund History**\n\nNo previous refund records were found for this player.",
        components: [buildNoRefundHistoryContainer()],
      });
      return;
    }

    // 5. Build compact history UI
    const container = buildPlayerRefundHistoryContainer({
      playerDiscordId: targetPlayerDiscordId,
      playerName:
        targetPlayerName ||
        targetRecord?.playerName ||
        records[0]?.playerName ||
        "Player",
      records,
      page: 1,
      pageSize: 5,
    });

    await editOriginalInteractionResponse({
      interaction,
      env,
      components: [container],
    });
  } catch (err) {
    if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
      console.warn(`[refund-history] lookup error for ${refundId}:`, err?.message || err);
    }
    await editOriginalInteractionResponse({
      interaction,
      env,
      content: `❌ Database Error: Failed to retrieve refund history (${err.message}).`,
    }).catch(() => {});
  }
}

/**
 * Asynchronously execute refund history pagination after immediate acknowledgment.
 *
 * @param {Object} options
 * @param {Object} options.interaction
 * @param {Object} options.env
 * @param {string} options.playerDiscordId
 * @param {number} options.page
 */
export async function executeRefundPlayerHistoryPage({
  interaction,
  env,
  playerDiscordId,
  page,
}) {
  try {
    const rawDiscordId = String(playerDiscordId || "").trim();
    if (!rawDiscordId || !/^\d{17,20}$/.test(rawDiscordId)) {
      await editOriginalInteractionResponse({
        interaction,
        env,
        content:
          "⚠️ **Refund History Unavailable**\n\nThis refund record does not have a Discord user attached, so Damo-Bot cannot reliably search this player's refund history.",
        components: [buildRefundHistoryUnavailableContainer()],
      });
      return;
    }

    const records = await getRefundsByPlayerDiscordId({
      env,
      playerDiscordId: rawDiscordId,
    });

    if (records.length === 0) {
      await editOriginalInteractionResponse({
        interaction,
        env,
        content:
          "ℹ️ **No Refund History**\n\nNo previous refund records were found for this player.",
        components: [buildNoRefundHistoryContainer()],
      });
      return;
    }

    const playerName = records[0]?.playerName || "Player";
    const container = buildPlayerRefundHistoryContainer({
      playerDiscordId: rawDiscordId,
      playerName,
      records,
      page,
      pageSize: 5,
    });

    await editOriginalInteractionResponse({
      interaction,
      env,
      components: [container],
    });
  } catch (err) {
    if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
      console.warn(`[refund-history] pagination error for ${playerDiscordId}:`, err?.message || err);
    }
    await editOriginalInteractionResponse({
      interaction,
      env,
      content: `❌ Database Error: Failed to paginate refund history (${err.message}).`,
    }).catch(() => {});
  }
}




/**
 * Open the private Staff Refund Center ephemerally.
 * Invoked by /refund command or sticky Refund Center button.
 *
 * @param {Object} interaction
 * @param {Object} env
 * @returns {Promise<Response>}
 */
export async function openRefundCenter(interaction, env) {
  const auth = verifyRefundStaff(interaction, env);
  if (!auth.isStaff) return auth.errorResponse;

  return ephemeralComponentsResponse(buildRefundCenterContainer());
}

/**
 * Handle slash commands for /refund (and /refund log).
 *
 * @param {Object} interaction
 * @param {Object} env
 * @param {Object} [ctx]
 * @returns {Promise<Response>}
 */
export async function handleRefundCommand(interaction, env, ctx) {
  const auth = verifyRefundStaff(interaction, env);
  if (!auth.isStaff) return auth.errorResponse;

  const options = interaction.data?.options || [];
  const subcommand = options[0]?.name;

  if (subcommand === "log") {
    return ephemeralComponentsResponse(buildRefundUserSelectPrompt());
  }

  if (subcommand === "edit") {
    const subOptions = options[0]?.options || [];
    const refundIdOption = subOptions.find((o) => o.name === "id")?.value;
    if (!refundIdOption) {
      return ephemeralTextResponse("❌ Please provide a Refund ID to edit (e.g. `VRP-R-000001`).");
    }
    const cleanId = String(refundIdOption).trim();
    const record = await getRefundById({ env, refundId: cleanId });
    if (!record) {
      return ephemeralTextResponse(`❌ Refund record '${cleanId}' not found.`);
    }
    if (!canEditRefundRecord(interaction, env, record)) {
      const authorMention =
        record.staffDiscordId && record.staffDiscordId !== "0" && record.staffDiscordId !== "N/A"
          ? `<@${record.staffDiscordId}>`
          : (record.staffName || "the author");
      return ephemeralTextResponse(
        `❌ You cannot edit this refund entry. Only ${authorMention} (the staff member who entered it) or Management can edit this record.`
      );
    }
    return new Response(
      JSON.stringify({
        type: InteractionResponseType.MODAL,
        data: buildEditRefundModal(record),
      }),
      { headers: { "content-type": "application/json" } }
    );
  }

  return ephemeralComponentsResponse(buildRefundCenterContainer());
}

/**
 * Handle component interactions under the refund system.
 *
 * @param {Object} interaction
 * @param {Object} env
 * @param {Object} [ctx]
 * @returns {Promise<Response>}
 */
export async function handleRefundComponent(interaction, env, ctx) {
  const auth = verifyRefundStaff(interaction, env);
  if (!auth.isStaff) return auth.errorResponse;

  const customId = interaction.data?.custom_id || "";
  const parsed = parseRefundComponentCustomId(customId);

  // 1. Center main buttons
  if (parsed.action === "BTN_LOG") {
    return ephemeralComponentsResponse(buildRefundUserSelectPrompt());
  }

  if (parsed.action === "BTN_SEARCH") {
    return new Response(
      JSON.stringify({
        type: InteractionResponseType.MODAL,
        data: buildSearchRefundModal(),
      }),
      { headers: { "content-type": "application/json" } }
    );
  }

  if (parsed.action === "BTN_RECENT") {
    try {
      const records = await getRecentRefunds({ env, limit: 10, categoryFilter: "All" });
      return ephemeralComponentsResponse(
        buildRefundSearchResultsContainer({
          title: "🕘 RECENT REFUNDS",
          subtitle: "Latest logged refunds across all categories",
          records,
          page: 1,
          pageSize: 3,
          queryKey: "__recent__",
          categoryFilter: "All",
        })
      );
    } catch (err) {
      return ephemeralTextResponse(`❌ Failed to fetch recent refunds: ${err.message}`);
    }
  }

  if (parsed.action === "BTN_MY_LOGS") {
    try {
      const staffUser = interaction.member?.user || interaction.user;
      const staffDiscordId = staffUser?.id || "0";
      const records = await getMyRefunds({
        env,
        staffDiscordId,
        limit: 10,
        categoryFilter: "All",
      });
      return ephemeralComponentsResponse(
        buildRefundSearchResultsContainer({
          title: "👤 MY REFUNDS",
          subtitle: "Refunds logged by you",
          records,
          page: 1,
          pageSize: 3,
          queryKey: "__my__",
          categoryFilter: "All",
        })
      );
    } catch (err) {
      return ephemeralTextResponse(`❌ Failed to fetch your refunds: ${err.message}`);
    }
  }

  // 2. User selection prompt workflow
  if (parsed.action === "USER_SELECT") {
    const selectedUsers = interaction.data?.values || [];
    if (selectedUsers.length === 0) {
      return ephemeralTextResponse("❌ Please select a user from the dropdown.");
    }

    const userId = selectedUsers[0];
    const resolvedUser =
      interaction.data?.resolved?.users?.[userId] ||
      interaction.data?.resolved?.members?.[userId]?.user ||
      {};

    const displayName =
      interaction.data?.resolved?.members?.[userId]?.nick ||
      resolvedUser.global_name ||
      resolvedUser.username ||
      "";

    return new Response(
      JSON.stringify({
        type: InteractionResponseType.MODAL,
        data: buildRefundModal({ userId, displayName }),
      }),
      { headers: { "content-type": "application/json" } }
    );
  }

  if (parsed.action === "BTN_MANUAL") {
    return new Response(
      JSON.stringify({
        type: InteractionResponseType.MODAL,
        data: buildManualRefundModal(),
      }),
      { headers: { "content-type": "application/json" } }
    );
  }

  if (parsed.action === "BTN_DISMISS") {
    return updateComponentsResponse(buildRefundCenterContainer());
  }

  // Edit Record button (from card, log message, or confirmation)
  if (parsed.action === "BTN_EDIT" || customId.startsWith(RefundCustomId.BTN_EDIT_PREFIX)) {
    const refundId = parsed.refundId || customId.slice(RefundCustomId.BTN_EDIT_PREFIX.length);
    try {
      const record = await getRefundById({ env, refundId });
      if (!record) {
        return ephemeralTextResponse(`❌ Refund record '${refundId}' not found.`);
      }

      if (!canEditRefundRecord(interaction, env, record)) {
        const authorMention =
          record.staffDiscordId && record.staffDiscordId !== "0" && record.staffDiscordId !== "N/A"
            ? `<@${record.staffDiscordId}>`
            : (record.staffName || "the author");
        return ephemeralTextResponse(
          `❌ You cannot edit this refund entry. Only ${authorMention} (the staff member who entered it) or Management can edit this record.`
        );
      }

      const modal = buildEditRefundModal(record);
      return new Response(
        JSON.stringify({
          type: InteractionResponseType.MODAL,
          data: modal,
        }),
        { headers: { "content-type": "application/json" } }
      );
    } catch (err) {
      return ephemeralTextResponse(`❌ Error loading refund record: ${err.message}`);
    }
  }

  // 3. Player history button (synchronous lookup, direct ephemeral response)
  // Matches the punishment center pattern: inline Google Sheets lookup → immediate Type 4 response.
  // The previous deferred Type 5 + ctx.waitUntil + webhook PATCH approach was silently failing on Cloudflare Workers.
  if (parsed.action === "PLAYER_HISTORY") {
    const rawKey = (parsed.rawKey || parsed.refundId || "").trim();

    try {
      let targetPlayerDiscordId = "";
      let targetPlayerName = "";
      let targetRecord = null;

      // 1. Check if rawKey is compound: "refundId:playerDiscordId"
      if (rawKey.includes(":")) {
        const parts = rawKey.split(":");
        if (/^\d{17,20}$/.test(parts[1])) {
          targetPlayerDiscordId = parts[1];
        } else if (/^\d{17,20}$/.test(parts[0])) {
          targetPlayerDiscordId = parts[0];
        }
      }

      // 2. Check if rawKey is directly a Discord snowflake ID (17-20 digits)
      if (!targetPlayerDiscordId && /^\d{17,20}$/.test(rawKey)) {
        targetPlayerDiscordId = rawKey;
      }

      // 3. If still not resolved, look up as Refund ID
      if (!targetPlayerDiscordId) {
        targetRecord = await getRefundById({ env, refundId: rawKey });
        if (!targetRecord) {
          if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
            console.warn(`[refund-history] refund record not found: ${rawKey}`);
          }
          return ephemeralComponentsResponse(buildRefundRecordNotFoundContainer());
        }

        targetPlayerName = targetRecord.playerName || "";
        const rawDiscordId = String(targetRecord.playerDiscordId || "").trim();
        const hasValidDiscordId =
          rawDiscordId.length > 0 &&
          rawDiscordId !== "N/A" &&
          rawDiscordId !== "None" &&
          /^\d{17,20}$/.test(rawDiscordId);

        if (!hasValidDiscordId) {
          if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
            console.warn(`[refund-history] missing playerDiscordId for refund=${rawKey}`);
          }
          return ephemeralComponentsResponse(buildRefundHistoryUnavailableContainer());
        }

        targetPlayerDiscordId = rawDiscordId;
      }

      // 4. Search refund records strictly for that exact Player Discord ID
      const records = await getRefundsByPlayerDiscordId({
        env,
        playerDiscordId: targetPlayerDiscordId,
      });

      if (records.length === 0) {
        return ephemeralComponentsResponse(buildNoRefundHistoryContainer());
      }

      // 5. Build compact history UI
      const container = buildPlayerRefundHistoryContainer({
        playerDiscordId: targetPlayerDiscordId,
        playerName:
          targetPlayerName ||
          targetRecord?.playerName ||
          records[0]?.playerName ||
          "Player",
        records,
        page: 1,
        pageSize: 5,
      });

      return ephemeralComponentsResponse(container);
    } catch (err) {
      if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
        console.warn(`[refund-history] lookup error for ${rawKey}:`, err?.message || err);
      }
      return ephemeralTextResponse(
        `❌ Error retrieving player refund history: ${err.message}`
      );
    }
  }

  // 4. Player history pagination button (synchronous lookup, direct update response)
  if (parsed.action === "PLAYER_HISTORY_PAGE") {
    try {
      const rawDiscordId = String(parsed.playerDiscordId || "").trim();
      if (!rawDiscordId || !/^\d{17,20}$/.test(rawDiscordId)) {
        return ephemeralComponentsResponse(buildRefundHistoryUnavailableContainer());
      }

      const records = await getRefundsByPlayerDiscordId({
        env,
        playerDiscordId: rawDiscordId,
      });

      if (records.length === 0) {
        return ephemeralComponentsResponse(buildNoRefundHistoryContainer());
      }

      const playerName = records[0]?.playerName || "Player";
      const container = buildPlayerRefundHistoryContainer({
        playerDiscordId: rawDiscordId,
        playerName,
        records,
        page: parsed.page,
        pageSize: 5,
      });

      return updateComponentsResponse(container);
    } catch (err) {
      if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
        console.warn(`[refund-history] pagination error:`, err?.message || err);
      }
      return ephemeralTextResponse(
        `❌ Error paginating refund history: ${err.message}`
      );
    }
  }

  // 5. Category filter buttons
  if (parsed.action === "FILTER") {
    const { category, queryKey } = parsed;

    try {
      let records = [];
      let title = "🔎 REFUND HISTORY";
      let subtitle = "";

      if (queryKey === "__recent__") {
        title = "🕘 RECENT REFUNDS";
        subtitle = "Latest logged refunds";
        records = await getRecentRefunds({ env, limit: 20, categoryFilter: category });
      } else if (queryKey === "__my__") {
        const staffUser = interaction.member?.user || interaction.user;
        title = "👤 MY REFUNDS";
        subtitle = "Refunds logged by you";
        records = await getMyRefunds({
          env,
          staffDiscordId: staffUser?.id || "0",
          limit: 20,
          categoryFilter: category,
        });
      } else if (queryKey) {
        title = "🔎 REFUND SEARCH RESULTS";
        subtitle = `Query: "${queryKey}"`;
        records = await searchRefunds({
          env,
          query: queryKey,
          categoryFilter: category,
        });
      } else {
        records = await searchRefunds({
          env,
          query: "",
          categoryFilter: category,
        });
      }

      return updateComponentsResponse(
        buildRefundSearchResultsContainer({
          title,
          subtitle,
          records,
          page: 1,
          pageSize: 3,
          queryKey,
          categoryFilter: category,
        })
      );
    } catch (err) {
      return ephemeralTextResponse(`❌ Failed to apply category filter: ${err.message}`);
    }
  }

  // 6. Pagination buttons for search results
  if (parsed.action === "PAGE") {
    const { queryKey, categoryFilter, page: targetPage } = parsed;

    try {
      let records = [];
      let title = "🔎 REFUND HISTORY";
      let subtitle = "";

      if (queryKey === "__recent__") {
        title = "🕘 RECENT REFUNDS";
        subtitle = "Latest logged refunds";
        records = await getRecentRefunds({ env, limit: 50, categoryFilter });
      } else if (queryKey === "__my__") {
        const staffUser = interaction.member?.user || interaction.user;
        title = "👤 MY REFUNDS";
        subtitle = "Refunds logged by you";
        records = await getMyRefunds({
          env,
          staffDiscordId: staffUser?.id || "0",
          limit: 50,
          categoryFilter,
        });
      } else if (queryKey) {
        title = "🔎 REFUND SEARCH RESULTS";
        subtitle = `Query: "${queryKey}"`;
        records = await searchRefunds({
          env,
          query: queryKey,
          categoryFilter,
        });
      } else {
        records = await searchRefunds({
          env,
          query: "",
          categoryFilter,
        });
      }

      return updateComponentsResponse(
        buildRefundSearchResultsContainer({
          title,
          subtitle,
          records,
          page: targetPage,
          pageSize: 3,
          queryKey,
          categoryFilter,
        })
      );
    } catch (err) {
      return ephemeralTextResponse(`❌ Failed to paginate records: ${err.message}`);
    }
  }

  // 7. Unknown action in refund namespace
  return ephemeralTextResponse(
    "❌ **This refund action is no longer valid.**\n\nPlease reopen the Refund Center and try again."
  );
}

/**
 * Handle modal submissions for the refund system.
 *
 * @param {Object} interaction
 * @param {Object} env
 * @param {Object} [ctx]
 * @returns {Promise<Response>}
 */
export async function handleRefundModalSubmit(interaction, env, ctx) {
  const auth = verifyRefundStaff(interaction, env);
  if (!auth.isStaff) return auth.errorResponse;

  const customId = interaction.data?.custom_id || "";

  // 1. Search Modal submission
  if (customId === RefundCustomId.MODAL_SEARCH) {
    const values = getModalValues(interaction.data?.components || []);
    const searchQuery = (values.search_query || "").trim();

    if (!searchQuery) {
      return ephemeralTextResponse("❌ Search query cannot be blank.");
    }

    try {
      const records = await searchRefunds({
        env,
        query: searchQuery,
        categoryFilter: "All",
      });

      return ephemeralComponentsResponse(
        buildRefundSearchResultsContainer({
          title: "🔎 REFUND SEARCH RESULTS",
          subtitle: `Query: "${searchQuery}" • ${records.length} result(s) found`,
          records,
          page: 1,
          pageSize: 3,
          queryKey: searchQuery,
          categoryFilter: "All",
        })
      );
    } catch (err) {
      return ephemeralTextResponse(`❌ Search failed: ${err.message}`);
    }
  }

  // 2. Refund Log modal submission (standard or manual)
  if (customId.startsWith(RefundCustomId.MODAL_SUBMIT_PREFIX)) {
    const targetUserIdOrManual = customId.slice(
      RefundCustomId.MODAL_SUBMIT_PREFIX.length
    );

    const values = getModalValues(interaction.data?.components || []);

    const playerName = (values.player_name || "").trim();
    const refundDetails = (values.refund_details || "").trim();
    const reason = (values.reason || "").trim();
    let ticketUrl = (values.ticket_url || "").trim();
    if (ticketUrl) {
      ticketUrl = normalizeUrl(ticketUrl);
    }

    let refundCategory = values.refund_category;
    if (Array.isArray(refundCategory)) {
      refundCategory = refundCategory[0];
    }
    const catConfig = getRefundCategoryConfig(refundCategory);
    const stableCategoryId = catConfig.id || "Other";

    // Player Discord ID: either from selection or manual input
    let playerDiscordId = targetUserIdOrManual !== "manual"
      ? targetUserIdOrManual
      : (values.player_discord_id || "").trim();

    if (!playerDiscordId) {
      playerDiscordId = "N/A";
    }

    // Required fields validation
    if (!playerName) {
      return ephemeralTextResponse("❌ Player / Character Name is required.");
    }
    if (!refundDetails) {
      return ephemeralTextResponse("❌ Refund Details are required.");
    }
    if (!reason) {
      return ephemeralTextResponse("❌ Reason is required.");
    }
    if (ticketUrl && !isValidUrl(ticketUrl)) {
      return ephemeralTextResponse(
        "❌ Invalid Ticket URL format. Please provide a valid HTTP/HTTPS or Discord link."
      );
    }

    // Extract staff info
    const staffUser = interaction.member?.user || interaction.user;
    const staffDiscordId = staffUser?.id || "0";
    const staffName =
      interaction.member?.nick ||
      staffUser?.global_name ||
      staffUser?.username ||
      "Staff";

    const guildId =
      interaction.guild_id ||
      interaction.member?.guild_id ||
      env.DISCORD_GUILD_ID ||
      "";
    const logChannelId =
      env.REFUND_LOG_CHANNEL_ID ||
      refundConfig.channels?.logs ||
      DEFAULT_REFUND_LOG_CHANNEL_ID;

    // 1. Allocate unique Refund ID via Durable Object
    let refundId = `VRP-R-${String(Date.now()).slice(-6)}`;
    if (env.PUNISHMENT_SEQUENCE) {
      try {
        const doId = env.PUNISHMENT_SEQUENCE.idFromName("global");
        const stub = env.PUNISHMENT_SEQUENCE.get(doId);
        const allocRes = await stub.fetch("https://do/sequence/refund/next", {
          method: "POST",
        });
        if (allocRes.ok) {
          const allocData = await allocRes.json();
          if (allocData.refundId) {
            refundId = allocData.refundId;
          }
        }
      } catch (allocErr) {
        if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
          console.warn("Failed to allocate Refund ID from DO, using fallback:", allocErr.message);
        }
      }
    }

    const record = {
      refundId,
      createdAt: new Date().toISOString(),
      playerName,
      playerDiscordId,
      refundCategory: stableCategoryId,
      refundDetails,
      reason,
      ticketUrl,
      staffName,
      staffDiscordId,
      guildId,
      logChannelId,
      logMessageId: "",
      discordJumpUrl: "",
      syncStatus: SyncStatus.PENDING,
    };

    // 2. Append to Google Sheets with Sync Status = Pending
    let sheetRowIndex = -1;
    try {
      const appendResult = await appendRefundRecord({ env, record });
      sheetRowIndex = appendResult.rowIndex;
    } catch (sheetErr) {
      if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
        console.error("Failed to append refund to Google Sheet:", sheetErr);
      }
      return ephemeralTextResponse(
        `❌ Database Error: Failed to write refund record to Google Sheets (${sheetErr.message}). The refund was not logged.`
      );
    }

    // 3. Post normal searchable Discord markdown message into log channel
    const messageContent = formatRefundLog(record);
    const actionRows = createRefundActionRow(record);

    let postSuccess = false;
    let logMessageId = "";
    let jumpUrl = "";
    let postErrorText = "";

    try {
      const postUrl = `https://discord.com/api/v10/channels/${logChannelId}/messages`;
      const postPayload = {
        content: messageContent,
        components: actionRows,
      };

      const postRes = await fetch(postUrl, {
        method: "POST",
        headers: {
          Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(postPayload),
      });

      if (postRes.ok) {
        const msgData = await postRes.json();
        logMessageId = msgData.id;
        jumpUrl = `https://discord.com/channels/${guildId}/${logChannelId}/${logMessageId}`;
        postSuccess = true;
      } else {
        postErrorText = await postRes.text();
      }
    } catch (postErr) {
      postErrorText = postErr.message;
    }

    // 4. Update Google Sheet with message ID, jump URL, and sync status
    if (postSuccess) {
      await updateRefundSyncStatus({
        env,
        rowIndex: sheetRowIndex,
        logMessageId,
        discordJumpUrl: jumpUrl,
        syncStatus: SyncStatus.POSTED,
        staffInfo: { name: staffName, id: staffDiscordId },
        refundId,
      });

      const confirmButtons = [];
      if (jumpUrl && isValidUrl(jumpUrl)) {
        confirmButtons.push({
          type: ComponentType.BUTTON,
          style: ButtonStyle.LINK,
          url: jumpUrl,
          label: "View Original Log",
          emoji: { name: "🔗" },
        });
      }

      confirmButtons.push({
        type: ComponentType.BUTTON,
        custom_id: `${RefundCustomId.BTN_EDIT_PREFIX}${refundId}`,
        label: "Edit Record",
        style: ButtonStyle.SECONDARY,
        emoji: { name: "✏️" },
      });

      confirmButtons.push({
        type: ComponentType.BUTTON,
        custom_id: buildRefundPlayerHistoryCustomId(refundId),
        label: "Player History",
        style: ButtonStyle.SECONDARY,
        emoji: { name: "👤" },
      });

      return new Response(
        JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            flags: EPHEMERAL_FLAG,
            content:
              `✅ **Refund Logged Successfully**\n\n` +
              `Record **\`${refundId}\`** for **${playerName}** has been posted to <#${logChannelId}>.\n\n` +
              `[🔗 View Original Log](${jumpUrl})`,
            components: [
              {
                type: ComponentType.ACTION_ROW,
                components: confirmButtons,
              },
            ],
          },
        }),
        { headers: { "content-type": "application/json" } }
      );
    } else {
      // Discord post failed: mark Post Failed in database and notify staff
      await updateRefundSyncStatus({
        env,
        rowIndex: sheetRowIndex,
        logMessageId: "",
        discordJumpUrl: "",
        syncStatus: SyncStatus.POST_FAILED,
        staffInfo: { name: staffName, id: staffDiscordId },
        refundId,
      });

      return ephemeralTextResponse(
        `⚠️ **Refund Saved to Database, but Discord Posting Failed**\n\n` +
        `Record **\`${refundId}\`** was recorded in the database, but failed to post to Discord channel <#${logChannelId}> (${postErrorText || "Unknown error"}).\n` +
        `The record has been marked as **Post Failed**.`
      );
    }
  }

  // 3. Edit Refund Modal submission
  if (customId.startsWith(RefundCustomId.MODAL_EDIT_PREFIX)) {
    const refundId = customId.slice(RefundCustomId.MODAL_EDIT_PREFIX.length);
    let existing = null;
    try {
      existing = await getRefundById({ env, refundId });
    } catch (err) {
      return ephemeralTextResponse(`❌ Database error: ${err.message}`);
    }

    if (!existing) {
      return ephemeralTextResponse(`❌ Refund record '${refundId}' not found.`);
    }

    if (!canEditRefundRecord(interaction, env, existing)) {
      const authorMention =
        existing.staffDiscordId && existing.staffDiscordId !== "0" && existing.staffDiscordId !== "N/A"
          ? `<@${existing.staffDiscordId}>`
          : (existing.staffName || "the author");
      return ephemeralTextResponse(
        `❌ You cannot edit this refund entry. Only ${authorMention} (the staff member who entered it) or Management can edit this record.`
      );
    }

    const values = getModalValues(interaction.data?.components || []);
    const playerName = values.player_name !== undefined ? values.player_name.trim() : undefined;
    const refundDetails = values.refund_details !== undefined ? values.refund_details.trim() : undefined;
    const reason = values.reason !== undefined ? values.reason.trim() : undefined;
    let ticketUrl = values.ticket_url !== undefined ? values.ticket_url.trim() : undefined;
    if (ticketUrl) {
      ticketUrl = normalizeUrl(ticketUrl);
      if (!isValidUrl(ticketUrl)) {
        return ephemeralTextResponse("❌ Invalid Ticket URL format.");
      }
    }

    let refundCategory = values.refund_category;
    if (Array.isArray(refundCategory)) {
      refundCategory = refundCategory[0];
    }
    if (refundCategory !== undefined) {
      const catConfig = getRefundCategoryConfig(refundCategory);
      refundCategory = catConfig.id || refundCategory;
    }

    if (playerName !== undefined && !playerName) {
      return ephemeralTextResponse("❌ Player / Character Name is required.");
    }
    if (refundDetails !== undefined && !refundDetails) {
      return ephemeralTextResponse("❌ Refund Details are required.");
    }
    if (reason !== undefined && !reason) {
      return ephemeralTextResponse("❌ Reason is required.");
    }

    const staffUser = interaction.member?.user || interaction.user;
    const staffInfo = {
      id: staffUser?.id || "0",
      name:
        interaction.member?.nick ||
        staffUser?.global_name ||
        staffUser?.username ||
        "Staff",
    };

    const updatedFields = {};
    if (playerName !== undefined) updatedFields.playerName = playerName;
    if (refundCategory !== undefined) updatedFields.refundCategory = refundCategory;
    if (refundDetails !== undefined) updatedFields.refundDetails = refundDetails;
    if (reason !== undefined) updatedFields.reason = reason;
    if (ticketUrl !== undefined) updatedFields.ticketUrl = ticketUrl;

    const task = (async () => {
      try {
        const { updatedRecord, changesSummary } = await updateRefundRecord({
          env,
          refundId,
          updatedFields,
          staffInfo,
        });

        if (changesSummary === "No fields changed") {
          await editOriginalInteractionResponse({
            interaction,
            env,
            content: `ℹ️ **No Changes Detected**\n\nNo fields were modified for **\`${refundId}\`**. The record remains unchanged.`,
          });
          return;
        }

        const channelId =
          updatedRecord.logChannelId ||
          env.REFUND_LOG_CHANNEL_ID ||
          DEFAULT_REFUND_LOG_CHANNEL_ID;
        const messageId = updatedRecord.logMessageId;

        let discordEditFailed = false;
        let discordErrorText = "";

        if (messageId && channelId && env.DISCORD_BOT_TOKEN) {
          const newContent = formatRefundLog(updatedRecord);
          const newActionRows = createRefundActionRow(updatedRecord);
          const patchPayload = {
            content: newContent,
            components: newActionRows,
          };

          const patchUrl = `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`;
          const patchRes = await fetch(patchUrl, {
            method: "PATCH",
            headers: {
              Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(patchPayload),
          });

          if (!patchRes.ok) {
            discordEditFailed = true;
            discordErrorText = await patchRes.text();
          }
        }

        let jumpText = updatedRecord.discordJumpUrl
          ? `\n\n[🔗 View Updated Log](${updatedRecord.discordJumpUrl})`
          : "";

        if (discordEditFailed) {
          await editOriginalInteractionResponse({
            interaction,
            env,
            content:
              `⚠️ **Refund Updated in Database (Discord Edit Failed)**\n\n` +
              `**\`${refundId}\`** was successfully updated in the database, but editing the Discord message in <#${channelId}> failed.\n` +
              `**Changes:** ${changesSummary}\n\n` +
              `*Error: ${discordErrorText}*`,
          });
        } else {
          await editOriginalInteractionResponse({
            interaction,
            env,
            content:
              `✅ **Refund Record Updated**\n\n` +
              `Record **\`${refundId}\`** for **${updatedRecord.playerName}** has been updated successfully.\n` +
              `**Changes:** ${changesSummary}${jumpText}`,
          });
        }
      } catch (err) {
        if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
          console.error(`[modal] refund edit failed for ${refundId}:`, err);
        }
        await editOriginalInteractionResponse({
          interaction,
          env,
          content: `❌ Failed to update refund record: ${err.message}`,
        }).catch(() => {});
      }
    })();

    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(task);
    }

    return deferredChannelMessageResponse(true);
  }

  return ephemeralTextResponse("⚠️ Unrecognized refund modal submission.");
}
