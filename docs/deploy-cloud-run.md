# Deploy the research backend to Cloud Run

The Cloudflare Worker at `you.doobneek.org` serves the dashboard and proxies the
research routes to this backend (contract: `docs/handoffs/ivan-streetli-adapter.md`).
The backend is the Node server plus the Python/CrewAI runtime, built from the root
`Dockerfile`. Cloud Build builds it; Docker is not needed locally.

## How the container runs

- `HOST=0.0.0.0` and `PORT=8080` (Cloud Run sets `PORT`).
- Every request except `GET /health` must send `Authorization: Bearer
  $RESEARCH_BACKEND_TOKEN`; the Worker does this. The server refuses to start on a
  public host without the token. Requests with an `Origin` header are rejected.
- Python runs from `apps/agent/.venv` inside the image.
- A plain container's `data/` is lost on restart. The hosted service mounts a
  private Cloud Storage bucket at `/app/data` to retain reviewer decisions,
  findings, receipts and the demo cache. Keep `--max-instances 1`: these JSON stores
  are designed for a single writer, not a distributed database.
- Use a dedicated runtime service account with access only to this app's secrets.
  One connection metadata can be mounted from Secret Manager at
  `/app/one/one-actions.json` with `ONE_ACTIONS_FILE` pointing there. The config and
  `.env` stay out of both Git and the container image.

## One-time setup

```sh
brew install --cask google-cloud-sdk
gcloud auth login
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com --project streetli
```

Create the backend token (32+ characters of `A-Za-z0-9_-`) and the provider secrets.
Never paste these into tracked files.

```sh
openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n' | gcloud secrets create ghost-links-research-backend-token --data-file=- --project streetli
printf %s "$YDC_API_KEY"      | gcloud secrets create ghost-links-ydc-api-key --data-file=- --project streetli
printf %s "$PARASAIL_API_KEY" | gcloud secrets create ghost-links-parasail-api-key --data-file=- --project streetli
printf %s "$ONE_SECRET"      | gcloud secrets create ghost-links-one-secret --data-file=- --project streetli
```

Grant the dedicated runtime service account access:

```sh
for s in ghost-links-research-backend-token ghost-links-ydc-api-key ghost-links-parasail-api-key ghost-links-one-secret; do
  gcloud secrets add-iam-policy-binding "$s" --role=roles/secretmanager.secretAccessor \
    --member=serviceAccount:ghost-links-research@streetli.iam.gserviceaccount.com --project streetli
done
```

## Deploy

From the repository root:

```sh
gcloud run deploy ghost-links-research --source . --region us-east1 --project streetli \
  --service-account ghost-links-research@streetli.iam.gserviceaccount.com \
  --allow-unauthenticated --max-instances 1 --memory 2Gi --cpu 2 --timeout 600 \
  --set-secrets RESEARCH_BACKEND_TOKEN=ghost-links-research-backend-token:latest,YDC_API_KEY=ghost-links-ydc-api-key:latest,PARASAIL_API_KEY=ghost-links-parasail-api-key:latest,ONE_SECRET=ghost-links-one-secret:latest \
  --set-env-vars PARASAIL_BASE_URL=<url>,PARASAIL_MODEL=<model>,PARASAIL_REASONING_EFFORT=low
```

`--allow-unauthenticated` only lets requests reach the container; the backend token
still gates every route except `/health`.

## Check

```sh
URL=$(gcloud run services describe ghost-links-research --region us-east1 --project streetli --format 'value(status.url)')
curl -s "$URL/health"                     # 200, researchRuntimeAvailable: true
curl -s -o /dev/null -w '%{http_code}\n' "$URL/api/discovery/findings"   # 401 without the token
```

Then give Ivan the `URL` and the token (out of band). He sets
`RESEARCH_BACKEND_URL` and `wrangler secret put RESEARCH_BACKEND_TOKEN`, and `/health`
on the Worker reports `researchBackendConfigured: true`.

Configure `MAINTAINER_TOKEN` on the Worker separately. Open **Research access** on
the dashboard and enter the team access code before using research, reviewer or
One actions. The browser keeps it in memory, clears it on reload, and never sends
the provider keys. The owner's ignored `.env` can keep a copy named
`GHOST_LINKS_MAINTAINER_TOKEN`; the backend token is a different credential.

## Persistent state

The deployed private bucket is `streetli-ghost-links-state-453598448712`, in the
`streetli` project and `us-east1`. It has public access prevention, uniform bucket
access and a hierarchical namespace. Grant the dedicated runtime
`roles/storage.objectUser` on this bucket only. The Cloud Run volume is:

```json
{
  "name": "research-state",
  "gcs": {
    "bucket": "streetli-ghost-links-state-453598448712",
    "readOnly": false,
    "mountOptions": ["uid=1000", "gid=1000"]
  }
}
```

Mount it at `/app/data` and select the second generation execution environment.
The uid/gid match the Docker image's `node` user. The baseline remains the
independent public Firebase feed; this bucket holds the research app's state.
Verify persistence by checking a saved result before and after a new revision.
See [Cloud Storage mounts](https://docs.cloud.google.com/run/docs/configuring/services/cloud-storage-volume-mounts).

## One connection metadata

`npm run one:setup` resolves connected One actions without sending anything. To
host them, store its ignored `data/one-actions.json` in a secret named
`ghost-links-one-actions`, grant the runtime read access, and mount a selected
version as `/app/one/one-actions.json`. Set
`ONE_ACTIONS_FILE=/app/one/one-actions.json`. Mounting it under `data/` would hide
the writable directory, so use the separate `/app/one` path. Sheets additionally
needs `GHOST_LINKS_SHEET_ID`; SMS needs a connected Twilio account and sender.
