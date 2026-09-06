export const PHOTO_MOUNT_TILTS = {
  'mount-a': -1.7,
  'mount-b': 1.3,
  'mount-c': -0.7,
  'mount-d': 2,
  'mount-e': -1.1,
  'mount-f': 0.6,
  'mount-g': -2,
} as const;

export type PhotoMount = keyof typeof PHOTO_MOUNT_TILTS;

const PHOTO_MOUNTS = Object.keys(PHOTO_MOUNT_TILTS) as PhotoMount[];

export function photoMountFor(id: number): PhotoMount {
  return PHOTO_MOUNTS[id % PHOTO_MOUNTS.length];
}
