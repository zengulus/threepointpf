# Character API contract

Hosted mode mounts the static React application inside the Site shell and sends authenticated, same-origin requests to `/api`. The host owns login, secure session cookies, authorization, validation, durable storage, and database details. Browser mode never calls this API.

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
