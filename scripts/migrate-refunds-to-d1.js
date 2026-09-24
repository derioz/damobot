import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { getGoogleAccessToken } from "../src/shared/googleSheets.js";
import { fetchAllRefunds } from "../src/refund/sheets.js";

// Load environment variables from .dev.vars or .env
function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  if (typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(filePath);
      return;
    } catch {}
  }
  try {
    const content = readFileSync(filePath, "utf-8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  } catch {}
}

loadEnvFile(".dev.vars");
loadEnvFile(".env");

function escapeSql(val) {
  if (val === null || val === undefined) return "''";
  return `'${String(val).replace(/'/g, "''")}'`;
}

async function fetchAllRefundAudits(env) {
  const serviceAccountEmail = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId = env.REFUND_SHEET_ID || env.PUNISHMENT_SHEET_ID;
  const auditTab = env.REFUND_AUDIT_TAB || "Refund Audits";

  const accessToken = await getGoogleAccessToken(serviceAccountEmail, privateKey, fetch);
  const readRange = `${auditTab}!A2:G`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
    readRange
  )}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to read refund audits (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const rawRows = data.values || [];

  const audits = [];
  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0 || !row[0]) continue;
    audits.push({
      auditId: String(row[0]).trim(),
      refundId: row[1] ? String(row[1]).trim() : "",
      action: row[2] ? String(row[2]).trim() : "CREATED",
      changedAt: row[3] ? String(row[3]).trim() : new Date().toISOString(),
      changedByName: row[4] ? String(row[4]).trim() : "Staff",
      changedByDiscordId: row[5] ? String(row[5]).trim() : "",
      details: row[6] ? String(row[6]).trim() : "",
    });
  }

  return audits;
}

async function main() {
  const args = process.argv.slice(2);
  const isLocal = args.includes("--local");
  const targetFlag = isLocal ? "--local" : "--remote";

  console.log("==================================================================");
  console.log(`   Damo Bot • Google Sheets -> Cloudflare D1 Refund Migration`);
  console.log(`   Target Environment: ${isLocal ? "LOCAL (--local)" : "REMOTE PRODUCTION (--remote)"}`);
  console.log("==================================================================\n");

  const env = {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY,
    REFUND_SHEET_ID: process.env.REFUND_SHEET_ID || process.env.PUNISHMENT_SHEET_ID,
    REFUND_SHEET_TAB: process.env.REFUND_SHEET_TAB || "Refund Log",
    REFUND_AUDIT_TAB: process.env.REFUND_AUDIT_TAB || "Refund Audits",
  };

  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY || !env.REFUND_SHEET_ID) {
    console.error("❌ Error: Missing Google Service Account credentials or REFUND_SHEET_ID in .dev.vars.");
    process.exit(1);
  }

  console.log(`Reading Google Spreadsheet: ${env.REFUND_SHEET_ID}`);
  console.log(`Fetching records from tab: '${env.REFUND_SHEET_TAB}'...`);

  let refunds = [];
  try {
    refunds = await fetchAllRefunds({ env });
    console.log(`✅ Found ${refunds.length} refund records in Google Sheets.`);
  } catch (err) {
    console.error(`❌ Failed to fetch refund records: ${err.message}`);
    process.exit(1);
  }

  console.log(`Fetching audits from tab: '${env.REFUND_AUDIT_TAB}'...`);
  let audits = [];
  try {
    audits = await fetchAllRefundAudits(env);
    console.log(`✅ Found ${audits.length} audit records in Google Sheets.\n`);
  } catch (err) {
    console.warn(`⚠️ Could not fetch refund audit records (${err.message}). Continuing with refunds.`);
  }

  // Generate SQL batch statements
  const sqlStatements = [
    "-- One-Time Historical Data Migration from Google Sheets to Cloudflare D1 (Refunds)",
  ];

  let validRefunds = 0;
  let skippedRefunds = 0;

  for (const r of refunds) {
    if (!r.refundId || !r.playerName) {
      console.warn(`⚠️ Skipping invalid refund record: ID="${r.refundId}", Player="${r.playerName}"`);
      skippedRefunds++;
      continue;
    }

    const normName = (r.playerName || "").toLowerCase().trim();

    sqlStatements.push(
      `INSERT OR IGNORE INTO refunds (` +
        `refund_id, created_at, player_name, player_discord_id, refund_category, ` +
        `refund_details, reason, ticket_url, staff_name, staff_discord_id, guild_id, ` +
        `log_channel_id, log_message_id, discord_jump_url, sync_status, normalized_player_name` +
      `) VALUES (` +
        `${escapeSql(r.refundId)}, ` +
        `${escapeSql(r.createdAt || new Date().toISOString())}, ` +
        `${escapeSql(r.playerName)}, ` +
        `${escapeSql(r.playerDiscordId || "N/A")}, ` +
        `${escapeSql(r.refundCategory || "Other")}, ` +
        `${escapeSql(r.refundDetails || "")}, ` +
        `${escapeSql(r.reason || "")}, ` +
        `${escapeSql(r.ticketUrl || "")}, ` +
        `${escapeSql(r.staffName || "Staff")}, ` +
        `${escapeSql(r.staffDiscordId || "0")}, ` +
        `${escapeSql(r.guildId || "")}, ` +
        `${escapeSql(r.logChannelId || "")}, ` +
        `${escapeSql(r.logMessageId || "")}, ` +
        `${escapeSql(r.discordJumpUrl || "")}, ` +
        `${escapeSql(r.syncStatus || "Pending")}, ` +
        `${escapeSql(normName)}` +
      `);`
    );
    validRefunds++;
  }

  let validAudits = 0;
  for (const a of audits) {
    if (!a.auditId || !a.refundId) continue;

    sqlStatements.push(
      `INSERT OR IGNORE INTO refund_audits (` +
        `audit_id, refund_id, action, changed_at, changed_by_name, changed_by_discord_id, details` +
      `) VALUES (` +
        `${escapeSql(a.auditId)}, ` +
        `${escapeSql(a.refundId)}, ` +
        `${escapeSql(a.action || "CREATED")}, ` +
        `${escapeSql(a.changedAt || new Date().toISOString())}, ` +
        `${escapeSql(a.changedByName || "Staff")}, ` +
        `${escapeSql(a.changedByDiscordId || "0")}, ` +
        `${escapeSql(a.details || "")}` +
      `);`
    );
    validAudits++;
  }

  console.log(`Prepared SQL Statements:`);
  console.log(`- Refunds to insert: ${validRefunds} (Skipped: ${skippedRefunds})`);
  console.log(`- Audits to insert:  ${validAudits}`);

  const tempSqlPath = ".wrangler_temp_refund_migration.sql";
  writeFileSync(tempSqlPath, sqlStatements.join("\n"), "utf-8");

  console.log(`\nExecuting batch import into D1 (damo-bot-refunds ${targetFlag})...`);

  try {
    const cmd = `npx wrangler d1 execute damo-bot-refunds ${targetFlag} --file=${tempSqlPath}`;
    const output = execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
    console.log(output);

    // Verify row counts in D1
    const verifyCmd = `npx wrangler d1 execute damo-bot-refunds ${targetFlag} --command="SELECT count(*) as count FROM refunds; SELECT count(*) as count FROM refund_audits;"`;
    const verifyOutput = execSync(verifyCmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
    console.log("\n📊 Verification in D1 Database:");
    console.log(verifyOutput);

    console.log("==================================================================");
    console.log("✅ REFUND MIGRATION COMPLETED SUCCESSFULLY!");
    console.log(`- Imported Refunds: ${validRefunds}`);
    console.log(`- Imported Audits:  ${validAudits}`);
    console.log("- Duplicate Protection: INSERT OR IGNORE ensured no duplicates.");
    console.log("- Source Protection:    Google Sheet was NOT modified.");
    console.log("==================================================================");
  } catch (execErr) {
    console.error(`❌ Migration execution failed: ${execErr.message}`);
    if (execErr.stdout) console.error(execErr.stdout);
    if (execErr.stderr) console.error(execErr.stderr);
    process.exit(1);
  } finally {
    try {
      unlinkSync(tempSqlPath);
    } catch {}
  }
}

main().catch((err) => {
  console.error("Unhandled error in refund migration script:", err);
  process.exit(1);
});
