# Damo Bot Architecture & Developer Guide

Welcome to the **Damo Bot** codebase! Damo Bot is a high-performance Discord bot powered by **Cloudflare Workers** and **Durable Objects with SQLite storage**.

This guide details the system architecture, directory layout, and step-by-step instructions for adding new slash commands, buttons, modals, permissions, and Google Sheets integrations with minimal boilerplate.

---

## 1. Directory Structure

```text
damobot/
├── src/
│   ├── config/                      # Domain-specific configuration constants
│   │   ├── brand.js                 # Logo URL, brand colors, app version
│   │   ├── channels.js              # Default log/audit/LOA channel IDs
│   │   ├── roles.js                 # Authorized Staff Team & Owner role IDs
│   │   └── sheets.js                # Google Spreadsheet IDs and tab names
│   ├── config.js                    # Facade exporting all configs (maintains bump-version compatibility)
│   ├── shared/                      # Reusable shared utilities and services
│   │   ├── permissions.js           # Centralized role verification (Staff + Owner)
│   │   ├── discord.js               # Discord interaction responses, flags, REST client
│   │   ├── components.js            # Components V2 & Embed builders
│   │   ├── googleSheets.js          # Google Sheets OAuth JWT, token caching, row operations
│   │   └── index.js                 # Barrel export for all shared modules
│   ├── router/                      # Central interaction router
│   │   ├── registry.js              # Route tables for commands, components, modals
│   │   ├── dispatch.js              # Interaction dispatcher with error boundary
│   │   └── index.js                 # Router export
│   ├── features/                    # Standalone feature modules
│   │   └── referral/                # /referral command
│   ├── sticky/                      # Sticky messages & StickyBotDO
│   ├── loa/                         # LOA management & StaffLoaDO
│   ├── punishment/                  # Punishment center & PunishmentSequenceDO
│   ├── refund/                      # Refund system & history lookup
│   └── index.js                     # Worker entrypoint (fetch, scheduled, DO exports)
├── scripts/                         # Operational CLI scripts (bump-version, register-commands)
├── test/                            # Node.js test runner suite (100% pass rate)
├── wrangler.jsonc                   # Cloudflare Workers configuration & DO bindings
└── ARCHITECTURE.md                  # This architecture guide
```

---

## 2. Core Architectural Principles

1. **Lean Worker Entrypoint (`src/index.js`)**:
   - `src/index.js` acts strictly as an HTTP gateway: it verifies the Ed25519 signature, handles `PING` (Type 1), delegates all Discord interactions to `src/router/dispatch.js`, forwards cron triggers to `StickyBotDO`, and exports Durable Object classes.
2. **Table-Driven Routing (`src/router/registry.js`)**:
   - Every interaction type is mapped in a clean route table:
     - `COMMAND_ROUTES`: Map command names (`ping`, `sticky`, `refund`) to handler functions.
     - `CONTEXT_MENU_ROUTES`: Map user/message context menu names to handlers.
     - `COMPONENT_PREFIX_ROUTES`: Map button and select menu `custom_id` prefixes to handlers.
     - `MODAL_PREFIX_ROUTES`: Map modal submit `custom_id` prefixes to handlers.
3. **Single Source of Truth for Permissions (`src/shared/permissions.js`)**:
   - All permission checks flow through `hasStaffRole` or `requireStaffRole`. Both the **Staff Team** role (`1078704207139381318`) and the **Owner** role (`743423786275307542`) are granted administrative access automatically.
4. **Standardized Discord Responses (`src/shared/discord.js`)**:
   - Never write raw `{ type: 4, data: { ... } }` JSON in feature handlers. Use `ephemeralTextResponse`, `ephemeralComponentsResponse`, `updateComponentsResponse`, `modalResponse`, or `deferResponse`.
5. **Centralized Google Sheets Service (`src/shared/googleSheets.js`)**:
   - Handles Google Service Account JWT generation, token caching across Worker requests, tab verification/creation, row appending, and cell updates.

---

## 3. How-To Recipes

### Recipe A: Adding a New Slash Command

#### Step 1: Create your feature handler
Create a file, e.g., `src/features/myfeature/command.js`:

```javascript
import {
  ephemeralTextResponse,
  requireStaffRole,
  extractInteractionOptions,
} from "../../shared/index.js";

export async function handleMyFeatureCommand(interaction, env, ctx) {
  // Enforce staff/owner permission if needed
  const authError = requireStaffRole(interaction, env);
  if (authError) return authError;

  // Extract command options
  const options = extractInteractionOptions(interaction);
  const targetUser = options.target;

  return ephemeralTextResponse(`Success! Executed for user: ${targetUser}`);
}
```

#### Step 2: Register in `src/router/registry.js`
Add the command mapping to `COMMAND_ROUTES`:

```javascript
import { handleMyFeatureCommand } from "../features/myfeature/command.js";

export const COMMAND_ROUTES = {
  // ... existing commands
  myfeature: handleMyFeatureCommand,
};
```

#### Step 3: Register in `scripts/register-commands.js`
Add the command definition to `commands` array:

```javascript
{
  name: "myfeature",
  description: "Description of my feature",
  type: 1, // CHAT_INPUT
  options: [
    {
      name: "target",
      description: "Target user",
      type: 6, // USER
      required: true,
    },
  ],
},
```

---

### Recipe B: Adding an Interactive Button

#### Step 1: Define a unique prefix
For example, `mybtn:action:id`.

#### Step 2: Create the component
Use the component builders in `src/shared/components.js`:

```javascript
import { createActionRow, createButton } from "../shared/index.js";

const row = createActionRow([
  createButton({
    custom_id: `mybtn:approve:${recordId}`,
    label: "Approve",
    style: 3, // Success / Green
    emoji: { name: "✅" },
  }),
]);
```

#### Step 3: Add prefix handler in `src/router/registry.js`
Add the prefix to `COMPONENT_PREFIX_ROUTES`:

```javascript
export const COMPONENT_PREFIX_ROUTES = [
  // ... existing prefix routes
  {
    prefix: "mybtn:",
    handler: async (interaction, env, ctx) => {
      const customId = interaction.data.custom_id;
      // Handle button click...
      return ephemeralTextResponse("Button processed!");
    },
  },
];
```

---

### Recipe C: Adding a Modal Form

#### Step 1: Open the modal on a command or button
Return a `modalResponse` from `src/shared/discord.js`:

```javascript
import { modalResponse } from "../shared/index.js";

return modalResponse({
  custom_id: `mymodal:submit:${userId}`,
  title: "My Feature Form",
  components: [
    {
      type: 1, // ActionRow
      components: [
        {
          type: 4, // TextInput
          custom_id: "field_reason",
          label: "Reason",
          style: 2, // Paragraph
          required: true,
          max_length: 500,
        },
      ],
    },
  ],
});
```

#### Step 2: Handle submission in `src/router/registry.js`
Add the prefix to `MODAL_PREFIX_ROUTES`:

```javascript
import { getModalValues, ephemeralTextResponse } from "../shared/index.js";

export const MODAL_PREFIX_ROUTES = [
  // ... existing prefix routes
  {
    prefix: "mymodal:submit:",
    handler: async (interaction, env, ctx) => {
      const values = getModalValues(interaction);
      const reason = values.field_reason;

      return ephemeralTextResponse(`Received: ${reason}`);
    },
  },
];
```

---

### Recipe D: Google Sheets Integration

Use the centralized helper functions in `src/shared/googleSheets.js`:

```javascript
import {
  appendSheetRow,
  readSheetRows,
  ensureSheetTabs,
} from "../shared/index.js";

// 1. Ensure tab exists with correct header columns
await ensureSheetTabs(env, spreadsheetId, [
  { title: "MyTab", headers: ["Timestamp", "User ID", "Action"] }
]);

// 2. Append a new record row
await appendSheetRow(
  env,
  spreadsheetId,
  "MyTab!A:C",
  [new Date().toISOString(), userId, "Created"]
);

// 3. Read rows from sheet
const rows = await readSheetRows(env, spreadsheetId, "MyTab!A:C");
```

---

### Recipe E: Posting to Discord Log Channels

Use `discordFetch` or `postInteractionFollowup` from `src/shared/discord.js`:

```javascript
import { discordFetch } from "../shared/index.js";

await discordFetch(
  env,
  `/channels/${channelId}/messages`,
  {
    method: "POST",
    body: JSON.stringify({
      content: "Log message...",
      embeds: [/* embed objects */],
    }),
  }
);
```

---

## 4. Testing & Deployment Workflow

Always verify that tests pass before deploying:

```powershell
# Run the complete test suite (253 tests)
npm test

# If slash command definitions were modified
npm run register:commands

# Live Cloudflare deployment (automatically bumps version & runs tests)
npm run deploy:live
```
