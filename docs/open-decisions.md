# Open rule and product decisions

These decisions are genuinely unresolved. Each entry states the options and what
the code does in the meantime, so ordinary implementation work never has to stop
for them. Content-policy items (ingestion exclusions, HP/skill allocation,
missing class-skill rows, large class systems) live in `AUTOSHEET.md` and are not
repeated here.

## Rule semantics

1. **Opposed maneuvers and maneuver legality.** The engine computes a contextual
   CMB/CMD modifier, but not the opposed check, the size limit ("you cannot trip
   a creature more than two sizes larger") or the defender's maneuver DC.
   Options: keep it at the modifier plus an author reminder, or add a
   `ManeuverResolution` that carries actor/target contexts and automatic
   success/failure rules. Today a maneuver is a contextual CMB plan and the
   table adjudicates the rest.
2. **Multiple extra-attack sources.** Haste grants exactly one extra attack per
   full-attack action (decided, and covered by tests). Whether Rapid Shot, Haste
   and a future *speed* weapon stack, or whether extra attacks of the same class
   are exclusive, is authored per feature today because the answer is
   campaign-specific. If stacking becomes a rule, it needs an explicit
   extra-attack category on the effect rather than tag heuristics.
3. **Damage, drain and absent abilities.** The ability-penalty floor
   deliberately exempts baseline replacement so these mechanics stay
   representable, but nothing yet models them. The open question is whether they
   are a `replaceBase` on `ability.*` (today's escape hatch), a distinct
   operation such as `reduceMax`, or damage tracked separately from the score.
4. **Touch as an attack property vs a defense context.** A touch attack carries
   `RollContext.touch` while "touch AC" is a defense context. Whether an effect
   could key on the *attacker's* touch flag instead of the roll being made is
   undecided; AC modifiers currently declare applicability with `appliesTo`.
5. **Cover, concealment and miss chance.** Not modeled. These are
   attack-resolution facts rather than typed AC bonuses, so they most likely
   belong in a future resolution context (attack against concealment, miss
   chance percent) rather than as `ac` effects.
6. **Denied Dexterity.** Flat-footed is a defense context, but "denied Dexterity
   bonus" (feint, unseen attacker, some grapples) is not identical to it.
   Whether that becomes another defense context, a roll-context flag, or both is
   undecided.
7. **Situational flags.** Conditions contribute flags such as the `sight-based`
   requirement on Dazzled's Perception penalty, but there is no registry or
   taxonomy: any lowercase slug is valid. The open decision is whether flags
   become a closed catalog validated against `rules-data`, which would make
   homebrew portability cheaper but homebrew experimentation slower.
8. **Action economy.** Only the attack action is modeled: `standardAttack`,
   `fullAttack`, `maneuver`. Swift and immediate actions, readying, actions
   spanning a round, and spellcasting action types wait on spellcasting.

## Product decisions

9. **Where the action choice lives.** The browser exposes per-weapon roll plans
   alongside the explicit action plan; TTS exposes a standard/full toggle and
   maneuver buttons. Whether players should be forced through a single
   "declare action, then select weapons" flow, or keep per-weapon shortcuts
   (which must always carry the action explicitly, as the request does now), is
   a UX decision with rules consequences.
10. **Exclusion display volume.** Every filtered effect is reported with a
    reason, and the sheet shows them for the inspected target. If players need
    "why is my ray not getting Deadly Aim" without inspecting, the plan needs a
    deliberate exclusion summary instead of raw contributions.
11. **Homebrew authoring surface.** Homebrew can express applicability, tags and
    action roles, but there is no editor for `appliesWhen`, flags or step roles;
    it is authored as JSON today. Whether that stays a power-user path or gains
    a form is a product choice, and it should follow decision 7.
