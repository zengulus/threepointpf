export type SheetMode = "browser" | "hosted";
export interface SheetEnvironment { mode?: SheetMode }

/** Explicit configuration only: unrelated environment values never enable hosted APIs. */
export function sheetModeFor(environment: SheetEnvironment): SheetMode {
  return environment.mode ?? "browser";
}
export function sheetModeFromEnv(env: Record<string, string | undefined>): SheetMode {
  if (env.VITE_APP_MODE === "hosted") return "hosted";
  if (env.VITE_APP_MODE && env.VITE_APP_MODE !== "browser") throw new Error("VITE_APP_MODE must be browser or hosted");
  return "browser";
}
export function activeSheetEnvironment(): SheetEnvironment {
  return { mode: sheetModeFromEnv(import.meta.env as Record<string, string | undefined>) };
}
