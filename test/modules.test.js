import { test } from "node:test";
import assert from "node:assert/strict";
import {
  registry,
  defineModule,
  getAllModules,
  getAllCommands,
  getModule,
  findCommandHandler,
  findComponentHandler,
  findModalHandler,
} from "../src/core/module-registry/index.js";
import {
  createDamoEmbed,
  createSuccessEmbed,
  createErrorEmbed,
  createWarningEmbed,
  EmbedColor,
} from "../src/shared/embeds/index.js";
import {
  createPrimaryButton,
  createSecondaryButton,
  createSuccessButton,
  createDangerButton,
  createLinkButton,
  createPaginationRow,
} from "../src/shared/components/buttons.js";
import {
  formatLogDate,
  isValidUrl,
  normalizeUrl,
  formatPlayerLine,
  formatBlockquote,
} from "../src/shared/logging/utilities.js";
import {
  tokenizeSearchQuery,
  matchesSearchTokens,
  isDiscordIdQuery,
} from "../src/shared/logging/search.js";
import {
  calculatePagination,
  paginateArray,
} from "../src/shared/logging/pagination.js";
import { generateAuditId } from "../src/shared/logging/repository.js";
import { dispatchInteraction } from "../src/core/router/dispatch.js";
import { VITAL_ORANGE, VITAL_RP_LOGO_URL } from "../src/config/brand.js";

test("MODULE REGISTRY: All 9 core modules are registered with valid metadata", () => {
  const modules = getAllModules();
  assert.equal(modules.length, 9, "Expected 9 registered core modules");

  const expectedModuleIds = [
    "overview",
    "loa",
    "punishments",
    "refunds",
    "suggestions",
    "referrals",
    "reminders",
    "stickies",
    "admin-chat",
  ];

  for (const id of expectedModuleIds) {
    const mod = getModule(id);
    assert.ok(mod, `Module '${id}' should be registered`);
    assert.equal(typeof mod.name, "string", `Module '${id}' must have a name`);
    assert.ok(mod.name.length > 0);
    assert.equal(
      typeof mod.staffOnly,
      "boolean",
      `Module '${id}' must explicitly declare staffOnly as a boolean`
    );
  }
});

test("MODULE REGISTRY: staffOnly status is explicitly and accurately defined", () => {
  const staffModules = ["loa", "punishments", "refunds", "reminders", "stickies", "admin-chat"];
  const publicModules = ["overview", "suggestions", "referrals"];

  for (const id of staffModules) {
    const mod = getModule(id);
    assert.strictEqual(
      mod.staffOnly,
      true,
      `Module '${id}' must be staffOnly: true`
    );
  }

  for (const id of publicModules) {
    const mod = getModule(id);
    assert.strictEqual(
      mod.staffOnly,
      false,
      `Module '${id}' must be staffOnly: false`
    );
  }
});

test("MODULE DEFINITION: defineModule enforces strict validation", () => {
  // Missing ID
  assert.throws(
    () => defineModule({ name: "Test", staffOnly: true }),
    /must have a non-empty string 'id'/
  );

  // Missing Name
  assert.throws(
    () => defineModule({ id: "test", staffOnly: true }),
    /must have a non-empty string 'name'/
  );

  // Missing staffOnly
  assert.throws(
    () => defineModule({ id: "test", name: "Test" }),
    /MUST explicitly define 'staffOnly: true' or 'staffOnly: false'/
  );

  // Non-boolean staffOnly
  assert.throws(
    () => defineModule({ id: "test", name: "Test", staffOnly: "yes" }),
    /MUST explicitly define 'staffOnly: true' or 'staffOnly: false'/
  );

  // Valid module definition
  const valid = defineModule({
    id: "ooc-jail-logs",
    name: "OOC Jail Logs",
    description: "Tracks OOC jail punishments",
    staffOnly: true,
  });

  assert.equal(valid.id, "ooc-jail-logs");
  assert.equal(valid.staffOnly, true);
  assert.ok(Object.isFrozen(valid), "Defined module must be frozen");
});

test("COMMAND AGGREGATION: getAllCommands collects commands across all modules", () => {
  const commands = getAllCommands({ REMINDERS_ENABLED: "true" });
  assert.ok(Array.isArray(commands));
  assert.ok(commands.length >= 10);

  const commandNames = commands.map((c) => c.name);
  assert.ok(commandNames.includes("ping"));
  assert.ok(commandNames.includes("referral"));
  assert.ok(commandNames.includes("sticky"));
  assert.ok(commandNames.includes("loa"));
  assert.ok(commandNames.includes("loainfo"));
  assert.ok(commandNames.includes("logpunishment"));
  assert.ok(commandNames.includes("refund"));
  assert.ok(commandNames.includes("suggestions"));
  assert.ok(commandNames.includes("damobot"));
  assert.ok(commandNames.includes("remind"));
  assert.ok(commandNames.includes("Punishment History"));
});

test("SHARED EMBEDS: builds standard, success, error, and warning embeds", () => {
  // Standard embed
  const standard = createDamoEmbed({
    title: "Test Embed",
    description: "Description text",
    fields: [{ name: "Field 1", value: "Value 1" }],
  });
  assert.equal(standard.title, "Test Embed");
  assert.equal(standard.description, "Description text");
  assert.equal(standard.color, VITAL_ORANGE);
  assert.ok(standard.footer.text.includes("Vital RP"));
  assert.equal(standard.footer.icon_url, VITAL_RP_LOGO_URL);

  // Success embed
  const success = createSuccessEmbed({
    title: "Completed",
    description: "All good",
  });
  assert.equal(success.title, "✅ Completed");
  assert.equal(success.color, EmbedColor.SUCCESS);

  // Error embed
  const error = createErrorEmbed({
    title: "Failed",
    description: "Something went wrong",
  });
  assert.equal(error.title, "❌ Failed");
  assert.equal(error.color, EmbedColor.ERROR);

  // Warning embed
  const warning = createWarningEmbed({
    title: "Caution",
    description: "Check carefully",
  });
  assert.equal(warning.title, "⚠️ Caution");
  assert.equal(warning.color, EmbedColor.WARNING);
});

test("SHARED BUTTONS: creates buttons with correct Discord styles", () => {
  const primary = createPrimaryButton({ customId: "p_btn", label: "Primary" });
  assert.equal(primary.type, 2);
  assert.equal(primary.style, 1);
  assert.equal(primary.custom_id, "p_btn");

  const secondary = createSecondaryButton({ customId: "s_btn", label: "Secondary" });
  assert.equal(secondary.style, 2);

  const success = createSuccessButton({ customId: "ok_btn", label: "Save" });
  assert.equal(success.style, 3);

  const danger = createDangerButton({ customId: "d_btn", label: "Danger" });
  assert.equal(danger.style, 4);

  const link = createLinkButton({ url: "https://example.com", label: "Link" });
  assert.equal(link.style, 5);
  assert.equal(link.url, "https://example.com");

  // Pagination row
  const paginationRow = createPaginationRow({
    customIdPrefix: "test_page:",
    currentPage: 2,
    totalPages: 5,
    queryKey: "john",
  });
  assert.equal(paginationRow.type, 1);
  assert.equal(paginationRow.components.length, 2);
  assert.equal(paginationRow.components[0].disabled, false); // Prev
  assert.equal(paginationRow.components[1].disabled, false); // Next
});

test("SHARED LOGGING: utilities, search, and pagination helpers", () => {
  // Date formatting
  const formattedDate = formatLogDate("2026-09-04T16:52:00Z");
  assert.ok(formattedDate.includes("2026"));

  // URL normalization
  assert.equal(normalizeUrl("example.com/path"), "https://example.com/path");
  assert.equal(normalizeUrl("https://example.com"), "https://example.com");
  assert.equal(isValidUrl("https://vitalrp.com"), true);
  assert.equal(isValidUrl("not-a-url"), false);

  // Player line formatting
  const playerLine = formatPlayerLine("John Doe", "150580708144840704");
  assert.equal(playerLine, "**John Doe** • `150580708144840704`");

  const playerLineNoId = formatPlayerLine("Jane Doe", "N/A");
  assert.equal(playerLineNoId, "**Jane Doe**");

  // Blockquote formatting
  const quote = formatBlockquote("Line 1\nLine 2");
  assert.equal(quote, "> Line 1\n> Line 2");

  // Search tokenization
  const tokens = tokenizeSearchQuery("John  DOE   VDM ");
  assert.deepEqual(tokens, ["john", "doe", "vdm"]);
  assert.equal(isDiscordIdQuery("150580708144840704"), true);
  assert.equal(isDiscordIdQuery("not_an_id"), false);

  // Pagination
  const pag = calculatePagination({ totalItems: 23, currentPage: 2, pageSize: 5 });
  assert.equal(pag.totalPages, 5);
  assert.equal(pag.offset, 5);
  assert.equal(pag.limit, 5);
  assert.equal(pag.hasNext, true);
  assert.equal(pag.hasPrev, true);

  const items = [1, 2, 3, 4, 5, 6, 7];
  const { items: page1 } = paginateArray(items, 1, 3);
  assert.deepEqual(page1, [1, 2, 3]);

  // Audit ID
  const auditId = generateAuditId("PUN");
  assert.ok(auditId.startsWith("PUN-"));
});

test("ROUTER DISPATCH: handles ping and dispatches commands via registry", async () => {
  // PING (Type 1)
  const pingRes = await dispatchInteraction({ type: 1 }, {}, {});
  const pingBody = await pingRes.json();
  assert.equal(pingBody.type, 1);

  // /ping Slash Command (Type 2)
  const cmdRes = await dispatchInteraction(
    {
      type: 2,
      data: { name: "ping" },
    },
    {},
    {}
  );
  const cmdBody = await cmdRes.json();
  assert.equal(cmdBody.type, 4);
  assert.ok(cmdBody.data.content.includes("Pong"));
});
