# 3.PF character sheet

A deterministic Pathfinder/3.PF web sheet with character-global advancement, N-track progression, inspectable calculations, custom content, and shared browser/Tabletop Simulator roll plans. Rules semantics — including the domain-only character lifecycle — live in `rules-core`; imported and authored content is injected by callers.

## ▶️ [Live demo](https://zengulus.github.io/threepointpf/)

**[https://zengulus.github.io/threepointpf/](https://zengulus.github.io/threepointpf/)** — no install, no sign-in, no database. It opens on a level 1 fighter and rolls with 3D dice.

## Try the demo

The sheet is published as a static demo on GitHub Pages at **[zengulus.github.io/threepointpf](https://zengulus.github.io/threepointpf/)** (`.github/workflows/pages.yml`), and **demo mode is the default presentation**: it needs no server, no sign-in and no configuration. The Pages build explicitly selects browser mode; unrelated environment variables cannot turn it into a server client.

Opening it lands on a **level 1 fighter sample** — elite array, Power Attack and Weapon Focus with a greatsword, Toughness, a chain shirt, one level of the fighter progression — and a second sample holds the multi-level showcase sheet. Everything is authored state: the engine recomputes every number, saves stay in that browser's storage, and switching samples is a fresh start.

The same sheet can be used full-page or in a draggable, resizable window over a neutral workspace placeholder. Those are two presentations of one character sheet, not a VTT: maps, tokens, tabletop state, and multiplayer tools are intentionally out of scope. The UI remains a client-only static artifact, so it can still be opened directly from the GitHub Pages `/threepointpf/` subpath.

```bash
corepack pnpm build:demo   # static demo build, relative base path for Pages
corepack pnpm dev          # local development, also in demo mode
```

Hosted builds select `VITE_APP_MODE=hosted` and call the same-origin Character API. Authentication belongs to the host shell and is carried by its secure session cookie. No database URL, auth SDK, or backend secret is included in the frontend.

### Publishing the demo

`.github/workflows/pages.yml` builds and deploys the site on every push to `main`. It needs one repository setting, which is not a file and so cannot be committed — **this is the only manual step**:

> **Settings → Pages → Build and deployment → Source → GitHub Actions**

A repository can have Pages enabled and still not publish this workflow: a branch-based Pages site looks healthy while serving something else entirely. So the workflow checks the deployment source before it uploads anything, and until the setting above is applied it stops there with that same instruction. Once it is applied, the next push to `main` publishes the demo, and it is served from the project subpath `/threepointpf/` — including the dice textures and sounds, which resolve against that base path rather than the site root.

## Run and verify

```bash
corepack pnpm install
corepack pnpm test
corepack pnpm build
corepack pnpm build:demo
corepack pnpm --filter @threepointpf/web build:hosted # static hosted-mode frontend
corepack pnpm check:demo      # serves the demo from /threepointpf/ and fetches its assets
corepack pnpm rules:check-autosheet
corepack pnpm exec playwright install chromium
corepack pnpm test:e2e
corepack pnpm dev
```

CI runs installation, unit/integration tests, build, generated-data freshness, Deno checks, and Chromium smoke tests. Browser tests use the production build, so build first.

## Character lifecycle API

`rules-core` provides a UI-independent lifecycle layer for character creation and level-up. It is designed for a small trusted table with unusual content, not as a universal Pathfinder legality checker or a replacement for the sheet.

A caller supplies a `CampaignCharacterProfile`: named advancement tracks, a starting level, the available injected progression/catalog sources, HP-acquisition policy, skill-allocation policy, and whether deliberate manual/GM overrides are allowed. One track, gestalt, and arbitrary N-track campaigns differ only in that profile and the ordinary ordered advancement slots; a prestige class, monster class, racial progression, imported class, and locally authored progression use the same catalog and evaluator.

The APIs follow `beginCharacterCreation` → `proposeCharacterCreation` → `validateCharacterCreation` → `previewCharacterCreation` → `commitCharacterCreation`, with the parallel `beginAdvancement` → `proposeAdvancement` → `validateAdvancement` → `previewAdvancement` → `commitAdvancement` flow for the next character-global level. Creation proposals retain the ordinary authored field names while intentionally allowing required fields to be incomplete; validation materializes the candidate `CharacterInput` only when enough facts exist. A proposal can therefore be inspected or abandoned without changing persisted state and without converting a separate builder format. Validation distinguishes blocking structural errors (bad IDs, missing definitions, invalid topology or data) from policy warnings that a permitted, named override can accept. Preview reports semantic changes — progression levels, best-track BAB/saves, winning HD and skill chassis, features, HP gain, skill budget/allocation, and issues — instead of requiring a UI to diff all derived facts.

Commit returns ordinary authored character state usable by the current sheet and repository. The sheet now offers a staged creation and level-up workflow over these APIs. Creation requires an explicit name and all six ability scores, offers one-, two-, or three-track starts, and reviews derived BAB, saves, HP, skills, and validation before commit. Level-up proposes one character-global level and commits only after validation and player confirmation. Durable choices such as a per-slot HP gain, skill allocation, selected option, or scoped override provenance may live in optional `CharacterInput.lifecycle` facts; proposal state and wizard page state never do.

## Use the sheet

- The existing advancement panel remains an expert/debugging editor. The player-facing Level Up action uses lifecycle proposals and previews and preserves damage and temporary HP when the authored maximum changes. The guided creation track selector supports single, gestalt, and three-track starts; the domain continues to support arbitrary N-track profiles.
- Open **Author a local class** to create any named progression or copy an imported one. Supply its HD, BAB/saves, class skills, skill points, optional explicit cumulative chart, and level-gated features/effects. A custom monster or homebrew progression is evaluated exactly like imported content. Local definitions are saved with the character; imported definitions are not overwritten.
- Class skills derive from all classes actually advanced. Ranks trigger the +3 bonus once. Each skill also has an explicit class-skill override for homebrew/manual use.
- Set abilities, size and five movement modes. Summary exposes current/max HP, damage, temporary HP, and damage/healing/temp HP actions. Damage consumes temporary HP first and can leave current HP negative; healing reduces damage to zero and does not restore temporary HP. These runtime values persist with the character snapshot. Add catalog conditions, armor/shields/weapons, or structured custom effects/items. Inspect combat values, abilities, damage, movement, skills and class levels for their dependency/source trails.

### Character files

Export downloads a readable `*.threepointpf.json` envelope with format `threepointpf-character` and version `1`. It contains canonical `CharacterInput`, including character-local content, lifecycle provenance, resource usage, and runtime health; derived values are recomputed after import. Import parses the envelope, rejects unknown versions, validates the `CharacterInput`, normalizes progression references against injected and character-local catalogs, then derives the sheet before saving. When the imported ID already exists, the app asks whether to import a copy with a new outer character ID; local content IDs remain stable. Files are processed in the browser, with no upload service.

This pass deliberately defers nonlethal damage, campaign profile storage, point-buy, feat legality automation, spellcasting, death/stabilization policy, and multiplayer. The demo profile is client-side and uses a simple first-level maximum/later-level manual HP policy.
- Start from a sample character (the panel at the top of the sheet). Samples are ordinary authored state, so every derived number is recomputed; **Reset sample** reloads the pristine version, and the browser remembers which sample you were on. Invalid edits retain the last valid character and show an error.
- Open **Workspace** to put that same sheet in a draggable/resizable window, or return to the full-page sheet at any time. The active tab, workspace mode, window visibility/minimized state, and window geometry are temporary UI state; they do not change or save the character.
- Optionally select an XP track. XP reports eligibility; advancing classes remains an explicit edit. Age-category adjustments are optional catalog features, not inferred from a character's race.
- **Save character** persists the sheet across reloads: to the authenticated same-origin Character API in hosted mode, and to this browser's storage in browser mode. Invalid edits retain the last valid character and show an error.

## Abilities, resources, and damage terms

The Features tab includes expert structured editors for first-class abilities and resources. An ability may be passive, toggleable, or activated; may contain several ordinary typed effects; and may consume one or more independently defined resources. Several abilities can share the same pool. Costs explicitly say `onUse`, `onActivate`, or `perRound`; activation and use are transactional, and round advancement charges active upkeep exactly once. Activated abilities return transient sourced effects/grants/roll plans without becoming active. Old saved costs without timing retain their historical activated=`onUse` and toggleable=`onActivate` behavior.

Resource maxima can be fixed, manual, or derived from an explicit base plus an ability modifier in the UI (the domain also supports progression-level and constant terms). An ability-modifier term explicitly chooses `base` (the authored score, unaffected by active effects) or `current` (the fully derived score); missing source in an older save means `current`. If a maximum falls below historical spent state, spent is preserved and remaining is clamped to zero. Refresh metadata covers manual, per-round, encounter, rest, daily, fixed-round interval, recharge-roll, and unlimited resources. Recharge rolls are ordinary typed roll plans resolved by the shared dice pipeline. Imported abilities can be added as catalog instances or cloned into local editable content; imported definitions are never mutated. Removing a resource that an ability still references is blocked with the referring ability names.

Abilities can author numeric operations, grants, threat-range changes, and additional typed damage dice with contextual filters. Damage plans retain each dice term's source, optional damage label/type, and whether it multiplies on a critical. This permits ordinary riders and precision damage to coexist without flattening them into an average or losing provenance.

Existing characters and `FeatureInstance` behavior remain compatible: `abilities`, `resources`, and `resourceStates` are optional additive snapshot fields. Full spellcasting progression is intentionally deferred. The intended next seam is spellcasting source → spell-slot/spell-point resource → spell ability → resource cost, with spell levels, preparation, known spells, caster level, concentration, save DCs, and spell lists remaining dedicated future models.

## Autosheet ingestion

The supplied `INGEST THIS - Pathfinder Autosheet (v6.2.1).xlsx` is development input, never a runtime spreadsheet engine. Generated data contains:

| Content | Imported |
| --- | ---: |
| Progressions, including third-party/FFd20 content | 259 |
| Scoped class-skill sets | 257 |
| Explicit bounded prestige charts | 89 |
| Skill definitions | 42 |
| Armor/shield chassis | 45 |
| Ability-based attack profiles | 60 |
| XP tracks | 3 |
| Age-category ability adjustments | 5 |

```bash
corepack pnpm rules:import-autosheet
corepack pnpm rules:check-autosheet
```

The importer reads cached workbook values, validates against the current schema before writing, and produces deterministic TypeScript plus a SHA-256/source-inventory report. Formula strings are never executed. Quick toggles/conditions and a small PRD weapon/magic-item supplement are reviewed ordinary data in `packages/rules-data/src/content.ts`.

See [Autosheet coverage and next frontier](docs/AUTOSHEET.md) and the [generated import report](packages/rules-data/src/generated/autosheet-import-report.json) for exact normalization, source gaps and unsupported semantics. This is a working core-sheet adaptation, not complete spellcasting/feat automation or literal cell-for-cell parity.

## Rules and persistence contract

Progression level is character-global; each increment is credited to the track occupying that slot. BAB and each save select the best **complete-track total**, not a sum of per-row winners. HD counts one die per slot, using the best die type there. `combat.bab` is a first-class derived fact consumed once by attacks, CMB and CMD. Explicit chart limits are enforced rather than extrapolated.

Character creation and advancement reuse those facts rather than maintaining a second rules engine. The lifecycle's campaign profile selects track topology and HP/skill policy; its proposal validates and previews a candidate before commit. HP acquisition records how a winning per-slot HD became pre-Constitution HP, while `damageTaken` and `temporaryHp` remain runtime state. Skill allocation can show a policy budget and allocation, while still allowing a deliberate documented override for a trusted table.

Catalog IDs distinguish sources (`pf1e.paizo.fighter`, third-party namespaces, `ffd20.autosheet.*`, `homebrew.local.*`). Historic `fighter`/`wizard`/`rogue` aliases are normalized at persistence/evaluation boundaries, including duplicate detection. Query `progression.<canonical-id>.level` or `experience.level` through the engine; neither is an authorable effect target.

Numeric order: replace the intrinsic baseline → typed additive stacking → multipliers → strongest minimum → strongest maximum. Operations contribute deltas with source evidence. Conflicting replacements/bounds and non-finite results fail explicitly. Catalog effects and custom effects use the same pipeline.

Only authored `CharacterInput` is persisted. A lifecycle commit produces that same snapshot; transient proposals, validation displays, and wizard page state are never saved. Optional lifecycle facts retain durable decisions and their provenance. Damage, temporary HP, and resource spent state are runtime facts carried in the same snapshot. Local storage uses `threepointpf.character.<id>`. The character picker lists saved snapshots, and the standalone demo resumes the last selected character after reload. A host can supply a concrete character ID to the app. Dice appearance, selected sample, and selected character use separate browser-scoped keys and never enter character state. Workspace mode, active tab, and floating-window state are deliberately not persisted at all. In demo mode a browser that refuses storage (private browsing, hardened settings) falls back to an in-memory repository so the sheet still works, just without surviving a reload. Hosted persistence sends the complete canonical snapshot through the shared Character API contract; database rows and revision tokens stay outside `CharacterInput`. Derived facts/catalog caches are never saved.

For local integration, run `VITE_APP_MODE=hosted corepack pnpm --filter @threepointpf/web dev` behind a same-origin API proxy. The Site project implements `/api/characters` and owns authentication and durable storage. The HTTP contract and status behavior are documented in [docs/character-api.md](docs/character-api.md). GitHub Pages remains browser-only. Supabase and Render infrastructure has been removed; TTS remote play remains deferred.

## Tabletop Simulator (deferred)

**Do this later.** The TTS client is gated off: it is frozen at its MVP scope (saves, one attack member with a standard/full choice, maneuvers, a single physical d20) and new roll families are not wired into it. Its script and tests are kept only so that surface cannot silently rot; see the TTS gate in `docs/open-decisions.md`.

The Lua client remains a frozen prototype with mocked transport tests. Its former remote roll endpoints are not deployed by this repository, and TTS is not usable against the new Character API yet. Shared roll-plan request and validation contracts remain provider-neutral for a future authoritative endpoint.
