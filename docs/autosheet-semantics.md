# Autosheet semantic notes

The supplied `Pathfinder Autosheet v6.2.1` workbook was inspected as a behavioral reference. It contains these relevant sheets: `Main Sheet`, `Equipment`, `Spells, Spheres and other stuff`, `Class Charts`, `Class Skills`, `Formula References`, plus hidden welcome/changelog sheets.

## Inputs and dependency order

The main sheet separates base ability scores from temporary effects, base BAB/saves/levels, skill ranks and equipment/attack entries. The effective ability score is calculated first; its modifier is then consumed by saves, AC, initiative, CMB/CMD, skills and attacks. This is represented in the rules core as:

`inputs → enabled feature effects → typed contributions → reducers → derived values`.

Manual BAB and saves remain supported for legacy mode. Advancement content is now separate from rule semantics: `packages/rules-data` validates the usable Fighter (row 10), Rogue (row 19), and Wizard (row 26) chassis facts from `Class Charts` A:H, including HD, BAB multiplier, save columns, skills/level, and source provenance. The spell references in the Wizard row are deliberately not imported.

## Effect Table semantics

The workbook's Effect Table starts around row 70. Each row has a label, bonus type, active state, and target columns for AC/natural AC, each save, six abilities, melee/ranged attack and damage, caster level, size, movement modes, skills, and specified skills/initiative. The combat quick toggles and conditions use the same target vocabulary as ordinary buffs.

The vertical slice keeps those semantics but replaces fixed rows and spreadsheet columns with `FeatureInstance.effects`. An effect is active only when its containing feature is enabled. A Strength effect targets `ability.str` once and downstream values read the resulting Strength modifier; it is not copied into attack, damage, CMB and every Strength skill.

## Bonus reduction

The workbook's formulas reduce each typed category as the highest positive value plus negative penalties, while untyped, dodge and circumstance values sum. The reusable reducer in `packages/rules-core` follows that behavior: a `+2 morale`, `+4 morale`, `-1 morale` group resolves to `+3`; two dodge bonuses stack; two same-type penalties remain penalties. The reducer is independent of AC, saves, skills and attacks.

## Skills, movement and attacks

Skills combine ranks, governing ability modifier, optional class-skill bonus, miscellaneous and armor/size adjustments, then global/specific skill effects. Ranks remain ordinary authored `CharacterInput` facts, but the lifecycle profile can derive a per-slot budget from the winning skill-point chassis, validate an allocation, and retain a deliberate override rather than forcing UI code to infer those rules. Class-skill and variant-skill interpretation remains explicit content/policy rather than a class-name heuristic.

The workbook carries land/fly/swim/burrow/climb effects and condition multipliers. v0 implements additive movement targets plus a uniform replacement operation for an intrinsic speed baseline; multipliers and caps remain future work. Attack entries are modeled as data: mode, attack ability, optional damage ability/multiplier, dice, weapon bonus and classification-only tags. The rules engine derives attack modifiers and damage modifiers, rather than recreating spreadsheet attack columns.

## Replacement, grants and defense contexts

`replaceBase` replaces the intrinsic/base scalar for its target; competing active replacements are rejected, so feature-array order is not precedence. Dependent ability modifiers or ordinary contributions still apply. It is used consistently for ability scores, base saves, AC base, HP before Constitution, `combat.bab`, skill ranks, movement and other scalar targets. It does not add the old base a second time.

For compatibility with prior saved sheets, an existing `replaceBase` on `attack.melee` or `attack.ranged` remains a per-mode replacement of that attack’s old BAB-backed baseline. New shared BAB overrides should target `combat.bab`; ordinary attacks, CMB, and CMD consume that fact once.

Advancement is an ordered array of slots, each containing named tracks with one progression entry for that slot. A progression’s level belongs to the character, not a particular track: entries are visited in slot then track order, and each cumulative-level delta is credited to the track that occupies that entry. This matters when Fighter (or any progression) moves between tracks: its second occurrence receives the level-2 delta rather than restarting at level 1. BAB and saves still select complete track totals; HD selects one best die per slot, while skill points select one highest chassis per slot. These are explicit aggregation rules, not a generic best-value reducer. `combat.bab` then owns the selected BAB baseline and is consumed once by attacks, CMB, and CMD.

The lifecycle layer consumes that same evaluator through proposal → validate → preview → commit transactions. A campaign profile supplies track topology, available imported/local progressions, HP and skill policies, and permitted manual/GM overrides. A proposal remains a candidate ordinary `CharacterInput`, so a custom or monster progression follows the same path as an Autosheet import and abandoning a proposal cannot mutate a saved character.

Progression-level queries retain every slot/track increment as provenance. Catalog feature labels, when supplied, are surfaced as metadata-only unlocks; no spellcasting, feat, or unmodelled feature mechanics are inferred from the workbook.

`GrantEffect` is retained as a non-numeric future capability. Active grants are exposed with source provenance, but no current v0 total consumes them.

AC applicability is required through `appliesTo: normal | touch | flatFooted` on generic `ac` modifiers. Bonus type does not imply AC context, and missing applicability is rejected. `ac.natural` is a distinct natural-armor target with a zero baseline that contributes to normal and flat-footed AC, never touch AC. `baseHpBeforeConstitution` is the committed authored HP baseline; lifecycle facts can explain each slot's acquisition choice (maximum, fixed, rolled/caller-supplied, or manual) from the winning HD. `hitDiceCount` is manual in legacy mode and derived from advancement slots otherwise. `maxHp` applies Constitution once per hit die, while `damageTaken` and `temporaryHp` are persisted mutable state and `currentHp` is derived. HP acquisition is therefore not a second runtime damage tracker.

## Combat and contextual semantics

The workbook's CMB/CMD columns consume the AC modifiers directly, and so does the engine: every AC modifier that applies in the normal defense context reaches CMD except armor, shield, natural-armor and size *bonuses*, while every AC penalty applies regardless of category. A `+2 deflection AC` effect therefore raises CMD without a second hand-authored `cmd` effect, and a flat-footed-only AC effect does not reach CMD. CMD-only facts, such as a maneuver-specific bonus, are still authored on `cmd`. Filtered AC modifiers are reported with a reason rather than dropped.

A negative additive modifier on `ability.*` is a temporary ability penalty and cannot reduce the score below 1; the limit appears as a `rules-core.ability-penalty-floor` provenance node. Baseline replacement is a different mechanism and is not floored, so future damage, drain or absent-ability semantics can reach 0 without changing penalty behavior.

Targets such as `skill.all` are selectors, not concrete facts. They accept additive modifiers and reject `replaceBase`, `multiply`, `minimum`, `maximum` and `grant`, which need one baseline or bound.

Effects can declare when they apply with `appliesWhen` instead of duplicating static targets: roll kind, melee/ranged, touch, required/excluded attack tags, full-attack membership, maneuver and required/excluded situational flags. The evaluated context (`RollContext`) records the same identity, which is what lets Deadly Aim exclude touch attacks, Rapid Shot require a ranged non-touch full attack, Power Attack select one-/two-handed/off-hand damage, Haste grant one shared extra attack to the action, and Dazzled penalize only sight-based Perception. An action is modeled explicitly as a standard attack, a full attack with per-weapon members and `primary`/`iterative`/`extra` steps, or a maneuver; weapon sequences are never concatenated. Both the browser and TTS request these plans from the server, which recomputes them from authored state plus context before resolving raw die faces.

## Roll and outcome semantics

Every roll is described before it is made. A `RollContext` names the actor, the action (`ActionContext`: `standardAttack`, `fullAttack`, `maneuver`, `save`, `skillCheck`, `other`, with its sequence id, position and selected weapons), the specific fact rolled (attack, save or skill identity, tags, melee/ranged, touch, maneuver, resolved flags and withheld flags) and what it is rolled against (`RollDefense`: AC in a defense context, CMD or DC). Full-attack membership is read from the action rather than duplicated, and a bare sheet query carries no action at all.

`RollPlan` then carries what the physical dice need and what the faces mean: the dice requirement, the modifier, the context above, the outcome policy, the effective critical range, and provenance for both the modifier and the range. One action produces many such plans (`ActionPlan.rolls`, with each step owning its roll), and multiple weapons remain separate members whose sequences are never concatenated. Each step also owns the damage roll it deals (`ActionPlanStep.damage`), so the action-ordered roll list is complete: attack roll, then damage roll. A critical hit is that damage plan rolled twice (`criticalDamage` doubles the dice count and the modifier) rather than arithmetic a caller performs. Damage and initiative are plain rolls — compared against nothing, carrying no defense, adding no success or failure — and initiative is requested through the same contract.

Resolution is deterministic and performs no arithmetic beyond the plan: validate the faces, sum them with the modifier, read the plan's declared primary check die, then classify. Which die carries natural-face semantics is declared (`RollPlan.primaryCheckDie`) rather than discovered by scanning for a d20: attacks, saves, skills, maneuvers and initiative declare one, and a damage roll declares none, so a d20 damage die is never read as a natural 20.

Attacks separate four facts that are easy to conflate: the raw face, threat-range membership, the automatic-hit/miss rule, and the total against the supplied defense. A natural 20 hits outright and crits when it is in range; a natural 1 misses outright and is classified as a critical failure; an in-range face that is not a natural 20 must still beat the AC to be a critical hit, and with no known AC the hit and critical stay unresolved. PF1e saving throws always succeed on a natural 20 and always fail on a natural 1, whatever the DC, and the face fact stays visible next to that automatic rule; skills have no such automatic faces, so a natural 20 that misses a DC is a failure that happens to be a natural 20. This campaign uses no critical confirmation, so a threat resolves immediately and resolution never rolls a second die.

A threat range is authored on the weapon or profile (`19`, `18`, or the default `20`) and is never inferred from a weapon's name. The effective range is derived through ordinary rules machinery: a contextual `criticalRange` effect expands eligible attacks, effects outside the context are reported as exclusions, and the effective range is clamped to 2–20. An expansion is either a flat widening (`widenBy`) or a doubling of the weapon's own range (`operation: "double"`), which is how Improved Critical and Keen are expressed, and it can name specific weapons through `appliesWhen.attackIds`. Expansions do not stack: the most expansive eligible one applies and the others are excluded with the reason they lost. Expanding a range expands *threats*, not automatic hits.

Damage is planned the same way. The dice are the weapon's own, and a critical hit uses the weapon's or profile's authored `criticalMultiplier` (default ×2) rather than a hardcoded doubling.

Clients request rolls by context and submit only raw faces. The Edge Functions reload authored state, rebuild the plan from the submitted context, and ignore any submitted modifier, provenance or outcome; contradictory contexts (a save compared against an AC, a touch attack against a non-touch AC, a standard attack with several weapons) are rejected rather than reinterpreted.

## Deliberate discrepancies

The new model does not preserve spreadsheet-only custom-effect row limits, combined bonus categories, lookup formulas, formula-reference cells, or the workbook's gestalt switch. Those are implementation mechanisms, not the domain model. This milestone keeps manual BAB/saves/HD as an explicit compatibility mode while advancement tracks and lifecycle policy provide the same baseline facts without introducing an `isGestalt` foundation or a separate builder character.
