# 3.PF architecture review

Reviewed: 2026-09-15

Updated: 2026-09-18 (combat-context pass: CMD derivation, ability penalties, selectors, contextual actions, module split)

Updated: 2026-09-18 (roll-contract pass: actors/actions/targets in context, per-step roll plans, semantic outcomes, authored critical ranges; damage and initiative plans complete an action's roll list)

Updated: 2026-09-18 (roll-presentation pass: the landed dice carry their own values — the number and the flourish are Three.js objects parented to the die meshes — and those values then hand off to the result drawer's arithmetic)

Updated: 2026-09-18 (appearance pass: the dice drawer is the whole roll surface, and the selected table surface and die colours are applied to the renderer's own Three.js scene rather than around it)

Updated: 2026-09-22 (application-shell pass: one reusable sheet view is framed full-page or in a floating workspace window without duplicating state, roll presentation, or panel markup)

Updated: 2026-09-22 (character-lifecycle pass: campaign policy and pure creation/advancement proposals turn back into ordinary authored character state without adding a wizard UI)

This review compares the implementation with the supplied `Pathfinder Autosheet v6.2.1` workbook and the current vertical-slice brief. The workbook remains a behavioral reference, not a runtime dependency.

## Overall assessment

The architecture is sound for a first slice. The most important boundary is already in place:

`authored inputs → enabled features → typed contributions → reducers → derived values → roll plans`

`packages/rules-core` is pure TypeScript. React, browser dice and the deferred Tabletop Simulator prototype consume it rather than reimplementing formulas. Stable target IDs make the dependency graph explicit, and Zod validation is used at persistence and shared API boundaries.

## Corrections made in this pass

### Advancement tracks

Advancement is represented as ordered `AdvancementSlot[]`. Each slot contains any number of named `AdvancementTrack` entries, so track count expresses normal, gestalt, tristalt, or another campaign structure without an `isGestalt` boolean. An entry references a `ProgressionDefinition` supplied by an injected catalog. `rules-core` owns no class corpus; `rules-data` validates the Autosheet-derived Fighter, Rogue, and Wizard chassis facts and their source rows.

Progression/class levels are character-global in ordered slot/track traversal. Each cumulative chassis delta is credited to the track that occupies the entry, so moving Fighter between tracks never restarts its good-save or fractional-BAB progression. Aggregation is then property-specific: BAB chooses the highest complete track total, each save chooses its highest complete track total, and hit dice provide one die per slot using the highest die type available in that slot. BAB is never maximized independently at each slot, so staggered fractional tracks cannot manufacture full BAB. The selected track, global levels, and individual increments appear as nested provenance. The evaluator also retains the winning HD and skill-point chassis for each slot, including their progression and track sources, so a lifecycle policy can explain its HP and skill decisions without recalculating advancement.

### Character lifecycle and campaign policy

A class is one kind of `ProgressionDefinition`, not a privileged application primitive. An imported class, prestige class, monster class, racial progression, or locally authored homebrew progression enters the same injected catalog and the same ordered-track evaluator. There is no `isMonsterClass` or `isGestalt` branch: campaign topology and content are data.

`CampaignCharacterProfile` is the small caller-supplied policy boundary for creation and level-up. It declares the named advancement tracks and starting level, which catalog sources/progressions are offered, the HP-acquisition policy, the skill-allocation policy, and whether an explicit manual/GM override is permitted. It is deliberately not a universal Pathfinder legality schema or a required cloud campaign record. A trusted table can express its own N-track, homebrew-heavy rules without teaching React, persistence, or the evaluator a special case.

The lifecycle is a collection of pure domain transactions, not a second mutable character model:

`beginCharacterCreation` / `proposeCharacterCreation` / `validateCharacterCreation` / `previewCharacterCreation` / `commitCharacterCreation`

`beginAdvancement` / `proposeAdvancement` / `validateAdvancement` / `previewAdvancement` / `commitAdvancement`

Creation begins from an empty proposal under a profile; its incomplete fields retain `CharacterInput` names and materialize directly into a candidate `CharacterInput` as choices arrive. Advancement begins from an existing `CharacterInput` and proposes exactly the next ordered slot. Both can be inspected or abandoned without mutating the input character, and neither introduces a separate builder format that later needs conversion. The proposal accepts progression choices by track, feature/choice selections where the current content can express them, HP acquisition, skill ranks, and explicit overrides; the existing advancement evaluation supplies global progression levels, unlocked features, winning chassis and provenance.

Choice requirements are structured domain data, not raw form paths: a requirement identifies its slot/track/progression source, exposes its available options and explanatory text, and records a selection with provenance. That is enough for a future UI to say “choose a progression for Track B” or “this monster level grants one adaptation” without encoding a Pathfinder-specific picker. Features whose source is only prose still remain visible unlocks rather than fabricated mechanics.

Validation returns structured issues rather than making every unproven rule a hard failure. Malformed IDs, unknown progressions, illegal topology, duplicate tracks, and invalid data shape are structural errors and block commit. A budget overage, unmodelled prerequisite, unusual progression combination, or manual allocation can instead be a policy warning when the profile allows an explicit override. An override names what was accepted and why, and is retained as lifecycle provenance; it cannot turn an unrelated structural error into a valid character.

Preview compares the before and candidate evaluations as semantic changes rather than asking a future UI to diff the entire derived tree: character and progression levels, winning BAB/save/HD/skill chassis, newly unlocked features, HP acquisition, skill budget/allocation, and structured warnings are all visible. Commit returns the candidate as ordinary authored state. Only durable lifecycle facts — for example a per-slot HP gain, a rank allocation, selected option, or override note — belong in optional `CharacterInput.lifecycle` facts; an open step, temporary proposal, or UI route does not.

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

HP acquisition is a lifecycle decision, distinct from runtime health. A campaign profile can require maximum first level, a fixed/average amount, a caller-supplied roll, or an explicitly manual gain. For an advancement slot the lifecycle reads the evaluator's winning HD source, records the accepted pre-Constitution gain with its policy and slot/track/progression provenance, and updates the ordinary `baseHpBeforeConstitution` baseline on commit. This makes a gestalt or N-track result explainable without silently choosing one table-wide HP convention.

Runtime health remains the existing authored/derived boundary: `baseHpBeforeConstitution`, `damageTaken`, and `temporaryHp` describe the durable HP state; manual mode additionally accepts `baseBab`, `baseSaves`, and `hitDiceCount`. `maxHp` is derived as the baseline plus the effective Constitution modifier once per hit die. `currentHp` is derived from `maxHp - damageTaken`, so a temporary Constitution change updates current HP consistently without rewriting damage state; temporary HP remains separate. The lifecycle does not add a second damage tracker.

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

Provider-neutral roll request, validation, and plan-building contracts remain in `packages/shared`. The browser builds and resolves ordinary rolls locally. An authoritative remote roll service can reuse those contracts if TTS or multiplayer resumes; the frozen TTS client is not a current deployment target (see `docs/open-decisions.md`).

### Abilities, resources, and composed damage

An ability is a named semantic object, not an alias for one effect. `AbilityDefinition` is imported catalog content; `AbilityInstance` records possession and may instead carry a complete character-local editable definition. An ability declares `passive`, `toggleable`, or `activated` semantics, zero or more ordinary typed `Effect` values, and zero or more `ResourceCost` references. Passive ability effects always enter the existing effect pipeline, toggleable effects enter it only while the instance is active, and activated abilities spend their costs without pretending to be a persistent toggle. Legacy `FeatureInstance` values remain valid and use the same reducer pipeline.

Resources are independent authored objects. `ResourceDefinition` owns identity, display text, a fixed/manual/derived maximum, and a refresh rule; `ResourceState` owns only mutable spent and timer state. Derived maxima can compose a base with explicit constants, ability modifiers, and character-global progression levels. `DerivedResource` reports maximum, spent, remaining, refresh metadata, and maximum provenance. Spending never rewrites capacity. Pure resource operations support spend, restore, set, manual refresh, event refresh (`round`, `encounter`, `rest`, `daily`), and round advancement for fixed intervals and deterministic recharge-roll timers. Ability activation validates every cost before returning a new character snapshot, so a failed multi-resource activation cannot partially spend anything. Turning off a toggle costs nothing; turning it on pays once rather than evaluation or React renders consuming a resource.

`damageDice` is a first-class effect with a damage target, `DiceExpression`, optional damage type/label, contextual applicability, source, and explicit `normal` or `notMultiplied` critical behavior. Damage evaluation and `RollPlan.provenance.damageTerms` retain separate sourced terms: weapon base dice, flaming dice, precision dice, and stance dice do not collapse into an average or an anonymous combined expression. Critical plans multiply only `normal` terms; precision-style terms remain one copy. Numeric damage contributions continue through the existing contribution reducer and follow the weapon/profile's authored critical multiplier.

The expert Features tab now contains structured resource and ability editors. Resources expose capacity policy, refresh, remaining/spent state, and manual controls. Abilities support catalog addition, catalog-to-local cloning, editing, multiple reorderable effects, costs selected by resource name/ID, activation, and typed applicability fields. Referenced resources cannot be silently deleted. Local abilities/resources and mutable use state travel in the existing atomic `CharacterInput` snapshot; editor drafts do not. Older snapshots omit the optional collections and retain their exact legacy feature behavior.

This is intentionally a spellcasting seam, not a spellcasting implementation:

```text
spellcasting source → slot/spell-point resource → spell ability → resource cost → roll/effect execution
```

Spell level metadata, prepared/spontaneous progression, spells known/prepared, spellbooks, caster-level rules, concentration, DC construction, metamagic, and full spell lists remain dedicated future concepts. They should reference this resource/activation layer without erasing spell-specific identity.

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

Shared roll requests describe action context and defense, never client-supplied modifiers. `packages/shared` validates those requests and can rebuild plans from canonical authored state. The browser uses the same local rules engine for its standard roll flow. A future remote roll service must validate the context and derive modifiers independently; its authorization and target-state policy remain future work.

### Browser and hosted modes, samples and presentation boundaries

`sheetModeFor` selects only the explicit `VITE_APP_MODE=hosted` value; otherwise the app stays in browser mode. GitHub Pages builds explicitly select browser mode and never call the hosted API. Browser persistence uses localStorage with an in-memory fallback. Hosted persistence uses same-origin `/api/characters` requests and relies on the Site shell's secure cookie session. The host can inject a repository, mode, character identity, and an authentication-required callback without exposing its auth implementation to the rules engine.

Samples are ordinary authored `CharacterInput` values in `lib/sample-characters.ts`, and the landing sample is a level 1 human fighter on the elite array: Power Attack from the curated catalog, Weapon Focus and Toughness as homebrew effects, the curated greatsword (two-handed profile: 1.5×STR) and chain shirt, and one level of the fighter progression so BAB, saves, save DCs, hit dice, class skills and skill points are derived rather than typed in. The sample therefore exercises both content paths — curated and authored — and a test pins its derived sheet (AC 15, 15 HP, +4 to hit, 2d6+7) so an engine regression shows up as a wrong sample.

Two user-facing choices are deliberately *not* character state and have their own storage keys: dice presentation (`threepointpf.dice.presentation`) and the selected sample (`threepointpf.sheet.sample`). The sample selection is browser-scoped so a reload returns to the sheet the user was on, while a saved `CharacterInput` remains the only thing a character owns.

### Reusable sheet and application-shell boundary

`App` accepts an optional authored `characterId`: a host that owns character selection can supply it, while the standalone demo omits it and keeps the existing sample-picker flow. `AppShell` creates the one `useCharacterSheetController` instance and its one dice presentation for that identity. It passes the controller to `CharacterSheetView`, the sole implementation of the sheet's header, tabs, panels, inspectors, and roll controls.

`FullPageSheet` and `CharacterSheetWindow` are presentation frames around that same view; neither owns a second character, controller, rules evaluation, or dice surface. `AppShell` also renders the single application-level `DiceOverlay`, outside either frame, so moving between full-page and windowed presentation cannot create a duplicate overlay or split roll state. The active tab belongs to the shell so it follows the same controller across both frames.

Workspace mode, whether the window is open or minimized, and its bounds are transient shell state: they are not fields of `CharacterInput`, are not persisted, and are not part of a roll request. The workspace is intentionally a neutral future tabletop placeholder, not an implemented VTT: there is no map, token, campaign, multiplayer, or tabletop persistence model hidden behind the window chrome.

The Pages workflow builds with a relative base (`vite build --base=./`) so the same artifact works from a project subpath, and the presentation layer follows `import.meta.env.BASE_URL` when it resolves the renderer's texture and sound directory, so the demo's 3D dice work at `/threepointpf/` exactly as they do at the root.

That claim is checked rather than asserted. `scripts/check-demo-base.mjs` (`pnpm check:demo`) mounts the built artifact at a real `/threepointpf/` prefix, refuses any site-absolute asset reference the document asks for, and fetches the dice textures and sounds back from that path — because a base-path regression is invisible to every other test. A blank page and untextured dice only appear at the published URL, so the check runs in CI and in the Pages workflow, against the same artifact that gets uploaded.

Publishing additionally needs the repository's Pages build source set to GitHub Actions. A repository can have Pages enabled and still not publish this workflow: a branch-based Pages site looks healthy while serving something else entirely, and `actions/configure-pages` reports that as an opaque failure. So the workflow verifies the deployment source first and stops with the exact setting to change, rather than uploading an artifact nothing will serve. The setting itself is a repository property, not a file, so it is the one step a human has to take; the README states it once.

### The 3D dice boundary

The renderer sits behind `DicePresenter`, and everything crossing that boundary goes one way: authoritative faces are generated and resolved first, the renderer is handed exactly those faces (`NdS@f1,f2,…`), and what it reports back is only ever compared with what it was given. Five properties of the real `dice-box-threejs` renderer are handled explicitly because the library does not:

- It resolves a throw with `sets[].rolls[].value`. The handoff reader accepts that shape and treats every other shape as *unreported*, so a renderer upgrade can never be mistaken for agreement about the faces.
- It takes a whole roll as one notation string with a single face list, so a plan with several dice groups is still one throw (`1d20+2d6@17,4,3`), with the faces applied by die in group order. Multi-dice plans therefore do not fall back: a plan is presentable whenever it needs dice at all, and only a plan that needs none has nothing to land on. The renderer does draw repeated die types as one merged group (`1d6+1d8+1d6` lands as `2d6 + 1d8`), which is unobservable while a plan has one die type per group and, when it is not, changes only the shape drawn against each face — the flattened order that resolution used, and that the handoff check compares, is preserved.
- It owns one stage, one physics world and one animation loop, so presentations are queued. A second throw waits for the first to land instead of interrupting it mid-flight and reporting the wrong faces.
- It resolves its container once, when it is constructed. The overlay unmounts its stage between rolls, so a remounted stage is a different container; reusing the cached renderer would animate a detached element and report a rendered throw with no dice on screen, so a changed stage rebuilds the renderer the same way a skin change does.
- It subscribes to `window` resize without ever unsubscribing and exposes no `dispose()`. The wrapper captures the listeners registered during `initialize()` and, on teardown, removes them, stops the loop, drops the physics bodies, detaches the canvas and releases the WebGL context. Without that, every skin change would leak a listener, a canvas and a GL context.
- Its `theme_surface` selects the impact *sounds* only, and the scene's visible surface is a `ShadowMaterial` backdrop that draws nothing but the dice's shadow — the selected table never appears, and neither the spotlight nor the ambient light changes with it. The surface is therefore applied to the scene itself: the adapter dresses that shadow-catching mesh in a plate wearing a generated table texture (wood grain, felt fibre, brushed hairlines, a neon grid, stone speckle) cloned from one of the renderer's own die materials so the surface is drawn by the same rendering path as the dice. The light is one fixed neutral setup for every surface, so switching the desk never recolours the dice, and the plate material's properties are overwritten from the surface spec so a glass or metal *die* cannot decide the table's material class. The mesh and its geometry stay the renderer's, so it keeps catching the shadow, and the plate and its texture are the adapter's own, released on a surface change, on teardown, and on the resize that makes the renderer rebuild its surface.
- Its die materials multiply the baked face texture by the preset's own tint (`0xB5B5B5` matte, `0xDDDDDD` metal) and, for the metallic presets, scale that texture away with a `metalness` that has no environment map to reflect — which is why authored colours arrive washed out. The adapter wraps the renderer's own material builder, the one path a new die and an in-place reroll both pass through, and whitens the tint and scales the metalness down, leaving roughness, specular and bump mapping to keep the material presets distinct.
- Its outline colour was a hairline: numerals are baked into the die's texture and upstream stroked them at a fixed five pixels against a glyph hundreds of pixels tall, which no die this size shows. The adapter derives the outline automatically from the foreground's sRGB luminance — dark ink under light numerals, off-white under dark ones — and a committed pnpm patch widens the stroke so it scales with the glyph (and treats busy textures such as skulls or dragon scale as needing a wider one). The skin therefore still has no outline axis: contrast is a defect to fix, not a preference to expose. The axes that do reach the die are the numerals, the body and the chamfered edges.

The overlay is one dice drawer, not a table beside a result panel: the dice, the arithmetic they hand off to, the modifier, the total and the outcome all live inside it, and the drawer's contents change as the roll resolves. There is no separate card, HUD, corner summary or toast, and no second surface to fall out of step with the first.

The die-local half of the sequence is not drawn by the app at all. `DicePresenter.presentDieValues` takes the authoritative faces once the throw has landed, and the adapter builds a textured `CanvasTexture` plane per value with the renderer's *own* geometry, attribute, texture and mesh constructors — read off the landed die mesh, so the objects join the same three.js instance as the scene they are added to and no module needs a three.js import. Each value is added as a child of the die that rolled it, placed just above the upward face (found from the landed geometry's face groups and the die's world quaternion, the same way the renderer reads a result face) and initially parallel to it; it then rises along that face normal and turns to face the camera with the view's own up axis. Parenting rather than projecting is the point: moving the die mesh carries the value with it through the scene graph.

The flourish is a die-local effect too, emitted by the mesh: a ring quad parented to the natural die with additive blending, plus an emissive pulse on the die's own materials (saved and restored around it). No DOM element is positioned near a die, and `.dice-burst` no longer exists.

Values still never cross the boundary in either direction. The request carries resolved faces only; the renderer contributes placement and transforms, and the presentation reports nothing about the dice back to the app. Nothing appears until the landed die has held still for consecutive animation frames (and no later than a bounded timeout), so a value cannot appear while its die is visibly moving, and reduced motion, a fallback, a renderer without a scene, or a runtime without animation frames simply declines the die-local phase — in which case the overlay shows the same values, arithmetic and outcome directly. Because the renderer's own loop has already stopped when the dice settle, the presentation drives the draw loop while it is on screen, and releases every temporary geometry, material, texture and object when it hands over, is interrupted by the next throw, or is disposed.

The draw loop, canvas factory and clock are injectable through the renderer factory, so the whole of the above is covered by tests without WebGL: a small real three.js stand-in supplies the transforms, and the response-shape tests still build the object upstream really sends rather than a hand-written approximation. The surface and the die colours are the exception, because a mock cannot show that a theme reached the scene: the browser suite asserts them against the composited pixels of the dice stage — a felt-green table against a bright steel one, a red-bodied die against a blue-bodied one — while a throw is on screen.

### Module boundaries

`packages/rules-core/src/index.ts` is now a re-export surface. The evaluator is split along domain boundaries: `contributions` (typed reduction and the contribution vocabulary), `labels`, `effects` (collection, contextual applicability, operations), `abilities`, `defenses`, `skills`, `size`, `equipment`, `attacks`, `outcomes` (policies and effective critical ranges), `experience`, `advancement`, `lifecycle` (campaign profiles, proposals, validation, previews and commits), and `character` (orchestration). The lifecycle depends on the evaluator; the evaluator does not depend on a lifecycle UI. Domain modules remain provider-neutral TypeScript and are consumed by the browser and shared contracts. On the web side, `apps/web/src/App.tsx` is the small public composition entry point; `AppShell` owns application presentation, `CharacterSheetView` owns the reusable sheet DOM, presentation frames live in `components/sheet-presentations.tsx`, and authored-state/rules wiring remains in `hooks/useCharacterSheet.ts` and `lib/`. Both splits were made mechanically and the existing unit, pipeline and browser suites were the guardrail.

## Workbook parity scenarios

`tests/fixtures/autosheet-scenarios.json` records the intended outcomes for plain base values, Heroism, Haste, Power Attack, the Rage equivalent and same-type reduction. These are small parity anchors extracted from the workbook's base/effect-table/quick-toggle behavior. `tests/fixtures/roll-contract.json` anchors the physical-die contract: the client sends raw faces plus a contextual plan, and the rules-bearing resolver applies the modifier and classifies the outcome.

## Pathfinder calculations that are intentionally limited in v0

The following are known scope boundaries, not hidden assumptions:

- HP acquisition is policy-driven in the lifecycle: a committed per-slot gain contributes to the authored pre-Constitution baseline, while damage and temporary HP remain runtime state. Manual BAB/saves/HD are retained for legacy mode; validated Autosheet chassis data supplies advancement BAB, saves, HD count, HD sources, and skill-point chassis sources. Rolling integrity, every average convention, and exotic HP systems remain campaign-policy choices rather than a universal rule.
- AC supports the current base, Dexterity, natural armor and explicit AC effects. Armor/equipment inventories, shield handling, size, concealment, cover, conditions and special defenses are not yet modeled.
- Movement currently reduces additive speed contributions. Multipliers, caps and all non-land modes need a future operation model; the target IDs already leave room for those modes.
- Attack entries now derive an action: a standard attack, a full attack with BAB iteratives and explicit extra attacks, or a maneuver, each producing explicit roll plans with semantic outcomes, and each step also carrying the damage roll it deals. Critical damage is the damage rolled twice, expressed by the plan rather than by a caller. Two-weapon fighting penalties, off-hand sequence limits, precision-damage exemptions from critical doubling, ammunition, range increments and special attack text are still outside this slice.
- CMD consumes the applicable AC categories semantically, but cover, concealment, miss chance and special defenses are not modeled, and maneuver resolution stops at the CMB/CMD modifier: opposed checks, size limits ("cannot trip a creature two sizes larger") and maneuver defense DCs remain author reminders.
- Situational flags are authored slugs. There is no registry, so a homebrew flag only matters if an effect requires it; conditions contribute flags rather than running an autonomous condition engine.
- Skills use authored ranks, governing ability, class-skill flag, misc and armor/size adjustments. Lifecycle policy can expose a per-slot budget, validate an allocation, and record an override, but it does not claim to settle every PF1e/3.5 cap, fractional-rank, trained-only, or variant-skill rule. Those remain explicit campaign/content choices rather than inferred from a class string.
- Gestalt is not represented by an `isGestalt` boolean; track count in ordered advancement slots supplies that structure.

These omissions are preferable to spreadsheet-shaped special cases because they leave the calculation path declarative and testable.

## Trust, persistence and integration audit

The browser owns ordinary play calculations locally. The TTS script is a frozen prototype and its historical remote transport is not deployed by this repository. Provider-neutral request validation and authoritative plan-building functions remain available for a future server adapter; the Site backend can add these if remote rolls resume.

Character persistence stores the complete canonical authored `CharacterInput`; derived totals and transient lifecycle proposals are never authoritative. The shared HTTP API contracts carry character snapshots and optional revisions, while storage schema and authentication remain host-owned. The browser sends same-origin cookie-authenticated requests and does not hold backend secrets. The Site backend must validate and authorize every request independently.



## Maintainability decisions

The core remains small and auditable, with advancement and lifecycle isolated from content in `rules-data`. If conditions, equipment or operation types are added, continue splitting along those boundaries (`reducers`, `provenance`, `advancement`, `lifecycle`, `defense`, `combat`) before the code becomes the new spreadsheet. The current tests exercise the invariants that should survive that split: typed reduction, replacement, dependency propagation, explicit AC contexts, nested provenance, character-global progression levels, whole-track aggregation, N-track persistence, proposal non-mutation, structured validation/override provenance, contextual action membership, deterministic outcome classification and TTS roll-plan parity.

## Recommended next increments

1. Resolve opposed maneuvers: size-limited maneuver legality, maneuver defense DCs and grappled/entangled action restrictions on top of the existing `RollContext.maneuver`.
2. Model concealment, cover and miss chance as explicit defense/roll contexts rather than modifier guesses.
3. Derive off-hand and two-weapon sequence limits so a selected off-hand weapon stops being authored as a full independent sequence.
4. Let an action offer its critical damage plan automatically: the authored `criticalMultiplier` exists (`criticalDamage`), but a caller must still ask for it after resolving a `criticalSuccess`, and precision damage is currently multiplied with everything else.
5. Expand validated progression content and choice metadata without changing the global-level/track aggregation contract; spellcasting, feat prerequisites and other large class systems still need their own schemas.
6. If TTS or multiplayer resumes, add authenticated campaign/player binding and persistence policy in the Site backend. Browser demo mode remains intentionally unauthenticated.
7. Decide whether to build a guided creation/level-up presentation on top of the lifecycle APIs. Point-buy/rolled ability generation, race selection, feat selection and full prerequisite automation remain future product/rules work; the current sheet's direct editor stays an expert surface.
