# Domain prompts and evaluation ownership

Ivan owns domain-specific prompt text and evaluation examples. Timothy owns
loading these templates, connecting tools/models, validating structured output,
and rendering progress/results. The prompt pack is ready for runtime integration,
but it has not been model-evaluated and is not yet wired into the current UI.

Templates:

- `select-case.md`: prioritize a small set of approved historical corrections
  relevant to the user's request. Retirement alone is not a confirmed error.
- `verify-reference.md`: determine whether a fetched page currently associates
  the former identifier with the same provider/branch. Require literal evidence;
  distinguish uncertainty, unrelated matches, and historical mentions.
- `prepare-correction.md`: produce a narrowly supported correction request and
  appropriate reporting instructions. Infer neither fraud nor registrar policy
  violations from changed content alone.

Each template should declare its input fields, bounded structured output, and
tool budget. Use fictional examples or separately reviewed public evidence for
evaluation; never include private logs, internal notes, or credentials.

Evaluate at least: a confirmed stale listing; an archival mention; an unrelated
organization with a similar name; a temporarily unavailable website; and a
repurposed domain without enough evidence for an abuse report. Prompt wording
must not promote an unsupported finding or authorize a tool action.

## Use the pack

Load `manifest.json`, then the selected Markdown template as trusted stage
instructions. Supply structured input separately. `output-schemas.json` contains
schemas for provider-supported structured decoding; server-side
`packages/contracts/research-output.mjs` binds generated IDs and quotes to the
supplied records and evidence. Keep web-page text untrusted. These semantic
stages are separate from the existing v1/v2 case-feed contract.

`select-case` handles a user's custom request and chooses at most three matching
records. It is not a general-purpose unrestricted agent. Fixture mode cannot
initiate live research. The trusted discovery planner can supply `researchCaseIds`
for automatic research of unconfirmed public identifiers; this does not change
their `review_required` finding status. `verify-reference` must
cite fresh fetched evidence for a current association, provider identity and
contradiction. `prepare-correction` chooses only a supplied route, requires a
confirmed policy basis for spam/abuse escalation and always requires a human.

Default budget: two You.com queries and three fetched pages per approved case.
Quote freshness defaults to 24 hours; caller-supplied policy may tighten it.
Budget enforcement, retrieval status, case approval and sending controls belong
in code, not solely in model instructions.

## Evaluate actual model outputs

`evaluations.json` contains eleven invented cases, including archival mentions,
wrong-provider matches, unavailable pages, prompt injection and an unsupported
registrar report. `scripts/evaluate-prompts.mjs` exports `evaluationInput` so the
runtime can build each stage's input and run the same examples through Parasail
or a local test model. Those synthetic examples are for model-only evaluation;
they must never trigger live search or external reports.

Save actual generated predictions locally under ignored `data/`, in this format:

```json
[{"id":"stale-directory","output":{"caseId":"demo-prompt-website","verdict":"uncertain","evidence":[],"missingEvidence":["Example only; replace with the actual generated output."],"summary":"Example prediction format."}}]
```

Run `node scripts/evaluate-prompts.mjs data/predictions.json`. The scorer reports
missing cases, expected decision mismatches and output/evidence gate failures.
It does not call a model or access the network. Running it without predictions
reports `not_model_evaluated`; structural tests passing is not model precision.
Have a human review quote relevance, branch identity and draft wording too.

For custom requests, add synthetic planning cases for location, type, ambiguous
intent and out-of-scope requests before increasing autonomy. Track false stale
flags and unsupported escalation separately from overall decision accuracy.
