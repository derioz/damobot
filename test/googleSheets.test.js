import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  submitReferralToSheet,
  clearTokenCache,
  formatJoinDate,
  formatJoinDateNote,
} from "../src/googleSheets.js";

async function getTestRsaPem() {
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
  return `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----`;
}

test("formatJoinDate correctly formats ISO timestamps to MM/DD/YYYY and handles fallbacks", () => {
  assert.equal(formatJoinDate("2026-08-24T18:23:45.000000+00:00"), "08/24/2026");
  assert.equal(formatJoinDate("2025-01-05T00:00:00Z"), "01/05/2025");
  assert.equal(formatJoinDate("2026-12-31T23:59:59Z"), "12/31/2026");
  assert.equal(formatJoinDate(null), "Unknown");
  assert.equal(formatJoinDate(undefined), "Unknown");
  assert.equal(formatJoinDate(""), "Unknown");
  assert.equal(formatJoinDate("invalid-date-string"), "Unknown");
});

test("formatJoinDateNote formats cell note correctly", () => {
  assert.equal(
    formatJoinDateNote("2026-08-24T18:23:45.000000+00:00"),
    "Joined Vital RP Discord: 08/24/2026"
  );
  assert.equal(
    formatJoinDateNote(null),
    "Joined Vital RP Discord: Unknown"
  );
});

test("submitReferralToSheet fills first blank row, writes display name to B, and sets cell note", async () => {
  clearTokenCache();
  const pem = await getTestRsaPem();

  let targetPutRange = null;
  let targetPutValues = null;
  let targetBatchUpdate = null;

  const mockFetch = async (url, options = {}) => {
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
            ["2026-08-01", "User1", "1001", "Ref1", "2001"],
            [], // Row 3 is empty
            ["2026-08-03", "User3", "1003", "Ref3", "2003"],
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
                sheetId: 999,
                title: "Referral Tracker",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (options.method === "PUT") {
      targetPutRange = decodeURIComponent(urlStr);
      targetPutValues = JSON.parse(options.body).values;
      return new Response(JSON.stringify({ updatedRows: 1 }), { status: 200 });
    }
    if (urlStr.includes(":batchUpdate") && options.method === "POST") {
      targetBatchUpdate = JSON.parse(options.body);
      return new Response(JSON.stringify({ replies: [{}] }), { status: 200 });
    }
    return fetch(url, options);
  };

  const result = await submitReferralToSheet({
    env: {
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "test@example.iam.gserviceaccount.com",
      GOOGLE_PRIVATE_KEY: pem,
      GOOGLE_SHEET_ID: "1pMPhLNXdLGSPCVvy_ZKZyU6OkTWP6wZBC-s_f310_xM",
      GOOGLE_SHEET_TAB: "Referral Tracker",
    },
    referredPlayerName: "ReferredUser",
    referredPlayerId: "9999",
    referredByName: "ReferrerUser",
    referredById: "8888",
    joinedAt: "2026-08-24T18:23:45.000000+00:00",
    customFetch: mockFetch,
  });

  assert.equal(result.status, "SUCCESS");
  assert.equal(result.row, 3, "Should select row 3 as the first empty row");
  assert.ok(targetPutRange.includes("Referral Tracker!A3:E3"));
  assert.equal(targetPutValues[0].length, 5, "Must write only 5 columns (A-E)");
  assert.equal(targetPutValues[0][1], "ReferredUser", "Column B must only be display name");
  assert.equal(targetPutValues[0][2], "9999");
  assert.equal(targetPutValues[0][3], "ReferrerUser");
  assert.equal(targetPutValues[0][4], "8888");

  // Verify cell note
  assert.ok(targetBatchUpdate != null);
  const noteReq = targetBatchUpdate.requests[0].updateCells;
  assert.equal(noteReq.fields, "note");
  assert.equal(noteReq.range.sheetId, 999);
  assert.equal(noteReq.range.startRowIndex, 2); // row 3 0-indexed
  assert.equal(noteReq.range.startColumnIndex, 1); // Column B
  assert.equal(noteReq.rows[0].values[0].note, "Joined Vital RP Discord: 08/24/2026");
});
