# Hosted Discord connection

The Site's Dungeon Master connects a campaign to one Discord channel from
**Users → Discord channel**. The DM pastes an incoming webhook URL. Setup makes a
read-only request to Discord's Get Webhook with Token endpoint to verify that it
is an active incoming webhook and identify its channel. It does not post a test
message automatically. A separate **Send test message** button posts once on
explicit DM action, limited to one attempt per campaign per minute.

The Site requires a 32-byte `DISCORD_WEBHOOK_ENCRYPTION_KEY`, encoded as base64
and stored as a Sites secret. The server encrypts each URL with AES-GCM and a
fresh 12-byte IV, binding the ciphertext to the campaign ID. The key and URL
must never enter a client bundle, character snapshot, API read, error, or log.
`GET /api/campaigns/:id/discord` returns only channel status. `PUT` replaces the
connection after verification; `DELETE` disconnects it. All writes are DM-only
and require a same-origin request. A player assigned to a character in the
campaign may read the channel status but never the webhook.

The connection has a new `connection_id` on every replacement. Future roll
deliveries must bind to that identity so queued messages cannot silently switch
channels after a DM changes or disconnects the webhook. There is no delivery
runner yet; server-recorded rolls and their outbox are the next stage.

Current tests: `node --experimental-strip-types
tests/discord-connection.test.mjs`, the hosted Worker build, local D1 migration
and access checks, and a browser check of the DM settings screen. Do not send a
real test message without a DM-approved destination.
