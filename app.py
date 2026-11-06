from __future__ import annotations

import asyncio
import csv
import hmac
import logging
import os
import secrets
import sqlite3
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import msgspec
from litestar import Litestar, Request, WebSocket, get, post
from litestar.exceptions import NotAuthorizedException
from litestar.handlers import WebsocketListener
from litestar.response import Response
from redis.asyncio import Redis
from redis.exceptions import RedisError

logger = logging.getLogger("echits")
COOKIE_NAME = "echits_session"
SESSION_TTL_SECONDS = 60 * 60 * 12
MAX_MESSAGE_LENGTH = 2_000
REGISTER_TIMEOUT_SECONDS = 5


class LoginRequest(msgspec.Struct):
    access_code: str


class ClientMessage(msgspec.Struct, kw_only=True):
    action: str
    delegate_id: str | None = None
    receiver: str | None = None
    message: str | None = None


def _database_path() -> Path:
    return Path(os.getenv("DATABASE_PATH", "data/echits.sqlite3"))


def _connect_database() -> sqlite3.Connection:
    path = _database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout = 30000")
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def _load_users() -> list[dict[str, str]]:
    configured_file = os.getenv("USERS_FILE")
    if configured_file:
        csv_path = Path(configured_file)
    elif os.getenv("APP_ENV", "development") == "production":
        raise RuntimeError("USERS_FILE must be set in production")
    else:
        csv_path = Path("users.sample.csv")

    if not csv_path.is_file():
        raise FileNotFoundError(f"Users CSV file not found: {csv_path}")

    users: list[dict[str, str]] = []
    with csv_path.open(newline="", encoding="utf-8-sig") as file:
        for row in csv.DictReader(file):
            normalized = {str(key or "").strip().lower(): str(value or "").strip() for key, value in row.items()}
            code = normalized.get("code") or normalized.get("access_code") or normalized.get("delegate_id")
            if not code:
                continue
            code = code.upper()
            prefix_role = {"DEL": "delegate", "CHR": "chair", "ADN": "admin"}
            users.append(
                {
                    "code": code,
                    "name": normalized.get("name") or normalized.get("delegate") or code,
                    "committee": normalized.get("committee", ""),
                    "country": normalized.get("country", ""),
                    "role": (normalized.get("role") or prefix_role.get(code[:3], "delegate")).lower(),
                }
            )
    if not users:
        raise RuntimeError(f"No valid users were found in {csv_path}")
    return users


def _initialize_database(users: list[dict[str, str]]) -> None:
    with _connect_database() as connection:
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                code TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                committee TEXT NOT NULL DEFAULT '',
                country TEXT NOT NULL DEFAULT '',
                role TEXT NOT NULL DEFAULT 'delegate'
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender TEXT NOT NULL,
                recipient TEXT NOT NULL,
                committee TEXT NOT NULL DEFAULT '',
                kind TEXT NOT NULL DEFAULT 'chit',
                subject TEXT NOT NULL DEFAULT 'E-Chit',
                body TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'delivered',
                note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                delivered_at TEXT NOT NULL,
                subtype TEXT NOT NULL DEFAULT 'other'
            )
            """
        )
        existing_columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(messages)").fetchall()
        }
        user_columns = {row["name"] for row in connection.execute("PRAGMA table_info(users)").fetchall()}
        if "country" not in user_columns:
            connection.execute("ALTER TABLE users ADD COLUMN country TEXT NOT NULL DEFAULT ''")
        migrations = {
            "committee": "TEXT NOT NULL DEFAULT ''",
            "kind": "TEXT NOT NULL DEFAULT 'chit'",
            "subject": "TEXT NOT NULL DEFAULT 'E-Chit'",
            "body": "TEXT NOT NULL DEFAULT ''",
            "status": "TEXT NOT NULL DEFAULT 'delivered'",
            "note": "TEXT NOT NULL DEFAULT ''",
            "created_at": "TEXT NOT NULL DEFAULT ''",
            "delivered_at": "TEXT NOT NULL DEFAULT ''",
            "subtype": "TEXT NOT NULL DEFAULT 'other'",
        }
        for column, definition in migrations.items():
            if column not in existing_columns:
                connection.execute(f"ALTER TABLE messages ADD COLUMN {column} {definition}")
        connection.executemany(
            """
            INSERT INTO users (code, name, committee, country, role)
            VALUES (:code, :name, :committee, :country, :role)
            ON CONFLICT(code) DO UPDATE SET
                name = excluded.name,
                committee = excluded.committee,
                country = excluded.country,
                role = excluded.role
            """,
            users,
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS messages_recipient_created "
            "ON messages(recipient, created_at DESC)"
        )


def _save_chit(sender: dict[str, str], receiver: dict[str, str], body: str, created_at: str) -> int:
    with _connect_database() as connection:
        columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(messages)").fetchall()
        }
        fields = ["sender", "recipient", "committee", "kind", "subject", "body", "status", "note"]
        values: list[Any] = [
            sender["code"],
            receiver["code"],
            sender["committee"],
            "chit",
            "E-Chit",
            body,
            "pending",
            "",
        ]
        if "created_at" in columns:
            fields.append("created_at")
            values.append(created_at)
        if "created" in columns:
            fields.append("created")
            values.append(int(time.time()))
        if "delivered_at" in columns:
            fields.append("delivered_at")
            values.append("")
        if "subtype" in columns:
            fields.append("subtype")
            values.append("other")
        placeholders = ", ".join("?" for _ in fields)
        cursor = connection.execute(
            f"INSERT INTO messages ({', '.join(fields)}) VALUES ({placeholders})",
            values,
        )
        return int(cursor.lastrowid)


def _is_allowed_sender(sender: dict[str, str], receiver: dict[str, str]) -> bool:
    return (
        sender["code"] != receiver["code"]
        and (
            sender["role"] == "admin"
            or receiver["role"] == "admin"
            or sender["committee"] == receiver["committee"]
        )
    )


async def _send_socket_json(socket: WebSocket, payload: dict[str, Any]) -> None:
    lock: asyncio.Lock = socket.scope["state"].setdefault("send_lock", asyncio.Lock())
    async with lock:
        await socket.send_text(msgspec.json.encode(payload).decode("utf-8"))


async def _listen_for_chits(
    socket: WebSocket,
    delegate_id: str,
    redis: Redis,
    subscribed: asyncio.Event,
) -> None:
    delay = 0.25
    while True:
        try:
            async with redis.pubsub() as pubsub:
                await pubsub.subscribe(f"user:{delegate_id}")
                subscribed.set()
                delay = 0.25
                async for event in pubsub.listen():
                    if event.get("type") != "message":
                        continue
                    message = event["data"]
                    if isinstance(message, bytes):
                        message = message.decode("utf-8")
                    await _send_socket_json(socket, msgspec.json.decode(message))
        except asyncio.CancelledError:
            raise
        except (RedisError, OSError, UnicodeDecodeError, msgspec.DecodeError):
            logger.exception("Redis subscription failed for delegate %s; reconnecting", delegate_id)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 5)


async def _authenticate_socket(socket: WebSocket) -> str | None:
    token = socket.cookies.get(COOKIE_NAME)
    if not token:
        return None
    delegate_id = await socket.app.state.redis.get(f"session:{token}")
    if isinstance(delegate_id, bytes):
        delegate_id = delegate_id.decode("utf-8")
    if delegate_id not in socket.app.state.users:
        return None
    return delegate_id


async def _authenticate_request(request: Request) -> str:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise NotAuthorizedException("Authentication required")
    delegate_id = await request.app.state.redis.get(f"session:{token}")
    if isinstance(delegate_id, bytes):
        delegate_id = delegate_id.decode("utf-8")
    if delegate_id not in request.app.state.users:
        raise NotAuthorizedException("Authentication required")
    return delegate_id


def _save_delivery_status(chit_id: int, delivered: bool, delivered_at: str) -> None:
    status = "delivered" if delivered else "queued"
    timestamp = delivered_at if delivered else ""
    with _connect_database() as connection:
        connection.execute(
            "UPDATE messages SET status = ?, delivered_at = ? WHERE id = ?",
            (status, timestamp, chit_id),
        )


def _get_inbox(delegate_id: str) -> list[dict[str, Any]]:
    with _connect_database() as connection:
        rows = connection.execute(
            """
            SELECT id, sender, recipient, body, status, created_at, subtype
            FROM messages
            WHERE recipient = ? OR sender = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 500
            """,
            (delegate_id, delegate_id),
        ).fetchall()
    return [dict(row) for row in rows]


class ChitWebSocketListener(WebsocketListener):
    path = "/ws/echits"
    receive_mode = "text"
    send_mode = "text"

    async def on_accept(self, socket: WebSocket) -> None:
        state = socket.scope.setdefault("state", {})
        delegate_id = await _authenticate_socket(socket)
        if not delegate_id:
            await socket.close(code=4401, reason="Authentication required")
            return
        state["authenticated_delegate_id"] = delegate_id
        state["subscription_task"] = None
        state["subscription_ready"] = None
        state["send_lock"] = asyncio.Lock()

    async def on_receive(self, data: str, socket: WebSocket) -> None:
        state = socket.scope.setdefault("state", {})
        delegate_id = state.get("authenticated_delegate_id")
        if not delegate_id:
            await socket.close(code=4401, reason="Authentication required")
            return
        try:
            request = msgspec.json.decode(data, type=ClientMessage)
        except (msgspec.DecodeError, TypeError, ValueError):
            await _send_socket_json(socket, {"type": "error", "error": "Malformed JSON payload"})
            return

        if request.action == "register":
            await self._register(request, socket, delegate_id)
        elif request.action == "send_chit":
            await self._send_chit(request, socket, delegate_id)
        else:
            await _send_socket_json(socket, {"type": "error", "error": "Unknown action"})

    async def _register(self, request: ClientMessage, socket: WebSocket, delegate_id: str) -> None:
        if not request.delegate_id or not hmac.compare_digest(request.delegate_id, delegate_id):
            await _send_socket_json(socket, {"type": "error", "error": "Delegate identity mismatch"})
            return

        state = socket.scope["state"]
        existing_task = state.get("subscription_task")
        if existing_task and not existing_task.done():
            await _send_socket_json(socket, {"type": "registered", "delegate_id": delegate_id})
            return

        ready = asyncio.Event()
        task = asyncio.create_task(
            _listen_for_chits(socket, delegate_id, socket.app.state.redis, ready),
            name=f"redis-chit-listener-{delegate_id}",
        )
        state["delegate_id"] = delegate_id
        state["subscription_task"] = task
        state["subscription_ready"] = ready
        try:
            await asyncio.wait_for(ready.wait(), timeout=REGISTER_TIMEOUT_SECONDS)
        except TimeoutError:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            state["subscription_task"] = None
            state["subscription_ready"] = None
            await _send_socket_json(socket, {"type": "error", "error": "Redis subscription unavailable"})
            return
        await _send_socket_json(socket, {"type": "registered", "delegate_id": delegate_id})

    async def _send_chit(self, request: ClientMessage, socket: WebSocket, sender_id: str) -> None:
        subscription_task = socket.scope["state"].get("subscription_task")
        if not subscription_task or subscription_task.done():
            await _send_socket_json(socket, {"type": "error", "error": "Register before sending chits"})
            return
        receiver_id = (request.receiver or "").strip().upper()
        body = (request.message or "").strip()
        if not receiver_id or not body or len(body) > MAX_MESSAGE_LENGTH:
            await _send_socket_json(
                socket,
                {"type": "error", "error": f"Receiver and a 1-{MAX_MESSAGE_LENGTH} character message are required"},
            )
            return

        users: dict[str, dict[str, str]] = socket.app.state.users
        sender = users[sender_id]
        receiver = users.get(receiver_id)
        if receiver is None:
            await _send_socket_json(socket, {"type": "error", "error": "Receiver not found"})
            return
        if not _is_allowed_sender(sender, receiver):
            await _send_socket_json(socket, {"type": "error", "error": "Chits can only be sent within your committee"})
            return

        created_at = datetime.now(timezone.utc).isoformat()
        try:
            chit_id = await asyncio.to_thread(_save_chit, sender, receiver, body, created_at)
            payload = {
                "type": "chit",
                "id": chit_id,
                "sender": sender_id,
                "sender_name": sender["name"],
                "receiver": receiver_id,
                "message": body,
                "timestamp": created_at,
            }
            listeners = await socket.app.state.redis.publish(
                f"user:{receiver_id}", msgspec.json.encode(payload)
            )
            await asyncio.to_thread(
                _save_delivery_status, chit_id, listeners > 0, created_at
            )
        except (sqlite3.Error, RedisError):
            logger.exception("Failed to persist or publish chit from %s to %s", sender_id, receiver_id)
            await _send_socket_json(socket, {"type": "error", "error": "Chit could not be delivered"})
            return

        await _send_socket_json(
            socket,
            {
                "type": "delivery_ack",
                "id": chit_id,
                "receiver": receiver_id,
                "delivered": listeners > 0,
                "active_listeners": listeners,
                "timestamp": created_at,
            },
        )

    async def on_disconnect(self, socket: WebSocket) -> None:
        state = socket.scope["state"]
        task = state.pop("subscription_task", None)
        state.pop("subscription_ready", None)
        state.pop("delegate_id", None)
        state.pop("authenticated_delegate_id", None)
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


@post("/api/login")
async def login(data: LoginRequest, request: Request) -> Response[dict[str, str]]:
    code = data.access_code.strip().upper()
    user = request.app.state.users.get(code)
    if not user:
        raise NotAuthorizedException("Invalid access code")
    token = secrets.token_urlsafe(32)
    await request.app.state.redis.set(
        f"session:{token}", code, ex=SESSION_TTL_SECONDS
    )
    secure_cookie_setting = os.getenv("SESSION_COOKIE_SECURE")
    secure_cookie_enabled = (
        secure_cookie_setting.lower() in {"1", "true", "yes"}
        if secure_cookie_setting is not None
        else os.getenv("APP_ENV") == "production"
    )
    secure_cookie = "; Secure" if secure_cookie_enabled else ""
    return Response(
        content={"delegate_id": code, "name": user["name"], "committee": user["committee"]},
        headers={
            "set-cookie": (
                f"{COOKIE_NAME}={token}; HttpOnly; SameSite=Lax; Path=/; "
                f"Max-Age={SESSION_TTL_SECONDS}{secure_cookie}"
            )
        },
    )


@post("/api/logout")
async def logout(request: Request) -> Response[dict[str, str]]:
    token = request.cookies.get(COOKIE_NAME)
    if token:
        await request.app.state.redis.delete(f"session:{token}")
    return Response(
        content={"status": "logged_out"},
        headers={"set-cookie": f"{COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"},
    )


@get("/health")
async def health(request: Request) -> dict[str, str]:
    await request.app.state.redis.ping()
    return {"status": "ok"}


@get("/api/me")
async def me(request: Request) -> dict[str, str]:
    delegate_id = await _authenticate_request(request)
    user = request.app.state.users[delegate_id]
    return {
        "delegate_id": delegate_id,
        "name": user["name"],
        "committee": user["committee"],
        "country": user["country"],
        "role": user["role"],
    }


@get("/api/inbox")
async def inbox(request: Request) -> list[dict[str, Any]]:
    delegate_id = await _authenticate_request(request)
    return await asyncio.to_thread(_get_inbox, delegate_id)


@asynccontextmanager
async def lifespan(app: Litestar):
    users = await asyncio.to_thread(_load_users)
    await asyncio.to_thread(_initialize_database, users)
    redis = Redis.from_url(
        os.getenv("REDIS_URL", "redis://localhost:6379/0"),
        decode_responses=False,
        max_connections=int(os.getenv("REDIS_MAX_CONNECTIONS", "2048")),
        health_check_interval=30,
        socket_keepalive=True,
    )
    await redis.ping()
    app.state.users = {user["code"]: user for user in users}
    app.state.redis = redis
    try:
        yield
    finally:
        await redis.aclose()


app = Litestar(
    route_handlers=[login, logout, health, me, inbox, ChitWebSocketListener],
    lifespan=[lifespan],
)
