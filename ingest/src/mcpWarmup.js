// Wakes up the mlb-api-mcp Railway service before the generation calls.
//
// mlb-api-mcp is a separate Railway deployment (see docs/production-verification.md)
// that sleeps when idle — since ingest only runs once/day via cron, it's cold
// on every single run. Anthropic's MCP connector enforces its own ~300s
// per-tool-call timeout (independent of this app's own REQUEST_TIMEOUT_MS in
// claude.js), and a cold start landed right at that ceiling in production:
// some tool calls squeaked through just under 300s, others timed out (see the
// `content_block_start ... +311215ms` / `Waited 300.0 seconds` production log
// this was diagnosed from). Waiting here, before any generation call starts,
// moves the wake-up cost outside that per-tool-call budget instead of racing it.
//
// Any HTTP response — even a 4xx/5xx from the MCP endpoint rejecting a bare
// GET — proves the container is up and serving requests, which is the only
// signal needed here; a network-level failure (connection refused, or this
// module's own per-attempt timeout) means it's still asleep/booting.

const DEFAULT_ATTEMPT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_DELAY_MS = 10_000;
const DEFAULT_MAX_WAIT_MS = 4 * 60 * 1000;

async function ping(url, fetchImpl, attemptTimeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), attemptTimeoutMs);
  try {
    await fetchImpl(url, { signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Polls `url` until it answers or `maxWaitMs` elapses. Never throws — a
// still-asleep (or genuinely down) MCP server shouldn't block the whole
// ingest run; generation just proceeds and takes its chances, same as before
// this warm-up existed. No-ops when MLB_MCP_URL isn't configured.
export async function warmUpMlbMcp({
  url = process.env.MLB_MCP_URL,
  fetchImpl = fetch,
  attemptTimeoutMs = DEFAULT_ATTEMPT_TIMEOUT_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  maxWaitMs = DEFAULT_MAX_WAIT_MS,
} = {}) {
  if (!url) return;

  const startedAt = Date.now();
  console.log('[mcp-warmup] pinging mlb-api-mcp to wake it before generation...');
  while (Date.now() - startedAt < maxWaitMs) {
    if (await ping(url, fetchImpl, attemptTimeoutMs)) {
      console.log(`[mcp-warmup] mlb-api-mcp responded after ${Date.now() - startedAt}ms`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  console.warn(
    `[mcp-warmup] gave up waiting for mlb-api-mcp after ${maxWaitMs}ms; proceeding anyway`
  );
}
