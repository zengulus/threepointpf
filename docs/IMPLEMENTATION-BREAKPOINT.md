# Implementation breakpoint — 2026-09-30

The current stopping point is **one atomic hosted recharge-resource spend**. The
root implementation is commit `71f199e` on `main`. Sites production version
**293** is live at <https://threepointpf-character-sheet.nathmcdm.chatgpt.site/>
from the Site source commit `30e66482614ce57d4b347318e3dc73b816d71cdf`.
Its deployment succeeded. This is an intermediate milestone, not completion of
the player-to-Discord plan in `PLAYER-DISCORD-IMPLEMENTATION-PLAN.md`.

`POST /api/resource-spends` accepts a typed request for one recharge-backed
resource. It rechecks the signed-in actor's active-role edit permission and the
expected character revision, reconstructs the roll from the saved character,
generates secure dice, and commits the new character snapshot, immutable roll
event, and Discord outbox row in one guarded D1 batch. The client uses the
returned snapshot and revision without a second PUT. It keeps an unconfirmed
request ID in account-scoped `sessionStorage` so a same-tab retry or reload can
recover the recorded spend. The resource control exposes recovery even if the
resource appears empty after the server accepted a response that was lost.
The Discord formatter calls this a recharge roll rather than damage.

Verification at this breakpoint:

- Root `pnpm test`: **429/429 passed**.
- Root `pnpm build`: passed and includes `/api/resource-spends`.
- Root `pnpm test:e2e:hosted`: **4/4 passed**, including response-loss recovery.
- Site checkout `pnpm build`: passed; version 293 deployment status: **succeeded**.
- Fresh local Worker/D1 smoke: concurrent identical requests made one spend and
  one roll; anonymous and unassigned actors, forged totals, stale revisions,
  and exhausted resources were rejected. Ordinary roll/history smoke passed.
- No live Discord test message was sent for this milestone.

The broader plan remains open. Hosted roll-backed spell casts, ability
activations, system entries, and start-of-turn actions still preflight-reject;
they must not change slots, uses, resources, or turns until the server can record
their dice and state together. Durable Discord delivery operation, history
pagination, and a full authenticated production player/Co-DM journey also
remain to be verified. Do not describe the public site as ready for trusted
campaign play yet. Session recovery is scoped to the same browser tab and
account; it is not cross-device recovery.

**Next implementation action:** continue Stage D of the plan with a versioned
server action envelope for a roll-backed spell cast or ability activation.
Support multiple roll plans in one accepted action, rebuild each from the saved
character, apply all slot/use/resource/turn changes in one revision-guarded D1
transaction with immutable roll events and delivery rows, and make retries
return the original action result. Keep the interim preflight guards until the
corresponding action family has this contract and real Worker/D1 tests.

Repository layout matters: `C:/repos/threepointPF` is the primary repo;
`C:/repos/threepointpf/work/site-source` is a separate Site source checkout and
tracks its built output. Sync runtime changes there, build, push that exact
source, then save/deploy a Sites version. Never commit webhook URLs or send
another real Discord message without a new authorized test action.
