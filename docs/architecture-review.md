# 3.PF architecture review

Reviewed: 2026-09-15

Updated: 2026-09-18 (combat-context pass: CMD derivation, ability penalties, selectors, contextual actions, module split)

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

Contextual filtering preserves provenance in both directions: `EvaluationResult.excluded` and `DamageEvaluation.excluded` report each authored-but-filtered effect with a reason (`does not apply to touch attacks`, `requires flags combat-expertise`, `excluded for tags weapon.two-handed, weapon.off-hand`), and `actionExclusions` flattens an action's exclusions for display. The sheet shows what contributed *and* why other authored effects did not.

Server authority is unchanged by the extra context: `roll-plan` accepts either an action request or a single-sequence-member request, and `resolve-roll` rebuilds the request from the plan's own metadata, so a client never supplies a modifier and every contextual plan is recomputed from authored state plus context before raw die faces are resolved. The TTS panel requests the same contextual plans, carries an explicit standard/full attack choice, and exposes maneuver buttons; it still derives no modifiers itself.

### Module boundaries

`packages/rules-core/src/index.ts` is now a re-export surface. The evaluator is split along domain boundaries: `contributions` (typed reduction and the contribution vocabulary), `labels`, `effects` (collection, contextual applicability, operations), `abilities`, `defenses`, `skills`, `size`, `equipment`, `attacks`, `experience`, `advancement` and `character` (orchestration). Each module carries a source-only `.js` bridge so the Edge Functions' Deno typecheck can follow literal `.js` specifiers into the TypeScript source, matching the existing `advancement.js`/`content.js` convention. `apps/web/src/App.tsx` is composition only: domain panels live in `components/`, and state plus rules wiring lives in `hooks/useCharacterSheet.ts` and `lib/`. Both splits were made mechanically and the existing unit, pipeline and browser suites were the guardrail.

## Workbook parity scenarios

`tests/fixtures/autosheet-scenarios.json` records the intended outcomes for plain base values, Heroism, Haste, Power Attack, the Rage equivalent and same-type reduction. These are small parity anchors extracted from the workbook's base/effect-table/quick-toggle behavior. `tests/fixtures/roll-contract.json` anchors the physical-die contract: the client sends raw faces and the rules-bearing resolver applies the modifier.

## Pathfinder calculations that are intentionally limited in v0

The following are known scope boundaries, not hidden assumptions:

- HP-before-Constitution remains an authored baseline. Manual BAB/saves/HD are retained for legacy mode; validated Autosheet chassis data now supplies advancement BAB, saves, HD count, and HD sides.
- AC supports the current base, Dexterity, natural armor and explicit AC effects. Armor/equipment inventories, shield handling, size, concealment, cover, conditions and special defenses are not yet modeled.
- Movement currently reduces additive speed contributions. Multipliers, caps and all non-land modes need a future operation model; the target IDs already leave room for those modes.
- Attack entries now derive an action: a standard attack, a full attack with BAB iteratives and explicit extra attacks, or a maneuver. Two-weapon fighting penalties, off-hand sequence limits, critical rules, ammunition, range increments and special attack text are still outside this slice.
- CMD consumes the applicable AC categories semantically, but cover, concealment, miss chance and special defenses are not modeled, and maneuver resolution stops at the CMB/CMD modifier: opposed checks, size limits ("cannot trip a creature two sizes larger") and maneuver defense DCs remain author reminders.
- Situational flags are authored slugs. There is no registry, so a homebrew flag only matters if an effect requires it; conditions contribute flags rather than running an autonomous condition engine.
- Skills use authored ranks, governing ability, class-skill flag, misc and armor/size adjustments. Class-based skill configuration and trained-only rules are future data, not inferred from a class string.
- Gestalt is not represented by an `isGestalt` boolean; track count in ordered advancement slots supplies that structure.

These omissions are preferable to spreadsheet-shaped special cases because they leave the calculation path declarative and testable.

## Trust, persistence and integration audit

The browser and TTS script are untrusted clients. They may request a plan and submit raw physical die faces, but they do not hold rules authority. `roll-plan` reloads the authored character and creates the plan server-side. `resolve-roll` reloads the character, rebuilds the plan from its metadata, validates the submitted faces, resolves the roll, and records the result in `roll_history`. The TTS script contains UI, die spawning, settle detection and transport only; it does not contain PF formulas or a service-role key.

Supabase stores authored character inputs, feature state, attack definitions and roll history. Derived totals are not persisted as authoritative state. Edge Function request bodies and character rows are validated before use, and the public browser/TTS credentials are bearer tokens rather than service-role credentials. The remaining production work is operational—short-lived token issuance, row-level policy review, rate limiting, replay/idempotency policy and deployment secrets—not a reason to move rules into clients.

The HP migration preserves pre-`cacd050` rows by reconstructing `damage_taken` from the old derived maximum (`base_hp_before_con` plus the old effective base Constitution modifier) before dropping absolute `current_hp`; it also converts legacy baseline-effect names and makes manual baseline columns nullable for advancement mode.

## Maintainability decisions

The core remains small and auditable, with advancement isolated in its dedicated module and content isolated in `rules-data`. If conditions, equipment or operation types are added, continue splitting along those boundaries (`reducers`, `provenance`, `advancement`, `defense`, `combat`) before the code becomes the new spreadsheet. The current tests exercise the invariants that should survive that split: typed reduction, replacement, dependency propagation, explicit AC contexts, nested provenance, character-global progression levels, whole-track aggregation, N-track persistence, and TTS roll-plan parity.

## Recommended next increments

1. Resolve opposed maneuvers: size-limited maneuver legality, maneuver defense DCs and grappled/entangled action restrictions on top of the existing `RollContext.maneuver`.
2. Model concealment, cover and miss chance as explicit defense/roll contexts rather than modifier guesses.
3. Derive off-hand and two-weapon sequence limits so a selected off-hand weapon stops being authored as a full independent sequence.
4. Expand validated progression content and add HP-from-HD without changing the global-level/track aggregation contract.
5. Add authenticated campaign/player binding and persistence policies around the existing TTS trust boundary.
