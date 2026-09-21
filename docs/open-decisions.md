# Open rule and product decisions

These decisions are genuinely unresolved. Each entry states the options and what
the code does in the meantime, so ordinary implementation work never has to stop
for them. Content-policy items (ingestion exclusions, HP/skill allocation,
missing class-skill rows, large class systems) live in `AUTOSHEET.md` and are not
repeated here.

## Deferred (do this later)

1. **Tabletop Simulator client.** `tts/src/global.lua` is frozen at its MVP scope
   — saves, one authoritative attack member with a standard/full toggle,
   maneuvers, and a single physical d20 submitted to `/resolve-roll` — and is
   *gated off* from current rules work. New roll families (initiative, damage),
   multi-dice plans, server-contract extensions and any panel redesign are **not**
   required to be wired into it, so the browser/Edge contract may move ahead of
   the Lua client without waiting for it. Its two files of tests
   (`tests/tts-contract.test.ts`, `tests/tts-runtime.test.ts`) exist only to keep
   the frozen surface from silently rotting: the trust boundary below still has
   to hold for what TTS already sends. Un-gate when a real TTS surface is worth
   the work, which needs (a) multi-die physical-dice support in the client and
   (b) a decision on the panel flow in product decision 11. Until then
   `/roll-plan` and `/resolve-roll` keep accepting exactly what TTS sends; they
   are simply not extended for it.

Settled by the demo/presentation pass, and no longer open: demo mode is the
**default** backing mode (cloud only when both public credentials are present and
no demo flag was set), the published Pages build is explicitly demo and
unauthenticated, samples are ordinary authored state with a pinned level 1
fighter as the landing sheet, and user-facing presentation choices (dice skins,
flourishes, sound, reduced motion, selected sample) live under their own storage
keys and never enter character state.

Settled by the application-shell pass, and no longer open: `App` can receive a
caller-selected `characterId`; `AppShell` owns one character-sheet controller,
one dice presentation, and one application-level `DiceOverlay`; and
`CharacterSheetView` is shared unchanged by the full-page sheet and the
draggable/resizable floating-window presentation. Active tab, workspace mode,
window visibility/minimized state, and window bounds are transient UI state,
not authored or persisted character data. The workspace is deliberately a
neutral placeholder, not a VTT: this pass adds no maps, tokens, campaign state,
multiplayer behavior, or new backend requirement, and preserves the static
GitHub Pages deployment at `/threepointpf/`.

Settled by the roll-contract pass, and no longer open: the roll/action contract
itself, per-action roll plans, deterministic outcome classification with
distinct natural-face and critical facts, no critical confirmation, and critical
ranges authored on weapons/profiles and expanded by contextual effects. Also
settled since: damage and initiative are first-class roll plans, an action's
roll list carries each step's damage roll, PF1e save naturals are automatic, the
critical multiplier is authored per weapon/profile, a plan declares its own
primary check die, and threat-range expansion covers Improved Critical/Keen
doubling with weapon scoping and nonstacking.

## Product decisions

1. **Character creation for samples.** Samples are hand-authored
   `CharacterInput` values, including the level 1 fighter's ability assignment
   (elite array with the human +2 already applied) and its three feats. There is
   no point-buy, race or feat-picker subsystem, so nothing currently *generates*
   a legal character; changing the sample means editing data. Options: keep
   hand-authored samples as documentation of what the sheet can represent, or
   add a small creation assistant (ability generation, race/class choice, feat
   slots) that emits authored state. The sheet itself does not need the
   assistant: it validates and derives whatever it is given.
2. **Sample selection scope.** The selected sample is browser-scoped
   (`threepointpf.sheet.sample`), not per character and not synced. A reload
   returns to the same sample, but a second browser starts on the default. If
   samples become cloud content, the selection belongs to the account instead.
3. **Demo save semantics.** Demo mode saves to browser storage and offers no
   accounts, sharing or export. That is deliberate for a public showcase; if the
   demo needs to be handed over (a file, a link, a campaign), export/import and
   an account boundary would have to be designed together with cloud-mode auth,
   which is still open below.
4. **Cloud authentication.** Cloud mode still relies on deployment-side
   credentials and policies (short-lived tokens, row-level policy review,
   rate limiting, deployment secrets) as recorded in
   `docs/architecture-review.md`. Demo mode is not a substitute for that work and
   is not meant to become an unauthenticated cloud client.

## Rule semantics

1. **Opposed maneuvers and maneuver legality.** The engine computes a contextual
   CMB/CMD modifier and a maneuver outcome against a supplied CMD, but not the
   opposed check, the size limit (you cannot trip a creature more than two sizes
   larger) or the size of the modifier the *defender* applies. Options: keep it
   at the modifiers plus an author reminder, or add a `ManeuverResolution` that
   carries both contexts. Today a maneuver is a contextual CMB plan compared
   against the caller's CMD and the table adjudicates the rest.
2. **Precision damage and automatic critical damage.** A critical damage plan
   applies the weapon's or profile's authored `criticalMultiplier` (default ×2),
   so the multiplication is content and the arithmetic is server-side. What is
   not modelled: precision damage (sneak attack, a ranger's favored-enemy dice)
   should not be multiplied, and nothing yet offers the critical variant
   automatically after a `criticalSuccess` — the caller decides when the attack
   crit. Both remain a rules decision, not an implementation detail.
3. **Multiple extra-attack sources.** Haste grants exactly one extra attack per
   full-attack action (decided, and covered by tests). Whether Rapid Shot, Haste
   and a future *speed* weapon stack, or whether extra attacks of the same class
   are exclusive, is authored per feature today because the answer is
   campaign-specific. If stacking becomes a rule, it needs an explicit
   extra-attack category on the effect rather than tag heuristics.
4. **Damage, drain and absent abilities.** The ability-penalty floor
   deliberately exempts baseline replacement so these mechanics stay
   representable, but nothing yet models them. The open question is whether they
   are a `replaceBase` on `ability.*` (today's escape hatch), a distinct
   operation such as `reduceMax`, or damage tracked separately from the score.
5. **Target defense is caller-supplied context.** A request may name the AC, CMD
   or DC it is rolled against, and the server records and echoes it but cannot
   verify it: a persisted target character is not loaded yet. Making defenses
   authoritative needs a target-sheet lookup (or a campaign policy for
   table-declared values), and until then a client can supply a defense that
   favors itself. The mitigation in place is that a defense that cannot apply to
   the roll family — a DC on an attack, an AC on a save, a non-touch AC on a
   touch attack — is rejected.
6. **Automatic-failure classification for attacks.** The current PF1e attack
   policy classifies a natural 1 as `criticalFailure`. That is a campaign
   naming choice: PF1e itself only says "automatic miss". If a second campaign
   should report a plain `failure`, it overrides the `attack` policy; the
   default stays as specified.
7. **Cover, concealment and miss chance.** Not modeled. These are
   attack-resolution facts rather than typed AC bonuses, so they most likely
   belong in a future resolution context (attack against concealment, miss
   chance percent) rather than as `ac` effects.
8. **Denied Dexterity.** Flat-footed is a defense context, but "denied Dexterity
   bonus" (feint, unseen attacker, some grapples) is not identical to it.
   Whether that becomes another defense context, a roll-context flag, or both is
   undecided.
9. **Situational flags.** Conditions contribute flags such as the `sight-based`
   requirement on Dazzled's Perception penalty, but there is no registry or
   taxonomy: any lowercase slug is valid. The open decision is whether flags
   become a closed catalog validated against `rules-data`, which would make
   homebrew portability cheaper but homebrew experimentation slower.
10. **Action economy.** The modeled actions are still only `standardAttack`,
    `fullAttack`, `maneuver`, `save` and `skillCheck`. Damage and initiative
    plans exist and are requestable through `/roll-plan` (and rebuildable by
    `/resolve-roll`), but they hang off no action of their own: initiative sits
    outside the action model by nature, and a damage roll is requested per
    weapon/step rather than by declaring "this hit was a critical, give me its
    damage". Swift and immediate actions, readying, actions spanning a round,
    and spellcasting action types wait on spellcasting.

## Product decisions

11. **Where the action choice lives.** The browser exposes per-weapon roll plans
    alongside the explicit action plan, plus an initiative roll and each step's
    damage roll; TTS exposes a standard/full toggle and maneuver buttons. TTS
    deliberately has no initiative or damage button and is deferred entirely
    (see the TTS gate above), so this decision currently concerns the browser
    alone. Whether players should be
    forced through a single "declare action, then select weapons" flow, or keep
    per-weapon shortcuts (which must always carry the action explicitly, as the
    request does now), is a UX decision with rules consequences.
12. **How much of an outcome to show.** Rolls report the natural face, the
    threat-range verdict and the semantic outcome. The sheet now has one optional
    caller-entered Target DC that saves and skill checks use, so a DC-checked
    roll resolves while a blank field leaves it unresolved rather than assuming a
    number. Still open: whether the sheet should also take a target AC/CMD, remember a
    last-used value per character, or keep the table's numbers out of the app,
    and whether the attack roller should keep reporting "unresolved" until the
    table supplies an AC.
13. **Exclusion display volume.** Every filtered effect is reported with a
    reason, and the sheet shows them for the inspected target. If players need
    "why is my ray not getting Deadly Aim" without inspecting, the plan needs a
    deliberate exclusion summary instead of raw contributions.
14. **Homebrew authoring surface.** Homebrew can express applicability, tags,
    action roles and critical-range widening, but there is no editor for
    `appliesWhen`, flags, step roles or threat ranges; it is authored as JSON
    today. Whether that stays a power-user path or gains a form is a product
    choice, and it should follow decision 9.
