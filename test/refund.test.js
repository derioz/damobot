import test from "node:test";
import assert from "node:assert/strict";
import {
  PunishmentSequenceDO,
  formatRefundId,
  extractRefundNumericSequence,
} from "../src/durableObjects/punishmentSequence.js";
import { StickyBotDO } from "../src/durableObjects/stickyBot.js";
import {
  formatRefundDate,
  formatRefundLog,
  createRefundActionRow,
  isValidUrl,
  normalizeUrl,
} from "../src/refund/formatter.js";
import {
  buildRefundCenterContainer,
  buildRefundUserSelectPrompt,
  buildRefundModal,
  buildManualRefundModal,
  buildSearchRefundModal,
  buildRefundSearchResultsContainer,
  buildPlayerRefundHistoryContainer,
  buildRefundRecordNotFoundContainer,
  buildRefundHistoryUnavailableContainer,
  buildNoRefundHistoryContainer,
  buildEditRefundModal,
} from "../src/refund/components.js";
import {
  initRefundSheet,
  appendRefundRecord,
  updateRefundSyncStatus,
  appendRefundAuditEntry,
  mapRowToRefund,
  fetchAllRefunds,
  searchRefunds,
  getPlayerRefundHistory,
  getRefundsByPlayerDiscordId,
  getRecentRefunds,
  getMyRefunds,
  getRefundById,
} from "../src/refund/sheets.js";
import {
  getDatabase,
  createMockD1Database,
  updateRefundRecord,
  getRefundAudits,
  appendRefundRecord as appendD1RefundRecord,
  getRefundById as getD1RefundById,
} from "../src/refund/db.js";
import {
  verifyStaffRole,
  canEditRefundRecord,
  openRefundCenter,
  handleRefundCommand,
  handleRefundComponent,
  handleRefundModalSubmit,
} from "../src/refund/handlers.js";
import {
  DEFAULT_REFUND_LOG_CHANNEL_ID,
  DEFAULT_STAFF_TEAM_ROLE_ID,
  DEFAULT_OWNER_ROLE_ID,
  DEFAULT_REFUND_SHEET_TAB,
  DEFAULT_REFUND_AUDIT_TAB,
  RefundCategory,
  RefundCustomId,
  SyncStatus,
  AuditAction,
  ComponentType,
  ButtonStyle,
  REFUND_SHEET_COLUMNS,
  REFUND_CATEGORY_OPTIONS,
  EPHEMERAL_FLAG,
  IS_COMPONENTS_V2_FLAG,
  buildRefundPlayerHistoryCustomId,
  buildRefundHistoryPageCustomId,
  parseRefundComponentCustomId,
} from "../src/refund/constants.js";
import { DAMO_BOT_VERSION, VITAL_RP_LOGO_URL } from "../src/config.js";
import { commands } from "../scripts/register-commands.js";
import worker from "../src/index.js";

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
    STAFF_TEAM_ROLE_ID: "743422836223246366",
    REFUND_LOG_CHANNEL_ID: "1289638609535766631",
    REFUND_SHEET_ID: "mock_refund_sheet_123",
    REFUND_SHEET_TAB: "Refund Log",
    REFUND_AUDIT_TAB: "Refund Audits",
    GOOGLE_SERVICE_ACCOUNT_EMAIL: "mock-sa@project.iam.gserviceaccount.com",
    GOOGLE_PRIVATE_KEY: pem,
    DISCORD_BOT_TOKEN: "mock_bot_token",
    DISCORD_GUILD_ID: "730015674348601384",
    PUNISHMENT_SEQUENCE: {
      idFromName: () => "global",
      get: () => doStub,
    },
    ENVIRONMENT: "test",
    ...overrides,
  };
}

// 1. REFUND ID HELPERS
test("REFUND ID: formatRefundId pads to 6 digits", () => {
  assert.equal(formatRefundId(1), "VRP-R-000001");
  assert.equal(formatRefundId(142), "VRP-R-000142");
  assert.equal(formatRefundId(999999), "VRP-R-999999");
});

test("REFUND ID: extractRefundNumericSequence parses various formats", () => {
  assert.equal(extractRefundNumericSequence("VRP-R-000001"), 1);
  assert.equal(extractRefundNumericSequence("vrp-r-000042"), 42);
  assert.equal(extractRefundNumericSequence("000042"), 42);
  assert.equal(extractRefundNumericSequence("123"), 123);
  assert.equal(extractRefundNumericSequence("invalid"), null);
});

// 2. ATOMIC REFUND SEQUENCE DO
test("REFUND SEQUENCE DO: allocateNextRefundId allocates sequential IDs", () => {
  const doInstance = new PunishmentSequenceDO({}, {});
  const id1 = doInstance.allocateNextRefundId();
  const id2 = doInstance.allocateNextRefundId();
  const id3 = doInstance.allocateNextRefundId();

  assert.equal(id1.sequence, 1);
  assert.equal(id1.refundId, "VRP-R-000001");
  assert.equal(id2.sequence, 2);
  assert.equal(id2.refundId, "VRP-R-000002");
  assert.equal(id3.sequence, 3);
  assert.equal(id3.refundId, "VRP-R-000003");
});

test("REFUND SEQUENCE DO: concurrent allocations return distinct sequential IDs", async () => {
  const doInstance = new PunishmentSequenceDO({}, {});
  const promises = Array.from({ length: 10 }, () =>
    Promise.resolve(doInstance.allocateNextRefundId())
  );
  const results = await Promise.all(promises);
  const ids = results.map((r) => r.refundId);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, 10);
});

test("REFUND SEQUENCE DO: syncRefundSequence updates next_val without dropping", () => {
  const doInstance = new PunishmentSequenceDO({}, {});
  doInstance.syncRefundSequence(50);
  const next = doInstance.allocateNextRefundId();
  assert.equal(next.sequence, 50);

  doInstance.syncRefundSequence(10); // Should not decrease
  const nextAfterLower = doInstance.allocateNextRefundId();
  assert.equal(nextAfterLower.sequence, 51);
});

test("REFUND SEQUENCE DO: HTTP routes /sequence/refund/next, current, and sync", async () => {
  const doInstance = new PunishmentSequenceDO({}, {});

  // Current
  const curRes = await doInstance.fetch(new Request("https://do/sequence/refund/current"));
  assert.equal(curRes.status, 200);
  const curData = await curRes.json();
  assert.equal(curData.nextSequence, 1);

  // Next
  const nextRes = await doInstance.fetch(
    new Request("https://do/sequence/refund/next", { method: "POST" })
  );
  assert.equal(nextRes.status, 200);
  const nextData = await nextRes.json();
  assert.equal(nextData.refundId, "VRP-R-000001");

  // Sync
  const syncRes = await doInstance.fetch(
    new Request("https://do/sequence/refund/sync", {
      method: "POST",
      body: JSON.stringify({ minNextVal: 100 }),
    })
  );
  assert.equal(syncRes.status, 200);

  const afterSyncRes = await doInstance.fetch(
    new Request("https://do/sequence/refund/next", { method: "POST" })
  );
  const afterSyncData = await afterSyncRes.json();
  assert.equal(afterSyncData.sequence, 100);
  assert.equal(afterSyncData.refundId, "VRP-R-000100");
});

// 3. REFUND FORMATTER
test("REFUND FORMATTER: formatRefundLog produces expected layout with ticket", () => {
  const record = {
    refundId: "VRP-R-000001",
    playerName: "John Doe",
    playerDiscordId: "150580708144840704",
    refundCategory: "Vitcoin",
    refundDetails: "50,000 Vitcoins",
    reason: "Accidental double charge on vehicle purchase.",
    ticketUrl: "https://tickettool.xyz/direct/transcript/123456",
    staffName: "Damo",
    staffDiscordId: "123456789012345678",
    createdAt: "2026-09-04T21:52:00.000Z",
  };

  const output = formatRefundLog(record);
  assert.match(output, /💰 \*\*Refund Logged\*\* • `VRP-R-000001`/);
  assert.match(output, /\*\*John Doe\*\* • `150580708144840704`/);
  assert.match(output, /\*\*Category:\*\* Vitcoin/);
  assert.match(output, /\*\*Details:\*\* 50,000 Vitcoins/);
  assert.match(output, /> Accidental double charge on vehicle purchase\./);
  assert.match(output, /\*\*Ticket:\*\* https:\/\/tickettool\.xyz\/direct\/transcript\/123456/);
  assert.match(output, /Logged by \*\*Damo\*\*/);
  assert.match(output, /Staff ID: `123456789012345678`/);
});

test("REFUND FORMATTER: formatRefundLog handles missing discord ID and omitted ticket", () => {
  const record = {
    refundId: "VRP-R-000002",
    playerName: "Jane Doe",
    playerDiscordId: "N/A",
    refundCategory: "Cash",
    refundDetails: "$25,000 Cash",
    reason: "Lost cash in bank robbery bug.",
    ticketUrl: "",
    staffName: "StaffMember",
    staffDiscordId: "",
  };

  const output = formatRefundLog(record);
  assert.match(output, /💰 \*\*Refund Logged\*\* • `VRP-R-000002`/);
  assert.match(output, /\*\*Jane Doe\*\*/);
  assert.ok(!output.includes("`N/A`"));
  assert.ok(!output.includes("**Ticket:**"));
  assert.ok(!output.includes("Staff ID:"));
});

test("REFUND FORMATTER: createRefundActionRow generates Ticket, Edit Record, and Player History buttons", () => {
  const record = {
    refundId: "VRP-R-000001",
    playerDiscordId: "150580708144840704",
    ticketUrl: "https://tickettool.xyz/direct/transcript/123",
  };

  const rows = createRefundActionRow(record);
  assert.equal(rows.length, 1);
  const buttons = rows[0].components;
  assert.equal(buttons.length, 3);

  assert.equal(buttons[0].type, ComponentType.BUTTON);
  assert.equal(buttons[0].style, ButtonStyle.LINK);
  assert.equal(buttons[0].url, "https://tickettool.xyz/direct/transcript/123");
  assert.equal(buttons[0].label, "Ticket");

  assert.equal(buttons[1].type, ComponentType.BUTTON);
  assert.equal(buttons[1].style, ButtonStyle.SECONDARY);
  assert.equal(buttons[1].custom_id, `${RefundCustomId.BTN_EDIT_PREFIX}VRP-R-000001`);
  assert.equal(buttons[1].label, "Edit Record");

  assert.equal(buttons[2].type, ComponentType.BUTTON);
  assert.equal(buttons[2].style, ButtonStyle.SECONDARY);
  assert.equal(buttons[2].custom_id, buildRefundPlayerHistoryCustomId("VRP-R-000001"));
  assert.equal(buttons[2].label, "Player History");
});

test("REFUND FORMATTER: createRefundActionRow omits Ticket button when URL is invalid", () => {
  const record = {
    refundId: "VRP-R-000002",
    playerName: "John Doe",
    playerDiscordId: "N/A",
    ticketUrl: "not-a-valid-url",
  };

  const rows = createRefundActionRow(record);
  assert.equal(rows.length, 1);
  const buttons = rows[0].components;
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].custom_id, `${RefundCustomId.BTN_EDIT_PREFIX}VRP-R-000002`);
  assert.equal(buttons[1].custom_id, buildRefundPlayerHistoryCustomId("VRP-R-000002"));
});

// 4. GOOGLE SHEETS SERVICE
test("REFUND SHEETS: mapRowToRefund correctly maps all 16 columns", () => {
  const row = [
    "VRP-R-000001",
    "2026-09-04T12:00:00Z",
    "John Doe",
    "150580708144840704",
    "Vitcoin",
    "50,000 Vitcoins",
    "Double charge",
    "https://tickettool.xyz/123",
    "Damo",
    "123456789",
    "730015674348601384",
    "1289638609535766631",
    "999888777",
    "https://discord.com/channels/1/2/3",
    "Posted",
    "john doe",
  ];

  const mapped = mapRowToRefund(row, 5);
  assert.equal(mapped.rowIndex, 5);
  assert.equal(mapped.refundId, "VRP-R-000001");
  assert.equal(mapped.playerName, "John Doe");
  assert.equal(mapped.playerDiscordId, "150580708144840704");
  assert.equal(mapped.refundCategory, "Vitcoin");
  assert.equal(mapped.refundDetails, "50,000 Vitcoins");
  assert.equal(mapped.reason, "Double charge");
  assert.equal(mapped.ticketUrl, "https://tickettool.xyz/123");
  assert.equal(mapped.staffName, "Damo");
  assert.equal(mapped.staffDiscordId, "123456789");
  assert.equal(mapped.guildId, "730015674348601384");
  assert.equal(mapped.logChannelId, "1289638609535766631");
  assert.equal(mapped.logMessageId, "999888777");
  assert.equal(mapped.discordJumpUrl, "https://discord.com/channels/1/2/3");
  assert.equal(mapped.syncStatus, "Posted");
  assert.equal(mapped.normalizedPlayerName, "john doe");
});

test("REFUND SHEETS: appendRefundRecord appends row to Refund Log and writes audit entry", async () => {
  const env = await createMockEnv();

  const mockCalls = [];
  const customFetch = async (url, options = {}) => {
    mockCalls.push({ url, options });

    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }), { status: 200 });
    }

    if (url.includes(":append")) {
      return new Response(
        JSON.stringify({
          updates: { updatedRange: "'Refund Log'!A5:P5" },
        }),
        { status: 200 }
      );
    }

    return new Response("OK", { status: 200 });
  };

  const record = {
    refundId: "VRP-R-000001",
    playerName: "John Doe",
    playerDiscordId: "150580708144840704",
    refundCategory: "Vitcoin",
    refundDetails: "50,000 Vitcoins",
    reason: "Test reason",
    ticketUrl: "https://tickettool.xyz/123",
    staffName: "Damo",
    staffDiscordId: "123456789",
    guildId: "730015674348601384",
    logChannelId: "1289638609535766631",
  };

  const result = await appendRefundRecord({ env, record, customFetch });
  assert.equal(result.status, "SUCCESS");
  assert.equal(result.rowIndex, 5);

  // Check append payload: exactly 16 columns with normalizedPlayerName at index 15
  const logAppendCall = mockCalls.find(
    (c) => c.url.includes("Refund%20Log!A%3AP:append") || c.url.includes("Refund%20Log")
  );
  assert.ok(logAppendCall);
  const body = JSON.parse(logAppendCall.options.body);
  assert.equal(body.values[0].length, 16);
  assert.equal(body.values[0][0], "VRP-R-000001");
  assert.equal(body.values[0][14], SyncStatus.PENDING);
  assert.equal(body.values[0][15], "john doe");

  // Check audit append
  const auditCall = mockCalls.find((c) => c.url.includes("Refund%20Audits"));
  assert.ok(auditCall);
  const auditBody = JSON.parse(auditCall.options.body);
  assert.equal(auditBody.values[0][1], "VRP-R-000001");
  assert.equal(auditBody.values[0][2], AuditAction.CREATED);
});

test("REFUND SHEETS: updateRefundSyncStatus updates columns M:O in 16-col schema", async () => {
  const env = await createMockEnv();

  let updatedRangeUrl = "";
  let updatedBody = null;

  const customFetch = async (url, options = {}) => {
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }), { status: 200 });
    }
    if (options.method === "PUT") {
      updatedRangeUrl = url;
      updatedBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response("OK", { status: 200 });
  };

  const res = await updateRefundSyncStatus({
    env,
    rowIndex: 7,
    logMessageId: "987654321",
    discordJumpUrl: "https://discord.com/channels/1/2/3",
    syncStatus: SyncStatus.POSTED,
    staffInfo: { name: "Damo", id: "123" },
    refundId: "VRP-R-000001",
    customFetch,
  });

  assert.equal(res.success, true);
  assert.ok(updatedRangeUrl.includes("Refund%20Log!M7%3AO7"));
  assert.deepEqual(updatedBody.values, [
    ["987654321", "https://discord.com/channels/1/2/3", "Posted"],
  ]);
});

test("REFUND SHEETS: searchRefunds prioritizes ID, Discord ID, name, and filters category", async () => {
  const env = await createMockEnv();

  const mockRows = [
    [
      "VRP-R-000001",
      "2026-09-04T10:00:00Z",
      "Alice Smith",
      "111111111111111111",
      "Vitcoin",
      "10k Vitcoin",
      "Double charge",
      "",
      "Staff1",
      "100",
      "1",
      "2",
      "3",
      "",
      "Posted",
      "alice smith",
    ],
    [
      "VRP-R-000002",
      "2026-09-04T11:00:00Z",
      "Bob Jones",
      "222222222222222222",
      "Cash",
      "$50k Cash",
      "Heist glitch",
      "",
      "Staff2",
      "200",
      "1",
      "2",
      "3",
      "",
      "Posted",
      "bob jones",
    ],
    [
      "VRP-R-000003",
      "2026-09-04T12:00:00Z",
      "Charlie Brown",
      "333333333333333333",
      "S-Coin",
      "100 S-Coins",
      "Store delivery error",
      "",
      "Staff1",
      "100",
      "1",
      "2",
      "3",
      "",
      "Posted",
      "charlie brown",
    ],
  ];

  const customFetch = async (url) => {
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }), { status: 200 });
    }
    return new Response(JSON.stringify({ values: mockRows }), { status: 200 });
  };

  // Search by exact Refund ID
  const idResults = await searchRefunds({ env, query: "VRP-R-000002", customFetch });
  assert.equal(idResults.length, 1);
  assert.equal(idResults[0].playerName, "Bob Jones");

  // Search by numeric sequence
  const numResults = await searchRefunds({ env, query: "3", customFetch });
  assert.equal(numResults.length, 1);
  assert.equal(numResults[0].refundId, "VRP-R-000003");

  // Search by Discord ID
  const discordResults = await searchRefunds({ env, query: "111111111111111111", customFetch });
  assert.equal(discordResults.length, 1);
  assert.equal(discordResults[0].playerName, "Alice Smith");

  // Filter by category
  const vitcoinResults = await searchRefunds({ env, query: "", categoryFilter: "Vitcoin", customFetch });
  assert.equal(vitcoinResults.length, 1);
  assert.equal(vitcoinResults[0].refundCategory, "Vitcoin");

  // Filter that excludes
  const cashOnly = await searchRefunds({ env, query: "Charlie", categoryFilter: "Cash", customFetch });
  assert.equal(cashOnly.length, 0);
});

test("REFUND SHEETS: getPlayerRefundHistory matches Discord ID or name fallback", async () => {
  const env = await createMockEnv();

  const mockRows = [
    [
      "VRP-R-000001",
      "2026-09-04T10:00:00Z",
      "Player One",
      "123456789012345678",
      "Cash",
      "$10k",
      "Bug",
      "",
      "Staff",
      "1",
      "",
      "",
      "",
      "",
      "Posted",
      "player one",
    ],
  ];

  const customFetch = async (url) => {
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }), { status: 200 });
    }
    return new Response(JSON.stringify({ values: mockRows }), { status: 200 });
  };

  // By Discord ID
  const res1 = await getPlayerRefundHistory({ env, discordIdOrName: "123456789012345678", customFetch });
  assert.equal(res1.records.length, 1);
  assert.equal(res1.isNameFallback, false);

  // By Name
  const res2 = await getPlayerRefundHistory({ env, discordIdOrName: "Player One", customFetch });
  assert.equal(res2.records.length, 1);
  assert.equal(res2.isNameFallback, true);
});

test("REFUND SHEETS: getRecentRefunds and getMyRefunds return sorted records", async () => {
  const env = await createMockEnv();

  const mockRows = [
    [
      "VRP-R-000001",
      "2026-09-04T10:00:00Z",
      "Player 1",
      "",
      "Vitcoin",
      "10k",
      "",
      "",
      "StaffA",
      "999",
      "",
      "",
      "",
      "",
      "Posted",
      "player 1",
    ],
    [
      "VRP-R-000002",
      "2026-09-04T11:00:00Z",
      "Player 2",
      "",
      "Cash",
      "$20k",
      "",
      "",
      "StaffB",
      "888",
      "",
      "",
      "",
      "",
      "Posted",
      "player 2",
    ],
  ];

  const customFetch = async (url) => {
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }), { status: 200 });
    }
    return new Response(JSON.stringify({ values: mockRows }), { status: 200 });
  };

  const recents = await getRecentRefunds({ env, limit: 1, customFetch });
  assert.equal(recents.length, 1);
  assert.equal(recents[0].refundId, "VRP-R-000002"); // Newest row (rowIndex 3 > rowIndex 2)

  const myLogs = await getMyRefunds({ env, staffDiscordId: "999", customFetch });
  assert.equal(myLogs.length, 1);
  assert.equal(myLogs[0].staffName, "StaffA");
});

test("REFUND SHEETS: getRefundById finds exact record", async () => {
  const env = await createMockEnv();

  const mockRows = [
    [
      "VRP-R-000042",
      "2026-09-04T10:00:00Z",
      "Player 42",
      "",
      "Other",
      "Vehicle livery",
      "Lost in garage",
      "",
      "Staff",
      "1",
      "",
      "",
      "",
      "",
      "Posted",
      "player 42",
    ],
  ];

  const customFetch = async (url) => {
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }), { status: 200 });
    }
    return new Response(JSON.stringify({ values: mockRows }), { status: 200 });
  };

  const rec = await getRefundById({ env, refundId: "vrp-r-000042", customFetch });
  assert.ok(rec);
  assert.equal(rec.refundDetails, "Vehicle livery");

  const nonExistent = await getRefundById({ env, refundId: "VRP-R-999999", customFetch });
  assert.equal(nonExistent, null);
});

// 5. DISCORD UI COMPONENTS
test("REFUND COMPONENTS: buildRefundCenterContainer creates Components V2 layout", () => {
  const container = buildRefundCenterContainer();
  assert.equal(container.type, ComponentType.CONTAINER);

  // Section with logo thumbnail
  const section = container.components.find((c) => c.type === ComponentType.SECTION);
  assert.ok(section);
  assert.equal(section.accessory.media.url, VITAL_RP_LOGO_URL);

  // ActionRow with 4 buttons
  const actionRow = container.components.find((c) => c.type === ComponentType.ACTION_ROW);
  assert.ok(actionRow);
  assert.equal(actionRow.components.length, 4);
  assert.equal(actionRow.components[0].custom_id, RefundCustomId.BTN_LOG);
  assert.equal(actionRow.components[1].custom_id, RefundCustomId.BTN_SEARCH);
  assert.equal(actionRow.components[2].custom_id, RefundCustomId.BTN_RECENT);
  assert.equal(actionRow.components[3].custom_id, RefundCustomId.BTN_MY_LOGS);

  // Footer with version
  const footer = container.components.find(
    (c) => c.type === ComponentType.TEXT_DISPLAY && c.content.includes(DAMO_BOT_VERSION)
  );
  assert.ok(footer);
});

test("REFUND COMPONENTS: buildRefundUserSelectPrompt creates UserSelect prompt", () => {
  const container = buildRefundUserSelectPrompt();
  assert.equal(container.type, ComponentType.CONTAINER);

  const userSelectRow = container.components.find(
    (c) => c.type === ComponentType.ACTION_ROW && c.components[0].type === ComponentType.USER_SELECT
  );
  assert.ok(userSelectRow);
  assert.equal(userSelectRow.components[0].custom_id, RefundCustomId.USER_SELECT);

  const btnRow = container.components.find(
    (c) => c.type === ComponentType.ACTION_ROW && c.components[0].type === ComponentType.BUTTON
  );
  assert.ok(btnRow);
  assert.equal(btnRow.components[0].custom_id, RefundCustomId.BTN_MANUAL);
  assert.equal(btnRow.components.length, 1);
});

test("REFUND COMPONENTS: buildRefundModal creates modal with 5 inputs", () => {
  const modal = buildRefundModal({ userId: "150580708144840704", displayName: "John Doe" });
  assert.equal(modal.title, "Log Refund");
  assert.equal(modal.custom_id, `${RefundCustomId.MODAL_SUBMIT_PREFIX}150580708144840704`);
  assert.equal(modal.components.length, 5);

  // Check components
  assert.equal(modal.components[0].components[0].custom_id, "player_name");
  assert.equal(modal.components[0].components[0].value, "John Doe");

  assert.equal(modal.components[1].component.custom_id, "refund_category");
  assert.equal(modal.components[1].component.options.length, 4);

  assert.equal(modal.components[2].components[0].custom_id, "refund_details");
  assert.equal(modal.components[3].components[0].custom_id, "reason");
  assert.equal(modal.components[4].components[0].custom_id, "ticket_url");
});

test("REFUND COMPONENTS: buildManualRefundModal creates modal with 5 inputs", () => {
  const modal = buildManualRefundModal();
  assert.equal(modal.title, "Log Refund (Manual Entry)");
  assert.equal(modal.custom_id, `${RefundCustomId.MODAL_SUBMIT_PREFIX}manual`);
  assert.equal(modal.components.length, 5);

  assert.equal(modal.components[0].components[0].custom_id, "player_name");
  assert.equal(modal.components[1].components[0].custom_id, "player_discord_id");
  assert.equal(modal.components[2].component.custom_id, "refund_category");
  assert.equal(modal.components[3].components[0].custom_id, "refund_details");
  assert.equal(modal.components[4].components[0].custom_id, "reason");
});

test("REFUND COMPONENTS: buildRefundSearchResultsContainer includes category filters and pagination", () => {
  const records = Array.from({ length: 8 }, (_, i) => ({
    rowIndex: i + 2,
    refundId: `VRP-R-${String(i + 1).padStart(6, "0")}`,
    playerName: `Player ${i + 1}`,
    playerDiscordId: "123",
    refundCategory: "Vitcoin",
    refundDetails: "10,000 Vitcoins",
    reason: "Test reason",
    createdAt: "2026-09-04T12:00:00Z",
    discordJumpUrl: "https://discord.com/channels/1/2/3",
    ticketUrl: "https://tickettool.xyz/123",
  }));

  const container = buildRefundSearchResultsContainer({
    title: "🔎 TEST RESULTS",
    records,
    page: 1,
    pageSize: 5,
    queryKey: "test",
    categoryFilter: "Vitcoin",
  });

  assert.equal(container.type, ComponentType.CONTAINER);

  // ActionRow with 5 category filter buttons
  const filterRow = container.components.find(
    (c) => c.type === ComponentType.ACTION_ROW && c.components.length === 5
  );
  assert.ok(filterRow);
  assert.equal(filterRow.components[1].style, ButtonStyle.PRIMARY); // Vitcoin is selected

  // Pagination row because total pages = 2
  const paginationRow = container.components.find(
    (c) => c.type === ComponentType.ACTION_ROW && c.components.length === 2 && c.components[0].label === "Previous"
  );
  assert.ok(paginationRow);
  assert.equal(paginationRow.components[0].disabled, true); // First page
  assert.equal(paginationRow.components[1].disabled, false);
});

// 6. SECURITY & ACCESS CONTROL
test("SECURITY: Non-staff user running /refund is rejected ephemerally", async () => {
  const env = await createMockEnv();
  const interaction = {
    member: {
      roles: ["111222333"], // Not StaffTeam
      user: { id: "999" },
    },
    data: { name: "refund" },
  };

  const res = await handleRefundCommand(interaction, env);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.data.flags, 64); // EPHEMERAL
  assert.match(data.data.content, /only available to Vital RP staff/);
});

test("SECURITY: Administrator without StaffTeam role is strictly rejected (no admin bypass)", async () => {
  const env = await createMockEnv();
  const interaction = {
    member: {
      permissions: "8", // Administrator permission
      roles: ["admin_role_id"], // Missing STAFF_TEAM_ROLE_ID
      user: { id: "999" },
    },
    data: { name: "refund" },
  };

  const res = await handleRefundCommand(interaction, env);
  const data = await res.json();
  assert.equal(data.data.flags, 64);
  assert.match(data.data.content, /only available to Vital RP staff/);
});

test("SECURITY: Owner role member (DEFAULT_OWNER_ROLE_ID) without StaffTeam role can open Refund Center", async () => {
  const env = await createMockEnv();
  const interaction = {
    member: {
      roles: [DEFAULT_OWNER_ROLE_ID],
      user: { id: "owner_user_refund" },
    },
    data: { name: "refund" },
  };

  const res = await handleRefundCommand(interaction, env);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.data.components[0].type, ComponentType.CONTAINER);
  assert.match(data.data.components[0].components[0].components[0].content, /Staff Refund Center/);
});

test("SECURITY: Custom env.OWNER_ROLE_ID is respected for /refund command", async () => {
  const env = await createMockEnv();
  env.OWNER_ROLE_ID = "888777666555444333";
  const interaction = {
    member: {
      roles: ["888777666555444333"],
      user: { id: "custom_owner_refund" },
    },
    data: { name: "refund" },
  };

  const res = await handleRefundCommand(interaction, env);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.data.components[0].type, ComponentType.CONTAINER);
  assert.match(data.data.components[0].components[0].components[0].content, /Staff Refund Center/);
});

// 7. SLASH COMMANDS & INTERACTIONS
test("SLASH COMMAND: /refund opens Refund Center", async () => {
  const env = await createMockEnv();
  const interaction = {
    member: {
      roles: ["743422836223246366"],
      user: { id: "123" },
    },
    data: { name: "refund" },
  };

  const res = await handleRefundCommand(interaction, env);
  const data = await res.json();
  assert.equal(data.data.components[0].type, ComponentType.CONTAINER);
  assert.match(data.data.components[0].components[0].components[0].content, /Staff Refund Center/);
});

test("SLASH COMMAND: /refund log opens UserSelect prompt", async () => {
  const env = await createMockEnv();
  const interaction = {
    member: {
      roles: ["743422836223246366"],
      user: { id: "123" },
    },
    data: {
      name: "refund",
      options: [{ name: "log" }],
    },
  };

  const res = await handleRefundCommand(interaction, env);
  const data = await res.json();
  assert.equal(data.data.components[0].type, ComponentType.CONTAINER);
  assert.match(data.data.components[0].components[0].content, /Log Player Refund/);
});

test("COMPONENT INTERACTION: UserSelect returns Modal", async () => {
  const env = await createMockEnv();
  const interaction = {
    member: {
      roles: ["743422836223246366"],
      user: { id: "123" },
    },
    data: {
      custom_id: RefundCustomId.USER_SELECT,
      values: ["444555666"],
      resolved: {
        users: {
          "444555666": {
            username: "selected_player",
            global_name: "Selected Player",
          },
        },
      },
    },
  };

  const res = await handleRefundComponent(interaction, env);
  const data = await res.json();
  assert.equal(data.type, 9); // APPLICATION_MODAL
  assert.equal(data.data.custom_id, `${RefundCustomId.MODAL_SUBMIT_PREFIX}444555666`);
});

test("COMPONENT INTERACTION: Manual Entry button returns Manual Modal", async () => {
  const env = await createMockEnv();
  const interaction = {
    member: {
      roles: ["743422836223246366"],
      user: { id: "123" },
    },
    data: {
      custom_id: RefundCustomId.BTN_MANUAL,
    },
  };

  const res = await handleRefundComponent(interaction, env);
  const data = await res.json();
  assert.equal(data.type, 9);
  assert.equal(data.data.custom_id, `${RefundCustomId.MODAL_SUBMIT_PREFIX}manual`);
});

test("MODAL SUBMIT: logs refund, writes to sheet, posts to Discord, and marks Posted", async () => {
  const env = await createMockEnv();

  // Mock global fetch for Google Sheets token and append, and Discord message post
  let postedDiscordMessage = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }), { status: 200 });
    }
    if (urlStr.includes(":append")) {
      return new Response(
        JSON.stringify({ updates: { updatedRange: "'Refund Log'!A2:P2" } }),
        { status: 200 }
      );
    }
    if (options.method === "PUT") {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (urlStr.includes("/messages")) {
      postedDiscordMessage = JSON.parse(options.body);
      return new Response(
        JSON.stringify({ id: "discord_log_msg_123" }),
        { status: 200 }
      );
    }
    return new Response("OK", { status: 200 });
  };

  try {
    const interaction = {
      member: {
        roles: ["743422836223246366"],
        nick: "Damo",
        user: { id: "123456789" },
      },
      guild_id: "730015674348601384",
      data: {
        custom_id: `${RefundCustomId.MODAL_SUBMIT_PREFIX}150580708144840704`,
        components: [
          { components: [{ custom_id: "player_name", value: "Test Player" }] },
          { component: { custom_id: "refund_category", values: ["Vitcoin"] } },
          { components: [{ custom_id: "refund_details", value: "50,000 Vitcoins" }] },
          { components: [{ custom_id: "reason", value: "Double charge glitch" }] },
          { components: [{ custom_id: "ticket_url", value: "https://tickettool.xyz/123" }] },
        ],
      },
    };

    const res = await handleRefundModalSubmit(interaction, env);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.match(data.data.content, /✅ \*\*Refund Logged Successfully\*\*/);
    assert.match(data.data.content, /VRP-R-000001/);

    assert.ok(postedDiscordMessage);
    assert.match(postedDiscordMessage.content, /💰 \*\*Refund Logged\*\* • `VRP-R-000001`/);
    assert.match(postedDiscordMessage.content, /\*\*Category:\*\* Vitcoin/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 8. STICKY BOT INTEGRATION
test("STICKY BOT: buildStickyComponents builds refund_center and both buttons", () => {
  const stickyDO = new StickyBotDO({}, {});

  // None
  assert.equal(stickyDO.buildStickyComponents({ button_action: "none" }), null);

  // Refund Center
  const refundComp = stickyDO.buildStickyComponents({ button_action: "refund_center" });
  assert.ok(refundComp);
  assert.equal(refundComp[0].components[0].custom_id, "sticky:refund_center");
  assert.equal(refundComp[0].components[0].label, "Open Refund Center");
  assert.equal(refundComp[0].components[0].emoji.name, "💰");

  // Both buttons
  const bothComp = stickyDO.buildStickyComponents({ button_action: "both" });
  assert.ok(bothComp);
  assert.equal(bothComp[0].components.length, 2);
  assert.equal(bothComp[0].components[0].custom_id, "sticky:punishment_center");
  assert.equal(bothComp[0].components[0].emoji.name, "🛡️");
  assert.equal(bothComp[0].components[1].custom_id, "sticky:refund_center");
  assert.equal(bothComp[0].components[1].emoji.name, "💰");
});

test("STICKY BOT: clicking sticky:refund_center as staff member opens Refund Center ephemerally", async () => {
  const env = await createMockEnv();
  const interaction = {
    member: {
      roles: ["743422836223246366"],
      user: { id: "123" },
    },
    data: { custom_id: "sticky:refund_center" },
  };

  const res = await openRefundCenter(interaction, env);
  const data = await res.json();
  assert.equal(data.data.flags, 64 | 32768);
  assert.match(data.data.components[0].components[0].components[0].content, /Staff Refund Center/);
});

// 9. OVERVIEW CATALOG
test("OVERVIEW: commands and catalog include /refund and Refund Center feature", () => {
  const refundCmd = commands.find((c) => c.name === "refund");
  assert.ok(refundCmd);
  assert.equal(refundCmd.options[0].name, "log");
});

// 10. MODAL VALIDATION & FAILURE HANDLING
test("MODAL VALIDATION: rejects missing required fields and invalid ticket URLs", async () => {
  const env = await createMockEnv();

  const baseInteraction = {
    member: {
      roles: ["743422836223246366"],
      nick: "Staff",
      user: { id: "123" },
    },
    guild_id: "730015674348601384",
    data: {
      custom_id: `${RefundCustomId.MODAL_SUBMIT_PREFIX}manual`,
      components: [
        { components: [{ custom_id: "player_name", value: "Test Player" }] },
        { component: { custom_id: "refund_category", values: ["Cash"] } },
        { components: [{ custom_id: "refund_details", value: "$5,000 Cash" }] },
        { components: [{ custom_id: "reason", value: "Valid reason" }] },
      ],
    },
  };

  // 1. Missing player name
  const missingName = JSON.parse(JSON.stringify(baseInteraction));
  missingName.data.components[0].components[0].value = "";
  const res1 = await handleRefundModalSubmit(missingName, env);
  const data1 = await res1.json();
  assert.match(data1.data.content, /Player \/ Character Name is required/);

  // 2. Missing refund details
  const missingDetails = JSON.parse(JSON.stringify(baseInteraction));
  missingDetails.data.components[2].components[0].value = "";
  const res2 = await handleRefundModalSubmit(missingDetails, env);
  const data2 = await res2.json();
  assert.match(data2.data.content, /Refund Details are required/);

  // 3. Missing reason
  const missingReason = JSON.parse(JSON.stringify(baseInteraction));
  missingReason.data.components[3].components[0].value = "";
  const res3 = await handleRefundModalSubmit(missingReason, env);
  const data3 = await res3.json();
  assert.match(data3.data.content, /Reason is required/);

  // 4. Invalid ticket URL
  const invalidTicket = JSON.parse(JSON.stringify(baseInteraction));
  invalidTicket.data.components.push({
    components: [{ custom_id: "ticket_url", value: "not-a-url" }],
  });
  const res4 = await handleRefundModalSubmit(invalidTicket, env);
  const data4 = await res4.json();
  assert.match(data4.data.content, /Invalid Ticket URL format/);
});

test("FAILURE HANDLING: Discord post failure updates sync status to Post Failed and warns staff", async () => {
  const env = await createMockEnv();

  let syncStatusUpdated = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }), { status: 200 });
    }
    if (urlStr.includes(":append")) {
      return new Response(
        JSON.stringify({ updates: { updatedRange: "'Refund Log'!A2:P2" } }),
        { status: 200 }
      );
    }
    if (options.method === "PUT") {
      const body = JSON.parse(options.body);
      syncStatusUpdated = body.values[0][2];
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (urlStr.includes("/messages")) {
      // Simulate Discord 500 error
      return new Response("Internal Server Error", { status: 500 });
    }
    return new Response("OK", { status: 200 });
  };

  try {
    const interaction = {
      member: {
        roles: ["743422836223246366"],
        nick: "Damo",
        user: { id: "123456789" },
      },
      guild_id: "730015674348601384",
      data: {
        custom_id: `${RefundCustomId.MODAL_SUBMIT_PREFIX}manual`,
        components: [
          { components: [{ custom_id: "player_name", value: "Bob" }] },
          { components: [{ custom_id: "player_discord_id", value: "111" }] },
          { component: { custom_id: "refund_category", values: ["Cash"] } },
          { components: [{ custom_id: "refund_details", value: "$5,000" }] },
          { components: [{ custom_id: "reason", value: "Bank error" }] },
        ],
      },
    };

    const res = await handleRefundModalSubmit(interaction, env);
    const data = await res.json();
    assert.match(data.data.content, /Refund Saved to (?:Database|Sheet), but Discord Posting Failed/);
    assert.match(data.data.content, /Post Failed/);
    assert.equal(syncStatusUpdated, SyncStatus.POST_FAILED);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 11. SEARCH MODAL SUBMISSION
test("SEARCH MODAL SUBMIT: rejects blank query and returns results for valid query", async () => {
  const env = await createMockEnv();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }), { status: 200 });
    }
    return new Response(
      JSON.stringify({
        values: [
          [
            "VRP-R-000001",
            "2026-09-04T12:00:00Z",
            "Target Player",
            "123",
            "Cash",
            "$500",
            "Reason",
            "",
            "Staff",
            "1",
            "",
            "",
            "",
            "",
            "Posted",
            "target player",
          ],
        ],
      }),
      { status: 200 }
    );
  };

  try {
    // Blank query
    const blankInteraction = {
      member: { roles: ["743422836223246366"], user: { id: "1" } },
      data: {
        custom_id: RefundCustomId.MODAL_SEARCH,
        components: [{ components: [{ custom_id: "search_query", value: "" }] }],
      },
    };
    const res1 = await handleRefundModalSubmit(blankInteraction, env);
    const data1 = await res1.json();
    assert.match(data1.data.content, /Search query cannot be blank/);

    // Valid query
    const validInteraction = {
      member: { roles: ["743422836223246366"], user: { id: "1" } },
      data: {
        custom_id: RefundCustomId.MODAL_SEARCH,
        components: [{ components: [{ custom_id: "search_query", value: "Target Player" }] }],
      },
    };
    const res2 = await handleRefundModalSubmit(validInteraction, env);
    const data2 = await res2.json();
    assert.equal(data2.data.components[0].type, ComponentType.CONTAINER);
    assert.match(data2.data.components[0].components[0].content, /REFUND SEARCH RESULTS/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 12. BUTTON INTERACTIONS (LOG, DISMISS, RECENT, MY LOGS, FILTER, PAGE)
test("COMPONENT INTERACTIONS: handles BTN_LOG, BTN_DISMISS, BTN_RECENT, BTN_MY_LOGS, and filters", async () => {
  const env = await createMockEnv();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }), { status: 200 });
    }
    return new Response(
      JSON.stringify({
        values: [
          [
            "VRP-R-000001",
            "2026-09-04T12:00:00Z",
            "P1",
            "123",
            "Vitcoin",
            "100",
            "Test",
            "",
            "Damo",
            "123",
            "",
            "",
            "",
            "",
            "Posted",
            "p1",
          ],
        ],
      }),
      { status: 200 }
    );
  };

  try {
    const baseInteraction = {
      member: { roles: ["743422836223246366"], user: { id: "123" } },
    };

    // BTN_LOG
    const resLog = await handleRefundComponent(
      { ...baseInteraction, data: { custom_id: RefundCustomId.BTN_LOG } },
      env
    );
    const dataLog = await resLog.json();
    assert.equal(dataLog.type, 4);
    assert.equal(dataLog.data.flags, 32832);
    assert.match(dataLog.data.components[0].components[0].content, /Log Player Refund/);

    // BTN_DISMISS
    const resDismiss = await handleRefundComponent(
      { ...baseInteraction, data: { custom_id: RefundCustomId.BTN_DISMISS } },
      env
    );
    const dataDismiss = await resDismiss.json();
    assert.match(dataDismiss.data.components[0].components[0].components[0].content, /Staff Refund Center/);

    // BTN_RECENT
    const resRecent = await handleRefundComponent(
      { ...baseInteraction, data: { custom_id: RefundCustomId.BTN_RECENT } },
      env
    );
    const dataRecent = await resRecent.json();
    assert.equal(dataRecent.type, 4);
    assert.equal(dataRecent.data.flags, 32832);
    assert.match(dataRecent.data.components[0].components[0].content, /RECENT REFUNDS/);
    const recentActionRows = dataRecent.data.components[0].components.filter((c) => c.type === 1);
    assert.ok(recentActionRows.length <= 5, "Recent refunds container must never exceed Discord 5 action row limit");

    // BTN_MY_LOGS
    const resMy = await handleRefundComponent(
      { ...baseInteraction, data: { custom_id: RefundCustomId.BTN_MY_LOGS } },
      env
    );
    const dataMy = await resMy.json();
    assert.equal(dataMy.type, 4);
    assert.equal(dataMy.data.flags, 32832);
    assert.match(dataMy.data.components[0].components[0].content, /MY REFUNDS/);
    const myActionRows = dataMy.data.components[0].components.filter((c) => c.type === 1);
    assert.ok(myActionRows.length <= 5, "My refunds container must never exceed Discord 5 action row limit");

    // Filter button
    const resFilter = await handleRefundComponent(
      {
        ...baseInteraction,
        data: { custom_id: `${RefundCustomId.BTN_FILTER_PREFIX}Vitcoin:__recent__:1` },
      },
      env
    );
    const dataFilter = await resFilter.json();
    assert.match(dataFilter.data.components[0].components[0].content, /RECENT REFUNDS/);

    // Page button
    const resPage = await handleRefundComponent(
      {
        ...baseInteraction,
        data: { custom_id: `${RefundCustomId.BTN_PAGE_PREFIX}next:__recent__:Vitcoin:2` },
      },
      env
    );
    const dataPage = await resPage.json();
    assert.match(dataPage.data.components[0].components[0].content, /RECENT REFUNDS/);

    // Unknown custom_id
    const resUnknown = await handleRefundComponent(
      { ...baseInteraction, data: { custom_id: "refund_unknown_test_action" } },
      env
    );
    const dataUnknown = await resUnknown.json();
    assert.match(dataUnknown.data.content, /This refund action is no longer valid/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 13. TOP-LEVEL WORKER ROUTING
test("TOP-LEVEL WORKER ROUTING: worker.fetch routes /refund, components, and modals safely", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const hexPublicKey = Buffer.from(rawPublicKey).toString("hex");

  const env = await createMockEnv({
    DISCORD_PUBLIC_KEY: hexPublicKey,
  });

  async function sendSignedRequest(bodyObj) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const bodyStr = JSON.stringify(bodyObj);
    const message = new TextEncoder().encode(timestamp + bodyStr);

    const signatureBytes = await crypto.subtle.sign(
      "Ed25519",
      keyPair.privateKey,
      message
    );
    const signatureHex = Buffer.from(signatureBytes).toString("hex");

    const req = new Request("http://localhost/", {
      method: "POST",
      headers: {
        "X-Signature-Ed25519": signatureHex,
        "X-Signature-Timestamp": timestamp,
        "Content-Type": "application/json",
      },
      body: bodyStr,
    });

    return worker.fetch(req, env, {});
  }

  // 1. Slash command /refund
  const slashRes = await sendSignedRequest({
    type: 2, // APPLICATION_COMMAND
    member: {
      roles: ["743422836223246366"],
      user: { id: "123" },
    },
    data: { name: "refund" },
  });
  assert.equal(slashRes.status, 200);
  const slashData = await slashRes.json();
  assert.match(slashData.data.components[0].components[0].components[0].content, /Staff Refund Center/);

  // 2. Component interaction: sticky:refund_center
  const stickyBtnRes = await sendSignedRequest({
    type: 3, // MESSAGE_COMPONENT
    member: {
      roles: ["743422836223246366"],
      user: { id: "123" },
    },
    data: { custom_id: "sticky:refund_center" },
  });
  assert.equal(stickyBtnRes.status, 200);
  const stickyBtnData = await stickyBtnRes.json();
  assert.match(stickyBtnData.data.components[0].components[0].components[0].content, /Staff Refund Center/);

  // 3. Component interaction: damobot:refund_center
  const damobotBtnRes = await sendSignedRequest({
    type: 3, // MESSAGE_COMPONENT
    member: {
      roles: ["743422836223246366"],
      user: { id: "123" },
    },
    data: { custom_id: "damobot:refund_center" },
  });
  assert.equal(damobotBtnRes.status, 200);
  const damobotBtnData = await damobotBtnRes.json();
  assert.match(damobotBtnData.data.components[0].components[0].components[0].content, /Staff Refund Center/);

  // 4. Component interaction: refund_btn_log
  const logBtnRes = await sendSignedRequest({
    type: 3, // MESSAGE_COMPONENT
    member: {
      roles: ["743422836223246366"],
      user: { id: "123" },
    },
    data: { custom_id: RefundCustomId.BTN_LOG },
  });
  assert.equal(logBtnRes.status, 200);
  const logBtnData = await logBtnRes.json();
  assert.match(logBtnData.data.components[0].components[0].content, /Log Player Refund/);

  // 5. Modal submit: refund_modal_search with blank query
  const modalRes = await sendSignedRequest({
    type: 5, // MODAL_SUBMIT
    member: {
      roles: ["743422836223246366"],
      user: { id: "123" },
    },
    data: {
      custom_id: RefundCustomId.MODAL_SEARCH,
      components: [{ components: [{ custom_id: "search_query", value: "" }] }],
    },
  });
  assert.equal(modalRes.status, 200);
  const modalData = await modalRes.json();
  assert.match(modalData.content || modalData.data?.content, /Search query cannot be blank/);

  // 6. Real Player History button through top-level worker.fetch
  const realActionRow = createRefundActionRow({
    refundId: "VRP-R-000042",
    playerDiscordId: "323896916347715584",
  });
  const historyBtn = realActionRow[0].components.find((b) => b.label === "Player History");
  assert.ok(historyBtn, "Must generate Player History button");

  const playerHistoryRes = await sendSignedRequest({
    type: 3, // MESSAGE_COMPONENT
    application_id: "123456789012345678",
    token: "mock_signed_tok",
    member: {
      roles: ["743422836223246366"],
      user: { id: "123" },
    },
    data: {
      custom_id: historyBtn.custom_id,
    },
  });
  assert.equal(playerHistoryRes.status, 200);
  const playerHistoryData = await playerHistoryRes.json();
  assert.equal(playerHistoryData.type, 4, "worker.fetch must return Type 4 immediate ephemeral response");
  // Note: Without Google Sheets mock, the handler hits catch → ephemeralTextResponse (flags=64).
  // The full flow with data is tested in the dedicated integration test.
  assert.ok(playerHistoryData.data.flags, "worker.fetch must return response flags");
});


// 14. DEDICATED REFUND LOG CHANNEL & S-COIN OPTION VERIFICATION
test("S-COIN OPTION: S-Coin dropdown option has label, value, emoji, and NO description", () => {
  const scoinOpt = REFUND_CATEGORY_OPTIONS.find((opt) => opt.value === "S-Coin");
  assert.ok(scoinOpt, "S-Coin option must exist");
  assert.equal(scoinOpt.label, "S-Coin");
  assert.equal(scoinOpt.value, "S-Coin");
  assert.equal(scoinOpt.description, undefined, "S-Coin option must have no description");
  assert.deepEqual(scoinOpt.emoji, { name: "💎" });

  // Verify Vitcoin, Cash, and Other retain their descriptions
  const vitcoinOpt = REFUND_CATEGORY_OPTIONS.find((opt) => opt.value === "Vitcoin");
  assert.equal(vitcoinOpt.description, "In-game Vitcoin currency refund");
  const cashOpt = REFUND_CATEGORY_OPTIONS.find((opt) => opt.value === "Cash");
  assert.equal(cashOpt.description, "In-game cash currency refund");
  const otherOpt = REFUND_CATEGORY_OPTIONS.find((opt) => opt.value === "Other");
  assert.equal(otherOpt.description, "Custom item, vehicle, weapon, or other refund");

  // Verify buildRefundModal generates S-Coin without description
  const modal = buildRefundModal({ userId: "123", displayName: "Player" });
  const modalScoinOpt = modal.components[1].component.options.find(
    (opt) => opt.value === "S-Coin"
  );
  assert.ok(modalScoinOpt);
  assert.equal(modalScoinOpt.description, undefined);
});

test("DEDICATED LOG CHANNEL: every category (Vitcoin, Cash, S-Coin, Other) posts to 1289638609535766631 and never command channel", async () => {
  // Test all 4 categories
  const categories = ["Vitcoin", "Cash", "S-Coin", "Other"];

  for (const category of categories) {
    const env = await createMockEnv({
      // Notice: Even if PUNISHMENT_LOG_CHANNEL_ID is set, refunds MUST use 1289638609535766631
      PUNISHMENT_LOG_CHANNEL_ID: "999999999999999999",
      REFUND_LOG_CHANNEL_ID: undefined, // test fallback to DEFAULT_REFUND_LOG_CHANNEL_ID
    });

    let postedUrl = "";
    let postedBody = null;
    let sheetRowValues = null;
    let syncStatusValues = null;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);
      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "mock_token" }), { status: 200 });
      }
      if (urlStr.includes(":append")) {
        if (urlStr.includes("Refund%20Log") || urlStr.includes("Refund Log")) {
          sheetRowValues = JSON.parse(options.body).values[0];
        }
        return new Response(
          JSON.stringify({ updates: { updatedRange: "'Refund Log'!A10:P10" } }),
          { status: 200 }
        );
      }
      if (options.method === "PUT") {
        syncStatusValues = JSON.parse(options.body).values[0];
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (urlStr.includes("/messages")) {
        postedUrl = urlStr;
        postedBody = JSON.parse(options.body);
        return new Response(
          JSON.stringify({ id: `msg_${category}_12345` }),
          { status: 200 }
        );
      }
      return new Response("OK", { status: 200 });
    };

    try {
      const commandChannelId = "555555555555555555"; // Channel where staff executed command
      const interaction = {
        channel_id: commandChannelId,
        guild_id: "730015674348601384",
        member: {
          roles: ["743422836223246366"],
          nick: "StaffAdmin",
          user: { id: "100200300" },
        },
        data: {
          custom_id: `${RefundCustomId.MODAL_SUBMIT_PREFIX}150580708144840704`,
          components: [
            { components: [{ custom_id: "player_name", value: "Test Player" }] },
            { component: { custom_id: "refund_category", values: [category] } },
            { components: [{ custom_id: "refund_details", value: `100 units of ${category}` }] },
            { components: [{ custom_id: "reason", value: `Legitimate justification for ${category}` }] },
            { components: [{ custom_id: "ticket_url", value: "https://tickettool.xyz/direct/transcript/987" }] },
          ],
        },
      };

      const res = await handleRefundModalSubmit(interaction, env);
      assert.equal(res.status, 200);
      const data = await res.json();

      // 1. Staff receives EPHEMERAL confirmation, so command channel does NOT receive the public refund log
      assert.equal(data.data.flags, 64, "Response must be EPHEMERAL (flag 64)");
      assert.match(data.data.content, /✅ \*\*Refund Logged Successfully\*\*/);
      assert.match(data.data.content, /<#1289638609535766631>/);

      // 2. Log is posted to channel 1289638609535766631 (NOT command channel 555555555555555555)
      assert.ok(postedUrl.includes("/channels/1289638609535766631/messages"), `Must post to 1289638609535766631, got: ${postedUrl}`);
      assert.ok(!postedUrl.includes(commandChannelId), "Must never post to the command channel");
      assert.match(postedBody.content, new RegExp(`\\*\\*Category:\\*\\* ${category}`));

      // 3. Log Channel ID equals 1289638609535766631 in Google Sheet (Col L, index 11)
      assert.equal(sheetRowValues[11], "1289638609535766631", "Col L (Log Channel ID) must equal 1289638609535766631");

      // 4. Log Message ID is stored (Col M, index 0 of update)
      assert.equal(syncStatusValues[0], `msg_${category}_12345`, "Log Message ID must be stored");

      // 5. Discord Jump URL opens the correct refund log
      const expectedJumpUrl = `https://discord.com/channels/730015674348601384/1289638609535766631/msg_${category}_12345`;
      assert.equal(syncStatusValues[1], expectedJumpUrl, "Discord Jump URL must point to 1289638609535766631 and message ID");
      assert.match(data.data.content, new RegExp(expectedJumpUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

      // 6. Sync Status becomes Posted
      assert.equal(syncStatusValues[2], SyncStatus.POSTED, "Sync Status must become Posted");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});
// ==================================================
// TARGETED REGRESSION TESTS: REFUND PLAYER HISTORY
// ==================================================

test("REFUND PLAYER HISTORY: real refund formatter generates Player History button with exact custom_id and routes through production component router with immediate ACK", async () => {
  const env = await createMockEnv();

  // 1. Generate a REAL public refund log message using the production refund formatter
  const realRefundRecord = {
    refundId: "REF-000021",
    createdAt: "2026-09-04T16:30:00Z",
    playerName: "NNEZZIE",
    playerDiscordId: "323896916347715584",
    refundCategory: "Cash",
    refundDetails: "$50,000 refunded",
    reason: "Accidental charge on vehicle upgrade",
    ticketUrl: "https://tickettool.xyz/direct/transcript/12345",
    staffName: "Damon",
    staffDiscordId: "777888999",
    guildId: "730015674348601384",
    logChannelId: "1289638609535766631",
    logMessageId: "1234567890",
    discordJumpUrl: "https://discord.com/channels/730015674348601384/1289638609535766631/1234567890",
    syncStatus: SyncStatus.POSTED,
  };

  const actionRows = createRefundActionRow(realRefundRecord);
  assert.equal(actionRows.length, 1, "Must generate 1 ActionRow");

  // 2. Extract the Player History button custom_id from the real ActionRow
  const playerHistoryButton = actionRows[0].components.find((b) => b.label === "Player History");
  assert.ok(playerHistoryButton, "Player History button must exist");
  const exactCustomId = playerHistoryButton.custom_id;
  assert.equal(
    exactCustomId,
    buildRefundPlayerHistoryCustomId("REF-000021"),
    "Exact custom_id must match centralized helper"
  );
  assert.equal(exactCustomId, "refund_hist:REF-000021");

  // Mock Google Sheets and Discord webhook PATCH
  let webhookPatchedBody = null;
  let webhookPatchedUrl = null;

  const mockRows = [
    [
      "REF-000016",
      "2026-08-28T14:00:00Z",
      "NNEZZIE",
      "323896916347715584",
      "Vitcoin",
      "250 Vitcoin",
      "Event reward fix",
      "",
      "StaffName",
      "888999111",
      "730015674348601384",
      "1289638609535766631",
      "msg_16",
      "https://discord.com/channels/730015674348601384/1289638609535766631/msg_16",
      "Posted",
      "nnezzie",
    ],
    [
      "REF-000021",
      "2026-09-04T16:30:00Z",
      "NNEZZIE",
      "323896916347715584",
      "Cash",
      "$50,000 refunded",
      "Accidental charge on vehicle upgrade",
      "https://tickettool.xyz/direct/transcript/12345",
      "Damon",
      "777888999",
      "730015674348601384",
      "1289638609535766631",
      "1234567890",
      "https://discord.com/channels/730015674348601384/1289638609535766631/1234567890",
      "Posted",
      "nnezzie",
    ],
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = typeof url === "string" ? url : url.url;
    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }), { status: 200 });
    }
    if (urlStr.includes("sheets.googleapis.com")) {
      return new Response(JSON.stringify({ values: mockRows }), { status: 200 });
    }
    if (urlStr.includes("/webhooks/") && options.method === "PATCH") {
      webhookPatchedUrl = urlStr;
      webhookPatchedBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "mock_patched_msg" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const interaction = {
      application_id: "123456789012345678",
      token: "interaction_token_abc123",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon", username: "Damon" },
      },
      data: {
        custom_id: exactCustomId, // 3. Feed THAT EXACT custom_id through router
      },
    };

    const ctx = { waitUntil: () => {} };

    // 4. Confirm it routes and receives immediate synchronous response
    const res = await handleRefundComponent(interaction, env, ctx);
    assert.equal(res.status, 200);
    const body = await res.json();

    // Synchronous response must be Type 4 CHANNEL_MESSAGE_WITH_SOURCE and EPHEMERAL | IS_COMPONENTS_V2
    assert.equal(body.type, 4, "Must return Type 4 immediate ephemeral response");
    assert.equal(body.data.flags, EPHEMERAL_FLAG | IS_COMPONENTS_V2_FLAG, "Must be ephemeral Components V2 response");

    // 5. Verify the container is directly in the response body
    const container = body.data.components[0];
    assert.equal(container.type, ComponentType.CONTAINER);

    // Verify Header in UI
    const headerText = container.components[0].content;
    assert.match(headerText, /💸 \*\*Refund History\*\*/);
    assert.match(headerText, /\*\*NNEZZIE\*\*/);
    assert.match(headerText, /`323896916347715584`/);
    assert.match(headerText, /\*\*2 refund records\*\*/);

    // Verify Separator between entries
    assert.equal(container.components[1].type, ComponentType.SEPARATOR);

    // Verify Record 1 (REF-000021 - newest first)
    const card1 = container.components[2].content;
    assert.match(card1, /\*\*REF-000021\*\* • \*\*Cash\*\*/);
    assert.match(card1, /> \$50,000 refunded/);
    assert.match(card1, /Logged by Damon/);

    // Verify Link Button [ 🔗 View Refund ]
    const btnRow1 = container.components[3];
    assert.equal(btnRow1.type, ComponentType.ACTION_ROW);
    const viewBtn = btnRow1.components[0];
    assert.equal(viewBtn.style, ButtonStyle.LINK);
    assert.equal(viewBtn.label, "View Refund");
    assert.equal(viewBtn.url, "https://discord.com/channels/730015674348601384/1289638609535766631/1234567890");

    // Verify Separator
    assert.equal(container.components[4].type, ComponentType.SEPARATOR);

    // Verify Record 2 (REF-000016)
    const card2 = container.components[5].content;
    assert.match(card2, /\*\*REF-000016\*\* • \*\*Vitcoin\*\*/);
    assert.match(card2, /> 250 Vitcoin/);
    assert.match(card2, /Logged by StaffName/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("REFUND PLAYER HISTORY: synchronous lookup with slow storage still returns valid response", async () => {
  const env = await createMockEnv();

  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = typeof url === "string" ? url : url.url;
    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }), { status: 200 });
    }
    if (urlStr.includes("sheets.googleapis.com")) {
      return new Response(
        JSON.stringify({
          values: [
            [
              "REF-000001",
              "2026-09-04T12:00:00Z",
              "PlayerSlow",
              "112233445566778899",
              "Vitcoin",
              "50 Vitcoins",
              "Lag refund",
              "",
              "Damo",
              "1",
              "",
              "",
              "",
              "",
              "Posted",
              "playerslow",
            ],
          ],
        }),
        { status: 200 }
      );
    }
    return originalFetch(url, options);
  };

  try {
    const interaction = {
      application_id: "123456789012345678",
      token: "interaction_token_slow",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "staff_damon" },
      },
      data: {
        custom_id: "refund_hist:REF-000001",
      },
    };

    const ctx = { waitUntil: () => {} };
    const res = await handleRefundComponent(interaction, env, ctx);
    const body = await res.json();

    // Synchronous response must be Type 4 with IS_COMPONENTS_V2
    assert.equal(body.type, 4);
    assert.equal(body.data.flags, EPHEMERAL_FLAG | IS_COMPONENTS_V2_FLAG);
    assert.ok(body.data.components[0].type === ComponentType.CONTAINER);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("REFUND PLAYER HISTORY: lookup strictly uses exact Player Discord ID and prevents similar player names cross-matching", async () => {
  const env = await createMockEnv();

  const mockRows = [
    // Row 1: Target player older refund
    [
      "REF-000010",
      "2026-08-01T12:00:00Z",
      "NNEZZIE",
      "323896916347715584",
      "Vitcoin",
      "100 Vitcoin",
      "First refund",
      "",
      "Staff1",
      "1",
      "",
      "",
      "",
      "",
      "Posted",
      "nnezzie",
    ],
    // Row 2: DIFFERENT person who happens to share the exact same character name
    [
      "REF-000011",
      "2026-08-05T12:00:00Z",
      "NNEZZIE",
      "999999999999999999", // Different Discord ID!
      "Cash",
      "$1,000,000",
      "Different person completely",
      "",
      "Staff2",
      "2",
      "",
      "",
      "",
      "",
      "Posted",
      "nnezzie",
    ],
    // Row 3: Target player newer refund under changed name
    [
      "REF-000021",
      "2026-09-04T12:00:00Z",
      "NNEZZIE (New Nick)",
      "323896916347715584",
      "Cash",
      "$50,000",
      "Recent refund",
      "",
      "Damon",
      "3",
      "",
      "",
      "",
      "",
      "Posted",
      "nnezzie (new nick)",
    ],
  ];

  let webhookPatchedBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = typeof url === "string" ? url : url.url;
    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }), { status: 200 });
    }
    if (urlStr.includes("sheets.googleapis.com")) {
      return new Response(JSON.stringify({ values: mockRows }), { status: 200 });
    }
    if (urlStr.includes("/webhooks/")) {
      webhookPatchedBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "mock_patched_msg" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const interaction = {
      application_id: "123456789",
      token: "tok_lookup",
      member: { roles: [env.STAFF_TEAM_ROLE_ID], user: { id: "1" } },
      data: { custom_id: "refund_hist:REF-000021" },
    };

    const ctx = { waitUntil: () => {} };
    const res = await handleRefundComponent(interaction, env, ctx);
    const body = await res.json();

    assert.equal(body.type, 4);
    assert.equal(body.data.flags, EPHEMERAL_FLAG | IS_COMPONENTS_V2_FLAG);
    const container = body.data.components[0];

    // Must find exactly 2 records for 323896916347715584
    assert.match(container.components[0].content, /\*\*2 refund records\*\*/);

    // Must contain REF-000021 (Row 3) and REF-000010 (Row 1)
    const combinedContent = container.components.map((c) => c.content || "").join("\n");
    assert.match(combinedContent, /REF-000021/);
    assert.match(combinedContent, /REF-000010/);

    // Must NOT contain REF-000011 (Row 2 - different Discord ID despite same name)
    assert.ok(!combinedContent.includes("REF-000011"), "Must not include refund from different Discord ID");
    assert.ok(!combinedContent.includes("$1,000,000"), "Must not include details of different Discord ID");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("REFUND PLAYER HISTORY: edge cases - missing refund record handled", async () => {
  const env = await createMockEnv();

  let webhookPatchedBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = typeof url === "string" ? url : url.url;
    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }), { status: 200 });
    }
    if (urlStr.includes("sheets.googleapis.com")) {
      return new Response(JSON.stringify({ values: [] }), { status: 200 });
    }
    if (urlStr.includes("/webhooks/")) {
      webhookPatchedBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "mock_patched_msg" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const interaction = {
      application_id: "123456789",
      token: "tok_missing_record",
      member: { roles: [env.STAFF_TEAM_ROLE_ID], user: { id: "1" } },
      data: { custom_id: "refund_hist:REF-NONEXISTENT" },
    };

    const ctx = { waitUntil: () => {} };
    const res = await handleRefundComponent(interaction, env, ctx);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.type, 4);
    assert.equal(data.data.flags, EPHEMERAL_FLAG | IS_COMPONENTS_V2_FLAG);

    // Container should show "Refund Record Not Found"
    const content = data.data.components[0]?.components?.map((c) => c.content || "").join("\n") || "";
    assert.match(content, /Refund Record Not Found/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("REFUND PLAYER HISTORY: edge cases - missing Player Discord ID handled", async () => {
  const env = await createMockEnv();

  const mockRows = [
    [
      "REF-000005",
      "2026-08-01T12:00:00Z",
      "LegacyPlayer",
      "N/A", // Missing Discord user
      "Other",
      "Vehicle swap",
      "Old record",
      "",
      "Staff",
      "1",
      "",
      "",
      "",
      "",
      "Posted",
      "legacyplayer",
    ],
  ];

  let webhookPatchedBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = typeof url === "string" ? url : url.url;
    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }), { status: 200 });
    }
    if (urlStr.includes("sheets.googleapis.com")) {
      return new Response(JSON.stringify({ values: mockRows }), { status: 200 });
    }
    if (urlStr.includes("/webhooks/")) {
      webhookPatchedBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "mock_patched_msg" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const interaction = {
      application_id: "123456789",
      token: "tok_missing_id",
      member: { roles: [env.STAFF_TEAM_ROLE_ID], user: { id: "1" } },
      data: { custom_id: "refund_hist:REF-000005" },
    };

    const ctx = { waitUntil: () => {} };
    const res = await handleRefundComponent(interaction, env, ctx);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.type, 4);
    assert.equal(data.data.flags, EPHEMERAL_FLAG | IS_COMPONENTS_V2_FLAG);

    // Container should show "Refund History Unavailable"
    const content = data.data.components[0]?.components?.map((c) => c.content || "").join("\n") || "";
    assert.match(content, /Refund History Unavailable/);
    assert.match(content, /does not have a Discord user attached/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("REFUND PLAYER HISTORY: edge cases - zero history handled", async () => {
  const env = await createMockEnv();

  // Target record exists, but no previous/other records exist for this player
  const mockRows = [
    [
      "REF-000007",
      "2026-08-01T12:00:00Z",
      "Newbie",
      "444555666777888999",
      "Cash",
      "$100",
      "First ever",
      "",
      "Staff",
      "1",
      "",
      "",
      "",
      "",
      "Posted",
      "newbie",
    ],
  ];

  let webhookPatchedBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = typeof url === "string" ? url : url.url;
    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }), { status: 200 });
    }
    if (urlStr.includes("sheets.googleapis.com")) {
      // First call is getRefundById, which returns the record.
      // Second call is getRefundsByPlayerDiscordId, simulate zero matching
      return new Response(JSON.stringify({ values: mockRows }), { status: 200 });
    }
    if (urlStr.includes("/webhooks/")) {
      webhookPatchedBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "mock_patched_msg" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const interaction = {
      application_id: "123456789",
      token: "tok_single_or_zero",
      member: { roles: [env.STAFF_TEAM_ROLE_ID], user: { id: "1" } },
      data: { custom_id: "refund_hist:REF-000007" },
    };

    const ctx = { waitUntil: () => {} };
    const res = await handleRefundComponent(interaction, env, ctx);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.type, 4);
    assert.equal(data.data.flags, EPHEMERAL_FLAG | IS_COMPONENTS_V2_FLAG);
    assert.ok(data.data.components[0]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("REFUND PLAYER HISTORY: edge cases - storage failure handled", async () => {
  const env = await createMockEnv();

  let webhookPatchedBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = typeof url === "string" ? url : url.url;
    if (urlStr.includes("oauth2.googleapis.com/token")) {
      throw new Error("Google OAuth Network Timeout");
    }
    if (urlStr.includes("/webhooks/")) {
      webhookPatchedBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "mock_patched_msg" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const interaction = {
      application_id: "123456789",
      token: "tok_fail",
      member: { roles: [env.STAFF_TEAM_ROLE_ID], user: { id: "1" } },
      data: { custom_id: "refund_hist:REF-000001" },
    };

    const ctx = { waitUntil: () => {} };
    const res = await handleRefundComponent(interaction, env, ctx);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.type, 4);
    assert.match(data.data.content, /❌ Error retrieving player refund history/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("REFUND PLAYER HISTORY: edge cases - non-StaffTeam rejected", async () => {
  const env = await createMockEnv();

  const interaction = {
    member: {
      roles: ["999999999999999999"], // Not staff
      user: { id: "not_staff" },
    },
    data: {
      custom_id: "refund_hist:REF-000001",
    },
  };

  const res = await handleRefundComponent(interaction, env);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.data.flags, 64);
  assert.match(data.data.content, /❌ This feature is only available to Vital RP staff/);
});

test("REFUND PLAYER HISTORY: pagination navigates pages ephemerally, acknowledges immediately (Type 6), and stays scoped to player", async () => {
  const env = await createMockEnv();

  // Create 12 refund records for player 323896916347715584
  const mockRows = [];
  for (let i = 1; i <= 12; i++) {
    const id = `REF-${String(i).padStart(6, "0")}`;
    mockRows.push([
      id,
      `2026-08-${String(i).padStart(2, "0")}T12:00:00Z`,
      "NNEZZIE",
      "323896916347715584",
      i % 2 === 0 ? "Cash" : "Vitcoin",
      `${i * 100} currency`,
      `Reason #${i}`,
      "",
      "Damon",
      "1",
      "",
      "",
      "",
      "",
      "Posted",
      "nnezzie",
    ]);
  }

  let webhookPatchedBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = typeof url === "string" ? url : url.url;
    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }), { status: 200 });
    }
    if (urlStr.includes("sheets.googleapis.com")) {
      return new Response(JSON.stringify({ values: mockRows }), { status: 200 });
    }
    if (urlStr.includes("/webhooks/")) {
      webhookPatchedBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "mock_patched_msg" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    // 1. Initial lookup (Page 1)
    const interactionPage1 = {
      application_id: "123456789",
      token: "tok_p1",
      member: { roles: [env.STAFF_TEAM_ROLE_ID], user: { id: "1" } },
      data: { custom_id: "refund_hist:REF-000012" },
    };

    const ctxP1 = { waitUntil: () => {} };
    const resP1 = await handleRefundComponent(interactionPage1, env, ctxP1);
    assert.equal(resP1.status, 200);
    const bodyP1 = await resP1.json();
    assert.equal(bodyP1.type, 4); // Type 4 direct ephemeral response
    assert.equal(bodyP1.data.flags, EPHEMERAL_FLAG | IS_COMPONENTS_V2_FLAG);

    const containerP1 = bodyP1.data.components[0];
    const paginationText = containerP1.components.find((c) => c.content?.includes("Showing"));
    assert.ok(paginationText, "Must include pagination text on Page 1");
    assert.equal(paginationText.content, "Showing 1-5 of 12");

    const paginationRow = containerP1.components.find((c) =>
      c.components?.some((btn) => btn.label?.includes("Previous") || btn.label?.includes("Next"))
    );
    assert.ok(paginationRow, "Must include pagination ActionRow");
    const prevBtn = paginationRow.components[0];
    const nextBtn = paginationRow.components[1];
    assert.equal(prevBtn.disabled, true, "Previous button must be disabled on page 1");
    assert.equal(nextBtn.disabled, false, "Next button must be enabled on page 1");
    assert.equal(nextBtn.custom_id, buildRefundHistoryPageCustomId("323896916347715584", 2));

    // 2. Click Next Button (Page 2)
    const interactionPage2 = {
      application_id: "123456789",
      token: "tok_p2",
      member: { roles: [env.STAFF_TEAM_ROLE_ID], user: { id: "1" } },
      data: { custom_id: nextBtn.custom_id },
    };

    const ctxP2 = { waitUntil: () => {} };
    const resP2 = await handleRefundComponent(interactionPage2, env, ctxP2);
    assert.equal(resP2.status, 200);
    const bodyP2 = await resP2.json();
    // Pagination clicks must return Type 7 UPDATE_MESSAGE
    assert.equal(bodyP2.type, 7, "Must return Type 7 UPDATE_MESSAGE for pagination");

    const containerP2 = bodyP2.data.components[0];
    const paginationTextP2 = containerP2.components.find((c) => c.content?.includes("Showing"));
    assert.equal(paginationTextP2.content, "Showing 6-10 of 12");

    // 3. Click Next Button again (Page 3)
    const interactionPage3 = {
      application_id: "123456789",
      token: "tok_p3",
      member: { roles: [env.STAFF_TEAM_ROLE_ID], user: { id: "1" } },
      data: { custom_id: buildRefundHistoryPageCustomId("323896916347715584", 3) },
    };

    const ctxP3 = { waitUntil: () => {} };
    const resP3 = await handleRefundComponent(interactionPage3, env, ctxP3);
    assert.equal(resP3.status, 200);
    const bodyP3 = await resP3.json();

    const containerP3 = bodyP3.data.components[0];
    const paginationTextP3 = containerP3.components.find((c) => c.content?.includes("Showing"));
    assert.equal(paginationTextP3.content, "Showing 11-12 of 12");

    const paginationRowP3 = containerP3.components.find((c) =>
      c.components?.some((btn) => btn.label?.includes("Previous") || btn.label?.includes("Next"))
    );
    assert.equal(paginationRowP3.components[0].disabled, false, "Previous button enabled on page 3");
    assert.equal(paginationRowP3.components[1].disabled, true, "Next button disabled on last page");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("REFUND ROUTING: unknown refund custom_id gets safe response", async () => {
  const env = await createMockEnv();

  const interaction = {
    member: { roles: [env.STAFF_TEAM_ROLE_ID], user: { id: "staff1" } },
    data: { custom_id: "refund_unrecognized_action_button" },
  };

  const res = await handleRefundComponent(interaction, env);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.data.flags, 64);
  assert.match(data.data.content, /❌ \*\*This refund action is no longer valid\.\*\*/);
  assert.match(data.data.content, /Please reopen the Refund Center and try again/);
});

test("REFUND REGRESSION: punishment routing and history remain completely untouched", async () => {
  // Confirm punishment custom_ids do NOT get routed to refund handler
  assert.equal(parseRefundComponentCustomId("punish_hist:123456789").action, "NONE");
  assert.equal(parseRefundComponentCustomId("pun:rep:123").action, "NONE");
  assert.equal(parseRefundComponentCustomId("sticky:punishment_center").action, "NONE");
});

test("REFUND PLAYER HISTORY: existing live button with direct Discord ID (refund_hist:399373087172198400) acknowledges immediately with flag 32832 and renders player history", async () => {
  const env = await createMockEnv();

  const mockRows = [
    [
      "VRP-R-000003",
      "2026-09-04T19:15:00Z",
      "Boo Berry 👻",
      "399373087172198400",
      "Vitcoin",
      "50,000 Vitcoins",
      "Accidental double charge",
      "https://tickettool.xyz/direct/3",
      "Damo",
      "111222333444555666",
      "730015674348601384",
      "1289638609535766631",
      "999888777",
      "https://discord.com/channels/730015674348601384/1289638609535766631/999888777",
      SyncStatus.POSTED,
    ],
  ];

  let webhookPatchedBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = typeof url === "string" ? url : url.url;
    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }), { status: 200 });
    }
    if (urlStr.includes("sheets.googleapis.com")) {
      return new Response(JSON.stringify({ values: mockRows }), { status: 200 });
    }
    if (urlStr.includes("/webhooks/")) {
      webhookPatchedBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "mock_patched_msg" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const interaction = {
      application_id: "1544164852132618382",
      token: "tok_direct_discord_id",
      member: { roles: [env.STAFF_TEAM_ROLE_ID], user: { id: "1" } },
      data: { custom_id: "refund_hist:399373087172198400" },
    };

    const ctx = { waitUntil: () => {} };
    const res = await handleRefundComponent(interaction, env, ctx);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.type, 4, "Must return Type 4 immediate ephemeral response");
    assert.equal(body.data.flags, EPHEMERAL_FLAG | IS_COMPONENTS_V2_FLAG, "Must include both EPHEMERAL and IS_COMPONENTS_V2 flags (32832)");

    const container = body.data.components[0];
    assert.equal(container.type, 17, "Container must be Components V2 (type 17)");

    const header = container.components[0];
    assert.match(header.content, /Boo Berry 👻/);
    assert.match(header.content, /399373087172198400/);
    assert.match(header.content, /\*\*1 refund record\*\*/);

    const card = container.components.find((c) => c.content?.includes("VRP-R-000003"));
    assert.ok(card, "Must render VRP-R-000003 card");
    assert.match(card.content, /50,000 Vitcoins/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("REFUND PLAYER HISTORY: button with VRP-R-000003 prefix looks up record and renders player history", async () => {
  const env = await createMockEnv();

  const mockRows = [
    [
      "VRP-R-000003",
      "2026-09-04T19:15:00Z",
      "Boo Berry 👻",
      "399373087172198400",
      "Vitcoin",
      "50,000 Vitcoins",
      "Accidental double charge",
      "https://tickettool.xyz/direct/3",
      "Damo",
      "111222333444555666",
      "730015674348601384",
      "1289638609535766631",
      "999888777",
      "https://discord.com/channels/730015674348601384/1289638609535766631/999888777",
      SyncStatus.POSTED,
    ],
  ];

  let webhookPatchedBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = typeof url === "string" ? url : url.url;
    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }), { status: 200 });
    }
    if (urlStr.includes("sheets.googleapis.com")) {
      return new Response(JSON.stringify({ values: mockRows }), { status: 200 });
    }
    if (urlStr.includes("/webhooks/")) {
      webhookPatchedBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "mock_patched_msg" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const interaction = {
      application_id: "1544164852132618382",
      token: "tok_vrp_prefix",
      member: { roles: [env.STAFF_TEAM_ROLE_ID], user: { id: "1" } },
      data: { custom_id: "refund_hist:VRP-R-000003" },
    };

    const ctx = { waitUntil: () => {} };
    const res = await handleRefundComponent(interaction, env, ctx);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.type, 4);
    assert.equal(body.data.flags, EPHEMERAL_FLAG | IS_COMPONENTS_V2_FLAG);

    const container = body.data.components[0];
    const header = container.components[0];
    assert.match(header.content, /Boo Berry 👻/);
    assert.match(header.content, /399373087172198400/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("REFUND PLAYER HISTORY: compound key refund_hist:VRP-R-000003:399373087172198400 directly uses player Discord ID", async () => {
  const env = await createMockEnv();

  const mockRows = [
    [
      "VRP-R-000003",
      "2026-09-04T19:15:00Z",
      "Boo Berry 👻",
      "399373087172198400",
      "Vitcoin",
      "50,000 Vitcoins",
      "Accidental double charge",
      "https://tickettool.xyz/direct/3",
      "Damo",
      "111222333444555666",
      "730015674348601384",
      "1289638609535766631",
      "999888777",
      "https://discord.com/channels/730015674348601384/1289638609535766631/999888777",
      SyncStatus.POSTED,
    ],
  ];

  let webhookPatchedBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = typeof url === "string" ? url : url.url;
    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }), { status: 200 });
    }
    if (urlStr.includes("sheets.googleapis.com")) {
      return new Response(JSON.stringify({ values: mockRows }), { status: 200 });
    }
    if (urlStr.includes("/webhooks/")) {
      webhookPatchedBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "mock_patched_msg" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const interaction = {
      application_id: "1544164852132618382",
      token: "tok_compound",
      member: { roles: [env.STAFF_TEAM_ROLE_ID], user: { id: "1" } },
      data: { custom_id: "refund_hist:VRP-R-000003:399373087172198400" },
    };

    const ctx = { waitUntil: () => {} };
    const res = await handleRefundComponent(interaction, env, ctx);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.type, 4);
    assert.equal(body.data.flags, EPHEMERAL_FLAG | IS_COMPONENTS_V2_FLAG);

    const container = body.data.components[0];
    const header = container.components[0];
    assert.match(header.content, /Boo Berry 👻/);
    assert.match(header.content, /399373087172198400/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 45. FLEXIBLE TICKET URL SUPPORT: ANY LINK ACCEPTED
test("FLEXIBLE TICKET URL: normalizeUrl and isValidUrl accept arbitrary links, discord jump links, and schemes", () => {
  // Direct HTTP/HTTPS links
  assert.equal(isValidUrl("https://discord.com/channels/730000000000000000/1249517344099668078/12345"), true);
  assert.equal(isValidUrl("https://tickettool.xyz/direct/transcript/123"), true);
  assert.equal(isValidUrl("https://drive.google.com/file/d/xyz"), true);
  assert.equal(isValidUrl("http://custom-tickets.local/view?id=456"), true);
  assert.equal(isValidUrl("discord://-/channels/730000000000000000/1249517344099668078/12345"), true);

  // Normalization: prepends https:// if domain pattern without scheme
  assert.equal(
    normalizeUrl("discord.com/channels/730000000000000000/1249517344099668078/12345"),
    "https://discord.com/channels/730000000000000000/1249517344099668078/12345"
  );
  assert.equal(normalizeUrl("tickettool.xyz/direct/transcript/123"), "https://tickettool.xyz/direct/transcript/123");
  assert.equal(normalizeUrl("pastebin.com/raw/abc"), "https://pastebin.com/raw/abc");

  // Already has scheme -> untouched
  assert.equal(normalizeUrl("https://discord.com/test"), "https://discord.com/test");
  assert.equal(normalizeUrl("http://discord.com/test"), "http://discord.com/test");
  assert.equal(normalizeUrl("discord://-/channels/1/2/3"), "discord://-/channels/1/2/3");

  // Invalid text stays invalid
  assert.equal(isValidUrl(normalizeUrl("not-a-url")), false);
  assert.equal(isValidUrl(normalizeUrl("just some random text")), false);
  assert.equal(normalizeUrl(""), "");
});

test("FLEXIBLE TICKET URL: Refund modal submit accepts Discord message link and web link without scheme", async () => {
  const env = await createMockEnv();
  const postedLogs = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }), { status: 200 });
    }
    if (urlStr.includes(":append")) {
      return new Response(JSON.stringify({ updates: { updatedRows: 1 } }), { status: 200 });
    }
    if (urlStr.includes("/channels/") && options.method === "POST") {
      const parsed = JSON.parse(options.body);
      postedLogs.push(parsed);
      return new Response(JSON.stringify({ id: "msg_discord_link_log" }), { status: 200 });
    }
    if (options.method === "PUT") {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    // 1. Submit modal with a raw Discord link without https://
    const interaction = {
      type: 5,
      guild_id: "730000000000000000",
      channel_id: "1289638609535766631",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "123456789", username: "StaffUser" },
      },
      data: {
        custom_id: `${RefundCustomId.MODAL_SUBMIT_PREFIX}150580708144840704`,
        components: [
          { components: [{ custom_id: "player_name", value: "Alex Cross" }] },
          { components: [{ custom_id: "refund_category", value: "Vitcoin" }] },
          { components: [{ custom_id: "refund_details", value: "10,000 Vitcoins" }] },
          { components: [{ custom_id: "reason", value: "Vehicle glitch compensation" }] },
          {
            components: [
              {
                custom_id: "ticket_url",
                value: "discord.com/channels/730000000000000000/1249517344099668078/9988776655",
              },
            ],
          },
        ],
      },
    };

    const res = await handleRefundModalSubmit(interaction, env);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.match(data.data.content, /Refund Logged Successfully/);

    // Verify posted Discord message has normalized Ticket link and Ticket button
    assert.equal(postedLogs.length, 1);
    const posted = postedLogs[0];
    assert.match(
      posted.content,
      /\*\*Ticket:\*\* https:\/\/discord\.com\/channels\/730000000000000000\/1249517344099668078\/9988776655/
    );
    assert.equal(posted.components[0].components[0].url, "https://discord.com/channels/730000000000000000/1249517344099668078/9988776655");
    assert.equal(posted.components[0].components[0].label, "Ticket");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ============================================================================
// D1 DATABASE & REFUND EDITING TESTS
// ============================================================================

test("D1 DATABASE: appendRefundRecord, updateRefundRecord, getRefundById, and getRefundAudits", async () => {
  const env = await createMockEnv();
  const db = getDatabase(env);

  // 1. Append record
  const newRecord = {
    refundId: "VRP-R-000099",
    createdAt: new Date().toISOString(),
    playerName: "Alice Wonderland",
    playerDiscordId: "333444555666777888",
    refundCategory: "Cash",
    refundDetails: "$100,000 Cash",
    reason: "Bank heist glitch compensation",
    ticketUrl: "https://tickettool.xyz/transcript/99",
    staffName: "Officer Dave",
    staffDiscordId: "123456789012345678",
    guildId: "730000000000000000",
    logChannelId: "1289638609535766631",
    logMessageId: "987654321098765432",
    discordJumpUrl: "https://discord.com/channels/730000000000000000/1289638609535766631/987654321098765432",
    syncStatus: SyncStatus.POSTED,
    normalizedPlayerName: "alice wonderland",
  };

  const appendRes = await appendD1RefundRecord({
    env,
    record: newRecord,
    staffInfo: { name: newRecord.staffName, id: newRecord.staffDiscordId },
  });
  assert.equal(appendRes.status, "SUCCESS");
  assert.ok(appendRes.rowIndex);

  // 2. Lookup record
  const fetched = await getD1RefundById({ env, refundId: "VRP-R-000099" });
  assert.ok(fetched);
  assert.equal(fetched.refundId, "VRP-R-000099");
  assert.equal(fetched.playerName, "Alice Wonderland");
  assert.equal(fetched.normalizedPlayerName, "alice wonderland");
  assert.equal(fetched.refundDetails, "$100,000 Cash");

  // 3. Update record
  const updateRes = await updateRefundRecord({
    env,
    refundId: "VRP-R-000099",
    updatedFields: {
      playerName: "Alice Kingsleigh",
      refundDetails: "$150,000 Cash",
      reason: "Adjusted compensation amount per management",
    },
    staffInfo: { name: "Officer Dave", id: "123456789012345678" },
  });

  assert.equal(updateRes.success, true);
  assert.equal(updateRes.updatedRecord.playerName, "Alice Kingsleigh");
  assert.equal(updateRes.updatedRecord.normalizedPlayerName, "alice kingsleigh");
  assert.equal(updateRes.updatedRecord.refundDetails, "$150,000 Cash");
  assert.match(updateRes.changesSummary, /Changed Player Name from "Alice Wonderland" to "Alice Kingsleigh"/);
  assert.match(updateRes.changesSummary, /Changed Details from "\$100,000 Cash" to "\$150,000 Cash"/);

  // 4. Verify audit entries
  const audits = await getRefundAudits({ env, refundId: "VRP-R-000099" });
  assert.ok(audits.length >= 2);
  const editAudit = audits.find((a) => a.action === AuditAction.EDITED);
  assert.ok(editAudit);
  assert.equal(editAudit.changedByDiscordId, "123456789012345678");
  assert.match(editAudit.details, /Changed Player Name from "Alice Wonderland" to "Alice Kingsleigh"/);
});

test("EDIT PERMISSIONS: canEditRefundRecord permits author, superadmin, management, and rejects others", async () => {
  const env = await createMockEnv();
  const record = {
    refundId: "VRP-R-000001",
    staffDiscordId: "111222333444555666",
    staffName: "StaffAuthor",
  };

  // 1. Author who entered the refund
  const authorInteraction = {
    member: { user: { id: "111222333444555666" }, roles: [env.STAFF_TEAM_ROLE_ID] },
  };
  assert.equal(canEditRefundRecord(authorInteraction, env, record), true);

  // 2. Superadmin
  const superadminInteraction = {
    member: { user: { id: "150580708144840704" }, roles: [env.STAFF_TEAM_ROLE_ID] }, // Damon (Bot Superadmin)
  };
  assert.equal(canEditRefundRecord(superadminInteraction, env, record), true);

  // 3. Manager role
  const managerInteraction = {
    member: { user: { id: "999888777666555444" }, roles: [DEFAULT_OWNER_ROLE_ID] },
  };
  assert.equal(canEditRefundRecord(managerInteraction, env, record), true);

  // 4. Different staff member without management role
  const otherStaffInteraction = {
    member: { user: { id: "555666777888999000" }, roles: [env.STAFF_TEAM_ROLE_ID] },
  };
  assert.equal(canEditRefundRecord(otherStaffInteraction, env, record), false);

  // 5. Non-staff user
  const regularUserInteraction = {
    member: { user: { id: "777888999000111222" }, roles: [] },
  };
  assert.equal(canEditRefundRecord(regularUserInteraction, env, record), false);
});

test("SLASH COMMAND: /refund edit opens modal for creator, rejects unauthorized staff, handles not found", async () => {
  const env = await createMockEnv();
  const db = getDatabase(env);

  // Seed test record
  await appendD1RefundRecord({
    env,
    record: {
      refundId: "VRP-R-000050",
      createdAt: new Date().toISOString(),
      playerName: "Charlie Brown",
      playerDiscordId: "123123123123123123",
      refundCategory: "Vitcoin",
      refundDetails: "25,000 Vitcoins",
      reason: "Store purchase glitch",
      ticketUrl: "https://tickettool.xyz/transcript/50",
      staffName: "StaffCreator",
      staffDiscordId: "111222333444555666",
      guildId: "730000000000000000",
      logChannelId: "1289638609535766631",
      logMessageId: "505050505050505050",
      discordJumpUrl: "https://discord.com/channels/730000000000000000/1289638609535766631/505050505050505050",
      syncStatus: SyncStatus.POSTED,
      normalizedPlayerName: "charlie brown",
    },
  });

  // 1. Author executes /refund edit id:VRP-R-000050
  const authorInteraction = {
    data: {
      name: "refund",
      options: [
        {
          name: "edit",
          options: [{ name: "id", value: "VRP-R-000050" }],
        },
      ],
    },
    member: {
      roles: [env.STAFF_TEAM_ROLE_ID],
      user: { id: "111222333444555666", username: "StaffCreator" },
    },
  };

  const authorRes = await handleRefundCommand(authorInteraction, env);
  assert.equal(authorRes.status, 200);
  const authorData = await authorRes.json();
  assert.equal(authorData.type, 9); // MODAL
  assert.match(authorData.data.title, /Edit Refund/);
  assert.equal(authorData.data.custom_id, `${RefundCustomId.MODAL_EDIT_PREFIX}VRP-R-000050`);

  // Verify pre-filled inputs
  const playerNameInput = authorData.data.components[0].components[0];
  assert.equal(playerNameInput.value, "Charlie Brown");
  const detailsInput = authorData.data.components[2].components[0];
  assert.equal(detailsInput.value, "25,000 Vitcoins");

  // 2. Other staff member without manager role executes /refund edit
  const otherStaffInteraction = {
    data: {
      name: "refund",
      options: [
        {
          name: "edit",
          options: [{ name: "id", value: "VRP-R-000050" }],
        },
      ],
    },
    member: {
      roles: [env.STAFF_TEAM_ROLE_ID],
      user: { id: "999999888888777777", username: "OtherStaff" },
    },
  };

  const otherRes = await handleRefundCommand(otherStaffInteraction, env);
  assert.equal(otherRes.status, 200);
  const otherData = await otherRes.json();
  assert.equal(otherData.type, 4);
  assert.match(otherData.data.content, /You cannot edit this refund entry/);
  assert.match(otherData.data.content, /<@111222333444555666>/);

  // 3. Edit non-existent record
  const notFoundInteraction = {
    data: {
      name: "refund",
      options: [
        {
          name: "edit",
          options: [{ name: "id", value: "VRP-R-999999" }],
        },
      ],
    },
    member: {
      roles: [env.STAFF_TEAM_ROLE_ID],
      user: { id: "111222333444555666", username: "StaffCreator" },
    },
  };

  const notFoundRes = await handleRefundCommand(notFoundInteraction, env);
  assert.equal(notFoundRes.status, 200);
  const notFoundData = await notFoundRes.json();
  assert.equal(notFoundData.type, 4);
  assert.match(notFoundData.data.content, /not found/);
});

test("COMPONENT INTERACTION: refund_edit button opens modal for author, rejects unauthorized staff", async () => {
  const env = await createMockEnv();

  // Seed test record
  await appendD1RefundRecord({
    env,
    record: {
      refundId: "VRP-R-000060",
      createdAt: new Date().toISOString(),
      playerName: "David Hasselhoff",
      playerDiscordId: "444555666777888999",
      refundCategory: "S-Coin",
      refundDetails: "500 S-Coins",
      reason: "Custom livery missing after update",
      ticketUrl: "https://tickettool.xyz/transcript/60",
      staffName: "StaffMod",
      staffDiscordId: "222333444555666777",
      guildId: "730000000000000000",
      logChannelId: "1289638609535766631",
      logMessageId: "606060606060606060",
      discordJumpUrl: "https://discord.com/channels/730000000000000000/1289638609535766631/606060606060606060",
      syncStatus: SyncStatus.POSTED,
      normalizedPlayerName: "david hasselhoff",
    },
  });

  // 1. Author clicks Edit Record button
  const authorButtonInteraction = {
    data: {
      custom_id: `${RefundCustomId.BTN_EDIT_PREFIX}VRP-R-000060`,
    },
    member: {
      roles: [env.STAFF_TEAM_ROLE_ID],
      user: { id: "222333444555666777", username: "StaffMod" },
    },
  };

  const authorRes = await handleRefundComponent(authorButtonInteraction, env, { waitUntil: () => {} });
  assert.equal(authorRes.status, 200);
  const authorData = await authorRes.json();
  assert.equal(authorData.type, 9); // MODAL
  assert.equal(authorData.data.custom_id, `${RefundCustomId.MODAL_EDIT_PREFIX}VRP-R-000060`);

  // 2. Unauthorized staff clicks Edit Record button
  const unauthButtonInteraction = {
    data: {
      custom_id: `${RefundCustomId.BTN_EDIT_PREFIX}VRP-R-000060`,
    },
    member: {
      roles: [env.STAFF_TEAM_ROLE_ID],
      user: { id: "888777666555444333", username: "RandomStaff" },
    },
  };

  const unauthRes = await handleRefundComponent(unauthButtonInteraction, env, { waitUntil: () => {} });
  assert.equal(unauthRes.status, 200);
  const unauthData = await unauthRes.json();
  assert.equal(unauthData.type, 4);
  assert.match(unauthData.data.content, /You cannot edit this refund entry/);
});

test("MODAL SUBMISSION: refund_modal_edit updates D1, logs audit, PATCHes Discord message, and sends feedback", async () => {
  const env = await createMockEnv();

  // Seed initial record
  await appendD1RefundRecord({
    env,
    record: {
      refundId: "VRP-R-000070",
      createdAt: "2026-09-04T12:00:00Z",
      playerName: "Evelyn Reed",
      playerDiscordId: "555666777888999111",
      refundCategory: "Vitcoin",
      refundDetails: "10,000 Vitcoins",
      reason: "Initial purchase glitch",
      ticketUrl: "https://tickettool.xyz/transcript/70",
      staffName: "LeadStaff",
      staffDiscordId: "333444555666777888",
      guildId: "730000000000000000",
      logChannelId: "1289638609535766631",
      logMessageId: "707070707070707070",
      discordJumpUrl: "https://discord.com/channels/730000000000000000/1289638609535766631/707070707070707070",
      syncStatus: SyncStatus.POSTED,
      normalizedPlayerName: "evelyn reed",
    },
  });

  let discordPatchedPayload = null;
  let discordPatchedUrl = null;
  let webhookDeferredContent = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = typeof url === "string" ? url : url.url;

    if (urlStr.includes("discord.com/api/v10/channels/") && options.method === "PATCH") {
      discordPatchedUrl = urlStr;
      discordPatchedPayload = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "707070707070707070" }), { status: 200 });
    }

    if (urlStr.includes("/webhooks/")) {
      webhookDeferredContent = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "webhook_ack" }), { status: 200 });
    }

    return originalFetch(url, options);
  };

  try {
    const editModalInteraction = {
      application_id: "123456789",
      token: "edit_interaction_token",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "333444555666777888", username: "LeadStaff" },
      },
      data: {
        custom_id: `${RefundCustomId.MODAL_EDIT_PREFIX}VRP-R-000070`,
        components: [
          { components: [{ custom_id: "player_name", value: "Evelyn Reed-Smith" }] },
          { component: { custom_id: "refund_category", values: ["Vitcoin"] } },
          { components: [{ custom_id: "refund_details", value: "20,000 Vitcoins" }] },
          { components: [{ custom_id: "reason", value: "Updated: double compensation approved" }] },
          { components: [{ custom_id: "ticket_url", value: "https://tickettool.xyz/transcript/70-updated" }] },
        ],
      },
    };

    let bgTask = null;
    const ctx = { waitUntil: (p) => { bgTask = p; } };
    const submitRes = await handleRefundModalSubmit(editModalInteraction, env, ctx);
    assert.equal(submitRes.status, 200);
    const submitData = await submitRes.json();
    assert.equal(submitData.type, 5); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE

    if (bgTask) await bgTask;

    // 1. Verify D1 database updated
    const updated = await getD1RefundById({ env, refundId: "VRP-R-000070" });
    assert.equal(updated.playerName, "Evelyn Reed-Smith");
    assert.equal(updated.normalizedPlayerName, "evelyn reed-smith");
    assert.equal(updated.refundDetails, "20,000 Vitcoins");
    assert.equal(updated.reason, "Updated: double compensation approved");
    assert.equal(updated.ticketUrl, "https://tickettool.xyz/transcript/70-updated");

    // 2. Verify Discord message was PATCHed
    assert.ok(discordPatchedUrl);
    assert.match(discordPatchedUrl, /channels\/1289638609535766631\/messages\/707070707070707070/);
    assert.ok(discordPatchedPayload);
    assert.match(discordPatchedPayload.content, /Evelyn Reed-Smith/);
    assert.match(discordPatchedPayload.content, /20,000 Vitcoins/);

    // 3. Verify interaction response informed user
    assert.ok(webhookDeferredContent);
    assert.match(webhookDeferredContent.content, /Refund Record Updated/);
    assert.match(webhookDeferredContent.content, /Changed Player Name from "Evelyn Reed" to "Evelyn Reed-Smith"/);
    assert.match(webhookDeferredContent.content, /Changed Details from "10,000 Vitcoins" to "20,000 Vitcoins"/);
    assert.match(webhookDeferredContent.content, /View Updated Log/);

    // 4. Verify audit entry
    const audits = await getRefundAudits({ env, refundId: "VRP-R-000070" });
    const editAudit = audits.find((a) => a.action === AuditAction.EDITED);
    assert.ok(editAudit);
    assert.equal(editAudit.changedByDiscordId, "333444555666777888");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MODAL SUBMISSION: refund_modal_edit handles no-op changes, invalid URL, and unauthorized submit", async () => {
  const env = await createMockEnv();

  // Seed record
  await appendD1RefundRecord({
    env,
    record: {
      refundId: "VRP-R-000080",
      createdAt: new Date().toISOString(),
      playerName: "Frank Castle",
      playerDiscordId: "666777888999000111",
      refundCategory: "Cash",
      refundDetails: "$50,000 Cash",
      reason: "Lost items in shootout",
      ticketUrl: "https://tickettool.xyz/transcript/80",
      staffName: "StaffOfficer",
      staffDiscordId: "444555666777888999",
      guildId: "730000000000000000",
      logChannelId: "1289638609535766631",
      logMessageId: "808080808080808080",
      discordJumpUrl: "https://discord.com/channels/730000000000000000/1289638609535766631/808080808080808080",
      syncStatus: SyncStatus.POSTED,
      normalizedPlayerName: "frank castle",
    },
  });

  // 1. Unauthorized submit
  const unauthSubmit = {
    member: {
      roles: [env.STAFF_TEAM_ROLE_ID],
      user: { id: "999111222333444555", username: "NotTheAuthor" },
    },
    data: {
      custom_id: `${RefundCustomId.MODAL_EDIT_PREFIX}VRP-R-000080`,
      components: [
        { components: [{ custom_id: "player_name", value: "Frankie" }] },
      ],
    },
  };

  const unauthRes = await handleRefundModalSubmit(unauthSubmit, env);
  const unauthData = await unauthRes.json();
  assert.equal(unauthData.type, 4);
  assert.match(unauthData.data.content, /You cannot edit this refund entry/);

  // 2. Invalid ticket URL
  const invalidUrlSubmit = {
    member: {
      roles: [env.STAFF_TEAM_ROLE_ID],
      user: { id: "444555666777888999", username: "StaffOfficer" },
    },
    data: {
      custom_id: `${RefundCustomId.MODAL_EDIT_PREFIX}VRP-R-000080`,
      components: [
        { components: [{ custom_id: "player_name", value: "Frank Castle" }] },
        { components: [{ custom_id: "refund_details", value: "$50,000 Cash" }] },
        { components: [{ custom_id: "reason", value: "Lost items in shootout" }] },
        { components: [{ custom_id: "ticket_url", value: "invalid-url-here" }] },
      ],
    },
  };

  const invalidUrlRes = await handleRefundModalSubmit(invalidUrlSubmit, env);
  const invalidUrlData = await invalidUrlRes.json();
  assert.equal(invalidUrlData.type, 4);
  assert.match(invalidUrlData.data.content, /Invalid Ticket URL format/);

  // 3. No changes made
  let webhookDeferredContent = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = typeof url === "string" ? url : url.url;
    if (urlStr.includes("/webhooks/")) {
      webhookDeferredContent = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "webhook_ack" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const noChangeSubmit = {
      application_id: "123456789",
      token: "no_change_token",
      member: {
        roles: [env.STAFF_TEAM_ROLE_ID],
        user: { id: "444555666777888999", username: "StaffOfficer" },
      },
      data: {
        custom_id: `${RefundCustomId.MODAL_EDIT_PREFIX}VRP-R-000080`,
        components: [
          { components: [{ custom_id: "player_name", value: "Frank Castle" }] },
          { component: { custom_id: "refund_category", values: ["Cash"] } },
          { components: [{ custom_id: "refund_details", value: "$50,000 Cash" }] },
          { components: [{ custom_id: "reason", value: "Lost items in shootout" }] },
          { components: [{ custom_id: "ticket_url", value: "https://tickettool.xyz/transcript/80" }] },
        ],
      },
    };

    let bgTask = null;
    const ctx = { waitUntil: (p) => { bgTask = p; } };
    const noChangeRes = await handleRefundModalSubmit(noChangeSubmit, env, ctx);
    assert.equal(noChangeRes.status, 200);
    const noChangeData = await noChangeRes.json();
    assert.equal(noChangeData.type, 5);

    if (bgTask) await bgTask;
    assert.ok(webhookDeferredContent);
    assert.match(webhookDeferredContent.content, /No Changes Detected/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("FIX VERIFICATION: Recent Refunds button returns immediate ephemeral response within Discord action row limits", async () => {
  const env = await createMockEnv();
  const db = getDatabase(env);

  // Insert 15 mock refunds into D1
  for (let i = 1; i <= 15; i++) {
    const refundId = `VRP-R-${String(i).padStart(6, "0")}`;
    await db.prepare(`
      INSERT INTO refunds (
        refund_id, created_at, player_name, player_discord_id,
        refund_category, refund_details, reason, ticket_url,
        staff_name, staff_discord_id, sync_status, normalized_player_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      refundId,
      new Date(Date.now() - i * 60000).toISOString(),
      `Player ${i}`,
      `111222333444555${i.toString().padStart(3, "0")}`,
      i % 2 === 0 ? "Cash" : "Vitcoin",
      `$${i * 1000}`,
      `Loss due to crash #${i}`,
      `https://tickettool.xyz/tickets/${i}`,
      "AdminStaff",
      "999888777666555444",
      "Logged",
      `player ${i}`
    ).run();
  }

  const staffInteraction = {
    member: {
      roles: [env.STAFF_TEAM_ROLE_ID],
      user: { id: "999888777666555444", username: "AdminStaff" },
    },
    data: { custom_id: RefundCustomId.BTN_RECENT },
  };

  const res = await handleRefundComponent(staffInteraction, env);
  assert.equal(res.status, 200);
  const data = await res.json();

  // 1. Must be Type 4 (CHANNEL_MESSAGE_WITH_SOURCE) so Discord renders an ephemeral message,
  // NOT Type 7 (UPDATE_MESSAGE) which failed with 400 Bad Request on public channel messages.
  assert.equal(data.type, 4);
  assert.equal(data.data.flags, 32832); // EPHEMERAL_FLAG | IS_COMPONENTS_V2_FLAG

  // 2. Action row count must be strictly <= 5 to respect Discord's hard component limit
  const container = data.data.components[0];
  const actionRows = container.components.filter((c) => c.type === 1);
  assert.ok(actionRows.length <= 5, `Total action rows (${actionRows.length}) must be <= 5 to prevent Discord 400 Bad Request`);

  // 3. Verify content
  const header = container.components[0];
  assert.match(header.content, /RECENT REFUNDS/);
  assert.match(header.content, /Showing 3 of 10 record\(s\) • Page 1 of 4/);
});

