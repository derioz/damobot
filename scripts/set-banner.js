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

const DEFAULT_BANNER_URL = "https://r2.fivemanage.com/image/jCJbGSok909D.png";
const bannerUrl = process.argv[2] || process.env.BANNER_IMAGE_URL || DEFAULT_BANNER_URL;
const botToken = process.env.DISCORD_BOT_TOKEN;

async function setBotBanner() {
  console.log("🎨 Damo Bot Profile Banner Update Tool");
  console.log("======================================");

  if (!botToken) {
    console.error("❌ Error: DISCORD_BOT_TOKEN is not set.");
    console.error("Please ensure DISCORD_BOT_TOKEN is present in your .dev.vars or environment.");
    process.exit(1);
  }

  console.log(`🌐 Fetching banner image from:\n   ${bannerUrl}`);

  let imageBuffer;
  let mimeType = "image/png";

  try {
    const response = await fetch(bannerUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "";
    const arrayBuffer = await response.arrayBuffer();
    imageBuffer = Buffer.from(arrayBuffer);

    console.log(`📦 Downloaded image: ${(imageBuffer.length / 1024 / 1024).toFixed(2)} MB`);

    // Verify PNG magic numbers (89 50 4E 47 0D 0A 1A 0A)
    const isPng =
      imageBuffer.length >= 8 &&
      imageBuffer[0] === 0x89 &&
      imageBuffer[1] === 0x50 &&
      imageBuffer[2] === 0x4e &&
      imageBuffer[3] === 0x47 &&
      imageBuffer[4] === 0x0d &&
      imageBuffer[5] === 0x0a &&
      imageBuffer[6] === 0x1a &&
      imageBuffer[7] === 0x0a;

    if (!isPng && !contentType.includes("image")) {
      throw new Error(`Image at ${bannerUrl} is not a valid PNG or image file.`);
    }

    if (contentType.includes("image/gif")) {
      mimeType = "image/gif";
    } else if (contentType.includes("image/jpeg") || contentType.includes("image/jpg")) {
      mimeType = "image/jpeg";
    } else {
      mimeType = "image/png";
    }

    console.log(`✅ Image validated successfully as valid ${mimeType.toUpperCase()}.`);
  } catch (err) {
    console.error(`❌ Failed to fetch or validate banner image: ${err.message}`);
    process.exit(1);
  }

  // Convert Buffer to base64 Data URI
  const base64Data = imageBuffer.toString("base64");
  const dataUri = `data:${mimeType};base64,${base64Data}`;

  console.log("🚀 Updating bot profile banner on Discord API (PATCH /users/@me)...");

  try {
    const patchRes = await fetch("https://discord.com/api/v10/users/@me", {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        banner: dataUri,
      }),
    });

    if (!patchRes.ok) {
      const errorText = await patchRes.text();
      throw new Error(`Discord API returned HTTP ${patchRes.status}: ${errorText}`);
    }

    const userData = await patchRes.json();

    console.log("\n======================================");
    console.log("🎉 SUCCESS! Damo Bot profile banner has been updated!");
    console.log(`🤖 Bot: ${userData.username}#${userData.discriminator || "0"} (ID: ${userData.id})`);
    console.log(`🖼️ Banner Hash: ${userData.banner || "Updated"}`);
    console.log("======================================\n");
  } catch (err) {
    console.error(`\n❌ Failed to update bot banner: ${err.message}`);
    process.exit(1);
  }
}

setBotBanner();
