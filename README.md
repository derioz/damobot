<p align="center">
  <img src="https://r2.fivemanage.com/image/4sIiNuE1Vmvn.png" alt="DamoBot Logo" width="130" style="border-radius: 50%; box-shadow: 0 4px 12px rgba(0,0,0,0.3);" />
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="https://r2.fivemanage.com/image/qlWrCeXTQdqx.png" alt="Vital RP Logo" width="130" />
</p>

<h1 align="center">DamoBot</h1>

<p align="center">
  <strong>The Ultimate High-Performance Discord Bot Specially Engineered for <a href="http://vitalrp.net">Vital RP</a></strong><br>
  <em>Built on Cloudflare Workers Serverless Edge, SQLite Durable Objects, and Discord Components V2</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Cloudflare%20Workers-orange?style=for-the-badge&logo=cloudflare" alt="Cloudflare Workers" />
  <img src="https://img.shields.io/badge/Runtime-V8%20Edge%20Engine-F38020?style=for-the-badge&logo=cloudflareworkers" alt="Cloudflare Engine" />
  <img src="https://img.shields.io/badge/Discord-Components%20V2-5865F2?style=for-the-badge&logo=discord" alt="Discord API" />
  <img src="https://img.shields.io/badge/Tests-382%20Passing%20(100%25)-success?style=for-the-badge&logo=vitest" alt="Tests" />
  <img src="https://img.shields.io/badge/Architecture-Modular-blueviolet?style=for-the-badge" alt="Modular" />
</p>

---

## 📖 About DamoBot & Vital RP

**DamoBot** is the bespoke operations bot that powers the day-to-day community and staff workflows for **[Vital RP](http://vitalrp.net)** — one of FiveM's premier British roleplay servers.

From processing staff Leave of Absence (LOA) requests and managing multi-layer disciplinary audits to orchestrating player compensation logs, community suggestions, and instant sticky channel notices, DamoBot handles it all with zero-cold-start edge latency.

<p align="center">
  <img src="https://r2.fivemanage.com/image/qePVNvTsc65p.png" alt="Damon - The Face of DamoBot" width="200" style="border-radius: 20px; border: 3px solid #ff7700; box-shadow: 0 8px 24px rgba(255, 119, 0, 0.25);" />
  <br>
  <em>“Behind every smooth Vital RP ticket, there's Damo watching over the server.”</em>
</p>

---

## ⚡ Core Features

DamoBot is structured around a **Domain-Isolated Modular Architecture** where each major feature operates as a self-contained unit.

### 🛡️ 1. Staff LOA Center (`loa`)
* **Interactive Requests**: Staff submit leaves of absence through structured modals with date validation, duration calculation, and emergency flags.
* **Management Review**: Real-time leadership control panel (Approve / Deny) with customizable denial reason modals.
* **Automated Role Management**: Syncs Discord roles (`Staff LOA`) automatically upon approval and cleans them up upon return.
* **Edge Persistence**: State-managed via Cloudflare SQLite **Durable Objects** (`StaffLoaDO`).

### ⚖️ 2. Punishment Center & Ban Logs (`punishments`)
* **Case Management**: Automated sequential case numbering (`#PUN-XXXX`) via `PunishmentSequenceDO`.
* **Dual-Sync Storage**: Every ban, warn, kick, or strike is written atomically to **Cloudflare D1 SQL** and synchronized in real time with **Google Sheets**.
* **Audit Trails & Search**: Built-in Discord search engine to look up player history by Steam ID, Discord ID, or Case Number with interactive pagination.
* **Revocation/Voiding**: Management can void or adjust punishments with full audit logging.

### 💰 3. Player Refund Center (`refunds`)
* **Compensation Logging**: Staff log player asset, vehicle, or monetary refunds with attached ticket proofs.
* **Dual-Sync Pipeline**: Persisted simultaneously to Cloudflare D1 and Google Sheets.
* **Search & Audit**: Searchable compensation records with pagination controls.

### 💡 4. Community Suggestions System (`suggestions`)
* **Components V2 Interface**: Modern Discord UI utilizing rich containers, separators, and button grids.
* **Interactive Modal Submission**: Clean form inputs with character limit validation and HTTPS image checks.
* **Ephemeral Previews**: Users review an exact replica preview of their suggestion before confirming submission.
* **Voting Mechanics**: Dynamic upvote/downvote buttons with real-time toggle calculations and spam protection.
* **Anti-Tampering Security**: Published community suggestions cannot be maliciously deleted by submitters.
* **Sticky Repositioning**: The suggestion submit button automatically floats at the bottom of the suggestions channel.

### ⏰ 5. Support Ticket Reminders (`reminders`)
* **Thread Guard Protection**: Reminders are strictly enforced to run inside active support ticket threads.
* **Personal & Team Reminders**: `/remind me` pings the staff member; `/remind team` alerts the support staff and moderators.
* **Serverless Cron Worker**: Evaluated every minute via Cloudflare Workers `scheduled()` triggers without blocking interactions.

### 📌 6. Sticky Channel Notices (`stickies`)
* **Always at the Bottom**: Automatically re-anchors sticky notices when new messages arrive.
* **Interactive Embeds & Buttons**: Configurable action buttons attached directly to stickies (e.g., instant access to the Punishment Center).
* **Multi-Channel Control**: Configure multiple independent sticky notices across different Vital RP channels.

### 👥 7. Player Referral System (`referrals`)
* **Community Growth**: Players generate personal referral codes and track successful onboarding.
* **Reward Verification**: Staff track referral milestones and distribute server perks.

### 💬 8. Admin Chat & Overview (`admin-chat` & `overview`)
* **Targeted Alerts**: Dedicated channel notifications and staff announcements.
* **System Diagnostics**: Instant latency and status checks via `/ping` and `/damobot`.

---

## 🏛️ Modular System Architecture

DamoBot is engineered for long-term scalability. Every module exports a declarative definition conforming to the `defineModule()` standard.

```text
src/
├── core/                   # Engine & Orchestration
│   ├── bot.js              # Worker fetch & cron execution engine
│   ├── config/             # Environment validation, roles, and brand tokens
│   ├── permissions/        # Role guards & Superadmin authorization
│   ├── router/             # Interaction router & dispatch registry
│   └── module-registry/    # Central registry, validator, and module loader
│
├── shared/                 # Common Infrastructure
│   ├── embeds/             # Vital RP brand styling & embed factory
│   ├── components/         # Discord Components V2 builders
│   ├── discord/            # REST client, permissions, and response helpers
│   ├── logging/            # Reusable logging, search, and pagination
│   ├── storage/            # D1 Database & Google Sheets integrations
│   └── utils/              # Time formatters, strings, and helpers
│
├── modules/                # Self-Contained Feature Domains
│   ├── loa/                # Staff LOA Center (staffOnly: true)
│   ├── punishments/        # Punishment Center (staffOnly: true)
│   ├── refunds/            # Refund Center (staffOnly: true)
│   ├── suggestions/        # Community Suggestions (staffOnly: false)
│   ├── referrals/          # Referral System (staffOnly: false)
│   ├── reminders/          # Support Ticket Reminders (staffOnly: true)
│   ├── stickies/           # Sticky Channel Notices (staffOnly: true)
│   ├── admin-chat/         # Leadership Chat (staffOnly: true)
│   └── overview/           # Status & Info (staffOnly: false)
│
├── durableObjects/         # Cloudflare SQLite Durable Object bindings
└── index.js                # Cloudflare Worker entrypoint
```

---

## 🚀 Technology Stack

| Component | Technology | Description |
|---|---|---|
| **Runtime** | Cloudflare Workers | Edge serverless execution with instant response times |
| **State Storage** | Cloudflare Durable Objects | Strongly consistent SQLite-backed actors (`StickyBotDO`, `StaffLoaDO`, `SuggestionsDO`) |
| **Relational Data** | Cloudflare D1 | Serverless SQL database storing punishments, refunds, and ticket reminders |
| **Audit Sync** | Google Sheets API | Automated dual-write for staff accountability and management reviews |
| **Discord API** | Discord Interactions & Components V2 | Webhook-driven interaction handling with cryptographic signature verification |
| **Testing** | Node.js Test Runner | Complete test suite with **382 unit tests (100% pass rate)** |

---

## 🛠️ Development & Deployment

### Prerequisites
- [Node.js](https://nodejs.org) (v20+ recommended)
- [Cloudflare Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- Discord Bot Application with Interaction Endpoint configured

### Local Setup
```powershell
# Clone the repository
git clone https://github.com/derioz/damobot.git
cd damobot

# Install dependencies
npm install

# Run the test suite
npm test
```

### Slash Command Registration
Whenever command definitions or sub-commands are added:
```powershell
npm run register:commands
```

### Live Cloudflare Deployment
Deploying to the live Cloudflare Worker is fully automated:
```powershell
npm run deploy:live
```
*This command automatically:*
1. Increments the canonical version in `src/config.js` (`DAMO_BOT_VERSION`).
2. Runs the full test suite (`npm test`) guaranteeing zero regressions.
3. Deploys the worker live to Cloudflare via `wrangler deploy`.

---

## 🔒 Security & Staff Permissions

DamoBot enforces strict role-based access control (RBAC). Core permissions are verified before any interaction reaches module handlers:
- **Staff Team Role**: Base authorization for internal staff tooling.
- **Management & Owner Roles**: Unrestricted administrative bypass and configuration rights.
- **Cryptographic Signature Verification**: Every inbound Discord request is validated using `tweetnacl` Ed25519 signature checks.

---

<p align="center">
  <strong>Crafted with ❤️ for the <a href="http://vitalrp.net">Vital RP</a> Community</strong><br>
  <sub>Maintained by the Vital RP Development Team</sub>
</p>
