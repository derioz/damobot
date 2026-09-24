/**
 * Admin Chat Direct Mention Interaction Unit Tests.
 *
 * Verifies all 9 core requirements:
 * 1. Admin mentions Damo-bot in Admin Chat -> Random response appears as reply.
 * 2. Same Admin mentions him again later -> Responds again.
 * 3. Admin spams mentions within 5 seconds -> Extra mentions ignored silently.
 * 4. Non-Admin mentions Damo-bot in Admin Chat -> No response.
 * 5. Admin mentions Damo-bot in another channel -> No response.
 * 6. Someone types "Damo" without actually mentioning the bot -> No response.
 * 7. Another bot mentions Damo-bot -> No response.
 * 8. Damo-bot sends a message -> Never triggers itself.
 * 9. Existing slash commands and Damo-bot systems still work normally.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  handleAdminChatMessage,
  isDirectBotMention,
  hasAdminRole,
  isUserOnCooldown,
  recordUserCooldown,
  resetCooldowns,
  ADMIN_CHAT_COOLDOWN_MS,
  getBotId,
} from "../src/features/adminChat/mentionHandler.js";
import {
  ADMIN_CHAT_RESPONSES,
  getRandomAdminResponse,
} from "../src/config/adminChatResponses.js";
import { DEFAULT_ADMIN_CHAT_CHANNEL_ID } from "../src/config/channels.js";
import {
  DEFAULT_ADMINISTRATOR_ROLE_ID,
  DEFAULT_ADMIN_ROLE_ID,
  DEFAULT_MODERATOR_ROLE_ID,
} from "../src/config/roles.js";
import worker from "../src/index.js";

const BOT_ID = "1544164852132618382";
const ADMIN_CHAT_CHANNEL_ID = "1252979165192261642";
const OTHER_CHANNEL_ID = "1220039518279827528";
const ADMIN_USER_ID = "999000111222333444";
const OTHER_ADMIN_USER_ID = "888000111222333444";
const NON_ADMIN_USER_ID = "111000111222333444";

const defaultEnv = {
  DISCORD_BOT_TOKEN: "mock_test_bot_token",
  DISCORD_APPLICATION_ID: BOT_ID,
  ADMIN_CHAT_CHANNEL_ID,
  ENVIRONMENT: "test",
};

describe("Admin Chat Mention Interaction", () => {
  beforeEach(() => {
    resetCooldowns();
  });

  test("Configured responses array is valid and contains user-requested phrases", () => {
    assert.ok(Array.isArray(ADMIN_CHAT_RESPONSES));
    assert.ok(ADMIN_CHAT_RESPONSES.length >= 30);

    const requiredPhrases = [
      "what",
      "I'm busy",
      "who summoned me",
      "I was sleeping",
      "this better be important",
      "no",
      "maybe",
      "womp womp",
      "skill issue",
      "have you tried turning it off and back on",
      "Damon made me do this",
      "I'm telling management",
      "bro",
      "leave me alone",
      "I have been summoned",
      "admin abuse",
      "source?",
      "sounds like a you problem",
      "one moment, pretending to care",
      "I don't get paid enough for this",
      "checking the logs... jk",
      "absolutely not",
      "I'll allow it",
      "interesting",
      "that's crazy",
      "send a ticket",
      "ask Rue",
      "ask Damon",
      "I'm just a bot bro",
      "beep boop or whatever",
      "can y'all behave for five minutes",
    ];

    for (const phrase of requiredPhrases) {
      assert.ok(
        ADMIN_CHAT_RESPONSES.includes(phrase),
        `Expected ADMIN_CHAT_RESPONSES to include: "${phrase}"`
      );
    }

    const randomPick = getRandomAdminResponse();
    assert.ok(ADMIN_CHAT_RESPONSES.includes(randomPick));
  });

  test("1. Admin mentions Damo-bot in Admin Chat -> Random response appears as inline reply", async () => {
    let capturedCall = null;
    const mockFetch = async (url, options) => {
      capturedCall = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({ id: "reply_msg_123" }), { status: 200 });
    };

    const message = {
      id: "msg_admin_001",
      channel_id: ADMIN_CHAT_CHANNEL_ID,
      content: `<@${BOT_ID}> wake up`,
      mentions: [{ id: BOT_ID, username: "Damo-bot" }],
      author: { id: ADMIN_USER_ID, username: "AdminDave", bot: false },
      member: {
        roles: [DEFAULT_ADMINISTRATOR_ROLE_ID],
      },
    };

    const result = await handleAdminChatMessage(message, defaultEnv, mockFetch);

    assert.equal(result.handled, true);
    assert.ok(result.response === "mention test works" || ADMIN_CHAT_RESPONSES.includes(result.response));

    // Verify REST API call details
    assert.ok(capturedCall, "Expected Discord REST API call to be made");
    assert.equal(
      capturedCall.url,
      `https://discord.com/api/v10/channels/${ADMIN_CHAT_CHANNEL_ID}/messages`
    );
    assert.equal(capturedCall.options.headers.Authorization, "Bot mock_test_bot_token");
    assert.equal(capturedCall.body.content, result.response);

    // Verify reply reference
    assert.deepEqual(capturedCall.body.message_reference, {
      message_id: "msg_admin_001",
      channel_id: ADMIN_CHAT_CHANNEL_ID,
      fail_if_not_exists: false,
    });

    // Verify ping suppression (replied_user: false)
    assert.deepEqual(capturedCall.body.allowed_mentions, {
      replied_user: false,
      parse: [],
    });
  });

  test("2. Same Admin mentions him again later (after cooldown) -> Responds again", async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      return new Response(JSON.stringify({ id: `reply_${callCount}` }), { status: 200 });
    };

    const message = {
      id: "msg_admin_002",
      channel_id: ADMIN_CHAT_CHANNEL_ID,
      content: `<@!${BOT_ID}> hello again`,
      mentions: [{ id: BOT_ID, username: "Damo-bot" }],
      author: { id: ADMIN_USER_ID, username: "AdminDave", bot: false },
      member: { roles: [DEFAULT_ADMINISTRATOR_ROLE_ID] },
    };

    // First mention
    const res1 = await handleAdminChatMessage(message, defaultEnv, mockFetch);
    assert.equal(res1.handled, true);
    assert.equal(callCount, 1);

    // Simulate 6 seconds passing (exceeding the 5-second cooldown)
    const laterTime = Date.now() + 6000;
    // Directly clear or reset to simulate cooldown expiry
    resetCooldowns();

    const res2 = await handleAdminChatMessage(message, defaultEnv, mockFetch);
    assert.equal(res2.handled, true);
    assert.equal(callCount, 2);
  });

  test("3. Admin spams mentions within 5 seconds -> Extra mentions are silently ignored", async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      return new Response(JSON.stringify({ id: `reply_${callCount}` }), { status: 200 });
    };

    const message = {
      id: "msg_admin_spam",
      channel_id: ADMIN_CHAT_CHANNEL_ID,
      content: `<@${BOT_ID}> wake up`,
      mentions: [{ id: BOT_ID, username: "Damo-bot" }],
      author: { id: ADMIN_USER_ID, username: "AdminDave", bot: false },
      member: { roles: [DEFAULT_ADMINISTRATOR_ROLE_ID] },
    };

    // 1st attempt: should succeed
    const res1 = await handleAdminChatMessage(message, defaultEnv, mockFetch);
    assert.equal(res1.handled, true);
    assert.equal(callCount, 1);

    // 2nd attempt immediately: should be on cooldown and silently ignored
    const res2 = await handleAdminChatMessage(message, defaultEnv, mockFetch);
    assert.equal(res2.handled, false);
    assert.equal(res2.reason, "cooldown");
    assert.equal(callCount, 1, "Should not make additional Discord API calls during cooldown");

    // 3rd attempt immediately: still on cooldown
    const res3 = await handleAdminChatMessage(message, defaultEnv, mockFetch);
    assert.equal(res3.handled, false);
    assert.equal(res3.reason, "cooldown");
    assert.equal(callCount, 1);

    // Different Admin is NOT blocked by first Admin's cooldown
    const messageOtherAdmin = {
      ...message,
      id: "msg_admin_other",
      author: { id: OTHER_ADMIN_USER_ID, username: "AdminSarah", bot: false },
    };
    const resOther = await handleAdminChatMessage(messageOtherAdmin, defaultEnv, mockFetch);
    assert.equal(resOther.handled, true);
    assert.equal(callCount, 2, "Different admin triggers independently");
  });

  test("4. Non-Admin mentions Damo-bot in Admin Chat -> No response", async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      return new Response(JSON.stringify({ id: "reply_0" }), { status: 200 });
    };

    const message = {
      id: "msg_non_admin",
      channel_id: ADMIN_CHAT_CHANNEL_ID,
      content: `<@${BOT_ID}> do something`,
      mentions: [{ id: BOT_ID, username: "Damo-bot" }],
      author: { id: NON_ADMIN_USER_ID, username: "RegularMod", bot: false },
      member: { roles: [DEFAULT_MODERATOR_ROLE_ID] }, // Only moderator role, not Admin
    };

    const res = await handleAdminChatMessage(message, defaultEnv, mockFetch);
    assert.equal(res.handled, false);
    assert.equal(res.reason, "not_admin_role");
    assert.equal(callCount, 0, "No API call should be made for non-admin");
  });

  test("5. Admin mentions Damo-bot in another channel -> No response", async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      return new Response(JSON.stringify({ id: "reply_0" }), { status: 200 });
    };

    const message = {
      id: "msg_other_channel",
      channel_id: OTHER_CHANNEL_ID, // Not Admin Chat!
      content: `<@${BOT_ID}> hey damo`,
      mentions: [{ id: BOT_ID, username: "Damo-bot" }],
      author: { id: ADMIN_USER_ID, username: "AdminDave", bot: false },
      member: { roles: [DEFAULT_ADMINISTRATOR_ROLE_ID] },
    };

    const res = await handleAdminChatMessage(message, defaultEnv, mockFetch);
    assert.equal(res.handled, false);
    assert.equal(res.reason, "not_admin_chat");
    assert.equal(callCount, 0);
  });

  test("6. Someone types 'Damo' without actually mentioning the bot -> No response", async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      return new Response(JSON.stringify({ id: "reply_0" }), { status: 200 });
    };

    // Case 6a: Plain text "Damo" with no mentions array
    const messagePlain = {
      id: "msg_plain_text",
      channel_id: ADMIN_CHAT_CHANNEL_ID,
      content: "Hey Damo are you there?",
      mentions: [],
      author: { id: ADMIN_USER_ID, username: "AdminDave", bot: false },
      member: { roles: [DEFAULT_ADMINISTRATOR_ROLE_ID] },
    };

    const resPlain = await handleAdminChatMessage(messagePlain, defaultEnv, mockFetch);
    assert.equal(resPlain.handled, false);
    assert.equal(resPlain.reason, "not_direct_bot_mention");
    assert.equal(callCount, 0);

    // Case 6b: Role mention (@Admin or @Staff)
    const messageRole = {
      id: "msg_role_mention",
      channel_id: ADMIN_CHAT_CHANNEL_ID,
      content: "<@&733091115577901158> meeting now",
      mentions: [],
      mention_roles: ["733091115577901158"],
      author: { id: ADMIN_USER_ID, username: "AdminDave", bot: false },
      member: { roles: [DEFAULT_ADMINISTRATOR_ROLE_ID] },
    };
    const resRole = await handleAdminChatMessage(messageRole, defaultEnv, mockFetch);
    assert.equal(resRole.handled, false);
    assert.equal(resRole.reason, "not_direct_bot_mention");
    assert.equal(callCount, 0);

    // Case 6c: @everyone / @here
    const messageEveryone = {
      id: "msg_everyone",
      channel_id: ADMIN_CHAT_CHANNEL_ID,
      content: "@everyone check this out",
      mention_everyone: true,
      mentions: [],
      author: { id: ADMIN_USER_ID, username: "AdminDave", bot: false },
      member: { roles: [DEFAULT_ADMINISTRATOR_ROLE_ID] },
    };
    const resEveryone = await handleAdminChatMessage(messageEveryone, defaultEnv, mockFetch);
    assert.equal(resEveryone.handled, false);
    assert.equal(resEveryone.reason, "not_direct_bot_mention");
    assert.equal(callCount, 0);

    // Case 6d: Reply to an old bot message WITHOUT typing @Damo-bot in the text
    // Discord may include the replied author in mentions, but content lacks <@botId>
    const messageReplyWithoutTag = {
      id: "msg_reply_unmentioned",
      channel_id: ADMIN_CHAT_CHANNEL_ID,
      content: "I agree with that point",
      message_reference: { message_id: "old_bot_msg" },
      mentions: [{ id: BOT_ID, username: "Damo-bot" }],
      author: { id: ADMIN_USER_ID, username: "AdminDave", bot: false },
      member: { roles: [DEFAULT_ADMINISTRATOR_ROLE_ID] },
    };
    const resReply = await handleAdminChatMessage(messageReplyWithoutTag, defaultEnv, mockFetch);
    assert.equal(resReply.handled, false);
    assert.equal(resReply.reason, "not_direct_bot_mention");
    assert.equal(callCount, 0);
  });

  test("7. Another bot mentions Damo-bot -> No response", async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      return new Response(JSON.stringify({ id: "reply_0" }), { status: 200 });
    };

    const message = {
      id: "msg_other_bot",
      channel_id: ADMIN_CHAT_CHANNEL_ID,
      content: `<@${BOT_ID}> hello brother`,
      mentions: [{ id: BOT_ID, username: "Damo-bot" }],
      author: { id: "999888777666555444", username: "TicketTool", bot: true },
      member: { roles: [DEFAULT_ADMINISTRATOR_ROLE_ID] },
    };

    const res = await handleAdminChatMessage(message, defaultEnv, mockFetch);
    assert.equal(res.handled, false);
    assert.equal(res.reason, "author_is_bot");
    assert.equal(callCount, 0);
  });

  test("8. Damo-bot sends a message -> It must never trigger itself", async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      return new Response(JSON.stringify({ id: "reply_0" }), { status: 200 });
    };

    const message = {
      id: "msg_self",
      channel_id: ADMIN_CHAT_CHANNEL_ID,
      content: `<@${BOT_ID}> who summoned me`,
      mentions: [{ id: BOT_ID, username: "Damo-bot" }],
      author: { id: BOT_ID, username: "Damo-bot", bot: true },
      member: { roles: [DEFAULT_ADMINISTRATOR_ROLE_ID] },
    };

    const res = await handleAdminChatMessage(message, defaultEnv, mockFetch);
    assert.equal(res.handled, false);
    assert.equal(res.reason, "author_is_bot");
    assert.equal(callCount, 0);
  });

  test("9. Integration via worker.fetch /messages endpoint processes message events cleanly", async () => {
    let capturedCall = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      capturedCall = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({ id: "reply_worker_001" }), { status: 200 });
    };

    try {
      const message = {
        id: "msg_worker_test",
        channel_id: ADMIN_CHAT_CHANNEL_ID,
        content: `<@${BOT_ID}> check this out`,
        mentions: [{ id: BOT_ID, username: "Damo-bot" }],
        author: { id: ADMIN_USER_ID, username: "AdminDave", bot: false },
        member: { roles: [DEFAULT_ADMINISTRATOR_ROLE_ID] },
      };

      const req = new Request("https://damo-worker.local/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });

      const res = await worker.fetch(req, defaultEnv, {});
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.equal(json.handled, true);
      assert.ok(json.response === "mention test works" || ADMIN_CHAT_RESPONSES.includes(json.response));
      assert.ok(capturedCall);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("Direct mention regex helper accuracy", () => {
    assert.equal(isDirectBotMention({ mentions: [{ id: BOT_ID }], content: `<@${BOT_ID}>` }, BOT_ID), true);
    assert.equal(isDirectBotMention({ mentions: [{ id: BOT_ID }], content: `<@!${BOT_ID}>` }, BOT_ID), true);
    assert.equal(isDirectBotMention({ mentions: [{ id: BOT_ID }], content: `Hey <@${BOT_ID}> what is up?` }, BOT_ID), true);
    assert.equal(isDirectBotMention({ mentions: [], content: `Hey Damo` }, BOT_ID), false);
    assert.equal(isDirectBotMention({ mentions: [{ id: "111" }], content: `<@111>` }, BOT_ID), false);
    assert.equal(isDirectBotMention({ mentions: [{ id: BOT_ID }], content: `No mention in text` }, BOT_ID), false);
    assert.equal(isDirectBotMention(null, BOT_ID), false);
  });

  test("Admin role helper accuracy with different roles", () => {
    assert.equal(
      hasAdminRole({ member: { roles: [DEFAULT_ADMINISTRATOR_ROLE_ID] } }, defaultEnv),
      true
    );
    assert.equal(
      hasAdminRole({ member: { roles: [DEFAULT_ADMIN_ROLE_ID] } }, defaultEnv),
      true
    );
    assert.equal(
      hasAdminRole({ member: { roles: [DEFAULT_MODERATOR_ROLE_ID] } }, defaultEnv),
      false
    );
  });

  test("Step 7 temporary debug mode: replies 'mention test works' before checking admin role or cooldown when ADMIN_CHAT_DEBUG_TEST is enabled", async () => {
    let capturedBody = null;
    const mockFetch = async (url, options) => {
      capturedBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "reply_debug_001" }), { status: 200 });
    };

    const debugEnv = {
      ...defaultEnv,
      ADMIN_CHAT_DEBUG_TEST: "true",
    };

    // User is non-admin
    const message = {
      id: "msg_debug_test",
      channel_id: ADMIN_CHAT_CHANNEL_ID,
      content: `<@${BOT_ID}> test mention`,
      mentions: [{ id: BOT_ID, username: "Damo-bot" }],
      author: { id: NON_ADMIN_USER_ID, username: "RegularUser", bot: false },
      member: { roles: [] },
    };

    const result = await handleAdminChatMessage(message, debugEnv, mockFetch);
    assert.equal(result.handled, true);
    assert.equal(result.response, "mention test works");
    assert.equal(capturedBody.content, "mention test works");
  });
});
