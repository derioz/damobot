import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import worker from "../src/index.js";
import {
  InteractionType,
  InteractionResponseType,
  InteractionResponseFlags,
} from "discord-interactions";
import {
  clearTokenCache,
} from "../src/googleSheets.js";

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

test("GET / returns health check message", async () => {
  const request = new Request("https://damo-bot.local/", {
    method: "GET",
  });
  const env = {};
  const res = await worker.fetch(request, env, {});

  assert.equal(res.status, 200);
  assert.equal(await res.text(), "Damo Bot is running!");
  assert.equal(
    res.headers.get("content-type"),
    "text/plain; charset=utf-8"
  );
});

test("POST / without signature headers returns 401", async () => {
  const request = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ type: InteractionType.PING }),
  });
  const env = { DISCORD_PUBLIC_KEY: "dummy_key" };
  const res = await worker.fetch(request, env, {});

  assert.equal(res.status, 401);
});

test("POST / with invalid signature returns 401", async () => {
  const request = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": "00".repeat(64),
      "x-signature-timestamp": "1234567890",
    },
    body: JSON.stringify({ type: InteractionType.PING }),
  });
  const env = {
    DISCORD_PUBLIC_KEY: "00".repeat(32),
  };
  const res = await worker.fetch(request, env, {});

  assert.equal(res.status, 401);
});

test("POST / with valid Ed25519 signature and PING returns PONG", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({ type: InteractionType.PING });
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

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json");

  const json = await res.json();
  assert.deepEqual(json, { type: InteractionResponseType.PONG });
});

test("POST / with valid signature and /ping command returns pong response", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.APPLICATION_COMMAND,
    data: {
      name: "ping",
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

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json");

  const json = await res.json();
  assert.deepEqual(json, {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: "🏓 Pong! Damo Bot is online.",
    },
  });
});

test("POST / with self-referral returns ephemeral rejection response without calling Sheets API", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.APPLICATION_COMMAND,
    member: {
      user: {
        id: "1111111111",
      },
    },
    data: {
      name: "referral",
      options: [
        {
          name: "referrer",
          value: "1111111111",
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

  const env = {
    DISCORD_PUBLIC_KEY: publicKeyHex,
    GOOGLE_SERVICE_ACCOUNT_EMAIL: "test@example.iam.gserviceaccount.com",
    GOOGLE_PRIVATE_KEY: await getTestRsaPem(),
  };
  const res = await worker.fetch(request, env, {});

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json");

  const json = await res.json();
  assert.deepEqual(json, {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: "❌ You cannot list yourself as your referrer.",
      flags: InteractionResponseFlags.EPHEMERAL,
    },
  });
});

test("POST / with valid referral writes display name to Column B, sets cell note, and returns new success message", async () => {
  clearTokenCache();
  const pem = await getTestRsaPem();

  const originalFetch = globalThis.fetch;
  let putRequestBody = null;
  let putRequestUrl = null;
  let batchRequestBody = null;

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    const decodedUrl = decodeURIComponent(urlStr);

    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(
        JSON.stringify({
          access_token: "mock_access_token",
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (decodedUrl.includes("/values/Referral Tracker!A:E") && (!options.method || options.method === "GET")) {
      return new Response(
        JSON.stringify({
          values: [
            ["Referral Date", "Referred Player", "Referred ID", "Referrer Name", "Referrer ID"],
            ["2026-08-20", "ExistingUser", "9999999999", "ExistingReferrer", "8888888888"],
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (decodedUrl.includes("fields=sheets.properties(sheetId,title)")) {
      return new Response(
        JSON.stringify({
          sheets: [
            {
              properties: {
                sheetId: 12345,
                title: "Referral Tracker",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (options.method === "PUT") {
      putRequestUrl = urlStr;
      putRequestBody = JSON.parse(options.body);
      return new Response(
        JSON.stringify({ updatedRows: 1 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (urlStr.includes(":batchUpdate") && options.method === "POST") {
      batchRequestBody = JSON.parse(options.body);
      return new Response(
        JSON.stringify({ replies: [{}] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return originalFetch(url, options);
  };

  try {
    const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ]);
    const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.APPLICATION_COMMAND,
      member: {
        nick: "John Smith",
        joined_at: "2026-08-24T18:23:45.000000+00:00",
        user: {
          id: "1111111111",
          username: "johnsmith_user",
        },
      },
      data: {
        name: "referral",
        options: [
          {
            name: "referrer",
            value: "2222222222",
          },
        ],
        resolved: {
          users: {
            "2222222222": {
              id: "2222222222",
              username: "referrer_user",
              global_name: "ReferrerGlobalName",
            },
          },
        },
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

    const env = {
      DISCORD_PUBLIC_KEY: publicKeyHex,
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "test@example.iam.gserviceaccount.com",
      GOOGLE_PRIVATE_KEY: pem,
      GOOGLE_SHEET_ID: "1pMPhLNXdLGSPCVvy_ZKZyU6OkTWP6wZBC-s_f310_xM",
      GOOGLE_SHEET_TAB: "Referral Tracker",
    };

    const res = await worker.fetch(request, env, {});
    assert.equal(res.status, 200);

    const json = await res.json();
    assert.deepEqual(json, {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content:
          "✅ Referral Submitted\n\nYou and the person who referred you have been added to the referral list.\n\nOnce all referral requirements have been met, we'll reach out to you.",
        flags: InteractionResponseFlags.EPHEMERAL,
      },
    });

    // Verify written range and values strictly mapped to A:E (never touching F-K)
    const decodedPutUrl = decodeURIComponent(putRequestUrl);
    assert.ok(decodedPutUrl.includes("Referral Tracker!A3:E3"));
    assert.equal(putRequestBody.range, "Referral Tracker!A3:E3");
    assert.equal(putRequestBody.values.length, 1);
    assert.equal(putRequestBody.values[0].length, 5);
    assert.match(putRequestBody.values[0][0], /^\d{4}-\d{2}-\d{2}$/); // Column A: Date
    assert.equal(putRequestBody.values[0][1], "John Smith"); // Column B: Display Name ONLY
    assert.equal(putRequestBody.values[0][2], "1111111111"); // Column C: Submitter ID
    assert.equal(putRequestBody.values[0][3], "ReferrerGlobalName"); // Column D: Referrer Name
    assert.equal(putRequestBody.values[0][4], "2222222222"); // Column E: Referrer ID

    // Verify cell note attached to Column B
    assert.ok(batchRequestBody != null, "Batch update for cell note must be called");
    const updateCellsReq = batchRequestBody.requests[0].updateCells;
    assert.equal(updateCellsReq.fields, "note");
    assert.equal(updateCellsReq.range.sheetId, 12345);
    assert.equal(updateCellsReq.range.startRowIndex, 2); // row 3 (0-based: 2)
    assert.equal(updateCellsReq.range.endRowIndex, 3);
    assert.equal(updateCellsReq.range.startColumnIndex, 1); // Column B
    assert.equal(updateCellsReq.range.endColumnIndex, 2);
    assert.equal(
      updateCellsReq.rows[0].values[0].note,
      "Joined Vital RP Discord: 08/24/2026"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST / with missing joined_at writes display name and sets cell note 'Joined Vital RP Discord: Unknown'", async () => {
  clearTokenCache();
  const pem = await getTestRsaPem();

  const originalFetch = globalThis.fetch;
  let putRequestBody = null;
  let batchRequestBody = null;

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    const decodedUrl = decodeURIComponent(urlStr);

    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(
        JSON.stringify({
          access_token: "mock_access_token",
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (decodedUrl.includes("/values/Referral Tracker!A:E") && (!options.method || options.method === "GET")) {
      return new Response(
        JSON.stringify({
          values: [
            ["Referral Date", "Referred Player", "Referred ID", "Referrer Name", "Referrer ID"],
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (decodedUrl.includes("fields=sheets.properties(sheetId,title)")) {
      return new Response(
        JSON.stringify({
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: "Referral Tracker",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (options.method === "PUT") {
      putRequestBody = JSON.parse(options.body);
      return new Response(
        JSON.stringify({ updatedRows: 1 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (urlStr.includes(":batchUpdate") && options.method === "POST") {
      batchRequestBody = JSON.parse(options.body);
      return new Response(
        JSON.stringify({ replies: [{}] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return originalFetch(url, options);
  };

  try {
    const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ]);
    const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.APPLICATION_COMMAND,
      member: {
        nick: "FallbackUser",
        // joined_at omitted
        user: {
          id: "3333333333",
          username: "fallback_user",
        },
      },
      data: {
        name: "referral",
        options: [
          {
            name: "referrer",
            value: "4444444444",
          },
        ],
        resolved: {
          users: {
            "4444444444": {
              id: "4444444444",
              username: "referrer44",
            },
          },
        },
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

    const env = {
      DISCORD_PUBLIC_KEY: publicKeyHex,
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "test@example.iam.gserviceaccount.com",
      GOOGLE_PRIVATE_KEY: pem,
      GOOGLE_SHEET_ID: "1pMPhLNXdLGSPCVvy_ZKZyU6OkTWP6wZBC-s_f310_xM",
      GOOGLE_SHEET_TAB: "Referral Tracker",
    };

    const res = await worker.fetch(request, env, {});
    assert.equal(res.status, 200);

    assert.equal(putRequestBody.values[0][1], "FallbackUser");
    assert.equal(putRequestBody.values[0][2], "3333333333");
    assert.equal(
      batchRequestBody.requests[0].updateCells.rows[0].values[0].note,
      "Joined Vital RP Discord: Unknown"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST / with duplicate Discord ID in Column C returns duplicate response and does not write", async () => {
  clearTokenCache();
  const pem = await getTestRsaPem();

  const originalFetch = globalThis.fetch;
  let putCalled = false;

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    const decodedUrl = decodeURIComponent(urlStr);

    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(
        JSON.stringify({
          access_token: "mock_access_token",
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (decodedUrl.includes("/values/Referral Tracker!A:E")) {
      return new Response(
        JSON.stringify({
          values: [
            ["Referral Date", "Referred Player", "Referred ID", "Referrer Name", "Referrer ID"],
            ["2026-08-20", "ExistingPlayer", "1111111111", "SomeReferrer", "8888888888"],
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (options.method === "PUT") {
      putCalled = true;
      return new Response(JSON.stringify({ updatedRows: 1 }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ]);
    const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.APPLICATION_COMMAND,
      member: {
        user: {
          id: "1111111111",
        },
      },
      data: {
        name: "referral",
        options: [
          {
            name: "referrer",
            value: "2222222222",
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

    const env = {
      DISCORD_PUBLIC_KEY: publicKeyHex,
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "test@example.iam.gserviceaccount.com",
      GOOGLE_PRIVATE_KEY: pem,
      GOOGLE_SHEET_ID: "1pMPhLNXdLGSPCVvy_ZKZyU6OkTWP6wZBC-s_f310_xM",
      GOOGLE_SHEET_TAB: "Referral Tracker",
    };

    const res = await worker.fetch(request, env, {});
    assert.equal(res.status, 200);

    const json = await res.json();
    assert.deepEqual(json, {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content:
          "❌ Referral Already Submitted\n\nYou already have a referral submission on file. If you believe this is incorrect, please contact staff.",
        flags: InteractionResponseFlags.EPHEMERAL,
      },
    });

    assert.equal(putCalled, false, "Should not write to Google Sheets on duplicate");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST / with Google API failure returns friendly ephemeral error response", async () => {
  clearTokenCache();
  const pem = await getTestRsaPem();

  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    const decodedUrl = decodeURIComponent(urlStr);

    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(
        JSON.stringify({
          access_token: "mock_access_token",
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (decodedUrl.includes("/values/Referral Tracker!A:E")) {
      return new Response("Service Unavailable", { status: 503 });
    }
    return originalFetch(url, options);
  };

  try {
    const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ]);
    const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.APPLICATION_COMMAND,
      member: {
        user: {
          id: "1111111111",
        },
      },
      data: {
        name: "referral",
        options: [
          {
            name: "referrer",
            value: "2222222222",
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

    const env = {
      DISCORD_PUBLIC_KEY: publicKeyHex,
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "test@example.iam.gserviceaccount.com",
      GOOGLE_PRIVATE_KEY: pem,
      GOOGLE_SHEET_ID: "1pMPhLNXdLGSPCVvy_ZKZyU6OkTWP6wZBC-s_f310_xM",
      GOOGLE_SHEET_TAB: "Referral Tracker",
    };

    const res = await worker.fetch(request, env, {});
    assert.equal(res.status, 200);

    const json = await res.json();
    assert.deepEqual(json, {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content:
          "❌ Submission Error\n\nAn error occurred while submitting your referral. Please try again later or contact staff.",
        flags: InteractionResponseFlags.EPHEMERAL,
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST / with missing referral options returns 400", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.APPLICATION_COMMAND,
    member: {
      user: {
        id: "1111111111",
      },
    },
    data: {
      name: "referral",
      options: [],
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

  assert.equal(res.status, 400);
});

test("POST / with unknown command returns 400", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.APPLICATION_COMMAND,
    data: {
      name: "unknown_command",
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

  assert.equal(res.status, 400);
});

test("POST / with APPLICATION_COMMAND 'Definitely Important' routes correctly", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.APPLICATION_COMMAND,
    guild_id: "730000000000000000",
    member: {
      roles: ["743422836223246366"],
      user: { id: "staff_damon" },
    },
    data: {
      name: "Definitely Important",
      type: 3,
      target_id: "msg_12345",
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

  const env = {
    DISCORD_PUBLIC_KEY: publicKeyHex,
    STAFF_TEAM_ROLE_ID: "743422836223246366",
  };
  const res = await worker.fetch(request, env, {});

  assert.equal(res.status, 200);
  const resBody = await res.json();
  assert.equal(resBody.data.flags, 64);
  assert.match(resBody.data.content, /Damo-Bot Diagnostic/);
});

test("POST / with APPLICATION_COMMAND 'Add to Punishment' routes correctly", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.toString().includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "mock_token" }));
    }
    return new Response(JSON.stringify({ values: [] }));
  };

  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.APPLICATION_COMMAND,
      guild_id: "730000000000000000",
      channel_id: "1249517344099668078",
      member: {
        roles: ["743422836223246366"],
        user: { id: "staff_damon" },
      },
      data: {
        name: "Add to Punishment",
        type: 3,
        target_id: "msg_target_id",
        resolved: {
          messages: {
            msg_target_id: {
              id: "msg_target_id",
              channel_id: "1249517344099668078",
              author: { id: "author_target_id", username: "AuthorUser" },
            },
          },
        },
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

    const env = {
      DISCORD_PUBLIC_KEY: publicKeyHex,
      STAFF_TEAM_ROLE_ID: "743422836223246366",
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "service@example.com",
      GOOGLE_PRIVATE_KEY: await getTestRsaPem(),
      PUNISHMENT_SHEET_ID: "mock_punish_sheet",
    };
    const res = await worker.fetch(request, env, {});

    assert.equal(res.status, 200);
    const resBody = await res.json();
    assert.equal(resBody.data.flags, 32832);
    assert.match(
      resBody.data.components[0].components[0].content,
      /Add Ticket Transcript/
    );
    assert.match(
      resBody.data.components[0].components[0].content,
      /Which player does this transcript belong to\?/
    );
    // User select component should be present
    const userSelectComp = resBody.data.components[0].components[1].components[0];
    assert.equal(userSelectComp.type, 5); // USER_SELECT
    assert.match(userSelectComp.custom_id, /^punish_sel_user_trans:/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
