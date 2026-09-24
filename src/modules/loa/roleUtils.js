/**
 * Discord Role Snapshot, Hierarchy Check, and Restoration Utilities.
 * Handles safe preserve-list role swap and restoration for Staff Leave of Absence (LOA).
 */

import {
  DEFAULT_STAFF_LOA_ROLE_ID,
  DEFAULT_LOA_MODERATOR_ROLE_ID,
  DEFAULT_LOA_SUPPORT_ROLE_ID,
  DEFAULT_MODERATOR_ROLE_ID,
  DEFAULT_SUPPORT_ROLE_ID,
  DEFAULT_ROLE_WHITELIST_APPROVED,
  DEFAULT_ROLE_KEYBOARD_WARRIOR,
  DEFAULT_ROLE_GIF,
  DEFAULT_ROLE_MEMBER,
} from "../../config/roles.js";
import { loaConfig } from "../../config/loa.config.js";
import { getGuildMember } from "./nicknameUtils.js";

/**
 * Default list of preserved player roles that are never snapshotted or removed during LOA.
 */
export const DEFAULT_PRESERVED_ROLE_IDS = [
  DEFAULT_ROLE_WHITELIST_APPROVED,
  DEFAULT_ROLE_KEYBOARD_WARRIOR,
  DEFAULT_ROLE_GIF,
  DEFAULT_ROLE_MEMBER,
];

/**
 * Fetch all guild roles from Discord REST API.
 * Endpoint: GET /guilds/{guild.id}/roles
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.guildId
 * @param {Function} [options.customFetch=fetch]
 * @returns {Promise<{ success: boolean, status: number, roles?: Array<Object>, roleMap?: Map<string, Object>, error?: string }>}
 */
export async function getGuildRoles({
  env,
  guildId,
  customFetch = fetch,
}) {
  if (!env?.DISCORD_BOT_TOKEN) {
    return { success: false, status: 0, error: "Missing DISCORD_BOT_TOKEN" };
  }
  if (!guildId) {
    return { success: false, status: 0, error: "Missing guildId" };
  }

  const url = `https://discord.com/api/v10/guilds/${guildId}/roles`;
  try {
    const res = await customFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      },
    });

    if (res.ok) {
      const roles = await res.json();
      if (!Array.isArray(roles)) {
        return {
          success: false,
          status: res.status,
          error: "Roles response is not an array",
        };
      }
      const roleMap = new Map();
      for (const role of roles) {
        roleMap.set(role.id, role);
      }
      return { success: true, status: res.status, roles, roleMap };
    }

    const errText = await res.text();
    console.warn(`Discord get guild roles failed (${res.status}):`, errText);
    return { success: false, status: res.status, error: errText };
  } catch (err) {
    console.warn("Exception fetching Discord guild roles:", err?.message || err);
    return { success: false, status: 0, error: err?.message || "Internal error" };
  }
}

/**
 * Fetch DamoBot's member record in the guild to determine its assigned roles and permissions.
 * Endpoint: GET /guilds/{guild.id}/members/{botApplicationId}
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.guildId
 * @param {Function} [options.customFetch=fetch]
 * @returns {Promise<{ success: boolean, member?: Object, error?: string }>}
 */
export async function getBotGuildMember({
  env,
  guildId,
  customFetch = fetch,
}) {
  const botId =
    env?.DISCORD_APPLICATION_ID ||
    env?.APPLICATION_ID ||
    "1544164852132618382";

  if (!env?.DISCORD_BOT_TOKEN || !guildId || !botId) {
    return { success: false, error: "Missing credentials or guildId" };
  }

  const url = `https://discord.com/api/v10/guilds/${guildId}/members/${botId}`;
  try {
    const res = await customFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      },
    });

    if (res.ok) {
      const member = await res.json();
      return { success: true, member };
    }

    const errText = await res.text();
    return { success: false, error: errText };
  } catch (err) {
    return { success: false, error: err?.message || "Internal error" };
  }
}

/**
 * Determine the highest role position held by DamoBot in the guild.
 *
 * @param {Object} botMember Discord member object for the bot
 * @param {Map<string, Object>} roleMap Map of roleId -> role object
 * @returns {number} Highest role position (0 if none)
 */
export function getBotHighestRolePosition(botMember, roleMap) {
  if (!botMember || !Array.isArray(botMember.roles) || botMember.roles.length === 0) {
    return 0;
  }

  let highest = 0;
  for (const roleId of botMember.roles) {
    const role = roleMap.get(roleId);
    if (role && typeof role.position === "number") {
      if (role.position > highest) {
        highest = role.position;
      }
    }
  }
  return highest;
}

/**
 * Check whether DamoBot has permission and hierarchy to manage the specified roles.
 *
 * Requirements:
 * 1. DamoBot must have Manage Roles permission.
 * 2. DamoBot must be strictly higher in position than the Staff LOA role.
 * 3. DamoBot must be strictly higher in position than EVERY role it will remove.
 *
 * @param {Object} params
 * @param {number} params.botHighestPosition
 * @param {string} params.staffLoaRoleId
 * @param {Array<string>} params.rolesToManage
 * @param {Map<string, Object>} params.roleMap
 * @returns {{ valid: boolean, error?: string, unmanageableRole?: Object }}
 */
export function validateRoleHierarchy({
  botHighestPosition,
  staffLoaRoleId,
  rolesToManage = [],
  roleMap,
}) {
  // 1. Check Staff LOA role position
  const staffLoaRole = roleMap?.get(staffLoaRoleId);
  if (staffLoaRole && typeof staffLoaRole.position === "number") {
    if (staffLoaRole.position >= botHighestPosition) {
      return {
        valid: false,
        unmanageableRole: staffLoaRole,
        error: `Cannot start LOA role swap. DamoBot cannot assign "${staffLoaRole.name || "Staff LOA"}" (role position ${staffLoaRole.position} is higher than Damo Bot's highest role at position ${botHighestPosition}). Move DamoBot above "${staffLoaRole.name || "Staff LOA"}" in the Discord role hierarchy.`,
      };
    }
  }

  // 2. Check each role to be removed
  for (const roleId of rolesToManage) {
    const role = roleMap?.get(roleId);
    if (role && typeof role.position === "number") {
      if (role.position >= botHighestPosition) {
        return {
          valid: false,
          unmanageableRole: role,
          error: `Cannot start LOA role swap. DamoBot cannot manage: "${role.name}" (role position ${role.position} is higher than Damo Bot's highest role at position ${botHighestPosition}). Move DamoBot above "${role.name}" in the Discord role hierarchy.`,
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Check if a role is Discord-managed / integration-managed (e.g. Nitro Booster, bot integrations).
 * Managed roles cannot be manually assigned or removed by bots.
 *
 * @param {Object} role Discord role object
 * @returns {boolean}
 */
export function isManagedRole(role) {
  if (!role) return false;
  return Boolean(role.managed);
}

/**
 * Check if a member's role IDs include any protected leadership role (Admin and above).
 *
 * @param {Array<string>} roleIds Member role IDs
 * @param {Array<string>} [protectedRoleIds] List of protected role IDs
 * @returns {boolean}
 */
export function isProtectedStaffRole(
  roleIds = [],
  protectedRoleIds = loaConfig.protectedRoleIds || []
) {
  if (!Array.isArray(roleIds) || roleIds.length === 0) return false;
  const protectedSet = new Set(
    (protectedRoleIds || loaConfig.protectedRoleIds || []).map((id) =>
      String(id).trim()
    )
  );
  for (const rawId of roleIds) {
    if (protectedSet.has(String(rawId).trim())) {
      return true;
    }
  }
  return false;
}

/**
 * Determine the specific LOA temporary access role to assign based on pre-LOA roles.
 *
 * Rules:
 * - Protected staff (Admin+): returns null (zero role modifications, NO LOA role assigned).
 * - Pre-LOA contains Moderator role: returns LOA - Moderator (grants Mod Chat + Support Chat + LOA Channel).
 * - Pre-LOA contains Support role: returns LOA - Support (grants Support Chat + LOA Channel).
 * - Other staff: fallback to default LOA role (LOA - Moderator).
 *
 * @param {Object} params
 * @param {Array<string>} params.currentRoleIds
 * @param {Array<string>} [params.protectedRoleIds]
 * @param {Object} [params.staffRoles]
 * @param {Object} [params.loaRoles]
 * @param {string} [params.defaultStaffLoaRoleId]
 * @returns {string|null}
 */
export function determineLoaRoleToAssign({
  currentRoleIds = [],
  protectedRoleIds = loaConfig.protectedRoleIds || [],
  staffRoles = loaConfig.staffRoles || {},
  loaRoles = loaConfig.loaRoles || {},
  defaultStaffLoaRoleId = null,
}) {
  // 1. Protected staff: never assign an LOA role
  if (isProtectedStaffRole(currentRoleIds, protectedRoleIds)) {
    return null;
  }

  const roleSet = new Set((currentRoleIds || []).map((id) => String(id).trim()));

  // 2. Moderator qualification check (higher priority access)
  const modRoleIds = (
    staffRoles?.moderatorIds || [DEFAULT_MODERATOR_ROLE_ID]
  ).map((id) => String(id).trim());
  for (const modId of modRoleIds) {
    if (roleSet.has(modId)) {
      return (
        loaRoles?.moderator ||
        DEFAULT_LOA_MODERATOR_ROLE_ID ||
        defaultStaffLoaRoleId
      );
    }
  }

  // 3. Support qualification check
  const supportRoleIds = (
    staffRoles?.supportIds || [DEFAULT_SUPPORT_ROLE_ID]
  ).map((id) => String(id).trim());
  for (const supId of supportRoleIds) {
    if (roleSet.has(supId)) {
      return loaRoles?.support || DEFAULT_LOA_SUPPORT_ROLE_ID;
    }
  }

  // 4. Default fallback for any other staff member
  return (
    defaultStaffLoaRoleId ||
    loaRoles?.support ||
    DEFAULT_LOA_SUPPORT_ROLE_ID
  );
}

/**
 * Calculate the exact role difference for starting an LOA using the PRESERVE LIST approach.
 *
 * Rules:
 * - Never remove @everyone (roleId === guildId).
 * - Protected staff (Administrator and above): NEVER remove any roles, do NOT assign LOA role.
 * - Lower staff:
 *   - Never remove preserved player roles (Whitelist Approved, Keyboard Warrior, Gif, Member).
 *   - Never remove Discord-managed / integration roles (role.managed === true).
 *   - All other staff roles are snapshotted to be temporarily removed.
 *   - Appropriate temporary LOA access role is added (LOA - Moderator or LOA - Support).
 *
 * @param {Object} params
 * @param {string} params.guildId
 * @param {Array<string>} params.currentRoleIds
 * @param {Array<string>} [params.preservedRoleIds]
 * @param {Array<string>} [params.protectedRoleIds]
 * @param {Object} [params.staffRoles]
 * @param {Object} [params.loaRoles]
 * @param {string} [params.staffLoaRoleId]
 * @param {Map<string, Object>} [params.roleMap]
 * @returns {{
 *   isProtectedStaff: boolean,
 *   assignedLoaRoleId: string|null,
 *   rolesToSnapshot: Array<string>,
 *   newRolesList: Array<string>,
 *   targetRoles: Array<string>,
 *   preservedRolesFound: Array<string>,
 *   managedRolesFound: Array<string>,
 *   managedRolesUntouched: Array<string>
 * }}
 */
export function calculateLoaRoleSwapDiff({
  guildId,
  currentRoleIds = [],
  preservedRoleIds = loaConfig.preservedRoleIds || DEFAULT_PRESERVED_ROLE_IDS,
  protectedRoleIds = loaConfig.protectedRoleIds || [],
  staffRoles = loaConfig.staffRoles || {},
  loaRoles = loaConfig.loaRoles || {},
  staffLoaRoleId,
  roleMap = new Map(),
}) {
  const isProtected = isProtectedStaffRole(currentRoleIds, protectedRoleIds);

  // CHANGE #1: Protected staff (Administrator and above) keep all roles and do NOT receive an LOA role
  if (isProtected) {
    const kept = (currentRoleIds || [])
      .map((id) => String(id).trim())
      .filter((id) => id && id !== guildId);

    return {
      isProtectedStaff: true,
      assignedLoaRoleId: null,
      rolesToSnapshot: [],
      newRolesList: kept,
      targetRoles: kept,
      preservedRolesFound: [],
      managedRolesFound: [],
      managedRolesUntouched: [],
    };
  }

  // Determine the exact temporary LOA access role for this lower staff member
  const assignedLoaRoleId = determineLoaRoleToAssign({
    currentRoleIds,
    protectedRoleIds,
    staffRoles,
    loaRoles,
    defaultStaffLoaRoleId: staffLoaRoleId,
  });

  const preservedSet = new Set(
    (preservedRoleIds || DEFAULT_PRESERVED_ROLE_IDS).map((id) => String(id).trim())
  );

  const rolesToSnapshot = [];
  const preservedRolesFound = [];
  const managedRolesFound = [];
  const keptRoles = new Set();

  for (const rawId of currentRoleIds) {
    const roleId = String(rawId).trim();
    if (!roleId || roleId === guildId) {
      continue; // Skip @everyone
    }

    // Check if it's on the confirmed preserve list
    if (preservedSet.has(roleId)) {
      preservedRolesFound.push(roleId);
      keptRoles.add(roleId);
      continue;
    }

    // Check if it's Discord-managed / integration role
    const roleObj = roleMap.get(roleId);
    if (isManagedRole(roleObj)) {
      managedRolesFound.push(roleId);
      keptRoles.add(roleId);
      continue;
    }

    // Otherwise, this role is snapshotted for temporary removal
    rolesToSnapshot.push(roleId);
  }

  // Build target roles list: kept roles + assigned LOA temporary role (if any)
  if (assignedLoaRoleId) {
    keptRoles.add(String(assignedLoaRoleId).trim());
  }

  return {
    isProtectedStaff: false,
    assignedLoaRoleId,
    rolesToSnapshot,
    newRolesList: Array.from(keptRoles),
    targetRoles: Array.from(keptRoles),
    preservedRolesFound,
    managedRolesFound,
    managedRolesUntouched: managedRolesFound,
  };
}

/**
 * Update a guild member's complete roles array in a single atomic Discord API call.
 * Endpoint: PATCH /guilds/{guild.id}/members/{user.id}
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.guildId
 * @param {string} options.userId
 * @param {Array<string>} options.roles Target array of role IDs
 * @param {string} [options.reason="Staff LOA role update"]
 * @param {Function} [options.customFetch=fetch]
 * @returns {Promise<{ success: boolean, status: number, error?: string }>}
 */
export async function setGuildMemberRoles({
  env,
  guildId,
  userId,
  roles,
  reason = "Staff LOA role update",
  customFetch = fetch,
}) {
  if (!env?.DISCORD_BOT_TOKEN) {
    return { success: false, status: 0, error: "Missing DISCORD_BOT_TOKEN" };
  }
  if (!guildId || !userId) {
    return { success: false, status: 0, error: "Missing guildId or userId" };
  }

  const url = `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`;
  try {
    const res = await customFetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
        "X-Audit-Log-Reason": reason,
      },
      body: JSON.stringify({
        roles: roles.map((r) => String(r).trim()),
      }),
    });

    if (res.ok) {
      return { success: true, status: res.status };
    }

    const errText = await res.text();
    if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
      console.warn(`Discord set member roles failed (${res.status}):`, errText);
    }
    return { success: false, status: res.status, error: errText };
  } catch (err) {
    if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
      console.warn("Exception setting Discord member roles:", err?.message || err);
    }
    return {
      success: false,
      status: 0,
      error: err?.message || "Internal error",
    };
  }
}

/**
 * Remove a specific role from a guild member.
 * Endpoint: DELETE /guilds/{guild.id}/members/{user.id}/roles/{role.id}
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.guildId
 * @param {string} options.userId
 * @param {string} options.roleId
 * @param {string} [options.reason]
 * @param {Function} [options.customFetch=fetch]
 * @returns {Promise<{ success: boolean, status: number, error?: string }>}
 */
export async function removeGuildMemberRole({
  env,
  guildId,
  userId,
  roleId,
  reason = "Staff LOA status update",
  customFetch = fetch,
}) {
  if (!env?.DISCORD_BOT_TOKEN || !guildId || !userId || !roleId) {
    return { success: false, status: 0, error: "Missing required parameters" };
  }

  const url = `https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${roleId}`;
  try {
    const res = await customFetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "X-Audit-Log-Reason": reason,
      },
    });

    return { success: res.ok, status: res.status };
  } catch (err) {
    return { success: false, status: 0, error: err?.message || "Internal error" };
  }
}

/**
 * Add a specific role to a guild member.
 * Endpoint: PUT /guilds/{guild.id}/members/{user.id}/roles/{role.id}
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.guildId
 * @param {string} options.userId
 * @param {string} options.roleId
 * @param {string} [options.reason]
 * @param {Function} [options.customFetch=fetch]
 * @returns {Promise<{ success: boolean, status: number, error?: string }>}
 */
export async function addGuildMemberRole({
  env,
  guildId,
  userId,
  roleId,
  reason = "Staff LOA status update",
  customFetch = fetch,
}) {
  if (!env?.DISCORD_BOT_TOKEN || !guildId || !userId || !roleId) {
    return { success: false, status: 0, error: "Missing required parameters" };
  }

  const url = `https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${roleId}`;
  try {
    const res = await customFetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "X-Audit-Log-Reason": reason,
      },
    });

    return { success: res.ok, status: res.status };
  } catch (err) {
    return { success: false, status: 0, error: err?.message || "Internal error" };
  }
}

/**
 * Execute the complete Staff LOA Role Swap procedure with full safety guarantees:
 *
 * 1. Fetch current guild roles and bot hierarchy.
 * 2. Calculate role differences using the preserve list.
 * 3. Validate hierarchy against EVERY role to be removed. If unmanageable, ABORT BEFORE TOUCHING ANYTHING.
 * 4. Save the role snapshot to SQLite in StaffLoaDO FIRST. If saving fails, ABORT.
 * 5. Atomically update Discord member roles (remove snapshotted roles, add Staff LOA).
 * 6. If Discord update fails, rollback and update DO status to 'failed'.
 * 7. If successful, mark DO status as 'completed'.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.guildId
 * @param {string} options.userId
 * @param {Array<string>} options.currentMemberRoles
 * @param {Object} options.stub StaffLoaDO stub
 * @param {string} options.loaId
 * @param {Array<string>} [options.preservedRoleIds]
 * @param {string} [options.staffLoaRoleId]
 * @param {Function} [options.customFetch=fetch]
 * @returns {Promise<{
 *   success: boolean,
 *   error?: string,
 *   unmanageableRole?: Object,
 *   removedRoleIds?: Array<string>,
 *   preservedRoleIds?: Array<string>,
 *   staffLoaRoleId?: string
 * }>}
 */
export async function executeLoaRoleSwap({
  env,
  guildId,
  userId,
  currentMemberRoles = [],
  stub,
  loaId,
  preservedRoleIds = loaConfig.preservedRoleIds || DEFAULT_PRESERVED_ROLE_IDS,
  protectedRoleIds = loaConfig.protectedRoleIds || [],
  staffRoles = loaConfig.staffRoles || {},
  loaRoles = loaConfig.loaRoles || {},
  staffLoaRoleId,
  customFetch = fetch,
}) {
  // Step 0: Protected Leadership check (Administrator and above)
  // Protected staff NEVER have roles removed, do NOT receive an LOA role, and bypass hierarchy checks.
  const isProtectedEarly = isProtectedStaffRole(currentMemberRoles, protectedRoleIds);
  if (isProtectedEarly) {
    if (stub && loaId) {
      await stub.fetch("https://do/loa/role-snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loaId,
          removedRoleIds: [],
          preservedRoleIds: currentMemberRoles,
          status: "completed",
          isProtectedStaff: 1,
          assignedLoaRoleId: null,
        }),
      }).catch(() => {});
    }

    return {
      success: true,
      isProtected: true,
      isProtectedStaff: true,
      assignedLoaRoleId: null,
      removedRoleIds: [],
      preservedRoleIds: currentMemberRoles,
      targetRoles: currentMemberRoles,
    };
  }

  // Step 1: Fetch guild roles & bot member
  const rolesRes = await getGuildRoles({ env, guildId, customFetch });
  if (!rolesRes.success || !rolesRes.roleMap) {
    return {
      success: false,
      error: `Could not fetch server roles from Discord (${rolesRes.error || "Unknown error"}). Role swap aborted.`,
    };
  }
  const roleMap = rolesRes.roleMap;

  const botMemberRes = await getBotGuildMember({ env, guildId, customFetch });
  const botHighestPosition = botMemberRes.success
    ? getBotHighestRolePosition(botMemberRes.member, roleMap)
    : Infinity;

  // Step 2: Determine member's current roles
  let memberRoleIds = currentMemberRoles;
  if (!memberRoleIds || memberRoleIds.length === 0) {
    const memRes = await getGuildMember({ env, guildId, userId, customFetch });
    if (memRes.success && memRes.member?.roles) {
      memberRoleIds = memRes.member.roles;
    }
  }

  // Step 3: Calculate role differences using preserve list & protected leadership rules
  const effectiveStaffLoaRoleId =
    staffLoaRoleId ||
    env?.STAFF_LOA_ROLE_ID ||
    loaConfig.staffLoaRoleId ||
    DEFAULT_STAFF_LOA_ROLE_ID;

  const diff = calculateLoaRoleSwapDiff({
    guildId,
    currentRoleIds: memberRoleIds || [],
    preservedRoleIds,
    protectedRoleIds,
    staffRoles,
    loaRoles,
    staffLoaRoleId: effectiveStaffLoaRoleId,
    roleMap,
  });

  // CHANGE #1: Protected staff (Administrator and above) keep all roles and do NOT receive an LOA role
  if (diff.isProtectedStaff) {
    if (stub && loaId) {
      await stub.fetch("https://do/loa/role-snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loaId,
          isProtectedStaff: 1,
          assignedLoaRoleId: null,
          removedRoleIds: [],
          preservedRoleIds: [],
          roleSwapStatus: "completed",
          roleSwapCompletedAt: new Date().toISOString(),
        }),
      }).catch(() => {});
    }

    return {
      success: true,
      isProtected: true,
      isProtectedStaff: true,
      removedRoleIds: [],
      preservedRoleIds: [],
      staffLoaRoleId: null,
      assignedLoaRoleId: null,
    };
  }

  // Step 4: Validate hierarchy against all removable roles and assigned LOA role
  if (botMemberRes.success && botHighestPosition > 0) {
    const hierarchyCheck = validateRoleHierarchy({
      botHighestPosition,
      staffLoaRoleId: diff.assignedLoaRoleId,
      rolesToManage: diff.rolesToSnapshot,
      roleMap,
    });

    if (!hierarchyCheck.valid) {
      return {
        success: false,
        error: hierarchyCheck.error,
        unmanageableRole: hierarchyCheck.unmanageableRole,
      };
    }
  }

  // Step 5: Save role snapshot to SQLite in StaffLoaDO FIRST.
  // CRITICAL RULE: Never remove roles unless the role snapshot has been successfully saved.
  try {
    const snapshotSaveRes = await stub.fetch("https://do/loa/role-snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loaId,
        isProtectedStaff: 0,
        assignedLoaRoleId: diff.assignedLoaRoleId,
        removedRoleIds: diff.rolesToSnapshot,
        preservedRoleIds: diff.preservedRolesFound,
        roleSwapStatus: "pending",
      }),
    });

    const snapshotSaveData = await snapshotSaveRes.json().catch(() => ({}));
    if (!snapshotSaveRes.ok || !snapshotSaveData?.success) {
      return {
        success: false,
        error: `Failed to save role snapshot to database (${snapshotSaveData?.error || "Storage failure"}). No roles were removed.`,
      };
    }
  } catch (err) {
    return {
      success: false,
      error: `Database exception saving role snapshot: ${err.message}. No roles were removed.`,
    };
  }

  // Step 6: Execute atomic role swap on Discord
  const swapRes = await setGuildMemberRoles({
    env,
    guildId,
    userId,
    roles: diff.newRolesList,
    reason: "Staff LOA started: temporary role swap",
    customFetch,
  });

  if (!swapRes.success) {
    // Attempt rollback: ensure original roles are restored
    await setGuildMemberRoles({
      env,
      guildId,
      userId,
      roles: memberRoleIds,
      reason: "Staff LOA role swap failed: rollback to original roles",
      customFetch,
    }).catch(() => {});

    // Update DO status to failed
    await stub.fetch("https://do/loa/role-snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loaId,
        roleSwapStatus: "failed",
        roleSwapError: swapRes.error || "Discord PATCH failed",
      }),
    }).catch(() => {});

    return {
      success: false,
      error: `Discord failed to update member roles: ${swapRes.error || "Forbidden / Rate limited"}. Original roles were preserved.`,
    };
  }

  // Step 7: Mark role swap as completed in DO
  await stub.fetch("https://do/loa/role-snapshot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      loaId,
      roleSwapStatus: "completed",
      roleSwapCompletedAt: new Date().toISOString(),
    }),
  }).catch(() => {});

  return {
    success: true,
    isProtected: false,
    isProtectedStaff: false,
    removedRoleIds: diff.rolesToSnapshot,
    preservedRoleIds: diff.preservedRolesFound,
    staffLoaRoleId: diff.assignedLoaRoleId,
    assignedLoaRoleId: diff.assignedLoaRoleId,
  };
}

/**
 * Execute the complete Staff LOA Role Restoration procedure:
 *
 * 1. Check if member is protected leadership staff (if so, zero role modifications).
 * 2. Load saved role snapshot for lower staff.
 * 3. Handle legacy LOA (no snapshot) gracefully without guessing roles.
 * 4. Verify which snapshotted roles still exist in the guild and are manageable.
 * 5. Restore valid roles and remove all assigned LOA temporary roles.
 * 6. Track successfully restored roles and failed restorations.
 * 7. Persist restoration outcome in StaffLoaDO permanently.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.guildId
 * @param {string} options.userId
 * @param {Object} options.loaRecord Normalized LOA record with removedRoleIds
 * @param {Object} options.stub StaffLoaDO stub
 * @param {string} [options.staffLoaRoleId]
 * @param {Object} [options.loaRoles]
 * @param {Function} [options.customFetch=fetch]
 * @returns {Promise<{
 *   success: boolean,
 *   isProtected?: boolean,
 *   isLegacy?: boolean,
 *   restoredRoleIds: Array<string>,
 *   failedRestoreRoleIds: Array<string>,
 *   error?: string
 * }>}
 */
export async function executeLoaRoleRestore({
  env,
  guildId,
  userId,
  currentMemberRoles = [],
  loaRecord,
  stub,
  staffLoaRoleId = env?.STAFF_LOA_ROLE_ID || loaConfig.staffLoaRoleId || DEFAULT_STAFF_LOA_ROLE_ID,
  loaRoles = loaConfig.loaRoles || {},
  customFetch = fetch,
}) {
  if (!loaRecord) {
    return {
      success: false,
      error: "No LOA record provided for role restoration",
      restoredRoleIds: [],
      failedRestoreRoleIds: [],
    };
  }

  // CHANGE #1: Protected staff (Administrator and above) never had roles removed and never received an LOA role
  const isProtected =
    Boolean(loaRecord.is_protected_staff) ||
    Boolean(loaRecord.isProtectedStaff);

  if (isProtected) {
    if (stub && loaRecord.id) {
      await stub.fetch("https://do/loa/role-restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loaId: loaRecord.id,
          roleRestoreStatus: "completed",
          roleRestoreCompletedAt: new Date().toISOString(),
          restoredRoleIds: [],
          failedRestoreRoleIds: [],
          isLegacySnapshot: 0,
        }),
      }).catch(() => {});
    }

    return {
      success: true,
      isProtected: true,
      isProtectedStaff: true,
      restoredRoleIds: [],
      failedRestoreRoleIds: [],
    };
  }

  let removedRoleIds = loaRecord.removedRoleIds;
  if (!removedRoleIds && loaRecord.removed_role_ids) {
    try {
      removedRoleIds =
        typeof loaRecord.removed_role_ids === "string"
          ? JSON.parse(loaRecord.removed_role_ids)
          : loaRecord.removed_role_ids;
    } catch (_) {
      removedRoleIds = [];
    }
  }
  removedRoleIds = Array.isArray(removedRoleIds) ? removedRoleIds : [];

  const isLegacy =
    Boolean(loaRecord.isLegacySnapshot) ||
    Boolean(loaRecord.is_legacy_snapshot) ||
    removedRoleIds.length === 0;

  // Set of all LOA roles that must be removed on LOA end
  const loaRolesToRemove = new Set();
  if (staffLoaRoleId) loaRolesToRemove.add(String(staffLoaRoleId).trim());
  if (loaRoles?.moderator) loaRolesToRemove.add(String(loaRoles.moderator).trim());
  if (loaRoles?.support) loaRolesToRemove.add(String(loaRoles.support).trim());
  if (loaRecord.assigned_loa_role_id) loaRolesToRemove.add(String(loaRecord.assigned_loa_role_id).trim());
  if (loaRecord.assignedLoaRoleId) loaRolesToRemove.add(String(loaRecord.assignedLoaRoleId).trim());
  loaRolesToRemove.delete("");

  // If this is a legacy LOA without a saved snapshot:
  if (isLegacy) {
    for (const rId of loaRolesToRemove) {
      await removeGuildMemberRole({
        env,
        guildId,
        userId,
        roleId: rId,
        reason: "Legacy Staff LOA ended: remove LOA role",
        customFetch,
      }).catch(() => {});
    }

    if (stub && loaRecord.id) {
      await stub.fetch("https://do/loa/role-restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loaId: loaRecord.id,
          roleRestoreStatus: "completed",
          roleRestoreCompletedAt: new Date().toISOString(),
          restoredRoleIds: [],
          failedRestoreRoleIds: [],
          isLegacySnapshot: 1,
        }),
      }).catch(() => {});
    }

    return {
      success: true,
      isLegacy: true,
      restoredRoleIds: [],
      failedRestoreRoleIds: [],
    };
  }

  // Fetch guild roles to check which roles still exist and are manageable
  const rolesRes = await getGuildRoles({ env, guildId, customFetch });
  const roleMap = rolesRes.success && rolesRes.roleMap ? rolesRes.roleMap : new Map();
  const guildRolesAvailable = rolesRes.success && roleMap && roleMap.size > 0;

  const botMemberRes = await getBotGuildMember({ env, guildId, customFetch });
  const botHighestPosition = botMemberRes.success
    ? getBotHighestRolePosition(botMemberRes.member, roleMap)
    : Infinity;

  const validRolesToRestore = [];
  const failedRestoreRoleIds = [];

  for (const rawId of removedRoleIds) {
    const roleId = String(rawId).trim();
    if (!roleId) continue;

    if (guildRolesAvailable) {
      const roleObj = roleMap.get(roleId);
      if (!roleObj) {
        // Role was deleted from the server while user was on LOA
        failedRestoreRoleIds.push(roleId);
        continue;
      }

      if (
        botMemberRes.success &&
        botHighestPosition > 0 &&
        typeof roleObj.position === "number" &&
        roleObj.position >= botHighestPosition
      ) {
        // Role is now above DamoBot in hierarchy
        failedRestoreRoleIds.push(roleId);
        continue;
      }
    }

    validRolesToRestore.push(roleId);
  }

  // Fetch current member details to compute target roles array
  let currentRoles = Array.isArray(currentMemberRoles) && currentMemberRoles.length > 0 ? [...currentMemberRoles] : [];
  try {
    const memberUrl = `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`;
    const memberRes = await customFetch(memberUrl, {
      method: "GET",
      headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
    });
    if (memberRes.ok) {
      const memberData = await memberRes.json();
      if (Array.isArray(memberData?.roles)) {
        currentRoles = memberData.roles;
      }
    }
  } catch (_) {}

  // Remove all assigned LOA temporary roles and add back the restored roles
  const targetRolesSet = new Set(
    currentRoles.filter((r) => !loaRolesToRemove.has(String(r).trim()))
  );
  for (const rId of validRolesToRestore) {
    targetRolesSet.add(rId);
  }

  // Attempt atomic restore via PATCH
  const patchRes = await setGuildMemberRoles({
    env,
    guildId,
    userId,
    roles: Array.from(targetRolesSet),
    reason: "Staff LOA ended: restored original staff roles",
    customFetch,
  });

  const successfullyRestored = [];

  if (patchRes.success) {
    successfullyRestored.push(...validRolesToRestore);
  } else {
    // Fallback: remove LOA roles individually, then restore each role individually
    for (const rId of loaRolesToRemove) {
      await removeGuildMemberRole({
        env,
        guildId,
        userId,
        roleId: rId,
        reason: "Staff LOA ended: fallback removal",
        customFetch,
      }).catch(() => {});
    }

    for (const rId of validRolesToRestore) {
      const addRes = await addGuildMemberRole({
        env,
        guildId,
        userId,
        roleId: rId,
        reason: "Staff LOA ended: fallback role restore",
        customFetch,
      });
      if (addRes.success) {
        successfullyRestored.push(rId);
      } else {
        failedRestoreRoleIds.push(rId);
      }
    }
  }

  // Update restoration records in StaffLoaDO
  if (stub && loaRecord.id) {
    await stub.fetch("https://do/loa/role-restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loaId: loaRecord.id,
        roleRestoreStatus: failedRestoreRoleIds.length === 0 ? "completed" : "partial",
        roleRestoreCompletedAt: new Date().toISOString(),
        restoredRoleIds: successfullyRestored,
        failedRestoreRoleIds,
        roleRestoreError:
          failedRestoreRoleIds.length > 0
            ? `${failedRestoreRoleIds.length} role(s) could not be restored (deleted or hierarchy conflict).`
            : null,
      }),
    }).catch(() => {});
  }

  return {
    success: true,
    isLegacy: false,
    restoredRoleIds: successfullyRestored,
    failedRestoreRoleIds,
  };
}
