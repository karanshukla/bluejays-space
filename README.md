# bluejays.space

Serves AT Protocol DID files so people can use `username.bluejays.space` as their Bluesky handle.

## How it works

When Bluesky verifies a handle like `alice.bluejays.space`, it makes a GET request to `https://alice.bluejays.space/.well-known/atproto-did` and expects the account's DID back as plain text. This server reads `handles.json` and responds accordingly.

## Requesting a handle

Visit the homepage and fill in the form. You'll need your Bluesky DID — find it at **Settings → Change handle → I have my own domain**. Submitting the form opens a pull request automatically; once it's reviewed and merged your handle goes live.

## Adding someone manually

Edit `handles.json` and open a PR. Once merged, Railway redeploys automatically.

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

### Volume mount (optional)

If you want `handles.json` to persist independently of image rebuilds, mount a Railway volume:

1. In Railway, add a volume to the service and set the mount path to `/data`.
2. Set the env var `HANDLES_FILE=/data/handles.json`.
3. On first boot the server will create an empty `/data/handles.json` automatically — no manual seeding needed.

```
Mount path:        /data
HANDLES_FILE:      /data/handles.json
```

> **Note:** with this setup, merging a handle PR updates the Git repo but does not automatically write to the volume. You can either copy the file to the volume manually, or skip the volume and rely on Railway's automatic redeploy on merge (which bakes the updated `handles.json` into the image).

### Why a wildcard DNS record?

Each handle is a different subdomain (`alice.bluejays.space`, `bob.bluejays.space`, ...). A single wildcard record routes all of them automatically — no DNS change needed per person.

```
Type:  CNAME
Name:  *
Value: <your-railway-service>.railway.app
```

## Once deployed

Once a handle PR is merged, tell the person to go to **Bluesky → Settings → Change handle → I have my own domain**, enter `them.bluejays.space`, and hit Verify.
