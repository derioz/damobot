import test from "node:test";
import assert from "node:assert/strict";
import {
  refundConfig,
  loaConfig,
  referralConfig,
  getRefundCategoryConfig,
  getActiveRefundCategoryOptions,
  hasAnyRole,
  canManageRefunds,
  canManageLOAs,
  canManageReferrals,
  isRefundCenterChannel,
  isLOACenterChannel,
  isReferralChannel,
  isSuperadmin,
  validateBotConfig,
  REFUND_CATEGORY_OPTIONS,
} from "../src/config.js";
import { formatRefundLog } from "../src/refund/formatter.js";
import { buildRefundSearchResultsContainer } from "../src/refund/components.js";
import { executeLoaStart, executeLoaEdit } from "../src/loa/loaHandler.js";
import { handleReferralCommand } from "../src/features/referral/command.js";

test("CONFIG: refundConfig, loaConfig, and referralConfig have required properties", () => {
  // Refund Config
  assert.equal(refundConfig.enabled, true);
  assert.ok(refundConfig.channels?.center);
  assert.ok(refundConfig.channels?.logs);
  assert.ok(Array.isArray(refundConfig.roles?.allowed));
  assert.ok(Array.isArray(refundConfig.roles?.managers));
  assert.ok(Array.isArray(refundConfig.users?.superadmins));
  assert.ok(refundConfig.users.superadmins.includes("150580708144840704")); // Damon
  assert.ok(Array.isArray(refundConfig.categories));
  assert.ok(refundConfig.categories.length >= 4);

  // LOA Config
  assert.equal(loaConfig.enabled, true);
  assert.equal(loaConfig.channels.center, "1546281163247722516");
  assert.ok(Array.isArray(loaConfig.roles.allowed));
  assert.ok(Array.isArray(loaConfig.roles.managers));
  assert.ok(loaConfig.users.superadmins.includes("150580708144840704"));
  assert.equal(loaConfig.settings.minimumDays, 1);
  assert.equal(loaConfig.settings.maximumDays, 30);
  assert.equal(loaConfig.settings.allowEarlyEnd, true);
  assert.equal(loaConfig.settings.allowEdit, true);

  // Referral Config
  assert.equal(referralConfig.enabled, true);
  assert.ok(Array.isArray(referralConfig.roles.allowed));
  assert.ok(Array.isArray(referralConfig.roles.managers));
  assert.ok(referralConfig.users.superadmins.includes("150580708144840704"));
  assert.equal(referralConfig.requirements.accountAgeDays, 30);
  assert.equal(referralConfig.requirements.minimumPlaytimeHours, 10);
  assert.equal(referralConfig.settings.preventDuplicateReferrals, true);
  assert.equal(referralConfig.settings.sheetTab, "Referral Tracker");
});

test("CONFIG: default configuration passes validation with zero warnings", () => {
  const result = validateBotConfig({ silent: true });
  assert.equal(result.valid, true);
  assert.equal(result.warnings.length, 0);
});

test("CONFIG VALIDATOR: detects duplicate category IDs, missing labels, and invalid limits", () => {
  const badRefund = {
    ...refundConfig,
    categories: [
      { id: "vehicle", label: "Vehicle", enabled: true },
      { id: "vehicle", label: "Vehicle Duplicate", enabled: true },
      { id: "nolabel", label: "", enabled: true },
    ],
    settings: { maxOpenRequestsPerUser: 0 },
  };

  const badLoa = {
    ...loaConfig,
    roles: { allowed: [] },
    settings: { minimumDays: 10, maximumDays: 5 },
  };

  const badReferral = {
    ...referralConfig,
    requirements: { accountAgeDays: -5 },
  };

  const result = validateBotConfig({
    refund: badRefund,
    loa: badLoa,
    referral: badReferral,
    silent: true,
  });

  assert.equal(result.valid, false);
  assert.ok(result.warnings.some((w) => w.includes("Duplicate refund category ID: vehicle")));
  assert.ok(result.warnings.some((w) => w.includes("is missing a 'label'")));
  assert.ok(result.warnings.some((w) => w.includes("maxOpenRequestsPerUser must be greater than 0")));
  assert.ok(result.warnings.some((w) => w.includes("LOA allowed roles array is empty")));
  assert.ok(result.warnings.some((w) => w.includes("cannot be greater than maximumDays")));
  assert.ok(result.warnings.some((w) => w.includes("accountAgeDays cannot be negative")));
});

test("PERMISSIONS & HELPERS: superadmin and role checks work across target types", () => {
  // Damon superadmin checks
  assert.equal(isSuperadmin("150580708144840704"), true);
  assert.equal(isSuperadmin({ user: { id: "150580708144840704" } }), true);
  assert.equal(isSuperadmin({ member: { user: { id: "150580708144840704" } } }), true);
  assert.equal(isSuperadmin("999999999999999999"), false);

  // canManageRefunds
  assert.equal(canManageRefunds("150580708144840704"), true);
  assert.equal(canManageRefunds({ member: { roles: ["743422836223246366"] } }), true);
  assert.equal(canManageRefunds({ member: { roles: ["743423786275307542"] } }), true);
  assert.equal(canManageRefunds({ member: { roles: ["random_role_123"] } }), false);

  // canManageLOAs
  assert.equal(canManageLOAs("150580708144840704"), true);
  assert.equal(canManageLOAs({ member: { roles: ["743422836223246366"] } }), true);
  assert.equal(canManageLOAs({ member: { roles: ["random_role_123"] } }), false);

  // canManageReferrals
  assert.equal(canManageReferrals("150580708144840704"), true);
  assert.equal(canManageReferrals({ member: { roles: ["743422836223246366"] } }), true);
  assert.equal(canManageReferrals({ member: { roles: ["random_role_123"] } }), false);

  // hasAnyRole
  assert.equal(hasAnyRole({ roles: ["A", "B"] }, ["B", "C"]), true);
  assert.equal(hasAnyRole({ roles: ["X"] }, ["Y", "Z"]), false);
});

test("CHANNELS HELPERS: channel comparisons reference configuration", () => {
  assert.equal(isLOACenterChannel("1546281163247722516"), true);
  assert.equal(isLOACenterChannel("743517373985718274"), false);

  assert.equal(isRefundCenterChannel("1289638609535766631"), true);
  assert.equal(isRefundCenterChannel("other_channel", { REFUND_CENTER_CHANNEL_ID: "special_chan" }), false);
  assert.equal(isRefundCenterChannel("special_chan", { REFUND_CENTER_CHANNEL_ID: "special_chan" }), true);

  // Referral channel is open by default ("")
  assert.equal(isReferralChannel("any_channel"), true);
  assert.equal(isReferralChannel("wrong_chan", { REFERRAL_CHANNEL_ID: "right_chan" }), false);
  assert.equal(isReferralChannel("right_chan", { REFERRAL_CHANNEL_ID: "right_chan" }), true);
});

test("DYNAMIC REFUND CATEGORIES: category lookup, fallback, and live propagation", () => {
  // 1. Existing category lookup
  const vitcoin = getRefundCategoryConfig("Vitcoin");
  assert.equal(vitcoin.id, "Vitcoin");
  assert.equal(vitcoin.emoji, "🪙");
  assert.equal(vitcoin.logLabel, "Vitcoin");

  // 2. Safe fallback for unknown/old category IDs
  const unknown = getRefundCategoryConfig("old_business_item");
  assert.equal(unknown.id, "old_business_item");
  assert.equal(unknown.label, "Unknown Category (old_business_item)");
  assert.equal(unknown.enabled, false);

  // 3. Adding a new category propagates immediately to options, menu, log format, and filter buttons
  const newCat = {
    id: "business",
    label: "Business",
    emoji: "🏢",
    logLabel: "Business Refund",
    description: "Company and enterprise refunds",
    enabled: true,
  };

  refundConfig.categories.push(newCat);

  try {
    // Check lookup
    const resolved = getRefundCategoryConfig("business");
    assert.equal(resolved.label, "Business");
    assert.equal(resolved.emoji, "🏢");
    assert.equal(resolved.logLabel, "Business Refund");

    // Check getActiveRefundCategoryOptions
    const opts = getActiveRefundCategoryOptions();
    const foundOpt = opts.find((o) => o.value === "business");
    assert.ok(foundOpt, "New category must appear in active select options");
    assert.equal(foundOpt.label, "Business");
    assert.equal(foundOpt.emoji.name, "🏢");

    // Check REFUND_CATEGORY_OPTIONS dynamic proxy
    const proxyFound = REFUND_CATEGORY_OPTIONS.find((o) => o.value === "business");
    assert.ok(proxyFound, "New category must appear in REFUND_CATEGORY_OPTIONS proxy");

    // Check log formatting with new category
    const logOutput = formatRefundLog({
      refundId: "VRP-R-999999",
      playerName: "Jane Doe",
      refundCategory: "business",
      refundDetails: "1x Warehouse deed",
      reason: "Script bug swallowed warehouse deed",
      staffName: "StaffMember",
    });
    assert.match(logOutput, /\*\*Category:\*\* Business Refund/);

    // Check search results container produces filter button for the new category
    const searchContainer = buildRefundSearchResultsContainer({
      records: [],
      categoryFilter: "All",
    });
    // Find button with label "Business"
    const allButtons = searchContainer.components
      .filter((c) => c.type === 1) // ACTION_ROW
      .flatMap((r) => r.components || [])
      .filter((comp) => comp.type === 2); // BUTTON

    const bizBtn = allButtons.find((b) => b.label === "Business");
    assert.ok(bizBtn, "Search results must contain a filter button for new category");
    assert.equal(bizBtn.emoji.name, "🏢");
    assert.ok(bizBtn.custom_id.startsWith("refund_filter:business:"));
  } finally {
    // Clean up test category
    const idx = refundConfig.categories.findIndex((c) => c.id === "business");
    if (idx !== -1) {
      refundConfig.categories.splice(idx, 1);
    }
  }
});

test("LOA SETTINGS: duration bounds (minimumDays, maximumDays) enforce correctly", async () => {
  // Test starting LOA exceeding maximumDays (e.g. 35 days)
  const resOver = await executeLoaStart({
    env: {},
    guildId: "123",
    userId: "456",
    displayName: "TestUser",
    startDateVal: "09/01/2026",
    endDateVal: "10/15/2026", // 45 days
    reasonVal: "Vacation",
    todayIso: "2026-09-01",
    stub: {},
  });

  const jsonOver = await resOver.json();
  assert.match(jsonOver.data.content, /LOA duration cannot exceed 30 days/);

  // Test allowEdit disabled toggle
  const origAllowEdit = loaConfig.settings.allowEdit;
  loaConfig.settings.allowEdit = false;
  try {
    const editRes = await executeLoaEdit({
      env: {},
      guildId: "123",
      userId: "456",
      displayName: "TestUser",
      startDateVal: "09/05/2026",
      endDateVal: "09/10/2026",
      reasonVal: "Edit test",
      todayIso: "2026-09-01",
      stub: {},
    });
    const editJson = await editRes.json();
    assert.match(editJson.data.content, /Editing existing LOAs is currently disabled/);
  } finally {
    loaConfig.settings.allowEdit = origAllowEdit;
  }
});

test("REFERRAL CONFIG: enabled toggle and channel gating work", async () => {
  // 1. Feature disabled toggle
  const origEnabled = referralConfig.enabled;
  referralConfig.enabled = false;
  try {
    const res = await handleReferralCommand(
      {
        data: { options: [{ name: "referrer", value: "789" }] },
        member: { user: { id: "123" } },
      },
      {},
      {}
    );
    const json = await res.json();
    assert.match(json.data.content, /Referral system is currently disabled/);
  } finally {
    referralConfig.enabled = origEnabled;
  }

  // 2. Channel restriction
  const origChan = referralConfig.channels.referrals;
  referralConfig.channels.referrals = "only_allowed_chan_999";
  try {
    const res = await handleReferralCommand(
      {
        channel_id: "different_chan_111",
        data: { options: [{ name: "referrer", value: "789" }] },
        member: { user: { id: "123" } },
      },
      {},
      {}
    );
    const json = await res.json();
    assert.match(json.data.content, /referral command cannot be used in this channel/);
  } finally {
    referralConfig.channels.referrals = origChan;
  }
});
