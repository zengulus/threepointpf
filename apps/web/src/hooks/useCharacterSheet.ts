import { useEffect, useMemo, useRef, useState } from "react";
import {
  BrowserDiceProvider,
  resolveRollPlan,
  type ResolvedRoll,
  type RollPlan,
} from "@threepointpf/dice";
import { RulesEngine, applyDamage, applyHealing, clearTemporaryHp, deriveNoteDefenses, mitigateDamage, resolveTurnAction, setTemporaryHp, unchainedWoundPenalty } from "@threepointpf/rules-core";
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
  sizeCategories,
  type AbilityId,
  type AdvancementSlot,
  type AttackDefinition,
  type BonusType,
  type CharacterInput,
  type CoverLevel,
  type DefenseContext,
  type DiceExpression,
  type EffectApplicability,
  type Effect,
  type FeatureActionRestriction,
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
import { CharacterApiError, type CharacterRepository, type HostedRollResponse } from "@threepointpf/shared";
import {
  defaultSample,
  sampleCharacter,
  sampleCharacters,
  sampleForCharacterId,
} from "../lib/sample-characters";
import { activeSheetEnvironment, sheetModeFor } from "../lib/sheet-mode";
import {
  loadSelectedCharacterId,
  loadSelectedSampleId,
  saveSelectedCharacterId,
  saveSelectedSampleId,
} from "../lib/sheet-session";
import {
  useDicePresentation,
  type DicePresentation,
} from "./useDicePresentation";
import { useDiscordRollSettings } from "./useDiscordRollSettings";
import { publishCompletedRoll } from "../lib/discord-roll-publishing";
import { formatRollResultNotice } from "../lib/roll-result";
import { hostedDeliveryNotice, recordHostedRoll } from "../lib/hosted-roll";
import { copyWithNewCharacterId, exportCharacterLibrarySnapshot, importCharacterLibrarySnapshot, importCharacterSnapshot } from "../lib/character-portability";

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
  repository?: CharacterRepository;
  mode?: "browser" | "hosted";
  onAuthenticationRequired?: () => void;
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
      cover?: CoverLevel;
    }
  | {
    kind: "skill";
    targetKind: "dc";
    skillId: string;
    label: string;
    flags?: string[];
    systemId?: string;
    systemEntryId?: string;
    spendStandardAction?: boolean;
    }
  | {
      kind: "weapon";
      targetKind: "ac";
      attackId: string;
      attackIds: string[];
      offHandAttackCount: number;
      action: WeaponActionKind;
      stepIndex: number;
      label: string;
      actionPlanId?: string;
      actionStepIds?: string[];
      repeatCount?: number;
      maneuverId?: string;
      flags?: string[];
      systemId?: string;
      systemEntryId?: string;
      followupDamage?: { dice: DiceExpression; label: string; sourceId: string; damageType?: string };
    }
  | {
      kind: "maneuver";
      targetKind: "cmd";
      maneuver: string;
      label: string;
      abilityOverride?: AbilityId;
      babProgressionId?: string;
      flags?: string[];
      systemId?: string;
      systemEntryId?: string;
      spendStandardAction?: boolean;
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

/** Carry additive authored defaults from a sample into older saved copies. */
function migrateSampleDefaults(saved: CharacterInput, sample: ReturnType<typeof sampleForCharacterId>): CharacterInput {
  if (!sample) return saved;
  let changed = false;
  let inventory = saved.inventory;
  let abilities = saved.abilities;
  // Equipment!G5:G6 incorrectly contains the level-20 WBL amount. Charlie is
  // level 3, so migrate that seeded value to the 3,000 gp level-3 amount.
  if (sample.id === "charlie" && (inventory?.gold === 880000 || inventory?.startingGold === 880000)) {
    inventory = { ...(inventory ?? {}), gold: sample.character.inventory?.gold ?? 3000 };
    delete inventory.startingGold;
    changed = true;
  } else if (sample.id === "charlie" && inventory?.gold === 3000 && inventory.startingGold === 3000) {
    // An earlier correction duplicated the same wealth as both purse and budget.
    inventory = { ...inventory };
    delete inventory.startingGold;
    changed = true;
  }
  const savedAbilityIds = new Set((saved.abilities ?? []).map((ability) => ability.id));
  const missingSampleAbilities = (sample.character.abilities ?? []).filter((ability) => !savedAbilityIds.has(ability.id));
  if (missingSampleAbilities.length) {
    abilities = [...(saved.abilities ?? []), ...clone(missingSampleAbilities)];
    changed = true;
  }
  const systems = (saved.systems ?? []).map((system) => {
    const authored = sample.character.systems?.find((item) => item.id === system.id);
    // Charlie's old sample encoded the pool/capacity mix-up as a +2 pool
    // adjustment. Remove that known fixture value when loading saved copies.
    if (sample.id === "charlie" && system.id === "charlie-rajah-veilweaving" && system.resourceMaximumBonus === 2 && authored?.resourceMaximumBonus === undefined) {
      const corrected = { ...system };
      delete corrected.resourceMaximumBonus;
      changed = true;
      return corrected;
    }
    if (system.resourceMaximumBonus !== undefined || authored?.resourceMaximumBonus === undefined) return system;
    changed = true;
    return { ...system, resourceMaximumBonus: authored.resourceMaximumBonus };
  });
  return changed
    ? { ...saved, ...(inventory !== saved.inventory ? { inventory } : {}), ...(abilities !== saved.abilities ? { abilities } : {}), systems }
    : saved;
}

/**
 * The reusable sheet controller. Authored state, rules evaluation and roll
 * planning live here; chrome and the dice overlay are deliberately outside it.
 */
export function useCharacterSheetController({
  dice,
  characterId: requestedCharacterId,
  onCharacterIdChange,
  repository: injectedRepository,
  mode: requestedMode,
  onAuthenticationRequired,
}: CharacterSheetControllerOptions) {
  // Browser mode is the default and needs no server; hosted mode is explicit.
  const environment = useMemo(() => activeSheetEnvironment(), []);
  const mode = requestedMode ?? sheetModeFor(environment);
  const discord = useDiscordRollSettings(mode === "browser");
  // The sample this browser last looked at, so a reload comes back to it. A
  // saved snapshot may replace it once, at mount; later sample switches are
  // explicit choices and are never overwritten by a load.
  const startingSampleId = useRef(loadSelectedSampleId()).current;
  const savedCharacterId = useRef(loadSelectedCharacterId()).current;
  const callerCharacterId = usableCharacterId(requestedCharacterId);
  const isCharacterIdControlled = callerCharacterId !== undefined;
  const startingCharacterId = useRef(
    callerCharacterId ?? savedCharacterId ?? sampleCharacter(startingSampleId).character.id,
  ).current;
  const [sampleId, setSampleId] = useState(startingSampleId);
  const [uncontrolledCharacterId, setUncontrolledCharacterId] = useState(
    startingCharacterId,
  );
  const characterId = callerCharacterId ?? uncontrolledCharacterId;
  const [character, setCharacter] = useState<CharacterInput>(() =>
    draftForCharacterId(startingCharacterId),
  );
  const characterRef = useRef(character);
  const startingSample = sampleForCharacterId(startingCharacterId);
  const [notice, setNotice] = useState(
    mode === "browser"
      ? startingSample
        ? "Demo mode · " + startingSample.label + " loaded"
        : "Demo mode · new character draft ready"
      : "Local draft ready",
  );
  const [integrationNotice, setIntegrationNotice] = useState<string | null>(
    null,
  );
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** An optional caller-entered DC; blank means "no known DC". */
  const [rollDc, setRollDc] = useState("");
  /** Target defenses are transient table context, not character data. */
  const [attackAc, setAttackAc] = useState("");
  const [targetCover, setTargetCover] = useState<CoverLevel | "none">("none");
  const [targetMissChance, setTargetMissChance] = useState(0);
  const [ignoreNonTotalCover, setIgnoreNonTotalCover] = useState(false);
  const [reflexCover, setReflexCover] = useState<CoverLevel | "none">("none");
  const [maneuverCmd, setManeuverCmd] = useState("");
  const [maneuverAbilityOverride, setManeuverAbilityOverride] = useState<AbilityId | "">("");
  const [maneuverBabProgressionId, setManeuverBabProgressionId] = useState("");
  const [pendingTargetRoll, setPendingTargetRoll] =
    useState<PendingTargetRollIntent | null>(null);
  const [pendingTargetValue, setPendingTargetValue] = useState("");
  const [pendingTargetError, setPendingTargetError] = useState<string | null>(
    null,
  );
  const pendingTargetTrigger = useRef<HTMLElement | null>(null);
  const combatActionRollInProgress = useRef(false);
  const [lastRoll, setLastRoll] = useState<{
    plan: RollPlan;
    resolved: ResolvedRoll;
  } | null>(null);
  const [lastHostedRoll, setLastHostedRoll] = useState<HostedRollResponse | null>(null);
  const [rollHistory, setRollHistory] = useState<HostedRollResponse[]>([]);
  const [criticalAttackResults, setCriticalAttackResults] = useState<Record<string, boolean>>({});
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
  const [manualFeatureActionRestrictions, setManualFeatureActionRestrictions] = useState<FeatureActionRestriction[]>([]);
  const [featureModes, setFeatureModes] = useState<NonNullable<EffectApplicability["modes"]>>([]);
  const [featureKinds, setFeatureKinds] = useState<NonNullable<EffectApplicability["kinds"]>>([]);
  const [featureTouch, setFeatureTouch] = useState<"any" | "touch" | "nonTouch">("any");
  const [featureAction, setFeatureAction] = useState<"any" | "standard" | "full">("any");
  const [featureAttackIds, setFeatureAttackIds] = useState("");
  const [featureRequiredTags, setFeatureRequiredTags] = useState<NonNullable<EffectApplicability["requiredTags"]>>([]);
  const [featureExcludedTags, setFeatureExcludedTags] = useState<NonNullable<EffectApplicability["excludedTags"]>>([]);
  const [featureRequiredFlags, setFeatureRequiredFlags] = useState("");
  const [featureExcludedFlags, setFeatureExcludedFlags] = useState("");
  const [attackName, setAttackName] = useState("");
  const [attackDice, setAttackDice] = useState("1d8");
  const [attackCriticalRange, setAttackCriticalRange] = useState("");
  const [attackCriticalMultiplier, setAttackCriticalMultiplier] = useState("");
  const [attackDamageBySize, setAttackDamageBySize] = useState<Record<string, string>>({});
  const [attackAbility, setAttackAbility] = useState<AbilityId>("str");
  const [attackIsNatural, setAttackIsNatural] = useState(false);
  const [attackFlurryEligible, setAttackFlurryEligible] = useState(false);
  const [attackNaturalRole, setAttackNaturalRole] = useState<"primary" | "secondary">("primary");
  const [equipmentId, setEquipmentId] = useState("");
  const [customWeaponName, setCustomWeaponName] = useState("");
  const [customWeaponDice, setCustomWeaponDice] = useState("1d6");
  const [customWeaponCriticalRange, setCustomWeaponCriticalRange] = useState("");
  const [customWeaponCriticalMultiplier, setCustomWeaponCriticalMultiplier] = useState("");
  const [customWeaponAttackCount, setCustomWeaponAttackCount] = useState("1");
  const [customWeaponOffHand, setCustomWeaponOffHand] = useState(false);
  const [customWeaponLight, setCustomWeaponLight] = useState(false);
  const [customWeaponNatural, setCustomWeaponNatural] = useState(false);
  const [customWeaponNaturalRole, setCustomWeaponNaturalRole] = useState<"primary" | "secondary">("primary");
  const [customWeaponProficient, setCustomWeaponProficient] = useState(true);
  const [customWeaponFlurryEligible, setCustomWeaponFlurryEligible] = useState(false);
  const [weaponEnhancement, setWeaponEnhancement] = useState("0");
  const [weaponAttackAdjustment, setWeaponAttackAdjustment] = useState("0");
  const [weaponStrengthRating, setWeaponStrengthRating] = useState("");
  const [profileId, setProfileId] = useState("");
  const [casterLevelSourceId, setCasterLevelSourceId] = useState("");
  const [repo] = useState(() => injectedRepository ?? repositoryFor(mode, environment));
  const [savedCharacters, setSavedCharacters] = useState<Array<{ id: string; name: string; campaignId?: string }>>([]);
  const [linkedTargetId, setLinkedTargetId] = useState("");
  const [linkedTargetCharacter, setLinkedTargetCharacter] = useState<CharacterInput | null>(null);
  const [targetDefenseContext, setTargetDefenseContext] = useState<DefenseContext>("normal");
  const refreshSavedCharacters = async () => {
    try { setSavedCharacters(await repo.list()); } catch { setSavedCharacters([]); }
  };
  useEffect(() => { void refreshSavedCharacters(); }, [repo]);
  useEffect(() => {
    let active = true;
    setLinkedTargetCharacter(null);
    if (!linkedTargetId) return () => { active = false; };
    void repo.load(linkedTargetId).then((loaded) => {
      if (active) setLinkedTargetCharacter(loaded);
    }).catch(() => {
      if (active) setLinkedTargetCharacter(null);
    });
    return () => { active = false; };
  }, [repo, linkedTargetId]);
  const linkedTargetDerived = useMemo(() => {
    if (!linkedTargetCharacter || linkedTargetCharacter.id !== linkedTargetId) return undefined;
    try { return new RulesEngine(linkedTargetCharacter, rulesCatalogs).derive(); }
    catch { return undefined; }
  }, [linkedTargetCharacter, linkedTargetId]);
  const linkedTargetDefenseValue = linkedTargetDerived
    ? ({
        normal: linkedTargetDerived.ac.value,
        touch: linkedTargetDerived.touchAc.value,
        flatFooted: linkedTargetDerived.flatFootedAc.value,
        deniedDexterity: linkedTargetDerived.deniedDexAc.value,
      } satisfies Record<DefenseContext, number>)[targetDefenseContext]
    : undefined;
  const linkedTargetTouchAc = linkedTargetDerived?.touchAc.value;
  const linkedTargetCmdValue = linkedTargetDerived?.cmd.value;
  const linkedTargetCmbValue = linkedTargetDerived?.cmb.value;
  const linkedTargetNoteDefenses = useMemo(
    () => deriveNoteDefenses((linkedTargetCharacter?.features ?? []).filter((feature) => feature.enabled).map((feature) => feature.notes ?? "")),
    [linkedTargetCharacter],
  );
  const linkedTargetSpellResistance = linkedTargetCharacter?.id === linkedTargetId
    ? Math.max(linkedTargetCharacter.defenses?.spellResistance ?? 0, linkedTargetNoteDefenses.spellResistance ?? 0) || undefined
    : undefined;
  const refreshLinkedTarget = async () => {
    if (!linkedTargetId) return;
    try { setLinkedTargetCharacter(await repo.load(linkedTargetId)); }
    catch { setLinkedTargetCharacter(null); }
  };
  const editRevision = useRef(0);
  const isDirtyRef = useRef(false);
  // HTTP revisions live in the repository. Serialize calls so an older save
  // cannot overtake a newer one and reuse a stale revision token.
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const activeSaves = useRef(0);
  const loadRevision = useRef(0);
  const pendingSampleDraft = useRef<PendingSampleDraft | null>(null);
  useEffect(() => {
    let active = true;
    const revision = ++loadRevision.current;
    // A new target is a distinct authored-state session. Edits to the old
    // character must not suppress a persisted load for this one.
    editRevision.current = 0;
    isDirtyRef.current = false;
    setIsDirty(false);
    setLastRoll(null);
    setLastHostedRoll(null);
    setRollHistory([]);
    setIntegrationNotice(null);
    setPendingTargetRoll(null);
    setPendingTargetValue("");
    setPendingTargetError(null);
    pendingTargetTrigger.current = null;
    const pending = pendingSampleDraft.current;
    if (pending?.character.id === characterId) {
      pendingSampleDraft.current = null;
      characterRef.current = pending.character;
      setCharacter(pending.character);
      setSelected(null);
      setError(null);
      setNotice(pending.notice);
      return () => {
        active = false;
      };
    }

    const sample = sampleForCharacterId(characterId);
    const draft = draftForCharacterId(characterId);
    characterRef.current = draft;
    setCharacter(draft);
    setSelected(null);
    setError(null);
    if (!sample)
      setNotice(
        mode === "browser"
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
        const migrationSample = sample ?? (saved.attacks?.some((attack) => attack.id === "izanamis-nodachi")
          ? sampleCharacter("charlie")
          : undefined);
        const migrated = migrateSampleDefaults(saved, migrationSample);
        new RulesEngine(migrated, rulesCatalogs).derive();
        characterRef.current = migrated;
        setCharacter(migrated);
        if (migrated !== saved) {
          void repo.save(migrated).then(() => {
            if (active && revision === loadRevision.current && editRevision.current === 0) setNotice("Updated and saved workbook-derived system values.");
          }).catch(() => {
            if (active && revision === loadRevision.current && editRevision.current === 0) setNotice("Workbook-derived system values updated; save the character to keep them.");
          });
          return;
        }
        setNotice(
          mode === "browser"
            ? "Demo mode · reloaded your saved sheet"
            : "Saved character loaded",
        );
      })
      .catch((failure) => {
        notifyAuthenticationRequired(failure);
        if (active && revision === loadRevision.current)
          setError(errorText(failure));
      });
    return () => {
      active = false;
    };
  }, [characterId, mode, repo, onAuthenticationRequired]);
  const catalog = useMemo(
    () => activeCatalog(character),
    [character.customProgressions],
  );
  const evaluated = useMemo(() => {
    try {
      let evaluationCharacter = character;
      if (character.workbookOptions?.woundThresholds) {
        const baseline = new RulesEngine(character, rulesCatalogs).derive();
        const penalty = unchainedWoundPenalty(baseline.currentHp, baseline.maxHp.value);
        if (penalty) {
          const source = { id: "autosheet.unchained-wounds", label: "Unchained Wound System" };
          const effects: Effect[] = [
            { kind: "modifier", target: "ac", value: penalty, bonusType: "penalty", appliesTo: ["normal", "touch", "flatFooted"], source },
            ...(["fortitude", "reflex", "will"] as const).map((save) => ({ kind: "modifier" as const, target: `save.${save}` as const, value: penalty, bonusType: "penalty" as const, source })),
            { kind: "modifier" as const, target: "attack.melee" as const, value: penalty, bonusType: "penalty" as const, source },
            { kind: "modifier" as const, target: "attack.ranged" as const, value: penalty, bonusType: "penalty" as const, source },
            { kind: "modifier" as const, target: "skill.all" as const, value: penalty, bonusType: "penalty" as const, source },
            { kind: "modifier" as const, target: "casterLevel" as const, value: penalty, bonusType: "penalty" as const, source },
          ];
          const feature: FeatureInstance = { id: "autosheet-unchained-wounds", name: "Unchained Wound System", description: `Current HP threshold penalty: ${penalty}.`, enabled: true, effects };
          evaluationCharacter = { ...character, features: [...character.features, feature] };
        }
      }
      const engine = new RulesEngine(evaluationCharacter, rulesCatalogs);
      return { engine, derived: engine.derive(), error: null as string | null };
    } catch (failure) {
      const engine = new RulesEngine(defaultSample().character, rulesCatalogs);
      return { engine, derived: engine.derive(), error: errorText(failure) };
    }
  }, [character]);
  const engine = evaluated.engine;
  const derived = evaluated.derived;
  const offHandAttackCount = character.workbookOptions?.offHandAttackCount ?? 0;
  const noteDerivedDefenses = useMemo(() => deriveNoteDefenses(character.features.filter((feature) => feature.enabled).map((feature) => feature.notes ?? "")), [character.features]);

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
      isDirtyRef.current = true;
      setIsDirty(true);
      characterRef.current = next;
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
    apply({ ...characterRef.current, ...changes }, success);
  const confirmDiscardUnsavedChanges = (action: string) => {
    if (!isDirtyRef.current) return true;
    return globalThis.confirm(
      `Unsaved changes to ${characterRef.current.name} will be lost if you ${action}. Save first or cancel to keep working.`,
    );
  };
  const setOffHandAttackCount = (count: number) => update({
    workbookOptions: { ...character.workbookOptions, offHandAttackCount: count },
  }, `Set off-hand attack count to ${count}`);
  const healthAction = (operation: (value: CharacterInput) => CharacterInput, message: string) => {
    try { apply(operation(characterRef.current), message); }
    catch (failure) { fail(errorText(failure)); }
  };
  const takeDamage = (amount: number, damageType = "untyped", bypass?: string, attackerType?: string) => {
    try {
      const current = characterRef.current;
      const currentEngine = new RulesEngine(current, rulesCatalogs);
      const materialDefenses = currentEngine.equipment.filter((item) => item.equipped);
      const resistances = { ...(current.defenses?.energyResistances ?? {}) };
      for (const item of materialDefenses) if (item.materialEnergyResistance) resistances[item.materialEnergyResistance.damageType] = Math.max(resistances[item.materialEnergyResistance.damageType] ?? 0, item.materialEnergyResistance.amount);
      const currentNoteDefenses = deriveNoteDefenses(current.features.filter((feature) => feature.enabled).map((feature) => feature.notes ?? ""));
      const damageReduction = [...(current.defenses?.damageReduction ?? []), ...currentNoteDefenses.damageReduction, ...materialDefenses.flatMap((item) => item.materialDamageReduction ? [item.materialDamageReduction] : [])];
      const mitigation = mitigateDamage({ ...current, defenses: { ...current.defenses, energyResistances: resistances, damageReduction } }, amount, damageType, bypass, attackerType);
      const absorbed = Math.min(current.temporaryHp, mitigation.afterDamageReduction);
      apply(applyDamage(current, mitigation.afterDamageReduction), `Took ${amount} ${damageType} damage: ${mitigation.immune ? "immune" : `${mitigation.resistance} resistance and ${mitigation.damageReduction} DR`} applied; ${absorbed} temporary HP absorbed, ${mitigation.afterDamageReduction - absorbed} HP lost`);
    } catch (failure) { fail(errorText(failure)); }
  };
  const heal = (amount: number) => healthAction((value) => applyHealing(value, amount), `Healed ${amount} HP`);
  const grantTemporaryHp = (amount: number) => healthAction((value) => setTemporaryHp(value, amount), `Temporary HP set to ${amount}`);
  const removeTemporaryHp = () => healthAction(clearTemporaryHp, "Temporary HP cleared");
  const fail = (message: string) => {
    setError(message);
    setNotice("Change not applied");
  };
  const notifyAuthenticationRequired = (failure: unknown) => {
    if (failure instanceof CharacterApiError && failure.code === "unauthenticated") onAuthenticationRequired?.();
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
  const dropHeldInventoryItems = () => (character.equipment ?? []).map((item) => {
    const kind = item.kind ?? equipmentCatalog[item.definitionId ?? ""]?.kind;
    const held = item.held === true || (item.held === undefined && item.equipped
      && (kind === "weapon" || kind === "shield" && item.shieldOccupiesHand !== false || Boolean(item.attack)));
    if (!held) return item;
    return {
      ...item,
      held: false,
      carried: false,
      ...((kind === "weapon" || kind === "shield" || item.attack) ? { equipped: false } : {}),
    };
  });
  const toggleFeature = (id: string) => {
    const selected = character.features.find((feature) => feature.id === id);
    const definition = selected?.definitionId ? featureCatalog[selected.definitionId] : undefined;
    const group =
      selected && !selected.enabled ? groupFor(selected) : undefined;
    const activating = selected !== undefined && !selected.enabled;
    update({
      features: character.features.map((feature) =>
        feature.id === id
          ? { ...feature, enabled: !feature.enabled, ...(!feature.enabled ? {} : { roundsRemaining: undefined }) }
          : group && groupFor(feature) === group
            ? { ...feature, enabled: false, roundsRemaining: undefined }
            : feature,
      ),
      ...(activating && definition?.dropHeldItemsOnActivation ? {
        equipment: dropHeldInventoryItems(),
      } : {}),
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
        ...(definition.dropHeldItemsOnActivation ? { equipment: dropHeldInventoryItems() } : {}),
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
    const appliesWhen: EffectApplicability = {
      ...(featureKinds.length ? { kinds: featureKinds } : {}),
      ...(featureModes.length ? { modes: featureModes } : {}),
      ...(featureTouch !== "any" ? { touch: featureTouch === "touch" } : {}),
      ...(featureAction !== "any" ? { fullAttack: featureAction === "full" } : {}),
      ...(featureAttackIds.trim() ? { attackIds: featureAttackIds.split(",").map((id) => id.trim()).filter(Boolean) } : {}),
      ...(featureRequiredTags.length ? { requiredTags: featureRequiredTags } : {}),
      ...(featureExcludedTags.length ? { excludedTags: featureExcludedTags } : {}),
      ...(featureRequiredFlags.trim() ? { requiredFlags: featureRequiredFlags.split(",").map((flag) => slug(flag.trim())).filter(Boolean) } : {}),
      ...(featureExcludedFlags.trim() ? { excludedFlags: featureExcludedFlags.split(",").map((flag) => slug(flag.trim())).filter(Boolean) } : {}),
    };
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
              ...(Object.keys(appliesWhen).length ? { appliesWhen } : {}),
            }
          : {
              kind: "modifier",
              target: featureTarget,
              value,
              bonusType: featureBonus,
              ...(Object.keys(appliesWhen).length ? { appliesWhen } : {}),
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
      ...(manualFeatureActionRestrictions.length ? { actionRestrictions: manualFeatureActionRestrictions } : {}),
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
    if (!attackName.trim() || !dice || Object.values(attackDamageBySize).some((value) => value.trim() && !/^(\d+)d(\d+)$/i.test(value.trim()))) {
      fail("Use an attack name and dice in the form 1d8. Size-specific dice must also use NdN.");
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
      ...(attackCriticalRange ? { criticalRange: { minimumNaturalRoll: Number(attackCriticalRange) } } : {}),
      ...(attackCriticalMultiplier ? { criticalMultiplier: Number(attackCriticalMultiplier) } : {}),
      ...(Object.entries(attackDamageBySize).some(([, value]) => value.trim()) ? {
        damageBySize: Object.fromEntries(Object.entries(attackDamageBySize).flatMap(([size, value]) => {
          if (!value.trim()) return [];
          const parsed = /^(\d+)d(\d+)$/i.exec(value.trim())!;
          return [[size, { count: Number(parsed[1]), sides: Number(parsed[2]) }]];
        })),
      } : {}),
      ...(attackIsNatural ? { attackCount: Math.max(1, Math.min(256, Math.trunc(Number(customWeaponAttackCount) || 1))), naturalAttackRole: attackNaturalRole } : {}),
      mode: "melee",
      attackTags: ["weapon.melee", ...(attackIsNatural ? ["natural.attack" as const] : [])],
      ...(attackFlurryEligible ? { eligibilityTags: ["monk-flurry-weapon"] } : {}),
    };
    if (
      update(
        { attacks: [...character.attacks, attack] },
        "Added " + attack.name,
      )
    ) {
      setAttackName("");
      setAttackCriticalRange("");
      setAttackCriticalMultiplier("");
      setAttackDamageBySize({});
    }
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
    if (attackProfileCatalog[profileId]?.attackBaseline === "casterLevel" && !character.spellcastingSources?.some((source) => source.id === casterLevelSourceId)) {
      fail("Choose a spellcasting source for this caster-level attack.");
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
    const naturalAttack = customWeaponNatural || attackProfileCatalog[profileId]?.attackTags.includes("natural.attack") === true;
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
      proficient: customWeaponProficient,
      ...(customWeaponFlurryEligible ? { eligibilityTags: ["monk-flurry-weapon"] } : {}),
      ...(customWeaponCriticalRange ? { criticalRange: { minimumNaturalRoll: Number(customWeaponCriticalRange) } } : {}),
      ...(customWeaponCriticalMultiplier ? { criticalMultiplier: Number(customWeaponCriticalMultiplier) } : {}),
      ...(naturalAttack ? {
        attackCount: Math.max(1, Math.min(256, Math.trunc(Number(customWeaponAttackCount) || 1))),
        naturalAttackRole: customWeaponNaturalRole,
      } : {}),
      ...(attackProfileCatalog[profileId]?.attackBaseline === "casterLevel" && casterLevelSourceId ? { casterLevelSourceId } : {}),
      ...(weaponStrengthRating.trim()
        ? { damageAbilityMaximum: Number(weaponStrengthRating) }
        : {}),
      attackTags: [
        ...new Set([
          ...(profileId ? attackProfileCatalog[profileId]?.attackTags ?? [] : ["weapon.melee" as const]),
          ...(customWeaponOffHand ? ["weapon.off-hand" as const] : []),
          ...(customWeaponLight ? ["weapon.light" as const] : []),
          ...(customWeaponNatural ? ["natural.attack" as const] : []),
        ]),
      ],
      ...(customWeaponNatural ? { naturalAttackRole: customWeaponNaturalRole } : {}),
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
    if (added) {
      setCustomWeaponName("");
      setCustomWeaponCriticalRange("");
      setCustomWeaponCriticalMultiplier("");
      setCustomWeaponOffHand(false);
      setCustomWeaponLight(false);
      setCustomWeaponProficient(true);
      setCustomWeaponFlurryEligible(false);
      setCustomWeaponNatural(false);
      setCustomWeaponNaturalRole("primary");
    }
  };
  /**
   * Loads a sample from scratch. It is authored state, never a saved snapshot:
   * switching samples is a fresh start, and saving afterwards is what persists.
   */
  const requestCharacterId = (nextCharacterId: string): boolean => {
    if (nextCharacterId === characterId) return true;
    loadRevision.current += 1;
    if (isCharacterIdControlled) {
      if (!onCharacterIdChange) {
        fail("This sheet's character is controlled by its caller.");
        return false;
      }
      onCharacterIdChange(nextCharacterId);
      saveSelectedCharacterId(nextCharacterId);
      return true;
    }
    setUncontrolledCharacterId(nextCharacterId);
    saveSelectedCharacterId(nextCharacterId);
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
    if (nextCharacterId !== characterId && !confirmDiscardUnsavedChanges("switch characters")) return false;
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
    if (!confirmDiscardUnsavedChanges(targetChanges ? `load the ${sample.label} sample` : `reset to the ${sample.label} sample`)) return;

    setSampleId(id);
    saveSelectedSampleId(id);
    saveSelectedCharacterId(next.id);
    if (!targetChanges) {
      apply(next, sampleNotice, true);
      return;
    }
    loadRevision.current += 1;

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
    () => {
      const defense = linkedTargetDefenseValue !== undefined
        ? { kind: "ac" as const, value: linkedTargetDefenseValue, context: targetDefenseContext }
        : defenseFromInput(attackAc, "ac");
      return defense
        ? {
            ...defense,
            ...(targetCover !== "none" ? { cover: targetCover } : {}),
            ...(targetMissChance ? { missChance: targetMissChance } : {}),
            ...(ignoreNonTotalCover ? { ignoreNonTotalCover: true } : {}),
          }
        : defense;
    },
    [attackAc, targetCover, targetMissChance, ignoreNonTotalCover, linkedTargetDefenseValue, targetDefenseContext],
  );
  const maneuverDefense = useMemo(
    () => linkedTargetCmdValue !== undefined ? { kind: "cmd" as const, value: linkedTargetCmdValue } : defenseFromInput(maneuverCmd, "cmd"),
    [maneuverCmd, linkedTargetCmdValue],
  );

  /**
   * The sole UI execution gateway: an engine-authored plan resolves locally,
   * then presentation and optional publishing consume that completed result.
   */
  const rollPlan = async (plan: RollPlan) => {
    try {
      if (mode === "hosted" && isDirtyRef.current && !await save()) {
        setIntegrationNotice("Save your changes before rolling.");
        return null;
      }
      if (mode === "hosted") await saveQueue.current;
      if (plan.context.kind === "attack") {
        setCriticalAttackResults((previous) => {
          if (!(plan.id in previous)) return previous;
          const next = { ...previous };
          delete next[plan.id];
          return next;
        });
      }
      const recorded = mode === "hosted"
        ? await recordHostedRoll(characterRef.current, plan, Number(repo.getRevision?.(characterRef.current.id)))
        : null;
      const displayPlan = recorded?.plan ?? plan;
      const result = recorded?.result ?? resolveRollPlan(plan, (await new BrowserDiceProvider().roll({
        planId: plan.id,
        dice: plan.dice,
      })).faces);
      // The authoritative faces already decided the result; the overlay is only
      // asked to land the dice on them.
      setLastRoll({ plan: displayPlan, resolved: result });
      setLastHostedRoll(recorded);
      if (recorded) setRollHistory((previous) => [recorded, ...previous.filter((item) => item.rollId !== recorded.rollId)].slice(0, 20));
      try { dice.present(displayPlan, result, { characterName: character.name }); }
      catch { /* The recorded result and delivery status remain visible without 3D dice. */ }
      if (plan.context.kind === "attack") {
        setCriticalAttackResults((previous) => {
          const next = { ...previous, [plan.id]: result.outcome.critical === true };
          const ids = Object.keys(next);
          while (ids.length > 64) delete next[ids.shift()!];
          return next;
        });
      }
      setNotice(formatRollResultNotice(character.name, displayPlan, result));
      setIntegrationNotice(recorded ? `${hostedDeliveryNotice(recorded.delivery)} Roll reference: ${recorded.rollId.slice(0, 8)}.` : null);
      // Publishing is deliberately outside the local completion path. A
      // rejected/deleted webhook never replaces the result the player just got.
      if (mode === "browser") {
        void publishCompletedRoll(discord.settings, character.name, plan, result)
          .then((published) => {
            if (published) setIntegrationNotice("Roll published to Discord.");
          })
          .catch(() => {
            setIntegrationNotice(
              "Discord publishing failed. Your local roll is still available.",
            );
          });
      }
      return result;
    } catch (failure) {
      setNotice("Roll could not be completed: " + errorText(failure));
      return null;
    }
  };
  useEffect(() => {
    if (mode !== "hosted" || !characterId) return;
    let active = true;
    const refresh = () => {
      fetch(`/api/rolls?characterId=${encodeURIComponent(characterId)}`, { credentials: "same-origin" })
        .then(async (response) => response.ok ? response.json() as Promise<{ rolls: HostedRollResponse[] }> : null)
        .then((body) => { if (active && body) setRollHistory(body.rolls); })
        .catch(() => { /* History remains available on the next refresh. */ });
    };
    refresh();
    const timer = globalThis.setInterval(refresh, 15_000);
    return () => { active = false; globalThis.clearInterval(timer); };
  }, [characterId, mode]);
  useEffect(() => {
    if (mode !== "hosted" || !lastHostedRoll || !["pending", "sending", "retryable_failed"].includes(lastHostedRoll.delivery.state)) return;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(`/api/rolls/${encodeURIComponent(lastHostedRoll.rollId)}`, { credentials: "same-origin" });
        if (!response.ok) return;
        const recorded = await response.json() as HostedRollResponse;
        if (!active || recorded.rollId !== lastHostedRoll.rollId) return;
        setLastHostedRoll(recorded);
        setRollHistory((previous) => previous.map((item) => item.rollId === recorded.rollId ? recorded : item));
        setIntegrationNotice(`${hostedDeliveryNotice(recorded.delivery)} Roll reference: ${recorded.rollId.slice(0, 8)}.`);
      } catch { /* The recorded roll remains available for the next status check. */ }
    };
    const timer = globalThis.setInterval(() => { void poll(); }, 5_000);
    return () => { active = false; globalThis.clearInterval(timer); };
  }, [lastHostedRoll?.rollId, lastHostedRoll?.delivery.state, mode]);
  const retryHostedDelivery = async (target: HostedRollResponse | null = lastHostedRoll) => {
    if (!target) return;
    const unknown = target.delivery.state === "delivery_unknown";
    if (unknown && !globalThis.confirm("Discord may already have this roll. Check the channel using its roll reference before sending again; a duplicate message is possible. Retry sending?")) return;
    try {
      const response = await fetch(`/api/rolls/${encodeURIComponent(target.rollId)}/discord/retry`, {
        method: "POST", credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(unknown ? { confirmPossibleDuplicate: true } : {}),
      });
      const body = await response.json() as HostedRollResponse & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Discord delivery could not be retried.");
      if (lastHostedRoll?.rollId === body.rollId) setLastHostedRoll(body);
      setRollHistory((previous) => previous.map((item) => item.rollId === body.rollId ? body : item));
      setIntegrationNotice(`${hostedDeliveryNotice(body.delivery)} Roll reference: ${body.rollId.slice(0, 8)}.`);
    } catch (failure) {
      setIntegrationNotice("Discord delivery: " + errorText(failure));
    }
  };
  /** Build one exact weapon action for both display and button execution. */
  const engineForSystemEntry = (systemId?: string, entryId?: string) => {
    if (!systemId || !entryId) return engine;
    const system = engine.character.systems?.find((item) => item.id === systemId);
    if (!system || !system.entries.some((entry) => entry.id === entryId)) return engine;
    const activatedCharacter = {
      ...engine.character,
      systems: engine.character.systems!.map((item) => item.id !== systemId ? item : {
        ...item,
        entries: item.entries.map((entry) => entry.id === entryId ? { ...entry, active: true } : entry),
      }),
    };
    return new RulesEngine(activatedCharacter, rulesCatalogs);
  };
  const linkedTargetFlags = linkedTargetCharacter?.id === linkedTargetId
    ? [
        ...(linkedTargetCharacter.activeConditions ?? []).map((condition) => `target-${slug(condition)}`).filter((flag) => flag !== "target-"),
        ...(linkedTargetDerived && (linkedTargetCharacter.nonlethalDamage ?? 0) >= linkedTargetDerived.currentHp && (linkedTargetCharacter.nonlethalDamage ?? 0) > 0
          ? [`target-${(linkedTargetCharacter.nonlethalDamage ?? 0) > linkedTargetDerived.currentHp ? "unconscious" : "staggered"}`]
          : []),
      ]
    : [];
  const createWeaponActionPlan = (
    attackId: string,
    action: WeaponActionKind,
    defense: RollDefense | null | undefined = attackDefense,
    attackIds: string[] = [attackId],
    offHandAttackCount = 0,
    maneuver?: string,
    planEngine: RulesEngine = engine,
    contextFlags: string[] = [],
  ) =>
    planEngine.createActionPlan({
      action,
      attackIds,
      offHandAttackCount,
      ...(maneuver ? { maneuver } : {}),
      ...((linkedTargetFlags.length || contextFlags.length) ? { flags: [...new Set([...linkedTargetFlags, ...contextFlags])] } : {}),
      ...(defense ? { defense } : {}),
      ...(linkedTargetCharacter?.id === linkedTargetId ? { target: { characterId: linkedTargetCharacter.id, name: linkedTargetCharacter.name } } : {}),
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
      ...(context.action.offHandAttackCount !== undefined ? { offHandAttackCount: context.action.offHandAttackCount } : {}),
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
    criticalAttackResults[attack.id] === true;
  const createManeuverPlan = (
    maneuver: string,
    defense: RollDefense | null | undefined = maneuverDefense,
    abilityOverride: AbilityId | "" = maneuverAbilityOverride,
    babProgressionId = maneuverBabProgressionId,
    planEngine: RulesEngine = engine,
    contextFlags: string[] = [],
  ) =>
    planEngine.createManeuverRollPlan(
      maneuver,
      { ...(defense ? { defense } : {}), ...(abilityOverride ? { abilityOverride } : {}), ...(babProgressionId ? { babProgressionId } : {}), ...((linkedTargetFlags.length || contextFlags.length) ? { flags: [...new Set([...linkedTargetFlags, ...contextFlags])] } : {}) },
    );
  const currentDefenseFor = (kind: RollDefense["kind"]) =>
    kind === "dc" ? dcDefense : kind === "ac" ? attackDefense : maneuverDefense;
  const currentTargetValueFor = (kind: RollDefense["kind"]) =>
    kind === "dc" ? rollDc : kind === "ac" ? attackAc : linkedTargetCmdValue !== undefined ? String(linkedTargetCmdValue) : maneuverCmd;
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
          { ...(defense ? { defense } : {}), ...(intent.cover ? { cover: intent.cover } : {}) },
        );
      case "skill":
        return engineForSystemEntry(intent.systemId, intent.systemEntryId).createSkillRollPlan(
          intent.skillId,
          { ...(defense ? { defense } : {}), ...(intent.flags ? { flags: intent.flags } : {}) },
        );
      case "maneuver":
        return createManeuverPlan(intent.maneuver, defense ?? null, intent.abilityOverride ?? "", intent.babProgressionId ?? "", engineForSystemEntry(intent.systemId, intent.systemEntryId), intent.flags);
      case "weapon": {
        const planEngine = engineForSystemEntry(intent.systemId, intent.systemEntryId);
        const actionPlan = createWeaponActionPlan(
          intent.attackId,
          intent.action,
          defense ?? null,
          intent.attackIds,
          intent.offHandAttackCount,
          intent.maneuverId,
          planEngine,
          intent.flags,
        );
        return (
          actionPlan.attacks.find((attack) => attack.attackId === intent.attackId)?.steps.find(
            (step) => step.index === intent.stepIndex,
          )?.roll ?? null
        );
      }
    }
  };
  const executeTargetIntent = async (
    intent: PendingTargetRollIntent,
    defense: RollDefense | undefined,
  ) => {
    const plan = planForTargetIntent(intent, defense);
    if (!plan) {
      setNotice("That roll is no longer available. Please try again.");
      return;
    }
    const actionRestrictions = engine.actionRestrictions();
    if ((intent.kind === "weapon" || intent.kind === "maneuver" || intent.kind === "skill" && intent.spendStandardAction) && (actionRestrictions.includes("noActions") || actionRestrictions.includes("noPhysicalActions") || actionRestrictions.includes("moveOnly") || actionRestrictions.includes("fleeOnly"))) {
      setNotice("An active condition prevents this combat action.");
      return;
    }
    if (intent.kind === "weapon" && actionRestrictions.includes("noTwoHandedActions") && plan.context.attackTags?.includes("weapon.two-handed")) {
      setNotice("Grappled characters cannot use two-handed weapons.");
      return;
    }
    if (intent.kind === "weapon" && intent.action === "fullAttack" && actionRestrictions.includes("oneStandardOrMove")) {
      setNotice("An active condition prevents full-round actions.");
      return;
    }
    if (intent.kind === "weapon" && plan.context.flags?.includes("shield-hand-unavailable")) {
      setNotice("That attack needs a hand occupied by an equipped shield.");
      return;
    }
    const repeatCount = intent.kind === "weapon" ? Math.max(1, Math.min(20, intent.repeatCount ?? 1)) : 1;
    const actionEngine = intent.kind === "weapon" ? engineForSystemEntry(intent.systemId, intent.systemEntryId) : engine;
    const trackedCombatAction = (intent.kind === "weapon" && !intent.systemEntryId && intent.actionPlanId)
      || ((intent.kind === "maneuver" || intent.kind === "skill") && intent.spendStandardAction && !intent.systemEntryId);
    if (trackedCombatAction && combatActionRollInProgress.current) {
      setNotice("Finish the current combat roll before starting another combat action.");
      return;
    }
    if (trackedCombatAction) combatActionRollInProgress.current = true;
    try {
    const currentTurnActions = character.turnActions ?? {};
    const stepId = plan.id;
    let nextTurnActions = currentTurnActions;
    if (trackedCombatAction) {
      if (intent.kind === "maneuver" || intent.kind === "skill") {
        const resolved = resolveTurnAction(currentTurnActions, "standard", actionEngine.actionRestrictions());
        if ("error" in resolved && resolved.error) { setNotice(resolved.error); return; }
        nextTurnActions = resolved.state;
      } else if (intent.action === "standardAttack") {
        const resolved = resolveTurnAction(currentTurnActions, "standard", actionEngine.actionRestrictions());
        if ("error" in resolved && resolved.error) { setNotice(resolved.error); return; }
        nextTurnActions = resolved.state;
      } else if (currentTurnActions.fullRoundSpent) {
        const allowed = currentTurnActions.fullAttackStepIds ?? [];
        const alreadyRolled = currentTurnActions.fullAttackRolledStepIds ?? [];
        if (currentTurnActions.fullAttackPlanId !== intent.actionPlanId || !allowed.includes(stepId) || alreadyRolled.includes(stepId)) {
          setNotice(alreadyRolled.includes(stepId) ? "That attack in the full-round action has already been rolled." : "A full-round action is already spent this turn.");
          return;
        }
        nextTurnActions = { ...currentTurnActions, fullAttackRolledStepIds: [...alreadyRolled, stepId] };
      } else {
        const resolved = resolveTurnAction(currentTurnActions, "fullRound", actionEngine.actionRestrictions());
        if ("error" in resolved && resolved.error) { setNotice(resolved.error); return; }
        nextTurnActions = { ...resolved.state, fullAttackPlanId: intent.actionPlanId, fullAttackStepIds: intent.actionStepIds ?? [stepId], fullAttackRolledStepIds: [stepId] };
      }
    }
    const usesBucklerArm = plan.context.flags?.includes("buckler-arm-used") === true;
    const shieldBash = intent.kind === "weapon" && intent.attackId.startsWith("equipment.")
      ? actionEngine.equipment.find((item) => item.id === intent.attackId.slice("equipment.".length) && item.equipped && item.kind === "shield" && item.attack)
      : undefined;
    if (shieldBash && !(nextTurnActions.shieldAcLostThisTurnIds ?? []).includes(shieldBash.id)) {
      nextTurnActions = { ...nextTurnActions, shieldAcLostThisTurnIds: [...(nextTurnActions.shieldAcLostThisTurnIds ?? []), shieldBash.id] };
    }
    if (usesBucklerArm && !nextTurnActions.bucklerAcLostThisTurn)
      nextTurnActions = { ...nextTurnActions, bucklerAcLostThisTurn: true };
    for (let index = 0; index < repeatCount; index += 1) {
      const strikePlan = repeatCount === 1 ? plan : {
        ...plan,
        id: `${plan.id}:strike:${index + 1}`,
        label: `${intent.label} · strike ${index + 1}/${repeatCount}`,
      };
      const attackResult = await rollPlan(strikePlan);
      if (!attackResult) break;
      if (nextTurnActions !== currentTurnActions) {
        const messages = [
          ...(trackedCombatAction ? [intent.kind === "maneuver" ? "Spent a standard action to attempt a combat maneuver" : intent.kind === "skill" ? "Spent a standard action for a skill check" : intent.action === "standardAttack" ? "Spent a standard attack action" : "Spent a full-round attack action"] : []),
          ...(nextTurnActions.staggeredActionSpent && !currentTurnActions.staggeredActionSpent ? ["Used the condition-limited standard-or-move action"] : []),
          ...(usesBucklerArm && !currentTurnActions.bucklerAcLostThisTurn ? ["Buckler AC bonus lost until your next turn"] : []),
          ...(shieldBash && !(currentTurnActions.shieldAcLostThisTurnIds ?? []).includes(shieldBash.id) ? [`${shieldBash.name ?? "Shield"} AC bonus lost until your next turn`] : []),
        ];
        if (!update({ turnActions: nextTurnActions }, messages.join(" · "))) return;
      }
      if ((intent.kind === "maneuver" && intent.maneuver === "escape-grapple" || intent.kind === "skill" && intent.skillId === "escape-artist") && attackResult.outcome.success === true) {
        const grappledFeatures = characterRef.current.features.map((feature) =>
          feature.definitionId === "pf1e.paizo.grappled" && feature.enabled ? { ...feature, enabled: false } : feature,
        );
        if (grappledFeatures.some((feature, index) => feature !== characterRef.current.features[index]))
          update({ features: grappledFeatures }, "Escaped the grapple");
      }
      if (intent.kind !== "weapon" || !intent.followupDamage || attackResult?.outcome.hit !== true) continue;
      const isCritical = attackResult.outcome.critical === true;
      const damage = actionEngine.createDamageRollPlan(intent.attackId, {
        action: intent.action,
        attackIndex: intent.stepIndex,
        attackIds: intent.attackIds,
        offHandAttackCount: intent.offHandAttackCount,
        ...(intent.maneuverId ? { maneuver: intent.maneuverId } : {}),
        criticalDamage: isCritical,
      });
      const multiplier = isCritical
        ? Math.max(2, ...(damage.provenance?.damageTerms ?? []).filter((term) => term.criticalBehavior === "normal").map((term) => term.multiplier))
        : 1;
      const bonus = intent.followupDamage;
      const bonusSourceId = repeatCount === 1 ? bonus.sourceId : `${bonus.sourceId}.strike.${index + 1}`;
      const damageTerm = {
        kind: "dice" as const,
        dice: bonus.dice,
        label: bonus.label,
        source: { id: bonusSourceId, label: bonus.label },
        damageType: bonus.damageType ?? "untyped",
        criticalBehavior: "normal" as const,
        multiplier,
      };
      await rollPlan({
        ...damage,
        id: `${damage.id}:${bonusSourceId}`,
        label: `${strikePlan.label} · ${damage.label}`,
        dice: [...damage.dice, { sides: bonus.dice.sides, count: bonus.dice.count * multiplier }],
        context: { ...damage.context, ...(strikePlan.context.target ? { target: strikePlan.context.target } : {}) },
        provenance: {
          ...damage.provenance!,
          damageTerms: [...(damage.provenance?.damageTerms ?? []), damageTerm],
        },
      });
    }
    } finally {
      if (trackedCombatAction) combatActionRollInProgress.current = false;
    }
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
    const restrictions = engine.actionRestrictions();
    if (intent.kind === "maneuver" && intent.maneuver === "trip" && linkedTargetDerived && linkedTargetCharacter?.id === linkedTargetId) {
      const sizeDifference = sizeCategories.indexOf(linkedTargetDerived.size.category) - sizeCategories.indexOf(derived.size.category);
      if (sizeDifference > 1) {
        setNotice(`Trip cannot affect a target more than one size category larger (${linkedTargetDerived.size.category} vs ${derived.size.category}).`);
        return;
      }
    }
    if ((intent.kind === "weapon" || intent.kind === "maneuver" || intent.kind === "skill" && intent.spendStandardAction) && (restrictions.includes("noActions") || restrictions.includes("noPhysicalActions") || restrictions.includes("moveOnly") || restrictions.includes("fleeOnly"))) {
      setNotice("An active condition prevents this combat action.");
      return;
    }
    if (intent.kind === "weapon" && restrictions.includes("noTwoHandedActions") && (character.attacks.find((attack) => attack.id === intent.attackId)?.attackTags ?? []).includes("weapon.two-handed")) {
      setNotice("Grappled characters cannot use two-handed weapons.");
      return;
    }
    if (intent.kind === "weapon" && intent.action === "fullAttack" && restrictions.includes("oneStandardOrMove")) {
      setNotice("An active condition prevents full-round actions.");
      return;
    }
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
    const enteredDefense = defenseFromInput(pendingTargetValue, intent.targetKind);
    const defense = enteredDefense?.kind === "ac" && (targetCover !== "none" || targetMissChance > 0)
      ? { ...enteredDefense, ...(targetCover !== "none" ? { cover: targetCover } : {}), ...(targetMissChance ? { missChance: targetMissChance } : {}) }
      : enteredDefense;
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
      ...(save === "reflex" && reflexCover !== "none" ? { cover: reflexCover } : {}),
      label: `${save.charAt(0).toUpperCase()}${save.slice(1)} save`,
    });
  const rollSkill = (skillId: string, use?: "jump", contextFlags: string[] = [], systemEntry?: { systemId: string; entryId: string }, spendStandardAction = false) => {
    const flags = [...(use === "jump" ? ["jump-check"] : []), ...contextFlags];
    return requestTargetedRoll({
      kind: "skill",
      targetKind: "dc",
      skillId,
      ...(flags.length ? { flags } : {}),
      ...(systemEntry ? { systemId: systemEntry.systemId, systemEntryId: systemEntry.entryId } : {}),
      ...(spendStandardAction && !systemEntry ? { spendStandardAction: true } : {}),
      label: derived.skills[skillId]?.label
        ? `${use === "jump" ? "Jump" : derived.skills[skillId]!.label} check`
        : "Skill check",
    });
  };
  const rollWeaponAttack = (
    attackId: string,
    action: WeaponActionKind,
    stepIndex: number,
    attackName: string,
    attackIds: string[] = [attackId],
    offHandAttackCount = 0,
    actionPlanId?: string,
    actionStepIds?: string[],
  ) =>
    requestTargetedRoll({
      kind: "weapon",
      targetKind: "ac",
      attackId,
      attackIds,
      offHandAttackCount,
      action,
      stepIndex,
      label:
        action === "standardAttack"
          ? `${attackName} standard attack`
          : `${attackName} attack${stepIndex ? ` ${stepIndex + 1}` : ""}`,
      ...(actionPlanId ? { actionPlanId, actionStepIds } : {}),
    });
  const rollWeaponStrike = (
    attackId: string,
    attackName: string,
    followupDamage?: { dice: DiceExpression; label: string; sourceId: string; damageType?: string },
    options: { repeatCount?: number; maneuverId?: string; flags?: string[]; systemId?: string; systemEntryId?: string } = {},
  ) => requestTargetedRoll({
    kind: "weapon",
    targetKind: "ac",
    attackId,
    attackIds: [attackId],
    offHandAttackCount: 0,
    action: "standardAttack",
    stepIndex: 0,
    label: attackName,
    ...(options.repeatCount && options.repeatCount > 1 ? { repeatCount: options.repeatCount } : {}),
    ...(options.maneuverId ? { maneuverId: options.maneuverId } : {}),
    ...(options.flags?.length ? { flags: options.flags } : {}),
    ...(options.systemId ? { systemId: options.systemId } : {}),
    ...(options.systemEntryId ? { systemEntryId: options.systemEntryId } : {}),
    ...(followupDamage ? { followupDamage } : {}),
  });
  const rollManeuver = (maneuver: string, abilityOverride?: AbilityId, babProgressionId?: string, systemEntry?: { systemId: string; entryId: string }, flags: string[] = []) => {
    const selectedAbility = abilityOverride || maneuverAbilityOverride;
    const selectedProgression = babProgressionId || maneuverBabProgressionId;
    const spendStandardAction = !systemEntry;
    return requestTargetedRoll({
      kind: "maneuver",
      targetKind: "cmd",
      maneuver,
      label: `CMB ${maneuver}`,
      ...(selectedAbility ? { abilityOverride: selectedAbility } : {}),
      ...(selectedProgression ? { babProgressionId: selectedProgression } : {}),
      ...(spendStandardAction ? { spendStandardAction: true } : {}),
      ...((linkedTargetFlags.length || flags.length) ? { flags: [...new Set([...linkedTargetFlags, ...flags])] } : {}),
      ...(systemEntry ? { systemId: systemEntry.systemId, systemEntryId: systemEntry.entryId } : {}),
    });
  };
  const save = async () => {
    const characterRevision = loadRevision.current;
    activeSaves.current += 1;
    setIsSaving(true);
    try {
      const revision = editRevision.current;
      const snapshot = characterRef.current;
      const operation = saveQueue.current.then(() => repo.save(snapshot));
      saveQueue.current = operation.catch(() => undefined);
      await operation;
      await refreshSavedCharacters();
      if (loadRevision.current !== characterRevision) return false;
      setError(null);
      const upToDate = editRevision.current === revision;
      if (upToDate) {
        isDirtyRef.current = false;
        setIsDirty(false);
        setNotice(mode === "hosted" ? "Saved to your account" : "Saved in this browser (demo mode)");
      } else {
        setNotice("Saved the previous draft; newer changes still need saving");
      }
      return upToDate;
    } catch (failure) {
      notifyAuthenticationRequired(failure);
      fail("Save failed: " + errorText(failure));
      return false;
    } finally {
      activeSaves.current -= 1;
      if (activeSaves.current === 0) setIsSaving(false);
    }
  };
  useEffect(() => {
    if (mode !== "hosted" || !isDirty) return;
    const expectedCharacterId = characterId;
    const expectedEditRevision = editRevision.current;
    const timer = globalThis.setTimeout(() => {
      if (characterRef.current.id !== expectedCharacterId || editRevision.current !== expectedEditRevision || !isDirtyRef.current) return;
      void save();
    }, 700);
    return () => globalThis.clearTimeout(timer);
  }, [character, characterId, isDirty, mode]);
  const exportLibrarySnapshot = async () => {
    const summaries = await repo.list();
    const loaded = await Promise.all(summaries.map(({ id }) => repo.load(id)));
    const characters = new Map(loaded.filter((value): value is CharacterInput => value !== null).map((value) => [value.id, value]));
    // Include the current draft so a backup never silently omits unsaved edits.
    characters.set(characterRef.current.id, characterRef.current);
    return exportCharacterLibrarySnapshot([...characters.values()]);
  };
  const reload = async () => {
    if (!confirmDiscardUnsavedChanges("reload the saved character")) return;
    try {
      const characterRevision = loadRevision.current;
      const loaded = await repo.load(characterId);
      if (loadRevision.current !== characterRevision) return;
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
      isDirtyRef.current = false;
      setIsDirty(false);
      characterRef.current = loaded;
      setCharacter(loaded);
      setLastRoll(null);
      setPendingTargetRoll(null);
      setPendingTargetValue("");
      setPendingTargetError(null);
      pendingTargetTrigger.current = null;
      setError(null);
      setNotice("Reloaded authored state");
    } catch (failure) {
      notifyAuthenticationRequired(failure);
      fail("Reload failed: " + errorText(failure));
    }
  };
  const importSnapshot = async (text: string, collisionAction?: "copy" | "replace") => {
    const characterRevision = loadRevision.current;
    try {
      let imported = importCharacterSnapshot(text);
      const existing = await repo.load(imported.id);
      if (loadRevision.current !== characterRevision) return "cancelled" as const;
      if (existing) {
        if (!collisionAction) return { status: "collision" as const, incomingName: imported.name, existingName: existing.name };
        if (collisionAction === "copy") imported = copyWithNewCharacterId(imported);
      }
      const importAction = imported.id === characterId ? "replace this character with the imported file" : "import this character";
      if (!confirmDiscardUnsavedChanges(importAction)) return "cancelled" as const;
      const editRevisionAtConfirmation = editRevision.current;
      await repo.save(imported);
      await refreshSavedCharacters();
      if (loadRevision.current !== characterRevision) {
        setNotice(`Imported ${imported.name}; the character you switched to was left unchanged`);
        return "imported" as const;
      }
      if (editRevision.current !== editRevisionAtConfirmation && isDirtyRef.current) {
        setNotice(`Imported ${imported.name}; your newer draft was left unchanged`);
        return "imported" as const;
      }
      if (imported.id === characterId) {
        if (!apply(imported, `Imported ${imported.name}`, true)) return false as const;
        isDirtyRef.current = false;
        setIsDirty(false);
      } else {
        if (!requestCharacterId(imported.id)) return false as const;
        isDirtyRef.current = false;
        setIsDirty(false);
        setNotice(`Imported ${imported.name}`);
      }
      setError(null);
      return "imported" as const;
    } catch (failure) {
      notifyAuthenticationRequired(failure);
      setError(errorText(failure));
      setNotice("Import failed");
      return false as const;
    }
  };
  const importLibrarySnapshot = async (text: string) => {
    const characterRevision = loadRevision.current;
    try {
      let imported = importCharacterLibrarySnapshot(text);
      const summaries = await repo.list();
      if (loadRevision.current !== characterRevision) return { status: "cancelled" } as const;
      const existingIds = new Set([...summaries.map(({ id }) => id), characterId]);
      const conflicts = imported.filter(({ id }) => existingIds.has(id));
      const copyConflicts = conflicts.length > 0 && !confirm(`This backup contains ${conflicts.length} character${conflicts.length === 1 ? "" : "s"} with matching IDs. Replace those existing characters in your library, including the open sheet, with the backup versions? Choose Cancel to import matching IDs as copies instead.`);
      const replacesCurrent = !copyConflicts && conflicts.some(({ id }) => id === characterId);
      if (replacesCurrent && !confirmDiscardUnsavedChanges("restore the selected character from this backup")) return { status: "cancelled" } as const;
      const editRevisionAtConfirmation = editRevision.current;
      if (copyConflicts) {
        const usedIds = new Set([...existingIds, ...imported.filter(({ id }) => !existingIds.has(id)).map(({ id }) => id)]);
        imported = imported.map((character) => {
          if (!existingIds.has(character.id)) return character;
          let copy = copyWithNewCharacterId(character);
          while (usedIds.has(copy.id)) copy = copyWithNewCharacterId(character);
          usedIds.add(copy.id);
          return copy;
        });
      }
      let count = 0;
      for (const character of imported) {
        if (loadRevision.current !== characterRevision) break;
        setNotice(`Importing character ${count + 1} of ${imported.length}: ${character.name}`);
        await repo.save(character);
        count++;
      }
      await refreshSavedCharacters();
      if (count < imported.length) {
        setNotice(`Imported ${count} of ${imported.length} characters before the selected character changed`);
        return { status: "imported", count, copied: copyConflicts ? conflicts.length : 0, replaced: copyConflicts ? 0 : conflicts.length } as const;
      }
      const activeReplacement = replacesCurrent ? imported.find(({ id }) => id === characterId) : undefined;
      if (activeReplacement && loadRevision.current === characterRevision) {
        if (editRevision.current === editRevisionAtConfirmation && apply(activeReplacement, `Restored ${activeReplacement.name}`, true)) {
          isDirtyRef.current = false;
          setIsDirty(false);
        } else if (isDirtyRef.current) {
          setNotice(`Restored ${activeReplacement.name} to the library; newer edits remain on screen. Reload to view the restored version.`);
        }
      }
      setError(null);
      if (!activeReplacement || !isDirtyRef.current) setNotice(`Imported ${count} characters${copyConflicts ? `; ${conflicts.length} added as copies` : conflicts.length ? `; ${conflicts.length} existing characters replaced` : ""}`);
      return { status: "imported", count, copied: copyConflicts ? conflicts.length : 0, replaced: copyConflicts ? 0 : conflicts.length } as const;
    } catch (failure) {
      await refreshSavedCharacters();
      notifyAuthenticationRequired(failure);
      setError(errorText(failure));
      setNotice("Library import failed; some characters may already have been saved");
      return false as const;
    }
  };
  const commitLifecycleCharacter = async (next: CharacterInput, success: string) => {
    try {
      if (next.id !== characterId && !confirmDiscardUnsavedChanges("create this character")) return false;
      parseCharacterInput(next);
      new RulesEngine(next, rulesCatalogs).derive();
      await repo.save(next);
      await refreshSavedCharacters();
      if (next.id !== characterId) {
        const selected = requestCharacterId(next.id);
        if (!selected) throw new Error("The saved character could not be selected by this sheet host.");
        isDirtyRef.current = false;
        setIsDirty(false);
        setNotice(success);
        return true;
      }
      const applied = apply(next, success);
      if (applied) {
        isDirtyRef.current = false;
        setIsDirty(false);
      }
      return applied;
    } catch (failure) {
      notifyAuthenticationRequired(failure);
      fail(errorText(failure));
      return false;
    }
  };
  return {
    dice,
    mode,
    characterId,
    savedCharacters,
    exportLibrarySnapshot,
    importLibrarySnapshot,
    linkedTargetId,
    setLinkedTargetId,
    linkedTargetCharacter,
    targetDefenseContext,
    setTargetDefenseContext,
    linkedTargetDefenseValue,
    linkedTargetTouchAc,
    linkedTargetCmdValue,
    linkedTargetCmbValue,
    linkedTargetSaves: linkedTargetDerived?.saves,
    linkedTargetSpellResistance,
    refreshLinkedTarget,
    selectCharacter,
    samples: sampleCharacters,
    sampleId,
    loadSample,
    resetSample,
    character,
    catalog,
    derived,
    abilityModifier: (id: AbilityId) => new RulesEngine(characterRef.current, rulesCatalogs).derive().abilities[id].modifier.value,
    noteDerivedDefenses,
    engine,
    engineForSystemEntry,
    evaluated,
    notice,
    integrationNotice,
    isDirty,
    isSaving,
    error,
    validationError: error ?? evaluated.error,
    selected,
    inspect,
    rollDc,
    setRollDc,
    dcDefense,
    attackAc,
    setAttackAc,
    targetCover,
    setTargetCover,
    targetMissChance,
    ignoreNonTotalCover,
    setIgnoreNonTotalCover,
    setTargetMissChance,
    reflexCover,
    setReflexCover,
    offHandAttackCount,
    setOffHandAttackCount,
    attackDefense,
    maneuverCmd,
    setManeuverCmd,
    maneuverAbilityOverride,
    setManeuverAbilityOverride,
    maneuverBabProgressionId,
    setManeuverBabProgressionId,
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
    takeDamage,
    heal,
    grantTemporaryHp,
    removeTemporaryHp,
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
    lastHostedRoll,
    rollHistory,
    retryHostedDelivery,
    rollPlan,
    rollInitiative,
    rollSave,
    rollSkill,
    rollWeaponAttack,
    rollWeaponStrike,
    rollManeuver,
    createManeuverPlan,
    createWeaponActionPlan,
    createCriticalDamagePlan,
    criticalMultiplierFor,
    canRollCriticalDamage,
    save,
    reload,
    importSnapshot,
    commitLifecycleCharacter,
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
    manualFeatureActionRestrictions,
    setManualFeatureActionRestrictions,
    featureModes,
    setFeatureModes,
    featureKinds,
    setFeatureKinds,
    featureTouch,
    setFeatureTouch,
    featureAction,
    setFeatureAction,
    featureAttackIds,
    setFeatureAttackIds,
    featureRequiredTags,
    setFeatureRequiredTags,
    featureExcludedTags,
    setFeatureExcludedTags,
    featureRequiredFlags,
    setFeatureRequiredFlags,
    featureExcludedFlags,
    setFeatureExcludedFlags,
    attackName,
    attackCriticalRange,
    setAttackCriticalRange,
    attackCriticalMultiplier,
    setAttackCriticalMultiplier,
    setAttackName,
    attackDice,
    setAttackDice,
    attackDamageBySize,
    setAttackDamageBySize,
    attackAbility,
    setAttackAbility,
    attackIsNatural,
    attackFlurryEligible,
    setAttackIsNatural,
    setAttackFlurryEligible,
    attackNaturalRole,
    setAttackNaturalRole,
    equipmentId,
    setEquipmentId,
    customWeaponName,
    customWeaponCriticalRange,
    setCustomWeaponCriticalRange,
    customWeaponCriticalMultiplier,
    setCustomWeaponCriticalMultiplier,
    setCustomWeaponName,
    customWeaponDice,
    setCustomWeaponDice,
    customWeaponAttackCount,
    customWeaponOffHand,
    setCustomWeaponOffHand,
    customWeaponLight,
    customWeaponNatural,
    setCustomWeaponNatural,
    customWeaponNaturalRole,
    setCustomWeaponNaturalRole,
    customWeaponProficient,
    customWeaponFlurryEligible,
    setCustomWeaponFlurryEligible,
    setCustomWeaponProficient,
    setCustomWeaponLight,
    setCustomWeaponAttackCount,
    weaponEnhancement,
    setWeaponEnhancement,
    weaponAttackAdjustment,
    setWeaponAttackAdjustment,
    weaponStrengthRating,
    setWeaponStrengthRating,
    profileId,
    setProfileId,
    casterLevelSourceId,
    setCasterLevelSourceId,
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
