# Comment style: try four other things first

`CLAUDE.md` → "Code comments" states the rule in one paragraph. This doc is
the rationale and worked examples behind it, for whoever's deciding whether a
comment they're about to write actually earns its place.

A comment is the last resort. Work down this ladder; write prose only when
all four rungs fail.

1. **Extract it.** Logic explained by a comment belongs in a domain-named
   function or service method. Arithmetic spelled out in a comment belongs in
   a named constant. A coercion explained twice belongs in one named helper.
2. **Name it.** A comment labelling a block (`// Phase 2: cache lookup`)
   means the block wants to be a function. Sentinels get names too
   (`NO_NEXT_PAGE`, not a bare `0` with a comment explaining what it means).
3. **Pin it with a test pair.** A comment stating a business rule is a rule
   nothing enforces. Write one test inside the boundary and one outside,
   named after the rule (`"accepts a fifth message"` / `"rejects a sixth"`),
   not `// max 5 per inbox`. The pair is the point: it fails the day someone
   moves the limit.
4. **Pin cross-boundary rules with an E2E spec.** A rule that only breaks
   when several services/layers are wired together (a cookie format, an auth
   redirect, a round-trip through the DB and back out an API) belongs in an
   end-to-end spec, not a paragraph. This repo doesn't have an E2E suite yet
   — see `docs/testing-strategy.md` item 1 — so today this rung mostly means:
   don't paper over the gap with a comment; note it and let the roadmap item
   close it for real.
5. **Only then, prose.** Hidden constraints, upstream library bugs, incident
   history, protocol requirements. State the constraint, not its biography.

When rung 3 pins a comment, name the test after the rule and, where it's not
already obvious from proximity, say in the surrounding prose which test
covers it (a relative path is fine — this repo has no automated doc-link
checker, so keep it simple and let a reviewer verify by running the test).

## Worked examples from this repo

**Rung 2 — name the sentinel.** `web/src/pages/index.astro` and
`web/src/pages/feed-fragment.astro` both computed the infinite-scroll "no
more pages" value as a bare `0`, each with its own copy of the comment
explaining it (`// 0 = last page reached; the observer treats that as
"done".`). Two comments maintaining one fact is exactly the smell rung 2
targets. Fixed by extracting `NO_NEXT_PAGE` and `nextPageAfter()` into
`web/src/lib/pagination.ts` (pinned by `pagination.test.ts`) — both pages
and the client-side observer script now import the same name and the same
function, and neither comment is needed anymore.

**Rung 3 — pin the rule, not just the value.** `web/src/lib/cardVariants.ts`
states the rule right above `variantFor`: pass a different `seed` per visual
axis or two same-length variant lists stay locked together. That comment
stays — it's a real, non-obvious constraint on how to *call* the function —
but it isn't the only thing enforcing it. `cardVariants.test.ts` has
`'keeps two same-length lists independent when given different seeds'`, a
test named after the rule that fails if the seed mixing ever regresses to
where two seeds produce the same sequence. That's the model: the comment
explains the constraint to a reader, the test is what actually holds the
line.

**Rung 5 — prose that earns it.** `web/src/lib/ogImage.ts`'s `OG_LAYOUT_VERSION`
comment ("Rendered PNGs are stored under a content-hash key and served back
with a one-year immutable cache, so without this a redesign would only ever
reach headlines created after it shipped") is a genuinely non-obvious
consequence of two other decisions (content-hash caching + a one-year
immutable header) meeting at this one line. No amount of naming or
extraction removes the need to say that explicitly — this is what rung 5 is
for.

## What this doesn't mean

Don't strip comments that already carry real information just to hit a
quota. Most of the comments in this codebase already are rung-5 material —
incident history (`web/src/pages/index.astro`'s CSS multi-column reflow
note, issue #141), protocol requirements (`handles/main.go`'s
`.well-known/atproto-did` note), or library quirks that would otherwise cost
someone a debugging session (`classify/src/classify.js`'s
`temperature`-rejection retry, `web/src/lib/ogImage.ts`'s webp/Satori crash
note). Keep those. The ladder is about catching the other kind: a comment
that's standing in for a name, a function, or a test that was never written.
