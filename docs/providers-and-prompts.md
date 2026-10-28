# Provider roles and the next owner tasks

Official event brief, checked October 28, 2026:
https://youdotcom-oss.github.io/halloween-hack-2026/

The brief's header names You.com, One, CrewAI and Parasail for all teams. Track 3
also states a narrower minimum of one indispensable partner integration. Use all
four meaningfully for this entry so the product and submission have a clear
answer to both parts of the brief. AWS AgentCore is optional.

| Product | Concrete Ghost Links role | Runtime ownership |
| --- | --- | --- |
| You.com | Search exact former identifiers and retrieve public source pages | Timothy |
| Parasail | Interpret a custom request, compare cited evidence, draft an explanation | Timothy wires the model; Ivan owns prompts/evaluation |
| CrewAI | Coordinate bounded discovery → verification → draft stages and retries | Timothy |
| One | Prepare a reviewer-requested draft/ticket in a connected team workspace | Timothy; human grants app access |
| Streetli private adapter | Supply historical records, provenance and approved real cases | Ivan |
| RDAP/official reporting routes | Identify current registrar and provide reviewed route information | Existing backend; not a replacement for a sponsor integration |

CrewAI is a local Python framework, not a fourth API-key service. Account owners
complete service sign-in, credit redemption, key entry and app consent. The
runtime must keep every key server-side. Consult current provider model lists
and integration docs; never guess model IDs or SDK methods.

## Ivan's highest-value work

1. In the dev app, select three real cases with clear provider identity and
   internal history: one website, one phone, one email. Retained invalid flags
   can be stale, so review the reason and provenance before approving research.
2. Write down what a correct result should say and what it must not claim. Add
   fictional versions to the prompt evaluation set so they can be committed.
3. Evaluate the eleven existing prompt cases with the configured Parasail model;
   inspect false stale flags and unsupported abuse escalation. Change one rule
   or example at a time, rerun, and keep actual model outputs in ignored data/.
4. Make the reviewed case projection reachable through an approved private
   teammate endpoint. The existing localhost bridge does not serve another
   machine. Keep raw history and ADC behind the private boundary.
5. Defer new collection systems and full catalogue scans until one approved real
   case works through the entire sponsor pipeline.

## Model choice

Use event-provided Parasail credits first; its model supplies the generative
reasoning already needed by the demo. Parasail's OpenAI-compatible service hosts
open and frontier models: https://www.parasail.io/models . Hosted open-weight
inference is still billed service usage, even when covered by event credits.

A future local fallback can use an open-weight model such as Qwen3 4B/8B through
Ollama for intent planning and offline evaluations. Local Ollama needs no API
key, but model downloads, RAM/VRAM and latency still matter. See
https://docs.ollama.com/quickstart and https://qwenlm.github.io/blog/qwen3/ . No
local model is installed or configured by this prompt-pack change. Do not replace
the demo's Parasail integration merely to add another model stack.
