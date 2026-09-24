# DamoBot Module Architect Rule

This rule applies whenever you are asked to:
- **create a module**
- **add a module**
- **build a new DamoBot feature that would logically be a module** (e.g. OOC Jail Logs, Staff Activity Tracker)
- **convert an existing feature into a module**

---

## 1. MANDATORY Staff-Only Determination Protocol

Whenever a new module or feature request is made, you MUST determine whether the user has specified whether the module is **staff-only** or **community/public-facing**.

1. **If the user has NOT specified it**, you MUST immediately stop and ask:
   > **"Will this be a staff-only module?"**
2. **Strict prohibition**: Do NOT assume the answer. Do NOT start implementing or generating files for the new module until the user answers this question.
3. **If the user ALREADY clearly stated** that the module is staff-only (`staffOnly: true`) or public/community-facing (`staffOnly: false`), do NOT ask again and proceed directly.

---

## 2. Module Architecture Standard

Every module in DamoBot MUST be structured as a self-contained unit under:
`src/modules/<module-id>/`

### A. Module Directory Structure
```text
src/modules/<module-id>/
├── index.js          # Module declaration using defineModule()
├── handlers.js       # Command, component, and modal interaction handlers
├── components.js     # Module-specific Discord components using shared UI builders
├── constants.js      # Custom IDs, action types, internal constants
└── db.js / sheets.js # Storage / database operations (if applicable)
```

### B. Standard `defineModule` Interface
Every module MUST export a default definition via `defineModule`:
```javascript
import { defineModule } from "../../core/module-registry/index.js";

export default defineModule({
  id: "ooc-jail-logs",
  name: "OOC Jail Logs",
  description: "Log and search player OOC jail records.",
  staffOnly: true, // MUST BE EXPLICITLY true OR false
  commands: [
    // Discord command definitions (auto-registered with Discord)
  ],
  handlers: {
    commands: {
      // command_name: handlerFn
    },
    components: [
      // { matches: (id) => boolean, handler: handlerFn }
    ],
    modals: [
      // { matches: (id) => boolean, handler: handlerFn }
    ],
  },
  scheduled: null, // async (event, env, ctx) => void (optional cron trigger)
  durableObjects: {}, // Optional Durable Objects exported by this module
});
```

### C. Registration
All modules MUST be registered in `src/core/module-registry/loader.js`.
Adding a new module requires only:
1. Creating `src/modules/<module-id>/`
2. Importing and adding it to `BUILTIN_MODULES` in `src/core/module-registry/loader.js`.

---

## 3. Shared Systems & UI Rules

1. **Shared Embed System**:
   - Use `createDamoEmbed`, `createSuccessEmbed`, `createErrorEmbed`, and `createWarningEmbed` from `src/shared/embeds/index.js`.
   - Never create independent, unbranded embed builders.
2. **Shared Components**:
   - Use `createPrimaryButton`, `createSecondaryButton`, `createDangerButton`, `createSuccessButton`, and `createActionRow` from `src/shared/components/index.js`.
3. **Global UI Rule**:
   - MUST NOT include any ❌ / X delete or dismiss button that allows users to delete/dismiss an entire message or embed.
4. **Shared Logging Infrastructure**:
   - If the module logs records (like Ban Logs or OOC Jail Logs), reuse `src/shared/logging/` for pagination, search tokenization, date formatting, and log ActionRows.
