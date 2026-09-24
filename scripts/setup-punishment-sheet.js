import { existsSync, readFileSync } from "node:fs";
import { initPunishmentSheet, PUNISHMENT_LOG_HEADERS } from "../src/punishment/sheets.js";

// Load local environment variables from .dev.vars or .env
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

async function main() {
  console.log("==================================================");
  console.log("   Damo Bot • Punishment Sheet Setup & Verification");
  console.log("==================================================");

  const env = {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY,
    PUNISHMENT_SHEET_ID: process.env.PUNISHMENT_SHEET_ID,
    PUNISHMENT_SHEET_TAB: process.env.PUNISHMENT_SHEET_TAB || "Punishment Logs",
    PUNISHMENT_AUDIT_TAB: process.env.PUNISHMENT_AUDIT_TAB || "Punishment Audits",
  };

  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
    console.error("❌ Error: Missing Google Service Account credentials.");
    console.error("Please ensure GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY are set in .dev.vars.");
    process.exit(1);
  }

  if (!env.PUNISHMENT_SHEET_ID) {
    console.error("❌ Error: Missing PUNISHMENT_SHEET_ID.");
    console.error("Please set PUNISHMENT_SHEET_ID in .dev.vars or wrangler configuration.");
    process.exit(1);
  }

  console.log(`Service Account: ${env.GOOGLE_SERVICE_ACCOUNT_EMAIL}`);
  console.log(`Spreadsheet ID:  ${env.PUNISHMENT_SHEET_ID}`);
  console.log(`Logs Tab:        ${env.PUNISHMENT_SHEET_TAB}`);
  console.log(`Audit Tab:       ${env.PUNISHMENT_AUDIT_TAB}`);
  console.log("\nConnecting to Google Sheets API...");

  try {
    const result = await initPunishmentSheet({ env });
    console.log("✅ Google Spreadsheet connection verified successfully!");
    console.log(`✅ Tab '${result.logsTab}' is ready with 19 columns:`);
    console.log(`   ${PUNISHMENT_LOG_HEADERS.join(" | ")}`);
    console.log(`✅ Tab '${result.auditTab}' is ready with required headers.`);
    console.log("\nSpreadsheet is fully configured for Damo Bot Punishment Center.");
  } catch (err) {
    console.error(`\n❌ Setup failed: ${err.message}`);
    console.error("\nChecklist:");
    console.error("1. Did you share the Google Spreadsheet with the service account?");
    console.error(`   Email: ${env.GOOGLE_SERVICE_ACCOUNT_EMAIL}`);
    console.error("2. Did you grant 'Editor' access?");
    console.error("3. Is the Spreadsheet ID correct in .dev.vars?");
    process.exit(1);
  }
}

main();
