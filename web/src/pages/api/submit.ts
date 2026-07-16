import type { APIRoute } from 'astro';
import { createSubmittedHeadline } from '../../lib/db';
import { asNullableText } from '../../lib/formHelpers';
import { clientIp } from '../../lib/clientIp';
import { RateLimiter } from '../../lib/rateLimit';
import { HEADLINE_MAX, SUBMITTER_NAME_MAX, CONTEXT_NOTE_MAX } from '../../lib/submissionLimits';

export const prerender = false;

// Public, unauthenticated write — deliberately outside /admin/api, since it
// has its own threat model (spam/abuse from anyone on the internet) rather
// than /admin's CSRF-adjacent same-site check, which assumes a logged-in
// operator. 5/hour/IP mirrors the handles service's GitHub-PR submission
// limiter (handles/main.go: newRateLimiter(5, time.Hour)) — same policy,
// reused for consistency rather than picking a new number.
const limiter = new RateLimiter(5, 60 * 60 * 1000);

export const POST: APIRoute = async ({ request, redirect }) => {
  if (!limiter.allow(clientIp(request))) {
    return redirect('/submit?error=rate_limited', 303);
  }

  const form = await request.formData();
  const headline = asNullableText(form.get('headline'));
  const submitterName = asNullableText(form.get('submitter_name'));
  const contextNote = asNullableText(form.get('context_note'));

  if (!headline) return redirect('/submit?error=missing', 303);
  if (
    headline.length > HEADLINE_MAX ||
    (submitterName?.length ?? 0) > SUBMITTER_NAME_MAX ||
    (contextNote?.length ?? 0) > CONTEXT_NOTE_MAX
  ) {
    return redirect('/submit?error=too_long', 303);
  }

  // No register, no photo: lands as a plain draft with source='submission'.
  // The classifier and admin review/publish flow apply to it exactly like an
  // admin-authored draft — this route's only job is getting it in the door.
  await createSubmittedHeadline({
    headline,
    submitter_name: submitterName,
    context_note: contextNote,
  });

  return redirect('/submit?sent=1', 303);
};
