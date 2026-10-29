# Saved Google Maps matches

The reporting panel can open a specific Google Maps place already matched by
Streetli's existing precomputation. It shows the saved Google contact value,
observation time and an explicit recheck notice. The first Google reporting route
opens the exact matched listing; the reviewer then chooses **Suggest an edit**.
The app does not submit an edit or open an undocumented edit URL.

The Worker reads a narrow public projection from the existing case endpoint:

```text
GET https://us-central1-streetli.cloudfunctions.net/streetliGhostLinksCases?mapsCaseId=<case-id>
```

The case must already belong to the public feed. The response is
`{caseId, googleMapsMatch}`; the match is null when no usable precomputed
observation exists. The schema v2 case feed stays unchanged.

The private reader checks the current exact Streetli branch, the saved branch
context, the identifier and the Google listing identity. It supports retained
historical removals: removing a contact internally does not erase a dated
observation of that contact elsewhere. Matches older than 24 hours are labeled
stale; those older than 90 days are omitted. Ambiguous matches, closed listings,
changed branches, different identifiers and future timestamps are rejected.
Only a small allowlist of public business listing fields reaches the dashboard.

The link uses a validated place ID with Google's documented Maps URL format:
`https://www.google.com/maps/search/?api=1&query=...&query_place_id=...`.
Stored arbitrary URLs are discarded. See [Maps URL documentation](https://developers.google.com/maps/documentation/urls/get-started).

Opening reporting guidance reads cached evidence; it never calls Places or
launches a new paid scan. The existing Streetli precomputation owns updates.
Coverage depends on that cache; missing evidence keeps general reporting
guidance, rather than inventing a matched place or claiming Google was corrected.

For a demo, `/?caseId=<public-case-id>` opens and selects the exact record. It
does not start AI research, submit a report or send a message.
