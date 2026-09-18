import { useEffect, useMemo, useRef, useState } from "react";
import {
  BrowserDiceProvider,
  formatModifier,
  formatRollOutcome,
  resolveRollPlan,
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
} from "../lib/sample-characters";
import { activeSheetEnvironment, sheetModeFor } from "../lib/sheet-mode";
import {
  loadSelectedSampleId,
  saveSelectedSampleId,
} from "../lib/sheet-session";
import { useDicePresentation } from "./useDicePresentation";

export function useCharacterSheet() {
  // Dice appearance and flourishes are display preferences owned by this hook,
  // which persists them under their own key; they never enter character state.
  const dice = useDicePresentation();
  // Demo mode is the default and needs no server: it is the published demo and
  // the fallback whenever no Supabase credentials are configured.
  const environment = useMemo(() => activeSheetEnvironment(), []);
  const mode = sheetModeFor(environment);
  // The sample this browser last looked at, so a reload comes back to it. A
  // saved snapshot may replace it once, at mount; later sample switches are
  // explicit choices and are never overwritten by a load.
  const startingSampleId = useRef(loadSelectedSampleId()).current;
  const [sampleId, setSampleId] = useState(startingSampleId);
  const [character, setCharacter] = useState<CharacterInput>(() =>
    clone(sampleCharacter(startingSampleId).character),
  );
  const [notice, setNotice] = useState(
    mode === "demo"
      ? "Demo mode · " + sampleCharacter(startingSampleId).label + " loaded"
      : "Local draft ready",
  );
  const [error, setError] = useState<string | null>(null);
  /** An optional caller-entered DC; blank means "no known DC". */
  const [rollDc, setRollDc] = useState("");
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
  useEffect(() => {
    let active = true;
    void repo
      .load(sampleCharacter(startingSampleId).character.id)
      .then((saved) => {
        if (!active || !saved || editRevision.current !== 0) return;
        new RulesEngine(saved, rulesCatalogs).derive();
        setCharacter(saved);
        setNotice(
          mode === "demo" ? "Demo mode · reloaded your saved sheet" : "Saved character loaded",
        );
      })
      .catch((failure) => {
        if (active) setError(errorText(failure));
      });
    return () => {
      active = false;
    };
  }, [startingSampleId, mode, repo]);
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

  const apply = (next: CharacterInput, success?: string) => {
    try {
      parseCharacterInput(next);
      new RulesEngine(next, rulesCatalogs).derive();
      editRevision.current += 1;
      setCharacter(next);
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
  const loadSample = (id: string) => {
    const sample = sampleCharacter(id);
    apply(clone(sample.character), "Sample loaded: " + sample.label);
    setSelected(null);
    setSampleId(id);
    saveSelectedSampleId(id);
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
  // The entered DC is a roll defense, exactly like a caller-supplied AC: it
  // travels through the same plan context and leaves the outcome unresolved
  // when it is blank.
  const dcDefense = useMemo<RollDefense | undefined>(() => {
    const trimmed = rollDc.trim();
    if (!trimmed) return undefined;
    const value = Number(trimmed);
    return Number.isFinite(value) ? { kind: "dc", value } : undefined;
  }, [rollDc]);
  const roll = async (
    label: string,
    plan: () => ReturnType<RulesEngine["createSaveRollPlan"]>,
  ) => {
    try {
      const value = plan();
      const raw = await new BrowserDiceProvider().roll({
        planId: value.id,
        dice: value.dice,
      });
      const result = resolveRollPlan(value, raw.faces);
      // The authoritative faces already decided the result; the overlay is only
      // asked to land the dice on them.
      dice.present(value, result);
      // The natural face and the semantic outcome are reported separately, so a
      // threat outside the automatic rule is never shown as a hit. A plan with
      // no comparison of its own (damage, initiative) reports its total only.
      setNotice(
        label +
          ": " +
          raw.faces.join(", ") +
          " " +
          formatModifier(result.modifier) +
          " = " +
          result.total +
          (value.outcomePolicy.kind === "plain"
            ? ""
            : " · " + formatRollOutcome(result.outcome)),
      );
    } catch (failure) {
      setNotice(errorText(failure));
    }
  };
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
      const loaded = await repo.load(character.id);
      if (!loaded) {
        setNotice("No saved character found");
        return;
      }
      parseCharacterInput(loaded);
      new RulesEngine(loaded, rulesCatalogs).derive();
      setCharacter(loaded);
      setError(null);
      setNotice("Reloaded authored state");
    } catch (failure) {
      fail("Reload failed: " + errorText(failure));
    }
  };
  return {
    dice,
    mode,
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
    error,
    validationError: error ?? evaluated.error,
    selected,
    inspect,
    rollDc,
    setRollDc,
    dcDefense,
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
    roll,
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

export type CharacterSheet = ReturnType<typeof useCharacterSheet>;
