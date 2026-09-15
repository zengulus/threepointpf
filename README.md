# 3.PF character sheet

This repository contains the first vertical slice of a Pathfinder 1e / 3.PF character sheet. The rules engine is deterministic and independent of React, Supabase, browsers and Tabletop Simulator.

## Run

```bash
corepack pnpm install
corepack pnpm test
corepack pnpm build
corepack pnpm --filter @threepointpf/web dev
```

The web app starts with the integration fixture from `tests/fixtures/simple-character.json` embedded as a local draft. Save/reload uses an in-memory repository when Supabase variables are absent. To use Supabase, provide `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; only the public anon key belongs in the browser. Apply the migration in `supabase/migrations` and deploy the three Edge Functions.

The authored HP fields are `baseHpBeforeConstitution`, `hitDiceCount`, `damageTaken`, and `temporaryHp`. The derived `maxHp` adds the effective Constitution modifier once per hit die, and `currentHp` is derived as `maxHp - damageTaken`; temporary HP remains separate. `replaceBase` effects replace intrinsic baselines and competing active replacements are rejected. Generic `ac` modifiers must declare `appliesTo` contexts explicitly. `GrantEffect` is retained for future capabilities and is exposed by the rules engine without affecting current numeric totals.

Copy `tts/src/global.lua` and its embedded UI into a Tabletop Simulator global script, configure the function URL and a non-privileged bearer token, and bind the desired character id. TTS sends only raw physical die faces back to `/resolve-roll`; the TypeScript side rehydrates the character and recomputes the plan before resolving it.
