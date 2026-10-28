# Domain prompts and evaluation ownership

Ivan owns domain-specific prompt text and evaluation examples. Timothy owns
loading these templates, connecting tools/models, validating structured output,
and rendering progress/results. There are no production prompts in this folder
yet; the filenames below describe the agreed implementation boundary.

Planned templates:

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
