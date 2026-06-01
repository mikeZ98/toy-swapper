// Test stub for Astro's build-time virtual module `astro:env/server`.
// Vitest aliases `astro:env/server` here (see vitest.config.ts) so units that
// read server env resolve without the Astro build pipeline. Add exports as
// more env-reading modules come under test.
export const LOG_LEVEL = "info";
export const OPENAI_API_KEY: string | undefined = undefined;
export const OPENAI_API_BASE: string | undefined = undefined;
export const FAIRNESS_THRESHOLD_PCT = 20;
export const SUPABASE_URL: string | undefined = undefined;
export const SUPABASE_KEY: string | undefined = undefined;
