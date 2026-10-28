# Dashboard workspace

The buildless frontend runs at `http://127.0.0.1:4317/` with `npm run dev`.
It reads the same-origin case API, displays historical contact flags and removed
identifiers, and supports prompt/text search, filters and reporting-route guidance.
It defaults to fictional fixtures unless a private live source is configured.

Current flow: prompt → select a historical case → show recorded provenance →
open web search or view reporting routes. Live You.com discovery, model-based
comparison and One actions remain integration work. Keep fixture/live/replay
labels visible and do not claim that opening Google search verified a listing.

Sponsor credentials and the Streetli feed token must never enter browser code.
Serve the frontend and its server API on the same origin, or explicitly configure
the development proxy. The fixture server intentionally enables no broad CORS.
