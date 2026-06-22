# bluejays.space

Serves AT Protocol DID files so people can use `username.bluejays.space` as their Bluesky handle.

## How it works

When Bluesky verifies a handle like `alice.bluejays.space`, it makes a GET request to `https://alice.bluejays.space/.well-known/atproto-did` and expects the account's DID back as plain text. This server reads `handles.json` and responds accordingly.

## Adding someone

Edit `handles.json` and open a PR. Once merged, Railway redeploys automatically.

```json
{
  "alice": "did:plc:..."
}
```

To find someone's DID: Bluesky → Settings → Change handle → I have my own domain — it's shown right there.

## Deployment (Railway)

1. Create a new Railway project from this repo — it auto-detects the Dockerfile.
2. Set the env var `BASE_DOMAIN=bluejays.space`.
3. Add a custom domain `*.bluejays.space` in Railway and point it at the service.

### Why a wildcard DNS record?

Each handle is a different subdomain (`alice.bluejays.space`, `bob.bluejays.space`, ...). A single wildcard record `*.bluejays.space → Railway` routes all of them automatically, so you never have to touch DNS again when adding someone. Without it, you'd need a new DNS record per person.

In your DNS provider, add:

```
Type:  CNAME
Name:  *
Value: <your-railway-service>.railway.app
```

## Once deployed

Tell the person their handle is ready, then they go to:
**Bluesky → Settings → Change handle → I have my own domain** → enter `them.bluejays.space` → Verify.
