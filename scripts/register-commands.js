import { existsSync, readFileSync } from "node:fs";

// Load local environment variables from .dev.vars or .env if present
function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  if (typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(filePath);
      return;
    } catch {
      // Fall through to manual parser if needed
    }
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
  } catch {
    // Ignore read errors
  }
}

loadEnvFile(".dev.vars");
loadEnvFile(".env");

const {
  DISCORD_APPLICATION_ID,
  DISCORD_GUILD_ID,
  DISCORD_BOT_TOKEN,
} = process.env;

import { fileURLToPath } from "node:url";
import { getAllCommands } from "../src/core/module-registry/index.js";

const isMainModule = Boolean(
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
);

const commands = getAllCommands(process.env);

export { commands };

async function registerGuildCommands() {
  const url = `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/guilds/${DISCORD_GUILD_ID}/commands`;

  console.log(`Registering guild command(s) for Application ${DISCORD_APPLICATION_ID} in Guild ${DISCORD_GUILD_ID}...`);

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": `Bot ${DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ Failed to register guild commands (${response.status} ${response.statusText}):`);
    console.error(errorText);
    process.exit(1);
  }

  const data = await response.json();
  console.log("✅ Successfully registered guild command(s):");
  for (const cmd of data) {
    console.log(`  - /${cmd.name} (ID: ${cmd.id}): ${cmd.description}`);
  }
}

if (isMainModule) {
  if (!DISCORD_APPLICATION_ID || !DISCORD_GUILD_ID || !DISCORD_BOT_TOKEN) {
    console.error("❌ Missing required environment variables.");
    console.error("Please ensure the following are set in your environment or .dev.vars:");
    console.error("  - DISCORD_APPLICATION_ID");
    console.error("  - DISCORD_GUILD_ID");
    console.error("  - DISCORD_BOT_TOKEN");
    process.exit(1);
  }

  registerGuildCommands().catch((err) => {
    console.error("❌ Unexpected error:", err.message || "Failed to execute request");
    process.exit(1);
  });
}
