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
- `data/` (reviewer decisions, discovery findings, demo cache) is container-local and
  is lost when the instance restarts. Run one instance (`--max-instances 1`) so all
  requests see the same state.

## One-time setup

```sh
brew install --cask google-cloud-sdk
gcloud auth login
gcloud config set project <PROJECT_ID>
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
```

Create the backend token (32+ characters of `A-Za-z0-9_-`) and the provider secrets.
Never paste these into tracked files.

```sh
openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n' | gcloud secrets create research-backend-token --data-file=-
printf %s "$YDC_API_KEY"      | gcloud secrets create ydc-api-key --data-file=-
printf %s "$PARASAIL_API_KEY" | gcloud secrets create parasail-api-key --data-file=-
```

Grant the Cloud Run runtime service account access (by default
`<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`):

```sh
for s in research-backend-token ydc-api-key parasail-api-key; do
  gcloud secrets add-iam-policy-binding $s --role=roles/secretmanager.secretAccessor \
    --member=serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com
done
```

## Deploy

From the repository root:

```sh
gcloud run deploy ghost-links-research --source . --region us-east1 \
  --allow-unauthenticated --max-instances 1 --memory 2Gi --cpu 2 --timeout 300 \
  --set-secrets RESEARCH_BACKEND_TOKEN=research-backend-token:latest,YDC_API_KEY=ydc-api-key:latest,PARASAIL_API_KEY=parasail-api-key:latest \
  --set-env-vars PARASAIL_BASE_URL=<url>,PARASAIL_MODEL=<model>,PARASAIL_REASONING_EFFORT=low
```

`--allow-unauthenticated` only lets requests reach the container; the backend token
still gates every route except `/health`.

## Check

```sh
URL=$(gcloud run services describe ghost-links-research --region us-east1 --format 'value(status.url)')
curl -s "$URL/health"                     # 200, researchRuntimeAvailable: true
curl -s -o /dev/null -w '%{http_code}\n' "$URL/api/discovery/findings"   # 401 without the token
```

Then give Ivan the `URL` and the token (out of band). He sets
`RESEARCH_BACKEND_URL` and `wrangler secret put RESEARCH_BACKEND_TOKEN`, and `/health`
on the Worker reports `researchBackendConfigured: true`.
