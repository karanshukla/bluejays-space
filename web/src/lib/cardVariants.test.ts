import { describe, expect, it } from 'vitest';
import { PHOTO_MOUNT_TILTS, photoMountFor } from './cardVariants';

describe('photoMountFor', () => {
  it('is stable for a given id', () => {
    expect(photoMountFor(42)).toBe(photoMountFor(42));
  });

  it('uses every mount across a run of ids', () => {
    const seen = new Set(Array.from({ length: 50 }, (_, i) => photoMountFor(i + 1)));
    expect(seen.size).toBe(Object.keys(PHOTO_MOUNT_TILTS).length);
  });

  it('keeps every tilt inside the range the card CSS is capped at', () => {
    // Above 2deg a mount pushes ink outside its <li>, which the feed's CSS
    // multi-column layout mis-fragments — see .mount-a..g in global.css.
    for (const tilt of Object.values(PHOTO_MOUNT_TILTS)) {
      expect(Math.abs(tilt)).toBeLessThanOrEqual(2);
    }
  });
});
