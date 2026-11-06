# DXBMUN E-Chits backend

Litestar ASGI backend for E-Chits. It uses Redis Pub/Sub for real-time delivery and SQLite (WAL mode) for persistent message history. The DXBMUN website is not part of this service.

## Requirements

- Python 3.11+
- Redis 7+
- `users.csv` with the columns `code,name,committee,country`; access codes should be private and unique.

Install dependencies and run locally:

```sh
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
redis-server
USERS_FILE=users.csv REDIS_URL=redis://localhost:6379/0 \
  uvicorn app:app --host 127.0.0.1 --port 8000
```

For local smoke testing only, omit `USERS_FILE` to load `users.sample.csv`. Never use the sample list for a live conference.

## Docker Compose

Set `USERS_FILE` to the path of a private CSV, or use the sample list for development:

```sh
USERS_FILE=users.csv APP_ENV=production docker compose up --build
```

The web container starts four Uvicorn workers; Compose sets each container's `nofile` limit to 4096. `deploy.sh` applies the same host-shell limit before starting the stack. SQLite data persists in the `echits-data` volume. Configure `APP_ENV=production` when using a private users file. Redis Pub/Sub is ephemeral; SQLite retains messages when recipients are offline.

## HTTP API

- `POST /api/login` with `{"access_code":"..."}` sets an HTTP-only session cookie.
- `POST /api/logout` invalidates the session and clears the cookie.
- `GET /api/me` returns the signed-in user's profile.
- `GET /api/inbox` returns the user's latest 500 sent and received messages.
- `GET /health` checks Redis connectivity.

In production, terminate TLS at a trusted reverse proxy and set `SESSION_COOKIE_SECURE=1`. Keep `users.csv` out of source control and restrict access to the SQLite data volume and Redis service.

## WebSocket protocol

Connect to `/ws/echits` with the session cookie from `/api/login`.

Register the authenticated user:

```json
{"action":"register","delegate_id":"DEL12345"}
```

Send a chit:

```json
{"action":"send_chit","receiver":"DEL12346","message":"Please send your position paper."}
```

Successful sends receive a `delivery_ack` with the Redis subscriber count. A recipient with an active registered socket receives a `chit` event. Malformed JSON and invalid actions return an error event without closing the connection. Chits are restricted to users in the same committee, except that admins can send to or receive from any committee.
