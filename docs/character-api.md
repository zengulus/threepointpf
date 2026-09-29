# Character API contract

Hosted mode mounts the static React application inside the Site shell and sends authenticated, same-origin requests to `/api`. The host owns login, secure session cookies, authorization, validation, durable storage, and database details. Browser mode never calls this API.

The hosted Site has explicit campaign membership and character assignment. A
campaign DM can read and edit all characters in that campaign, including
unassigned imports. A player can read and edit assigned characters and can
create/import their own character only in a campaign they belong to; the server
sets owner access on creation. Assignment and membership remain outside
`CharacterInput`. One explicit site administrator can recover unassigned or
inconsistent legacy records and manage site accounts and campaigns. Migration
`0005` elects the oldest existing DM for that role and preserves existing DM
access by adding them to all existing campaigns. Newly created DMs receive
campaign access only through membership.

A `co_dm` account has a `co_dm` campaign membership and a session
`activeRole` of `player` or `dm`. New Co-DM sign-ins start in Player mode.
`POST /api/auth` with `{ "action": "switch-role", "activeRole": "dm" }`
(or `"player"`) switches only that session. In Player mode, the Co-DM needs
ordinary `character_access` for character reads, edits, and rolls; in DM mode
they can manage characters in their campaigns. An ordinary player cannot
switch roles.

## Routes

`GET /api/characters` returns summaries only:

```json
[{ "id": "character-id", "name": "Character name", "campaignId": "campaign-id", "updatedAt": "2026-09-23T00:00:00Z" }]
```

`GET /api/characters/:id` returns the canonical authored snapshot and an optional opaque concurrency revision:

```json
{ "character": { "id": "character-id", "name": "Character name" }, "revision": "opaque-token" }
```

`PUT /api/characters/:id` accepts the same character snapshot plus an optional revision:

```json
{ "character": { "id": "character-id", "name": "Character name" }, "revision": "opaque-token" }
```

The successful response is `{ "character": <canonical CharacterInput>, "revision": <optional string or number> }`. The path ID must match `character.id`. On an existing record, the backend should require the latest revision and return `409` for a stale or missing revision; without a revision, PUT should create only and must not overwrite an existing record. The frontend remembers revisions privately in the HTTP repository. Revisions do not enter `CharacterInput` or portable character exports.

`GET /api/campaigns` lists the signed-in account's campaigns (all campaigns
for the site administrator). The administrator creates one with
`POST /api/campaigns` and `{ "id": "...", "name": "..." }`.
`GET /api/campaigns/:id/members` lists members to that campaign's DM.
`PUT /api/campaigns/:id/members` adds an existing account with
`{ "username": "...", "role": "player" }`; the role can also be `co_dm`
or `dm` when set by the site administrator. Only the site administrator may
add or remove a campaign DM or Co-DM. `DELETE` with `{ "accountId": "..." }` revokes
membership and that player's character grants in the campaign.

`GET /api/assignments` returns only characters in campaigns managed by the
current DM. `PUT /api/characters/:id/assignment` with
`{ "accountId": "..." }` assigns an existing campaign player; `null`
unassigns. An account cannot gain access by supplying a different
`campaignId` inside a character snapshot. Existing character moves require
a separate authorized management operation.

Snapshots are authored/runtime `CharacterInput` only. Do not return database row metadata, derived rules totals, cached catalogs, or Site-specific fields as authoritative character state. The frontend validates the response with `parseCharacterInput` and canonicalization; the backend must independently validate and authorize writes.

Requests use `credentials: "same-origin"` and JSON. The normal browser bundle uses relative `/api/...` paths; there is no API host environment variable or bearer token.

## Errors

Errors use `{ "error": { "code": "...", "message": "safe user-facing message" } }`. Never return stack traces or secret values.

| Status | Meaning | Client result |
| --- | --- | --- |
| 401 | Missing or expired host session | `CharacterApiError` with `unauthenticated`; invokes the optional host callback |
| 403 | Authenticated but not permitted | `forbidden` |
| 404 | Character does not exist | GET returns `null`; other routes report `not-found` |
| 400 / 422 | Invalid request or character | `validation` |
| 409 | Stale revision or create collision | `conflict` |
| 5xx | Service failure | `server` |

Network failures and invalid response payloads become typed `network` and `protocol` errors. The enclosing Site shell decides what to do after an authentication callback; 3.PF does not redirect to a login route.

## React mount boundary

The standalone Vite entry renders the same exported `ThreePointPfApp` component that a host can mount. A host can provide `characterId`, a `CharacterRepository`, an explicit `mode`, and `onAuthenticationRequired`. Optional display identity is presentation metadata only and never enters the rules engine. The app imports its own styles and does not import Site auth code.

The app performs ordinary browser roll planning and dice resolution locally. The old remote roll endpoints supported a frozen TTS prototype and are not part of this Character API contract.

Hosted edits save after a short idle delay (currently 700 ms) through a
serialized client queue. The Save button remains available. A roll started
while the sheet has unsaved edits waits for a successful save; a conflict or
failed save blocks that roll and leaves the draft visible. The server returns
`409` when another device has advanced the revision. The hosted sheet has
not yet switched to the server roll endpoint; see
`PLAYER-DISCORD-IMPLEMENTATION-PLAN.md` and `hosted-roll-api.md`.
