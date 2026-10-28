# Research backend for Cloud Run: the Node server plus the Python/CrewAI runtime it spawns.
# Serves the routes the Cloudflare Worker proxies; every request except /health needs
# Authorization: Bearer $RESEARCH_BACKEND_TOKEN. Provider keys come from the environment.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# The Node runners look for apps/agent/.venv/bin/python (see apps/agent/python-runtime.mjs).
COPY apps/agent/requirements.txt apps/agent/requirements.txt
RUN python3 -m venv apps/agent/.venv \
  && apps/agent/.venv/bin/pip install --no-cache-dir -r apps/agent/requirements.txt

COPY --chown=node:node . .
# Reviewer decisions, findings and the demo cache live under data/ (lost on restart; see docs/deploy-cloud-run.md).
RUN mkdir -p data && chown node:node data

ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 CREWAI_DISABLE_TELEMETRY=true
USER node
EXPOSE 8080
CMD ["node", "apps/agent/fixture-server.mjs"]
