import { useEffect, useRef, useState } from "react";
import { plainOutcomePolicy, refreshDailyCharacterResources } from "@threepointpf/rules-core";
import type { RollPlan } from "@threepointpf/rules-schema";
import type { CharacterSheet } from "../hooks/useCharacterSheet";

export function TurnActionTracker({ sheet, onOpenSpells }: { sheet: CharacterSheet; onOpenSpells: () => void }) {
  const sources = sheet.character.systems ?? [];
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const activeCharacterId = useRef(sheet.character.id);
  const runId = useRef(0);
  useEffect(() => {
    if (activeCharacterId.current === sheet.character.id) return;
    activeCharacterId.current = sheet.character.id;
    runId.current++;
    startingRef.current = false;
    setStarting(false);
  }, [sheet.character.id]);
  const startNewTurn = async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    const characterId = sheet.character.id;
    const thisRun = ++runId.current;
    const stillCurrent = () => startingRef.current && runId.current === thisRun && activeCharacterId.current === characterId;
    try {
      const expired: string[] = [];
      const tick = <T extends { roundsRemaining?: number }>(item: T, name: string, deactivate: "enabled" | "active") => {
        if (item.roundsRemaining === undefined) return item;
        const roundsRemaining = Math.max(0, item.roundsRemaining - 1);
        if (roundsRemaining === 0) expired.push(name);
        return { ...item, roundsRemaining, ...(roundsRemaining === 0 ? { [deactivate]: false } : {}) };
      };
      const bleedFeatures = (sheet.character.features ?? []).filter((item) => item.enabled && item.definitionId === "pf1e.paizo.bleed" && item.startOfTurnDamage);
      const confusedFeatures = (sheet.character.features ?? []).filter((item) => item.enabled && item.definitionId === "pf1e.paizo.confused" && (item.roundsRemaining === undefined || item.roundsRemaining > 1));
      if (sheet.mode === "hosted" && (bleedFeatures.length || confusedFeatures.length)) {
        sheet.fail("This turn needs server-recorded condition rolls before it can advance in hosted play. The turn was not changed.");
        return;
      }
      const accepted = sheet.update({
        turnActions: {},
        features: (sheet.character.features ?? []).map((item) => ({ ...(item.enabled ? tick(item, item.name, "enabled") : item), turnResolution: undefined, turnActionRestrictions: undefined })),
        abilities: (sheet.character.abilities ?? []).map((item) => item.active ? tick(item, item.name, "active") : item),
        systems: sources.map((source) => ({ ...source, entries: source.entries.map((item) => item.active ? tick(item, item.name, "active") : item) })),
        activeSpellDurations: (sheet.character.activeSpellDurations ?? []).map((item) => item.active ? tick(item, item.spellName, "active") : item),
      }, `Started a new turn${expired.length ? `; expired ${expired.join(", ")}` : ""}`);
      if (!accepted) return;
      let totalBleedDamage = 0;
      for (const feature of bleedFeatures) {
        const damage = feature.startOfTurnDamage!;
        const plan: RollPlan = {
          id: `bleed:${sheet.character.id}:${feature.id}:${Date.now()}`,
          characterId: sheet.character.id,
          label: `${feature.name} damage (${damage.dice.count}d${damage.dice.sides}${damage.bonus ? `${damage.bonus > 0 ? "+" : ""}${damage.bonus}` : ""})`,
          dice: [damage.dice],
          modifier: damage.bonus ?? 0,
          context: { kind: "damage", actorCharacterId: sheet.character.id, action: { kind: "other" } },
          outcomePolicy: plainOutcomePolicy,
          provenance: { modifier: [], excluded: [] },
        };
        const result = await sheet.rollPlan(plan);
        if (!stillCurrent()) return;
        if (result) totalBleedDamage += Math.max(0, result.total);
      }
      if (totalBleedDamage > 0) sheet.takeDamage(totalBleedDamage, "bleed");
      for (const feature of confusedFeatures) {
        const check = await sheet.rollPlan({
          id: `confused:${sheet.character.id}:${feature.id}:${Date.now()}`,
          characterId: sheet.character.id,
          label: "Confused behavior (d%)",
          dice: [{ sides: 100, count: 1 }],
          modifier: 0,
          context: { kind: "skill", actorCharacterId: sheet.character.id, action: { kind: "other" } },
          outcomePolicy: plainOutcomePolicy,
          provenance: { modifier: [], excluded: [] },
        });
        if (!stillCurrent()) return;
        if (!check) continue;
        const behavior = check.total <= 25 ? "Act normally"
          : check.total <= 50 ? "Babble incoherently; no actions this turn"
          : check.total <= 75 ? "Deal 1d8 + Strength modifier damage to yourself; no actions this turn"
          : "Attack the nearest creature (or the last creature that attacked you); resolve with the attack controls";
        const damage = check.total >= 51 && check.total <= 75 ? await sheet.rollPlan({
          id: `confused-self-damage:${sheet.character.id}:${feature.id}:${Date.now()}`,
          characterId: sheet.character.id,
          label: "Confused self-damage (1d8 + Strength)",
          dice: [{ sides: 8, count: 1 }],
          modifier: sheet.abilityModifier("str"),
          context: { kind: "damage", actorCharacterId: sheet.character.id, action: { kind: "other" } },
          outcomePolicy: plainOutcomePolicy,
          provenance: { modifier: [], excluded: [] },
        }) : null;
        if (!stillCurrent()) return;
        const resolution = `d% ${check.total}: ${behavior}${damage ? ` · self-damage ${Math.max(0, damage.total)}` : ""}`;
        sheet.update({ features: sheet.character.features.map((item) => item.id === feature.id ? {
          ...item,
          turnResolution: resolution,
          ...((check.total >= 26 && check.total <= 75) ? { turnActionRestrictions: ["noActions" as const] } : {}),
        } : item) }, `Confused: ${behavior}`);
        if (damage && damage.total > 0) sheet.takeDamage(damage.total, "untyped");
      }
    } finally {
      if (runId.current === thisRun) {
        startingRef.current = false;
        setStarting(false);
      }
    }
  };
  const refreshDailyState = () => {
    const refreshed = refreshDailyCharacterResources(sheet.character);
    sheet.update({
      resourceStates: refreshed.resourceStates,
      spellcastingSources: refreshed.spellcastingSources,
      abilities: refreshed.abilities,
      systems: refreshed.systems,
    }, "Refreshed daily spell slots, uses, and system resources");
  };
  const actions = sheet.character.turnActions;
  const status = (spent?: boolean) => spent ? "spent" : "available";
  const activeSpells = (sheet.character.activeSpellDurations ?? []).filter((entry) => entry.active);
  return <section className="summary-turn-tracker" aria-label="Current turn actions">
    <div className="summary-turn-heading"><span className="summary-section-heading">Turn actions</span><button type="button" className="summary-turn-reset" disabled={starting} onClick={() => void startNewTurn()}>{starting ? "Resolving turn…" : "Start new turn"}</button></div>
    <div className="summary-turn-pills">
      <span className="pill">Standard {status(actions?.standardSpent || actions?.fullRoundSpent)}</span>
      <span className="pill">Move {status(actions?.moveSpent || actions?.fullRoundSpent)}</span>
      <span className="pill">Swift / immediate {status(actions?.swiftSpent)}</span>
    </div>
    <button type="button" className="summary-turn-refresh" onClick={refreshDailyState}>Refresh daily resources</button>
    {activeSpells.length > 0 && <div className="summary-turn-effects" aria-label="Active spell durations">
      <b>Active spells</b>
      {activeSpells.slice(0, 3).map((entry) => <span key={entry.id}>{entry.spellName} · {entry.targetName ?? "self"} · {entry.roundsRemaining === undefined ? entry.durationText : `${entry.roundsRemaining} rounds`}</span>)}
      <button type="button" onClick={onOpenSpells}>{activeSpells.length > 3 ? `View all ${activeSpells.length} durations →` : "Manage spell durations →"}</button>
    </div>}
  </section>;
}
