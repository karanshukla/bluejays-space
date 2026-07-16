import type { APIRoute } from 'astro';
import { createSubmittedHeadline } from '../../lib/db';
import { asNullableText } from '../../lib/formHelpers';
import { clientIp } from '../../lib/clientIp';
import { RateLimiter } from '../../lib/rateLimit';
import {
  HEADLINE_MAX,
  SUBMITTER_NAME_MAX,
  STAT_BLOCK_MAX,
  SOURCE_NOTE_MAX,
} from '../../lib/submissionLimits';

export const prerender = false;

// Public, unauthenticated write, deliberately outside /admin/api since it has
// its own threat model (spam/abuse from anyone on the internet) rather than
// /admin's CSRF-adjacent same-site check, which assumes a logged-in operator.
// 5/hour/IP mirrors the handles service's GitHub-PR submission limiter
// (handles/main.go: newRateLimiter(5, time.Hour)), same policy, reused for
// consistency rather than picking a new number.
const limiter = new RateLimiter(5, 60 * 60 * 1000);

export const POST: APIRoute = async ({ request, redirect }) => {
  if (!limiter.allow(clientIp(request))) {
    return redirect('/submit?error=rate_limited', 303);
  }

  const form = await request.formData();
  const headline = asNullableText(form.get('headline'));
  const submitterName = asNullableText(form.get('submitter_name'));
  const statBlock = asNullableText(form.get('stat_block'));
  const sourceNote = asNullableText(form.get('source_note'));
  const photoRef = asNullableText(form.get('photo_ref'));

  if (!headline) return redirect('/submit?error=missing', 303);
  if (
    headline.length > HEADLINE_MAX ||
    (submitterName?.length ?? 0) > SUBMITTER_NAME_MAX ||
    (statBlock?.length ?? 0) > STAT_BLOCK_MAX ||
    (sourceNote?.length ?? 0) > SOURCE_NOTE_MAX
  ) {
    return redirect('/submit?error=too_long', 303);
  }

  // photo_ref, if present, already points at a stored MinIO object: the form
  // posts it there via PhotoInput.svelte -> /api/submit-photo, which runs the
  // same validated import pipeline as the admin picker. Nothing left to do
  // here but attach it. Lands as a plain draft with source='submission'; the
  // classifier and admin review/publish flow apply exactly like an
  // admin-authored draft, this route's only job is getting it in the door.
  await createSubmittedHeadline({
    headline,
    stat_block: statBlock,
    photo_ref: photoRef,
    source_note: sourceNote,
    submitter_name: submitterName,
  });

  return redirect('/submit?sent=1', 303);
};
