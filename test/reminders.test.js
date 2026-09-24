import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { COMMAND_HANDLERS, COMPONENT_HANDLERS } from "../src/router/registry.js";
import {
  parseReminderDuration,
  formatDiscordRelativeTime,
  formatDiscordFullTime,
} from "../src/reminders/time.js";
import {
  isThreadChannel,
  hasAdminPermission,
  canCreateGenericReminder,
  canCancelReminder,
} from "../src/reminders/permissions.js";
import {
  DEFAULT_TICKET_REMINDER_CHANNEL_ID,
  DEFAULT_SUPPORT_ROLE_ID,
  DEFAULT_MODERATOR_ROLE_ID,
  ReminderType,
  ReminderStatus,
  ReminderCustomId,
  DEFAULT_PERSONAL_REMINDER_MESSAGE,
  DEFAULT_GENERIC_REMINDER_MESSAGE,
} from "../src/reminders/constants.js";
import {
  createMockRemindersDatabase,
  createReminder,
  getReminderById,
  getDueReminders,
  claimReminder,
  markReminderSent,
  revertReminderPending,
  cancelReminder,
  getPendingRemindersByUser,
  getPendingRemindersByThread,
} from "../src/reminders/db.js";
import { processDueTicketReminders } from "../src/reminders/cron.js";
import {
  handleRemindCommand,
  handleRemindComponent,
} from "../src/reminders/handlers.js";
import {
  DEFAULT_STAFF_TEAM_ROLE_ID,
  DEFAULT_OWNER_ROLE_ID,
  DEFAULT_VRP_MANAGEMENT_ROLE_ID,
} from "../src/config.js";

// Helper to create a test environment with mock D1 database and fetch interception
function createTestEnv(overrides = {}) {
  const mockDb = createMockRemindersDatabase();
  return {
    ENVIRONMENT: "test",
    DISCORD_APPLICATION_ID: "1544164852132618382",
    DISCORD_BOT_TOKEN: "mock-bot-token-test",
    DISCORD_GUILD_ID: "730015674348601384",
    TICKET_REMINDER_CHANNEL_ID: DEFAULT_TICKET_REMINDER_CHANNEL_ID,
    SUPPORT_STAFF_ROLE_ID: DEFAULT_SUPPORT_ROLE_ID,
    MODERATOR_ROLE_ID: DEFAULT_MODERATOR_ROLE_ID,
    STAFF_TEAM_ROLE_ID: DEFAULT_STAFF_TEAM_ROLE_ID,
    OWNER_ROLE_ID: DEFAULT_OWNER_ROLE_ID,
    VRP_MANAGEMENT_ROLE_ID: DEFAULT_VRP_MANAGEMENT_ROLE_ID,
    PUNISHMENT_DB: mockDb,
    DB: mockDb,
    REMINDERS_ENABLED: "true",
    ...overrides,
  };
}

// Helper to create a mock interaction
function createMockInteraction({
  subcommand = "create",
  options = [],
  channelType = 11, // Guild Public Thread
  channelId = "111222333444555666",
  channelName = "ticket-1234",
  parentId = "1220039518279827528",
  userId = "999888777666555444",
  roles = [DEFAULT_STAFF_TEAM_ROLE_ID],
  permissions = "0",
} = {}) {
  const dataOptions = [];
  if (subcommand) {
    dataOptions.push({
      type: 1, // SUB_COMMAND
      name: subcommand,
      options,
    });
  }

  return {
    id: `interaction_${Date.now()}_${Math.random()}`,
    type: 2, // APPLICATION_COMMAND
    guild_id: "730015674348601384",
    channel_id: channelId,
    channel: {
      id: channelId,
      name: channelName,
      type: channelType,
      parent_id: parentId,
    },
    member: {
      user: {
        id: userId,
        username: "TestStaff",
        discriminator: "0001",
      },
      roles,
      permissions,
    },
    data: {
      name: "remind",
      options: dataOptions,
    },
  };
}

test("REMINDER TIME PARSER: validates durations (30m, 1h, 2h, 6h, 12h, 24h, 2d, 3d, 7d)", () => {
  // Minutes
  const t30m = parseReminderDuration("30m");
  assert.equal(t30m.durationMs, 30 * 60 * 1000);
  assert.equal(t30m.amount, 30);
  assert.equal(t30m.unit, "m");

  // Hours
  assert.equal(parseReminderDuration("1h").durationMs, 1 * 3600 * 1000);
  assert.equal(parseReminderDuration("2h").durationMs, 2 * 3600 * 1000);
  assert.equal(parseReminderDuration("6h").durationMs, 6 * 3600 * 1000);
  assert.equal(parseReminderDuration("12h").durationMs, 12 * 3600 * 1000);
  assert.equal(parseReminderDuration("24h").durationMs, 24 * 3600 * 1000);

  // Days
  assert.equal(parseReminderDuration("2d").durationMs, 2 * 86400 * 1000);
  assert.equal(parseReminderDuration("3d").durationMs, 3 * 86400 * 1000);
  assert.equal(parseReminderDuration("7d").durationMs, 7 * 86400 * 1000);

  // Whitespace and case-insensitivity
  assert.equal(parseReminderDuration("  24H  ").durationMs, 24 * 3600 * 1000);
  assert.equal(parseReminderDuration("1m").durationMs, 60 * 1000);

  // Invalid formats
  assert.equal(parseReminderDuration("invalid"), null);
  assert.equal(parseReminderDuration("0m"), null);
  assert.equal(parseReminderDuration("-5h"), null);
  assert.equal(parseReminderDuration("100d"), null); // Exceeds 30d max limit
  assert.equal(parseReminderDuration(""), null);
});

test("REMINDER PERMISSIONS: verifies thread guard and staff/admin permissions", () => {
  // Valid threads: type 10 (News thread), 11 (Public thread), 12 (Private thread), or thread_metadata
  assert.equal(isThreadChannel({ channel: { type: 11 } }), true);
  assert.equal(isThreadChannel({ channel: { type: 12 } }), true);
  assert.equal(isThreadChannel({ channel: { type: 10 } }), true);
  assert.equal(isThreadChannel({ channel: { thread_metadata: {} } }), true);
  assert.equal(isThreadChannel({ channel: { type: 0 } }), false); // Normal text channel

  // Admin permission: bit 8n (ADMINISTRATOR)
  assert.equal(
    hasAdminPermission(
      { member: { permissions: "8", roles: [] } },
      {}
    ),
    true
  );

  // Admin role: Owner or Management
  assert.equal(
    hasAdminPermission(
      { member: { permissions: "0", roles: [DEFAULT_OWNER_ROLE_ID] } },
      { OWNER_ROLE_ID: DEFAULT_OWNER_ROLE_ID }
    ),
    true
  );

  // Normal staff is not admin
  assert.equal(
    hasAdminPermission(
      { member: { permissions: "0", roles: [DEFAULT_STAFF_TEAM_ROLE_ID] } },
      { OWNER_ROLE_ID: DEFAULT_OWNER_ROLE_ID }
    ),
    false
  );
});

test("1 & 2 & 3. Create a 1-minute personal reminder, confirm writes to D1 and ticket confirmation appears", async () => {
  const env = createTestEnv();
  const interaction = createMockInteraction({
    subcommand: "create",
    options: [{ name: "time", value: "1m" }],
    channelName: "ticket-4567",
  });

  const res = await handleRemindCommand(interaction, env);
  const data = await res.json();

  // 3. Confirm ticket confirmation appears
  assert.equal(data.type, 4); // Public response in thread
  assert.ok(data.data.content.includes("⏰ **Ticket Reminder Set**"));
  assert.ok(data.data.content.includes("<@999888777666555444>"));
  assert.ok(data.data.content.includes(DEFAULT_PERSONAL_REMINDER_MESSAGE));
  assert.ok(data.data.components.length > 0);
  assert.equal(data.data.components[0].components[0].label, "Cancel Reminder");

  // 2. Confirm it writes to D1
  const reminders = await getPendingRemindersByUser({
    env,
    userId: "999888777666555444",
  });
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].thread_id, "111222333444555666");
  assert.equal(reminders[0].reminder_type, ReminderType.PERSONAL);
  assert.equal(reminders[0].status, ReminderStatus.PENDING);
});

test("4, 5, 6, 7, 8. Due personal reminder posts in Support Chat, mentions staff member, has link, marks sent, never sends twice", async () => {
  const env = createTestEnv();

  // Insert a reminder that is due right now
  const saved = await createReminder({
    env,
    reminder: {
      guild_id: "730015674348601384",
      thread_id: "111222333444555666",
      thread_name: "ticket-1001",
      parent_channel_id: "1220039518279827528",
      created_by_user_id: "123456789012345678",
      reminder_type: ReminderType.PERSONAL,
      reminder_message: "Check if the player replied to our unban inquiry.",
      created_at: new Date(Date.now() - 3600000).toISOString(),
      remind_at: new Date(Date.now() - 60000).toISOString(), // Due 1 minute ago
    },
  });

  // Mock global fetch to intercept Discord message post to Support Chat
  const originalFetch = globalThis.fetch;
  const postedMessages = [];

  globalThis.fetch = async (url, options) => {
    if (url.includes("/channels/") && url.includes("/messages")) {
      const payload = JSON.parse(options.body);
      postedMessages.push({ url, payload, headers: options.headers });
      return new Response(JSON.stringify({ id: "discord_msg_1", ...payload }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(url, options);
  };

  try {
    // 4. Run cron processing
    const count = await processDueTicketReminders(env, {});
    assert.equal(count, 1);

    // 4. Confirm it posts in Support Chat (channel 1220039518279827528)
    assert.equal(postedMessages.length, 1);
    const post = postedMessages[0];
    assert.ok(post.url.includes("1220039518279827528"));

    // 5. Confirm the correct staff member is mentioned
    assert.ok(post.payload.content.includes("<@123456789012345678>, your ticket reminder is due."));
    assert.deepEqual(post.payload.allowed_mentions.users, ["123456789012345678"]);

    // 6. Confirm the ticket link works
    assert.ok(post.payload.content.includes("https://discord.com/channels/730015674348601384/111222333444555666"));
    assert.ok(post.payload.content.includes("[#ticket-1001]"));

    // 7. Confirm it becomes 'sent'
    const updated = await getReminderById({ env, id: saved.id });
    assert.equal(updated.status, ReminderStatus.SENT);
    assert.ok(updated.sent_at);

    // 8. Confirm it never sends twice on second cron run
    const count2 = await processDueTicketReminders(env, {});
    assert.equal(count2, 0);
    assert.equal(postedMessages.length, 1); // No new message posted
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("9 & 10. Custom reminder message vs default fallback message", async () => {
  const env = createTestEnv();

  // 9. No custom message
  const interactionDefault = createMockInteraction({
    subcommand: "create",
    options: [{ name: "time", value: "2h" }],
  });
  const resDefault = await handleRemindCommand(interactionDefault, env);
  const jsonDefault = await resDefault.json();
  assert.ok(jsonDefault.data.content.includes(DEFAULT_PERSONAL_REMINDER_MESSAGE));

  // 10. With custom message
  const customNote = "Check if player uploaded their proof video.";
  const interactionCustom = createMockInteraction({
    subcommand: "create",
    options: [
      { name: "time", value: "2h" },
      { name: "message", value: customNote },
    ],
  });
  const resCustom = await handleRemindCommand(interactionCustom, env);
  const jsonCustom = await resCustom.json();
  assert.ok(jsonCustom.data.content.includes(customNote));
});

test("11. Invalid time format rejects cleanly with helpful message", async () => {
  const env = createTestEnv();
  const interaction = createMockInteraction({
    subcommand: "create",
    options: [{ name: "time", value: "tomorrow-afternoon" }],
  });

  const res = await handleRemindCommand(interaction, env);
  const data = await res.json();
  assert.equal(data.type, 4);
  assert.equal(data.data.flags, 64); // Ephemeral
  assert.ok(data.data.content.includes("Invalid time format"));
  assert.ok(data.data.content.includes("tomorrow-afternoon"));
  assert.ok(data.data.content.includes("30m"));
});

test("12. /remind outside a thread is rejected with exact required message", async () => {
  const env = createTestEnv();
  const interaction = createMockInteraction({
    subcommand: "create",
    options: [{ name: "time", value: "1h" }],
    channelType: 0, // Guild Text Channel (not a thread)
    parentId: "",
  });

  const res = await handleRemindCommand(interaction, env);
  const data = await res.json();
  assert.equal(data.type, 4);
  assert.equal(data.data.flags, 64); // Ephemeral
  assert.equal(
    data.data.content,
    "Ticket reminders can only be created inside a ticket thread."
  );
});

test("13. Multiple reminders can be created and listed with /remind list", async () => {
  const env = createTestEnv();
  const staffId = "555444333222111000";

  // Create 2 reminders
  await handleRemindCommand(
    createMockInteraction({
      userId: staffId,
      subcommand: "create",
      options: [
        { name: "time", value: "1h" },
        { name: "message", value: "First check" },
      ],
    }),
    env
  );

  await handleRemindCommand(
    createMockInteraction({
      userId: staffId,
      subcommand: "create",
      options: [
        { name: "time", value: "24h" },
        { name: "message", value: "Second check" },
      ],
    }),
    env
  );

  // List reminders
  const listInteraction = createMockInteraction({
    userId: staffId,
    subcommand: "list",
  });
  const listRes = await handleRemindCommand(listInteraction, env);
  const listData = await listRes.json();

  assert.equal(listData.type, 4);
  assert.equal(listData.data.flags, 64); // Ephemeral
  assert.ok(listData.data.content.includes("First check"));
  assert.ok(listData.data.content.includes("Second check"));
  assert.ok(listData.data.content.includes("⏰ **Your Active Ticket Reminders**"));
});

test("14. Cancelling a reminder via button and slash command", async () => {
  const env = createTestEnv();
  const staffId = "555444333222111000";

  // Create reminder
  const createRes = await handleRemindCommand(
    createMockInteraction({
      userId: staffId,
      subcommand: "create",
      options: [{ name: "time", value: "6h" }],
    }),
    env
  );
  const createData = await createRes.json();
  const cancelBtnCustomId = createData.data.components[0].components[0].custom_id;
  const reminderId = cancelBtnCustomId.replace(ReminderCustomId.BTN_CANCEL_PREFIX, "");

  // Cancel via Button Click by Creator
  const btnInteraction = {
    type: 3, // MESSAGE_COMPONENT
    guild_id: "730015674348601384",
    data: {
      custom_id: cancelBtnCustomId,
    },
    member: {
      user: { id: staffId },
      roles: [DEFAULT_STAFF_TEAM_ROLE_ID],
      permissions: "0",
    },
  };

  const btnRes = await handleRemindComponent(btnInteraction, env);
  const btnData = await btnRes.json();
  assert.equal(btnData.type, 7); // UPDATE_MESSAGE
  assert.ok(btnData.data.content.includes("Ticket Reminder Cancelled"));

  // Verify status in D1 is cancelled
  const cancelledRow = await getReminderById({ env, id: reminderId });
  assert.equal(cancelledRow.status, ReminderStatus.CANCELLED);

  // Unauthorized user attempting to cancel another's reminder via slash command is denied
  const createRes2 = await handleRemindCommand(
    createMockInteraction({
      userId: staffId,
      subcommand: "create",
      options: [{ name: "time", value: "12h" }],
    }),
    env
  );
  const createData2 = await createRes2.json();
  const reminderId2 = createData2.data.components[0].components[0].custom_id.replace(
    ReminderCustomId.BTN_CANCEL_PREFIX,
    ""
  );

  const unauthorizedSlashCancel = createMockInteraction({
    userId: "attacker_user_999",
    subcommand: "cancel",
    options: [{ name: "id", value: reminderId2 }],
    roles: [DEFAULT_STAFF_TEAM_ROLE_ID],
    permissions: "0",
  });
  const unauthRes = await handleRemindCommand(unauthorizedSlashCancel, env);
  const unauthData = await unauthRes.json();
  assert.ok(unauthData.data.content.includes("You do not have permission to cancel this reminder"));
});

test("15. Deleted/archived thread behavior: cron does not crash and handles safely", async () => {
  const env = createTestEnv();

  // Create due reminder with empty thread name or deleted thread
  await createReminder({
    env,
    reminder: {
      guild_id: "730015674348601384",
      thread_id: "999999999999999999",
      thread_name: "", // Thread name unavailable
      parent_channel_id: "1220039518279827528",
      created_by_user_id: "123456789012345678",
      reminder_type: ReminderType.PERSONAL,
      reminder_message: "Check archived ticket.",
      created_at: new Date(Date.now() - 3600000).toISOString(),
      remind_at: new Date(Date.now() - 1000).toISOString(),
    },
  });

  const originalFetch = globalThis.fetch;
  let postedContent = "";
  globalThis.fetch = async (url, options) => {
    if (url.includes("/channels/") && url.includes("/messages")) {
      const payload = JSON.parse(options.body);
      postedContent = payload.content;
      return new Response(JSON.stringify({ id: "msg_ok" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const count = await processDueTicketReminders(env, {});
    assert.equal(count, 1);
    assert.ok(postedContent.includes("[Open Ticket]"));
    assert.ok(postedContent.includes("https://discord.com/channels/730015674348601384/999999999999999999"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("16. Discord API failure handling: does not mark sent, reverts to pending, retries next cron", async () => {
  const env = createTestEnv();

  const saved = await createReminder({
    env,
    reminder: {
      guild_id: "730015674348601384",
      thread_id: "111222333444555666",
      thread_name: "ticket-failed",
      parent_channel_id: "1220039518279827528",
      created_by_user_id: "123456789012345678",
      reminder_type: ReminderType.PERSONAL,
      reminder_message: "Check API failure.",
      created_at: new Date(Date.now() - 3600000).toISOString(),
      remind_at: new Date(Date.now() - 1000).toISOString(),
    },
  });

  const originalFetch = globalThis.fetch;
  let attempts = 0;

  // First run fails with 500 Discord error
  globalThis.fetch = async (url, options) => {
    if (url.includes("/channels/") && url.includes("/messages")) {
      attempts++;
      if (attempts === 1) {
        return new Response(JSON.stringify({ message: "Internal Server Error" }), {
          status: 500,
        });
      }
      return new Response(JSON.stringify({ id: "msg_success" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    // 1st Cron run: fails
    const count1 = await processDueTicketReminders(env, {});
    assert.equal(count1, 0);

    // Status reverted to pending
    const status1 = await getReminderById({ env, id: saved.id });
    assert.equal(status1.status, ReminderStatus.PENDING);
    assert.equal(status1.sent_at, null);

    // 2nd Cron run: succeeds
    const count2 = await processDueTicketReminders(env, {});
    assert.equal(count2, 1);

    const status2 = await getReminderById({ env, id: saved.id });
    assert.equal(status2.status, ReminderStatus.SENT);
    assert.ok(status2.sent_at);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("17 & 18. Generic Admin Reminder: Admin allowed, non-admin denied", async () => {
  const env = createTestEnv();

  // 18. Non-admin staff attempts generic:true -> denied
  const nonAdminInteraction = createMockInteraction({
    userId: "normal_staff_123",
    subcommand: "create",
    options: [
      { name: "time", value: "24h" },
      { name: "generic", value: true },
    ],
    roles: [DEFAULT_STAFF_TEAM_ROLE_ID],
    permissions: "0",
  });

  const nonAdminRes = await handleRemindCommand(nonAdminInteraction, env);
  const nonAdminData = await nonAdminRes.json();
  assert.equal(nonAdminData.type, 4);
  assert.equal(nonAdminData.data.flags, 64);
  assert.ok(
    nonAdminData.data.content.includes("Only Administrators can create generic staff reminders")
  );

  // 17. Admin (Owner role) creates generic:true -> allowed
  const adminInteraction = createMockInteraction({
    userId: "admin_user_456",
    subcommand: "create",
    options: [
      { name: "time", value: "24h" },
      { name: "generic", value: true },
    ],
    roles: [DEFAULT_STAFF_TEAM_ROLE_ID, DEFAULT_OWNER_ROLE_ID],
    permissions: "0",
  });

  const adminRes = await handleRemindCommand(adminInteraction, env);
  const adminData = await adminRes.json();
  assert.equal(adminData.type, 4);
  assert.ok(adminData.data.content.includes("⏰ **Ticket Reminder Set**"));
  assert.ok(
    adminData.data.content.includes(
      `Support Staff (<@&${DEFAULT_SUPPORT_ROLE_ID}>) and Moderators (<@&${DEFAULT_MODERATOR_ROLE_ID}>)`
    )
  );
  assert.ok(adminData.data.content.includes(DEFAULT_GENERIC_REMINDER_MESSAGE));
});

test("19, 20, 21, 22. Generic reminder delivery: pings Support & Moderator roles, uses correct message, never sends twice, allowed_mentions explicit", async () => {
  const env = createTestEnv();

  // Insert due generic reminder
  const saved = await createReminder({
    env,
    reminder: {
      guild_id: "730015674348601384",
      thread_id: "777888999000111222",
      thread_name: "ticket-9999",
      parent_channel_id: "1220039518279827528",
      created_by_user_id: "admin_user_456",
      reminder_type: ReminderType.STAFF,
      reminder_message: "Please check on this ticket and close it if no further action is needed.",
      created_at: new Date(Date.now() - 3600000).toISOString(),
      remind_at: new Date(Date.now() - 1000).toISOString(),
    },
  });

  const originalFetch = globalThis.fetch;
  const postedMessages = [];

  globalThis.fetch = async (url, options) => {
    if (url.includes("/channels/") && url.includes("/messages")) {
      const payload = JSON.parse(options.body);
      postedMessages.push({ url, payload });
      return new Response(JSON.stringify({ id: "generic_msg_1", ...payload }), {
        status: 200,
      });
    }
    return originalFetch(url, options);
  };

  try {
    // Deliver reminder
    const count = await processDueTicketReminders(env, {});
    assert.equal(count, 1);
    assert.equal(postedMessages.length, 1);

    const post = postedMessages[0];

    // 19. Generic reminder pings Support Staff and Moderator roles
    assert.ok(
      post.payload.content.includes(
        `<@&${DEFAULT_SUPPORT_ROLE_ID}> <@&${DEFAULT_MODERATOR_ROLE_ID}>`
      )
    );

    // 20. Correct generic message used
    assert.ok(post.payload.content.includes("This ticket needs to be checked."));
    assert.ok(
      post.payload.content.includes(
        "Please check on this ticket and close it if no further action is needed."
      )
    );

    // 22. Verify role pings actually notify the intended roles via allowed_mentions
    assert.deepEqual(post.payload.allowed_mentions.roles, [
      DEFAULT_SUPPORT_ROLE_ID,
      DEFAULT_MODERATOR_ROLE_ID,
    ]);

    // 21. Never sends twice
    const count2 = await processDueTicketReminders(env, {});
    assert.equal(count2, 0);
    assert.equal(postedMessages.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("23 & 24. Integration via worker.scheduled() and Command Router", async () => {
  const env = createTestEnv();

  // Test registry has remind command
  assert.equal(typeof COMMAND_HANDLERS.remind, "function");

  // Test registry component handler has remind_ prefix
  const remindComponent = COMPONENT_HANDLERS.find((c) => c.matches("remind_cancel:123"));
  assert.ok(remindComponent);
  assert.equal(typeof remindComponent.handler, "function");

  // Call worker.scheduled() directly to verify graceful execution
  await assert.doesNotReject(async () => {
    await worker.scheduled({}, env, {});
  });
});

test("FEATURE FLAG DISABLED: when reminders are disabled, /remind command responds with disabled message", async () => {
  const envDisabled = createTestEnv({ REMINDERS_ENABLED: "false" });
  const interaction = createMockInteraction({
    subcommand: "create",
    options: [{ name: "time", value: "1h" }],
  });

  const res = await handleRemindCommand(interaction, envDisabled);
  const data = await res.json();
  assert.equal(data.type, 4);
  assert.equal(data.data.flags, 64); // Ephemeral
  assert.equal(data.data.content, "Ticket reminders are currently disabled.");
});

test("FEATURE FLAG DISABLED: when reminders are disabled, cancel button responds with disabled message", async () => {
  const envDisabled = createTestEnv({ REMINDERS_ENABLED: "false" });
  const btnInteraction = {
    type: 3,
    guild_id: "730015674348601384",
    data: { custom_id: "remind_cancel:rem_123" },
    member: { user: { id: "123" }, roles: [] },
  };

  const res = await handleRemindComponent(btnInteraction, envDisabled);
  const data = await res.json();
  assert.equal(data.type, 4);
  assert.equal(data.data.flags, 64);
  assert.equal(data.data.content, "Ticket reminders are currently disabled.");
});

test("FEATURE FLAG DISABLED: when reminders are disabled, cron processor exits immediately without touching D1 or Discord", async () => {
  const envDisabled = createTestEnv({ REMINDERS_ENABLED: "false" });

  // Insert a reminder that would otherwise be due
  await createReminder({
    env: envDisabled,
    reminder: {
      guild_id: "730015674348601384",
      thread_id: "111222333444555666",
      thread_name: "ticket-due",
      parent_channel_id: "1220039518279827528",
      created_by_user_id: "123456789012345678",
      reminder_type: ReminderType.PERSONAL,
      reminder_message: "Should not be processed while disabled.",
      created_at: new Date(Date.now() - 3600000).toISOString(),
      remind_at: new Date(Date.now() - 1000).toISOString(),
    },
  });

  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    fetchCalled = true;
    return originalFetch(url, options);
  };

  try {
    const processed = await processDueTicketReminders(envDisabled, {});
    assert.equal(processed, 0);
    assert.equal(fetchCalled, false);

    // Verify D1 records remain untouched and pending
    const rows = await getPendingRemindersByUser({
      env: envDisabled,
      userId: "123456789012345678",
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, ReminderStatus.PENDING);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

