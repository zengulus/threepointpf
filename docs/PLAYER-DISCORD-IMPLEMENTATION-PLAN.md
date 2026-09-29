# Player character access and Discord rolls: implementation plan

Status: implementation in progress; this document remains the target scope.
Prepared: 2026-09-30.

Progress log (2026-09-30): the hosted checkout now has an initial access slice:
explicit character assignments, filtered character routes, a player character
picker/empty state, a corrected item PUT route, and raw-password server verification
for login. Site version 276 deployed successfully at the existing URL from source
commit `5703bb280469197a4b78f64ff04676e1c5fe0ccd`. The Worker build passes.
Local D1 HTTP checks covered two players, a DM, assignment denial, revision
conflicts, and hash-replay rejection. Live unauthenticated checks returned 401 for
characters and assignments and 404 for the retired challenge endpoint. Authenticated
live behavior, campaign-specific access, migration backfill, and all later stages
remain unverified or unfinished; this does not mark Stage A complete.

Progress log (later on 2026-09-30): Site version 277 deployed from source commit
`b7d0d6ea82cdeef6fd8ae716e81d0ce6fb01e3d5`. Hosted edits now autosave
after 700 ms through a serialized queue, and a roll waits for a successful save
when edits are pending. A browser test confirmed an edit survived reload; a
two-device test confirmed a `409` preserved both the first saved state and the
second device's unsaved draft. The local test database was removed from tracked
Site source and `work/` is ignored. Stage B is still incomplete until the hosted
roll execution boundary uses the acknowledged revision, and stages C–F remain.

Progress log (later on 2026-09-30): Site version 278 deployed from source commit
`8ecc18028b7fa1e8d212fef82dae293940946976`. A Site secret now protects
campaign-bound AES-GCM encrypted Discord webhook URLs. The DM Users screen can
verify and connect one channel per campaign, replace/disconnect it, and explicitly
send a rate-limited test message. Player reads receive status only. Validation
covered URL restrictions, encryption/decryption, fake Discord inspection, local
D1 migrations, authenticated permission paths, and the DM screen. No real webhook
was connected or test message sent. Stage C remains incomplete until a DM connects
an approved channel and the hosted roll delivery path is integrated; OAuth channel
selection remains optional refinement rather than a prerequisite.

Progress log (later on 2026-09-30): Site version 279 deployed from source commit
`5b2fcb4bc38b8dbf86d1f9e991779b0a44bcec81`. A public-exposure review
confirmed anonymous API requests are denied and the live account database is
already initialized. The public GitHub `main` branch has no tracked secret-named
files, and production dependency audits reported no known advisories in either
checkout. Hosted mode now hides the legacy browser webhook editor, does not load
or post with its browser-stored webhook, and clears the legacy stored credential
when the sheet opens. The static demo keeps its browser-only integration.
The public Site is **not yet suitable for trusted campaign rolls**: hosted dice
outcomes still originate in the browser, with no immutable server roll event or
reliable server Discord delivery. Campaign-scoped DM membership and migration
backfill are also outstanding. Treat deployment as limited-access testing until
Stages A, D, and E are finished and verified.

Progress log (later on 2026-09-30): Site version 280 deployed from source commit
`2c57c0caa8b69021c539274ead5910e1538e4e26`. Additive migration `0004`
created `roll_events` and `discord_deliveries` in local and production D1. The
new authenticated `POST /api/rolls` accepts a strict versioned action request
for the six existing shared roll families, checks access and saved revision,
rebuilds the plan on the server, uses unbiased cryptographic faces, and commits
the immutable result plus a connection-pinned delivery row in one D1 batch.
`GET /api/rolls/:id` retrieves an authorized result. Local D1 HTTP tests with
a DM and two players verified direct denial, forged-face rejection, concurrent
identical requests yielding one event and one delivery row, request-ID mismatch,
retry recovery after a later edit, and stale-revision rejection. The Worker
build passed, production deployment succeeded, and live anonymous POST returned
401. The hosted UI still uses browser rolls; no Discord outbox runner or send
path exists yet. Stage D and Stage E remain incomplete.

Progress log (later on 2026-09-30): Site version 281 deployed from source commit
`2525b19c8111ecc767118960dd6f08ec1888a13c`. The server now pins delivery
to the campaign connection version, formats a bounded mention-safe payload from
the stored roll, claims one send with an atomic lease, and records Discord's
message ID only after `wait=true` confirmation. A 429 retains a due retry;
ambiguous timeout, 5xx, or expired lease is `delivery_unknown` and requires
explicit duplicate-risk confirmation before resend. Connection replacement or
disconnect cancels queued work. `waitUntil` starts a best-effort immediate send;
an authenticated bounded drain runs every 30 seconds while the hosted app is
open. No durable scheduled runner is configured, so automatic recovery pauses
when everyone closes the app. Miniflare D1 plus fake Discord tests covered
confirmed send/no resend, 429, timeout, expired lease, concurrent claim, 404,
and connection pinning; real local Worker/D1 routes also passed. The Worker
build and production deployment succeeded. Production has no connected Discord
webhook, so no real message was sent. Stage E still needs hosted UI status and
history, integration of every roll family, and integrated authorized-channel
verification before it is complete.

Progress log (later on 2026-09-30): Site version 282 deployed from source
commit `f97c41e7fff36cb2beb5c926995375a943ed9c30`. Additive migrations
`0005` and `0006` elected the oldest existing DM as site administrator,
backfilled campaign memberships from existing DMs and explicit assignments,
and added per-session active role. Co-DM accounts can switch between DM and
Player modes; Player mode enforces ordinary character and roll permissions on
the server. The site now has campaign membership management, scoped assignment
and Discord controls, player creation with server-granted ownership, and
campaign-scoped character listing. Local migration rehearsal preserved
snapshots, revisions, and foreign keys. Fresh local Worker/D1 tests covered
cross-campaign denial, Co-DM role switching on two sessions, player creation
and revocation, recorded-roll permission, idempotency, and stale revisions.
The Worker build and production deployment passed. Production account fields
were unchanged after migration; there is one site administrator and still no
campaigns, characters, rolls, or Discord connection. No live authenticated
player or Co-DM session has been exercised against production, and the hosted
sheet still uses browser rolls, so this is not a trusted-play launch.

Progress log (later on 2026-09-30): Site version 283 deployed from source
commit `cbe64091c3301d2c8fe23a48ae03f4d76b25831d`. The hosted sheet now
sends ordinary save, skill, maneuver, attack, damage, and initiative actions to
the authoritative roll route after saving. It displays the stored plan/faces,
roll reference, and delivery state; pending delivery is polled while open and
retry is separate from rolling again. Ambiguous delivery requires explicit
duplicate-risk confirmation. Synthetic or unsupported plans fail visibly in
hosted mode. Focused client tests, the Worker build, migration rehearsal, and
fake-Discord delivery tests passed. Player selection is remembered per account.
The Site has no connected Discord channel, so no live message was sent. Spell,
ability, recharge, bonus-dice, and other contextual actions still need typed
server intents; resource spending is not yet atomic with rolls. A live player
journey and mobile/accessibility QA remain outstanding. Continue to treat this
as a limited-access testing release, not a trusted-play launch.

Progress log (later on 2026-09-30): Site version 284 deployed from source
commit `c44faaf913329f3e8ca75d824691c750670237ca`. Authorized `GET /api/rolls`
returns the latest 20 stored results for a character. The hosted sheet lists
them after reload, refreshes their delivery status while open, and exposes
per-roll retry. A fresh local Worker/D1 smoke run verified assigned-player
history access and anonymous/unassigned-player denial, alongside the existing
roll concurrency and revision checks. The Site build and deployment passed.
Older-history pagination and the remaining roll families/resource atomicity
are still open. No real Discord channel is connected.

Progress log (later on 2026-09-30): one user-approved Discord test roll was
performed against the local Worker/D1 test campaign using an approved webhook.
The Worker recorded a Fortitude save totaling 18 against DC 17; Discord
confirmed one message ID and the outbox reached `sent`. The local test
connection was then removed. This exercised the real Discord transport but
not a production campaign login. The test exposed that the Worker runtime
rejects `redirect: "error"` on an outbound request even for a direct 200.
Site version 286 deployed from source commit
`72dd243e7d2162d7e03bdc3cfc741574b3da99e0` with manual redirect handling
(which does not follow redirects) for channel inspection and delivery. The
shared Discord formatter now puts roll type first, a green/red total-versus-
defense result second, then dice, modifier, and reference below. Formatter,
connection, fake-delivery tests and the Worker build passed. No second live
Discord message was sent to verify the new layout. The production Site still
has no campaign, character, or connected channel; a full production player
journey and remaining roll families are open.

## 1. Objective and agreed direction

Players primarily use the website, with completed rolls sent to Discord. The user
explicitly selected this direction over Discord commands or a combined bot UI.
Extend the existing sheet, rules engine, and hosted Site; do not replace them.

Target journey:

1. A DM creates a player account, assigns a character, and connects a campaign's
   Discord channel once.
2. The player signs in on a phone or computer and opens **My characters**.
3. Valid edits save automatically, with visible saving, saved, conflict, and
   offline states. Character files remain available for import/export.
4. The player clicks an attack, damage, save, skill, initiative, or other
   supported roll. Hosted execution uses the current saved character revision.
5. The server records one result. The sheet's existing dice renderer animates
   that result, and Discord receives the same result.
6. Discord delivery failures never lose or reroll the result. The player sees
   delivery status and can recover safely.

Defaults proposed here are implementation decisions, not additional user answers:
one active channel per campaign; existing username/password accounts initially;
DM-managed character assignment; no player access to webhook credentials;
campaign roles enforced on the server; no automatic roll fallback when offline.

## 2. Evidence and checkout boundaries

Inspected locally on the date above:

| Area | Existing implementation | Implication |
| --- | --- | --- |
| Sheet | `apps/web/src/components/app-shell.tsx`, `character-sheet-view.tsx`, `summary-sheet.tsx`, `roll-actions.tsx` | Extend existing controls and visual language. |
| State | `apps/web/src/hooks/useCharacterSheet.ts` | Central integration point for editing, saving, and rolling; avoid multiple independent sheet controllers. |
| Storage | `packages/shared/src/index.ts`, `apps/web/src/lib/repository.ts` | Browser and HTTP repositories already exist; HTTP revisions currently live privately in the repository. |
| Roll contracts | `packages/shared/src/index.ts` | Existing `RollPlanRequest`, `ActionPlanRequest`, validators, `createCharacterRollPlan`, and `createCharacterActionPlan` are reusable. |
| Resolution | `packages/dice/src/index.ts`, `packages/rules-core/src/` | Reuse deterministic resolution; do not reimplement game rules in route handlers or Discord formatting. |
| Presentation | `apps/web/src/hooks/useDicePresentation.ts`, `lib/dice-sequence.ts`, `lib/dice-3d.ts` | Already presents resolved faces; physics must remain presentation only. |
| Discord | `apps/web/src/lib/discord-roll-publishing.ts`, `components/discord-settings.tsx`, `hooks/useDiscordRollSettings.ts` | Currently browser-local webhook settings and browser-originated posting. |
| Hosted backend | `work/site-source/app/api/`, `work/site-source/lib/accounts.ts`, `work/site-source/db/schema.ts` | Separate nested Git checkout with cookie sessions and D1 storage. |
| Hosted shell/build | `work/site-source/app/page.tsx`, `work/site-source/scripts/build-app.mjs` | Shell embeds `/campaign/index.html`; build packages the hosted-mode sheet and Worker. |

At initial inspection, the hosted character handlers required a session but did
not filter characters by ownership or campaign membership. Version 282 added
server-enforced campaign membership and Co-DM session modes. The characters table has
`updated_by`, which is last editor metadata, not ownership. These are local source
findings, not proof of the deployed version's behavior.

Sites metadata was read in the preceding investigation: existing project ID
`appgprj_6ab608a3a18881918d5013cb366a584b`, public Site audience, live URL
`https://threepointpf-character-sheet.nathmcdm.chatgpt.site`, latest version 275 at
that time. The progress log above records subsequent versions. Re-read current
metadata before implementation or deployment.
Public Site access does not authorize access to campaign data.

Important source mismatch: root `.openai/hosting.json` declares static `dist`,
while the nested hosted checkout declares D1 `DB`. Do not publish the root static
artifact over the authenticated Worker. The nested checkout is tracked as a Git
entry and was already dirty, primarily with generated build output. Preserve it.

### Required first steps for the implementation owner

- Read applicable `AGENTS.md` files and current Sites skills before editing.
- Record root and hosted checkout branches, commit SHAs, status, and differences.
  Determine whether other work is active. Do not reset, clean, or copy whole
  directories over existing changes.
- For Site work, open the existing Site through the current Sites source workflow
  before editing. Reconcile current remote source with local changes; do not
  assume this inspected nested checkout is the latest publication.
- Establish the source ownership convention: shared packages and sheet changes
  originate in the main repo; host routes, schema, migrations, and hosting build
  changes originate in the opened Site checkout. Document the precise transfer
  command/process for the duplicated shared code and verify parity before build.
- Audit actual route registration. The inspected collection route exports a PUT
  implementation taking an `id` parameter, whereas the item route visibly exports
  GET. Confirm and repair `PUT /api/characters/:id` registration if still needed.
- Record verification results and implementation decisions in a handoff section
  of this document or a linked implementation log. Do not mark planned work done
  merely because mock client tests pass.

## 3. Scope and invariants

Included: player assignment, campaign authorization, hosted autosave, DM-owned
Discord connection, server-resolved recorded rolls, delivery recovery, mobile
play view, migration, meaningful tests, and eventual Site publication.

Excluded: Discord slash commands, a Gateway bot, TTS activation, VTT/maps/tokens,
general Pathfinder legality enforcement, new rules semantics, and forced Discord
login. Keep TTS explicitly deferred under `docs/open-decisions.md`.

Invariants:

- `CharacterInput` remains portable authored/runtime rules state. Account roles,
  ownership, revision tokens, Discord configuration, and delivery state stay out
  of character exports and the rules engine.
- Browser/demo mode continues to function independently on GitHub Pages.
- Hosted authorization is enforced on every read and mutation, not just in UI.
- A Co-DM may switch the authenticated session between DM and Player modes.
  Player mode has ordinary player restrictions, including for character and
  roll reads; possession of the Co-DM account role alone does not bypass them.
- Client requests describe actions; clients cannot supply authoritative dice
  faces, totals, modifiers, actor identity, arbitrary plans, or webhook URLs.
- A recorded roll is immutable. Delivery retries do not recompute or reroll it.
- Saving or rolling never silently overwrites another device's newer revision.
- Existing critical policy, damage terms, natural-face semantics, and explicit
  target-defense behavior are preserved, even where they differ from other games.
- Server-resolved means reproducible against saved state, not proof of legal
  character construction. Manual/homebrew state and declared target defenses
  remain supported and must not be described as independently verified.

## 4. Data model and migration

Use additive D1 migrations. Follow the installed Sites persistence/SQLite guides
and the actual supported transactional APIs; do not assume a long-lived SQL
transaction can span an HTTP request to Discord.

Proposed tables (adapt naming to established conventions):

| Table | Essential fields and constraints |
| --- | --- |
| `campaigns` | ID, name, created timestamp; reference existing character campaign IDs. |
| `campaign_members` | Campaign ID, account ID, role (`dm`/`player`/`co_dm`), unique pair. A Co-DM membership supports DM management only while that session is in DM mode. |
| `character_access` | Character ID, account ID, permission (`owner`/`editor` if both are needed), unique pair. Start with one assigned player owner plus campaign DM access. |
| `sessions` | Keep an active DM or Player mode for Co-DMs. Other account roles remain fixed; a new Co-DM session starts in Player mode. |
| `campaign_discord_connections` | Campaign ID unique, connection ID/version, channel/guild IDs and display names when available, encrypted webhook material, enabled state, configuring actor, timestamps. |
| `roll_events` | Server ID, actor/campaign/character IDs, character revision, client request ID, canonical request hash, rules/catalog version, immutable request/plan/result and presentation labels, created timestamp. Unique `(actor_id, client_request_id)`. |
| `discord_deliveries` | Roll ID unique for the initial one-channel policy, connection version, state, attempts, next attempt time, lease token/expiry, Discord message ID when confirmed, safe error code, timestamps. |
| OAuth state storage, if used | Hashed single-use state, actor/session binding, campaign, expiration; bounded cleanup. |

Use foreign keys and indexes for membership checks, assignment lookup, roll
history pagination, and pending-delivery selection. Bound request and snapshot
sizes; do not allow unbounded roll histories in a single response.

Migration procedure:

1. Back up existing records using the supported database export/backup path.
2. Create campaigns for distinct existing campaign IDs. Inspect inconsistent or
   missing IDs rather than assigning records to a guessed real campaign.
3. Establish initial DM membership from existing DM accounts under a documented
   migration rule. Existing players must not automatically gain DM privileges.
4. Keep existing characters available to the DM for explicit assignment. Never
   infer ownership from `updated_by`, character name, or a browser selection.
5. Provide an unassigned-characters view so migration cannot silently strand data.
6. Validate counts, referential integrity, saved snapshots, and revision continuity
   before enabling player restrictions and the new player landing page together.

Initial accounts may retain the current site-level DM role for account management;
campaign actions must use campaign membership. Explicitly document any site-admin
override, and test that ordinary players cannot obtain it through request fields.

## 5. API contracts

Add strict, versioned request/response schemas in the shared package where both
client and server consume them. Keep existing Character API compatibility and
update `docs/character-api.md`; add a separate hosted roll API document.

| Route (proposed) | Behavior |
| --- | --- |
| `GET /api/characters` | Only accessible summaries; include safe assignment/campaign metadata outside `CharacterInput` where needed. |
| `GET/PUT /api/characters/:id` | Authorize per character; enforce revision on update; create with validated campaign membership and server-controlled assignment. |
| `GET /api/campaigns` | Current account's campaigns and permitted actions. |
| `PUT /api/characters/:id/assignment` | Campaign DM only; assignee must belong to that campaign. |
| `GET /api/campaigns/:id/discord` | Safe connection status; never return the credential. |
| `PUT/DELETE /api/campaigns/:id/discord` | DM-only connect/replace/disconnect. Replacement input must be write-only. |
| `POST /api/campaigns/:id/discord/test` | Explicit DM-triggered test message; rate limited. |
| `POST /api/rolls` | Authenticate, authorize, check saved revision, generate and persist a result plus delivery work. |
| `GET /api/rolls/:id` | Authorized stored result and delivery status; supports response-loss recovery. |
| `GET /api/characters/:id/rolls?cursor=...` | Bounded history for authorized viewers. |
| `POST /api/rolls/:id/discord/retry` | Authorize and retry the existing delivery only when its state permits. |

Recommended roll request shape:

```ts
type HostedRollRequest = {
  clientRequestId: string; // Fresh UUID per intentional action; stable on retry.
  characterId: string;
  expectedRevision: string | number;
  action: /* Strict discriminated action schema based on existing requests */;
};
```

Return a server-generated roll ID, canonical plan/result, source revision, actor
and character display labels, timestamp, and delivery state. Freeze response data
for presentation. For a multi-step action, use one parent request ID and stable
step identities; retrying the parent must not repeat already recorded steps.

Use existing error envelope conventions. Include machine-readable conflict,
rate-limit, and delivery codes as needed. Apply same-origin/CSRF controls to
cookie-authenticated mutations, strict input limits, and per-actor/campaign
abuse limits. Adopt a consistent non-disclosure policy for inaccessible record
IDs, such as 404; distinguish it from a permitted user's unsupported operation.

Do not accept a new campaign ID inside a character snapshot as permission to move
a character. Campaign moves, account changes, and assignment changes need their
own authorization checks. Clearing or replacing a Discord connection is DM-only.

## 6. Implementation stages and acceptance gates

### Stage A — Ownership and reliable character access

Implement migration, centralized server authorization helpers, filtered listing,
read/write enforcement, and DM assignment controls. A player may create/import
their own character only in a campaign they belong to; the server sets ownership.
Preserve DM access to all characters in their campaign. Use empty states instead
of silently creating or opening a sample when a hosted player has no characters.

Acceptance:

- Player A cannot list, read, change, roll for, or reassign Player B's character
  using direct API calls; changing path/body IDs does not bypass checks.
- Campaign DMs can assign only campaign members and cannot act across unrelated
  campaigns unless explicitly authorized as a site administrator.
- A Co-DM's Player mode cannot list, read, edit, roll, assign, or manage
  unassigned campaign characters, while DM mode can manage its own campaign.
  Switching one session does not silently switch another device.
- A newly assigned character appears on another device after sign-in/refresh.
- Existing character exports import without account or Discord dependencies.
- Existing records remain accessible to an authorized DM after migration.

### Stage B — Autosave and a revision-aware roll boundary

Extend the repository/controller boundary so the roll executor can obtain the
revision acknowledged by the latest successful save without placing it in
`CharacterInput`. Add a per-character serialized save queue with a short debounce
(start around 700 ms), coalescing intermediate valid edits.

Track edit generation separately from acknowledged generation. A response for an
older save must not replace newer in-memory edits. Invalid form drafts retain
the last valid character and must not accidentally trigger a roll using stale
values the player believes they changed.

Before a hosted roll, flush valid pending edits, await acknowledgment, then send
that exact revision. If a new edit arrives during the flush, either include it
through the serialized queue or freeze an explicitly identified action snapshot;
do not mix plan state and saved revision. A 409 pauses execution and presents
reload/review or export-local-copy recovery; never silently force overwrite.

On character switching, logout, or account changes, isolate queues by character
and account, clear sensitive session caches, and prevent late responses from
updating the next account's sheet. Do not depend on unload network calls for saves.
Do not introduce persisted offline queues without a separate recovery design.

Acceptance:

- Rapid edits result in the final state being saved, even with reordered network
  responses or slow requests.
- Two devices editing one character produce a visible conflict, not lost changes.
- Clicking Roll while saving waits, then uses the acknowledged revision.
- Offline or expired sessions preserve the visible draft, explain that it is
  unsaved, and do not silently send a local roll as a hosted result.
- Existing manual Save remains usable; browser/demo persistence still works.

### Stage C — One campaign Discord connection

Start with a DM-only, write-only webhook configuration saved on the server. This
provides the complete product without depending on a Discord application setup.
The preferred later refinement is **Connect Discord**, using OAuth2
`webhook.incoming` so the DM selects a channel in Discord. OAuth client creation,
client secret, and exact redirect URI are external prerequisites; do not invent
them or make them blockers for the secure manual setup.

Store webhook credentials encrypted with a server-managed secret; configure
secrets through Sites, never frontend environment variables, committed files,
or logs. Support versioned keys/rotation and a disconnected state when a required
secret is unavailable. Validate allowed HTTPS Discord webhook hosts and exact
path structure; reject embedded credentials, unexpected ports and arbitrary
redirects. Construct delivery query parameters server-side. Redact tokens from
errors, telemetry, and request logging.

OAuth refinement requires single-use expiring state bound to the current DM
session and campaign, server-side code exchange, callback role revalidation,
and safe cancellation. Avoid extra scopes or storing unused OAuth access tokens.

Hosted players see only channel/status metadata. Remove hosted browser webhook
posting and credential input. Preserve the existing optional browser/demo feature
with its local-storage explanation; do not silently upload previously saved
browser webhook credentials or automatically turn it on.

Acceptance:

- One DM setup enables the assigned players across browsers and devices.
- Players cannot obtain, replace, test, or disconnect the webhook via API calls.
- No secret appears in bundles, API reads, exports, snapshots, or log output.
- Failed setup preserves the prior working connection until replacement succeeds.
- Automated tests use a fake Discord transport. A real test message requires an
  explicitly authorized destination/action; deployment alone is not permission
  to post test messages into a live channel.

### Stage D — Authoritative, immutable hosted rolls

Introduce a roll execution boundary used by the sheet: a local implementation
for browser/demo mode and an HTTP implementation for hosted mode. Reuse existing
plan builders and `resolveRollPlan`; never accept `ResolveRollRequest` with
client-provided plans/faces as the authoritative hosted request contract.

Server flow:

1. Validate session, request, permission, and current character revision.
2. Check for an existing actor/request-ID pair; verify the canonical request
   hash matches. Return the stored result on a matching retry. Revalidate current
   access, but do not require today's revision to equal a completed event's old
   revision just to recover that authorized event.
3. Reconstruct the plan from saved state and the shared catalog/rules version.
4. Generate faces with Worker-compatible cryptographic randomness and unbiased
   integer sampling. Inject a deterministic provider only in tests.
5. Atomically commit the immutable roll, any applicable resource mutation, and
   delivery row. Guard the character revision at commit time, including when the
   roll itself does not change character state. Discard an uncommitted generated
   result on conflict; never present or publish it.
6. Return the committed result promptly. Discord latency or failure must not
   invalidate a successful game action.

Design the SQL batch/transaction and uniqueness guards before implementation;
test concurrent identical requests against actual D1-compatible storage. A losing
request must read the winning event, not return its own discarded random faces.

Inventory every current roll-producing action before wiring this boundary:
attacks, attack sequences, normal/critical damage, saves, skills, maneuvers,
initiative, spell damage, ability-generated plans, and recharge rolls where
supported. Existing `RollPlanRequest` covers only some families. Add typed action
intents and source IDs for the rest; do not let them bypass server execution.
Resource/slot costs and resulting state changes must commit once with the event.
Standalone non-roll state changes may remain in the revision-aware save flow.

Acceptance:

- Known face fixtures produce identical browser/server results, including
  critical damage riders and natural-face outcomes.
- Forged faces, totals, arbitrary plans, unknown action IDs, stale revisions,
  and unsupported target-defense combinations fail before publication.
- Concurrent duplicate submissions return one persisted event and spend a
  resource at most once. A reused request ID with different content conflicts.
- Lost HTTP responses recover the same result after retry/reload.
- The existing 3D and reduced-motion displays show exactly the server faces.

### Stage E — Durable Discord delivery and recovery

Extract a runtime-neutral formatter shared by browser and server; avoid importing
DOM/UI code into the Worker. Render character, action, dice, modifiers, total,
optional declared defense/outcome, and a short stable roll reference. Disable
mentions using `allowed_mentions: { parse: [] }`, handle user-authored Markdown,
and enforce Discord content/embed limits. Do not disclose notes or full snapshots.

Delivery states: `pending`, `sending`, `sent`, `retryable_failed`,
`permanent_failed`, `delivery_unknown`, and `cancelled` as needed. Claim jobs using
atomic leases so simultaneous clients/workers cannot send the same job concurrently.
Bind pending deliveries to a connection version: do not silently redirect old
rolls into a newly selected channel after a DM replaces the connection.

Use `wait=true` and store Discord's returned message ID on confirmed success.
Respect `429` retry timing; bound retry attempts and backoff. Invalid/deleted
webhooks require DM repair. Disconnect should cancel queued sends, not erase rolls.

Important limitation: ordinary webhook execution has no general exactly-once
guarantee. If Discord accepted a message but the connection timed out before its
ID was recorded, blind retry can duplicate it. Record `delivery_unknown`, show a
clear warning before a manual resend, and retain a roll reference to identify
duplicates. Never promise duplicate-free delivery across ambiguous failures.

Choose and document a supported delivery runner before claiming background
reliability. A persisted outbox plus `waitUntil` is not a durable job scheduler.
Prefer a supported queue/scheduled Worker mechanism if Sites supports it. If it
does not, use authenticated bounded drains during active app use plus explicit
retry, and state that automatic recovery pauses while the app is closed. Do not
create recurring Codex tasks as an implicit application job queue.

Acceptance:

- Rate limiting, transport errors, invalid webhook, crash after claim, expired
  lease, and concurrent retry have tested state transitions.
- A failed delivery preserves the roll and character/resource changes.
- Confirmed `sent` deliveries are not resent on refresh, double click, or retry.
- Ambiguous sends are visibly distinct from known failures.
- Players can recover only deliveries for rolls they are permitted to access;
  connection repair remains DM-only.

### Stage F — Focused player play view

Add **My characters** with meaningful empty/loading/error states, a remembered
selection scoped to the signed-in account, and DM assignment controls. Make play
controls the first useful screen: HP/resources, attacks/damage, saves, initiative,
and accessible skill selection. Keep current detailed editors reachable through
an explicit edit mode or existing tabs; do not delete expert/homebrew capabilities.

Show campaign channel state near rolling controls and delivery status in the
result/history. Distinguish **Retry sending** from **Roll again**. Support keyboard
activation, touch targets, reduced motion, and readable mobile layouts. Preserve
the site's existing theme and dice settings. Do not add a marketing landing page.

Acceptance:

- A returning player can open their character and roll without visiting Settings.
- At approximately 390 px and desktop widths, primary controls do not clip or
  require horizontal scrolling; keyboard focus and 200% text remain usable.
- No hosted UI advertises a roll as sent before confirmed delivery.
- A renderer failure still exposes the recorded result and delivery state.

## 7. Agent work packages and dependencies

This section assigns future work; writing this document does not start agents.
One integration owner controls the Site checkout, migrations, source transfer,
secrets, packaging, and publication. Never let multiple agents publish the Site.

| Package | Ownership | Dependencies | Required handoff |
| --- | --- | --- | --- |
| A: Access/data | Host auth helpers, schema/migrations, character/assignment routes | Source reconciliation | Migration SQL, permissions matrix, real backend tests. |
| B: Save/transport | Shared repository contracts, sheet save queue, local/HTTP execution adapters | Shared contract agreement; A | Revision API, race tests, list of all roll entry points. |
| C: Roll service | Hosted roll schemas, server plan/resolution service, immutable events | A and B contract | Concurrency/resource atomicity tests, fixtures, limits. |
| D: Discord service | Connection API, safe formatter, outbox runner/status | A; event contract with C | Secret setup instructions, failure matrix, explicit runner guarantees. |
| E: Player UI | My characters, assignments UI, play view, statuses | Stable A/B/C/D contracts; mocks allowed early | Mobile/keyboard verification, backend-integrated journey tests. |
| F: Integration/release | Source parity, docs, migration rehearsal, build and Sites release | All | Exact commits, checks, deployment status, rollback record. |

Freeze types before parallel implementation. Coordinate changes to shared
`index.ts`, `useCharacterSheet.ts`, `app-shell.tsx`, schema and migration files;
appoint one editor per overlapping file. Bounded agents can return patches for
the integration owner to apply to the Site; they must not independently open or
publish it. Every handoff lists changed files, tests actually run, assumptions,
remaining work, and any externally blocked setup.

Suggested merge sequence: access/migration -> shared contracts and save boundary
-> recorded roll service -> Discord connection/delivery -> player UI -> release.
Contract tests and UI mocks may proceed in parallel after the contracts settle.

## 8. Verification strategy

Run meaningful tests for changed behavior, not a second copy of implementation.
Reuse these existing suites where relevant:

- `tests/http-character-repository.test.ts`
- `tests/discord-roll-publishing.test.ts`
- `tests/roll-outcomes.test.ts`, `damage-initiative-plans.test.ts`,
  `contextual-actions.test.ts`, `ability-resource-persistence.test.ts`
- `tests/dice-presentation.test.ts`, `dice-sequence.test.ts`
- `tests/e2e/hosted-character-api.spec.ts`, `settings-discord.spec.ts`,
  `play-loop.spec.ts`, `character-sheet.spec.ts`

The existing hosted character E2E test intercepts API requests. It verifies the
client contract, not authentication, database authorization, migration, or
transactional behavior. Add a real local Worker/D1 test harness with seeded DM,
two players, two campaigns, and an injected fake Discord transport. Include
direct HTTP attacks and concurrent requests outside the browser UI.

Essential integrated journeys:

1. DM assigns imported character; player logs in on a fresh browser and sees it.
2. Player edits HP, waits for save, refreshes, and retains state.
3. A second device conflicts; neither version silently overwrites the other.
4. Player rolls; stored event, displayed dice, and captured Discord payload match.
5. Response loss and repeated submission recover one roll and one resource spend.
6. Discord 429 recovers without reroll; ambiguous timeout is not blindly resent.
7. Logout/login as a different player exposes no prior player's cached sheet.
8. Browser demo still creates/imports/exports/saves and rolls without the API.

Repository commands available at planning time:

```sh
corepack pnpm test
corepack pnpm build
corepack pnpm build:demo
corepack pnpm check:demo
corepack pnpm test:e2e
corepack pnpm --filter @threepointpf/web build:hosted
corepack pnpm test:e2e:hosted
```

Select appropriate subsets during development. Build the intended mode before
running its E2E suite; current Playwright uses a preview server on port 4173 with
reuse enabled, so ensure an old demo server is not mistaken for hosted mode.
Add/document separate real-backend test commands. Follow the opened Site's own
build workflow for its Worker; the root static build does not verify deployment.

## 9. Rollout, rollback, and completion

The plan was originally prepared as a documentation-only handoff. The progress
log above records later authorized implementation and deployment. Agents should
continue from that recorded state, verify the current Site source and database,
and avoid repeating completed migrations or sending a live Discord test message
without an approved destination.

During a later authorized implementation:

1. Reconcile source, establish backups, and rehearse additive migration on a copy
   of representative data. Record pre/post counts and permission behavior.
2. Deploy compatible backend changes before enabling dependent UI. Avoid a window
   where unassigned records disappear without DM recovery. Do not leave known
   unrestricted access as the rollback strategy.
3. Test with designated accounts and a fake transport locally. For real delivery,
   obtain an explicitly authorized test channel and test message action.
4. Configure secrets through Sites and connect the campaign. If credentials are
   missing, ship a truthful disconnected setup state rather than fake success.
5. Verify root/shared source parity with the hosted build. Follow current Sites
   source opening, checks, packaging, save/deploy, and terminal deployment-status
   verification. Preserve the current public audience and existing project ID.
6. Record deployed source SHA/version, migration version, environment variable
   names only, checks, and any remaining operational limitations.

Rollback: disable Discord sends without deleting events; preserve additive tables
and data. Use a schema-compatible previous application version only if it retains
required authorization. Prefer a read-only maintenance state to restoring an
insecure handler. Resolve pending/unknown deliveries explicitly after rollback;
do not replay the whole outbox indiscriminately.

Definition of done:

- [ ] Existing records migrated and assignable without lost snapshots.
- [ ] Server-enforced player/campaign access and tested direct-API denial.
- [ ] Reliable save queue, conflict recovery, and cross-device character access.
- [ ] All supported hosted roll paths use persisted server-resolved events.
- [ ] Resource-spending actions are atomic and idempotent.
- [ ] DM connects Discord once; players never receive webhook credentials.
- [ ] Delivery states, retries, ambiguous outcomes, and runner limits are honest.
- [ ] Mobile/keyboard/reduced-motion player journey verified.
- [ ] Browser demo and character file compatibility preserved; TTS remains gated.
- [ ] Real backend tests pass in addition to mocked client tests.
- [ ] Documentation updated and authorized Site deployment verified, if in scope.

## 10. References and documentation updates

Internal: `README.md`, `docs/character-api.md`, `docs/open-decisions.md`,
`docs/architecture-review.md`. Update their hosted-roll, persistence, ownership,
and Discord descriptions when implementation changes behavior; retain historical
TTS contracts without presenting them as deployed endpoints.

Verify current primary Discord documentation before implementing external calls:

- [OAuth2 and webhook channel authorization](https://github.com/discord/discord-api-docs/blob/main/developers/topics/oauth2.mdx)
- [Webhook execution and message API](https://github.com/discord/discord-api-docs/blob/main/developers/resources/webhook.mdx)
- [Rate limits and retry behavior](https://github.com/discord/discord-api-docs/blob/main/developers/topics/rate-limits.mdx)

External prerequisites to record explicitly: DM channel-management permission,
an approved webhook destination, server encryption secret, and (only for OAuth)
Discord application credentials plus registered callback URL. These do not need
to block work on authorization, save behavior, contracts, mocked delivery, or UI.
