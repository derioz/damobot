import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import worker, { StickyBotDO } from "../src/index.js";
import {
  InteractionType,
  InteractionResponseType,
  InteractionResponseFlags,
} from "discord-interactions";
import { commands } from "../scripts/register-commands.js";
import {
  DEFAULT_STAFF_TEAM_ROLE_ID,
  DEFAULT_OWNER_ROLE_ID,
} from "../src/config.js";

async function signDiscordPayload(body, keyPair, timestamp) {
  const message = Buffer.concat([
    Buffer.from(timestamp, "utf-8"),
    Buffer.from(body, "utf-8"),
  ]);
  const signature = await crypto.subtle.sign(
    "Ed25519",
    keyPair.privateKey,
    message
  );
  return Buffer.from(signature).toString("hex");
}

function createMockDO(env = { DISCORD_BOT_TOKEN: "mock_token" }) {
  const mockStorage = {
    records: new Map(),
    sql: {
      exec(query, ...params) {
        // Enforce SQLite syntax validation for column and placeholder counts
        const insertMatch = query.match(/INSERT(?:\s+OR\s+\w+)?\s+INTO\s+\w+\s*\(([^)]+)\)\s+VALUES\s*\(([^)]+)\)/i);
        if (insertMatch) {
          const cols = insertMatch[1].split(",").map((c) => c.trim());
          const placeholders = insertMatch[2].split(",").map((p) => p.trim());
          if (cols.length !== placeholders.length) {
            throw new Error(`${placeholders.length} values for ${cols.length} columns: SQLITE_ERROR`);
          }
          if (placeholders.length !== params.length) {
            throw new Error(`Parameter count mismatch: expected ${placeholders.length}, got ${params.length}: SQLITE_ERROR`);
          }
        }

        const placeholderCount = (query.match(/\?/g) || []).length;
        if (placeholderCount !== params.length) {
          throw new Error(`Parameter count mismatch: expected ${placeholderCount}, got ${params.length}: SQLITE_ERROR`);
        }

        if (query.includes("CREATE TABLE")) return [];
        if (query.includes("SELECT * FROM sticky_configs WHERE channel_id = ?")) {
          const channelId = params[0];
          const rec = mockStorage.records.get(channelId);
          return rec ? [rec] : [];
        }
        if (query.includes("SELECT * FROM sticky_configs WHERE enabled = 1")) {
          const results = [];
          for (const rec of mockStorage.records.values()) {
            if (rec.enabled === 1) {
              results.push(rec);
            }
          }
          return results;
        }
        if (query.includes("INSERT OR REPLACE INTO sticky_configs")) {
          const [
            channel_id,
            guild_id,
            message_text,
            current_message_id,
            enabled,
            updated_at,
            button_action,
            button_label,
            button_style,
            button_emoji,
          ] = params;
          mockStorage.records.set(channel_id, {
            channel_id,
            guild_id,
            message_text,
            current_message_id,
            enabled,
            updated_at,
            button_action: button_action || null,
            button_label: button_label || null,
            button_style: button_style || null,
            button_emoji: button_emoji || null,
          });
          return [];
        }
        if (query.includes("UPDATE sticky_configs SET current_message_id = ?")) {
          const [current_message_id, updated_at, channel_id] = params;
          const rec = mockStorage.records.get(channel_id);
          if (rec) {
            rec.current_message_id = current_message_id;
            rec.updated_at = updated_at;
          }
          return [];
        }
        if (query.includes("DELETE FROM sticky_configs WHERE channel_id = ?")) {
          const channelId = params[0];
          mockStorage.records.delete(channelId);
          return [];
        }
        return [];
      },
    },
    setAlarm: async () => {},
  };

  const ctx = { storage: mockStorage };
  const instance = new StickyBotDO(ctx, env);
  return { instance, mockStorage };
}

test("Unauthorized users (including Admins and Manage Messages) are rejected from /sticky commands", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const testCases = [
    { desc: "Normal unauthorized user", member: { permissions: "0", user: { id: "999999999" } } },
    { desc: "Administrator without StaffTeam role", member: { permissions: "8", user: { id: "admin_user_not_authorized" } } },
    { desc: "Manage Messages user without StaffTeam role", member: { permissions: "8192", user: { id: "mod_user_not_authorized" } } },
    { desc: "User 150580708144840704 without StaffTeam role", member: { roles: [], user: { id: "150580708144840704" } } },
  ];

  for (const tc of testCases) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.APPLICATION_COMMAND,
      member: tc.member,
      data: {
        name: "sticky",
        options: [
          {
            name: "status",
            options: [{ name: "channel", value: "123456789" }],
          },
        ],
      },
    });
    const signatureHex = await signDiscordPayload(body, keyPair, timestamp);

    const request = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": signatureHex,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const env = { DISCORD_PUBLIC_KEY: publicKeyHex };
    const res = await worker.fetch(request, env, {});

    assert.equal(res.status, 200, `${tc.desc} should receive 200 response`);
    const json = await res.json();
    assert.equal(json.data.flags, InteractionResponseFlags.EPHEMERAL);
    assert.equal(
      json.data.content,
      "❌ You do not have permission to manage sticky messages.",
      `${tc.desc} should receive exact error message`
    );
    assert.equal(
      json.data.content.includes("150580708144840704"),
      false,
      "Must not reveal authorized user ID in response"
    );
  }
});

test("StaffTeam member with role can use /sticky set", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const { instance } = createMockDO();

  const originalFetch = globalThis.fetch;
  let postedPayload = null;

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/channels/123456789/messages") && options.method === "POST") {
      postedPayload = JSON.parse(options.body);
      const newMsg = { id: "msg_new_001", content: postedPayload.content };
      return new Response(JSON.stringify(newMsg), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(url, options);
  };

  try {
    const mockEnv = {
      DISCORD_PUBLIC_KEY: publicKeyHex,
      DISCORD_BOT_TOKEN: "mock_token",
      STAFF_TEAM_ROLE_ID: "743422836223246366",
      STICKY_BOT: {
        idFromName: () => "global",
        get: () => ({
          fetch: (reqUrl, reqOpt) => instance.fetch(new Request(reqUrl, reqOpt)),
        }),
      },
    };

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.APPLICATION_COMMAND,
      guild_id: "guild_777",
      member: {
        user: { id: "150580708144840704" },
        roles: ["743422836223246366"],
      },
      data: {
        name: "sticky",
        options: [
          {
            name: "set",
            options: [
              { name: "channel", value: "123456789" },
              { name: "message", value: "📌 Read the rules before chatting!" },
            ],
          },
        ],
      },
    });
    const signatureHex = await signDiscordPayload(body, keyPair, timestamp);

    const request = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": signatureHex,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const res = await worker.fetch(request, mockEnv, {});
    assert.equal(res.status, 200);

    const json = await res.json();
    assert.equal(json.data.flags, InteractionResponseFlags.EPHEMERAL);
    assert.ok(json.data.content.includes("Sticky message enabled for <#123456789>"));

    // Verify allowed_mentions allows user and role mentions without @everyone
    assert.deepEqual(postedPayload.allowed_mentions, { parse: ["users", "roles"] });

    // Verify stored config
    const config = instance.getStickyConfig("123456789");
    assert.ok(config != null);
    assert.equal(config.guild_id, "guild_777");
    assert.equal(config.message_text, "📌 Read the rules before chatting!");
    assert.equal(config.current_message_id, "msg_new_001");
    assert.equal(config.enabled, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("StaffTeam member with role can use /sticky status", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const { instance } = createMockDO();
  instance.setStickyConfig({
    channelId: "123456789",
    guildId: "guild_777",
    messageText: "Active Sticky Text",
    currentMessageId: "msg_001",
    enabled: 1,
  });

  const mockEnv = {
    DISCORD_PUBLIC_KEY: publicKeyHex,
    DISCORD_BOT_TOKEN: "mock_token",
    STAFF_TEAM_ROLE_ID: "743422836223246366",
    STICKY_BOT: {
      idFromName: () => "global",
      get: () => ({
        fetch: (reqUrl, reqOpt) => instance.fetch(new Request(reqUrl, reqOpt)),
      }),
    },
  };

  // 1. Status for enabled channel
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body1 = JSON.stringify({
    type: InteractionType.APPLICATION_COMMAND,
    member: {
      user: { id: "150580708144840704" },
      roles: ["743422836223246366"],
    },
    data: {
      name: "sticky",
      options: [
        {
          name: "status",
          options: [{ name: "channel", value: "123456789" }],
        },
      ],
    },
  });
  const sig1 = await signDiscordPayload(body1, keyPair, timestamp);

  const req1 = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig1,
      "x-signature-timestamp": timestamp,
    },
    body: body1,
  });

  const res1 = await worker.fetch(req1, mockEnv, {});
  const json1 = await res1.json();
  assert.ok(json1.data.content.includes("Enabled 🟢"));
  assert.ok(json1.data.content.includes("Active Sticky Text"));

  // 2. Status for non-configured channel
  const body2 = JSON.stringify({
    type: InteractionType.APPLICATION_COMMAND,
    member: {
      user: { id: "150580708144840704" },
      roles: ["743422836223246366"],
    },
    data: {
      name: "sticky",
      options: [
        {
          name: "status",
          options: [{ name: "channel", value: "999999999" }],
        },
      ],
    },
  });
  const sig2 = await signDiscordPayload(body2, keyPair, timestamp);

  const req2 = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig2,
      "x-signature-timestamp": timestamp,
    },
    body: body2,
  });

  const res2 = await worker.fetch(req2, mockEnv, {});
  const json2 = await res2.json();
  assert.ok(json2.data.content.includes("Disabled ⚪"));
});

test("StaffTeam member with role can use /sticky off", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const { instance } = createMockDO();
  instance.setStickyConfig({
    channelId: "123456789",
    guildId: "guild_777",
    messageText: "To Delete Text",
    currentMessageId: "msg_to_delete_01",
    enabled: 1,
  });

  let deletedMessageUrl = null;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (options.method === "DELETE") {
      deletedMessageUrl = urlStr;
      return new Response(null, { status: 204 });
    }
    return originalFetch(url, options);
  };

  try {
    const mockEnv = {
      DISCORD_PUBLIC_KEY: publicKeyHex,
      DISCORD_BOT_TOKEN: "mock_token",
      STAFF_TEAM_ROLE_ID: "743422836223246366",
      STICKY_BOT: {
        idFromName: () => "global",
        get: () => ({
          fetch: (reqUrl, reqOpt) => instance.fetch(new Request(reqUrl, reqOpt)),
        }),
      },
    };

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.APPLICATION_COMMAND,
      member: {
        user: { id: "150580708144840704" },
        roles: ["743422836223246366"],
      },
      data: {
        name: "sticky",
        options: [
          {
            name: "off",
            options: [{ name: "channel", value: "123456789" }],
          },
        ],
      },
    });
    const sig = await signDiscordPayload(body, keyPair, timestamp);

    const req = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const res = await worker.fetch(req, mockEnv, {});
    assert.equal(res.status, 200);

    const json = await res.json();
    assert.ok(json.data.content.includes("Sticky message disabled for <#123456789>"));

    assert.ok(deletedMessageUrl.includes("/messages/msg_to_delete_01"));
    assert.equal(instance.getStickyConfig("123456789"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Scheduled polling: when latest message equals stored current sticky ID, do nothing", async () => {
  const { instance } = createMockDO();
  instance.setStickyConfig({
    channelId: "chan_100",
    guildId: "guild_1",
    messageText: "Sticky Message",
    currentMessageId: "msg_sticky_active",
    enabled: 1,
  });

  const actions = [];
  const mockCustomFetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (options.method === "GET" || !options.method) {
      actions.push({ type: "GET", url: urlStr });
      return new Response(JSON.stringify([{ id: "msg_sticky_active", content: "Sticky Message" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    actions.push({ type: options.method, url: urlStr });
    return new Response(null, { status: 200 });
  };

  const res = await instance.pollAndRefreshStickyMessages(mockCustomFetch);

  assert.equal(res.total, 1);
  assert.equal(res.refreshed, 0);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "GET");
});

test("Scheduled polling: when latest message differs, creates new sticky before deleting old sticky", async () => {
  const { instance } = createMockDO();
  instance.setStickyConfig({
    channelId: "chan_100",
    guildId: "guild_1",
    messageText: "Sticky Message",
    currentMessageId: "msg_sticky_old",
    enabled: 1,
  });

  const actions = [];
  const mockCustomFetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (options.method === "GET" || !options.method) {
      actions.push({ type: "GET", url: urlStr });
      // User sent a new message after the sticky
      return new Response(JSON.stringify([{ id: "msg_user_newest", content: "User message" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (options.method === "POST") {
      const body = JSON.parse(options.body);
      actions.push({ type: "POST", url: urlStr, body });
      return new Response(JSON.stringify({ id: "msg_sticky_new", content: body.content }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (options.method === "DELETE") {
      actions.push({ type: "DELETE", url: urlStr });
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  };

  const res = await instance.pollAndRefreshStickyMessages(mockCustomFetch);

  assert.equal(res.total, 1);
  assert.equal(res.refreshed, 1);

  // Order verification: GET -> POST (new sticky) -> DELETE (old sticky)
  assert.equal(actions.length, 3);
  assert.equal(actions[0].type, "GET");
  assert.equal(actions[1].type, "POST");
  assert.deepEqual(actions[1].body.allowed_mentions, { parse: ["users", "roles"] });
  assert.equal(actions[2].type, "DELETE");
  assert.ok(actions[2].url.includes("msg_sticky_old"));

  // Stored sticky ID updated
  const updated = instance.getStickyConfig("chan_100");
  assert.equal(updated.current_message_id, "msg_sticky_new");
});

test("Scheduled polling: old sticky deletion returning 404 is safely ignored", async () => {
  const { instance } = createMockDO();
  instance.setStickyConfig({
    channelId: "chan_100",
    guildId: "guild_1",
    messageText: "Sticky Message",
    currentMessageId: "msg_manually_deleted",
    enabled: 1,
  });

  const mockCustomFetch = async (url, options = {}) => {
    if (options.method === "GET" || !options.method) {
      return new Response(JSON.stringify([{ id: "msg_user_999" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (options.method === "POST") {
      return new Response(JSON.stringify({ id: "msg_recreated" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (options.method === "DELETE") {
      // 404 from Discord
      return new Response(JSON.stringify({ message: "Unknown Message", code: 10008 }), {
        status: 404,
      });
    }
    return new Response(null, { status: 404 });
  };

  const res = await instance.pollAndRefreshStickyMessages(mockCustomFetch);
  assert.equal(res.refreshed, 1);
  const updated = instance.getStickyConfig("chan_100");
  assert.equal(updated.current_message_id, "msg_recreated");
});

test("Scheduled polling: empty channel causes no action", async () => {
  const { instance } = createMockDO();
  instance.setStickyConfig({
    channelId: "chan_empty",
    guildId: "guild_1",
    messageText: "Sticky Message",
    currentMessageId: "msg_none",
    enabled: 1,
  });

  let postCalled = false;
  const mockCustomFetch = async (url, options = {}) => {
    if (options.method === "GET" || !options.method) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (options.method === "POST") {
      postCalled = true;
    }
    return new Response(null, { status: 200 });
  };

  const res = await instance.pollAndRefreshStickyMessages(mockCustomFetch);
  assert.equal(res.refreshed, 0);
  assert.equal(postCalled, false);
});

test("Scheduled polling: disabled channels are ignored", async () => {
  const { instance } = createMockDO();
  instance.setStickyConfig({
    channelId: "chan_disabled",
    guildId: "guild_1",
    messageText: "Disabled Sticky",
    currentMessageId: "msg_none",
    enabled: 0,
  });

  let getCalled = false;
  const mockCustomFetch = async () => {
    getCalled = true;
    return new Response(JSON.stringify([{ id: "msg_user" }]), { status: 200 });
  };

  const res = await instance.pollAndRefreshStickyMessages(mockCustomFetch);
  assert.equal(res.total, 0);
  assert.equal(getCalled, false);
});

test("Scheduled polling: multiple configured channels are processed independently", async () => {
  const { instance } = createMockDO();
  instance.setStickyConfig({
    channelId: "chan_1",
    guildId: "guild_1",
    messageText: "Sticky 1",
    currentMessageId: "msg_s1",
    enabled: 1,
  });
  instance.setStickyConfig({
    channelId: "chan_2",
    guildId: "guild_1",
    messageText: "Sticky 2",
    currentMessageId: "msg_s2",
    enabled: 1,
  });

  const mockCustomFetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (options.method === "GET" || !options.method) {
      if (urlStr.includes("chan_1")) {
        // chan_1 has a new user message
        return new Response(JSON.stringify([{ id: "msg_user_in_c1" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("chan_2")) {
        // chan_2 sticky is already newest
        return new Response(JSON.stringify([{ id: "msg_s2" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    if (options.method === "POST") {
      return new Response(JSON.stringify({ id: "msg_s1_new" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (options.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  };

  const res = await instance.pollAndRefreshStickyMessages(mockCustomFetch);
  assert.equal(res.total, 2);
  assert.equal(res.refreshed, 1);
  assert.equal(instance.getStickyConfig("chan_1").current_message_id, "msg_s1_new");
  assert.equal(instance.getStickyConfig("chan_2").current_message_id, "msg_s2");
});

test("Worker scheduled() handler triggers DO poll endpoint", async () => {
  let pollCalled = false;
  const mockEnv = {
    STICKY_BOT: {
      idFromName: (name) => {
        assert.equal(name, "global");
        return "global_id";
      },
      get: () => ({
        fetch: async (url, opts) => {
          if (url.includes("/sticky/poll") && opts.method === "POST") {
            pollCalled = true;
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
          }
          return new Response(null, { status: 404 });
        },
      }),
    },
  };

  await worker.scheduled({}, mockEnv, {});
  assert.equal(pollCalled, true, "scheduled() must call DO /sticky/poll");
});

test("StickyBotDO setStickyConfig SQL statement matches exactly 10 columns and 10 values", async () => {
  let executedQuery = null;
  let executedParams = [];

  const mockStorage = {
    records: new Map(),
    sql: {
      exec(query, ...params) {
        executedQuery = query;
        executedParams = params;

        const insertMatch = query.match(/INSERT(?:\s+OR\s+\w+)?\s+INTO\s+\w+\s*\(([^)]+)\)\s+VALUES\s*\(([^)]+)\)/i);
        if (insertMatch) {
          const cols = insertMatch[1].split(",").map((c) => c.trim());
          const placeholders = insertMatch[2].split(",").map((p) => p.trim());
          if (cols.length !== placeholders.length) {
            throw new Error(`${placeholders.length} values for ${cols.length} columns: SQLITE_ERROR`);
          }
          if (placeholders.length !== params.length) {
            throw new Error(`Parameter count mismatch: expected ${placeholders.length}, got ${params.length}: SQLITE_ERROR`);
          }
        }
        return [];
      },
    },
  };

  const instance = new StickyBotDO({ storage: mockStorage }, { DISCORD_BOT_TOKEN: "mock_token" });
  instance.setStickyConfig({
    channelId: "chan_sqlite_test",
    guildId: "guild_sqlite_test",
    messageText: "Test Message",
    currentMessageId: "msg_sqlite_test",
    enabled: 1,
  });

  assert.ok(executedQuery.includes("INSERT OR REPLACE INTO sticky_configs"));
  assert.equal(executedParams.length, 10);
  assert.equal(executedParams[0], "chan_sqlite_test");
  assert.equal(executedParams[1], "guild_sqlite_test");
  assert.equal(executedParams[2], "Test Message");
  assert.equal(executedParams[3], "msg_sqlite_test");
  assert.equal(executedParams[4], 1);
  assert.equal(typeof executedParams[5], "number");
  assert.equal(executedParams[6], null); // button_action
  assert.equal(executedParams[7], null); // button_label
  assert.equal(executedParams[8], null); // button_style
  assert.equal(executedParams[9], null); // button_emoji
});

test("StaffTeam member with role (STAFF_TEAM_ROLE_ID) can use /sticky commands", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const { instance } = createMockDO();

  const mockEnv = {
    DISCORD_PUBLIC_KEY: publicKeyHex,
    DISCORD_BOT_TOKEN: "mock_token",
    STAFF_TEAM_ROLE_ID: "743422836223246366",
    STICKY_BOT: {
      idFromName: () => "global",
      get: () => ({
        fetch: (reqUrl, reqOpt) => instance.fetch(new Request(reqUrl, reqOpt)),
      }),
    },
  };

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.APPLICATION_COMMAND,
    member: {
      user: { id: "arbitrary_staff_user_123" }, // Different user ID
      roles: ["743422836223246366"], // Has StaffTeam role
    },
    data: {
      name: "sticky",
      options: [
        {
          name: "status",
          options: [{ name: "channel", value: "999999999" }],
        },
      ],
    },
  });
  const sig = await signDiscordPayload(body, keyPair, timestamp);

  const req = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig,
      "x-signature-timestamp": timestamp,
    },
    body,
  });

  const res = await worker.fetch(req, mockEnv, {});
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.flags, InteractionResponseFlags.EPHEMERAL);
  assert.ok(json.data.content.includes("Sticky Message Status"));
});

test("STICKY WITH BUTTON: /sticky set with button: punishment_center stores button and sends ActionRow in Discord POST", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const { instance } = createMockDO();
  let postedPayload = null;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/channels/1249517344099668078/messages") && options.method === "POST") {
      postedPayload = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "msg_sticky_btn_001", content: postedPayload.content }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(url, options);
  };

  try {
    const mockEnv = {
      DISCORD_PUBLIC_KEY: publicKeyHex,
      DISCORD_BOT_TOKEN: "mock_token",
      STAFF_TEAM_ROLE_ID: "743422836223246366",
      STICKY_BOT: {
        idFromName: () => "global",
        get: () => ({
          fetch: (reqUrl, reqOpt) => instance.fetch(new Request(reqUrl, reqOpt)),
        }),
      },
    };

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.APPLICATION_COMMAND,
      guild_id: "730015674348601384",
      member: {
        user: { id: "150580708144840704" },
        roles: ["743422836223246366"],
      },
      data: {
        name: "sticky",
        options: [
          {
            name: "set",
            options: [
              { name: "channel", value: "1249517344099668078" },
              { name: "message", value: "## ⚖️ Punishment Logs\n\nUse Damo-Bot to log punishments or search punishment history." },
              { name: "button", value: "punishment_center" },
            ],
          },
        ],
      },
    });

    const sig = await signDiscordPayload(body, keyPair, timestamp);
    const req = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const res = await worker.fetch(req, mockEnv, {});
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.data.flags, InteractionResponseFlags.EPHEMERAL);
    assert.ok(json.data.content.includes("Sticky message enabled for <#1249517344099668078>"));

    // 1. Verify Discord POST payload contains both message text and components
    assert.ok(postedPayload);
    assert.ok(postedPayload.content.includes("## ⚖️ Punishment Logs"));
    assert.deepEqual(postedPayload.allowed_mentions, { parse: ["users", "roles"] });
    assert.ok(Array.isArray(postedPayload.components));
    assert.equal(postedPayload.components.length, 1);
    const actionRow = postedPayload.components[0];
    assert.equal(actionRow.type, 1); // Action Row
    assert.equal(actionRow.components.length, 1);
    const btn = actionRow.components[0];
    assert.equal(btn.type, 2); // Button
    assert.equal(btn.custom_id, "sticky:punishment_center");
    assert.equal(btn.label, "Open Punishment Center");
    assert.equal(btn.emoji.name, "⚖️");

    // 2. Verify stored configuration in DO
    const config = instance.getStickyConfig("1249517344099668078");
    assert.ok(config);
    assert.equal(config.button_action, "punishment_center");
    assert.equal(config.button_label, "Open Punishment Center");
    assert.equal(config.button_emoji, "⚖️");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("STICKY STATUS: displays configured button status or None when text-only", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const { instance } = createMockDO();

  // 1. Configure a sticky with punishment_center button
  instance.setStickyConfig({
    channelId: "1249517344099668078",
    guildId: "730015674348601384",
    messageText: "Punishment Sticky",
    currentMessageId: "msg_btn",
    enabled: 1,
    buttonAction: "punishment_center",
  });

  // 2. Configure a text-only sticky
  instance.setStickyConfig({
    channelId: "111222333444",
    guildId: "730015674348601384",
    messageText: "Plain Sticky",
    currentMessageId: "msg_plain",
    enabled: 1,
  });

  const mockEnv = {
    DISCORD_PUBLIC_KEY: publicKeyHex,
    DISCORD_BOT_TOKEN: "mock_token",
    STAFF_TEAM_ROLE_ID: "743422836223246366",
    STICKY_BOT: {
      idFromName: () => "global",
      get: () => ({
        fetch: (reqUrl, reqOpt) => instance.fetch(new Request(reqUrl, reqOpt)),
      }),
    },
  };

  const timestamp = Math.floor(Date.now() / 1000).toString();

  // Check status with button
  const bodyWithBtn = JSON.stringify({
    type: InteractionType.APPLICATION_COMMAND,
    member: { user: { id: "150580708144840704" }, roles: ["743422836223246366"] },
    data: { name: "sticky", options: [{ name: "status", options: [{ name: "channel", value: "1249517344099668078" }] }] },
  });
  const sigWithBtn = await signDiscordPayload(bodyWithBtn, keyPair, timestamp);
  const resWithBtn = await worker.fetch(new Request("https://damo-bot.local/", {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature-ed25519": sigWithBtn, "x-signature-timestamp": timestamp },
    body: bodyWithBtn,
  }), mockEnv, {});
  const jsonWithBtn = await resWithBtn.json();
  assert.ok(jsonWithBtn.data.content.includes("**Button:** ⚖️ Open Punishment Center"));

  // Check status without button
  const bodyPlain = JSON.stringify({
    type: InteractionType.APPLICATION_COMMAND,
    member: { user: { id: "150580708144840704" }, roles: ["743422836223246366"] },
    data: { name: "sticky", options: [{ name: "status", options: [{ name: "channel", value: "111222333444" }] }] },
  });
  const sigPlain = await signDiscordPayload(bodyPlain, keyPair, timestamp);
  const resPlain = await worker.fetch(new Request("https://damo-bot.local/", {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature-ed25519": sigPlain, "x-signature-timestamp": timestamp },
    body: bodyPlain,
  }), mockEnv, {});
  const jsonPlain = await resPlain.json();
  assert.ok(jsonPlain.data.content.includes("**Button:** None"));
});

test("STICKY REPOST WITH BUTTON: pollAndRefreshStickyMessages reposts both content and components, preserves button, and deletes old sticky", async () => {
  const { instance } = createMockDO();

  instance.setStickyConfig({
    channelId: "chan_repost_btn",
    guildId: "guild_777",
    messageText: "Sticky with button content",
    currentMessageId: "old_msg_001",
    enabled: 1,
    buttonAction: "punishment_center",
  });

  let postedPayload = null;
  let deletedMsgId = null;

  const mockFetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/messages?limit=1")) {
      // Return a newer message that is NOT the sticky message
      return new Response(JSON.stringify([{ id: "newer_chat_message_999", content: "Hey guys" }]), { status: 200 });
    }
    if (urlStr.includes("/messages") && options.method === "POST") {
      postedPayload = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "new_sticky_msg_002", content: postedPayload.content }), { status: 200 });
    }
    if (urlStr.includes("/messages/old_msg_001") && options.method === "DELETE") {
      deletedMsgId = "old_msg_001";
      return new Response(null, { status: 204 });
    }
    return new Response("OK", { status: 200 });
  };

  const result = await instance.pollAndRefreshStickyMessages(mockFetch);
  assert.equal(result.refreshed, 1);

  // 1. Verify new message was posted with content AND button components
  assert.ok(postedPayload);
  assert.equal(postedPayload.content, "Sticky with button content");
  assert.ok(Array.isArray(postedPayload.components));
  assert.equal(postedPayload.components[0].components[0].custom_id, "sticky:punishment_center");
  assert.equal(postedPayload.components[0].components[0].label, "Open Punishment Center");

  // 2. Verify old sticky message was deleted
  assert.equal(deletedMsgId, "old_msg_001");

  // 3. Verify current message ID was updated
  const updated = instance.getStickyConfig("chan_repost_btn");
  assert.equal(updated.current_message_id, "new_sticky_msg_002");
});

test("STICKY BUTTON INTERACTION: clicking sticky:punishment_center as StaffTeam member opens private Punishment Center ephemerally", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const mockEnv = {
    DISCORD_PUBLIC_KEY: publicKeyHex,
    DISCORD_BOT_TOKEN: "mock_token",
    STAFF_TEAM_ROLE_ID: "743422836223246366",
  };

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.MESSAGE_COMPONENT,
    guild_id: "730015674348601384",
    member: {
      user: { id: "staff_member_456" },
      roles: ["743422836223246366"], // Has StaffTeam role
    },
    data: {
      custom_id: "sticky:punishment_center",
      component_type: 2,
    },
  });

  const sig = await signDiscordPayload(body, keyPair, timestamp);
  const req = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig,
      "x-signature-timestamp": timestamp,
    },
    body,
  });

  const res = await worker.fetch(req, mockEnv, {});
  assert.equal(res.status, 200);
  const json = await res.json();

  // Ephemeral Components V2 response (64 | 32768 = 32832)
  assert.equal(json.data.flags, 32832);
  const container = json.data.components[0];
  assert.equal(container.type, 17); // CONTAINER

  // Verify Punishment Center layout
  const headerSection = container.components.find((c) => c.type === 9);
  assert.ok(headerSection);
  assert.match(headerSection.components[0].content, /# ⚖️ Staff Punishment Center/);

  // Verify 4 action buttons
  const actionRow = container.components.find((c) => c.type === 1);
  assert.ok(actionRow);
  assert.equal(actionRow.components.length, 4);
});

test("STICKY BUTTON INTERACTION: non-staff member clicking sticky:punishment_center is rejected ephemerally", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const mockEnv = {
    DISCORD_PUBLIC_KEY: publicKeyHex,
    DISCORD_BOT_TOKEN: "mock_token",
    STAFF_TEAM_ROLE_ID: "743422836223246366",
  };

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.MESSAGE_COMPONENT,
    guild_id: "730015674348601384",
    member: {
      user: { id: "random_user_789" },
      roles: ["111111111111111111"], // NOT StaffTeam
    },
    data: {
      custom_id: "sticky:punishment_center",
      component_type: 2,
    },
  });

  const sig = await signDiscordPayload(body, keyPair, timestamp);
  const req = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig,
      "x-signature-timestamp": timestamp,
    },
    body,
  });

  const res = await worker.fetch(req, mockEnv, {});
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.flags, InteractionResponseFlags.EPHEMERAL);
  assert.equal(json.data.content, "❌ This feature is only available to Vital RP staff.");
});

test("STICKY BUTTON INTERACTION: administrator without StaffTeam role is strictly rejected (no admin bypass)", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const mockEnv = {
    DISCORD_PUBLIC_KEY: publicKeyHex,
    DISCORD_BOT_TOKEN: "mock_token",
    STAFF_TEAM_ROLE_ID: "743422836223246366",
  };

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.MESSAGE_COMPONENT,
    guild_id: "730015674348601384",
    member: {
      user: { id: "admin_user_999" },
      permissions: "8", // ADMINISTRATOR
      roles: ["222222222222222222"], // NOT StaffTeam
    },
    data: {
      custom_id: "sticky:punishment_center",
      component_type: 2,
    },
  });

  const sig = await signDiscordPayload(body, keyPair, timestamp);
  const req = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig,
      "x-signature-timestamp": timestamp,
    },
    body,
  });

  const res = await worker.fetch(req, mockEnv, {});
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.flags, InteractionResponseFlags.EPHEMERAL);
  assert.equal(json.data.content, "❌ This feature is only available to Vital RP staff.");
});

test("COMMAND REGISTRATION: /sticky set options include optional button choice", () => {
  const stickyCmd = commands.find((cmd) => cmd.name === "sticky");
  assert.ok(stickyCmd);
  const setSub = stickyCmd.options.find((opt) => opt.name === "set");
  assert.ok(setSub);
  const buttonOpt = setSub.options.find((opt) => opt.name === "button");
  assert.ok(buttonOpt);
  assert.equal(buttonOpt.type, 3); // STRING
  assert.equal(buttonOpt.required, false);
  assert.equal(buttonOpt.choices.length, 4);
  assert.equal(buttonOpt.choices[0].value, "none");
  assert.equal(buttonOpt.choices[1].value, "punishment_center");
  assert.equal(buttonOpt.choices[2].value, "refund_center");
  assert.equal(buttonOpt.choices[3].value, "both");
});

test("COMMAND REGISTRATION: /sticky subcommands include create, edit, remove, set, off, status with optional channel", () => {
  const stickyCmd = commands.find((cmd) => cmd.name === "sticky");
  assert.ok(stickyCmd, "Sticky command must be registered");

  const expectedSubcommands = ["create", "edit", "remove", "set", "off", "status"];
  for (const subName of expectedSubcommands) {
    const sub = stickyCmd.options.find((opt) => opt.name === subName);
    assert.ok(sub, `Subcommand /sticky ${subName} must exist`);
    assert.equal(sub.type, 1, `Subcommand ${subName} must be SUB_COMMAND type 1`);

    const channelOpt = sub.options.find((opt) => opt.name === "channel");
    assert.ok(channelOpt, `Subcommand ${subName} must have channel option`);
    assert.equal(channelOpt.type, 7, "channel option must be CHANNEL type 7");
    if (subName === "set") {
      assert.equal(channelOpt.required, true, "channel option in set is required for backwards compatibility");
    } else {
      assert.equal(channelOpt.required, false, `channel option in ${subName} must be optional`);
    }
  }

  // Check create options
  const createSub = stickyCmd.options.find((opt) => opt.name === "create");
  const createButton = createSub.options.find((opt) => opt.name === "button");
  assert.ok(createButton, "create subcommand must have button option");
  assert.equal(createButton.required, false);

  // Check set options has message
  const setSub = stickyCmd.options.find((opt) => opt.name === "set");
  const setMsg = setSub.options.find((opt) => opt.name === "message");
  assert.ok(setMsg, "set subcommand must have message option");
  assert.equal(setMsg.required, true);
});

test("/sticky create returns Discord modal (Type 9) with Paragraph input (style: 2, max_length: 2000)", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const { instance } = createMockDO();
  const mockEnv = {
    DISCORD_PUBLIC_KEY: publicKeyHex,
    STAFF_TEAM_ROLE_ID: "743422836223246366",
    STICKY_BOT: {
      idFromName: () => "global",
      get: () => ({
        fetch: (reqUrl, reqOpt) => instance.fetch(new Request(reqUrl, reqOpt)),
      }),
    },
  };

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.APPLICATION_COMMAND,
    guild_id: "guild_777",
    channel_id: "111222333",
    member: {
      user: { id: "staff_user_1" },
      roles: ["743422836223246366"],
    },
    data: {
      name: "sticky",
      options: [
        {
          name: "create",
          options: [
            { name: "channel", value: "999888777" },
            { name: "button", value: "punishment_center" },
          ],
        },
      ],
    },
  });

  const sig = await signDiscordPayload(body, keyPair, timestamp);
  const req = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig,
      "x-signature-timestamp": timestamp,
    },
    body,
  });

  const res = await worker.fetch(req, mockEnv, {});
  assert.equal(res.status, 200);
  const json = await res.json();

  // Type 9 is MODAL
  assert.equal(json.type, 9);
  assert.equal(json.data.title, "Create Sticky Message");
  assert.equal(json.data.custom_id, "sticky_modal_create:999888777:punishment_center");

  // Verify text input
  assert.ok(Array.isArray(json.data.components));
  assert.equal(json.data.components.length, 1);
  const row = json.data.components[0];
  assert.equal(row.type, 1); // Action Row
  const input = row.components[0];
  assert.equal(input.type, 4); // Text Input
  assert.equal(input.custom_id, "sticky_content");
  assert.equal(input.style, 2); // Paragraph
  assert.equal(input.max_length, 2000);
  assert.equal(input.required, true);
  assert.equal(input.value, "");
});

test("/sticky create defaults to interaction.channel_id when channel option is omitted", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const { instance } = createMockDO();
  const mockEnv = {
    DISCORD_PUBLIC_KEY: publicKeyHex,
    STAFF_TEAM_ROLE_ID: "743422836223246366",
    STICKY_BOT: {
      idFromName: () => "global",
      get: () => ({
        fetch: (reqUrl, reqOpt) => instance.fetch(new Request(reqUrl, reqOpt)),
      }),
    },
  };

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.APPLICATION_COMMAND,
    guild_id: "guild_777",
    channel_id: "current_chan_456",
    member: {
      user: { id: "staff_user_1" },
      roles: ["743422836223246366"],
    },
    data: {
      name: "sticky",
      options: [
        {
          name: "create",
        },
      ],
    },
  });

  const sig = await signDiscordPayload(body, keyPair, timestamp);
  const req = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig,
      "x-signature-timestamp": timestamp,
    },
    body,
  });

  const res = await worker.fetch(req, mockEnv, {});
  assert.equal(res.status, 200);
  const json = await res.json();

  assert.equal(json.type, 9);
  assert.equal(json.data.custom_id, "sticky_modal_create:current_chan_456:none");
});

test("Sticky Modal Submit: stores multi-line formatting, blank lines, markdown, emojis, mentions and posts to Discord", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const { instance } = createMockDO();

  const originalFetch = globalThis.fetch;
  let postedPayload = null;

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/channels/chan_format_101/messages") && options.method === "POST") {
      postedPayload = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "msg_formatted_01", content: postedPayload.content }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(url, options);
  };

  try {
    const mockEnv = {
      DISCORD_PUBLIC_KEY: publicKeyHex,
      DISCORD_BOT_TOKEN: "mock_token",
      STAFF_TEAM_ROLE_ID: "743422836223246366",
      STICKY_BOT: {
        idFromName: () => "global",
        get: () => ({
          fetch: (reqUrl, reqOpt) => instance.fetch(new Request(reqUrl, reqOpt)),
        }),
      },
    };

    const multiLineMessage = [
      "# 📜 Welcome to Vital RP Rules",
      "",
      "> Please treat all players and staff with respect.",
      "",
      "### Key Guidelines:",
      "- **1.** Obey staff directions at all times.",
      "- **2.** For questions, mention <@&743422836223246366> in <#123456789>.",
      "- **3.** Contact <@150580708144840704> for urgent escalations.",
      "",
      "```",
      "Remember: Safe zones are strictly non-combat.",
      "```",
      "",
      "Enjoy the server! 🎮 ✨",
    ].join("\n");

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.MODAL_SUBMIT,
      guild_id: "guild_777",
      member: {
        user: { id: "staff_user_1" },
        roles: ["743422836223246366"],
      },
      data: {
        custom_id: "sticky_modal_create:chan_format_101:punishment_center",
        components: [
          {
            type: 1,
            components: [
              {
                custom_id: "sticky_content",
                value: multiLineMessage,
              },
            ],
          },
        ],
      },
    });

    const sig = await signDiscordPayload(body, keyPair, timestamp);
    const req = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const res = await worker.fetch(req, mockEnv, {});
    assert.equal(res.status, 200);
    const json = await res.json();

    assert.equal(json.data.flags, InteractionResponseFlags.EPHEMERAL);
    assert.equal(json.data.content, "✅ Sticky message created and enabled for <#chan_format_101>.");

    // Verify posted payload preserved every newline, blank line, and character exactly
    assert.ok(postedPayload);
    assert.equal(postedPayload.content, multiLineMessage);
    assert.deepEqual(postedPayload.allowed_mentions, { parse: ["users", "roles"] });

    // Verify ActionRow with punishment_center button
    assert.ok(Array.isArray(postedPayload.components));
    assert.equal(postedPayload.components[0].components[0].custom_id, "sticky:punishment_center");

    // Verify DO storage has the exact unchanged string
    const stored = instance.getStickyConfig("chan_format_101");
    assert.ok(stored);
    assert.equal(stored.message_text, multiLineMessage);
    assert.equal(stored.current_message_id, "msg_formatted_01");
    assert.equal(stored.button_action, "punishment_center");
    assert.equal(stored.enabled, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("/sticky edit returns modal pre-filled with existing sticky message", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const { instance } = createMockDO();
  const existingText = "## Existing Header\n\nLine 1\nLine 2\n\n> Blockquote";
  instance.setStickyConfig({
    channelId: "chan_edit_001",
    guildId: "guild_777",
    messageText: existingText,
    currentMessageId: "msg_existing_01",
    buttonAction: "punishment_center",
    enabled: 1,
  });

  const mockEnv = {
    DISCORD_PUBLIC_KEY: publicKeyHex,
    STAFF_TEAM_ROLE_ID: "743422836223246366",
    STICKY_BOT: {
      idFromName: () => "global",
      get: () => ({
        fetch: (reqUrl, reqOpt) => instance.fetch(new Request(reqUrl, reqOpt)),
      }),
    },
  };

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.APPLICATION_COMMAND,
    guild_id: "guild_777",
    channel_id: "chan_edit_001",
    member: {
      user: { id: "staff_user_1" },
      roles: ["743422836223246366"],
    },
    data: {
      name: "sticky",
      options: [
        {
          name: "edit",
          // channel option omitted: defaults to channel_id "chan_edit_001"
        },
      ],
    },
  });

  const sig = await signDiscordPayload(body, keyPair, timestamp);
  const req = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig,
      "x-signature-timestamp": timestamp,
    },
    body,
  });

  const res = await worker.fetch(req, mockEnv, {});
  assert.equal(res.status, 200);
  const json = await res.json();

  assert.equal(json.type, 9); // MODAL
  assert.equal(json.data.title, "Edit Sticky Message");
  assert.equal(json.data.custom_id, "sticky_modal_edit:chan_edit_001:punishment_center");

  const input = json.data.components[0].components[0];
  assert.equal(input.custom_id, "sticky_content");
  assert.equal(input.style, 2); // Paragraph
  assert.equal(input.value, existingText);
});

test("/sticky edit on channel without active sticky returns ephemeral error", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const { instance } = createMockDO();

  const mockEnv = {
    DISCORD_PUBLIC_KEY: publicKeyHex,
    STAFF_TEAM_ROLE_ID: "743422836223246366",
    STICKY_BOT: {
      idFromName: () => "global",
      get: () => ({
        fetch: (reqUrl, reqOpt) => instance.fetch(new Request(reqUrl, reqOpt)),
      }),
    },
  };

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.APPLICATION_COMMAND,
    guild_id: "guild_777",
    channel_id: "empty_chan_999",
    member: {
      user: { id: "staff_user_1" },
      roles: ["743422836223246366"],
    },
    data: {
      name: "sticky",
      options: [{ name: "edit" }],
    },
  });

  const sig = await signDiscordPayload(body, keyPair, timestamp);
  const req = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig,
      "x-signature-timestamp": timestamp,
    },
    body,
  });

  const res = await worker.fetch(req, mockEnv, {});
  assert.equal(res.status, 200);
  const json = await res.json();

  assert.equal(json.data.flags, InteractionResponseFlags.EPHEMERAL);
  assert.ok(json.data.content.includes("No active sticky message found for <#empty_chan_999>"));
  assert.ok(json.data.content.includes("/sticky create"));
});

test("Sticky Modal Submit: edit updates existing message text and reposts", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const { instance } = createMockDO();
  instance.setStickyConfig({
    channelId: "chan_edit_002",
    guildId: "guild_777",
    messageText: "Old sticky message",
    currentMessageId: "msg_old_44",
    enabled: 1,
  });

  const originalFetch = globalThis.fetch;
  let postedPayload = null;

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/channels/chan_edit_002/messages") && options.method === "POST") {
      postedPayload = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "msg_updated_99", content: postedPayload.content }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (urlStr.includes("/channels/chan_edit_002/messages") && options.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    return originalFetch(url, options);
  };

  try {
    const mockEnv = {
      DISCORD_PUBLIC_KEY: publicKeyHex,
      DISCORD_BOT_TOKEN: "mock_token",
      STAFF_TEAM_ROLE_ID: "743422836223246366",
      STICKY_BOT: {
        idFromName: () => "global",
        get: () => ({
          fetch: (reqUrl, reqOpt) => instance.fetch(new Request(reqUrl, reqOpt)),
        }),
      },
    };

    const updatedText = "## Updated Sticky!\n\nNew instructions here.";
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.MODAL_SUBMIT,
      guild_id: "guild_777",
      member: {
        user: { id: "staff_user_1" },
        roles: ["743422836223246366"],
      },
      data: {
        custom_id: "sticky_modal_edit:chan_edit_002:none",
        components: [
          {
            type: 1,
            components: [
              {
                custom_id: "sticky_content",
                value: updatedText,
              },
            ],
          },
        ],
      },
    });

    const sig = await signDiscordPayload(body, keyPair, timestamp);
    const req = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const res = await worker.fetch(req, mockEnv, {});
    assert.equal(res.status, 200);
    const json = await res.json();

    assert.equal(json.data.flags, InteractionResponseFlags.EPHEMERAL);
    assert.equal(json.data.content, "✅ Sticky message updated for <#chan_edit_002>.");

    assert.ok(postedPayload);
    assert.equal(postedPayload.content, updatedText);

    const stored = instance.getStickyConfig("chan_edit_002");
    assert.equal(stored.message_text, updatedText);
    assert.equal(stored.current_message_id, "msg_updated_99");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("/sticky remove disables sticky and defaults to current channel if channel omitted", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const { instance } = createMockDO();
  instance.setStickyConfig({
    channelId: "chan_remove_01",
    guildId: "guild_777",
    messageText: "Sticky to remove",
    currentMessageId: "msg_to_del",
    enabled: 1,
  });

  const originalFetch = globalThis.fetch;
  let deletedMsgUrl = null;

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/channels/chan_remove_01/messages/msg_to_del") && options.method === "DELETE") {
      deletedMsgUrl = urlStr;
      return new Response(null, { status: 204 });
    }
    return originalFetch(url, options);
  };

  try {
    const mockEnv = {
      DISCORD_PUBLIC_KEY: publicKeyHex,
      DISCORD_BOT_TOKEN: "mock_token",
      STAFF_TEAM_ROLE_ID: "743422836223246366",
      STICKY_BOT: {
        idFromName: () => "global",
        get: () => ({
          fetch: (reqUrl, reqOpt) => instance.fetch(new Request(reqUrl, reqOpt)),
        }),
      },
    };

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.APPLICATION_COMMAND,
      guild_id: "guild_777",
      channel_id: "chan_remove_01",
      member: {
        user: { id: "staff_user_1" },
        roles: ["743422836223246366"],
      },
      data: {
        name: "sticky",
        options: [{ name: "remove" }],
      },
    });

    const sig = await signDiscordPayload(body, keyPair, timestamp);
    const req = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const res = await worker.fetch(req, mockEnv, {});
    assert.equal(res.status, 200);
    const json = await res.json();

    assert.equal(json.data.flags, InteractionResponseFlags.EPHEMERAL);
    assert.equal(json.data.content, "✅ Sticky message disabled for <#chan_remove_01>.");

    const stored = instance.getStickyConfig("chan_remove_01");
    assert.equal(stored, null, "Sticky configuration should be deleted on remove");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Sticky Modal Submit: unauthorized user is rejected ephemerally", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const mockEnv = {
    DISCORD_PUBLIC_KEY: publicKeyHex,
    STAFF_TEAM_ROLE_ID: "743422836223246366",
  };

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.MODAL_SUBMIT,
    guild_id: "guild_777",
    member: {
      user: { id: "unauthorized_user_88" },
      roles: ["random_role_123"],
    },
    data: {
      custom_id: "sticky_modal_create:chan_123:none",
      components: [
        {
          type: 1,
          components: [
            {
              custom_id: "sticky_content",
              value: "Hacking sticky",
            },
          ],
        },
      ],
    },
  });

  const sig = await signDiscordPayload(body, keyPair, timestamp);
  const req = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig,
      "x-signature-timestamp": timestamp,
    },
    body,
  });

  const res = await worker.fetch(req, mockEnv, {});
  assert.equal(res.status, 200);
  const json = await res.json();

  assert.equal(json.data.flags, InteractionResponseFlags.EPHEMERAL);
  assert.equal(json.data.content, "❌ You do not have permission to manage sticky messages.");
});

test("Sticky Modal Submit: empty text is rejected with error", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const mockEnv = {
    DISCORD_PUBLIC_KEY: publicKeyHex,
    STAFF_TEAM_ROLE_ID: "743422836223246366",
  };

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.MODAL_SUBMIT,
    guild_id: "guild_777",
    member: {
      user: { id: "staff_user_1" },
      roles: ["743422836223246366"],
    },
    data: {
      custom_id: "sticky_modal_create:chan_123:none",
      components: [
        {
          type: 1,
          components: [
            {
              custom_id: "sticky_content",
              value: "   \n\n   ",
            },
          ],
        },
      ],
    },
  });

  const sig = await signDiscordPayload(body, keyPair, timestamp);
  const req = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig,
      "x-signature-timestamp": timestamp,
    },
    body,
  });

  const res = await worker.fetch(req, mockEnv, {});
  assert.equal(res.status, 200);
  const json = await res.json();

  assert.equal(json.data.flags, InteractionResponseFlags.EPHEMERAL);
  assert.equal(json.data.content, "❌ Sticky message content cannot be empty.");
});

test("Scheduled polling: multi-line formatting and blank lines preserved when sticky reposts", async () => {
  const { instance, mockStorage } = createMockDO();

  const multiLineText = "# Header\n\n> Quote line 1\n> Quote line 2\n\n* Bullet 1\n* Bullet 2\n\nFooter note";
  mockStorage.records.set("chan_repost_01", {
    channel_id: "chan_repost_01",
    guild_id: "guild_777",
    message_text: multiLineText,
    current_message_id: "msg_sticky_old_01",
    enabled: 1,
    button_action: "punishment_center",
  });

  const actions = [];
  const mockCustomFetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (options.method === "GET") {
      actions.push({ type: "GET", url: urlStr });
      return new Response(JSON.stringify([{ id: "msg_chat_user_99", content: "Hey guys!" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (options.method === "POST") {
      const parsedBody = JSON.parse(options.body);
      actions.push({ type: "POST", url: urlStr, body: parsedBody });
      return new Response(JSON.stringify({ id: "msg_sticky_new_02", content: parsedBody.content }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (options.method === "DELETE") {
      actions.push({ type: "DELETE", url: urlStr });
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  };

  const res = await instance.pollAndRefreshStickyMessages(mockCustomFetch);
  assert.equal(res.total, 1);
  assert.equal(res.refreshed, 1);

  // Verify POST payload content matches exact multi-line text
  const postAction = actions.find((a) => a.type === "POST");
  assert.ok(postAction);
  assert.equal(postAction.body.content, multiLineText);
  assert.deepEqual(postAction.body.allowed_mentions, { parse: ["users", "roles"] });
  assert.equal(postAction.body.components[0].components[0].custom_id, "sticky:punishment_center");

  // Verify stored ID was updated
  const updated = instance.getStickyConfig("chan_repost_01");
  assert.equal(updated.current_message_id, "msg_sticky_new_02");
});

test("STAFF ONLY ENFORCEMENT: user 150580708144840704 and administrators without StaffTeam role cannot use sticky commands or modals", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const mockEnv = {
    DISCORD_PUBLIC_KEY: publicKeyHex,
    STAFF_TEAM_ROLE_ID: "743422836223246366",
  };

  // 1. User 150580708144840704 without role running slash command
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const slashBody = JSON.stringify({
    type: InteractionType.APPLICATION_COMMAND,
    guild_id: "guild_777",
    channel_id: "chan_123",
    member: {
      user: { id: "150580708144840704" },
      roles: ["some_other_role_999"],
    },
    data: {
      name: "sticky",
      options: [{ name: "create" }],
    },
  });
  const slashSig = await signDiscordPayload(slashBody, keyPair, timestamp);
  const slashReq = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": slashSig,
      "x-signature-timestamp": timestamp,
    },
    body: slashBody,
  });

  const slashRes = await worker.fetch(slashReq, mockEnv, {});
  assert.equal(slashRes.status, 200);
  const slashJson = await slashRes.json();
  assert.equal(slashJson.data.flags, InteractionResponseFlags.EPHEMERAL);
  assert.equal(slashJson.data.content, "❌ You do not have permission to manage sticky messages.");

  // 2. User 150580708144840704 submitting modal without StaffTeam role
  const modalBody = JSON.stringify({
    type: InteractionType.MODAL_SUBMIT,
    guild_id: "guild_777",
    channel_id: "chan_123",
    member: {
      user: { id: "150580708144840704" },
      roles: ["some_other_role_999"],
    },
    data: {
      custom_id: "sticky_modal_create:chan_123:none",
      components: [
        {
          type: 1,
          components: [
            {
              custom_id: "sticky_content",
              value: "Trying to submit without role",
            },
          ],
        },
      ],
    },
  });
  const modalSig = await signDiscordPayload(modalBody, keyPair, timestamp);
  const modalReq = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": modalSig,
      "x-signature-timestamp": timestamp,
    },
    body: modalBody,
  });

  const modalRes = await worker.fetch(modalReq, mockEnv, {});
  assert.equal(modalRes.status, 200);
  const modalJson = await modalRes.json();
  assert.equal(modalJson.data.flags, InteractionResponseFlags.EPHEMERAL);
  assert.equal(modalJson.data.content, "❌ You do not have permission to manage sticky messages.");

  // 3. Guild Administrator (permissions: "8") without StaffTeam role running slash command
  const adminBody = JSON.stringify({
    type: InteractionType.APPLICATION_COMMAND,
    guild_id: "guild_777",
    channel_id: "chan_123",
    member: {
      user: { id: "admin_user_456" },
      permissions: "8", // ADMINISTRATOR
      roles: ["role_admin_123"], // NOT StaffTeam
    },
    data: {
      name: "sticky",
      options: [{ name: "create" }],
    },
  });
  const adminSig = await signDiscordPayload(adminBody, keyPair, timestamp);
  const adminReq = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": adminSig,
      "x-signature-timestamp": timestamp,
    },
    body: adminBody,
  });

  const adminRes = await worker.fetch(adminReq, mockEnv, {});
  assert.equal(adminRes.status, 200);
  const adminJson = await adminRes.json();
  assert.equal(adminJson.data.flags, InteractionResponseFlags.EPHEMERAL);
  assert.equal(adminJson.data.content, "❌ You do not have permission to manage sticky messages.");
});

test("Owner member with role (DEFAULT_OWNER_ROLE_ID) can use /sticky commands", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const { instance } = createMockDO();

  const mockEnv = {
    DISCORD_PUBLIC_KEY: publicKeyHex,
    DISCORD_BOT_TOKEN: "mock_token",
    OWNER_ROLE_ID: DEFAULT_OWNER_ROLE_ID,
    STICKY_BOT: {
      idFromName: () => "global",
      get: () => ({
        fetch: (reqUrl, reqOpt) => instance.fetch(new Request(reqUrl, reqOpt)),
      }),
    },
  };

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.APPLICATION_COMMAND,
    member: {
      user: { id: "owner_user_sticky_123" },
      roles: [DEFAULT_OWNER_ROLE_ID],
    },
    data: {
      name: "sticky",
      options: [
        {
          name: "status",
          options: [{ name: "channel", value: "999999999" }],
        },
      ],
    },
  });
  const sig = await signDiscordPayload(body, keyPair, timestamp);

  const req = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig,
      "x-signature-timestamp": timestamp,
    },
    body,
  });

  const res = await worker.fetch(req, mockEnv, {});
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.flags, InteractionResponseFlags.EPHEMERAL);
  assert.ok(json.data.content.includes("Sticky Message Status"));
});

test("Owner member with role (DEFAULT_OWNER_ROLE_ID) can submit sticky modal", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const { instance } = createMockDO();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/channels/chan_owner_test/messages") && options.method === "POST") {
      return new Response(JSON.stringify({ id: "msg_owner_sticky_1", content: "Owner Sticky Content" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(url, options);
  };

  try {
    const mockEnv = {
      DISCORD_PUBLIC_KEY: publicKeyHex,
      DISCORD_BOT_TOKEN: "mock_token",
      OWNER_ROLE_ID: DEFAULT_OWNER_ROLE_ID,
      STICKY_BOT: {
        idFromName: () => "global",
        get: () => ({
          fetch: (reqUrl, reqOpt) => instance.fetch(new Request(reqUrl, reqOpt)),
        }),
      },
    };

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const modalBody = JSON.stringify({
      type: InteractionType.MODAL_SUBMIT,
      guild_id: "guild_777",
      member: {
        user: { id: "owner_user_modal" },
        roles: [DEFAULT_OWNER_ROLE_ID],
      },
      data: {
        custom_id: "sticky_modal_create:chan_owner_test:none",
        components: [
          {
            type: 1,
            components: [
              {
                custom_id: "sticky_content",
                value: "Owner Sticky Content",
              },
            ],
          },
        ],
      },
    });

    const modalSig = await signDiscordPayload(modalBody, keyPair, timestamp);
    const modalReq = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": modalSig,
        "x-signature-timestamp": timestamp,
      },
      body: modalBody,
    });

    const modalRes = await worker.fetch(modalReq, mockEnv, {});
    assert.equal(modalRes.status, 200);
    const modalJson = await modalRes.json();
    assert.equal(modalJson.data.flags, InteractionResponseFlags.EPHEMERAL);
    assert.match(modalJson.data.content, /Sticky message created and enabled/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


