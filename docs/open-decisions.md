# Open rule and product decisions

These decisions are genuinely unresolved. Each entry states the options and what
the code does in the meantime, so ordinary implementation work never has to stop
for them. Dataset-policy items (ingestion exclusions, missing class-skill rows,
large class systems) live in `AUTOSHEET.md`; character HP and skill allocation
are now explicit campaign-profile concerns and are summarized here.

## Deferred (do this later)

1. **Tabletop Simulator client.** `tts/src/global.lua` is frozen at its MVP scope
   — saves, one attack member with a standard/full toggle, maneuvers, and one
   physical d20 — and is *gated off* from current rules and hosting work. Its
   tests (`tests/tts-contract.test.ts`, `tests/tts-runtime.test.ts`) protect the
   frozen prototype with mocked transport. The historical `/roll-plan` and
   `/resolve-roll` endpoints are no longer deployed here. Revisit only when a
   real TTS surface is in scope, including multi-die physical rolls and an
   explicit server authority and authentication design.

Settled by the runtime-mode pass, and no longer open: browser mode is the
**default** backing mode, hosted mode is explicit, the published Pages build is
explicitly browser-only and unauthenticated, samples are ordinary authored state with a pinned level 1
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
GitHub Pages deployment at `/threepointpf/`. The reusable `ThreePointPfApp` can
be mounted by a host shell and receives its repository and auth-required callback
through props; the hosted repository uses same-origin cookie-authenticated HTTP.

Settled by the roll-contract pass, and no longer open: the roll/action contract
itself, per-action roll plans, deterministic outcome classification with
distinct natural-face and critical facts, no critical confirmation, and critical
ranges authored on weapons/profiles and expanded by contextual effects. Also
settled since: damage and initiative are first-class roll plans, an action's
roll list carries each step's damage roll, PF1e save naturals are automatic, the
critical multiplier is authored per weapon/profile, a plan declares its own
primary check die, and threat-range expansion covers Improved Critical/Keen
doubling with weapon scoping and nonstacking.

Settled by the character-lifecycle pass: creation and level-up are pure domain
transactions over ordinary `CharacterInput`. The sheet's guided creation and
level-up dialogs call the lifecycle proposal, validation, preview, and commit
APIs; abandoned proposals never touch saved state. The profile makes track
topology, content sources, HP acquisition, skill allocation, and explicit
trusted-table overrides visible. The current demo flow uses a small local
profile and does not define a universal Pathfinder answer or backend campaign
service.

Settled by the ability/resource pass, and no longer open: abilities group zero
or more effects and have explicit passive/toggleable/activated state; resources
are independent shared pools with separate maximum and spent state; activation
spends referenced resources transactionally; and additional damage dice remain
separate sourced terms with explicit critical multiplication behavior. Imported
abilities can be added or cloned into local editable definitions, while legacy
feature instances remain compatible.

## Product decisions

1. **Character profiles and broad legality.** The guided flow supports manual
   ability entry, single/gestalt/three-track starts, lifecycle feature choices,
   and preview/commit. Profiles are not yet persisted as campaign records.
   There is no point-buy, race builder, or general feat legality automation;
   curated samples remain useful fixtures.
2. **Selection scope.** The selected sample preference remains browser-scoped
   (`threepointpf.sheet.sample`). The active saved character ID has a separate
   browser key, and browser/hosted repositories expose saved characters to the
   sheet picker. A second browser starts with its own selection.
3. **Demo portability.** Browser mode saves to browser storage and imports/exports versioned JSON locally. Hosted mode uses the same-origin Character API; authentication and durable storage belong to the host Site.
4. **Hosted access policy.** The Site shell owns login and session cookies. The
   Site backend must authorize every character list/read/write independently;
   the frontend only distinguishes unauthenticated, forbidden, missing, invalid,
   conflict, server, and network failures.

## Lifecycle policy decisions

1. **Campaign-profile ownership and defaults.** A caller supplies the profile
   that names tracks, sources, HP/skill policies, and allowed overrides. This
   pass deliberately does not decide whether profiles become persisted campaign
   records, who may edit them, which source lists a campaign exposes, or a
   universal default for a new table. The static demo can remain entirely local.
2. **Character-choice coverage.** The lifecycle can expose a structured
   requirement/selection where content models one, but it does not turn
   descriptions into a feat, race, spellcasting, or prerequisite engine. The
   table must still decide how to represent and review those systems before a
   guided player flow claims to prove legal builds.
3. **HP and skill variants.** The profile makes maximum-first-level, fixed,
   rolled/caller-supplied, and manual HP gains explicit and can report a skill
   budget/allocation with an override. It does not settle random-roll auditing,
   fractional ranks, every class-skill/cap interpretation, retraining, or the
   3.5/PF1e variants. Those remain local policy decisions, recorded rather than
   silently guessed.

## Rule semantics

1. **Opposed maneuvers and maneuver legality.** The engine computes a contextual
   CMB/CMD modifier and a maneuver outcome against a supplied CMD, but not the
   opposed check, the size limit (you cannot trip a creature more than two sizes
   larger) or the size of the modifier the *defender* applies. Options: keep it
   at the modifiers plus an author reminder, or add a `ManeuverResolution` that
   carries both contexts. Today a maneuver is a contextual CMB plan compared
   against the caller's CMD and the table adjudicates the rest.
2. **Automatic critical follow-up.** Additional damage dice now explicitly
   declare whether they multiply, so precision damage can remain one sourced
   copy while ordinary riders follow the weapon's authored multiplier. What is
   still not modelled is automatically offering or resolving the critical
   damage plan after a `criticalSuccess`; the caller decides when to roll that
   variant.
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
14. **Homebrew authoring and lifecycle-choice surface.** A local progression,
    including a monster-style progression, travels with the character and uses
    the same lifecycle/evaluator pipeline as imported content. Homebrew can
    also express applicability, tags, action roles and critical-range widening,
    but there is no editor for `appliesWhen`, flags, step roles, threat ranges,
    or generic lifecycle choices; those are authored as data/JSON today.
    Whether that stays a power-user path or gains a form is a product choice,
    and it should follow decision 9 and the lifecycle-choice decision above.
15. **Spellcasting source choice authoring.** The advancement model can bind a selected source ID to a regular progression feature choice and lifecycle selection. Remaining question: whether expert authoring should generate that linked feature-choice metadata from a simpler prestige editor instead of requiring content authors to keep the two references aligned.
