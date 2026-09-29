# Hosted roll API (in progress)

The hosted Site stores a roll before returning it. The ordinary roll route
supports save, attack, maneuver, skill, damage, initiative, and concentration.
The hosted sheet uses this route when its
displayed plan exactly matches a plan rebuilt from the saved character and a
strict action intent. A separate typed route now handles one recharge-backed
resource spend. Synthetic bonus dice, spell, ability, and other contextual
rolls still require typed server action intents before the feature
is ready for trusted play. They fail visibly in hosted mode rather than using
local dice as a campaign result.

For a Co-DM, the active session mode controls roll permission. Player mode can
roll only assigned characters; DM mode can roll characters in campaigns where
that Co-DM has membership. Switching modes does not alter a previously
recorded roll or give Player mode access to an unassigned DM roll.

`POST /api/rolls` accepts same-origin cookie-authenticated JSON:

```json
{
  "version": 1,
  "clientRequestId": "5dc297ac-7c23-4862-b00e-13bd2cccb67b",
  "characterId": "character-id",
  "expectedRevision": 3,
  "action": {
    "characterId": "character-id",
    "kind": "save",
    "saveId": "fortitude",
    "defense": { "kind": "dc", "value": 17 }
  }
}
```

The strict action schema is `hostedRollRequestSchema` in `packages/shared`.
Clients cannot supply a plan, dice faces, modifier, or total. The server loads
the saved character, rebuilds the plan using the shared rules catalog, generates
cryptographically sampled faces, resolves the result, and commits a roll event
and Discord delivery row in one D1 batch. The insert checks the current revision
and permission again at commit time. A stale revision returns 409 without a roll.

The response is version 1 with `rollId`, `clientRequestId`, character ID/name,
`characterRevision`, `createdAt`, canonical `plan`, `result`, and `delivery`.
`GET /api/rolls/:id` returns the stored result for currently authorized readers.
Retry the POST with the **same** request ID and exact body if its response was
lost. A matching retry returns the stored roll even after a later character edit;
the same request ID with different content returns 409. New intentional rolls
must use new UUIDs.

`POST /api/resource-spends` accepts the same authentication, request ID, and
revision fields, plus a `resourceId` identifying one saved resource with a
`rechargeRoll` refresh rule. It never accepts dice or a proposed resource
state. The Worker rebuilds its recharge plan, rolls secure faces, derives the
new spent count and refresh timer, then uses one D1 batch to update the
revision-guarded character, record the immutable roll, and queue its Discord
delivery. The roll insert is conditional on the preceding update's `changes()`
result; a duplicate or stale request cannot record an unspent roll. The
response includes the recorded roll, the current saved character snapshot, and
revision so the sheet updates without a second PUT. A matching retry reuses
the original roll even if another edit followed it. The browser keeps an
unconfirmed request ID in session storage so retrying the same resource after
a lost response or reload cannot silently create another spend. If newer local
edits arrived while the action was in flight, the sheet preserves the draft
and asks for a reload instead of overwriting it.

An unconnected campaign records `delivery.state = "not_configured"`. A connected
campaign records `pending`, pinned to that connection ID and version. A
best-effort Worker `waitUntil` call starts delivery after the roll is committed.
The delivery claim uses an atomic lease, and the server posts the stored result
with `wait=true`, `allowed_mentions: { parse: [] }`, and a short roll reference.
Only a returned Discord message ID marks `sent`. A 429 becomes
`retryable_failed` with Discord's retry delay. A known invalid webhook becomes
`permanent_failed`. A timeout, 5xx, missing confirmation, or expired send lease
becomes `delivery_unknown`, which is never automatically resent.

`POST /api/rolls/:id/discord/retry` retries an authorized pending or due
retryable delivery. For `delivery_unknown`, it requires
`{ "confirmPossibleDuplicate": true }`; the caller must first check the channel
and accept that a duplicate could appear. `sent`, cancelled, unconfigured, and
permanent failures are not resent. Replacing or disconnecting a campaign webhook
cancels queued sends, and the connection version prevents old rolls from moving
to a new channel.

`POST /api/discord/drain` processes at most one due, authorized delivery. The
hosted app calls it every 30 seconds while someone is signed in. This is the
current recovery runner because this Site has no configured queue or scheduled
Worker. **Automatic retries pause while the app is closed**; `waitUntil` alone
is not a durable scheduler. Discord webhook execution cannot promise exactly-once
delivery after an ambiguous timeout.

The hosted sheet displays the recorded result, a short roll reference, and
delivery status. It polls pending deliveries while open. Retry sending is a
separate action from rolling again; ambiguous delivery requires the player to
check the channel and explicitly accept a possible duplicate. History
lists the latest 20 authorized rolls for a character, refreshes while the sheet
is open, and survives reload. Older-history pagination, full roll-family
coverage, and atomic spell/ability/system/turn actions remain unfinished. Do not treat
`pending` as sent.

Discord messages put the roll type first, then a prominent green success or
red failure line with total versus the declared AC/CMD/DC. Dice, modifier,
character, and roll reference follow below. A recharge result uses a neutral
dice marker and labels its total in rounds.

Local verification uses `tests/hosted-roll-api-smoke.mjs` against a fresh
Wrangler/D1 database with migrations `0000` through `0006`. It covers permission
denial, forged input, concurrent duplicate requests, immutable retry recovery,
stale revision rejection, and concurrent recharge spending. `tests/discord-delivery.test.mjs` uses Miniflare D1
and a fake Discord fetcher for lease, rate-limit, timeout, connection-pin, and
confirmed-message behavior. The local database and test bundle are ignored
under `work/`.
