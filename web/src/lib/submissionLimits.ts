// Shared between the public submission form (submit.astro, for maxlength
// attributes) and its POST handler (api/submit.ts, for server-side
// enforcement). One source of truth for both so the two never drift apart.
export const HEADLINE_MAX = 280;
export const SUBMITTER_NAME_MAX = 40;
export const STAT_BLOCK_MAX = 160;
export const SOURCE_NOTE_MAX = 300;
