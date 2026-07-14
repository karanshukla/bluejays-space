import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

import { verifyJwtWithLocalKeys, isAuthEnforced, type JWKS } from './cfAccess.js';

const ISSUER = 'https://bluejays.cloudflareaccess.com';
const AUDIENCE = 'test-aud-tag-1234';

let keypair: { publicKey: CryptoKey; privateKey: CryptoKey };
let jwks: JWKS;

beforeAll(async () => {
  keypair = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(keypair.publicKey);
  // createLocalJWKSet matches by alg/use, so tag the key explicitly.
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';
  publicJwk.kid = 'test-key-1';
  jwks = { keys: [publicJwk] };
});

// Helper: mint a signed JWT mimicking Cloudflare Access's claims.
async function mintToken(
  overrides: {
    email?: string;
    sub?: string;
    aud?: string;
    iss?: string;
    expired?: boolean;
  } = {}
): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const exp = overrides.expired ? issuedAt - 3600 : issuedAt + 3600;
  return new SignJWT({
    email: overrides.email ?? 'reviewer@example.com',
    sub: overrides.sub ?? 'did:plc:abc123',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
    .setIssuer(overrides.iss ?? ISSUER)
    .setAudience(overrides.aud ?? AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(exp)
    .sign(keypair.privateKey);
}

describe('verifyJwtWithLocalKeys', () => {
  it('returns the email and sub for a valid token', async () => {
    const token = await mintToken({ email: 'karan@example.com', sub: 'did:plc:xyz' });
    const user = await verifyJwtWithLocalKeys(token, jwks, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    expect(user.email).toBe('karan@example.com');
    expect(user.sub).toBe('did:plc:xyz');
  });

  it('rejects an expired token', async () => {
    const token = await mintToken({ expired: true });
    await expect(
      verifyJwtWithLocalKeys(token, jwks, { issuer: ISSUER, audience: AUDIENCE })
    ).rejects.toThrow();
  });

  it('rejects a token with the wrong audience', async () => {
    const token = await mintToken({ aud: 'some-other-app' });
    await expect(
      verifyJwtWithLocalKeys(token, jwks, { issuer: ISSUER, audience: AUDIENCE })
    ).rejects.toThrow();
  });

  it('rejects a token with the wrong issuer', async () => {
    const token = await mintToken({ iss: 'https://evil.cloudflareaccess.com' });
    await expect(
      verifyJwtWithLocalKeys(token, jwks, { issuer: ISSUER, audience: AUDIENCE })
    ).rejects.toThrow();
  });

  it('rejects a tampered signature', async () => {
    const token = await mintToken();
    const tampered = token.slice(0, -8) + 'AAAAAAAA';
    await expect(
      verifyJwtWithLocalKeys(tampered, jwks, { issuer: ISSUER, audience: AUDIENCE })
    ).rejects.toThrow();
  });

  it('defaults email/sub to empty string when claims are absent', async () => {
    const issuedAt = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 3600)
      .sign(keypair.privateKey);
    const user = await verifyJwtWithLocalKeys(token, jwks, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    expect(user.email).toBe('');
    expect(user.sub).toBe('');
  });
});

describe('isAuthEnforced', () => {
  // Save/restore both env vars since enforcement keys off them, not NODE_ENV.
  const env = () => ({
    node: process.env.NODE_ENV,
    team: process.env.CF_ACCESS_TEAM,
    aud: process.env.CF_ACCESS_AUD,
  });
  let original: ReturnType<typeof env>;

  beforeEach(() => {
    original = env();
    delete process.env.CF_ACCESS_TEAM;
    delete process.env.CF_ACCESS_AUD;
  });
  afterEach(() => {
    process.env.NODE_ENV = original.node;
    process.env.CF_ACCESS_TEAM = original.team;
    process.env.CF_ACCESS_AUD = original.aud;
  });

  it('returns false with no CF config, regardless of NODE_ENV (dev bypass)', () => {
    process.env.NODE_ENV = 'production';
    expect(isAuthEnforced()).toBe(false);
    process.env.NODE_ENV = 'development';
    expect(isAuthEnforced()).toBe(false);
  });

  it('returns true only when both CF_ACCESS_TEAM and CF_ACCESS_AUD are set', () => {
    process.env.CF_ACCESS_TEAM = 'bluejays';
    process.env.CF_ACCESS_AUD = 'aud-tag-1234';
    expect(isAuthEnforced()).toBe(true);
  });

  it('returns false if only one of the CF vars is set', () => {
    process.env.CF_ACCESS_TEAM = 'bluejays';
    expect(isAuthEnforced()).toBe(false);
    delete process.env.CF_ACCESS_TEAM;
    process.env.CF_ACCESS_AUD = 'aud-tag-1234';
    expect(isAuthEnforced()).toBe(false);
  });
});
