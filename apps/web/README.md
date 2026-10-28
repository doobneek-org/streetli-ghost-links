# Dashboard workspace

Timothy's starting point: the fixture API at `http://127.0.0.1:4317/api/cases`.
The frontend is not implemented yet. Choose a small framework or buildless UI.

Initial flow: prompt → select a historical case → show the corrected provider
record → stream genuine web-research progress → show cited external references
and a correction draft. Keep fixture/live/replay labels visible.

Sponsor credentials and the Streetli feed token must never enter browser code.
Serve the frontend and its server API on the same origin, or explicitly configure
the development proxy. The fixture server intentionally enables no broad CORS.
