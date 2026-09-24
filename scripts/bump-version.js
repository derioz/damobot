import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(__dirname, "../src/config.js");

export function bumpVersionString(currentVersion, bumpType = "patch") {
  // Check for explicit version argument (e.g., "v0.8.1-beta" or "0.8.1")
  if (bumpType && /^v?\d+\.\d+\.\d+/.test(bumpType)) {
    return bumpType.startsWith("v") ? bumpType : `v${bumpType}`;
  }

  // Regex to parse: v<major>.<minor>.<patch>(-<tag>(\.<num>)?)?
  const semverRegex = /^v?(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z]+)(?:\.(\d+))?)?$/;
  const match = currentVersion.trim().match(semverRegex);

  if (!match) {
    throw new Error(`Unable to parse current version: "${currentVersion}"`);
  }

  let major = parseInt(match[1], 10);
  let minor = parseInt(match[2], 10);
  let patch = parseInt(match[3], 10);
  const tag = match[4]; // e.g. "beta"
  let tagNum = match[5] !== undefined ? parseInt(match[5], 10) : null; // e.g. 1

  if (bumpType === "major") {
    major += 1;
    minor = 0;
    patch = 0;
    tagNum = tagNum !== null ? 0 : null;
  } else if (bumpType === "minor") {
    minor += 1;
    patch = 0;
    tagNum = tagNum !== null ? 0 : null;
  } else {
    // Default: patch or build increment
    if (tag && tagNum !== null) {
      tagNum += 1;
    } else {
      patch += 1;
    }
  }

  let newVersion = `v${major}.${minor}.${patch}`;
  if (tag) {
    newVersion += `-${tag}`;
    if (tagNum !== null) {
      newVersion += `.${tagNum}`;
    }
  }

  return newVersion;
}

export function bumpVersionInConfig(bumpType = "patch") {
  const content = readFileSync(configPath, "utf-8");
  const versionRegex = /(export\s+const\s+DAMO_BOT_VERSION\s*=\s*["'])([^"']+)(["'];?)/;
  const match = content.match(versionRegex);

  if (!match) {
    throw new Error(`Could not locate DAMO_BOT_VERSION in ${configPath}`);
  }

  const currentVersion = match[2];
  const newVersion = bumpVersionString(currentVersion, bumpType);

  const updatedContent = content.replace(
    versionRegex,
    `$1${newVersion}$3`
  );

  writeFileSync(configPath, updatedContent, "utf-8");
  console.log(`📦 Bumped Damo Bot version: ${currentVersion} → ${newVersion}`);
  return { currentVersion, newVersion };
}

// If executed directly from CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2] || "patch";
  try {
    bumpVersionInConfig(arg);
  } catch (err) {
    console.error(`❌ Version bump failed: ${err.message}`);
    process.exit(1);
  }
}
