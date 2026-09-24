# Damo Bot Agent Guidelines

## Deployment & Automatic Version Incrementing Rule

Whenever the user asks to **push changes**, **deploy to live**, **deploy to Cloudflare**, or asks **what terminal commands to run**, you MUST:
1. Provide the exact, copy-pasteable terminal commands formatted in clean code blocks.
2. **Incrementally update the version number**:
   - Every time an update is pushed to Cloudflare or Git, increment the version number in `src/config.js` (`DAMO_BOT_VERSION`).
   - Use `npm run version:bump` (or `node scripts/bump-version.js`), or use the all-in-one command `npm run deploy:live` which automatically bumps the version, verifies tests, and deploys.
3. Follow this sequence:
   - **Version Bump**: `npm run version:bump` (e.g. `v0.8.0-beta` -> `v0.8.1-beta`)
   - **Verification**: `npm test` (must pass 100%)
   - **Slash Commands**: `npm run register:commands` (if slash commands or options were modified)
   - **Cloudflare Live Deployment**: `npx wrangler deploy` (or `npm run deploy:live`)
   - **Git Version Control**: `git add .`, `git commit -m "release: vX.Y.Z-beta - ..."`, `git push` (if Git repository is configured)
4. If the user asks you to run the deployment command on their behalf, propose/execute `npm run deploy:live` (or bump version -> test -> `npx wrangler deploy`).

## Standing Slash Command Registration Authorization

- After the full test suite passes with zero failures, register updated Discord application commands whenever command definitions or options have changed.
- This registration is already authorized by the user; do not ask for confirmation again. Run `npm run register:commands` before deploying the Worker, and stop the release if registration fails.
- Skip registration when command definitions are unchanged. Passing tests alone does not request a new Worker deployment.

## End of Changes Protocol: Always Ask for Git Upload & Worker Update

At the very end of ANY coding task, completed set of changes, or major milestone, you MUST ALWAYS explicitly ask the user:
1. **"Would you like to upload these changes to Git / GitHub?"**
2. **"Would you like to deploy/update the live Cloudflare Worker?"**

Provide the exact copy-pasteable commands for both actions:

- **Upload to Git / GitHub**:
  ```powershell
  git add .
  git commit -m "release: <summary of changes>"
  git push origin main
  ```

- **Update Cloudflare Worker Live**:
  ```powershell
  npm run deploy:live
  ```
  Explain briefly that `npm run deploy:live` will automatically:
  1. Increment the version number in `src/config.js` (`DAMO_BOT_VERSION`).
  2. Run the full test suite (`npm test`) to guarantee 100% pass rate.
  3. Deploy the updated worker live to Cloudflare (`npx wrangler deploy`).

- **Do Both (Deploy Worker & Push to Git)**:
  ```powershell
  npm run deploy:live
  git add .
  git commit -m "release: update worker and sync repository"
  git push origin main
  ```

## Versioning Rule

- All application versioning is centralized in `src/config.js` (`DAMO_BOT_VERSION`).
- Never hardcode versions across handlers.
- When incrementing the version, use `scripts/bump-version.js` or edit `src/config.js`.

## Global UI Rule: No ❌ / X Delete or Dismiss Controls

From now on, ANY embed, panel, sticky message, preview, confirmation, log, or interactive message created or updated in Damo-Bot MUST NOT include an ❌ / X button or control that deletes or dismisses the entire embed/message for users.
- Treat this as the default behavior across the bot unless the user explicitly asks for a delete button in a specific feature.
- This applies to future suggestion embeds, sticky messages, panels, draft/previews, logs, confirmation messages, interactive embeds, and any other newly created component UI.
- Never automatically add a delete/dismiss X control to embeds just because Discord supports one or because another feature currently uses one.
- Published messages (such as suggestions) must never allow users to delete their post after submission. Normal Discord staff permissions (Manage Messages) remain untouched.

## DamoBot Module Architect Rule

Whenever you are asked to **create a module**, **add a module**, **build a new DamoBot feature that would logically be a module** (e.g. OOC Jail Logs, Staff Activity Tracker), or **convert an existing feature into a module**:

1. **Mandatory Staff-Only Check**:
   - You MUST determine whether the user has specified whether the module is staff-only.
   - If NOT specified, you MUST stop immediately and ask:
     > **"Will this be a staff-only module?"**
   - Do NOT assume the answer.
   - Do NOT start implementing the module until the user answers that question.
   - If the user already clearly stated that the module is staff-only (`staffOnly: true`) or public/community-facing (`staffOnly: false`), do not ask again.

2. **Standard Module Architecture**:
   - Every module must live in its own directory: `src/modules/<module-id>/`.
   - Every module must export a default `defineModule({ id, name, description, staffOnly, commands, handlers, ... })`.
   - Register the module in `src/core/module-registry/loader.js`.
   - Use the shared DamoBot UI system (`src/shared/embeds/`, `src/shared/components/`).
   - Use shared logging utilities (`src/shared/logging/`) for log-based modules.
   - Strictly obey the Global UI Rule: No ❌ / X delete or dismiss controls.

## Architecture Reference

- **Planned Staff Activity Tracker**: Read `STAFF_ACTIVITY_PLAN.md` before continuing this feature. It records the agreed support/refund-only scope, verified Discord IDs, attribution rules, and remaining work. The tracker is not implemented; saving the plan did not authorize overnight work or deployment.

- **Platform**: Cloudflare Workers + SQLite Durable Objects (`StickyBotDO` & `StaffLoaDO`).
- **Discord UI**: Components V2 (`Container`, `Section`, `TextDisplay`, `Thumbnail`, `Separator`, `ActionRow`, `Button`).
- **Branding**: Vital RP logo (`VITAL_RP_LOGO_URL` in `src/config.js`) via header/author icon and native embed footer icon.
- **Module Architecture**: Documented in `docs/MODULES.md`.

