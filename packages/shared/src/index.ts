import {
  actionKinds,
  criticalRangeSchema,
  mergeProgressionCatalogs,
  normalizeAdvancementSlots,
  parseCharacterInput,
  parseProgressionCatalog,
  rollContextSchema,
  rollDefenseSchema,
  rollOutcomePolicySchema,
  saveIds,
  type ActionKind,
  type CharacterInput,
  type ProgressionCatalog,
  type RollDefense,
  type RollDefenseKind,
  type SaveId,
} from "@threepointpf/rules-schema";
import type { ResolvedRoll, RollPlan } from "@threepointpf/dice";
import {
  RulesEngine,
  type ActionPlan,
  type RollRequestOptions,
  type RulesEngineOptions,
} from "@threepointpf/rules-core";
import { z } from "zod";

export interface CharacterRepository {
  save(character: CharacterInput): Promise<void>;
  load(id: string): Promise<CharacterInput | null>;
  list(): Promise<CharacterSummary[]>;
}

export type CharacterRevision = string | number;
export const characterSummarySchema = z.object({ id: z.string().min(1), name: z.string().min(1), campaignId: z.string().optional(), updatedAt: z.string().optional() }).strict();
export const characterReadResponseSchema = z.object({ character: z.unknown(), revision: z.union([z.string(), z.number()]).optional() }).strict();
export const characterWriteRequestSchema = z.object({ character: z.unknown(), revision: z.union([z.string(), z.number()]).optional() }).strict();
export const characterWriteResponseSchema = characterReadResponseSchema;
export const apiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }).strict() }).strict();
export type CharacterSummary = z.infer<typeof characterSummarySchema>;

export type CharacterApiErrorCode = "unauthenticated" | "forbidden" | "not-found" | "validation" | "conflict" | "server" | "network" | "protocol";
export class CharacterApiError extends Error {
  constructor(readonly code: CharacterApiErrorCode, message: string, readonly status?: number) {
    super(message); this.name = "CharacterApiError";
  }
}

/** A small structural subset keeps browser persistence testable without DOM globals. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  length?: number;
  key?(index: number): string | null;
}

/**
 * Both forms are public on purpose: older callers pass just a progression
 * catalog, while the full form carries every data catalog used by RulesEngine.
 */
export type CharacterRulesInput = ProgressionCatalog | RulesEngineOptions;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRulesEngineOptions(
  value: CharacterRulesInput,
): value is RulesEngineOptions {
  // The known fields cover the current and near-term content catalogs. The
  // check deliberately does not inspect values, so an empty full options
  // object remains a valid manual-mode configuration.
  return (
    "progressionCatalog" in value ||
    "progressionAliases" in value ||
    "skillCatalog" in value ||
    "featureCatalog" in value ||
    "abilityCatalog" in value ||
    "equipmentCatalog" in value ||
    "attackProfileCatalog" in value ||
    "experienceCatalog" in value
  );
}

function baseRulesOptions(input?: CharacterRulesInput): RulesEngineOptions {
  if (!input) return {};
  if (isRulesEngineOptions(input)) {
    return {
      ...input,
      ...(input.progressionCatalog
        ? {
            progressionCatalog: parseProgressionCatalog(
              input.progressionCatalog,
            ),
          }
        : {}),
    };
  }
  return { progressionCatalog: parseProgressionCatalog(input) };
}

function hasEntries(
  catalog: ProgressionCatalog | undefined,
): catalog is ProgressionCatalog {
  return Boolean(catalog && Object.keys(catalog).length > 0);
}

/**
 * Merges campaign/imported content with character-owned custom progressions.
 * The merge is intentionally performed at every authored boundary: custom
 * content travels with a character, while imported content remains injected.
 */
export function rulesOptionsForCharacter(
  character: CharacterInput,
  input?: CharacterRulesInput,
): RulesEngineOptions {
  const base = baseRulesOptions(input);
  const custom = character.customProgressions
    ? parseProgressionCatalog(character.customProgressions)
    : undefined;
  const imported = base.progressionCatalog;
  if (!hasEntries(imported) && !hasEntries(custom)) return base;
  const progressionCatalog = mergeProgressionCatalogs(
    imported ?? {},
    custom ?? {},
  );
  return { ...base, progressionCatalog };
}

/**
 * Validates persisted/user-authored state and returns canonical progression
 * ids. It never writes derived facts into the result.
 */
export function normalizeAuthoredCharacter(
  character: CharacterInput,
  input?: CharacterRulesInput,
): CharacterInput {
  const authored = parseCharacterInput(character);
  const rules = rulesOptionsForCharacter(authored, input);
  if (!authored.advancementSlots?.length) {
    new RulesEngine(authored, baseRulesOptions(input)).derive();
    return authored;
  }
  if (!rules.progressionCatalog) {
    throw new Error(
      "Advancement requires an injected progression catalog or customProgressions",
    );
  }
  const advancementSlots = normalizeAdvancementSlots(
    authored.advancementSlots,
    rules.progressionCatalog,
    rules.progressionAliases,
  );
  const canonical = parseCharacterInput({ ...authored, advancementSlots });
  new RulesEngine(canonical, baseRulesOptions(input)).derive();
  return canonical;
}

/** Useful for local development and deterministic persistence tests. */
export class InMemoryCharacterRepository implements CharacterRepository {
  private readonly records = new Map<string, CharacterInput>();
  private readonly rules: RulesEngineOptions;

  constructor(input?: CharacterRulesInput) {
    this.rules = baseRulesOptions(input);
  }

  async save(character: CharacterInput): Promise<void> {
    const authored = normalizeAuthoredCharacter(character, this.rules);
    this.records.set(authored.id, clone(authored));
  }

  async load(id: string): Promise<CharacterInput | null> {
    const value = this.records.get(id);
    return value ? normalizeAuthoredCharacter(clone(value), this.rules) : null;
  }

  async list(): Promise<Array<Pick<CharacterInput, "id" | "name">>> {
    return [...this.records.values()].map(({ id, name }) => ({ id, name }));
  }
}

function isStorageLike(value: unknown): value is StorageLike {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as StorageLike).getItem === "function" &&
    typeof (value as StorageLike).setItem === "function"
  );
}

function browserStorage(): StorageLike {
  const storage = (globalThis as { localStorage?: StorageLike }).localStorage;
  if (!storage)
    throw new Error(
      "LocalStorageCharacterRepository requires browser localStorage or an injected StorageLike",
    );
  return storage;
}

/**
 * Browser persistence with the same validation/canonicalization boundary as
 * the server repositories. The overloads allow either legacy catalog-first or
 * storage-first construction, and tests can inject a tiny in-memory store.
 */
export class LocalStorageCharacterRepository implements CharacterRepository {
  private readonly storage: StorageLike;
  private readonly rules: RulesEngineOptions;
  private readonly prefix: string;

  constructor();
  constructor(
    input?: CharacterRulesInput,
    storage?: StorageLike,
    prefix?: string,
  );
  constructor(
    storage?: StorageLike,
    input?: CharacterRulesInput,
    prefix?: string,
  );
  constructor(
    first?: CharacterRulesInput | StorageLike,
    second?: CharacterRulesInput | StorageLike,
    prefix = "threepointpf.character.",
  ) {
    const firstIsStorage = isStorageLike(first);
    const secondIsStorage = isStorageLike(second);
    this.storage = firstIsStorage
      ? first
      : secondIsStorage
        ? second
        : browserStorage();
    const input = (firstIsStorage ? second : first) as
      | CharacterRulesInput
      | undefined;
    this.rules = baseRulesOptions(input);
    this.prefix = prefix;
  }

  private key(id: string): string {
    return `${this.prefix}${id}`;
  }

  async save(character: CharacterInput): Promise<void> {
    const authored = normalizeAuthoredCharacter(character, this.rules);
    this.storage.setItem(this.key(authored.id), JSON.stringify(authored));
  }

  async load(id: string): Promise<CharacterInput | null> {
    const raw = this.storage.getItem(this.key(id));
    if (raw === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Stored character ${id} is not valid JSON`);
    }
    return normalizeAuthoredCharacter(parsed as CharacterInput, this.rules);
  }

  async list(): Promise<Array<Pick<CharacterInput, "id" | "name">>> {
    const found: Array<Pick<CharacterInput, "id" | "name">> = [];
    for (let index = 0; index < (this.storage.length ?? 0); index++) {
      const key = this.storage.key?.(index);
      if (!key?.startsWith(this.prefix)) continue;
      const id = key.slice(this.prefix.length);
      try {
        const character = await this.load(id);
        if (character) found.push({ id: character.id, name: character.name });
      } catch { /* A corrupt local record is reported when opened directly. */ }
    }
    return found.sort((left, right) => left.name.localeCompare(right.name));
  }
}

export interface HttpCharacterRepositoryOptions {
  fetch?: typeof fetch;
  apiBase?: string;
  rules?: CharacterRulesInput;
}

/** Same-origin character API adapter. Revisions stay outside CharacterInput. */
export class HttpCharacterRepository implements CharacterRepository {
  private readonly request: typeof fetch;
  private readonly rules: RulesEngineOptions;
  private readonly revisions = new Map<string, CharacterRevision>();
  private readonly apiBase: string;

  constructor(options: HttpCharacterRepositoryOptions = {}) {
    this.request = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.rules = baseRulesOptions(options.rules);
    this.apiBase = (options.apiBase ?? "/api").replace(/\/$/, "");
  }

  private url(path: string) { return `${this.apiBase}${path}`; }
  private async send(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await this.request(this.url(path), { ...init, credentials: "same-origin", headers: { Accept: "application/json", ...init.headers } });
    } catch {
      throw new CharacterApiError("network", "Could not reach the character service");
    }
  }
  private async fail(response: Response): Promise<never> {
    const status = response.status;
    const code: CharacterApiErrorCode = status === 401 ? "unauthenticated" : status === 403 ? "forbidden" : status === 404 ? "not-found" : status === 409 ? "conflict" : status === 400 || status === 422 ? "validation" : status >= 500 ? "server" : "protocol";
    let message = code === "unauthenticated" ? "Sign in to continue" : code === "forbidden" ? "You do not have access to this character" : code === "not-found" ? "Character not found" : code === "conflict" ? "This character changed elsewhere. Reload before saving again." : code === "validation" ? "The character data was rejected" : code === "server" ? "The character service failed" : "Unexpected character service response";
    try { apiErrorSchema.parse(await response.json()); } catch { /* use the local status-specific message */ }
    throw new CharacterApiError(code, message, status);
  }
  async load(id: string): Promise<CharacterInput | null> {
    const response = await this.send(`/characters/${encodeURIComponent(id)}`);
    if (response.status === 404) return null;
    if (!response.ok) return this.fail(response);
    try {
      const body = characterReadResponseSchema.parse(await response.json());
      const character = normalizeAuthoredCharacter(parseCharacterInput(body.character), this.rules);
      if (character.id !== id) throw new Error("Character identity mismatch");
      const revision = body.revision ?? response.headers.get("ETag") ?? undefined;
      if (revision !== undefined) this.revisions.set(id, revision);
      return character;
    } catch (cause) {
      if (cause instanceof CharacterApiError) throw cause;
      throw new CharacterApiError("protocol", "Character service returned invalid character data");
    }
  }
  async save(input: CharacterInput): Promise<void> {
    const character = normalizeAuthoredCharacter(input, this.rules);
    const revision = this.revisions.get(character.id);
    const response = await this.send(`/characters/${encodeURIComponent(character.id)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(characterWriteRequestSchema.parse({ character, ...(revision !== undefined ? { revision } : {}) })),
    });
    if (!response.ok) return this.fail(response);
    try {
      const body = characterWriteResponseSchema.parse(await response.json());
      const saved = normalizeAuthoredCharacter(parseCharacterInput(body.character), this.rules);
      if (saved.id !== character.id) throw new Error("Character identity mismatch");
      const nextRevision = body.revision ?? response.headers.get("ETag");
      if (nextRevision !== null && nextRevision !== undefined) this.revisions.set(character.id, nextRevision);
    } catch {
      throw new CharacterApiError("protocol", "Character service returned an invalid save response");
    }
  }
  async list(): Promise<CharacterSummary[]> {
    const response = await this.send("/characters");
    if (!response.ok) return this.fail(response);
    try { return z.array(characterSummarySchema).parse(await response.json()); }
    catch { throw new CharacterApiError("protocol", "Character service returned an invalid character list"); }
  }
}

const attackActionKinds = ["standardAttack", "fullAttack"] as const;
/** Fields that describe something other than who acts first. */
const initiativeInvalidFields = [
  "saveId",
  "skillId",
  "attackId",
  "attackIndex",
  "attackIds",
  "action",
  "maneuver",
  "touch",
  "criticalDamage",
  "target",
] as const;
const flagList = z
  .array(
    z
      .string()
      .min(1)
      .regex(/^[a-z][a-z0-9-]*$/, "Flags use lowercase slugs"),
  )
  .min(1);
const targetRequestSchema = z
  .object({
    characterId: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
  })
  .strict();
const defenseRequestSchema = rollDefenseSchema;

/** Who or what a roll is made against, and the defense it is compared with. */
export interface TargetRequest {
  characterId?: string;
  name?: string;
}

/**
 * A request for one authoritative roll plan. Every field describes *what the
 * actor is doing* and what the roll is made against; the server recomputes the
 * plan from authored state plus this context, and a client never supplies a
 * modifier or an outcome.
 */
export interface RollPlanRequest {
  characterId: string;
  kind: "save" | "attack" | "maneuver" | "skill" | "damage" | "initiative";
  saveId?: SaveId;
  attackId?: string;
  /** Zero-based member of an attack's authoritative sequence. */
  attackIndex?: number;
  /** Damage only: roll the damage twice, for a critical hit. */
  criticalDamage?: boolean;
  /** Full attack (default for attacks) or a single standard attack. */
  action?: (typeof attackActionKinds)[number];
  /** Every weapon selected by a multi-weapon full attack, in order. */
  attackIds?: string[];
  maneuver?: string;
  skillId?: string;
  flags?: string[];
  excludeFlags?: string[];
  touch?: boolean;
  /** Known target defense: AC for attacks, CMD for maneuvers, DC for saves and skills. */
  defense?: RollDefense;
  target?: TargetRequest;
}

/** The explicit action whose attacks a caller wants planned. */
export interface ActionPlanRequest {
  characterId: string;
  action: ActionKind;
  attackIds?: string[];
  maneuver?: string;
  flags?: string[];
  excludeFlags?: string[];
  touch?: boolean;
  defense?: RollDefense;
  target?: TargetRequest;
}

export interface ResolveRollRequest {
  plan: RollPlan;
  faces: number[];
}

export interface ResolveRollResponse extends ResolvedRoll {}

/**
 * Rejects a defense that cannot be what this roll is compared against. A save
 * is never made against an Armor Class, an AC is only meaningful for an attack,
 * and a damage or initiative roll is compared against nothing at all, so a
 * contradictory context fails loudly instead of being guessed at.
 */
function defenseKindsFor(kind: string): RollDefenseKind[] {
  if (kind === "attack" || kind === "standardAttack" || kind === "fullAttack")
    return ["ac"];
  if (kind === "maneuver") return ["cmd"];
  if (kind === "damage" || kind === "initiative") return [];
  return ["dc"];
}

function validateDefense(
  request: { kind: string; defense?: RollDefense; touch?: boolean },
  context: z.RefinementCtx,
): void {
  const defense = request.defense;
  if (!defense) return;
  const allowed = defenseKindsFor(request.kind);
  if (allowed.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["defense"],
      message: `A ${request.kind} roll is not compared against a defense`,
    });
    return;
  }
  if (!allowed.includes(defense.kind))
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["defense", "kind"],
      message: `A ${request.kind} roll is compared against ${allowed.join(" or ")}${allowed.length > 1 ? " targets" : ""}, not ${defense.kind}`,
    });
  if (
    defense.kind === "ac" &&
    defense.context !== undefined &&
    request.touch !== undefined &&
    (request.touch ? defense.context !== "touch" : defense.context === "touch")
  )
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["defense", "context"],
      message:
        "The supplied Armor Class must be the one this attack is made against (touch attacks use touch AC)",
    });
}

export const rollPlanRequestSchema = z
  .object({
    characterId: z.string().min(1),
    kind: z.enum(["save", "attack", "maneuver", "skill", "damage", "initiative"]),
    saveId: z.enum(saveIds).optional(),
    attackId: z.string().min(1).optional(),
    attackIndex: z.number().int().nonnegative().optional(),
    criticalDamage: z.boolean().optional(),
    action: z.enum(attackActionKinds).optional(),
    attackIds: z.array(z.string().min(1)).min(1).optional(),
    maneuver: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/, "Maneuvers use lowercase slugs")
      .optional(),
    skillId: z.string().min(1).optional(),
    flags: flagList.optional(),
    excludeFlags: flagList.optional(),
    touch: z.boolean().optional(),
    defense: defenseRequestSchema.optional(),
    target: targetRequestSchema.optional(),
  })
  .superRefine((request, context) => {
    const attackFields = () => ({
      attackId: request.attackId,
      attackIndex: request.attackIndex,
    });
    validateDefense(request, context);
    // Rolling damage twice is a damage-roll fact, so no other family may
    // declare it.
    if (request.kind !== "damage" && request.criticalDamage !== undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["criticalDamage"],
        message: "criticalDamage is only valid for a damage roll",
      });
    if (request.kind === "save") {
      if (!request.saveId)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["saveId"],
          message: "saveId is required for a save roll",
        });
      if (Object.values(attackFields()).some((value) => value !== undefined))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["attackId"],
          message: "attack fields are not valid for a save roll",
        });
      return;
    }
    if (request.kind === "skill") {
      if (!request.skillId)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["skillId"],
          message: "skillId is required for a skill roll",
        });
      return;
    }
    if (request.kind === "maneuver") {
      if (request.saveId !== undefined)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["saveId"],
          message: "saveId is not valid for a maneuver roll",
        });
      return;
    }
    if (request.kind === "initiative") {
      const invalid = initiativeInvalidFields.filter(
        (field) => request[field] !== undefined,
      );
      if (invalid.length > 0)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["kind"],
          message: `An initiative roll has no ${invalid.join(", ")}`,
        });
      return;
    }
    if (request.kind === "damage") {
      if (!request.attackId)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["attackId"],
          message: "attackId is required for a damage roll",
        });
      if (request.saveId !== undefined || request.skillId !== undefined)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["kind"],
          message: "A damage roll names a weapon, not a save or a skill",
        });
      if (request.maneuver !== undefined)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["maneuver"],
          message: "A damage roll follows a weapon attack, not a maneuver",
        });
      if (request.target !== undefined)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["target"],
          message: "A damage roll is compared against nothing, so it takes no target",
        });
      return;
    }
    if (!request.attackId)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attackId"],
        message: "attackId is required for an attack roll",
      });
    if (request.saveId !== undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["saveId"],
        message: "saveId is not valid for an attack roll",
      });
    if (request.action === "standardAttack" && (request.attackIds?.length ?? 0) > 1)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attackIds"],
        message: "A standard attack action selects exactly one attack",
      });
  });

export const actionPlanRequestSchema = z
  .object({
    characterId: z.string().min(1),
    action: z.enum(actionKinds),
    attackIds: z.array(z.string().min(1)).min(1).optional(),
    maneuver: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/, "Maneuvers use lowercase slugs")
      .optional(),
    flags: flagList.optional(),
    excludeFlags: flagList.optional(),
    touch: z.boolean().optional(),
    defense: defenseRequestSchema.optional(),
    target: targetRequestSchema.optional(),
  })
  .superRefine((request, context) => {
    validateDefense(
      {
        kind: request.action,
        ...(request.defense ? { defense: request.defense } : {}),
        ...(request.touch !== undefined ? { touch: request.touch } : {}),
      },
      context,
    );
    if (request.action === "maneuver" && (request.attackIds?.length ?? 0) > 0)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attackIds"],
        message: "A maneuver action selects no weapons",
      });
    if (request.action !== "maneuver" && request.maneuver !== undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maneuver"],
        message: "A maneuver identity is only valid for a maneuver action",
      });
    if (request.action === "standardAttack" && (request.attackIds?.length ?? 0) > 1)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attackIds"],
        message: "A standard attack action selects exactly one attack",
      });
  });

/**
 * A submitted plan is validated for shape only. Its modifier and provenance are
 * never trusted: resolution rebuilds the plan from authored state and the
 * context it declares, then interprets the raw faces against that rebuild.
 */
const rollPlanSchema = z.object({
  id: z.string().min(1),
  characterId: z.string().min(1),
  label: z.string().min(1),
  dice: z
    .array(
      z.object({
        sides: z.number().int().positive(),
        count: z.number().int().positive(),
      }),
    )
    .min(1),
  modifier: z.number(),
  context: rollContextSchema,
  outcomePolicy: rollOutcomePolicySchema,
  // Checked for shape only, like the rest of a submitted plan: resolution uses
  // the server's own rebuild, including its declared primary check die.
  primaryCheckDie: z
    .object({
      group: z.number().int().nonnegative(),
      index: z.number().int().nonnegative().optional(),
      sides: z.number().int().min(2),
    })
    .strict()
    .optional(),
  criticalRange: criticalRangeSchema.optional(),
  provenance: z.unknown().optional(),
}).superRefine((plan, context) => {
  // A submitted check die must point at a real group whose dice it describes:
  // a plan claiming a d20 while rolling 2d6 would otherwise invent natural-face
  // semantics out of nothing. Resolution rebuilds the plan anyway, so this only
  // rejects malformed input at the boundary.
  const die = plan.primaryCheckDie;
  if (!die) return;
  const group = plan.dice[die.group];
  if (!group) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["primaryCheckDie", "group"],
      message: "The primary check die must reference one of the plan's dice groups",
    });
    return;
  }
  if (group.sides !== die.sides)
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["primaryCheckDie", "sides"],
      message: `The primary check die declares d${die.sides} but its group rolls d${group.sides}`,
    });
  if ((die.index ?? 0) >= group.count)
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["primaryCheckDie", "index"],
      message: "The primary check die must reference a die inside its group",
    });
});
export const resolveRollRequestSchema = z.object({
  plan: rollPlanSchema,
  faces: z.array(z.number().int()).min(1),
});

export const rollPlanEndpoint = "/roll-plan";
export const resolveRollEndpoint = "/resolve-roll";

function mergedRollRules(
  input?: CharacterRulesInput,
  extra?: RulesEngineOptions,
): RulesEngineOptions {
  const initial = baseRulesOptions(input);
  if (!extra) return initial;
  return {
    ...initial,
    ...extra,
    // A legacy third-argument catalog remains valid when the optional fourth
    // argument supplies the other modern catalogs.
    progressionCatalog: extra.progressionCatalog ?? initial.progressionCatalog,
    progressionAliases: extra.progressionAliases ?? initial.progressionAliases,
    skillCatalog: extra.skillCatalog ?? initial.skillCatalog,
  };
}

/**
 * Shared authority path for browser and TTS. The third argument accepts the
 * original ProgressionCatalog or a full RulesEngineOptions; a fourth options
 * argument augments the legacy catalog form.
 */
function rollRequestOptions(request: RollPlanRequest): RollRequestOptions {
  return {
    ...(request.flags ? { flags: request.flags } : {}),
    ...(request.excludeFlags ? { excludeFlags: request.excludeFlags } : {}),
    ...(request.defense ? { defense: request.defense } : {}),
    ...(request.target ? { target: request.target } : {}),
  };
}

export function createCharacterRollPlan(
  character: CharacterInput,
  request: RollPlanRequest,
  input?: CharacterRulesInput,
  extra?: RulesEngineOptions,
): RollPlan {
  request = rollPlanRequestSchema.parse(request);
  if (request.characterId !== character.id)
    throw new Error("Roll-plan character id does not match loaded character");
  const base = mergedRollRules(input, extra);
  const authored = normalizeAuthoredCharacter(character, base);
  const engine = new RulesEngine(authored, base);
  const options = rollRequestOptions(request);
  if (request.kind === "save" && request.saveId)
    return engine.createSaveRollPlan(request.saveId, options);
  if (request.kind === "skill" && request.skillId)
    return engine.createSkillRollPlan(request.skillId, options);
  if (request.kind === "maneuver")
    return engine.createManeuverRollPlan(request.maneuver, options);
  if (request.kind === "initiative")
    return engine.createInitiativeRollPlan({
      ...(request.flags ? { flags: request.flags } : {}),
      ...(request.excludeFlags ? { excludeFlags: request.excludeFlags } : {}),
    });
  if (request.kind === "damage" && request.attackId)
    return engine.createDamageRollPlan(request.attackId, {
      ...options,
      ...(request.action ? { action: request.action } : {}),
      ...(request.attackIds ? { attackIds: request.attackIds } : {}),
      ...(request.attackIndex !== undefined
        ? { attackIndex: request.attackIndex }
        : {}),
      ...(request.touch !== undefined ? { touch: request.touch } : {}),
      ...(request.criticalDamage !== undefined
        ? { criticalDamage: request.criticalDamage }
        : {}),
    });
  if (request.kind === "attack" && request.attackId)
    return engine.createAttackRollPlan(request.attackId, request.attackIndex ?? 0, {
      ...options,
      ...(request.action ? { action: request.action } : {}),
      ...(request.attackIds ? { attackIds: request.attackIds } : {}),
      ...(request.touch !== undefined ? { touch: request.touch } : {}),
      ...(request.maneuver ? { maneuver: request.maneuver } : {}),
    });
  throw new Error("A valid saveId, skillId or attackId is required");
}

/**
 * The explicit action plan shared by the browser and Tabletop Simulator. The
 * server recomputes this from authored state plus the requested context; the
 * returned plan is what the UI and the Lua client both display.
 */
export function createCharacterActionPlan(
  character: CharacterInput,
  request: ActionPlanRequest,
  input?: CharacterRulesInput,
  extra?: RulesEngineOptions,
): ActionPlan {
  request = actionPlanRequestSchema.parse(request);
  if (request.characterId !== character.id)
    throw new Error("Action-plan character id does not match loaded character");
  const base = mergedRollRules(input, extra);
  const authored = normalizeAuthoredCharacter(character, base);
  const engine = new RulesEngine(authored, base);
  return engine.createActionPlan({
    action: request.action,
    ...(request.attackIds ? { attackIds: request.attackIds } : {}),
    ...(request.maneuver ? { maneuver: request.maneuver } : {}),
    ...(request.flags ? { flags: request.flags } : {}),
    ...(request.excludeFlags ? { excludeFlags: request.excludeFlags } : {}),
    ...(request.touch !== undefined ? { touch: request.touch } : {}),
    ...(request.defense ? { defense: request.defense } : {}),
    ...(request.target ? { target: request.target } : {}),
  });
}
