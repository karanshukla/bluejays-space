import type { VerifiedUser } from './lib/cfAccess.js';

declare global {
  namespace App {
    interface Locals {
      /** The Cloudflare Access-verified user, set by middleware on protected routes. */
      cfUser?: VerifiedUser;
    }
  }
}
