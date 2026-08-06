# bluejays.space

Serves AT Protocol DID files so people can use `username.bluejays.space` as their Bluesky handle.

## How it works

When Bluesky verifies a handle like `alice.bluejays.space`, it makes a GET request to `https://alice.bluejays.space/.well-known/atproto-did` and expects the account's DID back as plain text. This server reads `handles.json` and responds accordingly.

## Requesting a handle

Visit the homepage and fill in the form. You'll need your Bluesky DID — find it at **Settings → Change handle → I have my own domain**. Submitting the form opens a pull request automatically; once it's reviewed and merged your handle goes live.

## Adding someone manually

Edit `handles/handles.json` and open a PR. Once merged, Railway redeploys automatically.

```json
{
  "alice": "did:plc:..."
}
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Port to listen on |
| `BASE_DOMAIN` | `bluejays.space` | Root domain for handles |
| `HANDLES_FILE` | `handles.json` | Path to the handles config |
| `GITHUB_TOKEN` | — | Fine-grained PAT for opening PRs from the request form |
| `GITHUB_REPO` | `karanshukla/bluejays-space` | Repo the PAT targets |

### GitHub token

The handle request form uses `GITHUB_TOKEN` to create a branch and open a PR on your behalf. Create a **fine-grained personal access token** (Settings → Developer settings → Fine-grained tokens) scoped to only this repository with these permissions:

- **Contents**: Read and Write
- **Pull requests**: Write

That's the minimum needed. A classic PAT works too but has broader scope than necessary.

## Deployment (Railway)

1. Create a new Railway project from this repo — it auto-detects the Dockerfile.
2. Set `BASE_DOMAIN=bluejays.space` and `GITHUB_TOKEN=<your token>`.
3. Add a custom domain `*.bluejays.space` in Railway and point it at the service.


### Why a wildcard DNS record?

Each handle is a different subdomain (`alice.bluejays.space`, `bob.bluejays.space`, ...). A single wildcard record routes all of them automatically — no DNS change needed per person.

```
Type:  CNAME
Name:  *
Value: <your-railway-service>.railway.app
```

### One canonical host for the form

The wildcard means every hostname under it reaches this service, and the form handler is not host-gated — so `alice.bluejays.space/`, `www.bluejays.space/`, and every handle ever merged all used to serve a byte-identical copy of the request form. Search engines read that as one page duplicated across a set of hosts that grows with every handle, which is why linking to this service from the main site was a problem.

`/` now 301s to `https://handles.<BASE_DOMAIN>/` from any other host under the wildcard (`canonicalRedirect` in `main.go`), so there is exactly one indexable URL for the form. Two things deliberately do *not* redirect:

- **`/.well-known/atproto-did`** — Bluesky resolves this per-handle on the user's own subdomain, so it stays host-derived. Redirecting it would break every handle on the service.
- **Hosts outside the wildcard** — `localhost`, Railway's internal health check, a direct IP. Local runs and probes are untouched.

## Once deployed

Once a handle PR is merged, tell the person to go to **Bluesky → Settings → Change handle → I have my own domain**, enter `them.bluejays.space`, and hit Verify.
