// Wakes the mlb-api-mcp Railway service before the generation calls. It sleeps
// when idle (ingest runs once/day via cron, so it's cold every run), and
// Anthropic's MCP connector enforces its own ~300s per-tool-call timeout that a
// cold start can blow past. Waiting here moves the wake-up cost outside that
// per-tool budget. Any HTTP response proves the container is up.

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
