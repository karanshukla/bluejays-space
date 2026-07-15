import type { VerifiedUser } from './lib/cfAccess.js';

declare global {
  namespace App {
    interface Locals {
      cfUser?: VerifiedUser;
    }
  }
}
