---
name: deploy-damobot
description: >-
  Provides the exact terminal commands and procedures to deploy Damo Bot to live Cloudflare Workers,
  increment version numbers, register Discord slash commands, configure Cloudflare secrets, and push changes to Git.
  Use this skill whenever the user asks to push changes, deploy to live, publish updates, or asks what commands to run in the terminal.
---

# Deploy Damo Bot to Live

This skill guides you and the user through safely deploying Damo Bot changes to the live Cloudflare Workers environment, automatically bumping the version number, and pushing to version control.

## Deployment Checklist & Terminal Commands

> **MANDATORY**: At the very end of ANY set of changes or completed task, you MUST remind the user to run:
> ```powershell
> npm run deploy:live
> ```

When the user asks to push changes, deploy live, or commit updates, provide the following exact terminal commands.

### All-in-One Live Deployment Command (Recommended)
This automatically bumps the version number, verifies all tests pass, and deploys live to Cloudflare:
```powershell
npm run deploy:live
```

---

### Step-by-Step Manual Deployment Sequence

#### Step 1: Increment the Version Number
Increment the patch version in `src/config.js` (`DAMO_BOT_VERSION`):
```powershell
npm run version:bump
```
*Options:*
- Patch bump (default): `npm run version:bump` (e.g. `v0.8.0-beta` → `v0.8.1-beta`)
- Minor bump: `node scripts/bump-version.js minor` (e.g. `v0.8.0-beta` → `v0.9.0-beta`)
- Major bump: `node scripts/bump-version.js major` (e.g. `v0.8.0-beta` → `v1.0.0-beta`)
- Specific version: `node scripts/bump-version.js v0.8.5-beta`

#### Step 2: Run Automated Tests
Ensure all tests pass with the new version before deploying:
```powershell
npm test
```
*Expected result*: `ℹ pass 72`, `ℹ fail 0`.

#### Step 3: Register Slash Commands (If Commands Changed)
If new slash commands, options, or subcommands were added or modified:
```powershell
npm run register:commands
```
*Note*: This runs `scripts/register-commands.js`, registering commands directly to Discord Guild `730015674348601384`.

#### Step 4: Deploy to Cloudflare Workers Live
Deploy the worker bundle, Durable Objects (`StickyBotDO` and `StaffLoaDO`), and cron triggers live to Cloudflare:
```powershell
npx wrangler deploy
```

#### Step 5: Commit and Push to Git (If Tracking via Git)
Commit the new version and push to GitHub:
```powershell
git add .
git commit -m "release: bump version and deploy updates"
git push
```
*(If Git is not yet initialized: `git init`, `git branch -M main`, `git remote add origin <URL>`, `git push -u origin main`)*

---

## Secrets Reference (Cloudflare Workers)

Cloudflare Workers runtime secrets are configured via Wrangler:
- `DISCORD_PUBLIC_KEY`: Used to verify incoming Discord interaction signatures (Ed25519).
- `DISCORD_BOT_TOKEN`: Used to send Discord REST API requests (modifying nicknames, refreshing LOA list, sticky messages).
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB`: Used for referral Google Sheets integration.

To update or set any secret:
```powershell
npx wrangler secret put SECRET_NAME
```

---

## Troubleshooting Live Deployments

1. **Wrangler Not Authenticated**:
   ```powershell
   npx wrangler login
   ```
2. **Check Current Cloudflare Account**:
   ```powershell
   npx wrangler whoami
   ```
3. **Live Tail Logs (Real-time production logs)**:
   ```powershell
   npx wrangler tail
   ```
