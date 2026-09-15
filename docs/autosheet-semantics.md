# Autosheet semantic notes

The supplied `Pathfinder Autosheet v6.2.1` workbook was inspected as a behavioral reference. It contains these relevant sheets: `Main Sheet`, `Equipment`, `Spells, Spheres and other stuff`, `Class Charts`, `Class Skills`, `Formula References`, plus hidden welcome/changelog sheets.

## Inputs and dependency order

The main sheet separates base ability scores from temporary effects, base BAB/saves/levels, skill ranks and equipment/attack entries. The effective ability score is calculated first; its modifier is then consumed by saves, AC, initiative, CMB/CMD, skills and attacks. This is represented in the rules core as:

`inputs → enabled feature effects → typed contributions → reducers → derived values`.

BAB and saves are manual v0 inputs here. The workbook's class charts are intentionally not imported as a progression engine; they can seed future declarative advancement data.

## Effect Table semantics

The workbook's Effect Table starts around row 70. Each row has a label, bonus type, active state, and target columns for AC/natural AC, each save, six abilities, melee/ranged attack and damage, caster level, size, movement modes, skills, and specified skills/initiative. The combat quick toggles and conditions use the same target vocabulary as ordinary buffs.

The vertical slice keeps those semantics but replaces fixed rows and spreadsheet columns with `FeatureInstance.effects`. An effect is active only when its containing feature is enabled. A Strength effect targets `ability.str` once and downstream values read the resulting Strength modifier; it is not copied into attack, damage, CMB and every Strength skill.

## Bonus reduction

The workbook's formulas reduce each typed category as the highest positive value plus negative penalties, while untyped, dodge and circumstance values sum. The reusable reducer in `packages/rules-core` follows that behavior: a `+2 morale`, `+4 morale`, `-1 morale` group resolves to `+3`; two dodge bonuses stack; two same-type penalties remain penalties. The reducer is independent of AC, saves, skills and attacks.

## Skills, movement and attacks

Skills combine ranks, governing ability modifier, optional class-skill bonus, miscellaneous and armor/size adjustments, then global/specific skill effects. No class skill is inferred from a class in v0; it is authored in `CharacterInput.skills`.

The workbook carries land/fly/swim/burrow/climb effects and condition multipliers. v0 implements additive movement targets plus a uniform replacement operation for an intrinsic speed baseline; multipliers and caps remain future work. Attack entries are modeled as data: mode, attack ability, optional damage ability/multiplier, dice, weapon bonus and classification-only tags. The rules engine derives attack modifiers and damage modifiers, rather than recreating spreadsheet attack columns.

## Replacement, grants and defense contexts

`replaceBase` replaces the intrinsic/base scalar for its target; competing active replacements are rejected, so feature-array order is not precedence. Dependent ability modifiers or ordinary contributions still apply. It is used consistently for ability scores, base saves, AC base, HP before Constitution, BAB-backed attack baselines, skill ranks, movement and other scalar targets. It does not add the old base a second time.

`GrantEffect` is retained as a non-numeric future capability. Active grants are exposed with source provenance, but no current v0 total consumes them.

AC applicability is required through `appliesTo: normal | touch | flatFooted` on generic `ac` modifiers. Bonus type does not imply AC context, and missing applicability is rejected. `ac.natural` is a distinct natural-armor target with a zero baseline that contributes to normal and flat-footed AC, never touch AC. `baseHpBeforeConstitution` and `hitDiceCount` are authored HP inputs; `maxHp` applies Constitution once per hit die, while `damageTaken` and `temporaryHp` are persisted mutable state and `currentHp` is derived.

## Deliberate discrepancies

The new model does not preserve spreadsheet-only custom-effect row limits, combined bonus categories, lookup formulas, formula-reference cells, or the workbook's gestalt switch. Those are implementation mechanisms, not the domain model. This milestone keeps BAB/saves as replaceable authored inputs so future advancement tracks can provide them without introducing an `isGestalt` foundation.
