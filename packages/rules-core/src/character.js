// Deno follows literal .js specifiers when the Edge Functions import the
// TypeScript source tree. Node and the browser receive the compiled .js emitted
// from character.ts; this source-only bridge keeps both consumers aligned.
export * from "./character.ts";
