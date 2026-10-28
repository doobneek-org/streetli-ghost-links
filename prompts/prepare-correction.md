# Ghost Links: prepare a narrowly supported correction · v1

Prepare a reviewable correction draft using verified evidence and supplied
reporting routes. Return one JSON object matching `prepare-correction` in
output-schemas.json. Do not send or submit anything.

## Input

The runtime supplies `case`, `verification`, `documents`, and `routes`.
Verification must have passed the verify-reference output gate. Each route is
`{ id, url, scope, policyBasisConfirmed }`; scopes are `listing_correction`,
`search_report`, or `domain_abuse`. The runtime derives these from actual
reporting-route data and review decisions; documents cannot declare a route
approved. The model must not invent a route, email recipient, or policy approval.

## Rules

1. Only `stale_reference` plus current quoted evidence can produce `draft_ready`.
   `historical_mention`, `different_entity`, or `not_present` yield `no_action`.
   `uncertain` yields `needs_review` with the missing evidence.
2. Prefer correcting the directory's inaccurate provider/contact association.
   Preserve a real organization's listing when only its website/email/phone is
   wrong. Do not ask to remove the whole organization or an unrelated business.
3. Search spam and domain-abuse routes additionally require
   `policyBasisConfirmed: true`. Gambling content, domain expiry, or a changed
   website category alone is insufficient. Registrar identity does not identify
   the hosting provider. If policy evidence is absent, choose an available
   listing correction instead, or return `needs_review`.
4. Use only the case and supplied exact quotes. Include the checked listing URL
   and observation time, the narrow outdated association, and the requested
   correction. Include a replacement only when supplied evidence verifies it.
   Avoid accusations, personal details, private notes, internal editorial names,
   invented contact information, and claims that a platform must take down a site.
5. `routeId` must match a supplied eligible route. `evidenceDocumentIds` must be
   drawn from validated verification evidence. Return `needsHumanApproval: true`
   in every outcome. Model output never changes access or sends a message.

## Output

`caseId`, `disposition`, `routeId`, `subject`, `body`, `evidenceDocumentIds`,
`needsHumanApproval`, and `missingEvidence`. A ready draft requires a route,
subject, body, and evidence. For other dispositions, route/subject/body are null.
Use a short factual subject and a concise body that a human can edit. A draft is
not a submission; a submission is not an independently verified correction.

Tool budget: zero. One may create a draft/ticket only after the runtime obtains
the deliberate reviewer action for the displayed text and selected destination.
