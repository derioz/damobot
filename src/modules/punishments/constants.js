/**
 * Constants for Staff Punishment Center
 */

export const DEFAULT_PUNISHMENT_LOG_CHANNEL_ID = "1249517344099668078";
export const DEFAULT_STAFF_TEAM_ROLE_ID = "743422836223246366";
export const DEFAULT_OWNER_ROLE_ID = "743423786275307542";

export const DEFAULT_PUNISHMENT_SHEET_TAB = "Punishment Logs";
export const DEFAULT_PUNISHMENT_AUDIT_TAB = "Punishment Audits";

export const PunishmentCustomId = {
  // Center main action buttons
  BTN_LOG: "punish_btn_log",
  BTN_SEARCH: "punish_btn_search",
  BTN_RECENT: "punish_btn_recent",
  BTN_MY_LOGS: "punish_btn_my_logs",

  // Workflow selectors and controls
  USER_SELECT: "punish_select_user",
  BTN_MANUAL: "punish_btn_manual",
  BTN_DISMISS: "punish_btn_dismiss",

  // Modals
  MODAL_SUBMIT_PREFIX: "punish_modal_submit:",
  MODAL_SEARCH: "punish_modal_search",
  MODAL_EDIT_PREFIX: "punish_modal_edit:",

  // Action row buttons under logs and search results
  BTN_PLAYER_HISTORY_PREFIX: "punish_hist:",
  BTN_PAGE_PREFIX: "punish_page:",
  BTN_EDIT_PREFIX: "punish_edit:",
  BTN_LINKS_PREFIX: "punish_links:",
  MODAL_LINKS_PREFIX: "punish_modal_links:",

  // Add to Punishment message context workflow
  USER_SELECT_TRANSCRIPT_PREFIX: "punish_sel_user_trans:",
  SELECT_ADD_TRANSCRIPT_PREFIX: "punish_sel_trans:",
  BTN_CHOOSE_TRANSCRIPT_PREFIX: "punish_att_choose:",
  BTN_CONFIRM_REPLACE_PREFIX: "punish_tx_rep:",
  BTN_CANCEL_REPLACE_PREFIX: "punish_tx_cancel:",
  BTN_CANCEL_REPLACE: "punish_cancel_replace",
  BTN_CREATE_WITH_MSG_PREFIX: "punish_add_create:",
  MODAL_CREATE_WITH_MSG_PREFIX: "punish_modal_create_msg:",

  // Legacy aliases for backward compatibility
  LEGACY_CONFIRM_REPLACE_PREFIX: "punish_att_confirm:",
};

/**
 * Build compact Replace Existing custom_id using the pending state token.
 * Example: "punish_tx_rep:tx_m7x4b1_f83k9a" (30 chars)
 *
 * @param {string} token
 * @returns {string}
 */
export function buildTranscriptReplaceCustomId(token) {
  return `${PunishmentCustomId.BTN_CONFIRM_REPLACE_PREFIX}${token}`;
}

/**
 * Build compact Cancel replacement custom_id using the pending state token.
 * Example: "punish_tx_cancel:tx_m7x4b1_f83k9a" (33 chars)
 *
 * @param {string} token
 * @returns {string}
 */
export function buildTranscriptCancelCustomId(token) {
  return `${PunishmentCustomId.BTN_CANCEL_REPLACE_PREFIX}${token}`;
}

/**
 * Parse transcript confirmation button custom_id (supports both new tokenized and legacy formats).
 *
 * @param {string} customId
 * @returns {Object|null}
 */
export function parseTranscriptCustomId(customId) {
  if (!customId || typeof customId !== "string") return null;

  if (customId.startsWith(PunishmentCustomId.BTN_CONFIRM_REPLACE_PREFIX)) {
    const raw = customId.slice(PunishmentCustomId.BTN_CONFIRM_REPLACE_PREFIX.length);
    if (raw.includes(":")) {
      const [transcriptType, punishmentId, channelId, messageId, expectedHash] =
        raw.split(":");
      return {
        action: "legacy_replace",
        transcriptType,
        punishmentId,
        channelId,
        messageId,
        expectedHash,
      };
    }
    return {
      action: "replace",
      token: raw,
    };
  }

  if (customId.startsWith(PunishmentCustomId.LEGACY_CONFIRM_REPLACE_PREFIX)) {
    const rawPayload = customId.slice(
      PunishmentCustomId.LEGACY_CONFIRM_REPLACE_PREFIX.length
    );
    const [transcriptType, punishmentId, channelId, messageId, expectedHash] =
      rawPayload.split(":");
    return {
      action: "legacy_replace",
      transcriptType,
      punishmentId,
      channelId,
      messageId,
      expectedHash,
    };
  }

  if (customId.startsWith(PunishmentCustomId.BTN_CANCEL_REPLACE_PREFIX)) {
    return {
      action: "cancel",
      token: customId.slice(PunishmentCustomId.BTN_CANCEL_REPLACE_PREFIX.length),
    };
  }

  // Legacy cancel
  if (customId === PunishmentCustomId.BTN_CANCEL_REPLACE) {
    return {
      action: "legacy_cancel",
    };
  }

  return null;
}


export const SyncStatus = {
  PENDING: "Pending",
  POSTED: "Posted",
  POST_FAILED: "Post Failed",
};

export const AuditAction = {
  CREATED: "CREATED",
  POST_FAILED: "POST_FAILED",
  SYNC_RETRY: "SYNC_RETRY",
  EDITED: "EDITED",
  VOIDED: "VOIDED",
};

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
  LABEL: 18,
  FILE_UPLOAD: 19,
};

export const ButtonStyle = {
  PRIMARY: 1,
  SECONDARY: 2,
  SUCCESS: 3,
  DANGER: 4,
  LINK: 5,
};

export const IS_COMPONENTS_V2_FLAG = 32768; // 1 << 15
export const EPHEMERAL_FLAG = 64; // 1 << 6
export const VITAL_ORANGE = 16425472; // #FAA200
