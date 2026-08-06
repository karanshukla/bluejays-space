// Picks a per-headline "scrapbook" variant (tape strip, photo placement, crop
// offset) deterministically from the headline's own id — not its position in
// the feed — so a card's look stays put as other headlines publish or unpublish
// around it, and matches between the live card and its OG preview.
//
// Why a hash rather than `id % variants.length`: plain modulo marches through
// the list in lockstep with the id, so the cards most likely to sit side by
// side (published back to back) always land on adjacent variants, and any two
// variant lists of the same length stay permanently in sync — every card that
// got the third tape also got the third crop. Mixing the bits first breaks
// both patterns while staying pure and stable.
function mix(value: number): number {
  let x = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  x = (x ^ (x >>> 13)) >>> 0;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

// `seed` separates two variant lists that would otherwise be driven by the same
// id — pass a different seed per visual axis so tilt and crop vary independently.
export function variantFor<T>(id: number, variants: readonly T[], seed = 0): T {
  return variants[mix(Math.trunc(Math.abs(id)) + seed * 0x517c_c1b7) % variants.length];
}
