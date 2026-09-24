# Staff Activity Tracker — saved discussion

Saved September 8, 2026 UTC (September 7 in America/Chicago). The user asked to remember this discussion before going to bed. This document preserves the agreed scope for a later session; it is not an instruction to build, deploy, or monitor overnight.

## Status

- Feasibility and Discord access have been checked. The tracker has NOT been implemented, registered, deployed, or started.
- The user confirmed Damo Bot has Administrator permission in Vital RP. After the user enabled Message Content Intent, read-only API checks confirmed access to transcript embeds and HTML attachments.
- Application ID: `1544164852132618382`; guild ID: `730015674348601384`. The local token's application matched the configured application ID. Do not store tokens or transcript contents in this document.
- The earlier repository audit was read-only. Separate deployment preferences were saved in AGENTS.md. Audit findings, particularly LOA role safety and recovery issues, remain unresolved.

## Agreed scope and sources

Track support and refund tickets only. Exclude player reports and all other ticket types, even though their transcripts share the log channel.

| Source | Discord ID | Verified name / transcript panel |
| --- | --- | --- |
| Support category | `1285590272838729829` | `🎟〡Support Tickets`; panel `Support` |
| Refund category | `1124767760933724170` | `🎟〡Refund Requests`; panel `Refund Requests` |
| Shared transcript channel | `742878979639214122` | `🪵〡ticket-logs` |
| Staff Team role | `743422836223246366` | User says staff always have this role |
| Ticket Tool author observed | `557628352828014614` | Bot author of sampled transcript posts |

Support and refund tickets are open to any staff member to help; claiming is not required. The player-report assignment/triage workflow discussed earlier is outside this feature's scope.

## Attribution rules

- Ticket Owner identifies the requester, who may be a community member or a staff member. Ownership does not establish staff status or handling credit.
- Identify staff by the Staff Team role, not by usernames, transcript message counts, or merely participating in a ticket.
- Exclude bot messages and the ticket owner's own messages from handling credit, including when the owner is staff.
- Record first responders, all staff contributors, and closers separately. Do not infer the resolver solely from who closes or last replies.
- Snapshot staff status when activity is observed. Historical transcripts do not prove past role membership; any historical classification based on current roles must be labeled as such.
- Activity measures do not prove hours worked, ticket quality, or actual resolution.

## Proposed first release (not yet built)

- Live collection scoped to the two configured categories.
- Management-only `/staffactivity` dashboard with overview, individual staff profiles, waiting tickets, and ticket history.
- Distinct tickets helped with, first-response and follow-up times, weekly/monthly participation, and transcript links.
- Waiting view distinguishes tickets with no staff response from tickets where the requester replied after staff.
- LOA context and eligible-day comparisons were proposed; integrate only with clear leave-date semantics and account for existing LOA bugs.
- SQLite Durable Objects as authoritative tracker storage, with durable cursors and deduplication. Optional Sheets export later.
- Historical transcript import after live collection and parsing are verified. No automated discipline or performance judgments.

## Verified data and remaining implementation questions

- Read-only checks sampled recent log posts. Transcript embeds expose `Ticket Owner`, `Ticket Name`, `Panel Name`, `Direct Transcript`, and `Users in transcript`, alongside HTML attachments and link buttons.
- The shared log channel includes other panels; use explicit Support / Refund Requests filtering for historical intake and category IDs for live intake. Reconcile category moves and panel mappings rather than assuming ticket names establish type.
- Multiple transcript saves of the same ticket were observed. Deduplicate by a verified stable ticket/channel identity and individual message IDs; do not count transcript posts as distinct tickets or sum duplicate snapshots. Stable identity extraction still needs verification.
- Support and refund HTML samples use Ticket Tool's generated JavaScript renderer. No complete parser for historical authors, ticket IDs, and timestamps has been implemented or verified. Do not execute untrusted transcript scripts to extract data.
- The API checks verified readable embeds/attachments and the category channel listings, not end-to-end metric correctness.
- Current Worker code handles interactions and cron; it has no Discord Gateway collector. Incremental REST polling was proposed for a first version, with visible freshness and coverage gaps. Polling can miss deleted messages/channels; transcripts may help reconcile them. Immediate event collection would require a Gateway connection.
- Ticket Tool documentation describes a 1,000-message transcript cap. Historical data may be incomplete; verify current documentation during implementation and label coverage.
- Management access policy, reporting windows, historical import cutoff, and any notification thresholds still need final decisions. Do not send scheduled digests or alerts merely because they were suggested.

## Deployment preference

Follow AGENTS.md: after the full suite passes with zero failures, changed Discord command definitions/options may be registered without another confirmation. Registration failures stop a release. Passing tests alone does not request deployment. No deployment was requested as part of saving this plan.
