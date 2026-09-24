import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import worker, { SuggestionsDO, StickyBotDO } from "../src/index.js";
import {
  InteractionType,
  InteractionResponseType,
  InteractionResponseFlags,
} from "discord-interactions";
import {
  suggestionsConfig,
  TEST_SUGGESTIONS_CHANNEL_ID,
  PRODUCTION_SUGGESTIONS_CHANNEL_ID,
  DEFAULT_SUGGESTIONS_CHANNEL_ID,
  getActiveCategoryOptions,
  getCategoryById,
} from "../src/config/suggestions.config.js";
import {
  isValidSuggestionUrl,
  formatCooldownTime,
  handleSuggestionCenterClick,
  handleSuggestionComponent,
  handleSuggestionModalSubmit,
} from "../src/suggestions/handlers.js";
import {
  buildSuggestionCenterSticky,
  buildCategorySelectPrompt,
  buildSuggestionModal,
  buildPublicSuggestionEmbed,
  buildSuggestionPreview,
} from "../src/suggestions/components.js";
import { handleSuggestionsCommand } from "../src/suggestions/commands.js";
import {
  formatSuggestionPublicId,
  formatSuggestionDisplayId,
} from "../src/durableObjects/suggestions.js";
import {
  DEFAULT_STAFF_TEAM_ROLE_ID,
  DEFAULT_OWNER_ROLE_ID,
  VITAL_RP_LOGO_URL,
  VITAL_ORANGE,
} from "../src/config.js";
import { ComponentType, ButtonStyle, getUserAvatarUrl } from "../src/shared/discord.js";

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

function createMockSuggestionsDO(initialData = {}) {
  const mockStorage = {
    records: new Map(),
    votes: new Map(),
    cooldowns: new Map(),
    drafts: new Map(),
    sql: {
      exec(query, ...params) {
        if (query.includes("CREATE TABLE") || query.includes("CREATE INDEX")) return [];

        if (query.includes("INSERT INTO suggestion_drafts")) {
          const [userId, draftJson] = params;
          mockStorage.drafts.set(userId, draftJson);
          return [];
        }

        if (query.includes("SELECT draft_json FROM suggestion_drafts WHERE user_id = ?")) {
          const userId = params[0];
          const draftJson = mockStorage.drafts.get(userId);
          return draftJson ? [{ draft_json: draftJson }] : [];
        }

        if (query.includes("DELETE FROM suggestion_drafts WHERE user_id = ?")) {
          const userId = params[0];
          mockStorage.drafts.delete(userId);
          return [];
        }

        if (query.includes("SELECT last_submitted_at FROM user_cooldowns")) {
          const userId = params[0];
          const ts = mockStorage.cooldowns.get(userId);
          return ts ? [{ last_submitted_at: ts }] : [];
        }

        if (query.includes("INSERT OR REPLACE INTO user_cooldowns")) {
          const [userId, ts] = params;
          mockStorage.cooldowns.set(userId, ts);
          return [];
        }

        if (query.includes("SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM suggestions")) {
          const maxId = mockStorage.records.size > 0 ? Math.max(...mockStorage.records.keys()) : 0;
          return [{ nextId: maxId + 1 }];
        }

        if (query.includes("INSERT INTO suggestions")) {
          const [
            id,
            public_id,
            user_id,
            author_tag,
            is_anonymous,
            category_id,
            category_label,
            title,
            description,
            url,
            attachment_url,
            attachment_name,
            channel_id,
            guild_id,
            created_at,
            updated_at,
          ] = params;
          mockStorage.records.set(id, {
            id,
            public_id,
            user_id,
            author_tag,
            is_anonymous,
            category_id,
            category_label,
            title,
            description,
            url,
            attachment_url,
            attachment_name,
            message_id: null,
            channel_id,
            guild_id,
            upvotes: 0,
            downvotes: 0,
            is_deleted: 0,
            created_at,
            updated_at,
          });
          return [];
        }

        if (query.includes("UPDATE suggestions SET message_id = ?")) {
          const [messageId, updatedAt, id] = params;
          const rec = mockStorage.records.get(id);
          if (rec) {
            rec.message_id = messageId;
            rec.updated_at = updatedAt;
          }
          return [];
        }

        if (query.includes("SELECT * FROM suggestions WHERE id = ?")) {
          const id = params[0];
          const rec = mockStorage.records.get(id);
          return rec ? [rec] : [];
        }

        if (query.includes("SELECT * FROM suggestions WHERE public_id = ?")) {
          const pubId = params[0];
          for (const rec of mockStorage.records.values()) {
            if (rec.public_id === pubId) return [rec];
          }
          return [];
        }

        if (query.includes("SELECT vote_type FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?")) {
          const [sugId, uId] = params;
          const voteKey = `${sugId}:${uId}`;
          const vt = mockStorage.votes.get(voteKey);
          return vt ? [{ vote_type: vt }] : [];
        }

        if (query.includes("DELETE FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?")) {
          const [sugId, uId] = params;
          mockStorage.votes.delete(`${sugId}:${uId}`);
          return [];
        }

        if (query.includes("UPDATE suggestion_votes SET vote_type = ?")) {
          const [vt, now, sugId, uId] = params;
          mockStorage.votes.set(`${sugId}:${uId}`, vt);
          return [];
        }

        if (query.includes("INSERT INTO suggestion_votes")) {
          const [sugId, uId, vt, now] = params;
          mockStorage.votes.set(`${sugId}:${uId}`, vt);
          return [];
        }

        if (query.includes("SELECT\n          COALESCE(SUM(CASE WHEN vote_type = 'up'") || query.includes("SUM(CASE WHEN vote_type = 'up'")) {
          const sugId = params[0];
          let up = 0;
          let down = 0;
          for (const [k, v] of mockStorage.votes.entries()) {
            if (k.startsWith(`${sugId}:`)) {
              if (v === "up") up++;
              if (v === "down") down++;
            }
          }
          return [{ upvotes: up, downvotes: down }];
        }

        if (query.includes("UPDATE suggestions SET upvotes = ?")) {
          const [up, down, now, id] = params;
          const rec = mockStorage.records.get(id);
          if (rec) {
            rec.upvotes = up;
            rec.downvotes = down;
            rec.updated_at = now;
          }
          return [];
        }

        if (query.includes("SELECT * FROM suggestions WHERE user_id = ?")) {
          const [uId, limit] = params;
          const list = [];
          for (const rec of mockStorage.records.values()) {
            if (rec.user_id === uId) list.push({ ...rec });
          }
          list.sort((a, b) => b.created_at - a.created_at);
          return list.slice(0, limit);
        }

        if (query.includes("SELECT * FROM suggestions\n         WHERE is_deleted = 0\n         ORDER BY (upvotes - downvotes)")) {
          const limit = params[0];
          const list = [];
          for (const rec of mockStorage.records.values()) {
            if (rec.is_deleted === 0) list.push({ ...rec });
          }
          list.sort((a, b) => {
            const scA = a.upvotes - a.downvotes;
            const scB = b.upvotes - b.downvotes;
            if (scB !== scA) return scB - scA;
            return b.upvotes - a.upvotes;
          });
          return list.slice(0, limit);
        }

        if (query.includes("SELECT * FROM suggestions\n         WHERE is_deleted = 0\n         ORDER BY created_at DESC")) {
          const limit = params[0];
          const list = [];
          for (const rec of mockStorage.records.values()) {
            if (rec.is_deleted === 0) list.push({ ...rec });
          }
          list.sort((a, b) => b.created_at - a.created_at);
          return list.slice(0, limit);
        }

        if (query.includes("UPDATE suggestions SET is_deleted = 1")) {
          const [id] = params;
          const rec = mockStorage.records.get(id);
          if (rec) rec.is_deleted = 1;
          return [];
        }

        return [];
      },
    },
  };

  const instance = new SuggestionsDO({ storage: mockStorage }, { DISCORD_BOT_TOKEN: "mock_token" });
  return { instance, mockStorage };
}

test("CONFIG: default channel is production suggestions channel (1446287220389712024)", () => {
  assert.equal(TEST_SUGGESTIONS_CHANNEL_ID, "1403073578034921512");
  assert.equal(PRODUCTION_SUGGESTIONS_CHANNEL_ID, "1446287220389712024");
  assert.equal(DEFAULT_SUGGESTIONS_CHANNEL_ID, PRODUCTION_SUGGESTIONS_CHANNEL_ID);

  // Fallback to production channel when no env var is set
  assert.equal(suggestionsConfig.channels.getActiveChannelId({}), PRODUCTION_SUGGESTIONS_CHANNEL_ID);
  // Custom env override
  assert.equal(
    suggestionsConfig.channels.getActiveChannelId({ SUGGESTIONS_CHANNEL_ID: "999888777" }),
    "999888777"
  );
});

test("CONFIG: categories are configurable and include requested defaults", () => {
  const options = getActiveCategoryOptions();
  assert.ok(options.length >= 6);

  const values = options.map((o) => o.value);
  assert.ok(values.includes("scripts"));
  assert.ok(values.includes("rule_changes"));
  assert.ok(values.includes("new_features"));
  assert.ok(values.includes("server_changes"));
  assert.ok(values.includes("qol"));
  assert.ok(values.includes("other"));

  const newFeatures = getCategoryById("new_features");
  assert.equal(newFeatures.label, "New Features");
  assert.equal(newFeatures.emoji, "💡");
});

test("URL VALIDATION: isValidSuggestionUrl accepts valid HTTPS URLs and rejects invalid/dangerous schemes", () => {
  assert.equal(isValidSuggestionUrl("https://vitalrp.com/features"), true);
  assert.equal(isValidSuggestionUrl("https://github.com/damobot"), true);

  // Rejection of insecure, empty, or dangerous schemes
  assert.equal(isValidSuggestionUrl("http://insecure.com"), false);
  assert.equal(isValidSuggestionUrl("javascript:alert(1)"), false);
  assert.equal(isValidSuggestionUrl("file:///C:/passwords.txt"), false);
  assert.equal(isValidSuggestionUrl("data:text/html;base64,PHNjcmlwdD4="), false);
  assert.equal(isValidSuggestionUrl("not-a-url"), false);
  assert.equal(isValidSuggestionUrl(""), false);
  assert.equal(isValidSuggestionUrl(null), false);
});

test("COOLDOWN FORMATTER: formatCooldownTime formats minutes and seconds cleanly", () => {
  assert.equal(formatCooldownTime(300), "5 minutes");
  assert.equal(formatCooldownTime(65), "1 minute and 5 seconds");
  assert.equal(formatCooldownTime(42), "42 seconds");
  assert.equal(formatCooldownTime(60), "1 minute");
});

test("SUGGESTIONS DO: sequential IDs format correctly", () => {
  assert.equal(formatSuggestionPublicId(1), "VRP-S-000001");
  assert.equal(formatSuggestionPublicId(42), "VRP-S-000042");
  assert.equal(formatSuggestionDisplayId(1), "#0001");
  assert.equal(formatSuggestionDisplayId(42), "#0042");
});

test("SUGGESTIONS DO: cooldown tracking and expiration", () => {
  const { instance } = createMockSuggestionsDO();

  const check1 = instance.checkCooldown("user_123", 300);
  assert.equal(check1.onCooldown, false);

  // Set cooldown now
  instance.setCooldown("user_123", Date.now());
  const check2 = instance.checkCooldown("user_123", 300);
  assert.equal(check2.onCooldown, true);
  assert.ok(check2.remainingSeconds > 0 && check2.remainingSeconds <= 300);

  // Simulate past timestamp (10 minutes ago)
  instance.setCooldown("user_123", Date.now() - 600000);
  const check3 = instance.checkCooldown("user_123", 300);
  assert.equal(check3.onCooldown, false);
});

test("SUGGESTIONS DO: suggestion creation and sequential ID assignment", () => {
  const { instance } = createMockSuggestionsDO();

  const s1 = instance.createSuggestion({
    userId: "user_1",
    authorTag: "Damon",
    isAnonymous: false,
    categoryId: "new_features",
    categoryLabel: "New Features",
    title: "Vehicle Favorites",
    description: "Allow players to favorite garage vehicles",
    channelId: "1403073578034921512",
  });

  assert.equal(s1.id, 1);
  assert.equal(s1.public_id, "VRP-S-000001");
  assert.equal(s1.display_id, "#0001");
  assert.equal(s1.upvotes, 0);
  assert.equal(s1.downvotes, 0);

  const s2 = instance.createSuggestion({
    userId: "user_2",
    authorTag: "PlayerTwo",
    isAnonymous: true,
    categoryId: "qol",
    categoryLabel: "Quality of Life",
    title: "Better Racing App",
    description: "Improve HUD display during active racing checkpoints",
    channelId: "1403073578034921512",
  });

  assert.equal(s2.id, 2);
  assert.equal(s2.public_id, "VRP-S-000002");
  assert.equal(s2.display_id, "#0002");
  assert.equal(s2.is_anonymous, 1);

  // Update message ID
  instance.updateMessageId(1, "msg_discord_111");
  const fetched = instance.getSuggestion(1);
  assert.equal(fetched.message_id, "msg_discord_111");
});

test("SUGGESTIONS DO: voting mechanics (toggle off, switch vote, independent users)", () => {
  const { instance } = createMockSuggestionsDO();

  instance.createSuggestion({
    userId: "author_1",
    authorTag: "Author",
    isAnonymous: false,
    categoryId: "scripts",
    categoryLabel: "Scripts",
    title: "Fishing Overhaul",
    description: "Add mini-games to fishing activity",
    channelId: "1403073578034921512",
  });

  // 1. User A upvotes -> 1 up, 0 down
  const vote1 = instance.voteSuggestion({
    suggestionId: 1,
    userId: "voter_a",
    voteType: "up",
  });
  assert.equal(vote1.ok, true);
  assert.equal(vote1.upvotes, 1);
  assert.equal(vote1.downvotes, 0);
  assert.equal(vote1.currentVote, "up");

  // 2. User A clicks upvote again -> toggles OFF -> 0 up, 0 down
  const vote2 = instance.voteSuggestion({
    suggestionId: 1,
    userId: "voter_a",
    voteType: "up",
  });
  assert.equal(vote2.ok, true);
  assert.equal(vote2.upvotes, 0);
  assert.equal(vote2.downvotes, 0);
  assert.equal(vote2.currentVote, null);

  // 3. User A downvotes -> 0 up, 1 down
  const vote3 = instance.voteSuggestion({
    suggestionId: 1,
    userId: "voter_a",
    voteType: "down",
  });
  assert.equal(vote3.ok, true);
  assert.equal(vote3.upvotes, 0);
  assert.equal(vote3.downvotes, 1);
  assert.equal(vote3.currentVote, "down");

  // 4. User A switches to upvote -> 1 up, 0 down
  const vote4 = instance.voteSuggestion({
    suggestionId: 1,
    userId: "voter_a",
    voteType: "up",
  });
  assert.equal(vote4.ok, true);
  assert.equal(vote4.upvotes, 1);
  assert.equal(vote4.downvotes, 0);
  assert.equal(vote4.currentVote, "up");

  // 5. User B downvotes -> 1 up, 1 down
  const vote5 = instance.voteSuggestion({
    suggestionId: 1,
    userId: "voter_b",
    voteType: "down",
  });
  assert.equal(vote5.ok, true);
  assert.equal(vote5.upvotes, 1);
  assert.equal(vote5.downvotes, 1);
});

test("SUGGESTIONS DO: deleted suggestion rejects voting gracefully", () => {
  const { instance } = createMockSuggestionsDO();

  instance.createSuggestion({
    userId: "author_1",
    authorTag: "Author",
    isAnonymous: false,
    categoryId: "scripts",
    categoryLabel: "Scripts",
    title: "Deleted Suggestion",
    description: "This will be marked deleted",
    channelId: "1403073578034921512",
  });

  instance.markSuggestionDeleted(1);

  const res = instance.voteSuggestion({
    suggestionId: 1,
    userId: "voter_a",
    voteType: "up",
  });

  assert.equal(res.ok, false);
  assert.match(res.error, /no longer available/i);
});

test("SUGGESTIONS DO: getUserSuggestions, getTopSuggestions, and getRecentSuggestions", () => {
  const { instance } = createMockSuggestionsDO();

  // Create 3 suggestions
  instance.createSuggestion({
    userId: "user_damon",
    authorTag: "Damon",
    isAnonymous: false,
    categoryId: "new_features",
    categoryLabel: "New Features",
    title: "Suggestion One",
    description: "Desc One with minimum length check",
    channelId: "1403073578034921512",
  });

  instance.createSuggestion({
    userId: "user_damon",
    authorTag: "Damon",
    isAnonymous: true,
    categoryId: "qol",
    categoryLabel: "Quality of Life",
    title: "Suggestion Two Anon",
    description: "Desc Two with minimum length check",
    channelId: "1403073578034921512",
  });

  instance.createSuggestion({
    userId: "user_other",
    authorTag: "Other",
    isAnonymous: false,
    categoryId: "rules",
    categoryLabel: "Rules",
    title: "Suggestion Three",
    description: "Desc Three with minimum length check",
    channelId: "1403073578034921512",
  });

  // Give suggestion 2 five upvotes
  instance.voteSuggestion({ suggestionId: 2, userId: "u1", voteType: "up" });
  instance.voteSuggestion({ suggestionId: 2, userId: "u2", voteType: "up" });

  // 1. My Suggestions for Damon returns both public and anonymous
  const mySuggestions = instance.getUserSuggestions("user_damon");
  assert.equal(mySuggestions.length, 2);
  const titles = mySuggestions.map((s) => s.title);
  assert.ok(titles.includes("Suggestion One"));
  assert.ok(titles.includes("Suggestion Two Anon"));

  // 2. Top Suggestions ranks suggestion 2 at the top
  const top = instance.getTopSuggestions(5);
  assert.equal(top.length, 3);
  assert.equal(top[0].id, 2);

  // 3. Recent Suggestions returns all active
  const recent = instance.getRecentSuggestions(5);
  assert.equal(recent.length, 3);
});

test("UI COMPONENTS: buildSuggestionCenterSticky creates compact native embed, message, and button", () => {
  const sticky = buildSuggestionCenterSticky();
  assert.match(sticky.messageText, /Community Suggestions/i);
  assert.equal(sticky.components.length, 1);
  const btn = sticky.components[0].components[0];
  assert.equal(btn.custom_id, "suggestions_submit");
  assert.equal(btn.label, "Submit Suggestion");
  assert.equal(btn.style, 1); // PRIMARY
  assert.deepEqual(btn.emoji, { name: "💡" });

  // Native Discord Embed verification
  assert.ok(sticky.embed, "Must provide native embed");
  assert.equal(sticky.embed.title, "💡 VITAL RP • COMMUNITY SUGGESTIONS");
  assert.match(sticky.embed.description, /Got an idea that could make Vital better\?/);
  assert.match(sticky.embed.description, /Send it below and let the community vote\./);
  assert.equal(sticky.embed.color, VITAL_ORANGE);
  assert.equal(sticky.embed.thumbnail, undefined, "Must NOT have oversized thumbnail");
  assert.equal(sticky.embed.image, undefined, "Must NOT have oversized image");
  assert.equal(sticky.embeds.length, 1);
});

test("UI COMPONENTS: buildCategorySelectPrompt is minimal and contains exactly 1 logo thumbnail", () => {
  const container = buildCategorySelectPrompt();
  assert.equal(container.type, 17, "Must be Components V2 Container");

  // Count thumbnails in container
  let thumbnailCount = 0;
  for (const comp of container.components) {
    if (comp.accessory && comp.accessory.type === 11) {
      thumbnailCount++;
    }
  }
  assert.equal(thumbnailCount, 1, "Must contain exactly 1 Vital logo thumbnail accessory");
});

test("UI COMPONENTS: buildPublicSuggestionEmbed remains compact with dynamic submitter avatar, clean header title (no header logo), and Vital footer icon", () => {
  const suggestion = {
    id: 42,
    display_id: "#0042",
    user_id: "150580708144840704",
    author_avatar: "abcdef123456",
    category_id: "new_features",
    category_label: "New Features",
    title: "Vehicle Favorites",
    description: "Allow players to favorite vehicles in their garage.",
    upvotes: 24,
    downvotes: 3,
    url: "https://vitalrp.com/vehicles",
    attachment_url: "https://cdn.discordapp.com/attachments/test/image.png",
    is_anonymous: 0,
    created_at: 1725800000000,
  };

  const { embed, components, container } = buildPublicSuggestionEmbed({
    suggestion,
    authorDisplayName: "Damon",
  });

  // Embed inspection
  assert.equal(embed.title, "NEW FEATURES • Vehicle Favorites");
  assert.equal(embed.author, undefined, "Header must not have author or logo; logo only in footer");
  assert.equal(embed.color, VITAL_ORANGE);
  assert.equal(
    embed.thumbnail.url,
    "https://cdn.discordapp.com/avatars/150580708144840704/abcdef123456.png?size=256"
  );
  assert.match(embed.footer.text, /^Submitted by Damon • #0042\nDamo-Bot /);
  assert.equal(embed.footer.icon_url, VITAL_RP_LOGO_URL);
  assert.equal(embed.image, undefined, "No large embedded image in body to preserve compactness");

  // Action row inspection
  assert.equal(components.length, 1);
  const buttons = components[0].components;
  assert.equal(buttons.length, 4); // [👍 24] [👎 3] [🖼️ View Image] [🔗 View Link]

  assert.equal(buttons[0].label, "24");
  assert.equal(buttons[0].custom_id, "sug_vote:42:up");

  assert.equal(buttons[1].label, "3");
  assert.equal(buttons[1].custom_id, "sug_vote:42:down");

  assert.equal(buttons[2].label, "View Image");
  assert.equal(buttons[2].style, 5); // LINK
  assert.equal(buttons[2].url, "https://cdn.discordapp.com/attachments/test/image.png");

  assert.equal(buttons[3].label, "View Link");
  assert.equal(buttons[3].style, 5); // LINK
  assert.equal(buttons[3].url, "https://vitalrp.com/vehicles");

  // Components V2 Container inspection (removes Discord embed 'X' button)
  assert.equal(container.type, 17, "Container must be Type 17");
  assert.equal(container.accent_color, VITAL_ORANGE);
  assert.equal(container.components.length, 4); // Section, Separator, ActionRow, Footer Section
  assert.ok(container.components[0].accessory, "Section 0 must have accessory to satisfy Discord schema");
  assert.equal(
    container.components[0].accessory.media.url,
    "https://cdn.discordapp.com/avatars/150580708144840704/abcdef123456.png?size=256"
  );
  assert.equal(container.components[3].type, ComponentType.TEXT_DISPLAY, "Footer must be TEXT_DISPLAY to keep footer compact and remove oversized thumbnail");
  assert.match(container.components[3].content, /Submitted by Damon • #0042\n-# Damo-Bot/);
});

test("UI COMPONENTS: buildPublicSuggestionEmbed with anonymous submission hides submitter name and personal avatar", () => {
  const suggestion = {
    id: 43,
    display_id: "#0043",
    user_id: "150580708144840704",
    author_avatar: "abcdef123456",
    category_id: "scripts",
    category_label: "Scripts",
    title: "Anonymous Idea",
    description: "Secret improvement to economy.",
    upvotes: 5,
    downvotes: 1,
    url: null,
    attachment_url: null,
    is_anonymous: 1,
    created_at: 1725800000000,
  };

  const { embed, components, container } = buildPublicSuggestionEmbed({
    suggestion,
    authorDisplayName: "Damon",
  });

  assert.match(embed.footer.text, /^Submitted anonymously • #0043\nDamo-Bot/);
  assert.doesNotMatch(embed.footer.text, /Damon/);
  assert.equal(embed.thumbnail.url, "https://cdn.discordapp.com/embed/avatars/0.png");
  assert.equal(
    container.components[0].accessory.media.url,
    "https://cdn.discordapp.com/embed/avatars/0.png"
  );
  // Without URL or image, exactly 2 vote buttons
  assert.equal(components[0].components.length, 2);
});

test("HANDLERS: modal submit rejects short title, short description, and invalid URL", async () => {
  // 1. Short title
  const res1 = await handleSuggestionModalSubmit(
    {
      data: {
        custom_id: "sug_modal_submit:scripts:0",
        components: [
          { components: [{ custom_id: "sug_title", value: "Hi" }] },
          { components: [{ custom_id: "sug_desc", value: "This is a long enough description to pass description check." }] },
        ],
      },
      member: { user: { id: "123", username: "Tester" } },
    },
    {}
  );
  const data1 = await res1.json();
  assert.match(data1.data.content, /Invalid Title/);

  // 2. Short description
  const res2 = await handleSuggestionModalSubmit(
    {
      data: {
        custom_id: "sug_modal_submit:scripts:0",
        components: [
          { components: [{ custom_id: "sug_title", value: "Valid Title Here" }] },
          { components: [{ custom_id: "sug_desc", value: "Too short" }] },
        ],
      },
      member: { user: { id: "123", username: "Tester" } },
    },
    {}
  );
  const data2 = await res2.json();
  assert.match(data2.data.content, /Invalid Description/);

  // 3. Insecure URL
  const res3 = await handleSuggestionModalSubmit(
    {
      data: {
        custom_id: "sug_modal_submit:scripts:0",
        components: [
          { components: [{ custom_id: "sug_title", value: "Valid Title Here" }] },
          { components: [{ custom_id: "sug_desc", value: "This is a long enough description to pass description check." }] },
          { components: [{ custom_id: "sug_url", value: "http://insecure-link.com" }] },
        ],
      },
      member: { user: { id: "123", username: "Tester" } },
    },
    {}
  );
  const data3 = await res3.json();
  assert.match(data3.data.content, /Invalid URL/);
});

test("HANDLERS: modal submit with valid data returns Ephemeral Preview with action buttons", async () => {
  const res = await handleSuggestionModalSubmit(
    {
      data: {
        custom_id: "sug_modal_submit:new_features:0",
        components: [
          { components: [{ custom_id: "sug_title", value: "Garage Vehicle Favorites" }] },
          { components: [{ custom_id: "sug_desc", value: "Allow players to favorite their most-used garage vehicles." }] },
          { components: [{ custom_id: "sug_url", value: "https://vitalrp.com" }] },
        ],
      },
      member: { user: { id: "123", username: "Damon" } },
    },
    {}
  );

  const json = await res.json();
  assert.equal(json.type, InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
  assert.equal(json.data.flags, InteractionResponseFlags.EPHEMERAL);
  assert.match(json.data.content, /Suggestion Preview/);
  assert.equal(json.data.embeds.length, 1);

  // Buttons: Confirm, Edit, Cancel
  const buttons = json.data.components[0].components;
  assert.equal(buttons.length, 3);
  assert.match(buttons[0].custom_id, /^sug_confirm:/);
  assert.match(buttons[1].custom_id, /^sug_edit:/);
  assert.match(buttons[2].custom_id, /^sug_cancel:/);
  for (const btn of buttons) {
    assert.ok(
      btn.custom_id.length <= 100,
      `Preview button custom_id "${btn.custom_id}" (${btn.custom_id.length} chars) must not exceed Discord limit of 100`
    );
  }
});

test("HANDLERS: modal submit with 600-char description and image keeps custom_id well under 100 chars", async () => {
  const { instance: mockSuggestionsDO } = createMockSuggestionsDO();
  const mockEnv = {
    SUGGESTIONS: {
      idFromName: () => "global",
      get: () => mockSuggestionsDO,
    },
  };

  const longDesc = "A".repeat(599);
  const res = await handleSuggestionModalSubmit(
    {
      data: {
        custom_id: "sug_modal_submit:rule_changes:0",
        components: [
          { components: [{ custom_id: "sug_title", value: "Allow Peeing" }] },
          { components: [{ custom_id: "sug_desc", value: longDesc }] },
          { components: [{ custom_id: "sug_url", value: "" }] },
          { components: [{ custom_id: "sug_image_url", value: "https://r2.fivemanage.com/image/C1LsVUcolyRC.png" }] },
        ],
      },
      member: { user: { id: "150580708144840704", username: "Damon" } },
    },
    mockEnv
  );

  const json = await res.json();
  assert.equal(json.type, InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
  const buttons = json.data.components[0].components;
  for (const btn of buttons) {
    assert.ok(
      btn.custom_id.length <= 100,
      `custom_id "${btn.custom_id}" length ${btn.custom_id.length} must be <= 100`
    );
  }
});

test("COMMANDS: /suggestions setup restricted to superadmin and configures sticky", async () => {
  const { instance: mockSticky } = (() => {
    const mockStorage = {
      records: new Map(),
      sql: { exec: () => [] },
    };
    const instance = new StickyBotDO({ storage: mockStorage }, { DISCORD_BOT_TOKEN: "mock_token" });
    return { instance };
  })();

  const mockEnv = {
    SUGGESTIONS: {
      idFromName: () => "mock_id",
      get: () => ({ fetch: async () => new Response(JSON.stringify([])) }),
    },
    STICKY_BOT: {
      idFromName: () => "mock_sticky_id",
      get: () => ({
        fetch: async (url, opts) => {
          return new Response(JSON.stringify({ ok: true }));
        },
      }),
    },
    STAFF_TEAM_ROLE_ID: DEFAULT_STAFF_TEAM_ROLE_ID,
  };

  // 1. Unauthorized member rejected
  const resUnauthorized = await handleSuggestionsCommand(
    {
      data: {
        options: [{ name: "setup" }],
      },
      member: { user: { id: "888888888888888888" }, roles: ["some_random_role"] },
    },
    mockEnv
  );
  const unauthJson = await resUnauthorized.json();
  assert.match(unauthJson.data.content, /Only bot superadmins can configure the Suggestion Center/);

  // 2. Regular staff member (not superadmin) is also rejected
  const resStaffRejected = await handleSuggestionsCommand(
    {
      data: {
        options: [
          {
            name: "setup",
            options: [{ name: "channel", value: TEST_SUGGESTIONS_CHANNEL_ID }],
          },
        ],
      },
      member: {
        user: { id: "777777777777777777" },
        roles: [DEFAULT_STAFF_TEAM_ROLE_ID],
      },
    },
    mockEnv
  );
  const staffJson = await resStaffRejected.json();
  assert.match(staffJson.data.content, /Only bot superadmins can configure the Suggestion Center/);

  // 3. Superadmin user (150580708144840704) is permitted
  const resSuperadmin = await handleSuggestionsCommand(
    {
      data: {
        options: [
          {
            name: "setup",
            options: [{ name: "channel", value: TEST_SUGGESTIONS_CHANNEL_ID }],
          },
        ],
      },
      member: {
        user: { id: "150580708144840704" },
        roles: [],
      },
    },
    mockEnv
  );
  const authJson = await resSuperadmin.json();
  assert.match(authJson.data.content, /Suggestion Center active/);
  assert.match(authJson.data.content, new RegExp(TEST_SUGGESTIONS_CHANNEL_ID));
});

test("STICKY REPOST: pollAndRefreshStickyMessages on suggestions channel posts compact embed with Submit button and no duplicate content", async () => {
  let postedPayload = null;
  const mockFetch = async (url, options) => {
    if (url.includes("/messages?limit=1")) {
      return new Response(JSON.stringify([{ id: "player_msg_1", content: "hello" }]));
    }
    if (options?.method === "POST" && url.includes("/messages")) {
      postedPayload = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "new_sticky_msg_id" }));
    }
    if (options?.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify({}));
  };

  const instance = new StickyBotDO(
    { storage: { records: new Map() } },
    { DISCORD_BOT_TOKEN: "mock_token" }
  );

  instance.setStickyConfig({
    channelId: "chan_sug_sticky",
    guildId: "guild_sug",
    messageText: "Legacy text in DB",
    currentMessageId: "old_sticky_id",
    buttonAction: "suggestions_submit",
    buttonLabel: "Submit Suggestion",
    buttonStyle: 1,
    buttonEmoji: "💡",
  });

  const refreshResult = await instance.pollAndRefreshStickyMessages(mockFetch);
  assert.equal(refreshResult.refreshed, 1);
  assert.ok(postedPayload, "Must post message to Discord");
  assert.equal(postedPayload.content, undefined, "Content must not be duplicated when embed is present");
  assert.ok(postedPayload.embeds && postedPayload.embeds.length === 1, "Must contain embed");
  assert.equal(postedPayload.embeds[0].title, "💡 VITAL RP • COMMUNITY SUGGESTIONS");
  assert.equal(postedPayload.embeds[0].color, VITAL_ORANGE);
  assert.ok(postedPayload.components && postedPayload.components.length === 1, "Must contain button");
  assert.equal(postedPayload.components[0].components[0].custom_id, "suggestions_submit");
});

test("END-TO-END ROUTING: worker.fetch routes /suggestions, components, and modals safely", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = Buffer.from(rawPublicKey).toString("hex");

  const { instance: mockSuggestionsDO } = createMockSuggestionsDO();

  const mockEnv = {
    DISCORD_PUBLIC_KEY: publicKeyHex,
    DISCORD_BOT_TOKEN: "mock_token",
    SUGGESTIONS: {
      idFromName: () => "global",
      get: () => mockSuggestionsDO,
    },
    STICKY_BOT: {
      idFromName: () => "global",
      get: () => ({ fetch: async () => new Response(JSON.stringify({ ok: true })) }),
    },
    SUGGESTIONS_CHANNEL_ID: TEST_SUGGESTIONS_CHANNEL_ID,
  };

  // 1. Route /suggestions mine through worker.fetch
  const cmdPayload = JSON.stringify({
    id: "int_sug_cmd",
    type: InteractionType.APPLICATION_COMMAND,
    data: {
      name: "suggestions",
      options: [{ name: "mine" }],
    },
    member: { user: { id: "user_test_99", username: "Tester" } },
  });
  const timestamp = String(Date.now());
  const sig = await signDiscordPayload(cmdPayload, keyPair, timestamp);

  const req = new Request("https://worker/", {
    method: "POST",
    headers: {
      "x-signature-ed25519": sig,
      "x-signature-timestamp": timestamp,
    },
    body: cmdPayload,
  });

  const res = await worker.fetch(req, mockEnv, {});
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.type, InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
  assert.match(json.data.content, /My Suggestions/);

  // 2. Route suggestions_submit component through worker.fetch
  const compPayload = JSON.stringify({
    id: "int_sug_btn",
    type: InteractionType.MESSAGE_COMPONENT,
    data: {
      custom_id: "suggestions_submit",
    },
    member: { user: { id: "user_test_99", username: "Tester" } },
  });
  const compSig = await signDiscordPayload(compPayload, keyPair, timestamp);

  const compReq = new Request("https://worker/", {
    method: "POST",
    headers: {
      "x-signature-ed25519": compSig,
      "x-signature-timestamp": timestamp,
    },
    body: compPayload,
  });

  const compRes = await worker.fetch(compReq, mockEnv, {});
  assert.equal(compRes.status, 200);
  const compJson = await compRes.json();
  assert.equal(compJson.type, InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
  assert.ok(compJson.data.components.length > 0);

  // 3. Route sticky:suggestions_submit component through worker.fetch
  const stickyCompPayload = JSON.stringify({
    id: "int_sug_sticky_btn",
    type: InteractionType.MESSAGE_COMPONENT,
    data: {
      custom_id: "sticky:suggestions_submit",
    },
    member: { user: { id: "user_test_99", username: "Tester" } },
  });
  const stickyCompSig = await signDiscordPayload(stickyCompPayload, keyPair, timestamp);
  const stickyCompReq = new Request("https://worker/", {
    method: "POST",
    headers: {
      "x-signature-ed25519": stickyCompSig,
      "x-signature-timestamp": timestamp,
    },
    body: stickyCompPayload,
  });
  const stickyCompRes = await worker.fetch(stickyCompReq, mockEnv, {});
  assert.equal(stickyCompRes.status, 200);
  const stickyCompJson = await stickyCompRes.json();
  assert.equal(stickyCompJson.type, InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
  assert.ok(stickyCompJson.data.components.length > 0);
});

test("END-TO-END FLOW: confirm posts suggestion, repositions sticky, and cancels without junk data", async () => {
  const { instance: mockSuggestionsDO } = createMockSuggestionsDO();

  let postedBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (url.includes("discord.com/api/v10/channels")) {
      postedBody = JSON.parse(opts.body);
      return new Response(JSON.stringify({ id: "discord_msg_777" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(url, opts);
  };

  let stickyRefreshed = false;
  const mockEnv = {
    DISCORD_BOT_TOKEN: "mock_token",
    SUGGESTIONS: {
      idFromName: () => "global",
      get: () => mockSuggestionsDO,
    },
    STICKY_BOT: {
      idFromName: () => "global",
      get: () => ({
        fetch: async (url) => {
          if (url.includes("/sticky/refresh")) stickyRefreshed = true;
          return new Response(JSON.stringify({ ok: true }));
        },
      }),
    },
    SUGGESTIONS_CHANNEL_ID: TEST_SUGGESTIONS_CHANNEL_ID,
  };

  try {
    // 1. Submit modal to get preview
    const modalRes = await handleSuggestionModalSubmit(
      {
        data: {
          custom_id: "sug_modal_submit:scripts:0",
          components: [
            { components: [{ custom_id: "sug_title", value: "New Fishing Spots" }] },
            { components: [{ custom_id: "sug_desc", value: "Add more fishing docks around Paleto Bay with rare catches." }] },
            { components: [{ custom_id: "sug_url", value: "https://vitalrp.com/fishing" }] },
          ],
        },
        member: { user: { id: "user_fish", username: "Angler" } },
      },
      mockEnv
    );

    const modalJson = await modalRes.json();
    const confirmBtn = modalJson.data.components[0].components.find((b) => b.custom_id.startsWith("sug_confirm:"));
    assert.ok(confirmBtn);

    // 2. Click Confirm
    const confirmRes = await handleSuggestionComponent(
      {
        data: {
          custom_id: confirmBtn.custom_id,
        },
        member: { user: { id: "user_fish", username: "Angler" } },
      },
      mockEnv,
      {}
    );

    const confirmJson = await confirmRes.json();
    assert.match(confirmJson.data.content, /Suggestion Submitted/);
    assert.match(confirmJson.data.content, /#0001/);
    assert.equal(stickyRefreshed, true, "Sticky must be refreshed immediately upon posting suggestion");
    assert.ok(postedBody);
    assert.equal(postedBody.allowed_mentions.parse.length, 0, "Mentions must be empty array to prevent pings");
    assert.ok(postedBody.embeds && postedBody.embeds.length === 1, "Must post embeds array identical to preview");
    assert.equal(postedBody.embeds[0].title, "SCRIPTS • New Fishing Spots");
    assert.equal(postedBody.embeds[0].footer.icon_url, VITAL_RP_LOGO_URL);
    assert.equal(postedBody.components.length, 1);
    assert.equal(postedBody.components[0].type, 1, "Must be ActionRow with vote buttons");

    // 3. Test Cancel
    const cancelRes = await handleSuggestionComponent(
      {
        data: {
          custom_id: "sug_cancel",
        },
        member: { user: { id: "user_cancel", username: "Canceler" } },
      },
      mockEnv,
      {}
    );
    const cancelJson = await cancelRes.json();
    assert.match(cancelJson.data.content, /cancelled/i);
    // Ensure no extra records were created
    const cancelUserSuggestions = mockSuggestionsDO.getUserSuggestions("user_cancel");
    assert.equal(cancelUserSuggestions.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("VOTING INTERACTION: clicking vote button on Components V2 Container updates nested button labels", async () => {
  const { instance: mockSuggestionsDO } = createMockSuggestionsDO();

  // Create a suggestion first in the DO
  const createRes = await mockSuggestionsDO.fetch("https://do/suggestions/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      categoryId: "scripts",
      categoryLabel: "Scripts",
      title: "Custom Radio",
      description: "Allow players to tune into custom community radio stations.",
      authorId: "12345",
      authorTag: "Damon",
      isAnonymous: 0,
    }),
  });
  const created = await createRes.json();

  const { container } = buildPublicSuggestionEmbed({
    suggestion: created,
    authorDisplayName: "Damon",
  });

  const mockEnv = {
    SUGGESTIONS: {
      idFromName: () => "global",
      get: () => mockSuggestionsDO,
    },
  };

  // Upvote the suggestion via button click on the Container message
  const voteRes = await handleSuggestionComponent(
    {
      data: {
        custom_id: `sug_vote:${created.id}:up`,
      },
      member: { user: { id: "voter_1", username: "Voter" } },
      message: {
        flags: 32768,
        components: [container],
      },
    },
    mockEnv,
    {}
  );

  const voteJson = await voteRes.json();
  assert.equal(voteJson.type, InteractionResponseType.UPDATE_MESSAGE);
  assert.equal(voteJson.data.flags, 32768, "Must preserve IS_COMPONENTS_V2_FLAG");

  // Verify the updated button inside the container reflects 1 upvote
  const updatedContainer = voteJson.data.components[0];
  assert.equal(updatedContainer.type, 17, "Container must remain Type 17");
  const actionRow = updatedContainer.components.find((c) => c.type === 1);
  assert.ok(actionRow, "ActionRow must exist inside Container");
  const upBtn = actionRow.components.find((b) => b.custom_id === `sug_vote:${created.id}:up`);
  assert.equal(upBtn.label, "1", "Upvote button label must be updated to 1");
  const downBtn = actionRow.components.find((b) => b.custom_id === `sug_vote:${created.id}:down`);
  assert.equal(downBtn.label, "0", "Downvote button label must remain 0");
});

test("VOTING INTERACTION: clicking vote button on standard embed message updates ActionRow button labels", async () => {
  const { instance: mockSuggestionsDO } = createMockSuggestionsDO();

  const createRes = await mockSuggestionsDO.fetch("https://do/suggestions/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      categoryId: "scripts",
      categoryLabel: "Scripts",
      title: "Custom Radio",
      description: "Allow players to tune into custom community radio stations.",
      authorId: "12345",
      authorTag: "Damon",
      isAnonymous: 0,
    }),
  });
  const created = await createRes.json();

  const { embed, actionRow } = buildPublicSuggestionEmbed({
    suggestion: created,
    authorDisplayName: "Damon",
  });

  const mockEnv = {
    SUGGESTIONS: {
      idFromName: () => "global",
      get: () => mockSuggestionsDO,
    },
  };

  // Upvote the suggestion via button click on standard embed message
  const voteRes = await handleSuggestionComponent(
    {
      data: {
        custom_id: `sug_vote:${created.id}:up`,
      },
      member: { user: { id: "voter_2", username: "Voter2" } },
      message: {
        embeds: [embed],
        components: [actionRow],
      },
    },
    mockEnv,
    {}
  );

  const voteJson = await voteRes.json();
  assert.equal(voteJson.type, InteractionResponseType.UPDATE_MESSAGE);
  assert.equal(voteJson.data.flags, undefined, "Standard message must not send IS_COMPONENTS_V2_FLAG");

  // Verify the updated button reflects 1 upvote
  const updatedRow = voteJson.data.components[0];
  assert.equal(updatedRow.type, 1, "Must remain ActionRow");
  const upBtn = updatedRow.components.find((b) => b.custom_id === `sug_vote:${created.id}:up`);
  assert.equal(upBtn.label, "1", "Upvote button label must be updated to 1");
});

test("SUGGESTION MODAL: buildSuggestionModal omits empty value fields to prevent Discord schema rejection", () => {
  const blankModal = buildSuggestionModal({
    categoryId: "scripts",
    isAnonymous: false,
  });

  assert.equal(blankModal.custom_id, "sug_modal_submit:scripts:0");
  assert.equal(blankModal.title, "New Suggestion: Scripts");
  assert.equal(blankModal.components.length, 4);

  // Verify none of the blank inputs contain an empty value property
  for (const row of blankModal.components) {
    const input = row.components[0];
    assert.strictEqual(
      input.value,
      undefined,
      `Empty input ${input.custom_id} must not have value property (Discord BASE_TYPE_BAD_LENGTH)`
    );
  }

  // Verify prefilled modal contains value property
  const prefilledModal = buildSuggestionModal({
    categoryId: "new_features",
    isAnonymous: true,
    initialTitle: "Custom Title Here",
    initialDescription: "This is a detailed description meeting minimum length requirements.",
    initialUrl: "https://vitalrp.com",
    initialImageUrl: "https://vitalrp.com/img.png",
  });

  assert.equal(prefilledModal.custom_id, "sug_modal_submit:new_features:1");
  assert.equal(prefilledModal.title, "New Suggestion: New Features");
  assert.equal(prefilledModal.components[0].components[0].value, "Custom Title Here");
  assert.equal(
    prefilledModal.components[1].components[0].value,
    "This is a detailed description meeting minimum length requirements."
  );
  assert.equal(prefilledModal.components[2].components[0].value, "https://vitalrp.com");
  assert.equal(prefilledModal.components[3].components[0].value, "https://vitalrp.com/img.png");
});

test("SUGGESTION INTERACTION: clicking Continue to Form (sug_open_modal) returns Type 9 modal instantly", async () => {
  const mockEnv = {
    DEFAULT_STAFF_TEAM_ROLE_ID,
    DEFAULT_OWNER_ROLE_ID,
  };

  const res = await handleSuggestionComponent(
    {
      data: {
        custom_id: "sug_open_modal:scripts:0",
      },
      member: { user: { id: "user_test_modal", username: "Tester" } },
    },
    mockEnv,
    {}
  );

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.type, 9, "Must return InteractionResponseType.MODAL (9)");
  assert.ok(json.data);
  assert.equal(json.data.custom_id, "sug_modal_submit:scripts:0");
  assert.equal(json.data.title, "New Suggestion: Scripts");
  assert.equal(json.data.components.length, 4);

  // Title text input
  const titleInput = json.data.components[0].components[0];
  assert.equal(titleInput.type, 4);
  assert.equal(titleInput.custom_id, "sug_title");
  assert.strictEqual(titleInput.value, undefined, "Title input must not have empty value");

  // Description text input
  const descInput = json.data.components[1].components[0];
  assert.equal(descInput.type, 4);
  assert.equal(descInput.custom_id, "sug_desc");
  assert.strictEqual(descInput.value, undefined, "Description input must not have empty value");
});

test("AVATAR HELPER: getUserAvatarUrl resolves custom avatars, animated avatars, and default avatars", () => {
  // 1. Custom static avatar
  const staticUrl = getUserAvatarUrl({
    id: "150580708144840704",
    avatar: "3f8b030b77a726f1",
  });
  assert.equal(
    staticUrl,
    "https://cdn.discordapp.com/avatars/150580708144840704/3f8b030b77a726f1.png?size=256"
  );

  // 2. Custom animated avatar
  const animUrl = getUserAvatarUrl({
    id: "150580708144840704",
    avatar: "a_3f8b030b77a726f1",
  });
  assert.equal(
    animUrl,
    "https://cdn.discordapp.com/avatars/150580708144840704/a_3f8b030b77a726f1.gif?size=256"
  );

  // 3. User with no avatar and pomelo (discriminator "0")
  const defaultPomeloUrl = getUserAvatarUrl({
    id: "150580708144840704",
    avatar: null,
    discriminator: "0",
  });
  const expectedIndex = Number((BigInt("150580708144840704") >> 22n) % 6n);
  assert.equal(defaultPomeloUrl, `https://cdn.discordapp.com/embed/avatars/${expectedIndex}.png`);

  // 4. User with legacy discriminator
  const defaultLegacyUrl = getUserAvatarUrl({
    id: "150580708144840704",
    avatar: null,
    discriminator: "1337",
  });
  assert.equal(defaultLegacyUrl, "https://cdn.discordapp.com/embed/avatars/2.png"); // 1337 % 5 = 2

  // 5. Null or empty user
  assert.equal(getUserAvatarUrl(null), "https://cdn.discordapp.com/embed/avatars/0.png");
  assert.equal(getUserAvatarUrl({}), "https://cdn.discordapp.com/embed/avatars/0.png");
});

test("UI COMPONENTS: buildSuggestionPreview passes dynamic submitter avatar to preview embed", () => {
  const draft = {
    categoryId: "server_changes",
    categoryLabel: "Server Changes",
    title: "Testing Changes",
    description: "Testing suggestion embed layout with all requirements.",
    url: null,
    attachmentUrl: null,
    isAnonymous: false,
  };

  const preview = buildSuggestionPreview({
    draft,
    authorTag: "little.ms.mystic",
    draftToken: "token_123",
    authorAvatarUrl: "https://cdn.discordapp.com/avatars/123/avatar.png?size=256",
  });

  assert.equal(preview.embeds.length, 1);
  const embed = preview.embeds[0];
  assert.equal(embed.title, "SERVER CHANGES • Testing Changes");
  assert.equal(embed.author, undefined, "Header must not have author or logo; logo only in footer");
  assert.equal(embed.thumbnail.url, "https://cdn.discordapp.com/avatars/123/avatar.png?size=256");
  assert.match(embed.footer.text, /^Submitted by little\.ms\.mystic • #DRAFT\nDamo-Bot/);
  assert.equal(embed.footer.icon_url, VITAL_RP_LOGO_URL);
});

test("UI CONSISTENCY: draft preview and final posted suggestion share the exact same embed layout, structure, and branding", () => {
  const draft = {
    categoryId: "rule_changes",
    categoryLabel: "Rule Changes",
    title: "Vehicle Impound Clarification",
    description: "Clarify rules on police impounding vehicles during active scenes.",
    url: null,
    attachmentUrl: null,
    isAnonymous: false,
  };

  const preview = buildSuggestionPreview({
    draft,
    authorTag: "mcspace",
    draftToken: "token_abc",
    authorAvatarUrl: "https://cdn.discordapp.com/avatars/123/avatar.png?size=256",
  });

  const previewEmbed = preview.embeds[0];

  const finalSuggestion = {
    ...draft,
    id: 7,
    display_id: "#0007",
    upvotes: 0,
    downvotes: 0,
    created_at: 1725800000000,
  };

  const { embed: postedEmbed } = buildPublicSuggestionEmbed({
    suggestion: finalSuggestion,
    authorDisplayName: "mcspace",
    authorAvatarUrl: "https://cdn.discordapp.com/avatars/123/avatar.png?size=256",
  });

  // 1. Both have identical title and no header logo
  assert.equal(previewEmbed.title, "RULE CHANGES • Vehicle Impound Clarification");
  assert.equal(postedEmbed.title, "RULE CHANGES • Vehicle Impound Clarification");
  assert.equal(previewEmbed.author, undefined, "Draft must have no author header logo");
  assert.equal(postedEmbed.author, undefined, "Posted must have no author header logo");

  // 2. Both have identical descriptions and colors
  assert.equal(previewEmbed.description, postedEmbed.description);
  assert.equal(previewEmbed.color, postedEmbed.color);

  // 3. Both have submitter avatar in top-right thumbnail
  assert.equal(previewEmbed.thumbnail.url, "https://cdn.discordapp.com/avatars/123/avatar.png?size=256");
  assert.equal(postedEmbed.thumbnail.url, "https://cdn.discordapp.com/avatars/123/avatar.png?size=256");

  // 4. Both have Vital logo in footer icon ONLY
  assert.equal(previewEmbed.footer.icon_url, VITAL_RP_LOGO_URL);
  assert.equal(postedEmbed.footer.icon_url, VITAL_RP_LOGO_URL);

  // 5. Dynamic footer text matches layout:
  // Submitted by <username> • <id>
  // Damo-Bot <version>
  assert.match(postedEmbed.footer.text, /^Submitted by mcspace • #0007\nDamo-Bot /);
  assert.match(previewEmbed.footer.text, /^Submitted by mcspace • #DRAFT\nDamo-Bot /);
});

test("NO DELETE OPTION: posted suggestion embeds have NO ❌ / X delete button and reject delete interactions", async () => {
  const { actionRow, components } = buildPublicSuggestionEmbed({
    suggestion: {
      id: 42,
      category_id: "scripts",
      title: "Bank Robbery Tweaks",
      description: "Adjust cooldown times for bank robberies.",
      upvotes: 3,
      downvotes: 1,
      is_anonymous: 0,
      url: "https://example.com/info",
    },
    authorDisplayName: "Robber",
  });

  // 1. Verify actionRow buttons contain ONLY vote and link buttons, NO delete / cancel / ❌ button
  const rowButtons = actionRow.components;
  assert.equal(rowButtons.length, 3, "Expected 2 vote buttons + 1 link button");
  assert.equal(rowButtons[0].custom_id, "sug_vote:42:up");
  assert.equal(rowButtons[1].custom_id, "sug_vote:42:down");
  assert.equal(rowButtons[2].label, "View Link");

  for (const btn of rowButtons) {
    assert.notEqual(btn.style, ButtonStyle.DANGER, "No button on posted suggestion may use DANGER style");
    assert.ok(!btn.label || !btn.label.toLowerCase().includes("delete"), "No button may say delete");
    assert.ok(!btn.label || !btn.label.toLowerCase().includes("cancel"), "No button may say cancel");
    assert.ok(!btn.emoji || (btn.emoji.name !== "❌" && btn.emoji.name !== "✖️"), "No button may use ❌ emoji");
  }

  // 2. Verify handleSuggestionComponent rejects any delete or remove interaction
  const mockEnv = {
    SUGGESTIONS: {
      idFromName: () => "global",
      get: () => ({}),
    },
  };

  const deleteRes = await handleSuggestionComponent(
    {
      data: { custom_id: "sug_delete:42" },
      member: { user: { id: "user_1", username: "User" } },
    },
    mockEnv,
    {}
  );
  const deleteJson = await deleteRes.json();
  assert.match(deleteJson.data.content, /Published suggestions cannot be deleted/);

  const removeRes = await handleSuggestionComponent(
    {
      data: { custom_id: "sug_remove:42" },
      member: { user: { id: "user_1", username: "User" } },
    },
    mockEnv,
    {}
  );
  const removeJson = await removeRes.json();
  assert.match(removeJson.data.content, /Published suggestions cannot be deleted/);

  // 3. Verify sug_cancel cannot be executed on non-ephemeral / public channel messages
  const cancelOnPublicRes = await handleSuggestionComponent(
    {
      data: { custom_id: "sug_cancel:42" },
      member: { user: { id: "user_1", username: "User" } },
      message: {
        flags: 0, // Public message, NOT ephemeral
      },
    },
    mockEnv,
    {}
  );
  const cancelJson = await cancelOnPublicRes.json();
  assert.match(cancelJson.data.content, /Published suggestions cannot be deleted/);
});


