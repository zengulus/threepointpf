import { useEffect, useMemo, useRef, useState } from "react";
import {
  BrowserDiceProvider,
  resolveRollPlan,
  type ResolvedRoll,
  type RollPlan,
} from "@threepointpf/dice";
import { RulesEngine } from "@threepointpf/rules-core";
import {
  attackFromProfile,
  attackProfileCatalog,
  equipmentCatalog,
  experienceCatalog,
  featureCatalog,
  rulesCatalogs,
} from "@threepointpf/rules-data";
import {
  parseCharacterInput,
  type AbilityId,
  type AdvancementSlot,
  type AttackDefinition,
  type BonusType,
  type CharacterInput,
  type DefenseContext,
  type Effect,
  type EffectTargetId,
  type EquipmentInstance,
  type EvaluationResult,
  type FeatureInstance,
  type ProgressionDefinition,
  type RollDefense,
} from "@threepointpf/rules-schema";
import {
  catalogValues,
  clone,
  errorText,
  nextId,
  slug,
} from "../lib/format";
import { activeCatalog, repositoryFor } from "../lib/repository";
import {
  defaultSample,
  sampleCharacter,
  sampleCharacters,
  sampleForCharacterId,
} from "../lib/sample-characters";
import { activeSheetEnvironment, sheetModeFor } from "../lib/sheet-mode";
import {
  loadSelectedSampleId,
  saveSelectedSampleId,
} from "../lib/sheet-session";
import {
  useDicePresentation,
  type DicePresentation,
} from "./useDicePresentation";
import { useDiscordRollSettings } from "./useDiscordRollSettings";
import { publishCompletedRoll } from "../lib/discord-roll-publishing";
import { formatRollResultNotice } from "../lib/roll-result";

/**
 * A caller-selected authored character. Omit `characterId` for the standalone
 * sheet's existing sample-picker behaviour; provide it when another surface
 * (such as a future VTT token) owns character selection.
 */
export interface CharacterSheetOptions {
  characterId?: string;
  /**
   * Called when a controller-owned UI action wants to open another character.
   * It makes a supplied `characterId` a conventional controlled value without
   * forcing the standalone demo to own another piece of application state.
   */
  onCharacterIdChange?: (characterId: string) => void;
}

/** A controller receives the single application-level dice presenter. */
export interface CharacterSheetControllerOptions extends CharacterSheetOptions {
  dice: DicePresentation;
}

interface PendingSampleDraft {
  character: CharacterInput;
  notice: string;
}

type WeaponActionKind = "standardAttack" | "fullAttack";

type PendingTargetRollIntent =
  | {
      kind: "save";
      targetKind: "dc";
      save: "fortitude" | "reflex" | "will";
      label: string;
    }
  | {
      kind: "skill";
      targetKind: "dc";
      skillId: string;
      label: string;
    }
  | {
      kind: "weapon";
      targetKind: "ac";
      attackId: string;
      action: WeaponActionKind;
      stepIndex: number;
      label: string;
    }
  | {
      kind: "maneuver";
      targetKind: "cmd";
      maneuver: string;
      label: string;
    };

function targetLabel(kind: RollDefense["kind"]): string {
  return kind === "ac" ? "Target AC" : kind === "cmd" ? "Target CMD" : "DC";
}

function usableCharacterId(value: string | undefined): string | undefined {
  const id = value?.trim();
  return id || undefined;
}

function defenseFromInput(
  value: string,
  kind: RollDefense["kind"],
): RollDefense | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const number = Number(trimmed);
  return Number.isFinite(number) ? { kind, value: number } : undefined;
}

/**
 * A known sample is the natural seed for its authored id. An unknown id still
 * gets a valid, isolated draft with that id so a caller never briefly sees the
 * previously selected character while its repository record is loading.
 */
function draftForCharacterId(characterId: string): CharacterInput {
  const sample = sampleForCharacterId(characterId);
  if (sample) return clone(sample.character);
  const draft = clone(defaultSample().character);
  return { ...draft, id: characterId, name: "Unnamed character" };
}

/**
 * The reusable sheet controller. Authored state, rules evaluation and roll
 * planning live here; chrome and the dice overlay are deliberately outside it.
 */
export function useCharacterSheetController({
  dice,
  characterId: requestedCharacterId,
  onCharacterIdChange,
}: CharacterSheetControllerOptions) {
  const discord = useDiscordRollSettings();
  // Demo mode is the default and needs no server: it is the published demo and
  // the fallback whenever no Supabase credentials are configured.
  const environment = useMemo(() => activeSheetEnvironment(), []);
  const mode = sheetModeFor(environment);
  // The sample this browser last looked at, so a reload comes back to it. A
  // saved snapshot may replace it once, at mount; later sample switches are
  // explicit choices and are never overwritten by a load.
  const startingSampleId = useRef(loadSelectedSampleId()).current;
  const callerCharacterId = usableCharacterId(requestedCharacterId);
  const isCharacterIdControlled = callerCharacterId !== undefined;
  const startingCharacterId = useRef(
    callerCharacterId ?? sampleCharacter(startingSampleId).character.id,
  ).current;
  const [sampleId, setSampleId] = useState(startingSampleId);
  const [uncontrolledCharacterId, setUncontrolledCharacterId] = useState(
    startingCharacterId,
  );
  const characterId = callerCharacterId ?? uncontrolledCharacterId;
  const [character, setCharacter] = useState<CharacterInput>(() =>
    draftForCharacterId(startingCharacterId),
  );
  const startingSample = sampleForCharacterId(startingCharacterId);
  const [notice, setNotice] = useState(
    mode === "demo"
      ? startingSample
        ? "Demo mode · " + startingSample.label + " loaded"
        : "Demo mode · new character draft ready"
      : "Local draft ready",
  );
  const [integrationNotice, setIntegrationNotice] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  /** An optional caller-entered DC; blank means "no known DC". */
  const [rollDc, setRollDc] = useState("");
  /** Target defenses are transient table context, not character data. */
  const [attackAc, setAttackAc] = useState("");
  const [maneuverCmd, setManeuverCmd] = useState("");
  const [pendingTargetRoll, setPendingTargetRoll] =
    useState<PendingTargetRollIntent | null>(null);
  const [pendingTargetValue, setPendingTargetValue] = useState("");
  const [pendingTargetError, setPendingTargetError] = useState<string | null>(
    null,
  );
  const pendingTargetTrigger = useRef<HTMLElement | null>(null);
  const [lastRoll, setLastRoll] = useState<{
    plan: RollPlan;
    resolved: ResolvedRoll;
  } | null>(null);
  const [selected, setSelected] = useState<{
    label: string;
    evaluation: EvaluationResult;
  } | null>(null);
  const [catalogFeatureId, setCatalogFeatureId] = useState("");
  const [featureName, setFeatureName] = useState("");
  const [featureKind, setFeatureKind] = useState<Effect["kind"]>("modifier");
  const [featureTarget, setFeatureTarget] =
    useState<EffectTargetId>("attack.melee");
  const [featureValue, setFeatureValue] = useState("1");
  const [featureBonus, setFeatureBonus] = useState<BonusType>("untyped");
  const [featureGrant, setFeatureGrant] = useState("");
  const [featureContexts, setFeatureContexts] = useState<
    "all" | "normal" | "normalTouch" | "normalFlat"
  >("all");
  const [attackName, setAttackName] = useState("");
  const [attackDice, setAttackDice] = useState("1d8");
  const [attackAbility, setAttackAbility] = useState<AbilityId>("str");
  const [equipmentId, setEquipmentId] = useState("");
  const [customWeaponName, setCustomWeaponName] = useState("");
  const [customWeaponDice, setCustomWeaponDice] = useState("1d6");
  const [weaponEnhancement, setWeaponEnhancement] = useState("0");
  const [weaponAttackAdjustment, setWeaponAttackAdjustment] = useState("0");
  const [weaponStrengthRating, setWeaponStrengthRating] = useState("");
  const [profileId, setProfileId] = useState("");
  const [repo] = useState(() => repositoryFor(mode, environment));
  const editRevision = useRef(0);
  const loadRevision = useRef(0);
  const pendingSampleDraft = useRef<PendingSampleDraft | null>(null);
  useEffect(() => {
    let active = true;
    const revision = ++loadRevision.current;
    // A new target is a distinct authored-state session. Edits to the old
    // character must not suppress a persisted load for this one.
    editRevision.current = 0;
    setLastRoll(null);
    setIntegrationNotice(null);
    setPendingTargetRoll(null);
    setPendingTargetValue("");
    setPendingTargetError(null);
    pendingTargetTrigger.current = null;
    const pending = pendingSampleDraft.current;
    if (pending?.character.id === characterId) {
      pendingSampleDraft.current = null;
      setCharacter(pending.character);
      setSelected(null);
      setError(null);
      setNotice(pending.notice);
      return () => {
        active = false;
      };
    }

    const sample = sampleForCharacterId(characterId);
    setCharacter(draftForCharacterId(characterId));
    setSelected(null);
    setError(null);
    if (!sample)
      setNotice(
        mode === "demo"
          ? "Demo mode · loading character"
          : "Loading character",
      );
    void repo
      .load(characterId)
      .then((saved) => {
        if (
          !active ||
          revision !== loadRevision.current ||
          editRevision.current !== 0
        )
          return;
        if (!saved) {
          if (!sample) setNotice("No saved character found; new draft ready");
          return;
        }
        if (saved.id !== characterId)
          throw new Error(
            "Saved character identity does not match the selected character",
          );
        new RulesEngine(saved, rulesCatalogs).derive();
        setCharacter(saved);
        setNotice(
          mode === "demo"
            ? "Demo mode · reloaded your saved sheet"
            : "Saved character loaded",
        );
      })
      .catch((failure) => {
        if (active && revision === loadRevision.current)
          setError(errorText(failure));
      });
    return () => {
      active = false;
    };
  }, [characterId, mode, repo]);
  const catalog = useMemo(
    () => activeCatalog(character),
    [character.customProgressions],
  );
  const evaluated = useMemo(() => {
    try {
      const engine = new RulesEngine(character, rulesCatalogs);
      return { engine, derived: engine.derive(), error: null as string | null };
    } catch (failure) {
      const engine = new RulesEngine(defaultSample().character, rulesCatalogs);
      return { engine, derived: engine.derive(), error: errorText(failure) };
    }
  }, [character]);
  const engine = evaluated.engine;
  const derived = evaluated.derived;

  const apply = (
    next: CharacterInput,
    success?: string,
    allowCharacterIdChange = false,
  ) => {
    try {
      if (!allowCharacterIdChange && next.id !== characterId)
        throw new Error(
          "Character identity is selected by the sheet controller, not an authored edit",
        );
      parseCharacterInput(next);
      new RulesEngine(next, rulesCatalogs).derive();
      editRevision.current += 1;
      setCharacter(next);
      setLastRoll(null);
      setPendingTargetRoll(null);
      setPendingTargetValue("");
      setPendingTargetError(null);
      pendingTargetTrigger.current = null;
      setSelected(null);
      setError(null);
      if (success) setNotice(success);
      return true;
    } catch (failure) {
      setError(errorText(failure));
      setNotice("Change not applied");
      return false;
    }
  };
  const update = (changes: Partial<CharacterInput>, success?: string) =>
    apply({ ...character, ...changes }, success);
  const fail = (message: string) => {
    setError(message);
    setNotice("Change not applied");
  };
  const inspect = (label: string, evaluation: EvaluationResult) =>
    setSelected({ label, evaluation });
  const featureOptions = catalogValues(featureCatalog);
  const equipmentOptions = catalogValues(equipmentCatalog);
  const profileOptions = catalogValues(attackProfileCatalog);

  const updateAbility = (id: AbilityId, value: string) =>
    update({
      baseAbilities: { ...character.baseAbilities, [id]: Number(value) || 0 },
    });
  const updateAdvancement = (slots: AdvancementSlot[]) =>
    update({
      advancementSlots: slots,
      baseBab: undefined,
      baseSaves: undefined,
      hitDiceCount: undefined,
    });
  const groupFor = (feature: FeatureInstance) =>
    feature.effects.length
      ? undefined
      : featureCatalog[feature.definitionId ?? ""]?.exclusiveGroup;
  const toggleFeature = (id: string) => {
    const selected = character.features.find((feature) => feature.id === id);
    const group =
      selected && !selected.enabled ? groupFor(selected) : undefined;
    update({
      features: character.features.map((feature) =>
        feature.id === id
          ? { ...feature, enabled: !feature.enabled }
          : group && groupFor(feature) === group
            ? { ...feature, enabled: false }
            : feature,
      ),
    });
  };
  const addCatalogFeature = () => {
    const definition = featureCatalog[catalogFeatureId];
    if (!definition) {
      fail("Choose a feature or condition from the catalog.");
      return;
    }
    if (
      character.features.some(
        (feature) => feature.definitionId === definition.id,
      )
    ) {
      fail(
        "That feature is already on this character. Use its toggle to activate it.",
      );
      return;
    }
    const feature: FeatureInstance = {
      id: nextId(
        "feature-" + slug(definition.name),
        character.features.map((item) => item.id),
      ),
      definitionId: definition.id,
      name: definition.name,
      ...(definition.description
        ? { description: definition.description }
        : {}),
      enabled: true,
      effects: [],
    };
    update(
      {
        features: [
          ...character.features.map((entry) =>
            definition.exclusiveGroup &&
            groupFor(entry) === definition.exclusiveGroup
              ? { ...entry, enabled: false }
              : entry,
          ),
          feature,
        ],
      },
      "Added " + definition.name,
    );
    setCatalogFeatureId("");
  };
  const addManualFeature = () => {
    if (!featureName.trim()) {
      fail("A manual feature needs a name.");
      return;
    }
    const value = Number(featureValue);
    if (featureKind !== "grant" && !Number.isFinite(value)) {
      fail("Use a finite numeric effect value.");
      return;
    }
    if (featureKind === "grant" && !featureGrant.trim()) {
      fail("A grant effect needs a capability label.");
      return;
    }
    const contexts: DefenseContext[] =
      featureContexts === "all"
        ? ["normal", "touch", "flatFooted"]
        : featureContexts === "normal"
          ? ["normal"]
          : featureContexts === "normalFlat"
            ? ["normal", "flatFooted"]
            : ["normal", "touch"];
    let effect: Effect;
    if (featureKind === "modifier")
      effect =
        featureTarget === "ac"
          ? {
              kind: "modifier",
              target: "ac",
              value,
              bonusType: featureBonus,
              appliesTo: contexts,
            }
          : {
              kind: "modifier",
              target: featureTarget,
              value,
              bonusType: featureBonus,
            };
    else if (featureKind === "replaceBase")
      effect = { kind: "replaceBase", target: featureTarget, value };
    else if (featureKind === "multiply")
      effect = { kind: "multiply", target: featureTarget, factor: value };
    else if (featureKind === "minimum")
      effect = { kind: "minimum", target: featureTarget, value };
    else if (featureKind === "maximum")
      effect = { kind: "maximum", target: featureTarget, value };
    else
      effect = {
        kind: "grant",
        target: featureTarget,
        grant: featureGrant.trim(),
      };
    const feature: FeatureInstance = {
      id: nextId(
        "custom-feature",
        character.features.map((item) => item.id),
      ),
      name: featureName.trim(),
      enabled: true,
      effects: [effect],
    };
    const added = update(
      { features: [...character.features, feature] },
      "Added " + feature.name,
    );
    if (added) {
      setFeatureName("");
      setFeatureGrant("");
    }
  };
  const addAttack = () => {
    const dice = /^(\d+)d(\d+)$/i.exec(attackDice.trim());
    if (!attackName.trim() || !dice) {
      fail("Use an attack name and dice in the form 1d8.");
      return;
    }
    const attack: AttackDefinition = {
      id: nextId(
        "attack",
        character.attacks.map((item) => item.id),
      ),
      name: attackName.trim(),
      attackAbility,
      damageAbility: attackAbility,
      damageAbilityMultiplier: 1,
      baseDamage: { count: Number(dice[1]), sides: Number(dice[2]) },
      mode: "melee",
      attackTags: ["weapon.melee"],
    };
    if (
      update(
        { attacks: [...character.attacks, attack] },
        "Added " + attack.name,
      )
    )
      setAttackName("");
  };
  const addEquipment = () => {
    const definition = equipmentCatalog[equipmentId];
    if (!definition) {
      fail("Choose equipment from the catalog.");
      return;
    }
    const item: EquipmentInstance = {
      id: nextId(
        "equipment-" + slug(definition.name),
        (character.equipment ?? []).map((entry) => entry.id),
      ),
      definitionId: definition.id,
      name: definition.name,
      equipped: true,
      effects: [],
    };
    const added = update(
      { equipment: [...(character.equipment ?? []), item] },
      "Added " + definition.name,
    );
    if (added) setEquipmentId("");
  };
  const addCustomWeapon = () => {
    const dice = /^(\d+)d(\d+)$/i.exec(customWeaponDice.trim());
    if (!customWeaponName.trim() || !dice) {
      fail("A custom weapon needs a name and dice in the form 1d6.");
      return;
    }
    const id = nextId(
      "equipment-" + slug(customWeaponName),
      (character.equipment ?? []).map((entry) => entry.id),
    );
    const base = {
      id: id + "-attack",
      name: customWeaponName.trim(),
      baseDamage: { count: Number(dice[1]), sides: Number(dice[2]) },
    };
    const attack: AttackDefinition = {
      ...(profileId
        ? attackFromProfile(profileId, base)
        : {
            ...base,
            attackAbility: "str",
            damageAbility: "str",
            damageAbilityMultiplier: 1,
            mode: "melee",
            attackTags: ["weapon.melee"],
          }),
      weaponBonus: Number(weaponEnhancement),
      attackBonus: Number(weaponAttackAdjustment),
      ...(weaponStrengthRating.trim()
        ? { damageAbilityMaximum: Number(weaponStrengthRating) }
        : {}),
    };
    const added = update(
      {
        equipment: [
          ...(character.equipment ?? []),
          {
            id,
            name: customWeaponName.trim(),
            equipped: true,
            effects: [],
            attack,
          },
        ],
      },
      "Added " + customWeaponName.trim(),
    );
    if (added) setCustomWeaponName("");
  };
  /**
   * Loads a sample from scratch. It is authored state, never a saved snapshot:
   * switching samples is a fresh start, and saving afterwards is what persists.
   */
  const requestCharacterId = (nextCharacterId: string): boolean => {
    if (nextCharacterId === characterId) return true;
    if (isCharacterIdControlled) {
      if (!onCharacterIdChange) {
        fail("This sheet's character is controlled by its caller.");
        return false;
      }
      onCharacterIdChange(nextCharacterId);
      return true;
    }
    setUncontrolledCharacterId(nextCharacterId);
    return true;
  };
  /**
   * Opens an authored character by its real persistence identity. This is the
   * VTT-facing selection seam; it intentionally does not mutate the demo
   * sample preference.
   */
  const selectCharacter = (id: string) => {
    const nextCharacterId = usableCharacterId(id);
    if (!nextCharacterId) {
      fail("Choose a character with a non-empty id.");
      return false;
    }
    pendingSampleDraft.current = null;
    return requestCharacterId(nextCharacterId);
  };
  const loadSample = (id: string) => {
    const sample = sampleCharacter(id);
    const next = clone(sample.character);
    const sampleNotice = "Sample loaded: " + sample.label;
    const targetChanges = next.id !== characterId;
    if (
      targetChanges &&
      isCharacterIdControlled &&
      !onCharacterIdChange
    ) {
      fail("This sheet's character is controlled by its caller.");
      return;
    }

    setSampleId(id);
    saveSelectedSampleId(id);
    if (!targetChanges) {
      apply(next, sampleNotice, true);
      return;
    }

    // A sample switch deliberately starts pristine authored state instead of
    // reloading any browser snapshot for the sample's character id.
    pendingSampleDraft.current = { character: next, notice: sampleNotice };
    if (!isCharacterIdControlled) {
      if (!apply(next, sampleNotice, true)) {
        pendingSampleDraft.current = null;
        return;
      }
      setUncontrolledCharacterId(next.id);
      return;
    }
    onCharacterIdChange?.(next.id);
  };
  const resetSample = () => loadSample(sampleId);
  const addCustomClass = (definition: ProgressionDefinition) =>
    update(
      {
        customProgressions: {
          ...(character.customProgressions ?? {}),
          [definition.id]: definition,
        },
      },
      "Added " + definition.name,
    );
  // Entered defenses are transient table context. A blank value opens a small
  // pre-roll prompt rather than silently producing an unresolved check.
  const dcDefense = useMemo(
    () => defenseFromInput(rollDc, "dc"),
    [rollDc],
  );
  const attackDefense = useMemo(
    () => defenseFromInput(attackAc, "ac"),
    [attackAc],
  );
  const maneuverDefense = useMemo(
    () => defenseFromInput(maneuverCmd, "cmd"),
    [maneuverCmd],
  );

  /**
   * The sole UI execution gateway: an engine-authored plan resolves locally,
   * then presentation and optional publishing consume that completed result.
   */
  const rollPlan = async (plan: RollPlan) => {
    try {
      const raw = await new BrowserDiceProvider().roll({
        planId: plan.id,
        dice: plan.dice,
      });
      const result = resolveRollPlan(plan, raw.faces);
      // The authoritative faces already decided the result; the overlay is only
      // asked to land the dice on them.
      dice.present(plan, result, { characterName: character.name });
      setLastRoll({ plan, resolved: result });
      setNotice(formatRollResultNotice(character.name, plan, result));
      setIntegrationNotice(null);
      // Publishing is deliberately outside the local completion path. A
      // rejected/deleted webhook never replaces the result the player just got.
      void publishCompletedRoll(discord.settings, character.name, plan, result)
        .then((published) => {
          if (published) setIntegrationNotice("Roll published to Discord.");
        })
        .catch(() => {
          setIntegrationNotice(
            "Discord publishing failed. Your local roll is still available.",
          );
        });
    } catch (failure) {
      setNotice("Roll could not be completed: " + errorText(failure));
    }
  };
  /** Build one exact weapon action for both display and button execution. */
  const createWeaponActionPlan = (
    attackId: string,
    action: WeaponActionKind,
    defense: RollDefense | null | undefined = attackDefense,
  ) =>
    engine.createActionPlan({
      action,
      attackIds: [attackId],
      ...(defense ? { defense } : {}),
    });
  const createCriticalDamagePlan = (damage: RollPlan) => {
    const { context } = damage;
    const action = context.action.kind;
    if (
      context.kind !== "damage" ||
      !context.attackId ||
      (action !== "standardAttack" && action !== "fullAttack")
    )
      throw new Error("Critical damage is available only for a weapon damage plan.");
    return engine.createDamageRollPlan(context.attackId, {
      action,
      attackIndex: context.action.sequenceIndex ?? 0,
      ...(context.action.attackIds ? { attackIds: context.action.attackIds } : {}),
      criticalDamage: true,
    });
  };
  const criticalMultiplierFor = (damage: RollPlan) => {
    const critical = createCriticalDamagePlan(damage);
    const semanticMultiplier = Math.max(
      0,
      ...(critical.provenance?.damageTerms ?? []).map((term) => term.multiplier),
    );
    if (semanticMultiplier >= 2) return semanticMultiplier;
    const ordinaryCount = damage.dice.reduce((count, die) => count + die.count, 0);
    const criticalCount = critical.dice.reduce((count, die) => count + die.count, 0);
    return ordinaryCount ? Math.max(2, Math.round(criticalCount / ordinaryCount)) : 2;
  };
  const canRollCriticalDamage = (attack: RollPlan) =>
    lastRoll?.plan.id === attack.id && lastRoll.resolved.outcome.critical === true;
  const createManeuverPlan = (
    maneuver: string,
    defense: RollDefense | null | undefined = maneuverDefense,
  ) =>
    engine.createManeuverRollPlan(
      maneuver,
      defense ? { defense } : {},
    );
  const currentDefenseFor = (kind: RollDefense["kind"]) =>
    kind === "dc" ? dcDefense : kind === "ac" ? attackDefense : maneuverDefense;
  const currentTargetValueFor = (kind: RollDefense["kind"]) =>
    kind === "dc" ? rollDc : kind === "ac" ? attackAc : maneuverCmd;
  const setCurrentTargetValue = (kind: RollDefense["kind"], value: string) => {
    if (kind === "dc") setRollDc(value);
    else if (kind === "ac") setAttackAc(value);
    else setManeuverCmd(value);
  };
  const planForTargetIntent = (
    intent: PendingTargetRollIntent,
    defense: RollDefense | undefined,
  ): RollPlan | null => {
    switch (intent.kind) {
      case "save":
        return engine.createSaveRollPlan(
          intent.save,
          defense ? { defense } : {},
        );
      case "skill":
        return engine.createSkillRollPlan(
          intent.skillId,
          defense ? { defense } : {},
        );
      case "maneuver":
        return createManeuverPlan(intent.maneuver, defense ?? null);
      case "weapon": {
        const actionPlan = createWeaponActionPlan(
          intent.attackId,
          intent.action,
          defense ?? null,
        );
        return (
          actionPlan.attacks[0]?.steps.find(
            (step) => step.index === intent.stepIndex,
          )?.roll ?? null
        );
      }
    }
  };
  const executeTargetIntent = (
    intent: PendingTargetRollIntent,
    defense: RollDefense | undefined,
  ) => {
    const plan = planForTargetIntent(intent, defense);
    if (!plan) {
      setNotice("That roll is no longer available. Please try again.");
      return;
    }
    void rollPlan(plan);
  };
  const dismissTargetPrompt = () => {
    const trigger = pendingTargetTrigger.current;
    pendingTargetTrigger.current = null;
    setPendingTargetRoll(null);
    setPendingTargetValue("");
    setPendingTargetError(null);
    if (trigger?.isConnected)
      globalThis.setTimeout(() => trigger.focus(), 0);
  };
  const requestTargetedRoll = (intent: PendingTargetRollIntent) => {
    const defense = currentDefenseFor(intent.targetKind);
    if (defense) {
      executeTargetIntent(intent, defense);
      return;
    }
    const active =
      typeof document === "undefined" ? null : document.activeElement;
    pendingTargetTrigger.current =
      active instanceof HTMLElement ? active : null;
    setPendingTargetRoll(intent);
    setPendingTargetValue(currentTargetValueFor(intent.targetKind));
    setPendingTargetError(null);
  };
  const confirmTargetPrompt = () => {
    const intent = pendingTargetRoll;
    if (!intent) return;
    const defense = defenseFromInput(pendingTargetValue, intent.targetKind);
    if (!defense) {
      setPendingTargetError(`Enter a numeric ${targetLabel(intent.targetKind)}.`);
      return;
    }
    pendingTargetTrigger.current = null;
    setCurrentTargetValue(intent.targetKind, String(defense.value));
    setPendingTargetRoll(null);
    setPendingTargetValue("");
    setPendingTargetError(null);
    executeTargetIntent(intent, defense);
  };
  const rollWithoutTarget = () => {
    const intent = pendingTargetRoll;
    if (!intent) return;
    pendingTargetTrigger.current = null;
    setPendingTargetRoll(null);
    setPendingTargetValue("");
    setPendingTargetError(null);
    executeTargetIntent(intent, undefined);
  };
  const setTargetPromptValue = (value: string) => {
    setPendingTargetValue(value);
    // Once a player changes an invalid submission, let the current value speak
    // for itself; a later submit will validate it again if it is still blank.
    setPendingTargetError(null);
  };
  const rollInitiative = () => rollPlan(engine.createInitiativeRollPlan());
  const rollSave = (save: "fortitude" | "reflex" | "will") =>
    requestTargetedRoll({
      kind: "save",
      targetKind: "dc",
      save,
      label: `${save.charAt(0).toUpperCase()}${save.slice(1)} save`,
    });
  const rollSkill = (skillId: string) =>
    requestTargetedRoll({
      kind: "skill",
      targetKind: "dc",
      skillId,
      label: derived.skills[skillId]?.label
        ? `${derived.skills[skillId]!.label} check`
        : "Skill check",
    });
  const rollWeaponAttack = (
    attackId: string,
    action: WeaponActionKind,
    stepIndex: number,
    attackName: string,
  ) =>
    requestTargetedRoll({
      kind: "weapon",
      targetKind: "ac",
      attackId,
      action,
      stepIndex,
      label:
        action === "standardAttack"
          ? `${attackName} standard attack`
          : `${attackName} attack${stepIndex ? ` ${stepIndex + 1}` : ""}`,
    });
  const rollManeuver = (maneuver: string) =>
    requestTargetedRoll({
      kind: "maneuver",
      targetKind: "cmd",
      maneuver,
      label: `CMB ${maneuver}`,
    });
  const save = async () => {
    try {
      await repo.save(character);
      setError(null);
      setNotice(
        mode === "cloud"
          ? "Saved to Supabase"
          : "Saved in this browser (demo mode)",
      );
    } catch (failure) {
      fail("Save failed: " + errorText(failure));
    }
  };
  const reload = async () => {
    try {
      const loaded = await repo.load(characterId);
      if (!loaded) {
        setNotice("No saved character found");
        return;
      }
      if (loaded.id !== characterId)
        throw new Error(
          "Saved character identity does not match the selected character",
        );
      parseCharacterInput(loaded);
      new RulesEngine(loaded, rulesCatalogs).derive();
      editRevision.current += 1;
      setCharacter(loaded);
      setLastRoll(null);
      setPendingTargetRoll(null);
      setPendingTargetValue("");
      setPendingTargetError(null);
      pendingTargetTrigger.current = null;
      setError(null);
      setNotice("Reloaded authored state");
    } catch (failure) {
      fail("Reload failed: " + errorText(failure));
    }
  };
  return {
    dice,
    mode,
    characterId,
    selectCharacter,
    samples: sampleCharacters,
    sampleId,
    loadSample,
    resetSample,
    character,
    catalog,
    derived,
    engine,
    evaluated,
    notice,
    integrationNotice,
    error,
    validationError: error ?? evaluated.error,
    selected,
    inspect,
    rollDc,
    setRollDc,
    dcDefense,
    attackAc,
    setAttackAc,
    attackDefense,
    maneuverCmd,
    setManeuverCmd,
    maneuverDefense,
    targetPrompt: pendingTargetRoll
      ? {
          label: pendingTargetRoll.label,
          targetKind: pendingTargetRoll.targetKind,
          targetLabel: targetLabel(pendingTargetRoll.targetKind),
          value: pendingTargetValue,
          error: pendingTargetError,
        }
      : null,
    setTargetPromptValue,
    confirmTargetPrompt,
    rollWithoutTarget,
    dismissTargetPrompt,
    update,
    fail,
    updateAbility,
    updateAdvancement,
    toggleFeature,
    addCatalogFeature,
    addManualFeature,
    addAttack,
    addEquipment,
    addCustomWeapon,
    addCustomClass,
    discord,
    lastRoll,
    rollPlan,
    rollInitiative,
    rollSave,
    rollSkill,
    rollWeaponAttack,
    rollManeuver,
    createManeuverPlan,
    createWeaponActionPlan,
    createCriticalDamagePlan,
    criticalMultiplierFor,
    canRollCriticalDamage,
    save,
    reload,
    featureOptions,
    equipmentOptions,
    profileOptions,
    catalogFeatureId,
    setCatalogFeatureId,
    featureName,
    setFeatureName,
    featureKind,
    setFeatureKind,
    featureTarget,
    setFeatureTarget,
    featureValue,
    setFeatureValue,
    featureBonus,
    setFeatureBonus,
    featureGrant,
    setFeatureGrant,
    featureContexts,
    setFeatureContexts,
    attackName,
    setAttackName,
    attackDice,
    setAttackDice,
    attackAbility,
    setAttackAbility,
    equipmentId,
    setEquipmentId,
    customWeaponName,
    setCustomWeaponName,
    customWeaponDice,
    setCustomWeaponDice,
    weaponEnhancement,
    setWeaponEnhancement,
    weaponAttackAdjustment,
    setWeaponAttackAdjustment,
    weaponStrengthRating,
    setWeaponStrengthRating,
    profileId,
    setProfileId,
  } as const;
}

/**
 * Standalone convenience: preserve the existing full-page hook while allowing
 * an application shell to own one dice presenter via
 * `useCharacterSheetController({ dice })`.
 */
export function useCharacterSheet(options: CharacterSheetOptions = {}) {
  const dice = useDicePresentation();
  return useCharacterSheetController({ ...options, dice });
}

export type CharacterSheetController = ReturnType<
  typeof useCharacterSheetController
>;
/** Backwards-compatible view prop name. */
export type CharacterSheet = CharacterSheetController;
