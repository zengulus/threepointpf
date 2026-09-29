import type { RollPlan } from "@threepointpf/dice";
import { rulesCatalogs } from "@threepointpf/rules-data";
import type { CharacterInput } from "@threepointpf/rules-schema";
import {
  createCharacterRollPlan,
  rollPlanRequestSchema,
  type HostedRollResponse,
  type RollPlanRequest,
} from "@threepointpf/shared";

/** Convert a displayed action into the server's narrow, authoritative intent. */
export function hostedActionForPlan(character: CharacterInput, plan: RollPlan): RollPlanRequest {
  const context = plan.context;
  if (plan.characterId !== character.id || context.actorCharacterId !== character.id || context.spellId)
    throw new Error("This action is not yet supported for recorded hosted rolls.");
  if (context.kind === "skill" && plan.id.startsWith(`spellcasting:${character.id}:`) && plan.id.endsWith(":concentration")) {
    const source = character.spellcastingSources?.find((item) => plan.id === `spellcasting:${character.id}:${item.id}:concentration`);
    const ability = character.abilities?.find((item) => item.spellLike && item.spellId && plan.id === `spellcasting:${character.id}:spell-like.${item.id}:concentration`);
    const action = rollPlanRequestSchema.parse({
      characterId: character.id, kind: "concentration",
      ...(source ? { sourceId: source.id } : ability ? { abilityId: ability.id } : {}),
      ...(context.target?.defense ? { defense: context.target.defense } : {}),
    });
    const canonical = createCharacterRollPlan(character, action, rulesCatalogs);
    if (JSON.stringify(canonical) !== JSON.stringify(plan))
      throw new Error("This concentration check needs a server roll definition before it can be used in hosted play.");
    return action;
  }
  const action: RollPlanRequest = {
    characterId: character.id,
    kind: context.kind as RollPlanRequest["kind"],
    ...(context.flags?.length ? { flags: context.flags } : {}),
    ...(context.excludeFlags?.length ? { excludeFlags: context.excludeFlags } : {}),
    ...(context.target?.defense ? { defense: context.target.defense } : {}),
    ...(context.target?.characterId || context.target?.name ? {
      target: {
        ...(context.target.characterId ? { characterId: context.target.characterId } : {}),
        ...(context.target.name ? { name: context.target.name } : {}),
      },
    } : {}),
  };
  switch (context.kind) {
    case "save":
      action.saveId = context.saveId;
      action.cover = context.cover;
      break;
    case "skill":
      action.skillId = context.skillId;
      break;
    case "maneuver":
      action.maneuver = context.maneuver;
      break;
    case "initiative":
      break;
    case "attack":
    case "damage":
      action.attackId = context.attackId;
      action.attackIndex = context.action.sequenceIndex;
      action.attackIds = context.action.attackIds;
      action.offHandAttackCount = context.action.offHandAttackCount;
      action.touch = context.touch;
      if (context.action.kind === "standardAttack" || context.action.kind === "fullAttack")
        action.action = context.action.kind;
      if (context.kind === "attack") action.maneuver = context.maneuver;
      if (context.kind === "damage") {
        action.criticalDamage = context.criticalDamage;
        delete action.target;
        delete action.defense;
      }
      break;
    default:
      throw new Error("This action is not yet supported for recorded hosted rolls.");
  }
  const parsed = rollPlanRequestSchema.safeParse(action);
  if (!parsed.success)
    throw new Error("This action is not yet supported for recorded hosted rolls.");
  // Temporary client-only activations and synthetic bonus dice must not be
  // presented as if the server had rolled the same action.
  const canonical = createCharacterRollPlan(character, parsed.data, rulesCatalogs);
  if (JSON.stringify(canonical) !== JSON.stringify(plan))
    throw new Error("This action needs a server roll definition before it can be used in hosted play.");
  return parsed.data;
}

export async function recordHostedRoll(
  character: CharacterInput,
  plan: RollPlan,
  revision: number | undefined,
  request: typeof fetch = fetch,
): Promise<HostedRollResponse> {
  if (!revision || !Number.isInteger(revision))
    throw new Error("The saved character revision is unavailable. Reload before rolling.");
  const body = JSON.stringify({
    version: 1,
    clientRequestId: crypto.randomUUID(),
    characterId: character.id,
    expectedRevision: revision,
    action: hostedActionForPlan(character, plan),
  });
  const send = () => request("/api/rolls", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body,
  });
  // A lost response may follow a successful commit. The identical request ID
  // recovers that event; a new ID would create a second roll.
  let response: Response;
  try { response = await send(); }
  catch { response = await send(); }
  const payload = await response.json().catch(() => ({})) as HostedRollResponse & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? "The roll could not be recorded.");
  if (payload.version !== 1 || payload.characterId !== character.id || !payload.rollId || !payload.result || !payload.plan)
    throw new Error("The roll service returned an invalid result. Reload before rolling again.");
  return payload;
}

export function hostedDeliveryNotice(delivery: HostedRollResponse["delivery"]): string {
  switch (delivery.state) {
    case "sent": return "Sent to Discord.";
    case "pending": case "sending": return "Recorded; Discord delivery is pending.";
    case "retryable_failed": return "Recorded; Discord delivery will retry while the site is open.";
    case "delivery_unknown": return "Recorded; Discord delivery is unconfirmed. Check the channel before retrying.";
    case "permanent_failed": return "Recorded; Discord delivery needs DM attention.";
    case "cancelled": return "Recorded; Discord delivery was cancelled.";
    default: return "Recorded; this campaign has no Discord channel connected.";
  }
}
