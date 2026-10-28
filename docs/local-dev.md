# Run the development app

Use Node.js 20.19+ in this standalone repository. Run `npm test`, then `npm run dev`.
Open http://127.0.0.1:4317/. The server binds loopback only. Frontend files are
served directly; refresh the browser after editing them.

The app uses the shared public live source by default, with no Streetli token or
Firebase credentials. Pull and merge `origin/main`, run `npm run dev`, and open
the local URL. An older blank `STREETLI_CASES_URL` also selects this shared source.
An explicit custom URL, including the owner's old localhost URL, overrides it.

The source is
https://us-central1-streetli.cloudfunctions.net/streetliGhostLinksCases.
It serves a precomputed public projection, refreshed hourly from retained live
findings. Reads and the local refresh button do not launch scans or paid research.

Set `STREETLI_CASES_MODE=fixture` for labeled offline examples. Fixture records
cannot trigger external search or registrar reporting lookups.

## Private live case source

Only the Streetli owner runs the private source bridge from the canonical private
checkout. It uses the owner's configured Doobneek ADC there. The public app never
receives those credentials or imports private Streetli modules.

In the public app's ignored local `.env`, set:

```dotenv
PORT=4317
STREETLI_CASES_URL=http://127.0.0.1:4318/api/cases
STREETLI_CASES_TOKEN=<the dedicated local bridge token>
```

The owner starts their private bridge with the same `STREETLI_CASES_TOKEN`, then
starts `npm run dev` here. A cold import may take about a minute. Concurrent
requests share a load; the bridge and consumer reuse results for five minutes.
Refresh records requests a fresh read of the retained ledger and current catalogue
identity. This does not call the contacts, fetch provider websites, run AI scans,
publish data, or change the catalogue.

A teammate uses the shared endpoint above. Their localhost is not the owner's
machine. Keep the private bridge as an optional owner-only source and do not
share ADC or expose it through a tunnel.

## What the data means

Schema v2 adds `coverage`, per-case `location`, `internal.flaggedAt`, nullable
`internal.correctedAt`, and the `flagged` state; schema v1 fixtures remain valid.
Source counts count distinct identifiers; cards count identifier/location cases,
so one identifier shared by branches can produce several cards. `removed` means
retired membership plus current catalogue absence. Its date is removal detection,
not a claim that an editor confirmed wrongdoing. All imported live records need
review; there is no new current-validity verdict.

The app defaults to removed records when any are present. Type and state filters,
text search and suggested prompts operate over the loaded dataset locally. A
prompt does not pretend to call a model. An explicit Open web search link sends
the selected public identifier to Google in a new tab; the app has not verified
those external results yet.

View reporting steps provides Google, Findhelp and other directory guidance. For
website cases, it can retrieve registrar information from official IANA-bootstrap
RDAP services without visiting the flagged website. Registrar identity does not
identify the hosting provider or establish takedown grounds. No report is sent.

## Developer endpoints

- `GET /health`: mode and whether external research is implemented.
- `GET /api/cases`: cached approved case projection or fictional fixtures.
- `POST /api/refresh`: refresh retained source records, with a short local throttle.
- `GET /api/reporting?caseId=<id>`: source-based reporting guidance and passive
  domain registration lookup for an existing live case.

These development routes reject unrelated browser origins, do not enable CORS,
and return sanitized errors. Sponsor keys and source tokens stay server-only.
