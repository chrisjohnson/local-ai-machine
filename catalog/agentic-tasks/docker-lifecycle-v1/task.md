# Task: fix the wordcount app and validate it against the running system

This directory contains a small two-service app (`wordcount-frontend` +
`wordcount-backend`) defined in `docker-compose.yml`. See `README.md` for
what each service is supposed to do.

**The app is currently broken.** Your job:

1. Build and start the stack (`docker compose up -d --build`).
2. Find and fix what's wrong. There is more than one issue — do not stop
   after finding the first one. You should end up with a stack where:
   - `GET http://localhost:9200/health` returns HTTP 200 with
     `{"status": "ok"}`.
   - `POST http://localhost:9200/track` with body
     `{"word": "<any word>"}` successfully increments and returns the
     word's new count (confirm this actually reaches the backend — check
     `GET http://localhost:9100/count/<word>` directly against the backend
     too, not just the frontend's response).
   - `GET http://localhost:9200/top?n=<N>` returns the top N tracked words
     **sorted most-frequent-first** (descending by count) — read
     `frontend/server.py`'s docstring for the exact documented behavior of
     this endpoint and make sure the implementation actually matches it.
3. **Validate your fix by actually interacting with the running
   containers** (real `curl`/HTTP requests against the running services,
   not just reading the code) — track at least 3 different words with
   different counts and confirm `/top` returns them in the correct order.
4. Leave the stack **running and healthy** when you're done (do not stop
   the containers as your final action — the grading process will connect
   to your running stack to validate it, and will stop it itself
   afterward).

You have full access to `docker`/`docker compose` (no `sudo` needed) and
the filesystem. Feel free to modify any file under `backend/` or
`frontend/` or `docker-compose.yml` as needed to fix the issues. Do not
change the documented API shapes (endpoint paths, request/response JSON
field names) — the issues are bugs/misconfiguration, not a spec change.
