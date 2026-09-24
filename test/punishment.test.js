import test from "node:test";
import assert from "node:assert/strict";
import {
  PunishmentSequenceDO,
  formatPunishmentId,
  extractNumericSequence,
} from "../src/durableObjects/punishmentSequence.js";
import {
  formatPunishmentDate,
  formatPunishmentLog,
  createPunishmentActionRow,
  formatPunishmentEmbeds,
  isValidUrl,
} from "../src/punishment/formatter.js";
import {
  buildPunishmentCenterContainer,
  buildUserSelectPrompt,
  buildPunishmentModal,
  buildManualPunishmentModal,
  buildSearchModal,
  buildSearchResultsContainer,
  buildEditPunishmentModal,
  buildEditLinksModal,
  buildAddTicketTranscriptPrompt,
  buildAddToPunishmentSelectorContainer,
  buildTranscriptTypeChoiceContainer,
  buildTranscriptOverwriteWarningContainer,
  buildNoPunishmentRecordsContainer,
} from "../src/punishment/components.js";
import { extractTicketTranscriptUrl, hashString } from "../src/punishment/transcript.js";
import {
  initPunishmentSheet,
  appendPunishmentRecord,
  updatePunishmentSyncStatus,
  searchPunishments,
  getPlayerHistory,
  getRecentPunishments,
  getMyPunishments,
  mapRowToPunishment,
  getLatestPunishmentsByDiscordId,
} from "../src/punishment/sheets.js";
import {
  createMockD1Database,
  getDatabase,
  appendPunishmentRecord as d1AppendPunishmentRecord,
  getPunishmentById as d1GetPunishmentById,
  getRecentPunishments as d1GetRecentPunishments,
  getMyPunishments as d1GetMyPunishments,
  getPlayerHistory as d1GetPlayerHistory,
  getLatestPunishmentsByDiscordId as d1GetLatestPunishmentsByDiscordId,
  searchPunishments as d1SearchPunishments,
  updatePunishmentRecord as d1UpdatePunishmentRecord,
  updatePunishmentSyncStatus as d1UpdatePunishmentSyncStatus,
  getPunishmentAudits as d1GetPunishmentAudits,
} from "../src/punishment/db.js";
import {
  verifyStaffRole,
  handlePunishmentCommand,
  handlePunishmentComponent,
  handlePunishmentModalSubmit,
  handleUserContextPunishmentHistory,
  handleMessageContextAddToPunishment,
  processTranscriptReplacement,
  editOriginalInteractionResponse,
  inFlightReplacements,
  getModalValues,
} from "../src/punishment/handlers.js";
import {
  handleMessageContextDefinitelyImportant,
  DAMO_EASTER_EGG_RESPONSES,
} from "../src/punishment/easterEgg.js";
import {
  DEFAULT_STAFF_TEAM_ROLE_ID,
  DEFAULT_OWNER_ROLE_ID,
  DEFAULT_PUNISHMENT_LOG_CHANNEL_ID,
  PunishmentCustomId,
  SyncStatus,
  AuditAction,
  ComponentType,
} from "../src/punishment/constants.js";
import { DAMO_BOT_VERSION } from "../src/config.js";
import { commands } from "../scripts/register-commands.js";
import worker from "../src/index.js";
import {
  savePendingReplacementContext,
  getPendingReplacementContext,
  consumePendingReplacementContext,
} from "../src/punishment/pendingState.js";

let testRsaPem = "";
async function getTestRsaPem() {
  if (testRsaPem) return testRsaPem;
  const rsaKeyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  );
  const exported = await crypto.subtle.exportKey(
    "pkcs8",
    rsaKeyPair.privateKey
  );
  const base64 = Buffer.from(exported).toString("base64");
  testRsaPem = `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----`;
  return testRsaPem;
}

// Helper to create mock environment
async function createMockEnv(overrides = {}) {
  const sequenceDO = new PunishmentSequenceDO({}, {});
  const doStub = {
    fetch: async (reqUrl, options = {}) => {
      const url = typeof reqUrl === "string" ? new URL(reqUrl) : new URL(reqUrl.url);
      const method = options.method || (typeof reqUrl === "object" ? reqUrl.method : "GET");
      const fakeReq = {
        method,
        url: url.toString(),
        json: async () => JSON.parse(options.body || "{}"),
      };
      return sequenceDO.fetch(fakeReq);
    },
  };

  const pem = await getTestRsaPem();

  return {
    ENVIRONMENT: "test",
    STAFF_TEAM_ROLE_ID: "743422836223246366",
    PUNISHMENT_LOG_CHANNEL_ID: "1249517344099668078",
    PUNISHMENT_SHEET_ID: "mock_punishment_sheet_123",
    PUNISHMENT_SHEET_TAB: "Punishment Logs",
    PUNISHMENT_AUDIT_TAB: "Punishment Audits",
    GOOGLE_SERVICE_ACCOUNT_EMAIL: "mock-sa@project.iam.gserviceaccount.com",
    GOOGLE_PRIVATE_KEY: pem,
    DISCORD_BOT_TOKEN: "mock_bot_token",
    DISCORD_GUILD_ID: "730015674348601384",
    PUNISHMENT_SEQUENCE: {
      idFromName: () => "global",
      get: () => doStub,
    },
    PUNISHMENT_DB: createMockD1Database(),
    ...overrides,
  };
}

// 1. VERSIONING
test("VERSION: Canonical version conforms to semver format", () => {
  assert.match(DAMO_BOT_VERSION, /^v\d+\.\d+\.\d+(-beta(\.\d+)?)?$/);
});

// 2. ATOMIC SEQUENCE DO & ID HELPERS
test("ID HELPERS: formatPunishmentId formats with 6-digit padding", () => {
  assert.equal(formatPunishmentId(1), "VRP-P-000001");
  assert.equal(formatPunishmentId(142), "VRP-P-000142");
  assert.equal(formatPunishmentId(123456), "VRP-P-123456");
  assert.equal(formatPunishmentId(1234567), "VRP-P-1234567");
});

test("ID HELPERS: extractNumericSequence parses various formats", () => {
  assert.equal(extractNumericSequence("VRP-P-000142"), 142);
  assert.equal(extractNumericSequence("vrp-p-000142"), 142);
  assert.equal(extractNumericSequence("000142"), 142);
  assert.equal(extractNumericSequence("142"), 142);
  assert.equal(extractNumericSequence("VRP-P-1"), 1);
  assert.equal(extractNumericSequence("invalid"), null);
});

test("PUNISHMENT SEQUENCE DO: allocates sequential unique IDs without duplicates", async () => {
  const doInstance = new PunishmentSequenceDO({}, {});
  const id1 = doInstance.allocateNextId();
  const id2 = doInstance.allocateNextId();
  const id3 = doInstance.allocateNextId();

  assert.equal(id1.sequence, 1);
  assert.equal(id1.punishmentId, "VRP-P-000001");
  assert.equal(id2.sequence, 2);
  assert.equal(id2.punishmentId, "VRP-P-000002");
  assert.equal(id3.sequence, 3);
  assert.equal(id3.punishmentId, "VRP-P-000003");
  assert.notEqual(id1.punishmentId, id2.punishmentId);
});

test("PUNISHMENT SEQUENCE DO: handles sync and center message ID storage", async () => {
  const doInstance = new PunishmentSequenceDO({}, {});
  doInstance.syncSequence(50);
  const next = doInstance.allocateNextId();
  assert.equal(next.sequence, 50);

  doInstance.setMeta("center_message_id", "999888777");
  assert.equal(doInstance.getMeta("center_message_id"), "999888777");
});

// 3. ACCESS CONTROL & STAFF VERIFICATION
test("SECURITY: StaffTeam role member is authorized", async () => {
  const env = await createMockEnv();
  const interaction = {
    member: {
      roles: [env.STAFF_TEAM_ROLE_ID, "some_other_role"],
      user: { id: "staff_user_1" },
    },
  };
  const res = verifyStaffRole(interaction, env);
  assert.equal(res.isStaff, true);
  assert.equal(res.errorResponse, null);
});

test("SECURITY: Non-staff member without StaffTeam role is rejected ephemerally", async () => {
  const env = await createMockEnv();
  const interaction = {
    member: {
      roles: ["regular_user_role"],
      user: { id: "normal_user" },
    },
  };
  const res = verifyStaffRole(interaction, env);
  assert.equal(res.isStaff, false);
  assert.ok(res.errorResponse);

  const body = await res.errorResponse.json();
  assert.equal(body.data.flags, 64); // Ephemeral
  assert.match(body.data.content, /only available to Vital RP staff/i);
});

test("SECURITY: Administrator without StaffTeam role is strictly rejected (no admin bypass)", async () => {
  const env = await createMockEnv();
  const interaction = {
    member: {
      roles: ["admin_role_999"], // Admin role ID, but NOT StaffTeam role ID
      permissions: "8", // Administrator permission flag
      user: { id: "admin_without_staff_team" },
    },
  };
  const res = verifyStaffRole(interaction, env);
  assert.equal(res.isStaff, false);
  assert.ok(res.errorResponse);
});

test("SECURITY: Owner role member (DEFAULT_OWNER_ROLE_ID) without StaffTeam role is authorized", async () => {
  const env = await createMockEnv();
  const interaction = {
    member: {
      roles: [DEFAULT_OWNER_ROLE_ID],
      user: { id: "owner_user_1" },
    },
  };
  const res = verifyStaffRole(interaction, env);
  assert.equal(res.isStaff, true);
  assert.equal(res.errorResponse, null);
});

test("SECURITY: Member with both StaffTeam and Owner roles is authorized", async () => {
  const env = await createMockEnv();
  const interaction = {
    member: {
      roles: [DEFAULT_STAFF_TEAM_ROLE_ID, DEFAULT_OWNER_ROLE_ID],
      user: { id: "super_staff_owner" },
    },
  };
  const res = verifyStaffRole(interaction, env);
  assert.equal(res.isStaff, true);
  assert.equal(res.errorResponse, null);
});

test("SECURITY: Custom env.OWNER_ROLE_ID is respected for authorization", async () => {
  const env = await createMockEnv();
  env.OWNER_ROLE_ID = "999888777666555444";
  const interaction = {
    member: {
      roles: ["999888777666555444"],
      user: { id: "custom_owner_user" },
    },
  };
  const res = verifyStaffRole(interaction, env);
  assert.equal(res.isStaff, true);
  assert.equal(res.errorResponse, null);
});

// 4. NORMAL DISCORD LOG FORMATTING & SEARCHABILITY
test("FORMATTER: formatPunishmentLog contains all required searchable text fields in markdown content", () => {
  const record = {
    punishmentId: "VRP-P-000142",
    playerName: "Yamsheed Yaffari",
    playerDiscordId: "333552471588864013",
    punishment: "2 Day Ban",
    reason: "DM (with context). Immediately shooting at police upon arriving at a black market event without initiating contact.",
    reportUrl: "https://discord.com/channels/730015674348601384/1249517344099668078/111222333",
    responseUrl: "https://discord.com/channels/730015674348601384/1249517344099668078/444555666",
    staffName: "Big-Croissant-Chungus",
    staffDiscordId: "150580708144840704",
    createdAt: "2026-09-03T21:52:00.000Z",
  };

  const formatted = formatPunishmentLog(record);

  // Verify all searchable elements are visible in normal markdown message text:
  assert.match(formatted, /VRP-P-000142/);
  assert.match(formatted, /Yamsheed Yaffari/);
  assert.match(formatted, /333552471588864013/);
  assert.match(formatted, /2 Day Ban/);
  assert.match(formatted, /DM \(with context\)/);
  assert.match(formatted, /Big-Croissant-Chungus/);
  assert.match(formatted, /150580708144840704/);
  assert.match(formatted, /⚖️ \*\*Punishment Logged\*\*/);
});

test("FORMATTER: createPunishmentActionRow places Report, Response, then Player History buttons", () => {
  const recordWithLinks = {
    punishmentId: "VRP-P-000142",
    playerName: "Yamsheed Yaffari",
    playerDiscordId: "333552471588864013",
    reportUrl: "https://discord.com/channels/123/456",
    responseUrl: "https://discord.com/channels/123/789",
  };

  const rows = createPunishmentActionRow(recordWithLinks);
  assert.equal(rows.length, 1);
  const buttons = rows[0].components;
  assert.equal(buttons.length, 3);

  // Button 1: Report Link
  assert.equal(buttons[0].label, "Report");
  assert.equal(buttons[0].style, 5); // Link button
  assert.equal(buttons[0].url, "https://discord.com/channels/123/456");

  // Button 2: Response Link
  assert.equal(buttons[1].label, "Response");
  assert.equal(buttons[1].style, 5); // Link button
  assert.equal(buttons[1].url, "https://discord.com/channels/123/789");

  // Button 3: Player History
  assert.equal(buttons[2].label, "Player History");
  assert.equal(buttons[2].custom_id, "punish_hist:333552471588864013");

  // Record without links: only Player History button
  const recordNoLinks = {
    punishmentId: "VRP-P-000143",
    playerName: "Test Player",
    playerDiscordId: "N/A",
    reportUrl: "",
    responseUrl: "",
  };
  const rowsNoLinks = createPunishmentActionRow(recordNoLinks);
  assert.equal(rowsNoLinks[0].components.length, 1);
  assert.equal(rowsNoLinks[0].components[0].custom_id, "punish_hist:Test Player");

  // Record without links: markdown text omits Report and Response lines entirely
  const formattedNoLinks = formatPunishmentLog(recordNoLinks);
  assert.equal(formattedNoLinks.includes("Report:"), false);
  assert.equal(formattedNoLinks.includes("Response:"), false);
  assert.equal(formattedNoLinks.includes("Report: None"), false);
  assert.equal(formattedNoLinks.includes("Report: N/A"), false);
});

// 5. COMPONENTS V2 PUNISHMENT CENTER
test("COMPONENTS V2: buildPunishmentCenterContainer creates proper layout with Vital RP logo and version", () => {
  const container = buildPunishmentCenterContainer();
  assert.equal(container.type, 17); // CONTAINER

  // Section with Thumbnail
  const section = container.components.find((c) => c.type === 9);
  assert.ok(section);
  assert.match(section.components[0].content, /# ⚖️ Staff Punishment Center/);
  assert.equal(section.accessory.type, 11); // THUMBNAIL
  assert.match(section.accessory.media.url, /fivemanage\.com/);

  // Action row with 4 buttons
  const actionRow = container.components.find((c) => c.type === 1);
  assert.ok(actionRow);
  assert.equal(actionRow.components.length, 4);
  assert.equal(actionRow.components[0].custom_id, PunishmentCustomId.BTN_LOG);
  assert.equal(actionRow.components[1].custom_id, PunishmentCustomId.BTN_SEARCH);
  assert.equal(actionRow.components[2].custom_id, PunishmentCustomId.BTN_RECENT);
  assert.equal(actionRow.components[3].custom_id, PunishmentCustomId.BTN_MY_LOGS);

  // Footer
  const footer = container.components[container.components.length - 1];
  assert.equal(footer.type, 10);
  assert.ok(footer.content.includes(DAMO_BOT_VERSION));
});

// 6. GOOGLE SHEETS CLIENT (MOCKED)
test("SHEETS: initPunishmentSheet checks tabs and initializes headers without overwriting", async () => {
  const env = await createMockEnv();
  let addedSheets = [];
  let updatedValues = [];

  const mockFetch = async (url, options = {}) => {
    // Auth token endpoint
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token", expires_in: 3600 }));
    }
    // Metadata endpoint
    if (url.includes("fields=sheets.properties")) {
      return new Response(
        JSON.stringify({
          sheets: [{ properties: { title: "Referral Tracker", sheetId: 0 } }],
        })
      );
    }
    // Batch update to add sheets
    if (url.includes(":batchUpdate")) {
      const body = JSON.parse(options.body);
      addedSheets.push(...body.requests);
      return new Response(JSON.stringify({ replies: [] }));
    }
    // Values check / update
    if (url.includes("/values/")) {
      if (options.method === "PUT") {
        const body = JSON.parse(options.body);
        updatedValues.push(body);
        return new Response(JSON.stringify({ ok: true }));
      }
      // Check headers: returns empty
      return new Response(JSON.stringify({ values: [] }));
    }
    return new Response("OK");
  };

  const res = await initPunishmentSheet({ env, customFetch: mockFetch });
  assert.equal(res.success, true);
  assert.equal(addedSheets.length, 2); // Added "Punishment Logs" and "Punishment Audits"
  assert.equal(updatedValues.length, 2); // Initialized headers on both tabs
});

test("SHEETS: appendPunishmentRecord writes row with Pending status and CREATED audit entry", async () => {
  const env = await createMockEnv();
  let appendedLogs = null;
  let appendedAudit = null;

  const mockFetch = async (url, options = {}) => {
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    if (url.includes(":append")) {
      if (url.includes("Audit")) {
        appendedAudit = JSON.parse(options.body).values[0];
        return new Response(JSON.stringify({ ok: true }));
      }
      appendedLogs = JSON.parse(options.body).values[0];
      return new Response(
        JSON.stringify({
          updates: { updatedRange: "Punishment Logs!A42:P42" },
        })
      );
    }
    return new Response(JSON.stringify({ ok: true }));
  };

  const record = {
    punishmentId: "VRP-P-000042",
    createdAt: "2026-09-03T20:00:00.000Z",
    playerName: "Yamsheed Yaffari",
    playerDiscordId: "333552471588864013",
    punishment: "2 Day Ban",
    reason: "DM (with context)",
    reportUrl: "https://discord.com/report",
    responseUrl: "",
    staffName: "Big-Croissant-Chungus",
    staffDiscordId: "150580708144840704",
    guildId: "730015674348601384",
    logChannelId: "1249517344099668078",
  };

  const res = await appendPunishmentRecord({ env, record, customFetch: mockFetch });
  assert.equal(res.status, "SUCCESS");
  assert.equal(res.rowIndex, 42);

  // Check row values (19-column schema):
  assert.equal(appendedLogs[0], "VRP-P-000042");
  assert.equal(appendedLogs[2], "Yamsheed Yaffari");
  assert.equal(appendedLogs[3], "333552471588864013");
  assert.equal(appendedLogs[17], SyncStatus.PENDING);
  assert.equal(appendedLogs[18], "yamsheed yaffari"); // normalized

  // Check audit:
  assert.equal(appendedAudit[1], "VRP-P-000042");
  assert.equal(appendedAudit[2], AuditAction.CREATED);
});

test("SHEETS: searchPunishments correctly ranks exact ID > numeric ID > Discord ID > name > partial", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000001", "2026-08-01", "Alice Smith", "111111111111111111", "Warning", "OOC in active RP", "", "", "StaffA", "100", "", "", "", "", "Posted", "alice smith"],
    ["VRP-P-000142", "2026-08-15", "Yamsheed", "333552471588864013", "2 Day Ban", "DM", "", "", "Big-Croissant-Chungus", "150", "", "", "", "", "Posted", "yamsheed"],
    ["VRP-P-000143", "2026-08-20", "Yamsheed Junior", "444444444444444444", "Kick", "AFK", "", "", "StaffB", "200", "", "", "", "", "Posted", "yamsheed junior"],
  ];

  const mockFetch = async (url) => {
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    if (url.includes("/values/")) {
      return new Response(JSON.stringify({ values: mockRows }));
    }
    return new Response("OK");
  };

  // 1. Search full exact ID
  const resExact = await searchPunishments({ env, query: "VRP-P-000142", customFetch: mockFetch });
  assert.equal(resExact.length, 1);
  assert.equal(resExact[0].punishmentId, "VRP-P-000142");

  // 2. Search numeric ID
  const resNumeric = await searchPunishments({ env, query: "000142", customFetch: mockFetch });
  assert.equal(resNumeric.length, 1);
  assert.equal(resNumeric[0].punishmentId, "VRP-P-000142");

  // 3. Search Discord ID
  const resDiscordId = await searchPunishments({ env, query: "333552471588864013", customFetch: mockFetch });
  assert.equal(resDiscordId.length, 1);
  assert.equal(resDiscordId[0].playerName, "Yamsheed");

  // 4. Search partial name (exact "Yamsheed" comes before partial "Yamsheed Junior")
  const resPartial = await searchPunishments({ env, query: "Yamsheed", customFetch: mockFetch });
  assert.equal(resPartial.length, 2);
  assert.equal(resPartial[0].playerName, "Yamsheed"); // Exact match comes before partial "Yamsheed Junior"
});

test("SHEETS: getPlayerHistory uses Discord ID when present, falls back to name cleanly", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000001", "2026-08-01", "Manual User", "N/A", "Warning", "Fail RP", "", "", "StaffA", "100", "", "", "", "", "Posted", "manual user"],
    ["VRP-P-000002", "2026-08-02", "Discord User", "333552471588864013", "Kick", "Trolling", "", "", "StaffA", "100", "", "", "", "", "Posted", "discord user"],
  ];

  const mockFetch = async () => {
    return new Response(JSON.stringify({ values: mockRows }));
  };

  // Discord ID lookup
  const resDiscord = await getPlayerHistory({ env, discordIdOrName: "333552471588864013", customFetch: mockFetch });
  assert.equal(resDiscord.records.length, 1);
  assert.equal(resDiscord.isNameFallback, false);
  assert.equal(resDiscord.records[0].playerName, "Discord User");

  // Name fallback lookup
  const resName = await getPlayerHistory({ env, discordIdOrName: "Manual User", customFetch: mockFetch });
  assert.equal(resName.records.length, 1);
  assert.equal(resName.isNameFallback, true);
  assert.equal(resName.records[0].playerName, "Manual User");
});

test("SHEETS: getRecentPunishments and getMyPunishments return records newest first", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000001", "2026-08-01", "P1", "1", "W", "R", "", "", "Staff1", "101", "", "", "", "", "Posted", "p1"],
    ["VRP-P-000002", "2026-08-02", "P2", "2", "W", "R", "", "", "Staff2", "102", "", "", "", "", "Posted", "p2"],
    ["VRP-P-000003", "2026-08-03", "P3", "3", "W", "R", "", "", "Staff1", "101", "", "", "", "", "Posted", "p3"],
  ];

  const mockFetch = async () => new Response(JSON.stringify({ values: mockRows }));

  const recent = await getRecentPunishments({ env, limit: 2, customFetch: mockFetch });
  assert.equal(recent.length, 2);
  assert.equal(recent[0].punishmentId, "VRP-P-000003"); // Newest first

  const myLogs = await getMyPunishments({ env, staffDiscordId: "101", customFetch: mockFetch });
  assert.equal(myLogs.length, 2);
  assert.equal(myLogs[0].punishmentId, "VRP-P-000003");
  assert.equal(myLogs[1].punishmentId, "VRP-P-000001");
});

// 7. END-TO-END WORKFLOW & FAILURE RECOVERY
test("WORKFLOW: Submitting punishment modal allocates ID, appends to sheet, posts to Discord, updates status to Posted", async () => {
  const env = await createMockEnv();
  let discordPostedBody = null;
  let updatedStatus = null;

  // Mock global fetch for Discord API and Sheets API
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = url.toString();
    // Discord message post
    if (urlStr.includes("discord.com/api/v10/channels/1249517344099668078/messages")) {
      discordPostedBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "987654321012345678" }), { status: 201 });
    }
    // Google token
    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    // Google Sheets append
    if (urlStr.includes(":append")) {
      return new Response(JSON.stringify({ updates: { updatedRange: "Punishment Logs!A15:P15" } }));
    }
    // Google Sheets PUT update
    if (urlStr.includes("/values/") && options.method === "PUT") {
      updatedStatus = JSON.parse(options.body);
      return new Response(JSON.stringify({ ok: true }));
    }
    return new Response("OK");
  };

  try {
    const interaction = {
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "150580708144840704", username: "Big-Croissant-Chungus" },
        nick: "Big-Croissant-Chungus",
      },
      guild_id: "730015674348601384",
      data: {
        custom_id: `${PunishmentCustomId.MODAL_SUBMIT_PREFIX}333552471588864013`,
        components: [
          { components: [{ custom_id: "player_name", value: "Yamsheed Yaffari" }] },
          { components: [{ custom_id: "punishment", value: "2 Day Ban" }] },
          { components: [{ custom_id: "reason", value: "DM at black market" }] },
          { components: [{ custom_id: "report_url", value: "https://discord.com/report" }] },
          { components: [{ custom_id: "response_url", value: "" }] },
        ],
      },
    };

    const res = await handlePunishmentModalSubmit(interaction, env, {});
    const body = await res.json();

    // 1. Check response to staff
    assert.match(body.data.content, /Punishment Logged Successfully/);
    assert.match(body.data.content, /VRP-P-000001/);

    // 2. Check posted Discord message content (standard markdown in content)
    assert.ok(discordPostedBody);
    assert.match(discordPostedBody.content, /⚖️ \*\*Punishment Logged\*\* • `VRP-P-000001`/);
    assert.match(discordPostedBody.content, /Yamsheed Yaffari/);
    assert.match(discordPostedBody.content, /333552471588864013/);
    assert.match(discordPostedBody.content, /2 Day Ban/);
    assert.match(discordPostedBody.content, /DM at black market/);

    // 3. Check Discord buttons (Report then Player History)
    assert.equal(discordPostedBody.components[0].components[0].label, "Report");
    assert.equal(discordPostedBody.components[0].components[1].label, "Player History");

    // 4. Check sheet was updated with Posted status and Jump URL
    assert.ok(updatedStatus);
    assert.equal(updatedStatus.values[0][0], "987654321012345678"); // Message ID
    assert.match(updatedStatus.values[0][1], /channels\/730015674348601384\/1249517344099668078\/987654321012345678/); // Jump URL
    assert.equal(updatedStatus.values[0][2], SyncStatus.POSTED);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("FAILURE RECOVERY: Discord post failure leaves Sheet row marked Post Failed and gives friendly error", async () => {
  const env = await createMockEnv();
  let updatedStatus = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = url.toString();
    // Discord message post FAILS (e.g. 500 error)
    if (urlStr.includes("discord.com/api/v10/channels/1249517344099668078/messages")) {
      return new Response("Discord Service Unavailable", { status: 503 });
    }
    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    if (urlStr.includes(":append")) {
      return new Response(JSON.stringify({ updates: { updatedRange: "Punishment Logs!A20:P20" } }));
    }
    if (urlStr.includes("/values/") && options.method === "PUT") {
      updatedStatus = JSON.parse(options.body);
      return new Response(JSON.stringify({ ok: true }));
    }
    return new Response("OK");
  };

  try {
    const interaction = {
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "150580708144840704", username: "StaffDamon" },
      },
      guild_id: "730015674348601384",
      data: {
        custom_id: `${PunishmentCustomId.MODAL_SUBMIT_PREFIX}manual`,
        components: [
          { components: [{ custom_id: "player_name", value: "Offline Player" }] },
          { components: [{ custom_id: "player_discord_id", value: "N/A" }] },
          { components: [{ custom_id: "punishment", value: "Permanent Ban" }] },
          { components: [{ custom_id: "reason", value: "Exploiting" }] },
          { components: [{ custom_id: "report_url", value: "" }] },
        ],
      },
    };

    const res = await handlePunishmentModalSubmit(interaction, env, {});
    const body = await res.json();

    // 1. Staff receives friendly error notice with record ID
    assert.match(body.data.content, /Punishment Saved to Database, but Discord Post Failed/);
    assert.match(body.data.content, /Post Failed/);

    // 2. Google Sheet is marked Post Failed
    assert.ok(updatedStatus);
    assert.equal(updatedStatus.values[0][2], SyncStatus.POST_FAILED);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 8. USER CONTEXT COMMAND
test("USER CONTEXT COMMAND: Right click Punishment History returns player history ephemerally", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000010", "2026-08-10", "Target Player", "777888999000111222", "Warning", "VDM", "", "", "StaffDamon", "101", "", "", "", "", "Posted", "target player"],
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.toString().includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    return new Response(JSON.stringify({ values: mockRows }));
  };

  try {
    const interaction = {
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon" },
      },
      data: {
        target_id: "777888999000111222",
        resolved: {
          users: {
            "777888999000111222": {
              username: "TargetPlayer",
              global_name: "Target Player",
            },
          },
        },
      },
    };

    const res = await handleUserContextPunishmentHistory(interaction, env, {});
    const body = await res.json();

    assert.equal(body.data.flags, 32832); // EPHEMERAL | COMPONENTS_V2
    const container = body.data.components[0];
    assert.match(container.components[0].content, /PLAYER PUNISHMENT HISTORY/);
    assert.match(container.components[2].content, /VRP-P-000010/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 9. PRIVATE PUNISHMENT CENTER
test("PRIVATE CENTER: /logpunishment responds ephemerally without public posting", async () => {
  const env = await createMockEnv();
  const interaction = {
    member: {
      roles: [env.STAFF_TEAM_ROLE_ID],
      user: { id: "staff_damon" },
    },
  };

  const res = await handlePunishmentCommand(interaction, env, {});
  const body = await res.json();

  // Must be EPHEMERAL and Components V2
  assert.equal(body.data.flags, 32832); // 64 | 32768
  const container = body.data.components[0];
  assert.match(container.components[0].components[0].content, /Staff Punishment Center/);
  assert.equal(container.components[1].components.length, 4); // 4 buttons
});

// 10. EDIT RECORD WORKFLOW
test("EDIT RECORD: clicking Edit Record button returns modal pre-filled with existing data", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000142", "2026-09-03", "Yamsheed", "333552471588864013", "2 Day Ban", "DM at black market", "", "", "StaffDamon", "101", "7300", "1249", "999", "https://jump", "Posted", "yamsheed"],
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.toString().includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    return new Response(JSON.stringify({ values: mockRows }));
  };

  try {
    const interaction = {
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.BTN_EDIT_PREFIX}VRP-P-000142`,
      },
    };

    const res = await handlePunishmentComponent(interaction, env, {});
    const body = await res.json();

    assert.equal(body.type, 9); // MODAL
    assert.equal(body.data.title, "Edit Record (VRP-P-000142)");
    assert.equal(body.data.custom_id, "punish_modal_edit:VRP-P-000142");

    // Check pre-populated fields
    const comps = body.data.components;
    assert.equal(comps[0].components[0].value, "Yamsheed");
    assert.equal(comps[1].components[0].value, "2 Day Ban");
    assert.equal(comps[2].components[0].value, ""); // Punishment length was empty
    assert.equal(comps[3].components[0].value, "DM at black market");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("EDIT RECORD: submitting edit modal updates Google Sheet row, appends EDITED audit entry, and PATCHes Discord message", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000142", "2026-09-03T12:00:00.000Z", "Yamsheed", "333552471588864013", "2 Day Ban", "DM at black market", "", "", "StaffDamon", "101", "730015674348601384", "1249517344099668078", "999888777", "https://discord.com/channels/730015674348601384/1249517344099668078/999888777", "Posted", "yamsheed"],
  ];

  let patchedDiscordBody = null;
  let updatedSheetBody = null;
  let appendedAuditBody = null;
  let webhookPatchBody = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = url.toString();
    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    // Read sheet values
    if (urlStr.includes("/values/") && (!options.method || options.method === "GET")) {
      return new Response(JSON.stringify({ values: mockRows }));
    }
    // Update sheet row
    if (urlStr.includes("/values/") && options.method === "PUT") {
      updatedSheetBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ ok: true }));
    }
    // Append audit
    if (urlStr.includes(":append")) {
      appendedAuditBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ ok: true }));
    }
    // PATCH Discord channel message (#banwarnlog)
    if (urlStr.includes("discord.com/api/v10/channels/") && options.method === "PATCH") {
      patchedDiscordBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "999888777" }));
    }
    // Webhook PATCH (editOriginalInteractionResponse follow-up)
    if (urlStr.includes("/webhooks/") && options.method === "PATCH") {
      webhookPatchBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "mock_deferred" }));
    }
    return new Response("OK");
  };

  try {
    const interaction = {
      application_id: "124900000000000000",
      token: "mock_interaction_token",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "StaffDamon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.MODAL_EDIT_PREFIX}VRP-P-000142`,
        components: [
          { components: [{ custom_id: "player_name", value: "Yamsheed Yaffari" }] },
          { components: [{ custom_id: "punishment", value: "2 Day Ban" }] },
          { components: [{ custom_id: "punishment_length", value: "2 Days" }] },
          { components: [{ custom_id: "reason", value: "DM at black market (updated)" }] },
          { components: [{ custom_id: "report_url", value: "https://discord.com/report/123" }] },
        ],
      },
    };

    const promises = [];
    const ctx = { waitUntil: (p) => promises.push(p) };

    const res = await handlePunishmentModalSubmit(interaction, env, ctx);
    const body = await res.json();

    // 1. Immediate response must be deferred ephemeral (type 5)
    assert.equal(body.type, 5, "Must be Type 5 DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE");
    assert.equal(body.data.flags, 64, "Must be ephemeral");

    // 2. Await background task to complete
    await Promise.all(promises);

    // 3. Check Google Sheet row updated (19-column schema)
    assert.ok(updatedSheetBody);
    const row = updatedSheetBody.values[0];
    assert.equal(row[0], "VRP-P-000142"); // Same ID
    assert.equal(row[2], "Yamsheed Yaffari"); // Updated name
    assert.equal(row[4], "2 Day Ban");
    assert.equal(row[5], "2 Days"); // Length
    assert.equal(row[6], "DM at black market (updated)"); // Updated reason
    assert.equal(row[8], "https://discord.com/report/123"); // Newly added Report URL
    assert.equal(row[15], "999888777"); // Same message ID
    assert.match(row[16], /999888777/); // Same jump URL

    // 4. Check audit log entry
    assert.ok(appendedAuditBody);
    const auditRow = appendedAuditBody.values[0];
    assert.equal(auditRow[1], "VRP-P-000142");
    assert.equal(auditRow[2], AuditAction.EDITED);
    assert.match(auditRow[6], /Added Report URL/);

    // 5. Check original Discord message was PATCHed (not POSTed new)
    assert.ok(patchedDiscordBody);
    assert.match(patchedDiscordBody.content, /Yamsheed Yaffari/);
    assert.match(patchedDiscordBody.content, /\*\*Report:\*\* https:\/\/discord\.com\/report\/123/);
    // Now Report button is visible
    assert.equal(patchedDiscordBody.components[0].components[0].label, "Report");

    // 6. Check webhook PATCH delivered the success confirmation
    assert.ok(webhookPatchBody, "Webhook PATCH must be called for follow-up message");
    assert.match(webhookPatchBody.content, /Punishment Record Updated/);
    assert.match(webhookPatchBody.content, /VRP-P-000142/);
    assert.match(webhookPatchBody.content, /Added Report URL/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 11. SLASH COMMAND REGISTRATION SCHEMA
test("COMMAND REGISTRATION: /logpunishment registered and /punishment removed", () => {
  const logPunishmentCmd = commands.find((c) => c.name === "logpunishment");
  assert.ok(logPunishmentCmd, "/logpunishment command must be registered");
  assert.equal(logPunishmentCmd.description, "Open the staff Punishment Center.");
  assert.equal(logPunishmentCmd.type, 1);

  const obsoleteCmd = commands.find((c) => c.name === "punishment");
  assert.equal(obsoleteCmd, undefined, "Obsolete /punishment command must NOT be registered");

  const contextCmd = commands.find((c) => c.name === "Punishment History");
  assert.ok(contextCmd, "Punishment History context command must be present");
  assert.equal(contextCmd.type, 2); // USER context command
});

// 12. SEARCH RESULT PRIVACY TESTS
test("PRIVACY: Search History, Recent Logs, My Logs, and Player History responses are strictly ephemeral", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000001", "2026-09-03", "Yamsheed", "333552471588864013", "2 Day Ban", "DM", "", "", "StaffDamon", "101", "", "", "", "", "Posted", "yamsheed"],
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.toString().includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    return new Response(JSON.stringify({ values: mockRows }));
  };

  try {
    const staffInteraction = (customId) => ({
      member: { roles: [env.STAFF_TEAM_ROLE_ID], user: { id: "101" } },
      data: { custom_id: customId },
    });

    // Recent Logs button
    const recentPromises = [];
    const recentRes = await handlePunishmentComponent(
      staffInteraction(PunishmentCustomId.BTN_RECENT),
      env,
      { waitUntil: (p) => recentPromises.push(p) }
    );
    const recentBody = await recentRes.json();
    assert.equal(recentBody.data.flags, 32832, "Recent Logs must be EPHEMERAL");
    await Promise.all(recentPromises);

    // My Logs button
    const myLogsRes = await handlePunishmentComponent(staffInteraction(PunishmentCustomId.BTN_MY_LOGS), env, {});
    const myLogsBody = await myLogsRes.json();
    assert.equal(myLogsBody.data.flags, 32832, "My Logs must be EPHEMERAL");

    // Player History button
    const histRes = await handlePunishmentComponent(staffInteraction(`${PunishmentCustomId.BTN_PLAYER_HISTORY_PREFIX}333552471588864013`), env, {});
    const histBody = await histRes.json();
    assert.equal(histBody.data.flags, 32832, "Player History must be EPHEMERAL");

    // Search Query modal submit
    const searchModalInteraction = {
      member: { roles: [env.STAFF_TEAM_ROLE_ID], user: { id: "101" } },
      data: {
        custom_id: PunishmentCustomId.MODAL_SEARCH,
        components: [
          { components: [{ custom_id: "search_query", value: "Yamsheed" }] },
        ],
      },
    };
    const searchRes = await handlePunishmentModalSubmit(searchModalInteraction, env, {});
    const searchBody = await searchRes.json();
    assert.equal(searchBody.data.flags, 32832, "Search History results must be EPHEMERAL");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 13. OPTIONAL URLS: NEITHER URL PROVIDED
test("OPTIONAL URLS: punishment created without either URL omits Report and Response lines and buttons", async () => {
  const env = await createMockEnv();
  const originalFetch = globalThis.fetch;
  let postedDiscordBody = null;

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = url.toString();
    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    if (urlStr.includes(":append")) {
      return new Response(JSON.stringify({ updates: { updatedRange: "'Punishment Logs'!A2:P2" } }));
    }
    if (urlStr.includes("/values/") && options.method === "PUT") {
      return new Response(JSON.stringify({ ok: true }));
    }
    if (urlStr.includes("discord.com/api/v10/channels/")) {
      postedDiscordBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "111222333" }));
    }
    return new Response("OK");
  };

  try {
    const interaction = {
      guild_id: "730015674348601384",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "StaffDamon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.MODAL_SUBMIT_PREFIX}manual`,
        components: [
          { components: [{ custom_id: "player_name", value: "Lone Wolf" }] },
          { components: [{ custom_id: "player_discord_id", value: "" }] },
          { components: [{ custom_id: "punishment", value: "Warning" }] },
          { components: [{ custom_id: "reason", value: "Minor traffic rule violation" }] },
          { components: [{ custom_id: "report_url", value: "" }] },
          { components: [{ custom_id: "response_url", value: "" }] },
        ],
      },
    };

    const res = await handlePunishmentModalSubmit(interaction, env, {});
    const body = await res.json();
    assert.match(body.data.content, /Punishment Logged Successfully/);

    // Verify discord posted message
    assert.ok(postedDiscordBody);
    // Does NOT contain Report: or Response: lines
    assert.ok(!postedDiscordBody.content.includes("**Report:**"));
    assert.ok(!postedDiscordBody.content.includes("**Response:**"));
    assert.ok(!postedDiscordBody.content.includes("Report: N/A"));
    assert.ok(!postedDiscordBody.content.includes("Response: N/A"));

    // Action row only contains [ Player History ], NO Report or Response buttons
    assert.equal(postedDiscordBody.components.length, 1);
    const actionRowButtons = postedDiscordBody.components[0].components;
    assert.equal(actionRowButtons.length, 1);
    assert.equal(actionRowButtons[0].label, "Player History");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 14. EDITING: ADDING BOTH URLS LATER
test("EDITING: Adding both Report URL and Response URL updates sheet, audit, and PATCHes Discord message with both buttons", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000500", "2026-09-03T12:00:00.000Z", "Speedy Gonzales", "444555666", "1 Day Ban", "Speed hacking", "", "", "StaffDamon", "101", "730015674348601384", "1249517344099668078", "555666777", "https://discord.com/channels/730015674348601384/1249517344099668078/555666777", "Posted", "speedy gonzales"],
  ];

  let patchedDiscordBody = null;
  let updatedSheetRow = null;
  let appendedAuditRow = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = url.toString();
    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    if (urlStr.includes("/values/") && (!options.method || options.method === "GET")) {
      return new Response(JSON.stringify({ values: mockRows }));
    }
    if (urlStr.includes("/values/") && options.method === "PUT") {
      updatedSheetRow = JSON.parse(options.body).values[0];
      return new Response(JSON.stringify({ ok: true }));
    }
    if (urlStr.includes(":append")) {
      appendedAuditRow = JSON.parse(options.body).values[0];
      return new Response(JSON.stringify({ ok: true }));
    }
    if (urlStr.includes("discord.com/api/v10/channels/") && options.method === "PATCH") {
      patchedDiscordBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "555666777" }));
    }
    if (urlStr.includes("/webhooks/") && options.method === "PATCH") {
      return new Response(JSON.stringify({ id: "mock_deferred" }));
    }
    return new Response("OK");
  };

  try {
    const interaction = {
      application_id: "124900000000000000",
      token: "mock_interaction_token",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "StaffDamon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.MODAL_EDIT_PREFIX}VRP-P-000500`,
        components: [
          { components: [{ custom_id: "player_name", value: "Speedy Gonzales" }] },
          { components: [{ custom_id: "punishment", value: "1 Day Ban" }] },
          { components: [{ custom_id: "reason", value: "Speed hacking (confirmed video)" }] },
          { components: [{ custom_id: "report_url", value: "https://discord.com/channels/123/report" }] },
          { components: [{ custom_id: "response_url", value: "https://discord.com/channels/123/response" }] },
        ],
      },
    };

    const promises = [];
    const ctx = { waitUntil: (p) => promises.push(p) };

    const res = await handlePunishmentModalSubmit(interaction, env, ctx);
    const body = await res.json();
    assert.equal(body.type, 5, "Must be Type 5 DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE");

    // Await background task
    await Promise.all(promises);

    // 1. Google Sheet updated in place
    assert.ok(updatedSheetRow);
    assert.equal(updatedSheetRow[0], "VRP-P-000500");
    assert.equal(updatedSheetRow[8], "https://discord.com/channels/123/report");
    assert.equal(updatedSheetRow[9], "https://discord.com/channels/123/response");
    assert.equal(updatedSheetRow[15], "555666777"); // Original message ID preserved

    // 2. EDITED audit entry logged
    assert.ok(appendedAuditRow);
    assert.equal(appendedAuditRow[1], "VRP-P-000500");
    assert.equal(appendedAuditRow[2], "EDITED");
    assert.match(appendedAuditRow[6], /Report URL/);
    assert.match(appendedAuditRow[6], /Response URL/);

    // 3. Discord message PATCHed with both buttons: Report, Response, Player History
    assert.ok(patchedDiscordBody);
    assert.match(patchedDiscordBody.content, /\*\*Report:\*\* https:\/\/discord\.com\/channels\/123\/report/);
    assert.match(patchedDiscordBody.content, /\*\*Response:\*\* https:\/\/discord\.com\/channels\/123\/response/);

    const buttons = patchedDiscordBody.components[0].components;
    assert.equal(buttons.length, 3);
    assert.equal(buttons[0].label, "Report");
    assert.equal(buttons[1].label, "Response");
    assert.equal(buttons[2].label, "Player History");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 15. PUBLIC LOG FORMAT & OPTIONAL FIELDS
test("PUBLIC LOG FORMAT: matches redesigned compact layout with bold, blockquote, and muted footers", () => {
  const record = {
    punishmentId: "VRP-P-000001",
    playerName: "NNEZZIE",
    playerDiscordId: "323896916347715584",
    punishment: "VDM",
    punishmentLength: "2 Days",
    reason: "VDM'd Damon",
    additionalInfo: "Black market scene, immediate action taken.",
    reportUrl: "https://discord.com/channels/730015674348601384/1249517344099668078/111",
    responseUrl: "https://discord.com/channels/730015674348601384/1249517344099668078/222",
    evidenceImageUrl: "https://cdn.discordapp.com/attachments/123/456/proof.png",
    staffName: "damon",
    staffDiscordId: "150580708144840704",
    createdAt: "2026-09-03T23:00:00.000Z",
  };

  const output = formatPunishmentLog(record);

  // 1. Punishment ID near the top
  assert.match(output, /⚖️ \*\*Punishment Logged\*\* • `VRP-P-000001`/);

  // 2. Player name and ID near the top
  assert.match(output, /\*\*NNEZZIE\*\* • `323896916347715584`/);

  // 3. Punishment and Length easy to scan
  assert.match(output, /\*\*Punishment:\*\* VDM/);
  assert.match(output, /\*\*Length:\*\* 2 Days/);

  // 4. Reason in a blockquote
  assert.match(output, /> VDM'd Damon/);

  // 5. Additional Info
  assert.match(output, /\*\*Additional Info:\*\* Black market scene, immediate action taken\./);

  // 6. Report and Response links
  assert.match(output, /\*\*Report:\*\* https:\/\/discord\.com\/channels/);
  assert.match(output, /\*\*Response:\*\* https:\/\/discord\.com\/channels/);

  // 7. Muted footer-style text with logged by and staff ID
  assert.match(output, /-# Logged by \*\*damon\*\* • /);
  assert.match(output, /-# Staff ID: `150580708144840704`/);

  // 8. Buttons
  const rows = createPunishmentActionRow(record);
  assert.equal(rows.length, 1);
  const buttons = rows[0].components;
  assert.equal(buttons.length, 4);
  assert.equal(buttons[0].label, "Report");
  assert.equal(buttons[1].label, "Response");
  assert.equal(buttons[2].label, "Evidence");
  assert.equal(buttons[3].label, "Player History");

  // 9. Embeds
  const embeds = formatPunishmentEmbeds(record);
  assert.equal(embeds.length, 1);
  assert.equal(embeds[0].image.url, "https://cdn.discordapp.com/attachments/123/456/proof.png");
});

test("PUBLIC LOG FORMAT: omits optional fields cleanly without placeholders like N/A, None, or blank labels", () => {
  const record = {
    punishmentId: "VRP-P-000002",
    playerName: "CleanPlayer",
    playerDiscordId: "",
    punishment: "Warning",
    punishmentLength: "",
    reason: "Minor infraction",
    additionalInfo: "",
    reportUrl: "",
    responseUrl: "",
    evidenceImageUrl: "",
    staffName: "StaffMod",
    staffDiscordId: "999888777",
    createdAt: "2026-09-03T18:00:00.000Z",
  };

  const output = formatPunishmentLog(record);

  // Must not have empty placeholders
  assert.equal(output.includes("Length:"), false);
  assert.equal(output.includes("Additional Info:"), false);
  assert.equal(output.includes("Report:"), false);
  assert.equal(output.includes("Response:"), false);
  assert.equal(output.includes("None"), false);
  assert.equal(output.includes("N/A"), false);
  assert.equal(output.includes("undefined"), false);
  assert.equal(output.includes("null"), false);

  // Must still include core fields
  assert.match(output, /⚖️ \*\*Punishment Logged\*\* • `VRP-P-000002`/);
  assert.match(output, /\*\*CleanPlayer\*\*/);
  assert.match(output, /\*\*Punishment:\*\* Warning/);
  assert.match(output, /> Minor infraction/);
  assert.match(output, /-# Logged by \*\*StaffMod\*\*/);

  // Only Player History button
  const rows = createPunishmentActionRow(record);
  assert.equal(rows[0].components.length, 1);
  assert.equal(rows[0].components[0].label, "Player History");

  // No image embed
  const embeds = formatPunishmentEmbeds(record);
  assert.equal(embeds.length, 0);
});

// 16. IMAGE ATTACHMENT / EVIDENCE SUPPORT
test("IMAGE ATTACHMENT: creation flow resolves attachment and embeds in Discord post & sheet", async () => {
  const env = await createMockEnv();
  let postedDiscordBody = null;
  let appendedSheetValues = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = url.toString();
    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    if (urlStr.includes(":append")) {
      if (!urlStr.includes("Audit")) {
        appendedSheetValues = JSON.parse(options.body).values[0];
      }
      return new Response(JSON.stringify({ ok: true }));
    }
    if (urlStr.includes("/values/") && (!options.method || options.method === "GET")) {
      return new Response(JSON.stringify({ values: [] }));
    }
    if (urlStr.includes("discord.com/api/v10/channels/")) {
      postedDiscordBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "123456789012" }));
    }
    return new Response("OK");
  };

  try {
    const interaction = {
      guild_id: "730015674348601384",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "StaffDamon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.MODAL_SUBMIT_PREFIX}333552471588864013`,
        components: [
          { components: [{ custom_id: "player_name", value: "ImageTestPlayer" }] },
          { components: [{ custom_id: "punishment", value: "2 Day Ban" }] },
          { components: [{ custom_id: "punishment_length", value: "2 Days" }] },
          { components: [{ custom_id: "reason", value: "Car ramming with screenshot proof" }] },
          { components: [{ custom_id: "additional_info", value: "Player admitted in DMs" }] },
        ],
        resolved: {
          attachments: {
            "att_999": {
              id: "att_999",
              filename: "ramming_proof.png",
              url: "https://cdn.discordapp.com/attachments/1249517344099668078/att_999/ramming_proof.png",
            },
          },
        },
      },
    };

    const res = await handlePunishmentModalSubmit(interaction, env, {});
    assert.equal(res.status, 200);

    // Verify sheet row stored the image URL at index 10
    assert.ok(appendedSheetValues);
    assert.equal(appendedSheetValues[5], "2 Days"); // Length
    assert.equal(appendedSheetValues[7], "Player admitted in DMs"); // Additional info
    assert.equal(appendedSheetValues[10], "https://cdn.discordapp.com/attachments/1249517344099668078/att_999/ramming_proof.png"); // Image URL

    // Verify Discord post has image embed and searchable text
    assert.ok(postedDiscordBody);
    assert.match(postedDiscordBody.content, /\*\*Length:\*\* 2 Days/);
    assert.match(postedDiscordBody.content, /\*\*Additional Info:\*\* Player admitted in DMs/);
    assert.equal(postedDiscordBody.embeds.length, 1);
    assert.equal(postedDiscordBody.embeds[0].image.url, "https://cdn.discordapp.com/attachments/1249517344099668078/att_999/ramming_proof.png");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 17. EDITING: LINKS & EVIDENCE MODAL WORKFLOW
test("EDITING: punish_links button opens buildEditLinksModal and submitting updates links, evidence, and additional info", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000888", "2026-09-03T12:00:00.000Z", "LinksPlayer", "333444555", "Warning", "", "Minor issue", "", "", "", "", "StaffDamon", "101", "730015674348601384", "1249517344099668078", "888999000", "https://discord.com/channels/730015674348601384/1249517344099668078/888999000", "Posted", "linksplayer"],
  ];

  let patchedDiscordBody = null;
  let updatedSheetRow = null;
  let appendedAuditRow = null;
  let webhookPatchBody = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = url.toString();
    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    if (urlStr.includes("/values/") && (!options.method || options.method === "GET")) {
      return new Response(JSON.stringify({ values: mockRows }));
    }
    if (urlStr.includes("/values/") && options.method === "PUT") {
      updatedSheetRow = JSON.parse(options.body).values[0];
      return new Response(JSON.stringify({ ok: true }));
    }
    if (urlStr.includes(":append")) {
      appendedAuditRow = JSON.parse(options.body).values[0];
      return new Response(JSON.stringify({ ok: true }));
    }
    if (urlStr.includes("discord.com/api/v10/channels/") && options.method === "PATCH") {
      patchedDiscordBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "888999000" }));
    }
    if (urlStr.includes("/webhooks/") && options.method === "PATCH") {
      webhookPatchBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "mock_deferred" }));
    }
    return new Response("OK");
  };

  try {
    // 1. Button click: punish_links:VRP-P-000888 opens modal
    const buttonInteraction = {
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.BTN_LINKS_PREFIX}VRP-P-000888`,
      },
    };

    const modalRes = await handlePunishmentComponent(buttonInteraction, env, {});
    const modalBody = await modalRes.json();
    assert.equal(modalBody.type, 9); // MODAL
    assert.equal(modalBody.data.custom_id, `${PunishmentCustomId.MODAL_LINKS_PREFIX}VRP-P-000888`);
    assert.equal(modalBody.data.components.length, 4); // report_url, response_url, evidence_image_url, additional_info

    // 2. Submit modal with evidence image and additional info
    const submitInteraction = {
      application_id: "124900000000000000",
      token: "mock_interaction_token",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "StaffDamon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.MODAL_LINKS_PREFIX}VRP-P-000888`,
        components: [
          { components: [{ custom_id: "report_url", value: "https://discord.com/channels/7300/1249/rep" }] },
          { components: [{ custom_id: "response_url", value: "https://discord.com/channels/7300/1249/resp" }] },
          { components: [{ custom_id: "evidence_image_url", value: "https://imgur.com/screenshot.png" }] },
          { components: [{ custom_id: "additional_info", value: "Context added during staff review" }] },
        ],
      },
    };

    const promises = [];
    const ctx = { waitUntil: (p) => promises.push(p) };

    const submitRes = await handlePunishmentModalSubmit(submitInteraction, env, ctx);
    const submitBody = await submitRes.json();
    assert.equal(submitBody.type, 5, "Must be Type 5 DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE");

    // Await background task
    await Promise.all(promises);

    assert.ok(webhookPatchBody, "Webhook PATCH must be called for follow-up message");
    assert.match(webhookPatchBody.content, /Punishment Record Updated/);

    // 3. Verify Sheet updated in place
    assert.ok(updatedSheetRow);
    assert.equal(updatedSheetRow[7], "Context added during staff review"); // Additional info
    assert.equal(updatedSheetRow[8], "https://discord.com/channels/7300/1249/rep"); // Report URL
    assert.equal(updatedSheetRow[9], "https://discord.com/channels/7300/1249/resp"); // Response URL
    assert.equal(updatedSheetRow[10], "https://imgur.com/screenshot.png"); // Evidence Image URL
    assert.equal(updatedSheetRow[15], "888999000"); // Original message ID preserved

    // 4. Verify Audit row appended
    assert.ok(appendedAuditRow);
    assert.equal(appendedAuditRow[1], "VRP-P-000888");
    assert.equal(appendedAuditRow[2], "EDITED");
    assert.match(appendedAuditRow[6], /evidence image/i);
    assert.match(appendedAuditRow[6], /additional information/i);

    // 5. Verify Discord message PATCHed with new links, additional info, and image embed
    assert.ok(patchedDiscordBody);
    assert.match(patchedDiscordBody.content, /\*\*Additional Info:\*\* Context added during staff review/);
    assert.match(patchedDiscordBody.content, /\*\*Report:\*\* https:\/\/discord\.com\/channels\/7300\/1249\/rep/);
    assert.equal(patchedDiscordBody.embeds.length, 1);
    assert.equal(patchedDiscordBody.embeds[0].image.url, "https://imgur.com/screenshot.png");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("EDITING: buildEditLinksModal produces modern Label layout with native FileUpload component", () => {
  const record = {
    punishmentId: "VRP-P-000999",
    reportUrl: "https://discord.com/channels/7300/1249/report1",
    responseUrl: "https://discord.com/channels/7300/1249/resp1",
    evidenceImageUrl: "https://cdn.discordapp.com/attachments/123/old.png",
    additionalInfo: "Existing note",
  };

  const modal = buildEditLinksModal(record);
  assert.equal(modal.title, "Links & Evidence (VRP-P-000999)");
  assert.equal(modal.custom_id, `${PunishmentCustomId.MODAL_LINKS_PREFIX}VRP-P-000999`);
  assert.equal(modal.components.length, 4);

  // Field 0: Report URL wrapped in Label
  assert.equal(modal.components[0].type, ComponentType.LABEL);
  assert.equal(modal.components[0].label, "Report / Ticket Reference (Optional)");
  assert.equal(modal.components[0].component.type, ComponentType.TEXT_INPUT);
  assert.equal(modal.components[0].component.custom_id, "report_url");
  assert.equal(modal.components[0].component.value, "https://discord.com/channels/7300/1249/report1");

  // Field 1: Response URL wrapped in Label
  assert.equal(modal.components[1].type, ComponentType.LABEL);
  assert.equal(modal.components[1].label, "Player Response URL (Optional)");
  assert.equal(modal.components[1].component.type, ComponentType.TEXT_INPUT);
  assert.equal(modal.components[1].component.custom_id, "response_url");
  assert.equal(modal.components[1].component.value, "https://discord.com/channels/7300/1249/resp1");

  // Field 2: Native File Upload wrapped in Label
  assert.equal(modal.components[2].type, ComponentType.LABEL);
  assert.equal(modal.components[2].label, "Evidence Screenshot / Photo (Optional)");
  assert.equal(modal.components[2].component.type, ComponentType.FILE_UPLOAD);
  assert.equal(modal.components[2].component.custom_id, "evidence_image");
  assert.equal(modal.components[2].component.min_values, 0);
  assert.equal(modal.components[2].component.max_values, 1);
  assert.equal(modal.components[2].component.required, false);

  // Field 3: Additional Info wrapped in Label
  assert.equal(modal.components[3].type, ComponentType.LABEL);
  assert.equal(modal.components[3].label, "Additional Information (Optional)");
  assert.equal(modal.components[3].component.type, ComponentType.TEXT_INPUT);
  assert.equal(modal.components[3].component.custom_id, "additional_info");
  assert.equal(modal.components[3].component.value, "Existing note");
});

test("EDITING: submitting buildEditLinksModal with resolved attachment uploads photo and updates record", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000888", "2026-09-03T12:00:00.000Z", "LinksPlayer", "333444555", "Warning", "", "Minor issue", "", "", "", "", "StaffDamon", "101", "730015674348601384", "1249517344099668078", "888999000", "https://discord.com/channels/730015674348601384/1249517344099668078/888999000", "Posted", "linksplayer"],
  ];

  let patchedDiscordBody = null;
  let updatedSheetRow = null;
  let webhookPatchBody = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = url.toString();
    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    if (urlStr.includes("/values/") && (!options.method || options.method === "GET")) {
      return new Response(JSON.stringify({ values: mockRows }));
    }
    if (urlStr.includes("/values/") && options.method === "PUT") {
      updatedSheetRow = JSON.parse(options.body).values[0];
      return new Response(JSON.stringify({ ok: true }));
    }
    if (urlStr.includes(":append")) {
      return new Response(JSON.stringify({ ok: true }));
    }
    if (urlStr.includes("discord.com/api/v10/channels/") && options.method === "PATCH") {
      patchedDiscordBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "888999000" }));
    }
    if (urlStr.includes("/webhooks/") && options.method === "PATCH") {
      webhookPatchBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "mock_deferred" }));
    }
    return new Response("OK");
  };

  try {
    const submitInteraction = {
      application_id: "124900000000000000",
      token: "mock_interaction_token",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "StaffDamon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.MODAL_LINKS_PREFIX}VRP-P-000888`,
        components: [
          { type: 18, component: { custom_id: "report_url", value: "https://discord.com/channels/7300/1249/report_new" } },
          { type: 18, component: { custom_id: "response_url", value: "https://discord.com/channels/7300/1249/resp_new" } },
          { type: 18, component: { type: 19, custom_id: "evidence_image", values: ["att_drag_drop_12345"] } },
          { type: 18, component: { custom_id: "additional_info", value: "Updated with photo proof" } },
        ],
        resolved: {
          attachments: {
            att_drag_drop_12345: {
              id: "att_drag_drop_12345",
              filename: "evidence_screenshot.png",
              size: 512000,
              url: "https://cdn.discordapp.com/attachments/1249/evidence_screenshot.png",
              proxy_url: "https://media.discordapp.net/attachments/1249/evidence_screenshot.png",
            },
          },
        },
      },
    };

    const promises = [];
    const ctx = { waitUntil: (p) => promises.push(p) };

    const submitRes = await handlePunishmentModalSubmit(submitInteraction, env, ctx);
    const submitBody = await submitRes.json();
    assert.equal(submitBody.type, 5);

    await Promise.all(promises);

    assert.ok(updatedSheetRow);
    assert.equal(updatedSheetRow[7], "Updated with photo proof"); // Additional info
    assert.equal(updatedSheetRow[8], "https://discord.com/channels/7300/1249/report_new"); // Report URL
    assert.equal(updatedSheetRow[9], "https://discord.com/channels/7300/1249/resp_new"); // Response URL
    assert.equal(updatedSheetRow[10], "https://cdn.discordapp.com/attachments/1249/evidence_screenshot.png"); // Photo upload

    assert.ok(patchedDiscordBody);
    assert.equal(patchedDiscordBody.embeds[0].image.url, "https://cdn.discordapp.com/attachments/1249/evidence_screenshot.png");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("EDITING: getModalValues handles modern Label components, legacy ActionRows, and multi-values", () => {
  const modernComponents = [
    { type: 18, component: { custom_id: "player_name", value: "Yamsheed" } },
    { type: 18, component: { type: 19, custom_id: "evidence_image", values: ["att_001", "att_002"] } },
  ];
  const modernValues = getModalValues(modernComponents);
  assert.equal(modernValues.player_name, "Yamsheed");
  assert.deepEqual(modernValues.evidence_image, ["att_001", "att_002"]);

  const legacyComponents = [
    { components: [{ custom_id: "reason", value: "Combat logging" }] },
    { components: [{ custom_id: "tags", values: ["tag1", "tag2"] }] },
  ];
  const legacyValues = getModalValues(legacyComponents);
  assert.equal(legacyValues.reason, "Combat logging");
  assert.deepEqual(legacyValues.tags, ["tag1", "tag2"]);
});

test("EDITING: submitting modal with no changes returns No Changes Detected without touching Sheet or Audit", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000888", "2026-09-03T12:00:00.000Z", "LinksPlayer", "333444555", "Warning", "", "Minor issue", "", "", "", "", "StaffDamon", "101", "730015674348601384", "1249517344099668078", "888999000", "https://discord.com/channels/730015674348601384/1249517344099668078/888999000", "Posted", "linksplayer"],
  ];

  let sheetPutCalled = false;
  let auditAppendCalled = false;
  let webhookPatchBody = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = url.toString();
    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    if (urlStr.includes("/values/") && (!options.method || options.method === "GET")) {
      return new Response(JSON.stringify({ values: mockRows }));
    }
    if (urlStr.includes("/values/") && options.method === "PUT") {
      sheetPutCalled = true;
      return new Response(JSON.stringify({ ok: true }));
    }
    if (urlStr.includes(":append")) {
      auditAppendCalled = true;
      return new Response(JSON.stringify({ ok: true }));
    }
    if (urlStr.includes("/webhooks/") && options.method === "PATCH") {
      webhookPatchBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "mock_deferred" }));
    }
    return new Response("OK");
  };

  try {
    const interaction = {
      application_id: "124900000000000000",
      token: "mock_interaction_token",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "StaffDamon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.MODAL_EDIT_PREFIX}VRP-P-000888`,
        components: [
          { components: [{ custom_id: "player_name", value: "LinksPlayer" }] },
          { components: [{ custom_id: "punishment", value: "Warning" }] },
          { components: [{ custom_id: "punishment_length", value: "" }] },
          { components: [{ custom_id: "reason", value: "Minor issue" }] },
        ],
      },
    };

    const promises = [];
    const ctx = { waitUntil: (p) => promises.push(p) };

    const res = await handlePunishmentModalSubmit(interaction, env, ctx);
    const body = await res.json();
    assert.equal(body.type, 5);

    await Promise.all(promises);

    assert.equal(sheetPutCalled, false, "Google Sheets row must NOT be PUT when no fields changed");
    assert.equal(auditAppendCalled, false, "Audit row must NOT be appended when no fields changed");
    assert.ok(webhookPatchBody);
    assert.match(webhookPatchBody.content, /No Changes Detected/);
    assert.match(webhookPatchBody.content, /VRP-P-000888/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("EDITING: modal submit with Google Sheets error reports clean failure to staff without hanging Discord", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000888", "2026-09-03T12:00:00.000Z", "LinksPlayer", "333444555", "Warning", "", "Minor issue", "", "", "", "", "StaffDamon", "101", "730015674348601384", "1249517344099668078", "888999000", "https://discord.com/channels/730015674348601384/1249517344099668078/888999000", "Posted", "linksplayer"],
  ];

  let webhookPatchBody = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = url.toString();
    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    if (urlStr.includes("/values/") && (!options.method || options.method === "GET")) {
      return new Response(JSON.stringify({ values: mockRows }));
    }
    if (urlStr.includes("/values/") && options.method === "PUT") {
      return new Response("Internal Sheet Error", { status: 500 });
    }
    if (urlStr.includes("/webhooks/") && options.method === "PATCH") {
      webhookPatchBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "mock_deferred" }));
    }
    return new Response("OK");
  };

  try {
    const interaction = {
      application_id: "124900000000000000",
      token: "mock_interaction_token",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "StaffDamon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.MODAL_EDIT_PREFIX}VRP-P-000888`,
        components: [
          { components: [{ custom_id: "player_name", value: "LinksPlayer" }] },
          { components: [{ custom_id: "punishment", value: "Warning" }] },
          { components: [{ custom_id: "reason", value: "Updated reason for failure test" }] },
        ],
      },
    };

    const promises = [];
    const ctx = { waitUntil: (p) => promises.push(p) };

    const res = await handlePunishmentModalSubmit(interaction, env, ctx);
    const body = await res.json();
    assert.equal(body.type, 5);

    await Promise.all(promises);

    assert.ok(webhookPatchBody);
    assert.match(webhookPatchBody.content, /Failed to update punishment/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("EDITING: modal submit with audit log failure still updates Sheet/Discord and sends warning to staff", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000888", "2026-09-03T12:00:00.000Z", "LinksPlayer", "333444555", "Warning", "", "Minor issue", "", "", "", "", "StaffDamon", "101", "730015674348601384", "1249517344099668078", "888999000", "https://discord.com/channels/730015674348601384/1249517344099668078/888999000", "Posted", "linksplayer"],
  ];

  let sheetPutCalled = false;
  let patchedDiscordBody = null;
  let webhookPatchBody = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = url.toString();
    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    if (urlStr.includes("/values/") && (!options.method || options.method === "GET")) {
      return new Response(JSON.stringify({ values: mockRows }));
    }
    if (urlStr.includes("/values/") && options.method === "PUT") {
      sheetPutCalled = true;
      return new Response(JSON.stringify({ ok: true }));
    }
    if (urlStr.includes(":append")) {
      return new Response("Audit Append Unavailable", { status: 503 });
    }
    if (urlStr.includes("discord.com/api/v10/channels/") && options.method === "PATCH") {
      patchedDiscordBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "888999000" }));
    }
    if (urlStr.includes("/webhooks/") && options.method === "PATCH") {
      webhookPatchBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "mock_deferred" }));
    }
    return new Response("OK");
  };

  try {
    const interaction = {
      application_id: "124900000000000000",
      token: "mock_interaction_token",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "StaffDamon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.MODAL_EDIT_PREFIX}VRP-P-000888`,
        components: [
          { components: [{ custom_id: "player_name", value: "LinksPlayer" }] },
          { components: [{ custom_id: "punishment", value: "Warning" }] },
          { components: [{ custom_id: "reason", value: "New reason despite audit failure" }] },
        ],
      },
    };

    const promises = [];
    const ctx = { waitUntil: (p) => promises.push(p) };

    const res = await handlePunishmentModalSubmit(interaction, env, ctx);
    const body = await res.json();
    assert.equal(body.type, 5);

    await Promise.all(promises);

    assert.equal(sheetPutCalled, true, "Sheet must be updated even if audit fails");
    assert.ok(patchedDiscordBody, "Discord message must be updated");
    assert.ok(webhookPatchBody);
    assert.match(webhookPatchBody.content, /Audit Warning/);
    assert.match(webhookPatchBody.content, /VRP-P-000888/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 18. SEARCH RESULTS COMPACT CARDS
test("SEARCH RESULTS: buildSearchResultsContainer formats compact cards with length, blockquote, and hint tags", () => {
  const records = [
    {
      punishmentId: "VRP-P-000001",
      playerName: "NNEZZIE",
      punishment: "VDM",
      punishmentLength: "2 Days",
      reason: "VDM'd Damon",
      additionalInfo: "Black market scene",
      evidenceImageUrl: "https://cdn.discordapp.com/attachments/123/proof.png",
      staffName: "damon",
      createdAt: "2026-09-03T23:00:00.000Z",
    },
  ];

  const container = buildSearchResultsContainer({
    records,
    subtitle: "Player: NNEZZIE",
  });
  assert.equal(container.type, 17); // Container

  // Find the text card
  const cardTextDisplay = container.components.find(
    (c) => c.type === 10 && c.content?.includes("VRP-P-000001")
  );
  assert.ok(cardTextDisplay);
  assert.match(cardTextDisplay.content, /\*\*VRP-P-000001\*\* • \*\*VDM\*\*/);
  assert.match(cardTextDisplay.content, /2 Days • /);
  assert.match(cardTextDisplay.content, /> VDM'd Damon/);
  assert.match(cardTextDisplay.content, /-# Logged by damon/);
  assert.match(cardTextDisplay.content, /-# Has additional info • Has evidence/);

  // Check Action Row buttons for this card
  const cardActionRow = container.components.find(
    (c) => c.type === 1 && c.components.some((btn) => btn.custom_id && btn.custom_id.includes("VRP-P-000001"))
  );
  assert.ok(cardActionRow);
  assert.ok(cardActionRow.components.some((btn) => btn.label === "Edit Record"));
  assert.ok(cardActionRow.components.some((btn) => btn.label === "Links & Evidence"));
});

// 19. COMMAND REGISTRATION: Context commands in register-commands.js
test("COMMAND REGISTRATION: Add to Punishment (type 3) and Definitely Important (type 3) are registered with Punishment History (type 2)", async () => {
  const { commands } = await import("../scripts/register-commands.js");

  const addCmd = commands.find((c) => c.name === "Add to Punishment");
  assert.ok(addCmd, "Add to Punishment command must be registered");
  assert.equal(addCmd.type, 3, "Add to Punishment must be type 3 (MESSAGE)");

  const eggCmd = commands.find((c) => c.name === "Definitely Important");
  assert.ok(eggCmd, "Definitely Important command must be registered");
  assert.equal(eggCmd.type, 3, "Definitely Important must be type 3 (MESSAGE)");

  const histCmd = commands.find((c) => c.name === "Punishment History");
  assert.ok(histCmd, "Punishment History command must remain registered");
  assert.equal(histCmd.type, 2, "Punishment History must remain type 2 (USER)");
});

// 20. SECURITY: Add to Punishment rejects non-staff member ephemerally
test("SECURITY: Add to Punishment rejects non-staff member ephemerally", async () => {
  const env = await createMockEnv();
  const interaction = {
    guild_id: "730000000000000000",
    member: {
      roles: ["999999999"], // Not StaffTeam
      user: { id: "user_random" },
    },
    data: {
      target_id: "msg_12345",
      resolved: {
        messages: {
          msg_12345: {
            id: "msg_12345",
            channel_id: "chan_789",
            author: { id: "player_target", username: "PlayerTarget" },
          },
        },
      },
    },
  };

  const res = await handleMessageContextAddToPunishment(interaction, env, {});
  const body = await res.json();
  assert.equal(body.data.flags, 64); // EPHEMERAL
  assert.match(body.data.content, /only available to Vital RP staff/);
});

// 21. SECURITY: Add to Punishment rejects Administrator without StaffTeam role
test("SECURITY: Add to Punishment rejects Administrator without StaffTeam role (no admin bypass)", async () => {
  const env = await createMockEnv();
  const interaction = {
    guild_id: "730000000000000000",
    member: {
      permissions: "8", // ADMINISTRATOR
      roles: ["admin_role_only"],
      user: { id: "admin_user" },
    },
    data: {
      target_id: "msg_12345",
      resolved: {
        messages: {
          msg_12345: {
            id: "msg_12345",
            channel_id: "chan_789",
            author: { id: "player_target", username: "PlayerTarget" },
          },
        },
      },
    },
  };

  const res = await handleMessageContextAddToPunishment(interaction, env, {});
  const body = await res.json();
  assert.equal(body.data.flags, 64);
  assert.match(body.data.content, /only available to Vital RP staff/);
});

// 22. SECURITY: Add to Punishment rejects non-guild invocation
test("SECURITY: Add to Punishment rejects non-guild invocation", async () => {
  const env = await createMockEnv();
  const interaction = {
    guild_id: null,
    member: null,
    user: { id: "dm_user" },
    data: { target_id: "msg_12345" },
  };

  const res = await handleMessageContextAddToPunishment(interaction, env, {});
  const body = await res.json();
  assert.equal(body.data.flags, 64);
  assert.match(body.data.content, /only available within a server/);
});

// 23. SECURITY: Definitely Important rejects non-staff member ephemerally
test("SECURITY: Definitely Important rejects non-staff member ephemerally", async () => {
  const env = await createMockEnv();
  const interaction = {
    guild_id: "730000000000000000",
    member: {
      roles: ["random_role"],
      user: { id: "intruder" },
    },
    data: { target_id: "msg_12345" },
  };

  const res = await handleMessageContextDefinitelyImportant(interaction, env, {});
  const body = await res.json();
  assert.equal(body.data.flags, 64);
  assert.match(body.data.content, /only available to Vital RP staff/);
});

// 24. EASTER EGG: Definitely Important responds ephemerally with random diagnostic conclusion
test("EASTER EGG: Definitely Important returns ephemeral random response from centralized array", async () => {
  const env = await createMockEnv();
  const interaction = {
    guild_id: "730000000000000000",
    member: {
      roles: [env.STAFF_TEAM_ROLE_ID],
      user: { id: "staff_damon" },
    },
    data: {
      target_id: "msg_99999",
    },
  };

  const res = await handleMessageContextDefinitelyImportant(interaction, env, {});
  const body = await res.json();

  assert.equal(body.data.flags, 64); // EPHEMERAL
  assert.match(body.data.content, /🤖 \*\*Damo-Bot Diagnostic\*\*/);
  assert.match(body.data.content, /-\# Damo-Bot • unpaid digital employee/);

  // Verify conclusion matches one of the centralized responses
  const hasMatchingResponse = DAMO_EASTER_EGG_RESPONSES.some((r) =>
    body.data.content.includes(r)
  );
  assert.ok(hasMatchingResponse, "Response must come from centralized DAMO_EASTER_EGG_RESPONSES");
});

// 25. EASTER EGG DATA INTEGRITY: No external writes, not listed in /damobot
test("EASTER EGG INTEGRITY: Definitely Important is NOT listed in /damobot and does not touch sheets or DO", async () => {
  const { DAMO_BOT_FEATURES } = await import("../src/overview/features.js");
  const foundFeature = DAMO_BOT_FEATURES.find(
    (f) =>
      (f.name && f.name.toLowerCase().includes("definitely")) ||
      (f.command && f.command.toLowerCase().includes("definitely"))
  );
  assert.equal(foundFeature, undefined, "Definitely Important must NOT be listed in /damobot");
});

// 26. LOOKUP ACCURACY: Searches strictly by Player Discord ID without name cross-match
test("LOOKUP ACCURACY: Add to Punishment searches strictly by Player Discord ID without similar name cross-matching", async () => {
  const env = await createMockEnv();
  const mockRows = [
    // Same name but different Discord ID
    ["VRP-P-000001", "2026-09-01T12:00:00.000Z", "John Doe", "111111111111111111", "Warning", "", "Reason 1", "", "", "", "", "Staff", "101", "7300", "1249", "msg1", "", "Posted", "john doe"],
    // Target player with specific Discord ID
    ["VRP-P-000002", "2026-09-02T12:00:00.000Z", "John Doe Similar", "222222222222222222", "1 Day Ban", "1 Day", "Reason 2", "", "", "", "", "Staff", "101", "7300", "1249", "msg2", "", "Posted", "john doe similar"],
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.toString().includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    return new Response(JSON.stringify({ values: mockRows }));
  };

  try {
    // 1. Right-click message (posted by TicketTool)
    const interaction = {
      guild_id: "730000000000000000",
      channel_id: "1249517344099668078",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon" },
      },
      data: {
        target_id: "msg_transcript_99",
        resolved: {
          messages: {
            msg_transcript_99: {
              id: "msg_transcript_99",
              channel_id: "1249517344099668078",
              author: {
                id: "557628352828014592", // TicketTool bot ID
                username: "TicketTool",
              },
            },
          },
        },
      },
    };

    const res = await handleMessageContextAddToPunishment(interaction, env, {});
    const body = await res.json();

    assert.equal(body.data.flags, 32832); // EPHEMERAL | COMPONENTS_V2
    assert.match(body.data.components[0].components[0].content, /Which player does this transcript belong to\?/);

    // 2. Staff selects the player (222222222222222222)
    const selectPlayerInteraction = {
      guild_id: "730000000000000000",
      channel_id: "1249517344099668078",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.USER_SELECT_TRANSCRIPT_PREFIX}1249517344099668078:msg_transcript_99`,
        values: ["222222222222222222"],
        resolved: {
          users: { "222222222222222222": { id: "222222222222222222", username: "John Doe Similar" } },
        },
      },
    };

    const compRes = await handlePunishmentComponent(selectPlayerInteraction, env, {});
    const compBody = await compRes.json();
    const container = compBody.data.components[0];
    const selectMenuRow = container.components.find((c) =>
      c.components?.some((sub) => sub.type === 3)
    );
    const selectMenu = selectMenuRow.components[0];

    // Only VRP-P-000002 should be returned because Discord ID matches
    assert.equal(selectMenu.options.length, 1);
    assert.equal(selectMenu.options[0].value, "VRP-P-000002");
    assert.match(selectMenu.options[0].label, /VRP-P-000002/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 27. LATEST FIVE: Returns up to 5 latest records newest first
test("LATEST FIVE: Add to Punishment returns up to 5 latest records sorted newest first", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000001", "2026-08-01T12:00:00.000Z", "Target", "555555555555555555", "Warning", "", "Oldest", "", "", "", "", "Staff", "101", "7300", "1249", "m1", "", "Posted", "target"],
    ["VRP-P-000002", "2026-08-10T12:00:00.000Z", "Target", "555555555555555555", "Warning", "", "Second", "", "", "", "", "Staff", "101", "7300", "1249", "m2", "", "Posted", "target"],
    ["VRP-P-000003", "2026-08-15T12:00:00.000Z", "Target", "555555555555555555", "1 Day Ban", "", "Third", "", "", "", "", "Staff", "101", "7300", "1249", "m3", "", "Posted", "target"],
    ["VRP-P-000004", "2026-08-20T12:00:00.000Z", "Target", "555555555555555555", "2 Day Ban", "", "Fourth", "", "", "", "", "Staff", "101", "7300", "1249", "m4", "", "Posted", "target"],
    ["VRP-P-000005", "2026-08-25T12:00:00.000Z", "Target", "555555555555555555", "3 Day Ban", "", "Fifth", "", "", "", "", "Staff", "101", "7300", "1249", "m5", "", "Posted", "target"],
    ["VRP-P-000006", "2026-09-01T12:00:00.000Z", "Target", "555555555555555555", "Permanent Ban", "", "Newest 6th", "", "", "", "", "Staff", "101", "7300", "1249", "m6", "", "Posted", "target"],
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.toString().includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    return new Response(JSON.stringify({ values: mockRows }));
  };

  try {
    const selectPlayerInteraction = {
      guild_id: "730000000000000000",
      channel_id: "1249517344099668078",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.USER_SELECT_TRANSCRIPT_PREFIX}1249517344099668078:msg_transcript_1`,
        values: ["555555555555555555"],
        resolved: {
          users: { "555555555555555555": { id: "555555555555555555", username: "Target" } },
        },
      },
    };

    const res = await handlePunishmentComponent(selectPlayerInteraction, env, {});
    const body = await res.json();
    const container = body.data.components[0];
    const selectMenu = container.components.find((c) =>
      c.components?.some((sub) => sub.type === 3)
    ).components[0];

    // Only 5 displayed initially
    assert.equal(selectMenu.options.length, 5);
    // Newest first (VRP-P-000006 should be first)
    assert.equal(selectMenu.options[0].value, "VRP-P-000006");
    assert.equal(selectMenu.options[4].value, "VRP-P-000002");

    // Total > 5, so "Search Older Records" button must be present
    const buttonRow = container.components.find((c) =>
      c.components?.some((b) => b.label === "Search Older Records")
    );
    assert.ok(buttonRow, "Must expose Search Older Records button when totalCount > 5");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 28. NO HISTORY: Author with no records offers Create New Punishment
test("NO HISTORY: Author without punishment records shows ephemeral panel with Create New Punishment button", async () => {
  const env = await createMockEnv();
  const mockRows = []; // No records

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.toString().includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    return new Response(JSON.stringify({ values: mockRows }));
  };

  try {
    const selectPlayerInteraction = {
      guild_id: "730000000000000000",
      channel_id: "1249517344099668078",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.USER_SELECT_TRANSCRIPT_PREFIX}1249517344099668078:msg_ticket_transcript`,
        values: ["virgin_player_id"],
        resolved: {
          users: { virgin_player_id: { id: "virgin_player_id", username: "CleanPlayer" } },
        },
      },
    };

    const res = await handlePunishmentComponent(selectPlayerInteraction, env, {});
    const body = await res.json();

    assert.equal(body.data.flags, 32832);
    const container = body.data.components[0];
    assert.match(container.components[0].content, /No punishment records were found for this player/);

    const buttonRow = container.components.find((c) =>
      c.components?.some((b) => b.label === "Create New Punishment")
    );
    assert.ok(buttonRow);
    const createBtn = buttonRow.components.find((b) => b.label === "Create New Punishment");
    assert.equal(createBtn.custom_id, `${PunishmentCustomId.BTN_CREATE_WITH_MSG_PREFIX}virgin_player_id:1249517344099668078:msg_ticket_transcript`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 29. NO HISTORY SUBMIT: Create New Punishment modal automatically sets Report URL
test("NO HISTORY SUBMIT: Submitting create-from-message modal automatically attaches selected message URL as Report URL", async () => {
  const env = await createMockEnv();
  let appendedValues = null;
  let postedDiscordBody = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const u = url.toString();
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    if (u.includes(":append")) {
      const payload = JSON.parse(options.body);
      if (!u.includes("Audit")) {
        appendedValues = payload.values[0];
      }
      return new Response(JSON.stringify({ updates: { updatedRange: "Punishment Logs!A5:S5" } }));
    }
    if (u.includes("/values/") && options.method === "PUT") {
      return new Response(JSON.stringify({}));
    }
    if (u.includes("/channels/") && options.method === "POST") {
      postedDiscordBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "posted_log_msg_id" }));
    }
    return new Response(JSON.stringify({ values: [] }));
  };

  try {
    const modalInteraction = {
      guild_id: "730000000000000000",
      channel_id: "1249517344099668078",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "damon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.MODAL_CREATE_WITH_MSG_PREFIX}new_player_id:chan_transcript_1:msg_transcript_1`,
        components: [
          { components: [{ custom_id: "player_name", value: "New Player" }] },
          { components: [{ custom_id: "punishment", value: "Warning" }] },
          { components: [{ custom_id: "punishment_length", value: "" }] },
          { components: [{ custom_id: "reason", value: "OOC in active scene" }] },
          { components: [{ custom_id: "additional_info", value: "" }] },
        ],
      },
    };

    const res = await handlePunishmentModalSubmit(modalInteraction, env, {});
    const body = await res.json();

    assert.equal(body.data.flags, 64);
    assert.match(body.data.content, /Punishment Logged Successfully/);

    // Verify Google Sheet received automatic Report URL
    assert.ok(appendedValues);
    const expectedReportUrl = "https://discord.com/channels/730000000000000000/chan_transcript_1/msg_transcript_1";
    assert.equal(appendedValues[8], expectedReportUrl, "Report URL must be auto-populated from message jump URL");

    // Verify public Discord message contains Report button and Report text
    assert.ok(postedDiscordBody);
    assert.match(postedDiscordBody.content, new RegExp(expectedReportUrl));
    const actionRow = postedDiscordBody.components[0];
    const reportBtn = actionRow.components.find((b) => b.label === "Report");
    assert.ok(reportBtn, "Report button must be present in Discord log action row");
    assert.equal(reportBtn.url, expectedReportUrl);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 30. SELECT PUNISHMENT: Selecting punishment from menu returns Report / Response choice panel
test("SELECT PUNISHMENT: Selecting punishment from menu returns Report / Response choice panel", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000142", "2026-09-03T12:00:00.000Z", "Yamsheed", "333552471588864013", "3 Day Ban", "3 Days", "RDM at black market", "", "", "", "", "damon", "101", "7300", "1249", "log_msg_10", "jump_url_10", "Posted", "yamsheed"],
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.toString().includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    return new Response(JSON.stringify({ values: mockRows }));
  };

  try {
    const selectInteraction = {
      guild_id: "730000000000000000",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.SELECT_ADD_TRANSCRIPT_PREFIX}333552471588864013:chan_ticket_1:msg_ticket_1`,
        values: ["VRP-P-000142"],
      },
    };

    const res = await handlePunishmentComponent(selectInteraction, env, {});
    const body = await res.json();

    assert.equal(body.data.flags, 32832);
    const container = body.data.components[0];
    assert.match(container.components[0].content, /VRP-P-000142/);
    assert.match(container.components[0].content, /Which transcript are you attaching\?/);

    const actionRow = container.components[1];
    const reportBtn = actionRow.components.find((b) => b.label === "Report Transcript");
    const responseBtn = actionRow.components.find((b) => b.label === "Response Transcript");
    const cancelBtn = actionRow.components.find((b) => b.label === "Cancel");

    assert.ok(reportBtn);
    assert.ok(responseBtn);
    assert.ok(cancelBtn);

    assert.equal(reportBtn.custom_id, `${PunishmentCustomId.BTN_CHOOSE_TRANSCRIPT_PREFIX}report:VRP-P-000142:chan_ticket_1:msg_ticket_1`);
    assert.equal(responseBtn.custom_id, `${PunishmentCustomId.BTN_CHOOSE_TRANSCRIPT_PREFIX}response:VRP-P-000142:chan_ticket_1:msg_ticket_1`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 31. REPORT TRANSCRIPT ATTACHMENT: Updates same row, audit, and PATCHes Discord message
test("REPORT TRANSCRIPT ATTACHMENT: Attaching Report Transcript updates Google Sheets row in-place, appends EDITED audit, and PATCHes Discord message", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000142", "2026-09-03T12:00:00.000Z", "Yamsheed", "333552471588864013", "3 Day Ban", "3 Days", "RDM at black market", "", "", "", "", "damon", "101", "7300", "1249", "orig_log_msg_id", "https://discord.com/channels/7300/1249/orig_log_msg_id", "Posted", "yamsheed"],
  ];

  let updatedSheetRow = null;
  let appendedAuditEntry = null;
  let patchedDiscordBody = null;
  let patchedUrl = null;
  let webhookPatchPayload = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const u = url.toString();
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    if (u.includes(":append")) {
      const payload = JSON.parse(options.body);
      appendedAuditEntry = payload.values[0];
      return new Response(JSON.stringify({ updates: { updatedRange: "Punishment Audits!A2:G2" } }));
    }
    if (u.includes("/values/") && options.method === "PUT") {
      const payload = JSON.parse(options.body);
      updatedSheetRow = payload.values[0];
      return new Response(JSON.stringify({}));
    }
    if (u.includes("/channels/") && options.method === "PATCH") {
      patchedUrl = u;
      patchedDiscordBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "orig_log_msg_id" }));
    }
    if (u.includes("/webhooks/") && options.method === "PATCH") {
      webhookPatchPayload = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "mock_deferred" }));
    }
    return new Response(JSON.stringify({ values: mockRows }));
  };

  try {
    const interaction = {
      application_id: "124900000000000000",
      token: "mock_interaction_token",
      guild_id: "730000000000000000",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "damon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.BTN_CHOOSE_TRANSCRIPT_PREFIX}report:VRP-P-000142:chan_ticket_1:msg_ticket_1`,
      },
    };

    const promises = [];
    const ctx = { waitUntil: (p) => promises.push(p) };

    const res = await handlePunishmentComponent(interaction, env, ctx);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.type, 6, "Must acknowledge immediately with DEFERRED_UPDATE_MESSAGE (type 6)");

    await Promise.all(promises);

    assert.ok(webhookPatchPayload);
    assert.match(webhookPatchPayload.content, /Transcript Added/);
    assert.match(webhookPatchPayload.content, /Report Transcript added to `VRP-P-000142`/);

    const expectedJump = "https://discord.com/channels/730000000000000000/chan_ticket_1/msg_ticket_1";

    // 1. Verify Google Sheets row updated in place (same row index 2)
    assert.ok(updatedSheetRow);
    assert.equal(updatedSheetRow[0], "VRP-P-000142", "Punishment ID remains unchanged");
    assert.equal(updatedSheetRow[8], expectedJump, "Report URL set to message jump URL");
    assert.equal(updatedSheetRow[15], "orig_log_msg_id", "Log Message ID remains unchanged");
    assert.equal(updatedSheetRow[16], "https://discord.com/channels/7300/1249/orig_log_msg_id", "Discord Jump URL remains unchanged");

    // 2. Verify Punishment Audit entry
    assert.ok(appendedAuditEntry);
    assert.equal(appendedAuditEntry[1], "VRP-P-000142");
    assert.equal(appendedAuditEntry[2], "EDITED");
    assert.equal(appendedAuditEntry[6], "Added Report Transcript");

    // 3. Verify original Discord message PATCHed
    assert.ok(patchedUrl);
    assert.match(patchedUrl, /orig_log_msg_id/);
    assert.ok(patchedDiscordBody);
    assert.match(patchedDiscordBody.content, new RegExp(expectedJump));
    const reportBtn = patchedDiscordBody.components[0].components.find((b) => b.label === "Report");
    assert.ok(reportBtn);
    assert.equal(reportBtn.url, expectedJump);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 32. RESPONSE TRANSCRIPT ATTACHMENT: Updates same row, audit, and PATCHes Discord message
test("RESPONSE TRANSCRIPT ATTACHMENT: Attaching Response Transcript updates Google Sheets row in-place, appends EDITED audit, and PATCHes Discord message", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000142", "2026-09-03T12:00:00.000Z", "Yamsheed", "333552471588864013", "3 Day Ban", "3 Days", "RDM at black market", "", "", "", "", "damon", "101", "7300", "1249", "orig_log_msg_id", "https://discord.com/channels/7300/1249/orig_log_msg_id", "Posted", "yamsheed"],
  ];

  let updatedSheetRow = null;
  let appendedAuditEntry = null;
  let webhookPatchPayload = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const u = url.toString();
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    if (u.includes(":append")) {
      const payload = JSON.parse(options.body);
      appendedAuditEntry = payload.values[0];
      return new Response(JSON.stringify({ updates: { updatedRange: "Punishment Audits!A2:G2" } }));
    }
    if (u.includes("/values/") && options.method === "PUT") {
      const payload = JSON.parse(options.body);
      updatedSheetRow = payload.values[0];
      return new Response(JSON.stringify({}));
    }
    if (u.includes("/channels/") && options.method === "PATCH") {
      return new Response(JSON.stringify({ id: "orig_log_msg_id" }));
    }
    if (u.includes("/webhooks/") && options.method === "PATCH") {
      webhookPatchPayload = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "mock_deferred" }));
    }
    return new Response(JSON.stringify({ values: mockRows }));
  };

  try {
    const interaction = {
      application_id: "124900000000000000",
      token: "mock_interaction_token",
      guild_id: "730000000000000000",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "damon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.BTN_CHOOSE_TRANSCRIPT_PREFIX}response:VRP-P-000142:chan_ticket_1:msg_ticket_1`,
      },
    };

    const promises = [];
    const ctx = { waitUntil: (p) => promises.push(p) };

    const res = await handlePunishmentComponent(interaction, env, ctx);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.type, 6, "Must acknowledge immediately with DEFERRED_UPDATE_MESSAGE (type 6)");

    await Promise.all(promises);

    assert.ok(webhookPatchPayload);
    assert.match(webhookPatchPayload.content, /Transcript Added/);
    assert.match(webhookPatchPayload.content, /Response Transcript added to `VRP-P-000142`/);

    const expectedJump = "https://discord.com/channels/730000000000000000/chan_ticket_1/msg_ticket_1";

    assert.ok(updatedSheetRow);
    assert.equal(updatedSheetRow[9], expectedJump, "Response URL set to message jump URL");
    assert.ok(appendedAuditEntry);
    assert.equal(appendedAuditEntry[6], "Added Response Transcript");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 32B. SLOW I/O TEST: Transcript Attachment acknowledges Discord interaction BEFORE slow Sheets/Discord REST calls finish
test("SLOW I/O ATTACHMENT: Transcript Attachment acknowledges Discord interaction BEFORE slow Sheets/Discord REST calls finish", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000142", "2026-09-03T12:00:00.000Z", "Yamsheed", "333552471588864013", "3 Day Ban", "3 Days", "RDM", "", "", "", "", "damon", "101", "7300", "1249", "m10", "jump10", "Posted", "yamsheed"],
  ];

  let sheetsPutFinished = false;
  let webhookPatched = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const u = url.toString();
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    if (u.includes(":append")) {
      return new Response(JSON.stringify({ updates: { updatedRange: "Punishment Audits!A2:G2" } }));
    }
    if (u.includes("/values/") && options.method === "PUT") {
      // Simulate slow Google Sheets network latency (60ms)
      await new Promise((r) => setTimeout(r, 60));
      sheetsPutFinished = true;
      return new Response(JSON.stringify({}));
    }
    if (u.includes("/channels/") && options.method === "PATCH") {
      return new Response(JSON.stringify({ id: "m10" }));
    }
    if (u.includes("/webhooks/") && options.method === "PATCH") {
      webhookPatched = true;
      return new Response(JSON.stringify({ id: "mock_deferred" }));
    }
    return new Response(JSON.stringify({ values: mockRows }));
  };

  try {
    const interaction = {
      application_id: "124900000000000000",
      token: "mock_interaction_token",
      guild_id: "730000000000000000",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "damon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.BTN_CHOOSE_TRANSCRIPT_PREFIX}report:VRP-P-000142:chan_ticket_1:msg_ticket_1`,
      },
    };

    const promises = [];
    const ctx = {
      waitUntil: (p) => promises.push(p),
    };

    const startTime = Date.now();
    const res = await handlePunishmentComponent(interaction, env, ctx);
    const ackTime = Date.now() - startTime;
    const body = await res.json();

    // Interaction is acknowledged immediately (<30ms, way faster than the 60ms Sheets call)
    assert.ok(ackTime < 30, `Interaction ACK was ${ackTime}ms, must return immediately before slow I/O`);
    assert.equal(body.type, 6, "Must be Type 6 DEFERRED_UPDATE_MESSAGE");

    // Google Sheets PUT has NOT finished yet at the time the HTTP response is returned
    assert.equal(sheetsPutFinished, false, "Sheets PUT must not have finished before acknowledgment");

    // Complete background task and verify eventual success
    await Promise.all(promises);
    assert.equal(sheetsPutFinished, true, "Sheets PUT finished after background execution");
    assert.equal(webhookPatched, true, "Webhook PATCH was delivered after background work");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 33. EXISTING TRANSCRIPT PROTECTION: Existing Report Transcript triggers overwrite warning; Cancel aborts
test("EXISTING TRANSCRIPT PROTECTION: Existing Report Transcript triggers overwrite warning and Cancel does not modify record", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000142", "2026-09-03T12:00:00.000Z", "Yamsheed", "333552471588864013", "3 Day Ban", "3 Days", "RDM", "", "https://existing.report.url", "", "", "damon", "101", "7300", "1249", "m10", "jump10", "Posted", "yamsheed"],
  ];

  let putCalled = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const u = url.toString();
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    if (options?.method === "PUT") {
      putCalled = true;
    }
    return new Response(JSON.stringify({ values: mockRows }));
  };

  try {
    const interaction = {
      guild_id: "730000000000000000",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.BTN_CHOOSE_TRANSCRIPT_PREFIX}report:VRP-P-000142:chan_ticket_1:msg_ticket_1`,
      },
    };

    const res = await handlePunishmentComponent(interaction, env, {});
    const body = await res.json();

    // Must NOT have updated Google Sheet
    assert.equal(putCalled, false, "Must not overwrite without confirmation");

    // Must return warning container
    assert.equal(body.data.flags, 32832);
    const container = body.data.components[0];
    assert.match(container.components[0].content, /Report Transcript Already Exists/);
    assert.match(container.components[0].content, /https:\/\/existing\.report\.url/);

    const actionRow = container.components[1];
    const replaceBtn = actionRow.components.find((b) => b.label === "Replace Existing");
    const cancelBtn = actionRow.components.find((b) => b.label === "Cancel");
    assert.ok(replaceBtn);
    assert.ok(cancelBtn);

    // Cancel interaction dismissal
    const cancelInteraction = {
      member: { roles: [env.STAFF_TEAM_ROLE_ID] },
      data: { custom_id: PunishmentCustomId.BTN_CANCEL_REPLACE },
    };
    const cancelRes = await handlePunishmentComponent(cancelInteraction, env, {});
    const cancelBody = await cancelRes.json();
    assert.equal(cancelBody.type, 7, "Cancel must acknowledge immediately with type 7 UPDATE_MESSAGE");
    assert.match(cancelBody.data.content, /Transcript replacement cancelled/);
    assert.equal(putCalled, false, "Record must remain untouched after Cancel");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 34. REPLACEMENT CONFIRMATION: Confirming replace acknowledges immediately (Type 6) and updates Report Transcript
test("REPLACEMENT CONFIRMATION: Confirming replace acknowledges immediately (Type 6) and updates Report Transcript", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000142", "2026-09-03T12:00:00.000Z", "Yamsheed", "333552471588864013", "3 Day Ban", "3 Days", "RDM", "", "https://old.report.url", "", "", "damon", "101", "7300", "1249", "m10", "https://discord.com/channels/7300/1249/m10", "Posted", "yamsheed"],
  ];

  let updatedSheetRow = null;
  let appendedAuditEntry = null;
  let webhookPatchPayload = null;
  let discordMessagePatched = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const u = url.toString();
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    if (u.includes(":append")) {
      const payload = JSON.parse(options.body);
      appendedAuditEntry = payload.values[0];
      return new Response(JSON.stringify({ updates: { updatedRange: "Punishment Audits!A2:G2" } }));
    }
    if (u.includes("/values/") && options.method === "PUT") {
      const payload = JSON.parse(options.body);
      updatedSheetRow = payload.values[0];
      return new Response(JSON.stringify({}));
    }
    if (u.includes("/channels/") && options.method === "PATCH") {
      discordMessagePatched = true;
      return new Response(JSON.stringify({ id: "m10" }));
    }
    if (u.includes("/webhooks/") && options.method === "PATCH") {
      webhookPatchPayload = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "mock_deferred" }));
    }
    return new Response(JSON.stringify({ values: mockRows }));
  };

  try {
    const expectedHash = hashString("https://old.report.url");
    const interaction = {
      application_id: "124900000000000000",
      token: "mock_interaction_token",
      guild_id: "730000000000000000",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "damon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.BTN_CONFIRM_REPLACE_PREFIX}report:VRP-P-000142:chan_ticket_1:msg_ticket_1:${expectedHash}`,
      },
    };

    const promises = [];
    const ctx = {
      waitUntil: (p) => promises.push(p),
    };

    // 1. Must acknowledge IMMEDIATELY with Type 6 (DEFERRED_UPDATE_MESSAGE)
    const res = await handlePunishmentComponent(interaction, env, ctx);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.type, 6, "Must return DEFERRED_UPDATE_MESSAGE (type 6) immediately");
    assert.equal(body.data, undefined, "Type 6 interaction response must not contain immediate data");

    // 2. Wait for asynchronous replacement work to finish
    await Promise.all(promises);

    const newJump = "https://discord.com/channels/730000000000000000/chan_ticket_1/msg_ticket_1";

    // 3. Verify Sheet updated in-place
    assert.ok(updatedSheetRow);
    assert.equal(updatedSheetRow[8], newJump, "Report URL must be updated to new transcript/jump URL");
    assert.equal(updatedSheetRow[0], "VRP-P-000142", "Punishment ID preserved");
    assert.equal(updatedSheetRow[15], "m10", "Log Message ID preserved");
    assert.equal(updatedSheetRow[16], "https://discord.com/channels/7300/1249/m10", "Jump URL preserved");

    // 4. Verify ONE Audit row added
    assert.ok(appendedAuditEntry);
    assert.equal(appendedAuditEntry[2], "EDITED");
    assert.equal(appendedAuditEntry[6], "Replaced Report Transcript");

    // 5. Verify Discord log message was edited
    assert.equal(discordMessagePatched, true, "#banwarnlog message was updated with new action row");

    // 6. Verify webhook edited deferred interaction response with compact ephemeral success UI
    assert.ok(webhookPatchPayload);
    assert.match(webhookPatchPayload.content, /✅ \*\*Report Transcript Updated\*\*/);
    assert.match(webhookPatchPayload.content, /`VRP-P-000142` now links to the new Report Transcript\./);
    assert.equal(webhookPatchPayload.components[0].components[0].label, "View Punishment");
    assert.equal(webhookPatchPayload.components[0].components[0].url, "https://discord.com/channels/7300/1249/m10");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 35. EXISTING RESPONSE PROTECTION: Existing Response Transcript triggers overwrite warning and replacement
test("EXISTING RESPONSE PROTECTION: Existing Response Transcript triggers overwrite warning and replacement", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000142", "2026-09-03T12:00:00.000Z", "Yamsheed", "333552471588864013", "3 Day Ban", "3 Days", "RDM", "", "", "https://old.response.url", "", "damon", "101", "7300", "1249", "m10", "jump10", "Posted", "yamsheed"],
  ];

  let updatedSheetRow = null;
  let appendedAuditEntry = null;
  let webhookPatchPayload = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const u = url.toString();
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    if (u.includes(":append")) {
      const payload = JSON.parse(options.body);
      appendedAuditEntry = payload.values[0];
      return new Response(JSON.stringify({ updates: { updatedRange: "Punishment Audits!A2:G2" } }));
    }
    if (u.includes("/values/") && options.method === "PUT") {
      const payload = JSON.parse(options.body);
      updatedSheetRow = payload.values[0];
      return new Response(JSON.stringify({}));
    }
    if (u.includes("/channels/") && options.method === "PATCH") {
      return new Response(JSON.stringify({ id: "m10" }));
    }
    if (u.includes("/webhooks/") && options.method === "PATCH") {
      webhookPatchPayload = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "mock_deferred" }));
    }
    return new Response(JSON.stringify({ values: mockRows }));
  };

  try {
    // 1. First trigger choose: should detect existing responseUrl and return warning
    const chooseInteraction = {
      guild_id: "730000000000000000",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.BTN_CHOOSE_TRANSCRIPT_PREFIX}response:VRP-P-000142:chan_ticket_1:msg_ticket_1`,
      },
    };

    const chooseRes = await handlePunishmentComponent(chooseInteraction, env, {});
    const chooseBody = await chooseRes.json();

    assert.equal(chooseBody.data.flags, 32832);
    const container = chooseBody.data.components[0];
    assert.match(container.components[0].content, /Response Transcript Already Exists/);
    assert.match(container.components[0].content, /https:\/\/old\.response\.url/);

    const expectedHash = hashString("https://old.response.url");

    // 2. Confirm replacement with immediate ACK
    const confirmInteraction = {
      application_id: "124900000000000000",
      token: "mock_interaction_token",
      guild_id: "730000000000000000",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "damon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.BTN_CONFIRM_REPLACE_PREFIX}response:VRP-P-000142:chan_ticket_1:msg_ticket_1:${expectedHash}`,
      },
    };

    const promises = [];
    const ctx = {
      waitUntil: (p) => promises.push(p),
    };

    const confirmRes = await handlePunishmentComponent(confirmInteraction, env, ctx);
    const confirmBody = await confirmRes.json();

    assert.equal(confirmBody.type, 6, "Must immediately return DEFERRED_UPDATE_MESSAGE");

    await Promise.all(promises);

    const newJump = "https://discord.com/channels/730000000000000000/chan_ticket_1/msg_ticket_1";

    assert.ok(updatedSheetRow);
    assert.equal(updatedSheetRow[9], newJump, "Response URL must be replaced with new jump URL");
    assert.ok(appendedAuditEntry);
    assert.equal(appendedAuditEntry[6], "Replaced Response Transcript");

    assert.ok(webhookPatchPayload);
    assert.match(webhookPatchPayload.content, /✅ \*\*Response Transcript Updated\*\*/);
    assert.match(webhookPatchPayload.content, /`VRP-P-000142` now links to the new Response Transcript\./);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 35A. SLOW I/O TEST: Replace Existing acknowledges Discord interaction BEFORE slow Sheets/Discord REST calls finish
test("SLOW I/O TEST: Replace Existing acknowledges Discord interaction BEFORE slow Sheets/Discord REST calls finish", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000142", "2026-09-03T12:00:00.000Z", "Yamsheed", "333552471588864013", "3 Day Ban", "3 Days", "RDM", "", "https://old.report.url", "", "", "damon", "101", "7300", "1249", "m10", "jump10", "Posted", "yamsheed"],
  ];

  let sheetsPutStarted = false;
  let sheetsPutFinished = false;
  let webhookPatched = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const u = url.toString();
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    if (u.includes(":append")) {
      return new Response(JSON.stringify({ updates: { updatedRange: "Punishment Audits!A2:G2" } }));
    }
    if (u.includes("/values/") && options.method === "PUT") {
      sheetsPutStarted = true;
      // Simulate 60ms slow Google Sheets response
      await new Promise((resolve) => setTimeout(resolve, 60));
      sheetsPutFinished = true;
      return new Response(JSON.stringify({}));
    }
    if (u.includes("/channels/") && options.method === "PATCH") {
      return new Response(JSON.stringify({ id: "m10" }));
    }
    if (u.includes("/webhooks/") && options.method === "PATCH") {
      webhookPatched = true;
      return new Response(JSON.stringify({ id: "mock_deferred" }));
    }
    return new Response(JSON.stringify({ values: mockRows }));
  };

  try {
    const interaction = {
      application_id: "124900000000000000",
      token: "mock_interaction_token",
      guild_id: "730000000000000000",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "damon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.BTN_CONFIRM_REPLACE_PREFIX}report:VRP-P-000142:chan_ticket_1:msg_ticket_1:${hashString("https://old.report.url")}`,
      },
    };

    const promises = [];
    const ctx = {
      waitUntil: (p) => promises.push(p),
    };

    const startTime = Date.now();
    const res = await handlePunishmentComponent(interaction, env, ctx);
    const ackTime = Date.now() - startTime;
    const body = await res.json();

    // Verification 1: Interaction is acknowledged immediately (<30ms, way faster than the 60ms Sheets call)
    assert.ok(ackTime < 30, `Interaction ACK was ${ackTime}ms, must return immediately before slow I/O`);
    assert.equal(body.type, 6, "Must be Type 6 DEFERRED_UPDATE_MESSAGE");

    // Verification 2: Google Sheets PUT has NOT finished yet at the time the HTTP response is returned
    assert.equal(sheetsPutFinished, false, "Sheets PUT must not have finished before acknowledgment");

    // Verification 3: Complete background task and verify eventual success
    await Promise.all(promises);
    assert.equal(sheetsPutFinished, true, "Sheets PUT finished after background execution");
    assert.equal(webhookPatched, true, "Webhook PATCH was delivered after background work");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 35B. DOUBLE CLICK IDEMPOTENCY: Repeated / concurrent clicks return Type 6 and do not duplicate Sheet updates or Audit rows
test("DOUBLE CLICK IDEMPOTENCY: Repeated / concurrent clicks return Type 6 and do not duplicate Sheet updates or Audit rows", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000142", "2026-09-03T12:00:00.000Z", "Yamsheed", "333552471588864013", "3 Day Ban", "3 Days", "RDM", "", "https://old.report.url", "", "", "damon", "101", "7300", "1249", "m10", "jump10", "Posted", "yamsheed"],
  ];

  let sheetPutCount = 0;
  let auditAppendCount = 0;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const u = url.toString();
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    if (u.includes(":append")) {
      auditAppendCount++;
      return new Response(JSON.stringify({ updates: { updatedRange: "Punishment Audits!A2:G2" } }));
    }
    if (u.includes("/values/") && options.method === "PUT") {
      sheetPutCount++;
      await new Promise((r) => setTimeout(r, 40));
      return new Response(JSON.stringify({}));
    }
    if (u.includes("/channels/") && options.method === "PATCH") {
      return new Response(JSON.stringify({ id: "m10" }));
    }
    if (u.includes("/webhooks/") && options.method === "PATCH") {
      return new Response(JSON.stringify({ id: "mock_deferred" }));
    }
    return new Response(JSON.stringify({ values: mockRows }));
  };

  try {
    const interaction = {
      application_id: "124900000000000000",
      token: "mock_interaction_token",
      guild_id: "730000000000000000",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "damon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.BTN_CONFIRM_REPLACE_PREFIX}report:VRP-P-000142:chan_ticket_1:msg_ticket_1:${hashString("https://old.report.url")}`,
      },
    };

    const promises = [];
    const ctx = {
      waitUntil: (p) => promises.push(p),
    };

    // First click
    const res1 = await handlePunishmentComponent(interaction, env, ctx);
    const body1 = await res1.json();
    assert.equal(body1.type, 6);

    // Immediate second click while first is still in-flight
    const res2 = await handlePunishmentComponent(interaction, env, ctx);
    const body2 = await res2.json();
    assert.equal(body2.type, 6, "Second click must immediately ACK with Type 6");

    await Promise.all(promises);

    // Must have executed Google Sheets PUT and Audit append EXACTLY ONCE
    assert.equal(sheetPutCount, 1, "Exactly ONE Sheet update must be made");
    assert.equal(auditAppendCount, 1, "Exactly ONE Audit row must be appended");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 35C. STALE CONFIRMATION: Rejects replacement safely if Report URL changed since confirmation was displayed
test("STALE CONFIRMATION: Rejects replacement safely if Report URL changed since confirmation was displayed", async () => {
  const env = await createMockEnv();
  // Notice current sheet row already has a DIFFERENT Report URL than when the confirmation was opened
  const mockRows = [
    ["VRP-P-000142", "2026-09-03T12:00:00.000Z", "Yamsheed", "333552471588864013", "3 Day Ban", "3 Days", "RDM", "", "https://someone-else-updated.report.url", "", "", "damon", "101", "7300", "1249", "m10", "jump10", "Posted", "yamsheed"],
  ];

  let sheetPutCount = 0;
  let auditAppendCount = 0;
  let webhookPatchPayload = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const u = url.toString();
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    if (u.includes(":append")) {
      auditAppendCount++;
      return new Response(JSON.stringify({ updates: { updatedRange: "Punishment Audits!A2:G2" } }));
    }
    if (u.includes("/values/") && options.method === "PUT") {
      sheetPutCount++;
      return new Response(JSON.stringify({}));
    }
    if (u.includes("/channels/") && options.method === "PATCH") {
      return new Response(JSON.stringify({ id: "m10" }));
    }
    if (u.includes("/webhooks/") && options.method === "PATCH") {
      webhookPatchPayload = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "mock_deferred" }));
    }
    return new Response(JSON.stringify({ values: mockRows }));
  };

  try {
    // Confirmation card was opened when URL was "https://old.report.url", generating hash of old URL
    const oldHash = hashString("https://old.report.url");
    const interaction = {
      application_id: "124900000000000000",
      token: "mock_interaction_token",
      guild_id: "730000000000000000",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "damon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.BTN_CONFIRM_REPLACE_PREFIX}report:VRP-P-000142:chan_ticket_1:msg_ticket_1:${oldHash}`,
      },
    };

    const promises = [];
    const ctx = {
      waitUntil: (p) => promises.push(p),
    };

    const res = await handlePunishmentComponent(interaction, env, ctx);
    const body = await res.json();
    assert.equal(body.type, 6);

    await Promise.all(promises);

    // Stale check must abort replacement before writing anything
    assert.equal(sheetPutCount, 0, "Must NOT update Google Sheets if confirmation is stale");
    assert.equal(auditAppendCount, 0, "Must NOT write Audit log if confirmation is stale");

    assert.ok(webhookPatchPayload);
    assert.match(webhookPatchPayload.content, /⚠️ \*\*Record Changed\*\*/);
    assert.match(webhookPatchPayload.content, /Someone updated this transcript after you opened this confirmation\./);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 35D. FAILURE HANDLING: Google Sheets error updates deferred response with private error and creates no audit row
test("FAILURE HANDLING: Google Sheets error updates deferred response with private error and creates no audit row", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000142", "2026-09-03T12:00:00.000Z", "Yamsheed", "333552471588864013", "3 Day Ban", "3 Days", "RDM", "", "https://old.report.url", "", "", "damon", "101", "7300", "1249", "m10", "jump10", "Posted", "yamsheed"],
  ];

  let auditAppendCount = 0;
  let webhookPatchPayload = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const u = url.toString();
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    if (u.includes(":append")) {
      auditAppendCount++;
      return new Response(JSON.stringify({ updates: { updatedRange: "Punishment Audits!A2:G2" } }));
    }
    if (u.includes("/values/") && options.method === "PUT") {
      // Simulate Google Sheets 500 error
      return new Response("Google Sheets Internal Error", { status: 500 });
    }
    if (u.includes("/channels/") && options.method === "PATCH") {
      return new Response(JSON.stringify({ id: "m10" }));
    }
    if (u.includes("/webhooks/") && options.method === "PATCH") {
      webhookPatchPayload = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "mock_deferred" }));
    }
    return new Response(JSON.stringify({ values: mockRows }));
  };

  try {
    const interaction = {
      application_id: "124900000000000000",
      token: "mock_interaction_token",
      guild_id: "730000000000000000",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "damon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.BTN_CONFIRM_REPLACE_PREFIX}report:VRP-P-000142:chan_ticket_1:msg_ticket_1:${hashString("https://old.report.url")}`,
      },
    };

    const promises = [];
    const ctx = {
      waitUntil: (p) => promises.push(p),
    };

    const res = await handlePunishmentComponent(interaction, env, ctx);
    assert.equal(res.status, 200);

    await Promise.all(promises);

    // No success audit entry
    assert.equal(auditAppendCount, 0, "No audit success entry must be written if Sheet update fails");

    // Deferred interaction response notified of failure
    assert.ok(webhookPatchPayload);
    assert.match(webhookPatchPayload.content, /❌ \*\*Transcript Update Failed\*\*/);
    assert.match(webhookPatchPayload.content, /The punishment record was not changed\./);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 35E. FAILURE HANDLING: Discord #banwarnlog edit failure marks sync status Post Failed and shows sync warning
test("FAILURE HANDLING: Discord #banwarnlog edit failure marks sync status Post Failed and shows sync warning", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000142", "2026-09-03T12:00:00.000Z", "Yamsheed", "333552471588864013", "3 Day Ban", "3 Days", "RDM", "", "https://old.report.url", "", "", "damon", "101", "7300", "1249", "m10", "jump10", "Posted", "yamsheed"],
  ];

  let syncStatusMarked = null;
  let webhookPatchPayload = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const u = url.toString();
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    if (u.includes(":append")) {
      return new Response(JSON.stringify({ updates: { updatedRange: "Punishment Audits!A2:G2" } }));
    }
    if (u.includes("/values/") && options.method === "PUT") {
      const payload = JSON.parse(options.body);
      if (payload.values && payload.values[0] && payload.values[0][2] === "Post Failed") {
        syncStatusMarked = payload.values[0][2];
      }
      return new Response(JSON.stringify({}));
    }
    if (u.includes("/channels/") && options.method === "PATCH") {
      // Simulate Discord REST error
      return new Response("Unknown Message", { status: 404 });
    }
    if (u.includes("/webhooks/") && options.method === "PATCH") {
      webhookPatchPayload = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "mock_deferred" }));
    }
    return new Response(JSON.stringify({ values: mockRows }));
  };

  try {
    const interaction = {
      application_id: "124900000000000000",
      token: "mock_interaction_token",
      guild_id: "730000000000000000",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "damon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.BTN_CONFIRM_REPLACE_PREFIX}report:VRP-P-000142:chan_ticket_1:msg_ticket_1:${hashString("https://old.report.url")}`,
      },
    };

    const promises = [];
    const ctx = {
      waitUntil: (p) => promises.push(p),
    };

    const res = await handlePunishmentComponent(interaction, env, ctx);
    assert.equal(res.status, 200);

    await Promise.all(promises);

    // Sync status transitioned to Post Failed
    assert.equal(syncStatusMarked, "Post Failed");

    // Deferred interaction response notified of sync error
    assert.ok(webhookPatchPayload);
    assert.match(webhookPatchPayload.content, /⚠️ \*\*Transcript Updated \(Discord Sync Needed\)\*\*/);
    assert.match(webhookPatchPayload.content, /The record has been marked as `Post Failed` in the database\./);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 36. SEARCH OLDER RECORDS: Clicking Search Older Records returns complete player history for that Discord ID
test("SEARCH OLDER RECORDS: Button reuses existing player history scoped to target Discord ID", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000001", "2026-08-01", "Target", "555555555555555555", "Warning", "", "Reason 1", "", "", "", "", "Staff", "101", "7300", "1249", "m1", "", "Posted", "target"],
    ["VRP-P-000002", "2026-08-10", "Target", "555555555555555555", "Warning", "", "Reason 2", "", "", "", "", "Staff", "101", "7300", "1249", "m2", "", "Posted", "target"],
    ["VRP-P-000003", "2026-08-15", "Target", "555555555555555555", "Warning", "", "Reason 3", "", "", "", "", "Staff", "101", "7300", "1249", "m3", "", "Posted", "target"],
    ["VRP-P-000004", "2026-08-20", "Target", "555555555555555555", "Warning", "", "Reason 4", "", "", "", "", "Staff", "101", "7300", "1249", "m4", "", "Posted", "target"],
    ["VRP-P-000005", "2026-08-25", "Target", "555555555555555555", "Warning", "", "Reason 5", "", "", "", "", "Staff", "101", "7300", "1249", "m5", "", "Posted", "target"],
    ["VRP-P-000006", "2026-09-01", "Target", "555555555555555555", "Warning", "", "Reason 6", "", "", "", "", "Staff", "101", "7300", "1249", "m6", "", "Posted", "target"],
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.toString().includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    return new Response(JSON.stringify({ values: mockRows }));
  };

  try {
    const historyBtnInteraction = {
      guild_id: "730000000000000000",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.BTN_PLAYER_HISTORY_PREFIX}555555555555555555`,
      },
    };

    const res = await handlePunishmentComponent(historyBtnInteraction, env, {});
    const body = await res.json();

    assert.equal(body.data.flags, 32832);
    const container = body.data.components[0];
    assert.match(container.components[0].content, /PLAYER PUNISHMENT HISTORY/);
    assert.match(container.components[0].content, /6 record\(s\) found/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 37. TICKETTOOL AUTHOR DECOUPLING: TicketTool bot ID is not used as Player Discord ID
test("TICKETTOOL AUTHOR DECOUPLING: TicketTool bot ID is never used as Player Discord ID and staff is asked to select player", async () => {
  const env = await createMockEnv();
  const ticketToolBotId = "557628352828014592";
  const actualPlayerId = "888888888888888888";

  let queriedPlayerDiscordIds = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = url.toString();
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    // Return rows: one belongs to TicketTool (should never match), one belongs to actual player
    return new Response(
      JSON.stringify({
        values: [
          ["VRP-P-000001", "2026-08-01", "TicketTool Bot", ticketToolBotId, "Warning", "", "Bot action", "", "", "", "", "Staff", "101", "7300", "1249", "m1", "", "Posted", "tickettool"],
          ["VRP-P-000099", "2026-09-03", "Real Player", actualPlayerId, "2 Day Ban", "2 Days", "Combat log", "", "", "", "", "Staff", "101", "7300", "1249", "m2", "", "Posted", "real player"],
        ],
      })
    );
  };

  try {
    // 1. Staff invokes Add to Punishment on TicketTool's message
    const interaction = {
      guild_id: "730000000000000000",
      channel_id: "1249517344099668078",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon" },
      },
      data: {
        target_id: "msg_tickettool_transcript_001",
        resolved: {
          messages: {
            msg_tickettool_transcript_001: {
              id: "msg_tickettool_transcript_001",
              channel_id: "1249517344099668078",
              author: {
                id: ticketToolBotId,
                username: "TicketTool",
                bot: true,
              },
            },
          },
        },
      },
    };

    const res = await handleMessageContextAddToPunishment(interaction, env, {});
    const body = await res.json();

    // Must NOT query sheets or return records yet; must prompt for player selection
    assert.equal(body.data.flags, 32832);
    assert.match(body.data.components[0].components[0].content, /Which player does this transcript belong to\?/);
    const userSelectRow = body.data.components[0].components[1];
    assert.equal(userSelectRow.components[0].type, 5); // USER_SELECT

    // 2. Staff selects the actual player from the prompt
    const selectInteraction = {
      guild_id: "730000000000000000",
      channel_id: "1249517344099668078",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.USER_SELECT_TRANSCRIPT_PREFIX}1249517344099668078:msg_tickettool_transcript_001`,
        values: [actualPlayerId],
        resolved: {
          users: {
            [actualPlayerId]: { id: actualPlayerId, username: "RealPlayer" },
          },
        },
      },
    };

    const compRes = await handlePunishmentComponent(selectInteraction, env, {});
    const compBody = await compRes.json();
    const container = compBody.data.components[0];
    const selectMenu = container.components.find((c) =>
      c.components?.some((sub) => sub.type === 3)
    ).components[0];

    // Only actual player's punishment VRP-P-000099 must be returned, NOT TicketTool's VRP-P-000001
    assert.equal(selectMenu.options.length, 1);
    assert.equal(selectMenu.options[0].value, "VRP-P-000099");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 38. DIRECT TRANSCRIPT URL EXTRACTION: Prefers direct transcript URL from link buttons, attachments, and embeds
test("DIRECT TRANSCRIPT URL: Prefers direct TicketTool transcript URL from Link button, Attachment, and Embed", () => {
  const jumpFallback = "https://discord.com/channels/7300/1249/999";

  // Case 1: Component Link Button
  const msgWithButton = {
    components: [
      {
        components: [
          {
            type: 2,
            style: 5,
            label: "Direct Transcript",
            url: "https://tickettool.xyz/direct/transcript/tt_btn_12345",
          },
        ],
      },
    ],
  };
  assert.equal(
    extractTicketTranscriptUrl(msgWithButton, jumpFallback),
    "https://tickettool.xyz/direct/transcript/tt_btn_12345"
  );

  // Case 2: File Attachment
  const msgWithAttachment = {
    attachments: [
      {
        filename: "transcript-ticket-456.html",
        url: "https://cdn.discordapp.com/attachments/1249/456/transcript-ticket-456.html",
      },
    ],
  };
  assert.equal(
    extractTicketTranscriptUrl(msgWithAttachment, jumpFallback),
    "https://cdn.discordapp.com/attachments/1249/456/transcript-ticket-456.html"
  );

  // Case 3: Embed Markdown Link
  const msgWithEmbed = {
    embeds: [
      {
        description: "Ticket closed. View [Direct Transcript](https://tickettool.xyz/transcript/tt_embed_789).",
      },
    ],
  };
  assert.equal(
    extractTicketTranscriptUrl(msgWithEmbed, jumpFallback),
    "https://tickettool.xyz/transcript/tt_embed_789"
  );

  // Case 4: Plain Text Content
  const msgWithContent = {
    content: "Here is the ticket transcript: https://tickettool.xyz/direct/transcript/tt_text_999",
  };
  assert.equal(
    extractTicketTranscriptUrl(msgWithContent, jumpFallback),
    "https://tickettool.xyz/direct/transcript/tt_text_999"
  );
});

// 39. DISCORD JUMP URL FALLBACK: Safely falls back to message jump URL when no direct transcript is identified
test("DISCORD JUMP URL FALLBACK: Safely falls back to jump URL and does not scrape arbitrary URLs", () => {
  const jumpFallback = "https://discord.com/channels/7300/1249/999";

  // Message with no links
  const plainMsg = { content: "Ticket was resolved in-game." };
  assert.equal(extractTicketTranscriptUrl(plainMsg, jumpFallback), jumpFallback);

  // Message with unrelated URLs (must NOT scrape arbitrary links blindly)
  const unrelatedMsg = {
    content: "Check this screenshot: https://imgur.com/gallery/12345 and gif: https://tenor.com/view/cat-gif",
    embeds: [{ description: "User avatar: https://cdn.discordapp.com/avatars/123/avatar.png" }],
  };
  assert.equal(extractTicketTranscriptUrl(unrelatedMsg, jumpFallback), jumpFallback);

  // Null/undefined message
  assert.equal(extractTicketTranscriptUrl(null, jumpFallback), jumpFallback);
});

// 40. TWO DIFFERENT TRANSCRIPTS ON SAME PUNISHMENT: First becomes Report, Second becomes Response
test("TWO DIFFERENT TRANSCRIPTS: First TicketTool message becomes Report URL and second TicketTool message becomes Response URL for same punishment", async () => {
  const env = await createMockEnv();
  let currentRecord = [
    "VRP-P-000142", "2026-09-03T12:00:00.000Z", "Yamsheed", "333552471588864013", "3 Day Ban", "3 Days", "RDM", "", "", "", "", "damon", "101", "7300", "1249", "orig_log_msg_id", "https://discord.com/channels/7300/1249/orig_log_msg_id", "Posted", "yamsheed"
  ];

  let patchedDiscordMessages = [];
  let webhookPatchPayloads = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const u = url.toString();
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    // Discord GET message to extract direct TicketTool transcript
    if (u.includes("/channels/chan_ticket_1/messages/msg_tt_report") && (!options || !options.method || options.method === "GET")) {
      return new Response(JSON.stringify({
        id: "msg_tt_report",
        components: [
          {
            components: [
              { type: 2, style: 5, label: "Direct Transcript", url: "https://tickettool.xyz/direct/transcript/rep_111" }
            ]
          }
        ]
      }));
    }
    if (u.includes("/channels/chan_ticket_2/messages/msg_tt_response") && (!options || !options.method || options.method === "GET")) {
      return new Response(JSON.stringify({
        id: "msg_tt_response",
        components: [
          {
            components: [
              { type: 2, style: 5, label: "Direct Transcript", url: "https://tickettool.xyz/direct/transcript/resp_222" }
            ]
          }
        ]
      }));
    }
    if (u.includes(":append")) {
      return new Response(JSON.stringify({ updates: { updatedRange: "Punishment Audits!A2:G2" } }));
    }
    if (u.includes("/values/") && options.method === "PUT") {
      const payload = JSON.parse(options.body);
      currentRecord = payload.values[0];
      return new Response(JSON.stringify({}));
    }
    if (u.includes("/channels/") && options.method === "PATCH") {
      patchedDiscordMessages.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ id: "orig_log_msg_id" }));
    }
    if (u.includes("/webhooks/") && options.method === "PATCH") {
      webhookPatchPayloads.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ id: "mock_deferred" }));
    }
    return new Response(JSON.stringify({ values: [currentRecord] }));
  };

  try {
    // 1. Attach FIRST TicketTool message as Report Transcript
    const attachReportInteraction = {
      application_id: "124900000000000000",
      token: "mock_token_1",
      guild_id: "730000000000000000",
      member: { roles: [env.STAFF_TEAM_ROLE_ID], user: { id: "staff_damon", username: "damon" } },
      data: {
        custom_id: `${PunishmentCustomId.BTN_CHOOSE_TRANSCRIPT_PREFIX}report:VRP-P-000142:chan_ticket_1:msg_tt_report`,
      },
    };

    const promises1 = [];
    const ctx1 = { waitUntil: (p) => promises1.push(p) };

    const res1 = await handlePunishmentComponent(attachReportInteraction, env, ctx1);
    const body1 = await res1.json();
    assert.equal(res1.status, 200);
    assert.equal(body1.type, 6, "Must acknowledge immediately with DEFERRED_UPDATE_MESSAGE (type 6)");

    await Promise.all(promises1);
    assert.ok(webhookPatchPayloads.length >= 1);
    assert.match(webhookPatchPayloads[0].content, /Report Transcript added to `VRP-P-000142`/);

    // Verify Google Sheet has Report URL set
    assert.equal(currentRecord[8], "https://tickettool.xyz/direct/transcript/rep_111");
    assert.equal(currentRecord[9], "", "Response URL should not be set yet");

    // 2. Attach SECOND TicketTool message as Response Transcript on the SAME punishment
    const attachResponseInteraction = {
      application_id: "124900000000000000",
      token: "mock_token_2",
      guild_id: "730000000000000000",
      member: { roles: [env.STAFF_TEAM_ROLE_ID], user: { id: "staff_damon", username: "damon" } },
      data: {
        custom_id: `${PunishmentCustomId.BTN_CHOOSE_TRANSCRIPT_PREFIX}response:VRP-P-000142:chan_ticket_2:msg_tt_response`,
      },
    };

    const promises2 = [];
    const ctx2 = { waitUntil: (p) => promises2.push(p) };

    const res2 = await handlePunishmentComponent(attachResponseInteraction, env, ctx2);
    const body2 = await res2.json();
    assert.equal(res2.status, 200);
    assert.equal(body2.type, 6, "Must acknowledge immediately with DEFERRED_UPDATE_MESSAGE (type 6)");

    await Promise.all(promises2);
    assert.ok(webhookPatchPayloads.length >= 2);
    assert.match(webhookPatchPayloads[1].content, /Response Transcript added to `VRP-P-000142`/);

    // Verify Google Sheet now contains BOTH transcripts on the SAME record row
    assert.equal(currentRecord[0], "VRP-P-000142");
    assert.equal(currentRecord[8], "https://tickettool.xyz/direct/transcript/rep_111", "Report URL preserved");
    assert.equal(currentRecord[9], "https://tickettool.xyz/direct/transcript/resp_222", "Response URL added");

    // Verify Discord PATCH contains both buttons: [ 📋 Report ] and [ 💬 Response ]
    assert.equal(patchedDiscordMessages.length, 2);
    const finalDiscordMessage = patchedDiscordMessages[1];
    const buttons = finalDiscordMessage.components[0].components;
    assert.equal(buttons.length, 3); // Report, Response, Player History
    assert.equal(buttons[0].label, "Report");
    assert.equal(buttons[0].url, "https://tickettool.xyz/direct/transcript/rep_111");
    assert.equal(buttons[1].label, "Response");
    assert.equal(buttons[1].url, "https://tickettool.xyz/direct/transcript/resp_222");
    assert.equal(buttons[2].label, "Player History");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// =========================================================================
// 40. CONFIRMATION CARD EXTRACTION & REAL ROUTING (REPORT CANCEL)
// =========================================================================
test("CONFIRMATION CARD EXTRACTION & REAL ROUTING: Generated Report Cancel button routes cleanly, acknowledges immediately (type 7), and makes zero Google Sheets calls", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000142", "2026-09-03T12:00:00.000Z", "Yamsheed", "333552471588864013", "3 Day Ban", "3 Days", "RDM", "", "https://existing.report.url", "", "", "damon", "101", "7300", "1249", "m10", "jump10", "Posted", "yamsheed"],
  ];

  let putCalled = false;
  let appendCalled = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const u = url.toString();
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    if (options.method === "PUT") putCalled = true;
    if (u.includes(":append")) appendCalled = true;
    return new Response(JSON.stringify({ values: mockRows }));
  };

  try {
    // 1. Trigger Report transcript selection to generate REAL confirmation card
    const chooseInteraction = {
      guild_id: "730000000000000000",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "damon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.BTN_CHOOSE_TRANSCRIPT_PREFIX}report:VRP-P-000142:chan_ticket_1:msg_ticket_1`,
      },
    };

    const res1 = await handlePunishmentComponent(chooseInteraction, env, {});
    const body1 = await res1.json();
    assert.equal(body1.type, 7, "Warning card must be an UPDATE_MESSAGE");

    const container = body1.data.components[0];
    const actionRow = container.components[1];
    const cancelBtn = actionRow.components.find((b) => b.label === "Cancel");
    assert.ok(cancelBtn, "Cancel button must exist on confirmation card");

    // 2. Inspect exact custom_id generated by the real component builder
    const exactCancelCustomId = cancelBtn.custom_id;
    assert.match(exactCancelCustomId, /^punish_tx_cancel:tx_[a-z0-9_]+$/i, "Cancel custom_id must be compact tokenized format");
    assert.ok(exactCancelCustomId.length < 40, "Cancel custom_id must be well under Discord 100 char limit");
    assert.ok(!exactCancelCustomId.includes("http"), "Cancel custom_id must NOT encode Discord or ticket URLs");

    // 3. Feed THAT EXACT custom_id into the production component router
    const cancelInteraction = {
      guild_id: "730000000000000000",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "damon" },
      },
      data: {
        custom_id: exactCancelCustomId,
      },
    };

    const res2 = await handlePunishmentComponent(cancelInteraction, env, {});
    const body2 = await res2.json();

    // 4. Confirm router recognizes it and Discord receives immediate acknowledgement
    assert.equal(res2.status, 200);
    assert.equal(body2.type, 7, "Cancel must return UPDATE_MESSAGE (type 7)");
    assert.match(body2.data.content, /Transcript replacement cancelled/);
    assert.match(body2.data.content, /No changes were made to `VRP-P-000142`/);

    // 5. Confirm ZERO Google Sheets calls occur
    assert.equal(putCalled, false, "Cancel must NEVER perform Google Sheets PUT");
    assert.equal(appendCalled, false, "Cancel must NEVER perform Google Sheets Audit append");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// =========================================================================
// 41. CONFIRMATION CARD EXTRACTION & REAL ROUTING (REPORT REPLACE)
// =========================================================================
test("CONFIRMATION CARD EXTRACTION & REAL ROUTING: Generated Report Replace button routes cleanly, acknowledges immediately (type 6), and performs replacement", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000142", "2026-09-03T12:00:00.000Z", "Yamsheed", "333552471588864013", "3 Day Ban", "3 Days", "RDM", "", "https://existing.report.url", "", "", "damon", "101", "7300", "1249", "m10", "jump10", "Posted", "yamsheed"],
  ];

  let updatedSheetRow = null;
  let appendedAuditEntry = null;
  let discordMessagePatched = false;
  let webhookPatchPayload = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const u = url.toString();
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    if (u.includes(":append")) {
      appendedAuditEntry = JSON.parse(options.body).values[0];
      return new Response(JSON.stringify({ updates: { updatedRange: "Punishment Audits!A2:G2" } }));
    }
    if (u.includes("/values/") && options.method === "PUT") {
      updatedSheetRow = JSON.parse(options.body).values[0];
      return new Response(JSON.stringify({}));
    }
    if (u.includes("/channels/") && options.method === "PATCH") {
      discordMessagePatched = true;
      return new Response(JSON.stringify({ id: "m10" }));
    }
    if (u.includes("/webhooks/") && options.method === "PATCH") {
      webhookPatchPayload = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "mock_deferred" }));
    }
    return new Response(JSON.stringify({ values: mockRows }));
  };

  try {
    // 1. Trigger Report transcript selection to generate REAL confirmation card
    const chooseInteraction = {
      guild_id: "730000000000000000",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "damon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.BTN_CHOOSE_TRANSCRIPT_PREFIX}report:VRP-P-000142:chan_ticket_1:msg_ticket_1`,
      },
    };

    const res1 = await handlePunishmentComponent(chooseInteraction, env, {});
    const body1 = await res1.json();
    const container = body1.data.components[0];
    const actionRow = container.components[1];
    const replaceBtn = actionRow.components.find((b) => b.label === "Replace Existing");
    assert.ok(replaceBtn, "Replace Existing button must exist on confirmation card");

    // 2. Inspect exact custom_id generated by the real component builder
    const exactReplaceCustomId = replaceBtn.custom_id;
    assert.match(exactReplaceCustomId, /^punish_tx_rep:tx_[a-z0-9_]+$/i, "Replace custom_id must be compact tokenized format");
    assert.ok(exactReplaceCustomId.length < 40, "Replace custom_id must be well under Discord 100 char limit");
    assert.ok(!exactReplaceCustomId.includes("http"), "Replace custom_id must NOT encode Discord or ticket URLs");

    // 3. Feed THAT EXACT custom_id into the production component router
    const replaceInteraction = {
      application_id: "124900000000000000",
      token: "mock_interaction_token",
      guild_id: "730000000000000000",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "damon" },
      },
      data: {
        custom_id: exactReplaceCustomId,
      },
    };

    const promises = [];
    const ctx = { waitUntil: (p) => promises.push(p) };

    // 4. Must acknowledge IMMEDIATELY with Type 6 (DEFERRED_UPDATE_MESSAGE) BEFORE slow work
    const res2 = await handlePunishmentComponent(replaceInteraction, env, ctx);
    const body2 = await res2.json();

    assert.equal(res2.status, 200);
    assert.equal(body2.type, 6, "Must acknowledge immediately with DEFERRED_UPDATE_MESSAGE (type 6)");
    assert.equal(body2.data, undefined, "Type 6 interaction response must have no body data");

    // 5. Wait for asynchronous replacement work to finish
    await Promise.all(promises);

    // 6. Confirm Google Sheets updated in-place and audit written
    assert.ok(updatedSheetRow, "Google Sheet row must be updated");
    assert.equal(updatedSheetRow[0], "VRP-P-000142", "Punishment ID preserved");
    assert.equal(updatedSheetRow[8], "https://discord.com/channels/730000000000000000/chan_ticket_1/msg_ticket_1", "Report URL updated");
    assert.ok(appendedAuditEntry, "Audit row must be appended");
    assert.equal(appendedAuditEntry[2], "EDITED");
    assert.equal(appendedAuditEntry[6], "Replaced Report Transcript");
    assert.equal(discordMessagePatched, true, "Discord #banwarnlog message patched");

    // 7. Confirm deferred interaction response updated with compact success UI
    assert.ok(webhookPatchPayload);
    assert.match(webhookPatchPayload.content, /✅ \*\*Report Transcript Updated\*\*/);
    assert.match(webhookPatchPayload.content, /`VRP-P-000142` now links to the new Report Transcript\./);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// =========================================================================
// 42. CONFIRMATION CARD EXTRACTION & REAL ROUTING (RESPONSE CANCEL on VRP-P-000002)
// =========================================================================
test("CONFIRMATION CARD EXTRACTION & REAL ROUTING: Generated Response Cancel button routes cleanly on VRP-P-000002, acknowledges immediately (type 7), and makes zero Google Sheets calls", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000002", "2026-09-03T12:00:00.000Z", "Giggles", "111222333444555666", "1 Day Ban", "1 Day", "VDM", "", "", "https://existing.response.url", "", "damon", "101", "7300", "1249", "m2", "https://discord.com/channels/7300/1249/m2", "Posted", "giggles"],
  ];

  let putCalled = false;
  let appendCalled = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const u = url.toString();
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    if (options.method === "PUT") putCalled = true;
    if (u.includes(":append")) appendCalled = true;
    return new Response(JSON.stringify({ values: mockRows }));
  };

  try {
    // 1. Trigger Response transcript selection on VRP-P-000002
    const chooseInteraction = {
      guild_id: "730000000000000000",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "damon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.BTN_CHOOSE_TRANSCRIPT_PREFIX}response:VRP-P-000002:chan_ticket_2:msg_ticket_2`,
      },
    };

    const res1 = await handlePunishmentComponent(chooseInteraction, env, {});
    const body1 = await res1.json();
    assert.equal(body1.type, 7);

    const container = body1.data.components[0];
    assert.match(container.components[0].content, /Response Transcript Already Exists/);
    assert.match(container.components[0].content, /`VRP-P-000002` already has a Response Transcript\./);

    const actionRow = container.components[1];
    const cancelBtn = actionRow.components.find((b) => b.label === "Cancel");
    assert.ok(cancelBtn, "Cancel button must exist on response confirmation card");

    const exactCancelCustomId = cancelBtn.custom_id;
    assert.match(exactCancelCustomId, /^punish_tx_cancel:tx_[a-z0-9_]+$/i);

    // 2. Feed THAT EXACT custom_id into the production component router
    const cancelInteraction = {
      guild_id: "730000000000000000",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "damon" },
      },
      data: {
        custom_id: exactCancelCustomId,
      },
    };

    const res2 = await handlePunishmentComponent(cancelInteraction, env, {});
    const body2 = await res2.json();

    assert.equal(res2.status, 200);
    assert.equal(body2.type, 7, "Must acknowledge immediately with type 7 UPDATE_MESSAGE");
    assert.match(body2.data.content, /Transcript replacement cancelled/);
    assert.match(body2.data.content, /No changes were made to `VRP-P-000002`/);

    assert.equal(putCalled, false, "Must not touch Google Sheets on Cancel");
    assert.equal(appendCalled, false, "Must not write audit on Cancel");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// =========================================================================
// 43. CONFIRMATION CARD EXTRACTION & REAL ROUTING (RESPONSE REPLACE on VRP-P-000002)
// =========================================================================
test("CONFIRMATION CARD EXTRACTION & REAL ROUTING: Generated Response Replace button routes cleanly on VRP-P-000002, acknowledges immediately (type 6), and performs replacement", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000002", "2026-09-03T12:00:00.000Z", "Giggles", "111222333444555666", "1 Day Ban", "1 Day", "VDM", "", "", "https://existing.response.url", "", "damon", "101", "7300", "1249", "m2", "https://discord.com/channels/7300/1249/m2", "Posted", "giggles"],
  ];

  let updatedSheetRow = null;
  let appendedAuditEntry = null;
  let discordMessagePatched = false;
  let webhookPatchPayload = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const u = url.toString();
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    if (u.includes(":append")) {
      appendedAuditEntry = JSON.parse(options.body).values[0];
      return new Response(JSON.stringify({ updates: { updatedRange: "Punishment Audits!A2:G2" } }));
    }
    if (u.includes("/values/") && options.method === "PUT") {
      updatedSheetRow = JSON.parse(options.body).values[0];
      return new Response(JSON.stringify({}));
    }
    if (u.includes("/channels/") && options.method === "PATCH") {
      discordMessagePatched = true;
      return new Response(JSON.stringify({ id: "m2" }));
    }
    if (u.includes("/webhooks/") && options.method === "PATCH") {
      webhookPatchPayload = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "mock_deferred" }));
    }
    return new Response(JSON.stringify({ values: mockRows }));
  };

  try {
    // 1. Trigger Response transcript selection on VRP-P-000002
    const chooseInteraction = {
      guild_id: "730000000000000000",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "damon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.BTN_CHOOSE_TRANSCRIPT_PREFIX}response:VRP-P-000002:chan_ticket_2:msg_ticket_2`,
      },
    };

    const res1 = await handlePunishmentComponent(chooseInteraction, env, {});
    const body1 = await res1.json();
    const container = body1.data.components[0];
    const actionRow = container.components[1];
    const replaceBtn = actionRow.components.find((b) => b.label === "Replace Existing");
    assert.ok(replaceBtn, "Replace Existing button must exist on response confirmation card");

    const exactReplaceCustomId = replaceBtn.custom_id;
    assert.match(exactReplaceCustomId, /^punish_tx_rep:tx_[a-z0-9_]+$/i);

    // 2. Feed THAT EXACT custom_id into the production component router
    const replaceInteraction = {
      application_id: "124900000000000000",
      token: "mock_interaction_token",
      guild_id: "730000000000000000",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "damon" },
      },
      data: {
        custom_id: exactReplaceCustomId,
      },
    };

    const promises = [];
    const ctx = { waitUntil: (p) => promises.push(p) };

    const res2 = await handlePunishmentComponent(replaceInteraction, env, ctx);
    const body2 = await res2.json();

    assert.equal(res2.status, 200);
    assert.equal(body2.type, 6, "Must acknowledge immediately with DEFERRED_UPDATE_MESSAGE (type 6)");

    // 3. Complete background replacement work
    await Promise.all(promises);

    assert.ok(updatedSheetRow, "Sheet row must be updated");
    assert.equal(updatedSheetRow[0], "VRP-P-000002", "Punishment ID preserved");
    assert.equal(updatedSheetRow[9], "https://discord.com/channels/730000000000000000/chan_ticket_2/msg_ticket_2", "Response URL updated");
    assert.ok(appendedAuditEntry, "Audit row must be appended");
    assert.equal(appendedAuditEntry[2], "EDITED");
    assert.equal(appendedAuditEntry[6], "Replaced Response Transcript");
    assert.equal(discordMessagePatched, true);

    // 4. Deferred response displays compact success UI with [ 🔗 View Punishment ]
    assert.ok(webhookPatchPayload);
    assert.match(webhookPatchPayload.content, /✅ \*\*Response Transcript Updated\*\*/);
    assert.match(webhookPatchPayload.content, /`VRP-P-000002` now links to the new Response Transcript\./);
    assert.ok(webhookPatchPayload.components?.length > 0, "Must include View Punishment button");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// =========================================================================
// 44. UNKNOWN COMPONENT SAFETY
// =========================================================================
test("UNKNOWN COMPONENT SAFETY: Unknown Damo-Bot component custom_id returns safe ephemeral response without leaving Discord hanging", async () => {
  const env = await createMockEnv();

  const unknownInteraction = {
    guild_id: "730000000000000000",
    member: {
      roles: [env.STAFF_TEAM_ROLE_ID],
      user: { id: "staff_damon", username: "damon" },
    },
    data: {
      custom_id: "punish_tx_unknown_action_xyz",
    },
  };

  const res = await handlePunishmentComponent(unknownInteraction, env, {});
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.type, 4, "Must respond with CHANNEL_MESSAGE_WITH_SOURCE (type 4)");
  assert.equal(body.data.flags, 64, "Must be ephemeral");
  assert.match(body.data.content, /❌ \*\*This action is no longer valid\.\*\*/);
  assert.match(body.data.content, /Please reopen the Punishment Center and try again\./);
});

// =========================================================================
// 45. OWNERSHIP ENFORCEMENT
// =========================================================================
test("OWNERSHIP ENFORCEMENT: Only the staff member who initiated confirmation can confirm or cancel replacement", async () => {
  const env = await createMockEnv();
  const mockRows = [
    ["VRP-P-000002", "2026-09-03T12:00:00.000Z", "Giggles", "111222333444555666", "1 Day Ban", "1 Day", "VDM", "", "", "https://existing.response.url", "", "damon", "101", "7300", "1249", "m2", "https://discord.com/channels/7300/1249/m2", "Posted", "giggles"],
  ];

  let putCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const u = url.toString();
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    if (options.method === "PUT") putCalled = true;
    return new Response(JSON.stringify({ values: mockRows }));
  };

  try {
    // 1. Staff Damon triggers confirmation
    const chooseInteraction = {
      guild_id: "730000000000000000",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "damon" },
      },
      data: {
        custom_id: `${PunishmentCustomId.BTN_CHOOSE_TRANSCRIPT_PREFIX}response:VRP-P-000002:chan_ticket_2:msg_ticket_2`,
      },
    };

    const res1 = await handlePunishmentComponent(chooseInteraction, env, {});
    const body1 = await res1.json();
    const actionRow = body1.data.components[0].components[1];
    const replaceBtn = actionRow.components.find((b) => b.label === "Replace Existing");
    const cancelBtn = actionRow.components.find((b) => b.label === "Cancel");

    // 2. Staff Intruder attempts to click Replace
    const intruderReplace = {
      guild_id: "730000000000000000",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_intruder", username: "intruder" },
      },
      data: {
        custom_id: replaceBtn.custom_id,
      },
    };

    const res2 = await handlePunishmentComponent(intruderReplace, env, {});
    const body2 = await res2.json();
    assert.equal(body2.data.flags, 64);
    assert.match(body2.data.content, /Only the staff member who initiated this replacement can confirm it/);
    assert.equal(putCalled, false, "No changes made by intruder");

    // 3. Staff Intruder attempts to click Cancel
    const intruderCancel = {
      guild_id: "730000000000000000",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_intruder", username: "intruder" },
      },
      data: {
        custom_id: cancelBtn.custom_id,
      },
    };

    const res3 = await handlePunishmentComponent(intruderCancel, env, {});
    const body3 = await res3.json();
    assert.equal(body3.data.flags, 64);
    assert.match(body3.data.content, /Only the staff member who initiated this confirmation can cancel it/);

    // 4. Original staff Damon CAN cancel cleanly
    const ownerCancel = {
      guild_id: "730000000000000000",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "damon" },
      },
      data: {
        custom_id: cancelBtn.custom_id,
      },
    };

    const res4 = await handlePunishmentComponent(ownerCancel, env, {});
    const body4 = await res4.json();
    assert.equal(body4.type, 7);
    assert.match(body4.data.content, /Transcript replacement cancelled/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// =========================================================================
// 46. EXPIRED / STALE TOKEN
// =========================================================================
test("EXPIRED STATE: Expired or non-existent confirmation token produces Confirmation Expired without timeout", async () => {
  const env = await createMockEnv();

  const expiredInteraction = {
    guild_id: "730000000000000000",
    member: {
      roles: [env.STAFF_TEAM_ROLE_ID],
      user: { id: "staff_damon", username: "damon" },
    },
    data: {
      custom_id: `${PunishmentCustomId.BTN_CONFIRM_REPLACE_PREFIX}tx_expired_token_999`,
    },
  };

  const res = await handlePunishmentComponent(expiredInteraction, env, {});
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.type, 7, "Expired state must immediately update message (type 7)");
  assert.match(body.data.content, /⚠️ \*\*Confirmation Expired\*\*/);
  assert.match(body.data.content, /Please use Add to Punishment again\./);
});

// =========================================================================
// 47. DURABLE OBJECT PERSISTENCE ACROSS WORKER REQUESTS
// =========================================================================
test("DURABLE OBJECT PERSISTENCE: State persists across separate Worker requests and enforces single-use consumption", async () => {
  const env = await createMockEnv();
  const token = "tx_test_persist_12345";
  const context = {
    staffUserId: "staff_damon",
    punishmentId: "VRP-P-000002",
    transcriptType: "response",
    existingUrl: "https://existing.response.url",
    channelId: "chan_ticket_2",
    messageId: "msg_ticket_2",
    createdAt: Date.now(),
  };

  // Request 1: Save state to DO
  const saved = await savePendingReplacementContext({ env, token, context });
  assert.equal(saved, true);

  // Request 2: Read state from DO (separate request simulation)
  const retrieved = await getPendingReplacementContext({ env, token });
  assert.ok(retrieved);
  assert.equal(retrieved.punishmentId, "VRP-P-000002");
  assert.equal(retrieved.transcriptType, "response");
  assert.equal(retrieved.staffUserId, "staff_damon");

  // Request 3: Atomically consume state (single-use)
  const consumed = await consumePendingReplacementContext({ env, token });
  assert.ok(consumed);
  assert.equal(consumed.punishmentId, "VRP-P-000002");

  // Request 4: Subsequent read or consume must return null (prevents double execution)
  const emptyAfterConsume = await getPendingReplacementContext({ env, token });
  assert.equal(emptyAfterConsume, null);

  const consumeAgain = await consumePendingReplacementContext({ env, token });
  assert.equal(consumeAgain, null);
});

// =========================================================================
// 48. TOP-LEVEL WORKER ROUTING (HTTP INTERACTIONS)
// =========================================================================
test("TOP-LEVEL WORKER ROUTING: worker.fetch routes exact generated custom_id and unknown custom_id safely via HTTP Interactions", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const exported = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(exported).toString("hex");

  const baseEnv = await createMockEnv();
  const env = {
    ...baseEnv,
    DISCORD_PUBLIC_KEY: publicKeyHex,
  };

  async function makeSignedRequest(payload) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify(payload);
    const message = Buffer.concat([
      Buffer.from(timestamp, "utf-8"),
      Buffer.from(body, "utf-8"),
    ]);
    const sig = await crypto.subtle.sign("Ed25519", keyPair.privateKey, message);
    const signatureHex = Buffer.from(sig).toString("hex");

    return new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": signatureHex,
        "x-signature-timestamp": timestamp,
      },
      body,
    });
  }

  // 1. Generate real warning card on VRP-P-000002
  const token = "tx_worker_fetch_test";
  const context = {
    staffUserId: "staff_damon",
    punishmentId: "VRP-P-000002",
    transcriptType: "response",
    existingUrl: "https://existing.response.url",
    channelId: "chan_ticket_2",
    messageId: "msg_ticket_2",
    createdAt: Date.now(),
  };
  await savePendingReplacementContext({ env, token, context });

  const warningContainer = buildTranscriptOverwriteWarningContainer({
    punishmentId: "VRP-P-000002",
    transcriptType: "response",
    existingUrl: "https://existing.response.url",
    channelId: "chan_ticket_2",
    messageId: "msg_ticket_2",
    token,
  });

  const exactCancelCustomId = warningContainer.components[1].components[1].custom_id;

  // 2. Feed EXACT custom_id through worker.fetch
  const cancelPayload = {
    type: 3, // MESSAGE_COMPONENT
    guild_id: "730000000000000000",
    member: {
      roles: [env.STAFF_TEAM_ROLE_ID],
      user: { id: "staff_damon", username: "damon" },
    },
    data: {
      custom_id: exactCancelCustomId,
    },
  };

  const cancelReq = await makeSignedRequest(cancelPayload);
  const cancelRes = await worker.fetch(cancelReq, env, {});
  assert.equal(cancelRes.status, 200);

  const cancelJson = await cancelRes.json();
  assert.equal(cancelJson.type, 7);
  assert.match(cancelJson.data.content, /Transcript replacement cancelled/);

  // 3. Test unknown custom_id through worker.fetch
  const unknownPayload = {
    type: 3,
    guild_id: "730000000000000000",
    member: {
      roles: [env.STAFF_TEAM_ROLE_ID],
      user: { id: "staff_damon", username: "damon" },
    },
    data: {
      custom_id: "punish_unknown_future_button",
    },
  };

  const unknownReq = await makeSignedRequest(unknownPayload);
  const unknownRes = await worker.fetch(unknownReq, env, {});
  assert.equal(unknownRes.status, 200);

  const unknownJson = await unknownRes.json();
  assert.equal(unknownJson.type, 4);
  assert.match(unknownJson.data.content, /This action is no longer valid/);
});

test("RECENT LOGS: returns synchronous Type 4 ephemeralComponentsResponse (flags 32832) with recent records from D1", async () => {
  const env = await createMockEnv();
  await d1AppendPunishmentRecord({
    env,
    record: {
      punishmentId: "VRP-P-000001",
      createdAt: "2026-09-03T10:00:00.000Z",
      playerName: "PlayerOne",
      playerDiscordId: "123456789012345679",
      punishment: "Warning",
      punishmentLength: "",
      reason: "VDM",
      additionalInfo: "",
      reportUrl: "",
      responseUrl: "",
      ruleBroken: "",
      staffMember: "StaffDamon",
      staffDiscordId: "101",
      syncStatus: "Posted",
      normalizedName: "playerone",
    },
    action: "CREATED",
    staffInfo: { username: "StaffDamon", id: "101" },
  });
  await d1AppendPunishmentRecord({
    env,
    record: {
      punishmentId: "VRP-P-000002",
      createdAt: "2026-09-04T10:00:00.000Z",
      playerName: "PlayerTwo",
      playerDiscordId: "123456789012345678",
      punishment: "1 Day Ban",
      punishmentLength: "1 Day",
      reason: "RDM",
      additionalInfo: "",
      reportUrl: "",
      responseUrl: "",
      ruleBroken: "",
      staffMember: "StaffDamon",
      staffDiscordId: "101",
      syncStatus: "Posted",
      normalizedName: "playertwo",
    },
    action: "CREATED",
    staffInfo: { username: "StaffDamon", id: "101" },
  });

  const interaction = {
    application_id: "1544164852132618382",
    token: "mock_recent_token",
    member: {
      roles: [env.STAFF_TEAM_ROLE_ID],
      user: { id: "101", username: "StaffDamon" },
    },
    data: {
      custom_id: PunishmentCustomId.BTN_RECENT,
    },
  };

  const res = await handlePunishmentComponent(interaction, env, {});
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.type, 4, "Must return Type 4 (CHANNEL_MESSAGE_WITH_SOURCE) synchronously");
  assert.equal(body.data.flags, 32832, "Must include EPHEMERAL and IS_COMPONENTS_V2 flags (32832)");
  assert.ok(body.data.components, "Components must be present");
  assert.equal(body.data.components.length, 1);

  const container = body.data.components[0];
  assert.equal(container.type, ComponentType.CONTAINER);
  const textComponents = container.components.filter((c) => c.type === ComponentType.TEXT_DISPLAY);
  assert.match(textComponents[0].content, /RECENT PUNISHMENT LOGS/);
  assert.match(textComponents[0].content, /Showing the latest 2 punishment record\(s\)/);
});

test("RECENT LOGS: handles empty punishment records cleanly without timing out", async () => {
  const env = await createMockEnv();

  const interaction = {
    application_id: "1544164852132618382",
    token: "mock_empty_token",
    member: {
      roles: [env.STAFF_TEAM_ROLE_ID],
      user: { id: "101", username: "StaffDamon" },
    },
    data: {
      custom_id: PunishmentCustomId.BTN_RECENT,
    },
  };

  const res = await handlePunishmentComponent(interaction, env, {});
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.type, 4, "Must acknowledge immediately with Type 4");
  assert.equal(body.data.flags, 32832);

  const container = body.data.components[0];
  assert.equal(container.type, ComponentType.CONTAINER);
  const textComponents = container.components.filter((c) => c.type === ComponentType.TEXT_DISPLAY);
  assert.match(textComponents[0].content, /No recent punishment records found/);
  assert.match(textComponents[1].content, /No matching punishment records found\./);
});

test("RECENT LOGS: 7 records in D1 strictly respects Discord component limits (<= 40 components, <= 5 ActionRows)", async () => {
  const env = await createMockEnv();
  for (let i = 1; i <= 7; i++) {
    await d1AppendPunishmentRecord({
      env,
      record: {
        punishmentId: `VRP-P-00000${i}`,
        createdAt: "2026-09-04T10:00:00.000Z",
        playerName: `Player${i}`,
        playerDiscordId: `12345678901234567${i}`,
        punishment: "Warning",
        reason: `Reason ${i}`,
        staffName: "StaffDamon",
        staffDiscordId: "101",
        discordJumpUrl: "https://discord.com/channels/7300/1249/msg",
      },
    });
  }

  const interaction = {
    application_id: "1544164852132618382",
    token: "mock_recent_token",
    member: {
      roles: [env.STAFF_TEAM_ROLE_ID],
      user: { id: "101", username: "StaffDamon" },
    },
    data: {
      custom_id: PunishmentCustomId.BTN_RECENT,
    },
  };

  const res = await handlePunishmentComponent(interaction, env, {});
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.type, 4);
  const container = body.data.components[0];
  assert.equal(container.type, ComponentType.CONTAINER);

  const actionRows = container.components.filter((c) => c.type === ComponentType.ACTION_ROW);
  assert.ok(actionRows.length <= 5, `Action rows (${actionRows.length}) must not exceed 5`);

  let totalComponents = 1 + container.components.length;
  for (const c of container.components) {
    if (c.components) {
      totalComponents += c.components.length;
    }
  }
  assert.ok(totalComponents <= 40, `Total components (${totalComponents}) must not exceed Discord limit of 40`);
});

test("MY LOGS: 7 records in D1 strictly respects Discord component limits (<= 40 components, <= 5 ActionRows)", async () => {
  const env = await createMockEnv();
  for (let i = 1; i <= 7; i++) {
    await d1AppendPunishmentRecord({
      env,
      record: {
        punishmentId: `VRP-P-00000${i}`,
        createdAt: "2026-09-04T10:00:00.000Z",
        playerName: `Player${i}`,
        playerDiscordId: `12345678901234567${i}`,
        punishment: "Warning",
        reason: `Reason ${i}`,
        staffName: "StaffDamon",
        staffDiscordId: "101",
        discordJumpUrl: "https://discord.com/channels/7300/1249/msg",
      },
    });
  }

  const interaction = {
    application_id: "1544164852132618382",
    token: "mock_my_logs_token",
    member: {
      roles: [env.STAFF_TEAM_ROLE_ID],
      user: { id: "101", username: "StaffDamon" },
    },
    data: {
      custom_id: PunishmentCustomId.BTN_MY_LOGS,
    },
  };

  const res = await handlePunishmentComponent(interaction, env, {});
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.type, 4);
  const container = body.data.components[0];
  assert.equal(container.type, ComponentType.CONTAINER);

  const actionRows = container.components.filter((c) => c.type === ComponentType.ACTION_ROW);
  assert.ok(actionRows.length <= 5, `Action rows (${actionRows.length}) must not exceed 5`);

  let totalComponents = 1 + container.components.length;
  for (const c of container.components) {
    if (c.components) {
      totalComponents += c.components.length;
    }
  }
  assert.ok(totalComponents <= 40, `Total components (${totalComponents}) must not exceed Discord limit of 40`);
});

test("RECENT LOGS: unexpected error during fetch returns private error message", async () => {
  const env = await createMockEnv({
    PUNISHMENT_DB: {
      prepare: () => {
        throw new Error("D1 connection failed");
      },
    },
  });

  const interaction = {
    application_id: "1544164852132618382",
    token: "mock_err_token",
    member: {
      roles: [env.STAFF_TEAM_ROLE_ID],
      user: { id: "101", username: "StaffDamon" },
    },
    data: {
      custom_id: PunishmentCustomId.BTN_RECENT,
    },
  };

  const res = await handlePunishmentComponent(interaction, env, {});
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.type, 4, "Must return Type 4");
  assert.equal(body.data.flags, 64, "Must be ephemeral");
  assert.match(body.data.content, /❌ \*\*Error retrieving recent punishments:\*\* D1 connection failed/);
});

// ============================================================================
// D1 DATA ACCESS LAYER (PUNISHMENTS & AUDITS)
// ============================================================================

test("D1 DAL: appendPunishmentRecord writes record and CREATED audit entry", async () => {
  const db = createMockD1Database();
  const env = { PUNISHMENT_DB: db };

  const record = {
    punishmentId: "VRP-P-000100",
    createdAt: "2026-09-12T12:00:00.000Z",
    playerName: "TestUser",
    playerDiscordId: "111222333444555666",
    punishment: "Ban",
    punishmentLength: "3 Days",
    reason: "Rule violation",
    additionalInfo: "First offense",
    reportUrl: "https://vitalrp.co.uk/reports/100",
    responseUrl: "",
    evidenceImageUrl: "https://vitalrp.co.uk/img/100.png",
    staffName: "StaffMember",
    staffDiscordId: "999888777666555444",
    guildId: "730015674348601384",
    logChannelId: "1249517344099668078",
  };

  const res = await d1AppendPunishmentRecord({ env, record });
  assert.equal(res.status, "SUCCESS");
  assert.equal(res.rowIndex, 1);

  const found = await d1GetPunishmentById({ env, punishmentId: "VRP-P-000100" });
  assert.ok(found);
  assert.equal(found.punishmentId, "VRP-P-000100");
  assert.equal(found.playerName, "TestUser");
  assert.equal(found.playerDiscordId, "111222333444555666");
  assert.equal(found.punishment, "Ban");
  assert.equal(found.punishmentLength, "3 Days");
  assert.equal(found.reason, "Rule violation");
  assert.equal(found.syncStatus, SyncStatus.PENDING);

  const audits = await d1GetPunishmentAudits({ env, punishmentId: "VRP-P-000100" });
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, AuditAction.CREATED);
  assert.equal(audits[0].changedByName, "StaffMember");
});

test("D1 DAL: getRecentPunishments orders by id DESC limit", async () => {
  const db = createMockD1Database();
  const env = { PUNISHMENT_DB: db };

  for (let i = 1; i <= 5; i++) {
    await d1AppendPunishmentRecord({
      env,
      record: {
        punishmentId: `VRP-P-00000${i}`,
        playerName: `Player ${i}`,
        playerDiscordId: `10000000000000000${i}`,
        punishment: "Warning",
        reason: `Reason ${i}`,
        staffName: "Staff",
        staffDiscordId: "100",
      },
    });
  }

  const recent = await d1GetRecentPunishments({ env, limit: 3 });
  assert.equal(recent.length, 3);
  assert.equal(recent[0].punishmentId, "VRP-P-000005");
  assert.equal(recent[1].punishmentId, "VRP-P-000004");
  assert.equal(recent[2].punishmentId, "VRP-P-000003");
});

test("D1 DAL: getMyPunishments filters by staffDiscordId", async () => {
  const db = createMockD1Database();
  const env = { PUNISHMENT_DB: db };

  await d1AppendPunishmentRecord({
    env,
    record: {
      punishmentId: "VRP-P-000010",
      playerName: "Alice",
      punishment: "Warning",
      reason: "Spam",
      staffName: "StaffA",
      staffDiscordId: "staff_a_id",
    },
  });
  await d1AppendPunishmentRecord({
    env,
    record: {
      punishmentId: "VRP-P-000011",
      playerName: "Bob",
      punishment: "Warning",
      reason: "Trolling",
      staffName: "StaffB",
      staffDiscordId: "staff_b_id",
    },
  });

  const mine = await d1GetMyPunishments({ env, staffDiscordId: "staff_a_id" });
  assert.equal(mine.length, 1);
  assert.equal(mine[0].punishmentId, "VRP-P-000010");
  assert.equal(mine[0].staffDiscordId, "staff_a_id");
});

test("D1 DAL: getPlayerHistory matches by Discord ID and falls back to player name", async () => {
  const db = createMockD1Database();
  const env = { PUNISHMENT_DB: db };

  await d1AppendPunishmentRecord({
    env,
    record: {
      punishmentId: "VRP-P-000020",
      playerName: "UniqueName",
      playerDiscordId: "999000111222333444",
      punishment: "Ban",
      reason: "Exploiting",
      staffName: "Staff",
      staffDiscordId: "1",
    },
  });
  await d1AppendPunishmentRecord({
    env,
    record: {
      punishmentId: "VRP-P-000021",
      playerName: "NoDiscordIdPlayer",
      playerDiscordId: "N/A",
      punishment: "Warning",
      reason: "OOC",
      staffName: "Staff",
      staffDiscordId: "1",
    },
  });

  // By Discord ID
  const byId = await d1GetPlayerHistory({ env, discordIdOrName: "999000111222333444" });
  assert.equal(byId.records.length, 1);
  assert.equal(byId.records[0].punishmentId, "VRP-P-000020");
  assert.equal(byId.isNameFallback, false);

  // Fallback by name
  const byName = await d1GetPlayerHistory({ env, discordIdOrName: "nodiscordidplayer" });
  assert.equal(byName.records.length, 1);
  assert.equal(byName.records[0].punishmentId, "VRP-P-000021");
  assert.equal(byName.isNameFallback, true);
});

test("D1 DAL: getLatestPunishmentsByDiscordId strictly matches Discord ID without name fallback", async () => {
  const db = createMockD1Database();
  const env = { PUNISHMENT_DB: db };

  await d1AppendPunishmentRecord({
    env,
    record: {
      punishmentId: "VRP-P-000030",
      playerName: "TargetUser",
      playerDiscordId: "123123123123123123",
      punishment: "Warning",
      reason: "RDM",
      staffName: "Staff",
      staffDiscordId: "1",
    },
  });
  await d1AppendPunishmentRecord({
    env,
    record: {
      punishmentId: "VRP-P-000031",
      playerName: "TargetUser",
      playerDiscordId: "999999999999999999",
      punishment: "Warning",
      reason: "VDM",
      staffName: "Staff",
      staffDiscordId: "1",
    },
  });

  const { records, totalCount } = await d1GetLatestPunishmentsByDiscordId({
    env,
    playerDiscordId: "123123123123123123",
    limit: 5,
  });

  assert.equal(totalCount, 1);
  assert.equal(records.length, 1);
  assert.equal(records[0].punishmentId, "VRP-P-000030");
});

test("D1 DAL: searchPunishments ranks exact ID > numeric ID > Discord ID > name > partial", async () => {
  const db = createMockD1Database();
  const env = { PUNISHMENT_DB: db };

  await d1AppendPunishmentRecord({
    env,
    record: {
      punishmentId: "VRP-P-000040",
      playerName: "Johnathan Smith",
      playerDiscordId: "101010101010101010",
      punishment: "Ban",
      reason: "Rule 1",
      staffName: "Staff",
      staffDiscordId: "1",
    },
  });
  await d1AppendPunishmentRecord({
    env,
    record: {
      punishmentId: "VRP-P-000041",
      playerName: "Johnny",
      playerDiscordId: "202020202020202020",
      punishment: "Warning",
      reason: "Rule 2",
      staffName: "Staff",
      staffDiscordId: "1",
    },
  });

  // Exact ID search
  const byExactId = await d1SearchPunishments({ env, query: "VRP-P-000040" });
  assert.equal(byExactId.length, 1);
  assert.equal(byExactId[0].punishmentId, "VRP-P-000040");

  // Numeric sequence search (41 -> VRP-P-000041)
  const byNumeric = await d1SearchPunishments({ env, query: "41" });
  assert.equal(byNumeric.length, 1);
  assert.equal(byNumeric[0].punishmentId, "VRP-P-000041");

  // Partial name search ("john")
  const byPartial = await d1SearchPunishments({ env, query: "john" });
  assert.equal(byPartial.length, 2);
});

test("D1 DAL: updatePunishmentRecord updates fields and writes EDITED audit entry", async () => {
  const db = createMockD1Database();
  const env = { PUNISHMENT_DB: db };

  await d1AppendPunishmentRecord({
    env,
    record: {
      punishmentId: "VRP-P-000050",
      playerName: "InitialName",
      playerDiscordId: "111111111111111111",
      punishment: "Warning",
      reason: "Old Reason",
      staffName: "StaffA",
      staffDiscordId: "101",
    },
  });

  const updateRes = await d1UpdatePunishmentRecord({
    env,
    punishmentId: "VRP-P-000050",
    updatedFields: {
      playerName: "UpdatedName",
      reason: "New Updated Reason",
    },
    staffInfo: { name: "StaffB", id: "102" },
  });

  assert.equal(updateRes.success, true);
  assert.equal(updateRes.updatedRecord.playerName, "UpdatedName");
  assert.equal(updateRes.updatedRecord.reason, "New Updated Reason");
  assert.match(updateRes.changesSummary, /Changed Player Name/);
  assert.match(updateRes.changesSummary, /Updated Reason/);

  // Check database reflects changes
  const fresh = await d1GetPunishmentById({ env, punishmentId: "VRP-P-000050" });
  assert.equal(fresh.playerName, "UpdatedName");
  assert.equal(fresh.reason, "New Updated Reason");

  // Check audit entry added
  const audits = await d1GetPunishmentAudits({ env, punishmentId: "VRP-P-000050" });
  assert.equal(audits.length, 2); // 1 CREATED, 1 EDITED
  assert.equal(audits[1].action, AuditAction.EDITED);
  assert.equal(audits[1].changedByName, "StaffB");
  assert.equal(audits[1].changedByDiscordId, "102");
});

test("D1 DAL: updatePunishmentSyncStatus updates status and jump URL", async () => {
  const db = createMockD1Database();
  const env = { PUNISHMENT_DB: db };

  await d1AppendPunishmentRecord({
    env,
    record: {
      punishmentId: "VRP-P-000060",
      playerName: "SyncTestUser",
      punishment: "Kick",
      reason: "AFK",
      staffName: "Staff",
      staffDiscordId: "1",
    },
  });

  const syncRes = await d1UpdatePunishmentSyncStatus({
    env,
    punishmentId: "VRP-P-000060",
    logMessageId: "987654321098765432",
    discordJumpUrl: "https://discord.com/channels/730/124/987",
    syncStatus: SyncStatus.POSTED,
    staffInfo: { name: "Staff", id: "1" },
  });

  assert.equal(syncRes.success, true);

  const updated = await d1GetPunishmentById({ env, punishmentId: "VRP-P-000060" });
  assert.equal(updated.syncStatus, SyncStatus.POSTED);
  assert.equal(updated.logMessageId, "987654321098765432");
  assert.equal(updated.discordJumpUrl, "https://discord.com/channels/730/124/987");
});

test("D1 DAL: handles missing D1 binding with descriptive error", () => {
  assert.throws(
    () => {
      getDatabase({});
    },
    /Missing PUNISHMENT_DB D1 database binding/
  );
});
