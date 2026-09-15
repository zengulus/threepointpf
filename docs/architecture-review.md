# 3.PF architecture review

Reviewed: 2026-09-15

This review compares the implementation with the supplied `Pathfinder Autosheet v6.2.1` workbook and the current vertical-slice brief. The workbook remains a behavioral reference, not a runtime dependency.

## Overall assessment

The architecture is sound for a first slice. The most important boundary is already in place:

`authored inputs → enabled features → typed contributions → reducers → derived values → roll plans`

`packages/rules-core` is pure TypeScript. React, Supabase, browser dice and Tabletop Simulator consume it rather than reimplementing formulas. Stable target IDs make the dependency graph explicit, and Zod validation is used at persistence and Edge Function boundaries. This gives the project a good path from the workbook's fixed columns and rows to declarative feature data.

## Corrections made in this pass

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
| `attack.*` | authored BAB |
| `damage.*` | 0 |

This is deliberately uniform and is covered by tests for ability scores, saves, HP and speed. Set is suitable for future authored overrides such as a feat, template or alternate progression without silently double counting the old baseline.

### Grant retained for future use

`GrantEffect` stays in the schema because future spellcasting, class-feature and capability work will need it. It is not coerced into a numeric modifier. `RulesEngine.grants()` and `DerivedCharacter.grants` expose active grants with their source, while no current derived total consumes them. Disabled features do not emit grants. This keeps the future capability without inventing v0 math.

### AC applicability is explicit

AC context is represented as `normal`, `touch` or `flatFooted`. A modifier targeting `ac` must carry a non-empty `appliesTo` list; omitted applicability is rejected and can never expand to all contexts. The engine never infers context from `bonusType`: an untyped or armor bonus can be scoped explicitly, and a deflection or dodge bonus can be explicitly included in touch AC.

`ac.natural` is a target-specific natural-armor component. It is included in normal and flat-footed AC and excluded from touch AC. This prevents natural armor from being accidentally treated as a general AC modifier while keeping its Pathfinder behavior visible in the target vocabulary.

### HP meaning is explicit

The authored fields are `baseHpBeforeConstitution`, `hitDiceCount`, `damageTaken`, and `temporaryHp`. `maxHp` is derived as the baseline plus the effective Constitution modifier once per hit die. `currentHp` is derived from `maxHp - damageTaken`, so a temporary Constitution change updates current HP consistently without rewriting damage state; temporary HP remains a separate value. The web and TTS state contracts receive the derived HP state from the TypeScript engine.

### Provenance preserves dependencies

Top-level contributions sum exactly to the displayed scalar after typed reduction. Derived ability contributions contain nested evidence, for example:

`attack.melee +4 STR modifier → STR score 18 → base STR 18`

The nonlinear modifier node carries the formula note `floor((score - 10) / 2)`. Nested children are explanatory evidence; they are not added a second time to the parent total. This preserves source traceability without corrupting arithmetic.

### Attack tags are classifications

Attack tags are now a narrow union (`weapon.melee`, `weapon.ranged`, `weapon.two-handed`, `weapon.off-hand`, `natural.attack`). They describe an attack entry; they do not add numeric semantics. Numeric effects still target stable IDs such as `attack.melee` and `damage.melee`. Mode is explicit or inferred from `weapon.ranged`.

## Workbook parity scenarios

`tests/fixtures/autosheet-scenarios.json` records the intended outcomes for plain base values, Heroism, Haste, Power Attack, the Rage equivalent and same-type reduction. These are small parity anchors extracted from the workbook's base/effect-table/quick-toggle behavior. `tests/fixtures/roll-contract.json` anchors the physical-die contract: the client sends raw faces and the rules-bearing resolver applies the modifier.

## Pathfinder calculations that are intentionally limited in v0

The following are known scope boundaries, not hidden assumptions:

- BAB, base saves and HP-before-Constitution are authored inputs. Class charts and level progression from the workbook are not yet a progression engine.
- AC supports the current base, Dexterity, natural armor and explicit AC effects. Armor/equipment inventories, shield handling, size, concealment, cover, conditions and special defenses are not yet modeled.
- Movement currently reduces additive speed contributions. Multipliers, caps and all non-land modes need a future operation model; the target IDs already leave room for those modes.
- Attacks currently derive one attack modifier and one damage modifier per entry. Iterative attacks, two-weapon penalties, critical rules, ammunition, range and special attack text are outside this slice.
- Skills use authored ranks, governing ability, class-skill flag, misc and armor/size adjustments. Class-based skill configuration and trained-only rules are future data, not inferred from a class string.
- Gestalt is not represented by an `isGestalt` boolean. Future advancement tracks/slots should contribute progression data to the same baseline targets.

These omissions are preferable to spreadsheet-shaped special cases because they leave the calculation path declarative and testable.

## Trust, persistence and integration audit

The browser and TTS script are untrusted clients. They may request a plan and submit raw physical die faces, but they do not hold rules authority. `roll-plan` reloads the authored character and creates the plan server-side. `resolve-roll` reloads the character, rebuilds the plan from its metadata, validates the submitted faces, resolves the roll, and records the result in `roll_history`. The TTS script contains UI, die spawning, settle detection and transport only; it does not contain PF formulas or a service-role key.

Supabase stores authored character inputs, feature state, attack definitions and roll history. Derived totals are not persisted as authoritative state. Edge Function request bodies and character rows are validated before use, and the public browser/TTS credentials are bearer tokens rather than service-role credentials. The remaining production work is operational—short-lived token issuance, row-level policy review, rate limiting, replay/idempotency policy and deployment secrets—not a reason to move rules into clients.

## Maintainability decisions

The core remains a single small module in this pass because its dependency stages are still easy to audit together and the public API is compact. If class advancement, conditions, equipment or operation types are added, split it along those boundaries (`reducers`, `provenance`, `advancement`, `defense`, `combat`) before the file becomes the new spreadsheet. The current tests exercise the invariants that should survive that split: typed reduction, replacement, dependency propagation, explicit AC contexts, nested provenance, active grants and roll-plan parity.

## Recommended next increments

1. Add declarative advancement tracks and a typed operation layer for multipliers, caps and conditional effects.
2. Add equipment/armor/shield inputs and source-specific AC applicability using the same contribution tree.
3. Expand attack entries to iterative/full-attack and critical metadata without adding numeric meaning to tags.
4. Add authenticated campaign/player binding and persistence policies around the existing TTS trust boundary.
