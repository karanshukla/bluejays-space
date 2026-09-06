import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getHandlesUrl, getSiteUrl } from './site';

describe('getSiteUrl', () => {
  const original = process.env.SITE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = original;
  });

  it('reads SITE_URL at call time so Railway runtime vars are picked up', () => {
    process.env.SITE_URL = 'https://bluejays.space';
    expect(getSiteUrl().href).toBe('https://bluejays.space/');
  });

  it('falls back to localhost when SITE_URL is unset', () => {
    delete process.env.SITE_URL;
    expect(getSiteUrl().href).toBe('http://localhost:4321/');
  });
});

describe('getHandlesUrl', () => {
  const originalSite = process.env.SITE_URL;
  const originalHandles = process.env.HANDLES_URL;
  beforeEach(() => {
    delete process.env.SITE_URL;
    delete process.env.HANDLES_URL;
  });
  afterEach(() => {
    if (originalSite === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = originalSite;
    if (originalHandles === undefined) delete process.env.HANDLES_URL;
    else process.env.HANDLES_URL = originalHandles;
  });

  it('derives handles.<site host> when HANDLES_URL is unset', () => {
    process.env.SITE_URL = 'https://bluejays.space';
    expect(getHandlesUrl().href).toBe('https://handles.bluejays.space/');
  });

  it('prefers HANDLES_URL over the derived host', () => {
    process.env.SITE_URL = 'https://bluejays.space';
    process.env.HANDLES_URL = 'http://localhost:8080';
    expect(getHandlesUrl().href).toBe('http://localhost:8080/');
  });

  // The derived default is unreachable in dev — handles.localhost:4321 resolves
  // nowhere — which is the whole reason HANDLES_URL exists. Compose sets it.
  it('derives an unservable host in dev without the override', () => {
    expect(getHandlesUrl().href).toBe('http://handles.localhost:4321/');
  });
});
