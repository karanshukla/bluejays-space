// bluejays-ingest — headline generation job (stub).
//
// Runs once and exits, matching Railway cron semantics. In dev it's triggered
// manually:  docker compose run --rm ingest
//
// This stub only reports the runtime config it received so the wiring is
// visible. The real generation flow (fetch Reddit/Bluesky/MLB/FAX Sports →
// draft with Claude → write draft rows to Postgres) lands in a later task.

const required = (name) => process.env[name];

function configSummary() {
  const present = (name) => (process.env[name] ? 'set' : 'NOT SET');
  return {
    DATABASE_URL: present('DATABASE_URL'),
    ANTHROPIC_API_KEY: present('ANTHROPIC_API_KEY'),
    GENERATION_MODEL: required('GENERATION_MODEL') || 'claude-haiku-4-5',
    REDDIT_CLIENT_ID: present('REDDIT_CLIENT_ID'),
    BLUESKY_APP_PASSWORD: present('BLUESKY_APP_PASSWORD'),
  };
}

function main() {
  console.log('[ingest] starting generation run');
  console.log('[ingest] config:', configSummary());
  console.log('[ingest] stub: fetch + generate + DB insert would run here');
  console.log('[ingest] done');
}

main();
