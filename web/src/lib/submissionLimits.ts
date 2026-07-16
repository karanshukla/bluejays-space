// Shared between the public submission form (submit.astro, for maxlength
// attributes) and its POST handler (api/submit.ts, for server-side
// enforcement) — one source of truth for both so the two never drift apart.
export const HEADLINE_MAX = 280;
export const SUBMITTER_NAME_MAX = 40;
export const CONTEXT_NOTE_MAX = 300;
