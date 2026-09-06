import { isIP } from 'node:net';

export function clientIp(request: Request): string {
  const claimed = request.headers.get('CF-Connecting-IP');
  return claimed && isIP(claimed) ? claimed : 'unknown';
}
