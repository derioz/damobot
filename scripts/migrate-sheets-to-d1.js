import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { getGoogleAccessToken } from "../src/googleSheets.js";
import { fetchAllPunishments } from "../src/punishment/sheets.js";

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

async function fetchAllAudits(env) {
  const serviceAccountEmail = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId = env.PUNISHMENT_SHEET_ID;
  const auditTab = env.PUNISHMENT_AUDIT_TAB || "Punishment Audits";

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
    throw new Error(`Failed to read punishment audits (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const rawRows = data.values || [];

  const audits = [];
  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0 || !row[0]) continue;
    audits.push({
      auditId: String(row[0]).trim(),
      punishmentId: row[1] ? String(row[1]).trim() : "",
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
  const isRemote = args.includes("--remote") || !isLocal;
  const targetFlag = isLocal ? "--local" : "--remote";

  console.log("==================================================================");
  console.log(`   Damo Bot • Google Sheets -> Cloudflare D1 Punishment Migration`);
  console.log(`   Target Environment: ${isLocal ? "LOCAL (--local)" : "REMOTE PRODUCTION (--remote)"}`);
  console.log("==================================================================\n");

  const env = {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY,
    PUNISHMENT_SHEET_ID: process.env.PUNISHMENT_SHEET_ID,
    PUNISHMENT_SHEET_TAB: process.env.PUNISHMENT_SHEET_TAB || "Punishment Logs",
    PUNISHMENT_AUDIT_TAB: process.env.PUNISHMENT_AUDIT_TAB || "Punishment Audits",
  };

  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY || !env.PUNISHMENT_SHEET_ID) {
    console.error("❌ Error: Missing Google Service Account credentials or PUNISHMENT_SHEET_ID in .dev.vars.");
    process.exit(1);
  }

  console.log(`Reading Google Spreadsheet: ${env.PUNISHMENT_SHEET_ID}`);
  console.log(`Fetching records from tab: '${env.PUNISHMENT_SHEET_TAB}'...`);

  let punishments = [];
  try {
    punishments = await fetchAllPunishments({ env });
    console.log(`✅ Found ${punishments.length} punishment records in Google Sheets.`);
  } catch (err) {
    console.error(`❌ Failed to fetch punishment records: ${err.message}`);
    process.exit(1);
  }

  console.log(`Fetching audits from tab: '${env.PUNISHMENT_AUDIT_TAB}'...`);
  let audits = [];
  try {
    audits = await fetchAllAudits(env);
    console.log(`✅ Found ${audits.length} audit records in Google Sheets.\n`);
  } catch (err) {
    console.error(`❌ Failed to fetch audit records: ${err.message}`);
    process.exit(1);
  }

  // Generate SQL batch statements
  const sqlStatements = [
    "-- One-Time Historical Data Migration from Google Sheets to Cloudflare D1",
  ];

  let validPunishments = 0;
  let skippedPunishments = 0;

  for (const p of punishments) {
    if (!p.punishmentId || !p.playerName) {
      console.warn(`⚠️ Skipping invalid punishment record: ID="${p.punishmentId}", Player="${p.playerName}"`);
      skippedPunishments++;
      continue;
    }

    const normName = (p.playerName || "").toLowerCase().trim();

    sqlStatements.push(
      `INSERT OR IGNORE INTO punishments (` +
        `punishment_id, created_at, player_name, player_discord_id, punishment, ` +
        `punishment_length, reason, additional_info, report_url, response_url, ` +
        `evidence_image_url, staff_name, staff_discord_id, guild_id, log_channel_id, ` +
        `log_message_id, discord_jump_url, sync_status, normalized_player_name` +
      `) VALUES (` +
        `${escapeSql(p.punishmentId)}, ` +
        `${escapeSql(p.createdAt || new Date().toISOString())}, ` +
        `${escapeSql(p.playerName)}, ` +
        `${escapeSql(p.playerDiscordId || "N/A")}, ` +
        `${escapeSql(p.punishment || "Warning")}, ` +
        `${escapeSql(p.punishmentLength || "")}, ` +
        `${escapeSql(p.reason || "")}, ` +
        `${escapeSql(p.additionalInfo || "")}, ` +
        `${escapeSql(p.reportUrl || "")}, ` +
        `${escapeSql(p.responseUrl || "")}, ` +
        `${escapeSql(p.evidenceImageUrl || "")}, ` +
        `${escapeSql(p.staffName || "Staff")}, ` +
        `${escapeSql(p.staffDiscordId || "0")}, ` +
        `${escapeSql(p.guildId || "")}, ` +
        `${escapeSql(p.logChannelId || "")}, ` +
        `${escapeSql(p.logMessageId || "")}, ` +
        `${escapeSql(p.discordJumpUrl || "")}, ` +
        `${escapeSql(p.syncStatus || "Pending")}, ` +
        `${escapeSql(normName)}` +
      `);`
    );
    validPunishments++;
  }

  let validAudits = 0;
  let skippedAudits = 0;

  for (const a of audits) {
    if (!a.auditId || !a.punishmentId) {
      console.warn(`⚠️ Skipping invalid audit record: ID="${a.auditId}"`);
      skippedAudits++;
      continue;
    }

    sqlStatements.push(
      `INSERT OR IGNORE INTO punishment_audits (` +
        `audit_id, punishment_id, action, changed_at, changed_by_name, changed_by_discord_id, details` +
      `) VALUES (` +
        `${escapeSql(a.auditId)}, ` +
        `${escapeSql(a.punishmentId)}, ` +
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
  console.log(`- Punishments to insert: ${validPunishments} (Skipped: ${skippedPunishments})`);
  console.log(`- Audits to insert:      ${validAudits} (Skipped: ${skippedAudits})`);

  // Write temporary SQL file for wrangler execution
  const tempSqlPath = ".wrangler_temp_migration.sql";
  writeFileSync(tempSqlPath, sqlStatements.join("\n"), "utf-8");

  console.log(`\nExecuting batch import into D1 (damo-bot-punishments ${targetFlag})...`);

  try {
    const cmd = `npx wrangler d1 execute damo-bot-punishments ${targetFlag} --file=${tempSqlPath}`;
    const output = execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
    console.log(output);

    // Verify row counts in D1
    const verifyCmd = `npx wrangler d1 execute damo-bot-punishments ${targetFlag} --command="SELECT count(*) as count FROM punishments; SELECT count(*) as count FROM punishment_audits;"`;
    const verifyOutput = execSync(verifyCmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
    console.log("\n📊 Verification in D1 Database:");
    console.log(verifyOutput);

    console.log("==================================================================");
    console.log("✅ MIGRATION COMPLETED SUCCESSFULLY!");
    console.log(`- Imported Punishments: ${validPunishments}`);
    console.log(`- Imported Audits:      ${validAudits}`);
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
  console.error("Unhandled error in migration script:", err);
  process.exit(1);
});
