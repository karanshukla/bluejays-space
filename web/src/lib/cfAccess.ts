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

export interface JWKS {
  keys: JWK[];
}

export function isAuthEnforced(): boolean {
  return Boolean(process.env.CF_ACCESS_TEAM && process.env.CF_ACCESS_AUD);
}

function teamDomain(): string {
  const team = process.env.CF_ACCESS_TEAM;
  if (!team) throw new Error('CF_ACCESS_TEAM not set');
  return `https://${team}.cloudflareaccess.com`;
}

export async function verifyJwtWithLocalKeys(
  token: string,
  jwks: JWKS,
  options: Pick<JWTVerifyOptions, 'issuer' | 'audience'>
): Promise<VerifiedUser> {
  const keySet = createLocalJWKSet(jwks);
  const { payload } = await jwtVerify(token, keySet, options);
  return verifiedUser(payload);
}

// Verifies against the team's remote JWKS so the gate holds even when a request
// reaches the Node process without passing Cloudflare's edge (e.g. Railway's
// direct *.up.railway.app domain, which bypasses Access path-scoping).
export async function verifyCfAccessJwt(token: string): Promise<VerifiedUser> {
  const audience = process.env.CF_ACCESS_AUD;
  if (!audience) throw new Error('CF_ACCESS_AUD not set');
  const issuer = teamDomain();
  const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  const { payload } = await jwtVerify(token, jwks, { issuer, audience });
  return verifiedUser(payload);
}

function verifiedUser(payload: Record<string, unknown>): VerifiedUser {
  return {
    email: typeof payload.email === 'string' ? payload.email : '',
    sub: typeof payload.sub === 'string' ? payload.sub : '',
  };
}
