// Deno follows literal .js specifiers when the Edge Functions import the
// TypeScript source tree. Node receives the compiled advancement.js emitted
// from advancement.ts; this source-only bridge keeps both consumers aligned.
export * from "./advancement.ts";
