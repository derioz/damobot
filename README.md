<p align="center">
  <img src="https://r2.fivemanage.com/image/4sIiNuE1Vmvn.png" alt="DamoBot Logo" width="130" style="border-radius: 50%; box-shadow: 0 4px 12px rgba(0,0,0,0.3);" />
</p>

<h1 align="center">DamoBot</h1>

<p align="center">
  <strong>Modular High-Performance Discord Bot for FiveM Communities & Server Administration</strong><br>
  <em>Built on Cloudflare Workers Serverless Edge, SQLite Durable Objects, Cloudflare D1 SQL, and Discord Components V2</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Cloudflare%20Workers-orange?style=for-the-badge&logo=cloudflare" alt="Cloudflare Workers" />
  <img src="https://img.shields.io/badge/Runtime-V8%20Edge%20Engine-F38020?style=for-the-badge&logo=cloudflareworkers" alt="Cloudflare Engine" />
  <img src="https://img.shields.io/badge/Discord-Components%20V2-5865F2?style=for-the-badge&logo=discord" alt="Discord API" />
  <img src="https://img.shields.io/badge/Tests-382%20Passing%20(100%25)-success?style=for-the-badge&logo=vitest" alt="Tests" />
  <img src="https://img.shields.io/badge/Architecture-Modular-blueviolet?style=for-the-badge" alt="Modular" />
</p>

---

## 📖 DamoBot

**DamoBot** is an open, modular Discord automation bot designed specifically for **FiveM roleplay communities** and game server staff teams. It provides a full administrative back-office and community hub directly within Discord, handling:

- Staff Leave of Absence (LOA) workflows with automatic role management.
- Disciplinary case tracking and ban/warn audit logs with sequential case IDs.
- Player compensation and asset refund logs.
- Interactive community suggestions with live preview and vote tracking.
- Automated support ticket thread reminders with background cron evaluation.
- High-performance sticky channel notices powered by SQLite actors.
- Player referral code management and community onboarding tracking.

Built natively on **Cloudflare Workers** and **SQLite Durable Objects**, DamoBot operates on a serverless edge runtime—delivering sub-50ms response times, zero server hosting costs on Cloudflare's free tier, and 100% uptime with no persistent VPS required.

---

## ⚡ Features & Modules

DamoBot is structured around a **Domain-Isolated Modular Architecture**. Every feature lives in `src/modules/<module-id>/` and operates as an independent, self-contained domain:

### 🛡️ 1. Staff LOA Center (`src/modules/loa/`)
* **Interactive Requests**: Staff submit leaves of absence via Discord modal forms with built-in date validation and duration checks.
* **Management Review**: Real-time leadership panel (Approve / Deny) with customizable denial reason modals.
* **Automated Role Management**: Temporarily assigns designated LOA roles and restores staff roles upon return.
* **Edge Persistence**: State-managed via Cloudflare SQLite **Durable Objects** (`StaffLoaDO`).

### ⚖️ 2. Punishment Center & Ban Logs (`src/modules/punishments/`)
* **Sequential Case Numbering**: Automated atomic case IDs (`#PUN-XXXX`) via `PunishmentSequenceDO`.
* **Dual-Sync Storage**: Writes records atomically to **Cloudflare D1 SQL** with optional real-time sync to **Google Sheets**.
* **Audit Trails & Search**: Search player history by Steam ID, Discord ID, or Case Number with interactive pagination.
* **Revocation/Voiding**: Management can void or edit punishments with full staff attribution audit trails.

### 💰 3. Player Refund Center (`src/modules/refunds/`)
* **Compensation Logging**: Staff log player asset, vehicle, or monetary refunds with attached ticket proofs.
* **Dual-Sync Pipeline**: Persisted simultaneously to Cloudflare D1 and Google Sheets.
* **Search & Audit**: Searchable compensation records with pagination controls.

### 💡 4. Community Suggestions System (`src/modules/suggestions/`)
* **Components V2 Interface**: Modern Discord UI utilizing rich containers, separators, and button grids.
* **Interactive Modal Submission**: Clean form inputs with character limit validation and HTTPS image checks.
* **Ephemeral Previews**: Users review an exact replica preview of their suggestion before confirming submission.
* **Voting Mechanics**: Dynamic upvote/downvote buttons with real-time toggle calculations and spam protection.
* **Anti-Tampering Security**: Published community suggestions cannot be deleted by submitters.
* **Sticky Repositioning**: The suggestion submit button automatically floats at the bottom of the suggestions channel.

### ⏰ 5. Support Ticket Reminders (`src/modules/reminders/`)
* **Thread Guard Protection**: Reminders are strictly enforced to run inside active support ticket threads.
* **Personal & Team Reminders**: `/remind me` pings the staff member; `/remind team` alerts the support staff and moderators.
* **Serverless Cron Worker**: Evaluated every minute via Cloudflare Workers `scheduled()` triggers without blocking interactions.

### 📌 6. Sticky Channel Notices (`src/modules/stickies/`)
* **Always at the Bottom**: Automatically re-anchors sticky notices when new messages arrive.
* **Interactive Embeds & Buttons**: Configurable action buttons attached directly to stickies (e.g., instant access to the Punishment Center).
* **Multi-Channel Control**: Configure multiple independent sticky notices across different Discord channels.

### 👥 7. Player Referral System (`src/modules/referrals/`)
* **Community Growth**: Players generate personal referral codes and track successful onboarding.
* **Reward Verification**: Staff track referral milestones and distribute server perks.

### 💬 8. Admin Chat Mentions (`src/modules/admin-chat/`)
* **Targeted Alerts**: Dedicated channel notifications and staff announcements.

### 📊 9. Bot Overview & Diagnostics (`src/modules/overview/`)
* **System Diagnostics**: Instant latency and status checks via `/ping` and `/damobot`.

---

## 📋 Requirements

Before deploying DamoBot, ensure you have:

- **Node.js**: v20.0.0 or higher
- **npm**: v10.0.0 or higher
- **Discord Developer Account**: With permissions to create applications and bots
- **Cloudflare Account**: Free tier supports Workers, D1 SQL, and Durable Objects
- **Cloudflare Wrangler CLI**: Installed via devDependencies (`npx wrangler`)
- **FiveM Server** (Optional): Any FiveM server (QBCore, ESX, or standalone) whose staff team uses Discord

---

## 🚀 Installation & Quick Start

### 1. Clone the Repository
```bash
git clone https://github.com/derioz/damobot.git
cd damobot
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Verify the Test Suite
Run the test suite to ensure everything is operating cleanly:
```bash
npm test
```
*(All 382 unit tests should pass with 100% success rate)*

---

## 🤖 Discord Bot Setup

### 1. Create Application
1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application** and give your bot a name.
3. Save your **Application ID** and **Public Key** (found under *General Information*).

### 2. Configure Bot & Privileged Intents
1. Navigate to the **Bot** tab on the left sidebar.
2. Click **Reset Token** to generate a **Bot Token** (save this for slash command registration).
3. Under **Privileged Gateway Intents**:
   - Enable **Server Members Intent** (Required for role sync and staff nickname checks).
   - Enable **Message Content Intent** (Required if using admin chat message webhooks).

### 3. Generate Invite URL & Permissions
1. Go to **OAuth2** -> **OAuth2 URL Generator**.
2. Select Scopes:
   - `bot`
   - `applications.commands`
3. Select Bot Permissions:
   - `Manage Roles` (Required for LOA role assignment)
   - `Manage Nicknames` (Required for LOA nickname prefixing)
   - `Manage Messages` (Required for deleting old sticky messages)
   - `Send Messages`
   - `Embed Links`
   - `Attach Files`
   - `Read Message History`
   - `Use Slash Commands`
4. Use the generated URL to invite the bot to your Discord server.

### 4. Set the Interaction Endpoint URL
After deploying your Cloudflare Worker (see below), copy your worker's live URL (e.g., `https://damo-bot.<subdomain>.workers.dev`) and paste it into:
**Discord Developer Portal** -> **General Information** -> **Interactions Endpoint URL**.
Discord will send a `PING` payload, which DamoBot automatically validates using your `DISCORD_PUBLIC_KEY`.

---

## ⚙️ Configuration

DamoBot supports configuration via environment variables (`.dev.vars` / Cloudflare Dashboard) and structured JSON configuration files.

### 1. Environment Variables Template
Copy [.env.example](file:///d:/github/damobot/.env.example) to `.dev.vars` for local development:
```bash
cp .env.example .dev.vars
```

### Configuration Variables Reference:

#### Secrets & Credentials
| Variable | Description | Required |
|---|---|---|
| `DISCORD_PUBLIC_KEY` | 64-character hex Ed25519 public key from Discord Dev Portal | **Yes** |
| `DISCORD_APPLICATION_ID` | Discord Application Client ID | **Yes** |
| `DISCORD_BOT_TOKEN` | Discord Bot Token (used by `scripts/register-commands.js`) | For commands |
| `MESSAGE_ENDPOINT_SECRET` | Optional bearer secret for external webhook endpoints | No |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Google Cloud Service Account email (for Sheets dual-sync) | Optional |
| `GOOGLE_PRIVATE_KEY` | RSA PEM private key for Google Sheets API access | Optional |

#### Discord IDs
| Variable | Description |
|---|---|
| `DISCORD_GUILD_ID` | Primary Discord Server (Guild) ID |
| `STAFF_TEAM_ROLE_ID` | Base Staff Team role ID required for staff commands |
| `OWNER_ROLE_ID` | Server Owner role ID |
| `VRP_MANAGEMENT_ROLE_ID` | Management role ID |
| `STAFF_LOA_ROLE_ID` | Role applied to staff while on Leave of Absence |
| `SUPPORT_STAFF_ROLE_ID` | Support staff role ID |
| `MODERATOR_ROLE_ID` | Moderator staff role ID |
| `LOA_CHANNEL_ID` | Channel ID for the interactive LOA panel |
| `LOA_LOG_CHANNEL_ID` | Channel ID for LOA audit logs |
| `PUNISHMENT_LOG_CHANNEL_ID` | Channel ID where staff punishment records are posted |
| `REFUND_LOG_CHANNEL_ID` | Channel ID where refund records are posted |
| `SUGGESTIONS_CHANNEL_ID` | Channel ID for community suggestions |
| `TICKET_REMINDER_CHANNEL_ID` | Support chat channel ID for ticket reminders |

#### Community & FiveM Branding
| Variable | Description | Default |
|---|---|---|
| `COMMUNITY_NAME` | Your server or community name | `Vital RP` |
| `COMMUNITY_SHORT_NAME` | Acronym or short name | `VRP` |
| `COMMUNITY_WEBSITE_URL` | Community website URL | `http://vitalrp.net` |
| `LOGO_URL` | Direct URL to your server logo image | Vital RP Logo |
| `BRAND_COLOR` | Hex color code for embeds (e.g. `#FAA200`) | `#FAA200` |
| `FIVEM_SERVER_IP` | FiveM server IP or connection hostname | `""` |
| `FIVEM_SERVER_PORT` | FiveM server port | `30120` |

### 2. Server Configuration File
For non-sensitive server configuration, copy [config/server.example.json](file:///d:/github/damobot/config/server.example.json) to `config/server.json`:
```bash
cp config/server.example.json config/server.json
```

### 3. Module Toggling File
To enable or disable specific bot modules without touching code, copy [config/modules.example.json](file:///d:/github/damobot/config/modules.example.json) to `config/modules.json`:
```bash
cp config/modules.example.json config/modules.json
```

---

## 🎮 FiveM Setup & Integration

DamoBot functions as the central staff operations hub for your FiveM server:

1. **Player Lookups**: Punishment and refund search queries support searching by:
   - Steam Hex / Steam ID
   - Discord Snowflake ID (`<@123456789>`)
   - In-game Character Names
   - Sequential Case ID (`#PUN-000123`, `VRP-R-000045`)
2. **Staff Attribution**: Every action (bans, warns, refunds, LOAs) automatically captures the staff member's Discord ID and username for auditability.
3. **FiveM Server Details**: Specify your `FIVEM_SERVER_IP` and `FIVEM_SERVER_PORT` in your configuration to display connection links and server info on `/damobot` diagnostic embeds.

---

## ☁️ Cloudflare Setup

DamoBot uses Cloudflare Workers, Cloudflare D1 SQL, and SQLite Durable Objects.

### 1. Copy the Wrangler Configuration
```bash
cp wrangler.example.jsonc wrangler.jsonc
```

### 2. Create Cloudflare D1 Databases
Run the following commands using Wrangler:
```bash
# Create the Punishments D1 database
npx wrangler d1 create damo-bot-punishments

# Create the Refunds D1 database
npx wrangler d1 create damo-bot-refunds
```
Wrangler will output a `database_id` for each database. Copy those IDs into your `wrangler.jsonc`:
```jsonc
"d1_databases": [
  {
    "binding": "PUNISHMENT_DB",
    "database_name": "damo-bot-punishments",
    "database_id": "PASTE_PUNISHMENTS_DATABASE_ID_HERE",
    "migrations_dir": "migrations"
  },
  {
    "binding": "REFUND_DB",
    "database_name": "damo-bot-refunds",
    "database_id": "PASTE_REFUNDS_DATABASE_ID_HERE",
    "migrations_dir": "migrations_refunds"
  }
]
```

### 3. Apply Database Migrations
Execute the migrations to set up the SQL schemas:
```bash
# Apply punishments schema to remote Cloudflare D1
npx wrangler d1 migrations apply damo-bot-punishments --remote

# Apply refunds schema to remote Cloudflare D1
npx wrangler d1 migrations apply damo-bot-refunds --remote
```

### 4. Durable Objects
Durable Objects are automatically provisioned and migrated when you deploy via Wrangler. DamoBot uses:
- `StickyBotDO`: Manages persistent channel sticky notices.
- `StaffLoaDO`: Tracks active leaves of absence and role snapshots.
- `PunishmentSequenceDO`: Generates atomic sequential case numbers.
- `SuggestionsDO`: Tracks suggestion IDs, votes, and user submission cooldowns.

---

## 🧩 Module Architecture

DamoBot is organized into self-contained modules located in `src/modules/`:

```text
src/modules/
├── loa/            # Staff LOA Center (staffOnly: true)
├── punishments/    # Punishment & Ban Logs (staffOnly: true)
├── refunds/        # Player Refund Center (staffOnly: true)
├── suggestions/    # Community Suggestions (staffOnly: false)
├── reminders/      # Ticket Reminders (staffOnly: true)
├── referrals/      # Player Referral System (staffOnly: false)
├── stickies/       # Sticky Channel Messages (staffOnly: true)
├── admin-chat/     # Admin Chat Bridge (staffOnly: true)
└── overview/       # Health & Diagnostics (staffOnly: false)
```

### Creating a New Module
1. Create a directory in `src/modules/<my-module>/`.
2. Create `index.js` exporting a module definition using `defineModule()`:
```javascript
import { defineModule } from "../../core/module-registry/index.js";

export default defineModule({
  id: "my-module",
  name: "My Custom Module",
  description: "Handles custom FiveM features.",
  staffOnly: true, // REQUIRED: true | false

  commands: [
    {
      name: "mycommand",
      description: "Custom command description.",
      type: 1, // CHAT_INPUT
    },
  ],

  handlers: {
    commands: {
      mycommand: async (interaction, env, ctx) => {
        return new Response(JSON.stringify({
          type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
          data: { content: "Hello from custom module!" },
        }), { headers: { "content-type": "application/json" } });
      },
    },
  },
});
```
3. Register the module in `src/core/module-registry/loader.js`.
4. Run `npm test` to verify module schema compliance.

---

## 🛠️ Development & Testing

### Local Development
To run a local emulation of Cloudflare Workers and Durable Objects:
```bash
npx wrangler dev
```

### Running Tests
DamoBot features a comprehensive automated test suite with **382 tests**:
```bash
npm test
```

---

## 🚢 Production Deployment

### 1. Register Slash Commands with Discord
Whenever you modify slash commands, sub-commands, or choices:
```bash
npm run register:commands
```

### 2. Deploy Live Worker to Cloudflare
Deploying to Cloudflare Workers is fully automated:
```bash
npm run deploy:live
```
*`npm run deploy:live` automatically:*
1. Increments the canonical version in `src/config.js` (`DAMO_BOT_VERSION`).
2. Runs the entire unit test suite (`npm test`) guaranteeing zero regressions.
3. Deploys the worker live to Cloudflare via `wrangler deploy`.

---

## 🔒 Security Best Practices

1. **Never commit `.env` or `.dev.vars`**: Always verify these files remain in `.gitignore`.
2. **Never commit `wrangler.jsonc` with live IDs**: Use `wrangler.example.jsonc` for version control.
3. **Use Cloudflare Secrets in Production**:
   Store sensitive tokens securely in Cloudflare using the Wrangler CLI:
   ```bash
   npx wrangler secret put DISCORD_BOT_TOKEN
   npx wrangler secret put DISCORD_PUBLIC_KEY
   npx wrangler secret put GOOGLE_PRIVATE_KEY
   ```
4. **Credential Rotation**: If a bot token or private key is accidentally exposed, immediately revoke and regenerate it via the Discord Developer Portal or Google Cloud Console.

---

## 🔄 Updating Forked Repositories

If you have forked DamoBot and wish to pull upstream improvements:

```bash
# Add the upstream repository
git remote add upstream https://github.com/derioz/damobot.git

# Fetch upstream branches
git fetch upstream

# Merge upstream main into your current branch
git merge upstream/main
```

---

## ❓ Troubleshooting

### 1. `Invalid request signature` (401 Unauthorized)
- Verify `DISCORD_PUBLIC_KEY` in `.dev.vars` or Cloudflare Dashboard exactly matches the **Public Key** in the Discord Developer Portal under *General Information*.
- Ensure there are no leading or trailing whitespace characters.

### 2. Slash Commands Not Appearing in Discord
- Run `npm run register:commands`.
- Ensure `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, and `DISCORD_GUILD_ID` are configured correctly in `.dev.vars`.
- Note: Guild commands register instantly; global commands can take up to 1 hour to propagate across Discord.

### 3. Missing Cloudflare D1 Binding Warnings
- Ensure your D1 databases have been created (`npx wrangler d1 create <name>`) and their IDs are pasted into `wrangler.jsonc`.
- Ensure migrations have been applied: `npx wrangler d1 migrations apply <name> --remote`.

### 4. `The application did not respond`
- Discord requires interactions to be acknowledged within 3 seconds. For long-running database operations or external API calls, DamoBot uses Discord's deferred response pattern (Type 5 `DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE`).

---

## 📄 License

This repository is currently **unlicensed**. All rights are reserved by the original author. If you wish to allow other developers to legally fork, modify, or redistribute this software, please add an open-source license (such as [MIT](https://opensource.org/licenses/MIT), [Apache 2.0](https://opensource.org/licenses/Apache-2.0), or [GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)).
