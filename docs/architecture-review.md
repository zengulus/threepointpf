# 3.PF architecture review

Reviewed: 2026-09-15

Updated: 2026-09-18 (combat-context pass: CMD derivation, ability penalties, selectors, contextual actions, module split)

Updated: 2026-09-18 (roll-contract pass: actors/actions/targets in context, per-step roll plans, semantic outcomes, authored critical ranges; damage and initiative plans complete an action's roll list)

This review compares the implementation with the supplied `Pathfinder Autosheet v6.2.1` workbook and the current vertical-slice brief. The workbook remains a behavioral reference, not a runtime dependency.

## Overall assessment

The architecture is sound for a first slice. The most important boundary is already in place:

`authored inputs → enabled features → typed contributions → reducers → derived values → roll plans`

`packages/rules-core` is pure TypeScript. React, Supabase, browser dice and Tabletop Simulator consume it rather than reimplementing formulas. Stable target IDs make the dependency graph explicit, and Zod validation is used at persistence and Edge Function boundaries. This gives the project a good path from the workbook's fixed columns and rows to declarative feature data.

## Corrections made in this pass

### Advancement tracks

Advancement is represented as ordered `AdvancementSlot[]`. Each slot contains any number of named `AdvancementTrack` entries, so track count expresses normal, gestalt, tristalt, or another campaign structure without an `isGestalt` boolean. An entry references a `ProgressionDefinition` supplied by an injected catalog. `rules-core` owns no class corpus; `rules-data` validates the Autosheet-derived Fighter, Rogue, and Wizard chassis facts and their source rows.

Progression/class levels are character-global in ordered slot/track traversal. Each cumulative chassis delta is credited to the track that occupies the entry, so moving Fighter between tracks never restarts its good-save or fractional-BAB progression. Aggregation is then property-specific: BAB chooses the highest complete track total, each save chooses its highest complete track total, and hit dice provide one die per slot using the highest die type available in that slot. BAB is never maximized independently at each slot, so staggered fractional tracks cannot manufacture full BAB. The selected track, global levels, and individual increments appear as nested provenance. Hit-die sides are available for a future HP-from-HD layer; the current authored `baseHpBeforeConstitution` remains the HP baseline.

### Set and replacement semantics

`replaceBase` is a replacement for an intrinsic/base scalar, not another contribution added beside the authored base. Competing enabled replacements for the same target are rejected; feature-array order is never precedence. Dependencies and ordinary modifiers still apply afterward.

The current baseline targets are:

| Target | Fallback intrinsic value |
| --- | --- |
| `ability.*` | authored base ability score |
| `save.*` | authored base save |
| `ac` | 10 |
| `ac.natural` | 0 |
| `hp` | `baseHpBeforeConstitution` |
| `initiative` | 0 |
| `cmb` / `cmd` | 0 / 10 |
| `skill.*` | authored ranks |
| `speed.land` | authored land speed, otherwise 30 |
| `combat.bab` | manual BAB or selected advancement-track BAB |
| `attack.*` | zero intrinsic baseline + one `combat.bab` dependency |
| `damage.*` | 0 |

This is deliberately uniform and is covered by tests for ability scores, saves, HP and speed. `replaceBase` is suitable for future authored overrides such as an alternate progression without silently double counting the old baseline.

### Grant retained for future use

`GrantEffect` stays in the schema because future spellcasting, class-feature and capability work will need it. It is not coerced into a numeric modifier. `RulesEngine.grants()` and `DerivedCharacter.grants` expose active grants with their source, while no current derived total consumes them. Disabled features do not emit grants. This keeps the future capability without inventing v0 math.

### AC applicability is explicit

AC context is represented as `normal`, `touch` or `flatFooted`. A modifier targeting `ac` must carry a non-empty `appliesTo` list; omitted applicability is rejected and can never expand to all contexts. The engine never infers context from `bonusType`: an untyped or armor bonus can be scoped explicitly, and a deflection or dodge bonus can be explicitly included in touch AC.

`ac.natural` is a target-specific natural-armor component. It is included in normal and flat-footed AC and excluded from touch AC. This prevents natural armor from being accidentally treated as a general AC modifier while keeping its Pathfinder behavior visible in the target vocabulary.

### HP meaning is explicit

The authored fields are `baseHpBeforeConstitution`, `damageTaken`, and `temporaryHp` in advancement mode; manual mode additionally accepts `baseBab`, `baseSaves`, and `hitDiceCount`. `maxHp` is derived as the baseline plus the effective Constitution modifier once per hit die. `currentHp` is derived from `maxHp - damageTaken`, so a temporary Constitution change updates current HP consistently without rewriting damage state; temporary HP remains a separate value. The web and TTS state contracts receive the derived HP state from the TypeScript engine.

### Provenance preserves dependencies

Top-level contributions sum exactly to the displayed scalar after typed reduction. Derived ability contributions contain nested evidence, for example:

`attack.melee +4 STR modifier → STR score 18 → base STR 18`

The nonlinear modifier node carries the formula note `floor((score - 10) / 2)`. Nested children are explanatory evidence; they are not added a second time to the parent total. This preserves source traceability without corrupting arithmetic.

### Attack tags are classifications

Attack tags are a narrow union (`weapon.melee`, `weapon.ranged`, `weapon.two-handed`, `weapon.off-hand`, `weapon.touch`, `natural.attack`). They describe an attack entry; they do not add numeric semantics. Numeric effects still target stable IDs such as `attack.melee` and `damage.melee`. Mode is explicit or inferred from `weapon.ranged`. Tags are now consumed twice: as the legacy `attackSelector` filter and as the `requiredTags`/`excludedTags` of a contextual `appliesWhen` rule.

### CMD derives applicable AC modifiers semantically

CMD is not authored twice. `acModifiersForCmd` consumes every enabled `ac` modifier whose applicability includes the normal context, except armor, shield, natural-armor and size **bonuses**; every AC penalty applies regardless of category. Size is already a first-class CMD term, so re-reading a size bonus would double count it, and armor, shield and natural armor never add to CMD. A `+2 deflection AC` effect therefore raises CMD with no second hand-authored `cmd` effect, while a `−2 armor AC` penalty lowers both AC and CMD.

Filtered AC modifiers appear in `EvaluationResult.excluded` with their reason (`armor bonuses do not add to CMD`), so the audit trail shows the dependency rather than hiding it. A target-restricted AC effect (flat-footed only, for example) contributes to CMD only when it applies in the normal context. Authoring a `cmd` effect is still valid for genuinely CMD-only facts such as a maneuver-specific bonus; duplicated deflection/dodge `cmd` effects were removed from curated content.

### Ability penalties floor at 1, replacements do not

A negative additive modifier on `ability.*` is classified as a *temporary ability penalty* (`Contribution.abilityPenalty`) and may not take the score below 1 (`abilityPenaltyFloor`). The limit is a provenance node (`rules-core.ability-penalty-floor`) that explains the reduction, not a silent clip of the number. Nothing else is clamped to 1: a `replaceBase` baseline, and future damage, drain or absent-ability mechanics, can reach 0 and only the structural non-negative invariant applies. This keeps "penalized" and "replaced/destroyed" distinct instead of applying one global floor.

### Selectors are not concrete fact targets

`skill.all` is a *selector*: a family target that expands to the concrete facts consuming it. It accepts additive modifiers and rejects operations that need a single baseline or bound. `replaceBase`, `multiply`, `minimum`, `maximum` and `grant` on `skill.all` are rejected when the effect is parsed, for curated content and persisted homebrew data alike. Previously a `replaceBase` on the selector silently reset every skill baseline, and a `minimum` bounded every skill at once.

### Contextual rolls and actions

`RollContext` is the whole situational model, deliberately no larger than the visible cases require: actor and target identity, `kind`, `mode`, authored attack identity and tags, `touch`, `fullAttack`, sequence index, `maneuver`, and named situational flags. `EffectApplicability` (`appliesWhen`) restricts an effect to such a context by kind, mode, required/excluded tags, touch, full-attack membership, maneuver and required/excluded flags. An empty `appliesWhen` is rejected: an effect either applies generally (omit the field) or restricts something.

`ActionPlan` models a real action rather than a modifier:

| Action | Content |
| --- | --- |
| `standardAttack` | Exactly one selected weapon and one step. Never inherits full-attack extras or iteratives. |
| `fullAttack` | Every selected weapon as an explicit member with role `primary`/`off-hand`/`secondary`; each member owns its own sequence of `primary`, `iterative` and `extra` steps. |
| `maneuver` | One contextual CMB evaluation, with no weapon members. |

Multiple weapons are never concatenated into a fake combined full attack, and action-level extras are evaluated once for the primary attack, so Haste can never contribute one extra attack per weapon. The driver cases are covered by `tests/contextual-actions.test.ts`: Deadly Aim excluding touch attacks, Power Attack selecting one-/two-handed/off-hand damage by tags, Haste granting one shared extra attack on full attacks only, Rapid Shot applying only inside an eligible ranged non-touch full attack, the Combat Expertise attack/CMB tradeoff gated on the flag its feature contributes, maneuver-conditional CMB modifiers, natural secondary attacks keeping one step with no extras, and Dazzled's sight-based Perception penalty applying only when the roll carries the `sight-based` flag.

Contextual filtering preserves provenance in both directions: `EvaluationResult.excluded` and `DamageEvaluation.excluded` report each authored-but-filtered effect with a reason (`does not apply to touch attacks`, `requires flags combat-expertise`, `excluded for tags weapon.two-handed, weapon.off-hand`), and `actionExclusions` flattens an action's exclusions for display. Every exclusion is structured data (target, source, value, reason), so the machine-readable record does not depend on prose. The sheet shows what contributed *and* why other authored effects did not.

Server authority is unchanged by the extra context: `roll-plan` accepts either an action request or a single-sequence-member request, and `resolve-roll` rebuilds the request from the plan's own metadata, so a client never supplies a modifier and every contextual plan is recomputed from authored state plus context before raw die faces are resolved. The TTS panel requests the same contextual plans, carries an explicit standard/full attack choice, and exposes maneuver buttons; it still derives no modifiers itself. That client is deferred and frozen at this scope (see the TTS gate in `docs/open-decisions.md`), so new plan families do not wait on it.

### The roll and outcome contract

The roll interface now answers five questions explicitly: *what action is being attempted*, *which roll within it*, *what rules context applies*, *what raw dice are needed*, and *what the raw faces meant*.

`RollContext` is the whole situational model and keeps actor, action and target apart:

| Part | Content |
| --- | --- |
| actor | `actorCharacterId` — character facts describe the actor |
| `action` | `ActionContext`: `kind` (`standardAttack`, `fullAttack`, `maneuver`, `save`, `skillCheck`, `other`), `sequenceId`, `sequenceIndex`, `attackIds` |
| rolled fact | `kind`, `attackId`, `saveId`, `skillId`, `attackTags`, `mode`, `touch`, `maneuver`, effective `flags` and withheld `excludeFlags` |
| `target` | `TargetContext` with an optional `RollDefense` (`ac` in a `DefenseContext`, `cmd` or `dc`) |

Full-attack membership is derived from the action (`isFullAttackAction`) instead of a second boolean, so the action is the single authority for what the actor is doing. A bare fact query (`evaluate("attack.melee")`) carries no action and therefore does not satisfy an effect that needs one.

`RollPlan` carries everything resolution needs and nothing a client may author: `dice`, `modifier`, the `context` above, the `outcomePolicy` that interprets faces, the effective `criticalRange`, and `provenance` (the modifier contributions, the contextual exclusions with reasons, and how the threat range was reached). Plans are ephemeral; they are not written into authored character state, and only `roll_history` keeps a plan/result snapshot.

Every attack step also carries the damage roll it deals (`ActionPlanStep.damage`), so `ActionPlan.rolls` is the complete action-ordered list — each step's attack roll followed by its damage roll — and a caller resolves the whole action without inventing dice. A damage plan's dice are the weapon's own base dice and its modifier is the contextual damage evaluation; a critical hit is the same plan rolled with the weapon's authored `criticalMultiplier` (`criticalDamage`), so the ×2/×3/×4 is content, not a hardcoded doubling, and the provenance gains the extra copies of the modifier instead of the caller doing arithmetic. Damage and initiative are *plain* rolls: they are compared against nothing, so they carry no defense and resolution adds no success or failure. Initiative is planned the same way and requested by its own kind, with the same contextual flags its evaluation used. A maneuver still produces only its check: maneuver damage is not modeled.

Which die is the *check* die is declared, never discovered: `RollPlan.primaryCheckDie` names the group and die that carry natural-face semantics. Attacks, saves, skills, maneuvers and initiative declare a d20; damage declares none, so a weapon that rolls d20s for damage can never have its damage roll read as a "natural 20". Resolution returns the check face as `ResolvedRoll.naturalFace`, and the outcome's `natural20` / `natural1` facts are present only when the plan declared a check die.

`ActionPlan` gains `rolls`, the flattened list of its steps' own `roll` plans. One action therefore produces many self-describing rolls, and multiple weapons still stay separate members: their sequences are never concatenated, and an action-level extra (Haste) attaches to the primary weapon only, so it can never be counted once per weapon.

### Outcome semantics

Resolution is deterministic and lives in the rules-free `dice` package, which applies the plan's declared policy to the raw faces:

```text
raw faces → validate against the plan's dice → total → natural face → semantic outcome
```

Attack outcomes distinguish four independent facts: whether the raw face was a 20 or a 1, whether it fell inside the effective threat range, whether the natural-face rule made it an automatic hit or miss, and whether the total beat the supplied defense. Only the automatic rule makes a threat hit; an in-range natural 19 against an unknown or too-high AC stays a `failure`, and with no defense at all `hit` and `critical` are left unresolved instead of assumed. `criticalSuccess` means a rule classified a critical outcome, which is not the same event as `natural20`.

| Roll family | Natural 20 | Natural 1 | Comparison |
| --- | --- | --- | --- |
| attack | automatic hit | automatic miss, classified `criticalFailure` | total vs AC, threats crit without confirmation |
| maneuver | automatic success | automatic failure | total vs CMD |
| save | automatic success | automatic failure | total vs DC (the automatic rule applies without one) |
| skill | no special semantics | no special semantics | total vs DC |
| plain (damage, initiative and similar) | reported, not classified | reported, not classified | none |

Policies are one small, overridable layer (`RollOutcomePolicySet`, PF1e defaults in `outcomes.ts`); a campaign supplies only the families it changes. `criticalConfirmationRequired` exists for compatibility and is **false** for this campaign: the resolver emits no second roll, and a policy that required confirmation would still show `inCriticalRange` while `critical` stayed unresolved rather than inventing a confirmation die.

### Critical ranges are authored, derived, and contextual

A threat range belongs to the weapon or profile (`CriticalRange { minimumNaturalRoll }`; default 20) and is never inferred from a weapon's name or from the d20 system. The curated longsword, greatsword, dagger and light crossbow carry 19–20 and the rapier 18–20 as ordinary data.

The *effective* range is derived through the same machinery as other facts: a `criticalRange` effect on an attack-scoped target expands it, `appliesWhen` decides whether that expansion is in context, and contributions sum to the distance from the base (clamped to 2–20). `evaluateCriticalRange` returns base, effective, the winning `operation`, contributions and exclusions, and the plan carries both `criticalRange` and that provenance.

An expansion declares how it works: `widenBy` adds faces, while `operation: "double"` multiplies the weapon's own range, which is what **Improved Critical** and **Keen** actually do (19–20 → 17–20, a 20 threat → 19–20, 18–20 → 15–20). Weapon-specificity comes from `appliesWhen.attackIds`, matched against the roll's authored attack identity, so a feat that names one weapon or a `keen` property on one item applies exactly there. Threat-range expansion is one **nonstacking** family: when several qualify, only the most expansive one contributes and the rest are excluded with `threat-range expansions do not stack with <winner>`, so Improved Critical plus Keen is one doubling rather than two. Every one of these cases is pinned in `tests/roll-outcomes.test.ts`, including that a doubled or widened range is still only a threat: a 14–20 weapon misses a high AC on a natural 14 without becoming a critical hit.

### Request contracts and server authority

Clients request rolls by context, never by modifier: a request names the roll kind, the action and its selected weapons, the sequence member, situational flags, and the defense it is compared against. `roll-plan` recomputes the plan from authored state plus that context, and `resolve-roll` rebuilds the plan from the submitted plan's own `context` before interpreting the raw faces, so a submitted `modifier`, `provenance` or outcome is ignored. Contradictory contexts fail validation instead of being reinterpreted: a save cannot be compared against an AC, a maneuver against an AC rather than CMD, a touch attack against a non-touch AC, a standard attack against several weapons, or a maneuver action against selected weapons. The one thing the server does not yet own is the target's own sheet: a supplied defense is caller-provided context, recorded and echoed in the outcome, and `docs/open-decisions.md` keeps that open.

### Demo mode, samples and presentation boundaries

The sheet has two backing modes, and the choice is configuration rather than a request or a login. `sheetModeFor` returns `cloud` only when both public Supabase credentials are present **and** no explicit demo flag was set, so demo mode is the default everywhere else — including the published GitHub Pages build, which sets `VITE_DEMO_MODE=true` so a credential in the build environment cannot quietly turn the public demo into a database client. The demo repository is browser storage, with an in-memory repository as the fallback when a browser refuses to persist, so there is no failure path in which the demo cannot save at all. Cloud and demo share one validation/canonicalization boundary, so a sample and a saved character are the same shape.

Samples are ordinary authored `CharacterInput` values in `lib/sample-characters.ts`, and the landing sample is a level 1 human fighter on the elite array: Power Attack from the curated catalog, Weapon Focus and Toughness as homebrew effects, the curated greatsword (two-handed profile: 1.5×STR) and chain shirt, and one level of the fighter progression so BAB, saves, save DCs, hit dice, class skills and skill points are derived rather than typed in. The sample therefore exercises both content paths — curated and authored — and a test pins its derived sheet (AC 15, 15 HP, +4 to hit, 2d6+7) so an engine regression shows up as a wrong sample.

Two user-facing choices are deliberately *not* character state and have their own storage keys: dice presentation (`threepointpf.dice.presentation`) and the selected sample (`threepointpf.sheet.sample`). The sample selection is browser-scoped so a reload returns to the sheet the user was on, while a saved `CharacterInput` remains the only thing a character owns.

The Pages workflow builds with a relative base (`vite build --base=./`) so the same artifact works from a project subpath, and the presentation layer follows `import.meta.env.BASE_URL` when it resolves the renderer's texture and sound directory, so the demo's 3D dice work at `/threepointpf/` exactly as they do at the root.

That claim is checked rather than asserted. `scripts/check-demo-base.mjs` (`pnpm check:demo`) mounts the built artifact at a real `/threepointpf/` prefix, refuses any site-absolute asset reference the document asks for, and fetches the dice textures and sounds back from that path — because a base-path regression is invisible to every other test. A blank page and untextured dice only appear at the published URL, so the check runs in CI and in the Pages workflow, against the same artifact that gets uploaded.

Publishing additionally needs the repository's Pages build source set to GitHub Actions. A repository can have Pages enabled and still not publish this workflow: a branch-based Pages site looks healthy while serving something else entirely, and `actions/configure-pages` reports that as an opaque failure. So the workflow verifies the deployment source first and stops with the exact setting to change, rather than uploading an artifact nothing will serve. The setting itself is a repository property, not a file, so it is the one step a human has to take; the README states it once.

### The 3D dice boundary

The renderer sits behind `DicePresenter`, and everything crossing that boundary goes one way: authoritative faces are generated and resolved first, the renderer is handed exactly those faces (`NdS@f1,f2,…`), and what it reports back is only ever compared with what it was given. Three properties of the real `dice-box-threejs` renderer are handled explicitly because the library does not:

- It resolves a throw with `sets[].rolls[].value`. The handoff reader accepts that shape and treats every other shape as *unreported*, so a renderer upgrade can never be mistaken for agreement about the faces.
- It owns one stage, one physics world and one animation loop, so presentations are queued. A second throw waits for the first to land instead of interrupting it mid-flight and reporting the wrong faces.
- It subscribes to `window` resize without ever unsubscribing and exposes no `dispose()`. The wrapper captures the listeners registered during `initialize()` and, on teardown, removes them, stops the loop, drops the physics bodies, detaches the canvas and releases the WebGL context. Without that, every skin change would leak a listener, a canvas and a GL context.

All three are covered by tests that mock the boundary, so nothing in CI needs WebGL, and the response-shape tests build the object upstream really sends rather than a hand-written approximation.

### Module boundaries

`packages/rules-core/src/index.ts` is now a re-export surface. The evaluator is split along domain boundaries: `contributions` (typed reduction and the contribution vocabulary), `labels`, `effects` (collection, contextual applicability, operations), `abilities`, `defenses`, `skills`, `size`, `equipment`, `attacks`, `outcomes` (policies and effective critical ranges), `experience`, `advancement` and `character` (orchestration). Each module carries a source-only `.js` bridge so the Edge Functions' Deno typecheck can follow literal `.js` specifiers into the TypeScript source, matching the existing `advancement.js`/`content.js` convention. `apps/web/src/App.tsx` is composition only: domain panels live in `components/`, and state plus rules wiring lives in `hooks/useCharacterSheet.ts` and `lib/`. Both splits were made mechanically and the existing unit, pipeline and browser suites were the guardrail.

## Workbook parity scenarios

`tests/fixtures/autosheet-scenarios.json` records the intended outcomes for plain base values, Heroism, Haste, Power Attack, the Rage equivalent and same-type reduction. These are small parity anchors extracted from the workbook's base/effect-table/quick-toggle behavior. `tests/fixtures/roll-contract.json` anchors the physical-die contract: the client sends raw faces plus a contextual plan, and the rules-bearing resolver applies the modifier and classifies the outcome.

## Pathfinder calculations that are intentionally limited in v0

The following are known scope boundaries, not hidden assumptions:

- HP-before-Constitution remains an authored baseline. Manual BAB/saves/HD are retained for legacy mode; validated Autosheet chassis data now supplies advancement BAB, saves, HD count, and HD sides.
- AC supports the current base, Dexterity, natural armor and explicit AC effects. Armor/equipment inventories, shield handling, size, concealment, cover, conditions and special defenses are not yet modeled.
- Movement currently reduces additive speed contributions. Multipliers, caps and all non-land modes need a future operation model; the target IDs already leave room for those modes.
- Attack entries now derive an action: a standard attack, a full attack with BAB iteratives and explicit extra attacks, or a maneuver, each producing explicit roll plans with semantic outcomes, and each step also carrying the damage roll it deals. Critical damage is the damage rolled twice, expressed by the plan rather than by a caller. Two-weapon fighting penalties, off-hand sequence limits, precision-damage exemptions from critical doubling, ammunition, range increments and special attack text are still outside this slice.
- CMD consumes the applicable AC categories semantically, but cover, concealment, miss chance and special defenses are not modeled, and maneuver resolution stops at the CMB/CMD modifier: opposed checks, size limits ("cannot trip a creature two sizes larger") and maneuver defense DCs remain author reminders.
- Situational flags are authored slugs. There is no registry, so a homebrew flag only matters if an effect requires it; conditions contribute flags rather than running an autonomous condition engine.
- Skills use authored ranks, governing ability, class-skill flag, misc and armor/size adjustments. Class-based skill configuration and trained-only rules are future data, not inferred from a class string.
- Gestalt is not represented by an `isGestalt` boolean; track count in ordered advancement slots supplies that structure.

These omissions are preferable to spreadsheet-shaped special cases because they leave the calculation path declarative and testable.

## Trust, persistence and integration audit

The browser and TTS script are untrusted clients. They may request a plan and submit raw physical die faces, but they do not hold rules authority. `roll-plan` reloads the authored character and creates the plan server-side. `resolve-roll` reloads the character, rebuilds the plan from the submitted plan's own context (never from its modifier or provenance), validates the submitted faces against that rebuild, resolves the roll, and records the result in `roll_history`. The TTS script contains UI, die spawning, settle detection and transport only; it does not contain PF formulas or a service-role key.

Supabase stores authored character inputs, feature state, attack definitions and roll history. Derived totals are not persisted as authoritative state. Edge Function request bodies and character rows are validated before use, and the public browser/TTS credentials are bearer tokens rather than service-role credentials. The remaining production work is operational—short-lived token issuance, row-level policy review, rate limiting, replay/idempotency policy and deployment secrets—not a reason to move rules into clients.

The HP migration preserves pre-`cacd050` rows by reconstructing `damage_taken` from the old derived maximum (`base_hp_before_con` plus the old effective base Constitution modifier) before dropping absolute `current_hp`; it also converts legacy baseline-effect names and makes manual baseline columns nullable for advancement mode.

## Maintainability decisions

The core remains small and auditable, with advancement isolated in its dedicated module and content isolated in `rules-data`. If conditions, equipment or operation types are added, continue splitting along those boundaries (`reducers`, `provenance`, `advancement`, `defense`, `combat`) before the code becomes the new spreadsheet. The current tests exercise the invariants that should survive that split: typed reduction, replacement, dependency propagation, explicit AC contexts, nested provenance, character-global progression levels, whole-track aggregation, N-track persistence, contextual action membership, deterministic outcome classification and TTS roll-plan parity.

## Recommended next increments

1. Resolve opposed maneuvers: size-limited maneuver legality, maneuver defense DCs and grappled/entangled action restrictions on top of the existing `RollContext.maneuver`.
2. Model concealment, cover and miss chance as explicit defense/roll contexts rather than modifier guesses.
3. Derive off-hand and two-weapon sequence limits so a selected off-hand weapon stops being authored as a full independent sequence.
4. Let an action offer its critical damage plan automatically: the authored `criticalMultiplier` exists (`criticalDamage`), but a caller must still ask for it after resolving a `criticalSuccess`, and precision damage is currently multiplied with everything else.
5. Expand validated progression content and add HP-from-HD without changing the global-level/track aggregation contract.
6. Add authenticated campaign/player binding and persistence policies around the existing TTS trust boundary; the demo mode above is deliberately unauthenticated, and cloud mode still relies on deployment-side policy.
7. Give samples the same treatment as authored sheets once character creation exists: point-buy/rolled ability generation, race selection and a feat picker would let a sample be generated instead of hand-authored.
