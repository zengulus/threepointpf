/**
 * How this deployment backs the sheet.
 *
 * `demo` is the default and needs no server at all: the sample characters, the
 * rules engine and browser storage are the whole application. `cloud` is opt-in
 * and requires both public Supabase credentials. Demo mode is therefore also
 * what the published GitHub Pages build runs, which is why the choice is made
 * from configuration rather than from a request or a login.
 */
export type SheetMode = "demo" | "cloud";

export interface SheetEnvironment {
  supabaseUrl?: string;
  /** The public anon key; a service-role key is never used by the browser. */
  supabaseKey?: string;
  /** Explicit demo flag, set by the demo deployment build. */
  demo?: boolean;
}

/**
 * Cloud only when credentials are present *and* nobody asked for a demo. An
 * explicit demo flag wins, so the public demo cannot accidentally talk to a
 * database that happens to be configured in the build environment.
 */
export function sheetModeFor(environment: SheetEnvironment): SheetMode {
  if (environment.demo) return "demo";
  return environment.supabaseUrl && environment.supabaseKey ? "cloud" : "demo";
}

function flag(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

export function sheetModeFromEnv(
  env: Record<string, string | undefined>,
): SheetMode {
  return sheetModeFor({
    supabaseUrl: env.VITE_SUPABASE_URL || undefined,
    supabaseKey: env.VITE_SUPABASE_ANON_KEY || undefined,
    demo: flag(env.VITE_DEMO_MODE),
  });
}

/** The build-time environment this bundle was compiled with. */
export function activeSheetEnvironment(): SheetEnvironment {
  return {
    supabaseUrl:
      (import.meta.env.VITE_SUPABASE_URL as string | undefined) || undefined,
    supabaseKey:
      (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
      undefined,
    demo: flag(import.meta.env.VITE_DEMO_MODE as string | undefined),
  };
}
