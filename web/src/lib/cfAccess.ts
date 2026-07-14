// Cloudflare Access JWT verification.
//
// Defense-in-depth against the Railway fallback domain bypassing Cloudflare's
// proxy (and thus Access path-scoping). See docs/admin-security.md: the app
// itself enforces the gate, so a request that didn't pass an Access challenge
// (no valid Cf-Access-Jwt-Assertion header) is rejected at the origin.
//
// Verification follows Cloudflare's documented flow: fetch the team's JWKS
// public keys, then validate the JWT signature, issuer, audience, and expiry
// via jose. https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/

import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JWK,
  type JWTVerifyOptions,
} from 'jose';

export interface VerifiedUser {
  email: string;
  sub: string;
}

// Any object with the JWKS shape ({ keys: [...] }). Tests pass a local keyset
// built from a generated keypair; production fetches Cloudflare's remotely.
export interface JWKS {
  keys: JWK[];
}

/**
 * Whether the middleware should enforce Cloudflare Access.
 *
 * Enforcement keys off the Cloudflare config being present (CF_ACCESS_TEAM and
 * CF_ACCESS_AUD both set), NOT NODE_ENV: the local dev flow runs `astro build`
 * before `astro preview`, and the build sets NODE_ENV=production, so NODE_ENV is
 * an unreliable dev signal. When the CF env vars are unset (local dev) there is
 * no team JWKS to verify against anyway, so enforcement can't work and would
 * just lock out the developer.
 */
export function isAuthEnforced(): boolean {
  return Boolean(process.env.CF_ACCESS_TEAM && process.env.CF_ACCESS_AUD);
}

function teamDomain(): string {
  const team = process.env.CF_ACCESS_TEAM;
  if (!team) {
    throw new Error('CF_ACCESS_TEAM not set');
  }
  return `https://${team}.cloudflareaccess.com`;
}

/**
 * Verify a Cloudflare Access JWT against a local JWKS, validating issuer,
 * audience, and expiry. Pure with respect to the key source — tests build a
 * JWKS from a generated keypair so no network is needed.
 * Throws on any validation failure (callers return 403).
 */
export async function verifyJwtWithLocalKeys(
  token: string,
  jwks: JWKS,
  options: Pick<JWTVerifyOptions, 'issuer' | 'audience'>
): Promise<VerifiedUser> {
  const keySet = createLocalJWKSet(jwks);
  const { payload } = await jwtVerify(token, keySet, options);
  return {
    email: typeof payload.email === 'string' ? payload.email : '',
    sub: typeof payload.sub === 'string' ? payload.sub : '',
  };
}

/**
 * Verify a Cloudflare Access JWT and return the authenticated user.
 * Uses the configured team's remote JWKS (CF_ACCESS_TEAM) and app AUD (CF_ACCESS_AUD).
 * Throws if the token is missing, malformed, expired, or fails signature /
 * issuer / audience validation. Callers should return 403 on any throw.
 */
export async function verifyCfAccessJwt(token: string): Promise<VerifiedUser> {
  const audience = process.env.CF_ACCESS_AUD;
  if (!audience) {
    throw new Error('CF_ACCESS_AUD not set');
  }
  const issuer = teamDomain();
  const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  const { payload } = await jwtVerify(token, jwks, { issuer, audience });
  return {
    email: typeof payload.email === 'string' ? payload.email : '',
    sub: typeof payload.sub === 'string' ? payload.sub : '',
  };
}
