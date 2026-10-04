import test from "node:test";
import assert from "node:assert/strict";
import { DamoBotCore } from "../src/core/bot.js";
import { refundConfig } from "../src/config/refund.config.js";

test("API ROUTER: GET /api/dashboard/status returns healthy status and module count", async () => {
  const req = new Request("https://worker.test/api/dashboard/status", { method: "GET" });
  const res = await DamoBotCore.handleFetch(req, {}, {});
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.equal(data.status, "online");
  assert.equal(data.botName, "DamoBot");
  assert.ok(data.totalModulesCount >= 9);
});

test("API ROUTER: GET /api/modules returns registered modules and refund categories", async () => {
  const req = new Request("https://worker.test/api/modules", { method: "GET" });
  const res = await DamoBotCore.handleFetch(req, {}, {});
  assert.equal(res.status, 200);

  const list = await res.json();
  const refunds = list.find((m) => m.id === "refunds");
  assert.ok(refunds);
  assert.ok(Array.isArray(refunds.settingsSchema[0].defaultValue));
});

test("API ROUTER: PUT /api/modules/refunds successfully adds a new refund category and updates bot config", async () => {
  const newCategories = [
    ...refundConfig.categories,
    {
      id: "Weapons",
      label: "Weapons",
      emoji: "🔫",
      description: "Custom firearm refund",
      enabled: true,
    },
  ];

  const req = new Request("https://worker.test/api/modules/refunds", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ categories: newCategories }),
  });

  const res = await DamoBotCore.handleFetch(req, {}, {});
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(refundConfig.categories.some((c) => c.id === "Weapons"));
});

test("API ROUTER: PUT /api/modules/refunds rejects adding more than 24 active categories (Discord Select Menu limit)", async () => {
  const excessiveCategories = [];
  for (let i = 0; i < 25; i++) {
    excessiveCategories.push({
      id: `Cat_${i}`,
      label: `Category ${i}`,
      emoji: "📦",
      description: "",
      enabled: true,
    });
  }

  const req = new Request("https://worker.test/api/modules/refunds", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ categories: excessiveCategories }),
  });

  const res = await DamoBotCore.handleFetch(req, {}, {});
  assert.equal(res.status, 400);

  const data = await res.json();
  assert.ok(data.error.includes("24 active categories"));
});

test("API ROUTER: PUT /api/modules/refunds rejects category with empty ID or exceeding 32 chars", async () => {
  const invalidCategories = [
    {
      id: "ThisIdIsWayTooLongAndExceedsThirtyTwoCharactersTotal",
      label: "Too Long",
      emoji: "📦",
      enabled: true,
    },
  ];

  const req = new Request("https://worker.test/api/modules/refunds", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ categories: invalidCategories }),
  });

  const res = await DamoBotCore.handleFetch(req, {}, {});
  assert.equal(res.status, 400);

  const data = await res.json();
  assert.ok(data.error.includes("exceeds 32 character limit"));
});

test("API ROUTER: GET /api/audit-log retrieves logged configuration modifications", async () => {
  const req = new Request("https://worker.test/api/audit-log", { method: "GET" });
  const res = await DamoBotCore.handleFetch(req, {}, {});
  assert.equal(res.status, 200);

  const logs = await res.json();
  assert.ok(Array.isArray(logs));
  assert.ok(logs.some((l) => l.moduleId === "refunds" && l.key === "categories"));
});
