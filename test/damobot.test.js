import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { InteractionType } from "discord-interactions";
import worker from "../src/index.js";
import { commands } from "../scripts/register-commands.js";
import {
  DAMO_BOT_VERSION,
  VITAL_RP_LOGO_URL,
  DEFAULT_OWNER_ROLE_ID,
} from "../src/config.js";
import {
  DAMO_BOT_FEATURES,
  buildDamoBotOverviewContainer,
  formatFeaturesMarkdown,
} from "../src/overview/features.js";

/**
 * Helper to generate Ed25519 signature for Discord interaction requests.
 */
async function signDiscordPayload(body, keyPair, timestamp) {
  const enc = new TextEncoder();
  const data = enc.encode(timestamp + body);
  const sig = await crypto.subtle.sign("Ed25519", keyPair.privateKey, data);
  return Buffer.from(sig).toString("hex");
}

test("COMMAND REGISTRATION: /damobot is registered with correct description and type", () => {
  const damobotCmd = commands.find((c) => c.name === "damobot");
  assert.ok(damobotCmd, "/damobot must be in commands list");
  assert.equal(damobotCmd.description, "See everything Damo-Bot can do.");
  assert.equal(damobotCmd.type, 1); // CHAT_INPUT
});

test("FEATURE LIST CATALOG: DAMO_BOT_FEATURES contains all expected systems", () => {
  assert.ok(Array.isArray(DAMO_BOT_FEATURES));
  assert.ok(DAMO_BOT_FEATURES.length >= 5);

  const ids = DAMO_BOT_FEATURES.map((f) => f.id);
  assert.ok(ids.includes("referrals"));
  assert.ok(ids.includes("loa"));
  assert.ok(ids.includes("punishments"));
  assert.ok(ids.includes("stickies"));
  assert.ok(ids.includes("ping"));

  const pingFeature = DAMO_BOT_FEATURES.find((f) => f.id === "ping");
  assert.equal(pingFeature.isMinor, true);

  const formatted = formatFeaturesMarkdown();
  assert.match(formatted, /🎟️ \*\*Referrals\*\*/);
  assert.match(formatted, /\/referral/);
  assert.match(formatted, /🏖️ \*\*Staff LOA Center\*\*/);
  assert.match(formatted, /\/loa list/);
  assert.match(formatted, /⚖️ \*\*Punishment Center\*\*/);
  assert.match(formatted, /\/logpunishment/);
  assert.match(formatted, /📌 \*\*Sticky Messages\*\*/);
  assert.match(formatted, /\/sticky/);
  assert.match(formatted, /🏓 `\/ping` • Quick bot health check/);
});

test("COMPONENTS V2 CONTAINER: buildDamoBotOverviewContainer builds valid layout", () => {
  const container = buildDamoBotOverviewContainer();
  assert.equal(container.type, 17); // CONTAINER
  assert.equal(container.accent_color, 16425472); // VITAL_ORANGE

  // 1. Header Section
  const headerSection = container.components.find((c) => c.type === 9);
  assert.ok(headerSection);
  assert.match(headerSection.components[0].content, /# 🤖 Damo-Bot/);
  assert.match(headerSection.components[0].content, /Vital RP’s unpaid digital employee\./);
  assert.equal(headerSection.accessory.type, 11); // THUMBNAIL
  assert.equal(headerSection.accessory.media.url, VITAL_RP_LOGO_URL);

  // 2. Separators
  const separators = container.components.filter((c) => c.type === 14);
  assert.ok(separators.length >= 3);

  // 3. More Coming Soon
  const comingSoonText = container.components.find(
    (c) => c.type === 10 && c.content?.includes("More features coming soon")
  );
  assert.ok(comingSoonText);
  assert.match(comingSoonText.content, /Damon keeps finding more things for me to do/);

  // 4. Action Row Buttons
  const actionRow = container.components.find((c) => c.type === 1);
  assert.ok(actionRow);
  assert.equal(actionRow.components.length, 3);
  assert.equal(actionRow.components[0].custom_id, "damobot:punishment_center");
  assert.equal(actionRow.components[0].label, "Punishment Center");
  assert.equal(actionRow.components[1].custom_id, "damobot:refund_center");
  assert.equal(actionRow.components[1].label, "Refund Center");
  assert.equal(actionRow.components[2].custom_id, "damobot:loa_center");
  assert.equal(actionRow.components[2].label, "LOA Center");

  // 5. Centralized Version Footer
  const footerText = container.components.find(
    (c) => c.type === 10 && c.content?.includes(DAMO_BOT_VERSION)
  );
  assert.ok(footerText, "Centralized DAMO_BOT_VERSION must appear in footer");
  assert.match(footerText.content, /🤖 Damo Bot • Vital RP/);
});

test("SECURITY: StaffTeam role member running /damobot receives ephemeral Components V2 overview", async () => {
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
    type: InteractionType.APPLICATION_COMMAND,
    guild_id: "730015674348601384",
    member: {
      user: { id: "staff_damon" },
      roles: ["743422836223246366"], // StaffTeam role
    },
    data: {
      name: "damobot",
    },
  });

  const sig = await signDiscordPayload(body, keyPair, timestamp);
  const res = await worker.fetch(
    new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    }),
    mockEnv,
    {}
  );

  assert.equal(res.status, 200);
  const json = await res.json();

  // Ephemeral Components V2 response (64 | 32768 = 32832)
  assert.equal(json.data.flags, 32832);
  const container = json.data.components[0];
  assert.equal(container.type, 17);

  // Content verification
  const textDisplays = container.components.filter((c) => c.type === 10);
  const allText = textDisplays.map((t) => t.content).join("\n");
  assert.match(allText, /\/referral/);
  assert.match(allText, /\/loa list/);
  assert.match(allText, /\/logpunishment/);
  assert.match(allText, /\/sticky/);
  assert.match(allText, /\/ping/);
  assert.match(allText, new RegExp(DAMO_BOT_VERSION));

  // No secrets or internal IDs leaked
  const serialized = JSON.stringify(json);
  assert.equal(serialized.includes("mock_token"), false);
  assert.equal(serialized.includes("service_account"), false);
  assert.equal(serialized.includes("client_email"), false);
  assert.equal(serialized.includes("private_key"), false);
});

test("SECURITY: Non-staff user running /damobot is rejected ephemerally", async () => {
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
    type: InteractionType.APPLICATION_COMMAND,
    guild_id: "730015674348601384",
    member: {
      user: { id: "regular_user_123" },
      roles: ["999999999999999999"], // Not staff
    },
    data: {
      name: "damobot",
    },
  });

  const sig = await signDiscordPayload(body, keyPair, timestamp);
  const res = await worker.fetch(
    new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    }),
    mockEnv,
    {}
  );

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.flags, 64);
  assert.equal(
    json.data.content,
    "❌ This feature is only available to Vital RP staff."
  );
});

test("SECURITY: Administrator without StaffTeam role is strictly rejected (no admin bypass)", async () => {
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
    type: InteractionType.APPLICATION_COMMAND,
    guild_id: "730015674348601384",
    member: {
      user: { id: "admin_user_no_staff_role" },
      permissions: "8", // Administrator permission bit
      roles: ["111222333444555666"], // Does NOT include STAFF_TEAM_ROLE_ID
    },
    data: {
      name: "damobot",
    },
  });

  const sig = await signDiscordPayload(body, keyPair, timestamp);
  const res = await worker.fetch(
    new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    }),
    mockEnv,
    {}
  );

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.flags, 64);
  assert.equal(
    json.data.content,
    "❌ This feature is only available to Vital RP staff."
  );
});

test("SECURITY: Owner role member (DEFAULT_OWNER_ROLE_ID) without StaffTeam role can use /damobot", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const mockEnv = {
    DISCORD_PUBLIC_KEY: publicKeyHex,
    DISCORD_BOT_TOKEN: "mock_token",
  };

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.APPLICATION_COMMAND,
    guild_id: "730015674348601384",
    member: {
      user: { id: "owner_user_damobot" },
      roles: [DEFAULT_OWNER_ROLE_ID],
    },
    data: {
      name: "damobot",
    },
  });

  const sig = await signDiscordPayload(body, keyPair, timestamp);
  const res = await worker.fetch(
    new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    }),
    mockEnv,
    {}
  );

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.flags, 32832); // IS_COMPONENTS_V2_FLAG | EPHEMERAL_FLAG
  assert.ok(json.data.components);
});

test("BUTTON INTERACTION: clicking damobot:punishment_center opens private Punishment Center", async () => {
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
      user: { id: "staff_member_777" },
      roles: ["743422836223246366"],
    },
    data: {
      custom_id: "damobot:punishment_center",
      component_type: 2,
    },
  });

  const sig = await signDiscordPayload(body, keyPair, timestamp);
  const res = await worker.fetch(
    new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    }),
    mockEnv,
    {}
  );

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.flags, 32832);
  const container = json.data.components[0];
  assert.equal(container.type, 17);
  const headerSection = container.components.find((c) => c.type === 9);
  assert.match(headerSection.components[0].content, /# ⚖️ Staff Punishment Center/);
});

test("BUTTON INTERACTION: clicking damobot:loa_center routes to LOA handler", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const mockEnv = {
    DISCORD_PUBLIC_KEY: publicKeyHex,
    DISCORD_BOT_TOKEN: "mock_token",
    STAFF_TEAM_ROLE_ID: "743422836223246366",
    LOA_CHANNEL_ID: "1546281163247722516",
  };

  const timestamp = Math.floor(Date.now() / 1000).toString();
  // When clicked from outside the LOA channel, LOA handler enforces designated channel check
  const body = JSON.stringify({
    type: InteractionType.MESSAGE_COMPONENT,
    guild_id: "730015674348601384",
    channel_id: "1234567890", // Outside LOA channel
    member: {
      user: { id: "staff_member_777" },
      roles: ["743422836223246366"],
    },
    data: {
      custom_id: "damobot:loa_center",
      component_type: 2,
    },
  });

  const sig = await signDiscordPayload(body, keyPair, timestamp);
  const res = await worker.fetch(
    new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    }),
    mockEnv,
    {}
  );

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.flags, 64);
  assert.match(json.data.content, /LOA commands can only be used in the designated LOA channel/);
});

test("REGRESSION: Invalid Ed25519 signature is rejected with 401", async () => {
  const mockEnv = {
    DISCORD_PUBLIC_KEY: "00".repeat(32),
    DISCORD_BOT_TOKEN: "mock_token",
  };

  const res = await worker.fetch(
    new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": "bad_signature",
        "x-signature-timestamp": "12345",
      },
      body: JSON.stringify({ type: 1 }),
    }),
    mockEnv,
    {}
  );

  assert.equal(res.status, 401);
});

test("REGRESSION: /ping returns pong message", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const mockEnv = {
    DISCORD_PUBLIC_KEY: publicKeyHex,
    DISCORD_BOT_TOKEN: "mock_token",
  };

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.APPLICATION_COMMAND,
    data: { name: "ping" },
  });

  const sig = await signDiscordPayload(body, keyPair, timestamp);
  const res = await worker.fetch(
    new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    }),
    mockEnv,
    {}
  );

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.content, "🏓 Pong! Damo Bot is online.");
});

test("REGRESSION: /referral self-referral protection works", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const mockEnv = {
    DISCORD_PUBLIC_KEY: publicKeyHex,
    DISCORD_BOT_TOKEN: "mock_token",
  };

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.APPLICATION_COMMAND,
    member: { user: { id: "user_sam" } },
    data: {
      name: "referral",
      options: [{ name: "referrer", value: "user_sam" }],
    },
  });

  const sig = await signDiscordPayload(body, keyPair, timestamp);
  const res = await worker.fetch(
    new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    }),
    mockEnv,
    {}
  );

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.flags, 64);
  assert.equal(json.data.content, "❌ You cannot list yourself as your referrer.");
});

