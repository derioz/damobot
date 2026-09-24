# DamoBot Modular Architecture Guide (`docs/MODULES.md`)

Welcome to the **DamoBot Modular Architecture**. DamoBot is organized into self-contained, domain-isolated feature modules. This architecture enables developers and AI agents to add or update features without touching unrelated parts of the bot.

---

## 1. Architectural Overview

```text
src/
├── core/                   # Bot infrastructure, lifecycle, and orchestration
│   ├── bot.js              # Worker fetch & cron execution engine
│   ├── config/             # Centralized bot configurations and environment validation
│   ├── permissions/        # Central role & superadmin authorization guards
│   ├── router/             # Interaction dispatcher and route resolution
│   └── module-registry/    # Central registry, validator, and module loader
│
├── shared/                 # Functionality genuinely shared across multiple modules
│   ├── embeds/             # Standard DamoBot embed system (Vital RP brand identity)
│   ├── components/         # Components V2 layouts & ActionRow/Button builders
│   ├── discord/            # Discord API helpers, REST client, response factories
│   ├── logging/            # Reusable logging infrastructure (search, pagination, formatters)
│   ├── storage/            # Database & Google Sheets services
│   └── utils/              # General utility helpers
│
├── modules/                # Self-contained feature modules
│   ├── loa/                # Staff Leave of Absence (LOA) Center
│   ├── punishments/        # Punishment Center & Ban/Warn Logs
│   ├── refunds/            # Player Refund Center
│   ├── suggestions/        # Community Suggestions & Voting
│   ├── referrals/          # Player Referral System
│   ├── reminders/          # Support Ticket Reminders
│   ├── stickies/           # Sticky Channel Messages
│   ├── overview/           # Bot Status & Capability Overview (/damobot, /ping)
│   └── admin-chat/         # Dedicated Admin Chat Integrations
│
├── durableObjects/         # Cloudflare SQLite Durable Object bindings
└── index.js                # Cloudflare Worker entrypoint
```

---

## 2. What is a Module?

A **module** is a self-contained feature unit in DamoBot that owns:
1. Feature-specific slash commands and context menus.
2. Feature-specific buttons, select menus, and modal forms.
3. Feature-specific database queries, schemas, and cloud storage logic.
4. Optional scheduled cron handlers for background processing.
5. Optional Durable Object bindings.

### Module Isolation Principle
- **Modules own feature-specific logic.**
- **Core owns bot engine infrastructure.**
- **Shared owns functionality genuinely used across multiple modules.**
- Modules should never directly depend on or mutate other modules. Cross-module actions communicate through shared services or standard Discord interactions.

---

## 3. The `staffOnly` Contract (Mandatory)

> [!IMPORTANT]
> Every module **MUST explicitly declare** whether it is:
> ```javascript
> staffOnly: true
> ```
> or
> ```javascript
> staffOnly: false
> ```
> Modules without an explicit boolean `staffOnly` flag fail validation at startup.

### Pre-Implementation Rule
Before starting implementation of any new feature or module, the **DamoBot Module Architect** agent must determine if the module is staff-only. If not specified by the developer, the agent must ask:
> **"Will this be a staff-only module?"**

### Built-in Modules Reference
| Module ID | Module Name | `staffOnly` | Target Audience |
|---|---|---|---|
| `loa` | Staff LOA Center | `true` | Staff Team & Leadership |
| `punishments` | Punishment Center | `true` | Staff Team & Leadership |
| `refunds` | Refund Center | `true` | Staff Team & Leadership |
| `reminders` | Ticket Reminders | `true` | Staff Team & Support Staff |
| `stickies` | Sticky Messages | `true` | Staff Team & Leadership |
| `admin-chat` | Admin Chat Mentions | `true` | Staff Team Only |
| `suggestions` | Community Suggestions | `false` | Public / Server Community |
| `referrals` | Referral System | `false` | Public / Server Community |
| `overview` | Bot Status & Overview | `false` | Public / Server Community |

---

## 4. Standard Module Directory Structure

Every module lives in `src/modules/<module-id>/`:

```text
src/modules/ooc-jail-logs/
├── index.js          # Module declaration exporting defineModule(...)
├── handlers.js       # Command, component, and modal interaction handlers
├── components.js     # Discord UI components built with the shared design system
├── constants.js      # Module-specific constants, custom IDs, Action IDs
└── db.js             # D1 database queries (if applicable)
```

---

## 5. Standard Module Interface (`defineModule`)

Modules export a default definition using `defineModule()` from `src/core/module-registry/index.js`:

```javascript
import { defineModule } from "../../core/module-registry/index.js";
import { handleJailCommand, handleJailComponent } from "./handlers.js";

export default defineModule({
  id: "ooc-jail-logs",
  name: "OOC Jail Logs",
  description: "Log and search player OOC jail records.",
  staffOnly: true, // REQUIRED: true | false
  
  // Discord Slash Commands & Context Menus to register
  commands: [
    {
      name: "jail",
      description: "Open the OOC Jail Center or log a jail record.",
      type: 1, // CHAT_INPUT
      options: [
        {
          name: "log",
          description: "Log an OOC jail punishment.",
          type: 1, // SUB_COMMAND
        },
      ],
    },
  ],

  // Interaction handlers
  handlers: {
    commands: {
      jail: handleJailCommand,
    },
    components: [
      {
        matches: (customId) => customId.startsWith("jail_"),
        handler: handleJailComponent,
      },
    ],
    modals: [
      // { matches: (customId) => boolean, handler: fn }
    ],
  },

  // Optional Cloudflare cron trigger handler (runs every minute)
  scheduled: null,

  // Optional Durable Object class bindings
  durableObjects: {},
});
```

---

## 6. How Module Registration Works

All modules are registered in `src/core/module-registry/loader.js`.

To add a new module:
1. Create `src/modules/<module-id>/index.js`.
2. Import the module in `src/core/module-registry/loader.js` and add it to `BUILTIN_MODULES`.
3. The central registry automatically:
   - Aggregates its commands for Discord registration (`npm run register:commands`).
   - Routes command, button, select menu, and modal interactions to its handlers.
   - Enqueues its scheduled tasks on cron triggers.

---

## 7. Shared DamoBot UI & Design System

Modules must NOT implement their own custom embed or button builders. All UI must use the shared design system in `src/shared/`:

### A. Embed Builders (`src/shared/embeds/index.js`)
- `createDamoEmbed({ title, description, color, fields, footerText, thumbnail, image })`: Standard DamoBot embed in Vital RP orange (`#FAA200`).
- `createSuccessEmbed({ title, description, fields })`: Success embed in green (`#57F287`) with `✅` prefix.
- `createErrorEmbed({ title, description, fields })`: Error embed in red (`#ED4245`) with `❌` prefix.
- `createWarningEmbed({ title, description, fields })`: Warning embed in amber (`#FEE75C`) with `⚠️` prefix.

### B. Button Builders (`src/shared/components/index.js`)
- `createPrimaryButton({ customId, label, emoji, disabled })`: Blurple button.
- `createSecondaryButton({ customId, label, emoji, disabled })`: Grey button.
- `createSuccessButton({ customId, label, emoji, disabled })`: Green button.
- `createDangerButton({ customId, label, emoji, disabled })`: Red button.
- `createLinkButton({ url, label, emoji })`: External link button.
- `createPaginationRow({ customIdPrefix, currentPage, totalPages, queryKey })`: Standard Previous / Next row.

> [!WARNING]
> **Global UI Rule**: Never include an ❌ / X delete or dismiss button that allows users to dismiss/delete a message or embed.

---

## 8. Shared Logging Architecture (`src/shared/logging/index.js`)

Modules that record logs (such as Punishments/Ban Logs, Refunds, and future OOC Jail Logs) reuse the shared logging infrastructure:
- **`formatLogDate(dateInput)`**: Standard America/Chicago timezone formatter (`"Sep 4, 2026, 4:52 PM"`).
- **`formatPlayerLine(name, discordId)`**: Standardized player name & ID line (`**John Doe** • \`150580708144840704\``).
- **`formatBlockquote(text)`**: Markdown blockquote formatting for log reasons.
- **`calculatePagination({ totalItems, currentPage, pageSize })`**: Pagination offset/limit calculator.
- **`tokenizeSearchQuery(query)`**: Search query normalizer & token splitter.
- **`generateAuditId(prefix)`**: Unique collision-resistant audit tracking ID generator (`AUD-1725482938123-0042`).

---

## 9. Creating a New Module (Step-by-Step Template)

### Step 1: Clarify Staff-Only Status
Confirm whether the new module is `staffOnly: true` or `staffOnly: false`.

### Step 2: Create Module Folder & Files
Create `src/modules/<module-id>/`:
```text
src/modules/ooc-jail-logs/
├── index.js
├── handlers.js
├── components.js
└── constants.js
```

### Step 3: Implement Module Logic
In `src/modules/ooc-jail-logs/handlers.js`:
```javascript
import { ephemeralTextResponse, requireStaffRole } from "../../shared/index.js";

export async function handleJailCommand(interaction, env, ctx) {
  const authError = requireStaffRole(interaction, env);
  if (authError) return authError;

  return ephemeralTextResponse("OOC Jail Center opened!");
}
```

### Step 4: Register Module
In `src/core/module-registry/loader.js`:
```javascript
import jailModule from "../../modules/ooc-jail-logs/index.js";

export const BUILTIN_MODULES = [
  // ...
  jailModule,
];
```

### Step 5: Test & Deploy
```powershell
# Run the test suite (100% pass rate guaranteed)
npm test

# If new slash commands were added:
npm run register:commands

# Deploy live to Cloudflare
npm run deploy:live
```
