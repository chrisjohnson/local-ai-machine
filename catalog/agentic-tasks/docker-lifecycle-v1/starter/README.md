# wordcount — two-service docker-compose app

A tiny word-tracking app made of two services:

- `backend` (`wordcount-backend`, port 9100) — in-memory counter service.
  `GET /count/<key>`, `POST /count/<key>` (body `{"amount": <int>}`),
  `GET /health`.
- `frontend` (`wordcount-frontend`, port 9200) — tracks words by delegating
  storage to `backend` over HTTP (via the `BACKEND_URL` environment
  variable set in `docker-compose.yml`). `POST /track` (body
  `{"word": <str>, "amount": <int, optional, default 1>}`), `GET /top?n=<N>`
  (most-frequent-first, default n=5), `GET /health` (checks backend
  reachability too).

See `frontend/server.py` and `backend/server.py` for full endpoint docs in
their module docstrings.

## Running it

```
docker compose up -d --build
curl http://localhost:9200/health
curl -X POST http://localhost:9200/track -d '{"word": "hello"}'
curl http://localhost:9200/top
```

Something in this stack is currently broken — see `task.md` for what you
need to find and fix.
