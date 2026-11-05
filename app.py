import csv
import io
import os
import re
import secrets
import sqlite3
import threading
import time
import zipfile
from urllib.parse import urlsplit

from fastapi import FastAPI
from fastapi.middleware.wsgi import WSGIMiddleware
from starlette.middleware.sessions import SessionMiddleware
from flask import Flask, g, jsonify, render_template, request, send_file, session
from werkzeug.exceptions import RequestEntityTooLarge

BASE = os.path.dirname(os.path.abspath(__file__))
IS_VERCEL = os.environ.get("VERCEL") == "1"
DATABASE_URL = os.environ.get("DATABASE_URL")
MAX_UPLOAD_BYTES = 3 * 1024 * 1024
flask_app = Flask(
    __name__,
    static_folder=None if IS_VERCEL else os.path.join(BASE, "public"),
    static_url_path="" if not IS_VERCEL else None,
)
LOCAL_RUN = __name__ == "__main__"
DEBUG_MODE = os.environ.get("FLASK_DEBUG") == "1"
LOCAL_MODE = LOCAL_RUN or DEBUG_MODE
secret_key = os.environ.get("SECRET_KEY")
if not secret_key and not LOCAL_MODE and not IS_VERCEL:
    raise RuntimeError("Set SECRET_KEY before starting the application outside local debug mode")
flask_app.secret_key = secret_key or (secrets.token_hex(32) if IS_VERCEL else "dev-only-change-me")
flask_app.config.update(
    MAX_CONTENT_LENGTH=MAX_UPLOAD_BYTES + 64 * 1024,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=IS_VERCEL or os.environ.get("SESSION_COOKIE_SECURE") == "1",
)

app = FastAPI(title="E-Chits")
app.add_middleware(SessionMiddleware, secret_key=secret_key or (secrets.token_hex(32) if IS_VERCEL else "dev-only-change-me"))
app.mount("/", WSGIMiddleware(flask_app))

DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE, "echits.db"))
CODE_RE = re.compile(r"^(DEL|CHR|ADN)\d{5}$")
ROLES = {"DEL": "delegate", "CHR": "chair", "ADN": "admin"}
FAILS = {}  # ip -> list of failed login times
DB_INITIALIZED = False
DB_INIT_LOCK = threading.Lock()
DB_POOL = None
DB_POOL_LOCK = threading.Lock()


class EChitsConfigurationError(Exception):
    pass


@flask_app.before_request
def require_echits_configuration():
    if not IS_VERCEL or not request.path.startswith("/api/"):
        return None
    missing = [
        name for name, value in (
            ("SECRET_KEY", secret_key),
            ("DATABASE_URL", DATABASE_URL),
            ("USERS_CSV", os.environ.get("USERS_CSV")),
        ) if not value
    ]
    if missing:
        flask_app.logger.error("Missing required Vercel environment variables: %s", ", ".join(missing))
        return jsonify(error="Service temporarily unavailable."), 503
    return None


@flask_app.errorhandler(EChitsConfigurationError)
def handle_echits_configuration_error(error):
    flask_app.logger.error("E-Chits configuration error: %s", error)
    return jsonify(error=str(error)), 503


@flask_app.errorhandler(RequestEntityTooLarge)
def handle_request_entity_too_large(_error):
    return jsonify(error="The uploaded document is too large (maximum 3 MB)."), 413


# ---------- database ----------
def connect_db():
    if DATABASE_URL:
        import psycopg
        from psycopg.rows import dict_row

        return psycopg.connect(DATABASE_URL, row_factory=dict_row)
    return sqlite3.connect(DB_PATH, timeout=30)


def get_db_pool():
    global DB_POOL
    if DB_POOL is None:
        with DB_POOL_LOCK:
            if DB_POOL is None:
                from psycopg_pool import ConnectionPool
                from psycopg.rows import dict_row

                try:
                    max_size = int(os.environ.get("DB_POOL_MAX_SIZE", "5"))
                except ValueError as error:
                    raise EChitsConfigurationError(
                        "DB_POOL_MAX_SIZE must be an integer between 1 and 20"
                    ) from error
                if not 1 <= max_size <= 20:
                    raise EChitsConfigurationError(
                        "DB_POOL_MAX_SIZE must be an integer between 1 and 20"
                    )
                DB_POOL = ConnectionPool(
                    conninfo=DATABASE_URL,
                    min_size=0,
                    max_size=max_size,
                    timeout=10,
                    max_idle=30,
                    max_lifetime=300,
                    kwargs={"row_factory": dict_row},
                    open=False,
                )
                DB_POOL.open()
    return DB_POOL


def db_execute(db, sql, args=()):
    if DATABASE_URL:
        sql = sql.replace("?", "%s")
    return db.execute(sql, args)


def db_executemany(db, sql, args):
    if DATABASE_URL:
        sql = sql.replace("?", "%s")
    return db.executemany(sql, args)


def get_db():
    if "db" not in g:
        init_db()
        if DATABASE_URL:
            g.db = get_db_pool().getconn()
        else:
            g.db = connect_db()
            g.db.row_factory = sqlite3.Row
    return g.db


@flask_app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db:
        if DATABASE_URL:
            get_db_pool().putconn(db)
        else:
            db.close()


def load_users():
    csv_contents = os.environ.get("USERS_CSV")
    if csv_contents is not None:
        reader = csv.DictReader(io.StringIO(csv_contents))
        return parse_users(reader)

    candidates = (
        os.environ.get("USERS_FILE"),
        "/etc/secrets/users.csv",           # Render "Secret File" (your real list)
        os.path.join(BASE, "users.csv"),    # local real list (never uploaded to GitHub)
    )
    if LOCAL_MODE:
        candidates += (os.path.join(BASE, "users.sample.csv"),)
    for path in candidates:
        if path and os.path.exists(path):
            with open(path, newline="", encoding="utf-8-sig") as f:
                return parse_users(csv.DictReader(f))
    raise FileNotFoundError("No users.csv or users.sample.csv found")


def parse_users(reader):
    required_columns = {"code", "name", "committee", "country"}
    if not reader.fieldnames or not required_columns.issubset(reader.fieldnames):
        raise ValueError("users.csv must contain code,name,committee,country columns")
    users = []
    for row in reader:
        code = re.sub(r"\s+", "", row.get("code") or "").upper()
        if not CODE_RE.match(code):
            continue
        users.append((
            code, (row.get("name") or "").strip(), ROLES[code[:3]],
            (row.get("committee") or "").strip().upper(),
            (row.get("country") or "").strip(),
        ))
    if not users:
        raise ValueError("users.csv does not contain any valid access codes")
    return users


def init_db():
    global DB_INITIALIZED
    if DB_INITIALIZED:
        return
    with DB_INIT_LOCK:
        if DB_INITIALIZED:
            return
        _init_db()
        DB_INITIALIZED = True


def _init_db():
    users = load_users()
    con = connect_db()
    if not DATABASE_URL:
        con.row_factory = sqlite3.Row
    try:
        if not DATABASE_URL:
            db_execute(con, "PRAGMA journal_mode=WAL")
            db_execute(con, "PRAGMA busy_timeout=30000")
        else:
            db_execute(con, "SELECT pg_advisory_xact_lock(27027)")
        if DATABASE_URL:
            db_execute(
                con,
                """
                CREATE TABLE IF NOT EXISTS users(
                    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                    code TEXT UNIQUE NOT NULL, name TEXT, role TEXT, committee TEXT, country TEXT
                )
                """,
            )
            db_execute(
                con,
                """
                CREATE TABLE IF NOT EXISTS messages(
                    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                    sender TEXT, recipient TEXT, committee TEXT, kind TEXT, subject TEXT, body TEXT,
                    status TEXT, note TEXT, created BIGINT, delivered_at BIGINT,
                    subtype TEXT NOT NULL DEFAULT 'other',
                    visibility TEXT NOT NULL DEFAULT 'private',
                    document_url TEXT,
                    attachment_name TEXT,
                    attachment_mime TEXT,
                    attachment_data BYTEA
                )
                """,
            )
            db_execute(
                con,
                """
                CREATE TABLE IF NOT EXISTS committee_speakers(
                    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                    committee TEXT NOT NULL, user_code TEXT NOT NULL, position INTEGER NOT NULL,
                    duration INTEGER NOT NULL DEFAULT 60,
                    UNIQUE(committee, user_code)
                )
                """,
            )
            db_execute(
                con,
                "ALTER TABLE committee_speakers ADD COLUMN IF NOT EXISTS "
                "duration INTEGER NOT NULL DEFAULT 60",
            )
            db_execute(
                con,
                """
                CREATE TABLE IF NOT EXISTS committee_timer(
                    committee TEXT PRIMARY KEY, user_code TEXT NOT NULL,
                    started_at BIGINT NOT NULL, duration INTEGER NOT NULL
                )
                """,
            )
            db_execute(
                con,
                """
                CREATE TABLE IF NOT EXISTS committee_session(
                    committee TEXT PRIMARY KEY, mode TEXT NOT NULL, duration INTEGER NOT NULL,
                    started_at BIGINT NOT NULL
                )
                """,
            )
            db_execute(
                con,
                """
                CREATE TABLE IF NOT EXISTS committee_general_timer(
                    committee TEXT PRIMARY KEY, duration INTEGER NOT NULL, started_at BIGINT NOT NULL,
                    remaining INTEGER NOT NULL, running BOOLEAN NOT NULL
                )
                """,
            )
            db_execute(
                con,
                """
                CREATE TABLE IF NOT EXISTS app_migrations(
                    migration TEXT PRIMARY KEY, applied_at BIGINT NOT NULL
                )
                """,
            )
            db_execute(con, "ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivered_at BIGINT")
            db_execute(
                con, "ALTER TABLE messages ADD COLUMN IF NOT EXISTS "
                "subtype TEXT NOT NULL DEFAULT 'other'"
            )
            db_execute(
                con, "ALTER TABLE messages ADD COLUMN IF NOT EXISTS "
                "visibility TEXT NOT NULL DEFAULT 'private'"
            )
            db_execute(con, "ALTER TABLE messages ADD COLUMN IF NOT EXISTS document_url TEXT")
            db_execute(con, "ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_name TEXT")
            db_execute(con, "ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_mime TEXT")
            db_execute(con, "ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_data BYTEA")
        else:
            con.executescript(
                """
            CREATE TABLE IF NOT EXISTS users(
                code TEXT PRIMARY KEY, name TEXT, role TEXT, committee TEXT, country TEXT);
            CREATE TABLE IF NOT EXISTS messages(
                id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT, recipient TEXT,
                committee TEXT, kind TEXT, subject TEXT, body TEXT,
                status TEXT, note TEXT, created INTEGER, delivered_at INTEGER,
                subtype TEXT NOT NULL DEFAULT 'other',
                visibility TEXT NOT NULL DEFAULT 'private',
                document_url TEXT,
                attachment_name TEXT,
                attachment_mime TEXT,
                attachment_data BLOB);
            CREATE TABLE IF NOT EXISTS committee_speakers(
                id INTEGER PRIMARY KEY AUTOINCREMENT, committee TEXT NOT NULL,
                user_code TEXT NOT NULL, position INTEGER NOT NULL, duration INTEGER NOT NULL DEFAULT 60,
                UNIQUE(committee, user_code));
            CREATE TABLE IF NOT EXISTS committee_timer(
                committee TEXT PRIMARY KEY, user_code TEXT NOT NULL,
                started_at INTEGER NOT NULL, duration INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS committee_session(
                committee TEXT PRIMARY KEY, mode TEXT NOT NULL, duration INTEGER NOT NULL,
                started_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS committee_general_timer(
                committee TEXT PRIMARY KEY, duration INTEGER NOT NULL, started_at INTEGER NOT NULL,
                remaining INTEGER NOT NULL, running INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS app_migrations(
                migration TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
            """
            )
            message_columns = {
                column["name"] for column in con.execute("PRAGMA table_info(messages)").fetchall()
            }
            if "delivered_at" not in message_columns:
                con.execute("ALTER TABLE messages ADD COLUMN delivered_at INTEGER")
            if "subtype" not in message_columns:
                con.execute(
                    "ALTER TABLE messages ADD COLUMN subtype TEXT NOT NULL DEFAULT 'other'"
                )
            if "visibility" not in message_columns:
                con.execute(
                    "ALTER TABLE messages ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'"
                )
            for column, column_type in (
                ("document_url", "TEXT"),
                ("attachment_name", "TEXT"),
                ("attachment_mime", "TEXT"),
                ("attachment_data", "BLOB"),
            ):
                if column not in message_columns:
                    con.execute(f"ALTER TABLE messages ADD COLUMN {column} {column_type}")
            speaker_columns = {
                column["name"] for column in con.execute("PRAGMA table_info(committee_speakers)").fetchall()
            }
            if "duration" not in speaker_columns:
                con.execute(
                    "ALTER TABLE committee_speakers ADD COLUMN duration INTEGER NOT NULL DEFAULT 60"
                )
        db_execute(con, "DROP TABLE IF EXISTS committee_vote_ballots")
        db_execute(con, "DROP TABLE IF EXISTS committee_votes")
        poi_history_migration = "delete_poi_chit_history_20261105"
        migration_applied = db_execute(
            con, "SELECT 1 FROM app_migrations WHERE migration=?", (poi_history_migration,)
        ).fetchone()
        if not migration_applied:
            db_execute(con, "DELETE FROM messages WHERE kind='chit' AND subtype='poi'")
            db_execute(
                con, "INSERT INTO app_migrations(migration,applied_at) VALUES(?,?)",
                (poi_history_migration, int(time.time())),
            )
        db_execute(con, "DROP INDEX IF EXISTS messages_chit_expiry")
        db_execute(
            con,
            "CREATE INDEX IF NOT EXISTS messages_chit_history_sender "
            "ON messages(committee,kind,sender)",
        )
        db_execute(
            con,
            "CREATE INDEX IF NOT EXISTS messages_chit_history_recipient "
            "ON messages(committee,kind,recipient)",
        )
        db_execute(
            con, "CREATE INDEX IF NOT EXISTS messages_sender_recent ON messages(sender,id)"
        )
        db_execute(
            con,
            "CREATE INDEX IF NOT EXISTS messages_recipient_recent "
            "ON messages(recipient,status,id)",
        )
        db_execute(
            con,
            "CREATE INDEX IF NOT EXISTS messages_public_directives "
            "ON messages(kind,visibility,status,id)",
        )
        db_execute(
            con,
            "UPDATE messages SET delivered_at=created WHERE kind='chit' "
            "AND status IN ('delivered','approved') AND delivered_at IS NULL",
        )
        incoming_codes = {user[0] for user in users}
        for existing in db_execute(con, "SELECT code FROM users").fetchall():
            if existing["code"] not in incoming_codes:
                db_execute(con, "DELETE FROM users WHERE code=?", (existing["code"],))
        db_executemany(
            con,
            "INSERT INTO users(code,name,role,committee,country) VALUES (?,?,?,?,?) "
            "ON CONFLICT(code) DO UPDATE SET name=excluded.name, role=excluded.role, "
            "committee=excluded.committee, country=excluded.country",
            users,
        )
        con.commit()
    finally:
        con.close()


# ---------- helpers ----------
def current_user():
    code = session.get("code")
    if not code:
        return None
    return db_execute(get_db(), "SELECT * FROM users WHERE code=?", (code,)).fetchone()


def need_login(roles=None):
    u = current_user()
    if not u:
        return None, (jsonify(error="Please log in first"), 401)
    if roles and u["role"] not in roles:
        return None, (jsonify(error="Not allowed"), 403)
    return u, None


def user_dict(u):
    return {k: u[k] for k in ("code", "name", "role", "committee", "country")}


def rows(sql, args=()):
    return [dict(r) for r in db_execute(get_db(), sql, args).fetchall()]


def client_ip():
    return (request.headers.get("X-Forwarded-For") or request.remote_addr or "?").split(",")[0].strip()


def validate_google_document_url(value):
    if not isinstance(value, str):
        raise ValueError("Enter a valid Google Docs or Drive URL")
    value = value.strip()
    if not value:
        return None
    if len(value) > 2048:
        raise ValueError("The Google Docs or Drive URL is too long")
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        raise ValueError("Enter a valid Google Docs or Drive URL") from None
    if (
        parsed.scheme != "https"
        or parsed.hostname not in ("docs.google.com", "drive.google.com")
        or parsed.username is not None
        or parsed.password is not None
        or port not in (None, 443)
    ):
        raise ValueError("Use an HTTPS Google Docs or Drive URL")
    return value


def parse_resolution_attachment(upload):
    if not upload or not upload.filename:
        return None

    filename = upload.filename.replace("\\", "/").rsplit("/", 1)[-1]
    filename = re.sub(r"[\x00-\x1f\x7f]", "", filename).strip()[:150]
    extension = os.path.splitext(filename)[1].lower()
    mime_types = {
        ".pdf": ("application/pdf", lambda data: data.startswith(b"%PDF-")),
        ".doc": ("application/msword", lambda data: data.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")),
        ".docx": (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            lambda data: _zip_has_entries(data, {"[Content_Types].xml", "word/document.xml"}),
        ),
        ".odt": (
            "application/vnd.oasis.opendocument.text",
            lambda data: _zip_has_entries(data, {"mimetype", "content.xml"}),
        ),
        ".txt": ("text/plain", _is_utf8_text),
    }
    if extension not in mime_types:
        raise ValueError("Attach a PDF, DOC, DOCX, ODT, or TXT document")

    data = upload.stream.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError("The uploaded document is too large (maximum 3 MB)")
    if not data:
        raise ValueError("The uploaded document is empty")
    mime_type, content_check = mime_types[extension]
    if not content_check(data):
        raise ValueError("The uploaded file does not match its document type")
    return filename, mime_type, data


def _zip_has_entries(data, required):
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            return required.issubset(archive.namelist())
    except (OSError, zipfile.BadZipFile):
        return False


def _is_utf8_text(data):
    try:
        data.decode("utf-8-sig")
        return True
    except UnicodeDecodeError:
        return False


# Never sends anyone's access code to the browser.
MSG_SQL = """
SELECT m.id, m.kind, m.subject, m.body, m.status, m.note, m.created, m.committee,
       m.subtype, m.visibility, m.document_url, m.attachment_name,
       s.name AS sname, s.role AS srole, s.country AS scountry,
       r.name AS rname, r.role AS rrole, r.country AS rcountry
FROM messages m
JOIN users s ON s.code = m.sender
LEFT JOIN users r ON r.code = m.recipient
"""


# ---------- pages ----------
@flask_app.get("/")
def home():
    return render_template("index.html")


# ---------- auth ----------
@flask_app.post("/api/login")
def login():
    ip = client_ip()
    now = time.time()
    FAILS[ip] = [t for t in FAILS.get(ip, []) if now - t < 600]
    if len(FAILS[ip]) >= 10:
        return jsonify(error="Too many wrong attempts. Wait 10 minutes."), 429

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(error="Enter a valid access code"), 400
    raw = data.get("code", "")
    if not isinstance(raw, str):
        return jsonify(error="Enter a valid access code"), 400
    code = re.sub(r"\s+", "", raw).upper()
    u = db_execute(get_db(), "SELECT * FROM users WHERE code=?", (code,)).fetchone()
    if not u:
        FAILS[ip].append(now)
        return jsonify(error="Code not recognised. Check it and try again."), 401
    session.clear()
    session["code"] = code
    return jsonify(user_dict(u))


@flask_app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@flask_app.get("/api/me")
def me():
    u = current_user()
    return jsonify(user=user_dict(u) if u else None)


@flask_app.get("/api/directory")
def directory():
    u, err = need_login()
    if err:
        return err
    user_id = "id" if DATABASE_URL else "rowid"
    if u["role"] == "admin":
        data = rows(f"SELECT {user_id} AS id, name, role, country, committee FROM users "
                    "WHERE code != ? ORDER BY committee, role, name", (u["code"],))
    elif u["role"] == "delegate":
        data = rows(f"SELECT {user_id} AS id, name, role, country, committee FROM users "
                    "WHERE committee=? AND code != ? ORDER BY role, name",
                    (u["committee"], u["code"]))
    else:
        data = rows(f"SELECT {user_id} AS id, name, role, country, committee FROM users "
                    "WHERE (committee=? OR role='admin') AND code != ? ORDER BY role, name",
                    (u["committee"], u["code"]))
    return jsonify(data)


@flask_app.get("/api/speakers")
def speakers():
    db = get_db()
    user_id = "id" if DATABASE_URL else "rowid"
    committees = [row["committee"] for row in db_execute(
        db, "SELECT DISTINCT committee FROM users WHERE role='delegate' AND committee<>'' "
            "ORDER BY committee"
    ).fetchall()]
    committee = (request.args.get("committee") or "").strip().upper()
    user = current_user()
    if user and user["role"] == "chair":
        if committee and committee != user["committee"]:
            return jsonify(error="Chairs may only view their own committee's list"), 403
        committee = user["committee"]
    if not committee and committees:
        committee = committees[0]
    if committee not in committees:
        return jsonify(error="Unknown committee"), 400

    queue = rows(
        "SELECT s.id, s.position, s.duration, u.name, u.country FROM committee_speakers s "
        "JOIN users u ON u.code=s.user_code "
        "WHERE s.committee=? ORDER BY s.position, s.id",
        (committee,),
    )
    can_edit = bool(user and user["role"] in ("chair", "admin"))
    eligible = rows(
        f"SELECT u.{user_id} AS id, u.name, u.country FROM users u "
        "WHERE u.role='delegate' AND u.committee=? AND NOT EXISTS ("
        "SELECT 1 FROM committee_speakers s WHERE s.committee=u.committee "
        "AND s.user_code=u.code) ORDER BY u.name",
        (committee,),
    ) if can_edit else []
    timer = db_execute(
        db,
        "SELECT t.user_code, u.name, t.started_at, t.duration FROM committee_timer t "
        "JOIN users u ON u.code=t.user_code WHERE t.committee=?",
        (committee,),
    ).fetchone()
    timer_data = None
    if timer:
        remaining = max(0, timer["duration"] - (time.time() - timer["started_at"]))
        timer_data = {
            "speaker": timer["name"], "started_at": timer["started_at"],
            "duration": timer["duration"], "remaining": remaining,
        }
    active_session = db_execute(
        db, "SELECT mode, duration, started_at FROM committee_session WHERE committee=?",
        (committee,),
    ).fetchone()
    session_data = dict(active_session) if active_session else None
    general_timer = db_execute(
        db, "SELECT duration, started_at, remaining, running "
            "FROM committee_general_timer WHERE committee=?",
        (committee,),
    ).fetchone()
    general_timer_data = None
    if general_timer:
        running = bool(general_timer["running"])
        remaining = max(
            0,
            general_timer["duration"] - (time.time() - general_timer["started_at"])
        ) if running else general_timer["remaining"]
        general_timer_data = {
            "duration": general_timer["duration"],
            "started_at": general_timer["started_at"],
            "remaining": remaining,
            "running": running and remaining > 0,
        }
    return jsonify(
        committee=committee, committees=committees, queue=queue, eligible=eligible,
        timer=timer_data, session=session_data, server_now=time.time(),
        general_timer=general_timer_data,
        user=user_dict(user) if user else None,
    )


@flask_app.post("/api/speakers")
def edit_speakers():
    user, err = need_login(("chair", "admin"))
    if err:
        return err
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(error="Invalid speaking-list details"), 400
    action = data.get("action")
    committee = data.get("committee", "")
    if not isinstance(committee, str):
        return jsonify(error="Choose a committee"), 400
    committee = committee.strip().upper()
    db = get_db()
    exists = db_execute(
        db, "SELECT 1 FROM users WHERE role='delegate' AND committee=? LIMIT 1", (committee,)
    ).fetchone()
    if not exists:
        return jsonify(error="Unknown committee"), 400
    if user["role"] == "chair" and committee != user["committee"]:
        return jsonify(error="Chairs may only edit their own committee's list"), 403

    if action == "add":
        try:
            delegate_id = int(data.get("delegate_id"))
        except (TypeError, ValueError):
            return jsonify(error="Choose a delegate"), 400
        user_id = "id" if DATABASE_URL else "rowid"
        delegate = db_execute(
            db, f"SELECT code FROM users WHERE {user_id}=? AND role='delegate' AND committee=?",
            (delegate_id, committee),
        ).fetchone()
        if not delegate:
            return jsonify(error="That delegate is not in this committee"), 400
        already_listed = db_execute(
            db, "SELECT 1 FROM committee_speakers WHERE committee=? AND user_code=?",
            (committee, delegate["code"]),
        ).fetchone()
        if already_listed:
            return jsonify(error="That delegate is already on the speaking list"), 409
        position = db_execute(
            db, "SELECT COALESCE(MAX(position),0)+1 AS next_position "
                "FROM committee_speakers WHERE committee=?", (committee,),
        ).fetchone()["next_position"]
        session_duration = db_execute(
            db, "SELECT duration FROM committee_session WHERE committee=?", (committee,)
        ).fetchone()
        duration = session_duration["duration"] if session_duration else 60
        added = db_execute(
            db, "INSERT INTO committee_speakers(committee,user_code,position,duration) "
                "VALUES(?,?,?,?) "
                "ON CONFLICT(committee,user_code) DO NOTHING",
            (committee, delegate["code"], position, duration),
        )
        if added.rowcount != 1:
            return jsonify(error="That delegate is already on the speaking list"), 409
    elif action in ("remove", "move"):
        try:
            speaker_id = int(data.get("speaker_id"))
        except (TypeError, ValueError):
            return jsonify(error="Invalid speaker"), 400
        ordered = db_execute(
            db, "SELECT id FROM committee_speakers WHERE committee=? ORDER BY position,id",
            (committee,),
        ).fetchall()
        ids = [row["id"] for row in ordered]
        if speaker_id not in ids:
            return jsonify(error="Speaker is not on this committee's list"), 404
        if action == "remove":
            db_execute(db, "DELETE FROM committee_speakers WHERE id=? AND committee=?",
                       (speaker_id, committee))
            ids.remove(speaker_id)
        else:
            direction = data.get("direction")
            index = ids.index(speaker_id)
            other = index - 1 if direction == "up" else index + 1 if direction == "down" else index
            if other == index:
                return jsonify(error="Choose up or down"), 400
            if 0 <= other < len(ids):
                ids[index], ids[other] = ids[other], ids[index]
        for position, row_id in enumerate(ids, 1):
            db_execute(
                db, "UPDATE committee_speakers SET position=? WHERE id=? AND committee=?",
                (position, row_id, committee),
            )
    else:
        return jsonify(error="Unknown speaking-list action"), 400
    db.commit()
    return jsonify(ok=True)


@flask_app.post("/api/speakers/timer")
def start_speaker_timer():
    user, err = need_login(("chair",))
    if err:
        return err
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(error="Invalid timer details"), 400
    try:
        speaker_id = int(data.get("speaker_id"))
    except (TypeError, ValueError):
        return jsonify(error="Choose a speaker"), 400
    db = get_db()
    speaker = db_execute(
        db, "SELECT s.user_code, s.duration FROM committee_speakers s "
            "JOIN users u ON u.code=s.user_code "
            "WHERE s.id=? AND s.committee=? AND u.role='delegate'",
        (speaker_id, user["committee"]),
    ).fetchone()
    if not speaker:
        return jsonify(error="That speaker is not on your committee's list"), 403
    active_session = db_execute(
        db, "SELECT duration FROM committee_session WHERE committee=?", (user["committee"],)
    ).fetchone()
    if not active_session:
        return jsonify(error="Start a speaking format before starting a speaker timer"), 409
    duration = active_session["duration"]
    db_execute(
        db,
        "INSERT INTO committee_timer(committee,user_code,started_at,duration) "
        "VALUES(?,?,?,?) ON CONFLICT(committee) DO UPDATE SET "
        "user_code=excluded.user_code, started_at=excluded.started_at, duration=excluded.duration",
        (user["committee"], speaker["user_code"], int(time.time()), duration),
    )
    db.commit()
    return jsonify(ok=True)


@flask_app.post("/api/speakers/session")
def update_speaker_session():
    user, err = need_login(("chair",))
    if err:
        return err
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(error="Invalid speaking-session details"), 400
    mode = data.get("mode")
    db = get_db()
    if mode == "end":
        db_execute(db, "DELETE FROM committee_session WHERE committee=?", (user["committee"],))
        db_execute(db, "DELETE FROM committee_timer WHERE committee=?", (user["committee"],))
        db.commit()
        return jsonify(ok=True)
    if mode not in ("gsl", "moderated_caucus", "round_table"):
        return jsonify(error="Choose GSL, moderated caucus, or round table"), 400
    try:
        duration = int(data.get("duration"))
    except (TypeError, ValueError):
        return jsonify(error="Choose a valid common speaking time"), 400
    if not 1 <= duration <= 3600:
        return jsonify(error="Common speaking time must be between 1 second and 60 minutes"), 400
    db_execute(
        db,
        "INSERT INTO committee_session(committee,mode,duration,started_at) VALUES(?,?,?,?) "
        "ON CONFLICT(committee) DO UPDATE SET mode=excluded.mode, "
        "duration=excluded.duration, started_at=excluded.started_at",
        (user["committee"], mode, duration, int(time.time())),
    )
    db_execute(
        db, "UPDATE committee_speakers SET duration=? WHERE committee=?",
        (duration, user["committee"]),
    )
    db_execute(db, "DELETE FROM committee_timer WHERE committee=?", (user["committee"],))
    db.commit()
    return jsonify(ok=True)


@flask_app.post("/api/speakers/general-timer")
def update_general_timer():
    user, err = need_login(("chair",))
    if err:
        return err
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(error="Invalid timer details"), 400
    action = data.get("action")
    db = get_db()
    committee = user["committee"]

    if action == "reset":
        db_execute(db, "DELETE FROM committee_general_timer WHERE committee=?", (committee,))
        db.commit()
        return jsonify(ok=True)

    timer = db_execute(
        db, "SELECT duration, started_at, remaining, running "
            "FROM committee_general_timer WHERE committee=?",
        (committee,),
    ).fetchone()
    if action == "start":
        try:
            duration = int(data.get("duration"))
        except (TypeError, ValueError):
            return jsonify(error="Choose a valid timer duration"), 400
        if not 1 <= duration <= 3600:
            return jsonify(error="Timer duration must be between 1 second and 60 minutes"), 400
        db_execute(
            db,
            "INSERT INTO committee_general_timer(committee,duration,started_at,remaining,running) "
            "VALUES(?,?,?,?,?) ON CONFLICT(committee) DO UPDATE SET "
            "duration=excluded.duration, started_at=excluded.started_at, "
            "remaining=excluded.remaining, running=excluded.running",
            (committee, duration, int(time.time()), duration, True if DATABASE_URL else 1),
        )
    elif action == "pause":
        if not timer or not timer["running"]:
            return jsonify(error="No running general timer to pause"), 409
        remaining = max(0, timer["duration"] - (int(time.time()) - timer["started_at"]))
        db_execute(
            db, "UPDATE committee_general_timer SET duration=?, remaining=?, running=? "
                "WHERE committee=?",
            (remaining, remaining, False if DATABASE_URL else 0, committee),
        )
    elif action == "resume":
        if not timer or timer["running"] or timer["remaining"] <= 0:
            return jsonify(error="No paused general timer to resume"), 409
        db_execute(
            db, "UPDATE committee_general_timer SET duration=remaining, started_at=?, running=? "
                "WHERE committee=?",
            (int(time.time()), True if DATABASE_URL else 1, committee),
        )
    else:
        return jsonify(error="Choose start, pause, resume, or reset"), 400
    db.commit()
    return jsonify(ok=True)


# ---------- messaging ----------
@flask_app.post("/api/send")
def send():
    u, err = need_login()
    if err:
        return err
    is_multipart = request.mimetype == "multipart/form-data"
    d = request.form if is_multipart else request.get_json(silent=True)
    if d is None or (not is_multipart and not isinstance(d, dict)):
        return jsonify(error="Invalid message details"), 400
    kind = d.get("kind")
    subtype = d.get("subtype", "other")
    visibility = d.get("visibility", "private")
    subject = d.get("subject", "")
    body = d.get("body", "")
    if not isinstance(subject, str) or not isinstance(body, str):
        return jsonify(error="Subject and message must be text"), 400
    subject = subject.strip()[:120]
    body = body.strip()[:2000]
    if kind not in ("chit", "directive", "resolution"):
        return jsonify(error="Unknown message type"), 400
    if kind == "chit" and subtype not in ("poi", "other"):
        return jsonify(error="Choose POI or Other for the chit type"), 400
    if kind == "directive" and visibility not in ("private", "public"):
        return jsonify(error="Choose private or public directive visibility"), 400
    document_url = None
    attachment = None
    if kind == "resolution":
        try:
            document_url = validate_google_document_url(d.get("doc_url", ""))
            attachment = parse_resolution_attachment(request.files.get("document"))
        except ValueError as error:
            return jsonify(error=str(error)), 400
        if document_url and attachment:
            return jsonify(error="Use a Google Docs/Drive URL or upload a document, not both"), 400
    elif d.get("doc_url") or (is_multipart and request.files.get("document")):
        return jsonify(error="Attachments are only supported for resolutions"), 400
    if d.get("reply_to") is not None and kind != "chit":
        return jsonify(error="Only chits can be replied to"), 400
    if not subject or not body:
        return jsonify(error="Subject and message are both required"), 400

    db = get_db()
    if kind in ("directive", "resolution"):
        if u["role"] != "delegate":
            return jsonify(error="Only delegates submit directives/resolutions"), 403
        chair = db_execute(db, "SELECT code FROM users WHERE role='chair' AND committee=?",
                           (u["committee"],)).fetchone()
        if not chair:
            return jsonify(error="No chair is assigned to your committee yet"), 400
        recipient, status, committee = chair["code"], "pending", u["committee"]
    else:
        reply_to = d.get("reply_to")
        if reply_to is not None:
            try:
                original_id = int(reply_to)
            except (TypeError, ValueError):
                return jsonify(error="That chit cannot be replied to"), 400
            original = db_execute(db,
                "SELECT sender FROM messages "
                "WHERE id=? AND recipient=? AND kind='chit' AND status IN ('delivered','approved')",
                (original_id, u["code"]),
            ).fetchone()
            if not original:
                return jsonify(error="That chit is no longer available to reply to"), 400
            target = db_execute(db, "SELECT * FROM users WHERE code=?", (original["sender"],)).fetchone()
        else:
            try:
                to_id = int(d.get("to"))
            except (TypeError, ValueError):
                return jsonify(error="Pick a recipient"), 400
            user_id = "id" if DATABASE_URL else "rowid"
            target = db_execute(
                db, f"SELECT {user_id} AS id, * FROM users WHERE {user_id}=?", (to_id,)
            ).fetchone()
        if not target or target["code"] == u["code"]:
            return jsonify(error="Pick a valid recipient"), 400
        if u["role"] == "delegate" and target["committee"] != u["committee"]:
            return jsonify(error="Delegates can only send chits within their committee"), 403
        if u["role"] != "admin" and target["role"] != "admin" and target["committee"] != u["committee"]:
            return jsonify(error="You can only message people in your committee"), 403
        recipient = target["code"]
        committee = u["committee"] if u["role"] != "admin" else target["committee"]
        # delegate -> delegate chits need chair approval; everything else is instant
        status = "pending" if (u["role"] == "delegate" and target["role"] == "delegate") else "delivered"

    db_execute(
        db,
        "INSERT INTO messages(sender,recipient,committee,kind,subject,body,status,note,created,"
        "delivered_at,subtype,visibility,document_url,attachment_name,attachment_mime,"
        "attachment_data) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            u["code"], recipient, committee, kind, subject, body, status, "",
            int(time.time()), int(time.time()) if kind == "chit" and status == "delivered" else None,
            subtype if kind == "chit" else "other",
            visibility if kind == "directive" else "private",
            document_url,
            attachment[0] if attachment else None,
            attachment[1] if attachment else None,
            attachment[2] if attachment else None,
        ),
    )
    db.commit()
    return jsonify(ok=True, status=status)


@flask_app.get("/api/messages/<int:message_id>/attachment")
def download_message_attachment(message_id):
    user, err = need_login()
    if err:
        return err
    message = db_execute(
        get_db(),
        "SELECT id, sender, recipient, committee, kind, status, visibility, "
        "attachment_name, attachment_mime, attachment_data "
        "FROM messages WHERE id=?",
        (message_id,),
    ).fetchone()
    if not message or not message["attachment_data"]:
        return jsonify(error="Attachment not found"), 404

    is_sender = message["sender"] == user["code"]
    is_recipient = (
        message["recipient"] == user["code"]
        and message["status"] in ("delivered", "approved")
    )
    is_chair_reviewing = (
        user["role"] == "chair"
        and user["committee"] == message["committee"]
        and message["status"] == "pending"
    )
    is_admin_reviewing = (
        user["role"] == "admin"
        and message["status"] == "pending"
        and not (message["kind"] == "directive" and message["visibility"] == "private")
    )
    if not (is_sender or is_recipient or is_chair_reviewing or is_admin_reviewing):
        return jsonify(error="Attachment not found"), 404

    response = send_file(
        io.BytesIO(bytes(message["attachment_data"])),
        mimetype=message["attachment_mime"],
        as_attachment=True,
        download_name=message["attachment_name"],
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@flask_app.get("/api/inbox")
def inbox():
    u, err = need_login()
    if err:
        return err
    received = rows(MSG_SQL + "WHERE (m.recipient=? AND m.status IN ('delivered','approved')) "
                    "OR (m.kind='directive' AND m.visibility='public' AND m.status='approved') "
                    "ORDER BY m.id DESC", (u["code"],))
    sent = rows(MSG_SQL + "WHERE m.sender=? ORDER BY m.id DESC", (u["code"],))
    if u["role"] == "admin":
        pending = rows(
            MSG_SQL + "WHERE m.status='pending' "
            "AND NOT (m.kind='directive' AND m.visibility='private') ORDER BY m.id"
        )
    elif u["role"] == "chair":
        pending = rows(
            MSG_SQL + "WHERE m.status='pending' AND m.committee=? ORDER BY m.id",
            (u["committee"],),
        )
    else:
        pending = []
    return jsonify(received=received, sent=sent, queue=pending)


@flask_app.get("/api/chit-history")
def chit_history():
    chair, err = need_login(("chair",))
    if err:
        return err
    db = get_db()
    user_id = "id" if DATABASE_URL else "rowid"
    delegates = rows(
        f"SELECT {user_id} AS id, name, country FROM users "
        "WHERE role='delegate' AND committee=? ORDER BY name",
        (chair["committee"],),
    )
    selected_id = request.args.get("delegate_id", "").strip()
    if not selected_id:
        return jsonify(delegates=delegates, messages=[])
    try:
        selected_id = int(selected_id)
    except (TypeError, ValueError):
        return jsonify(error="Choose a delegate from your committee"), 400
    delegate = db_execute(
        db,
        f"SELECT code FROM users WHERE {user_id}=? AND role='delegate' AND committee=?",
        (selected_id, chair["committee"]),
    ).fetchone()
    if not delegate:
        return jsonify(error="That delegate is not in your committee"), 404
    messages = rows(
        MSG_SQL + "WHERE m.committee=? AND m.kind='chit' "
        "AND (m.sender=? OR m.recipient=?) ORDER BY m.id DESC",
        (chair["committee"], delegate["code"], delegate["code"]),
    )
    return jsonify(delegates=delegates, messages=messages)


@flask_app.get("/api/queue")
def queue():
    u, err = need_login(("chair", "admin"))
    if err:
        return err
    if u["role"] == "admin":
        data = rows(
            MSG_SQL + "WHERE m.status='pending' "
            "AND NOT (m.kind='directive' AND m.visibility='private') ORDER BY m.id"
        )
    else:
        data = rows(MSG_SQL + "WHERE m.status='pending' AND m.committee=? ORDER BY m.id",
                    (u["committee"],))
    return jsonify(data)


@flask_app.post("/api/review")
def review():
    u, err = need_login(("chair", "admin"))
    if err:
        return err
    d = request.get_json(silent=True)
    if not isinstance(d, dict):
        return jsonify(error="Invalid review details"), 400
    action = d.get("action")
    note = d.get("note", "")
    if not isinstance(note, str):
        return jsonify(error="Chair note must be text"), 400
    note = note.strip()[:300]
    try:
        mid = int(d.get("id"))
    except (TypeError, ValueError):
        return jsonify(error="Bad message id"), 400
    if action not in ("approve", "reject"):
        return jsonify(error="Unknown action"), 400

    db = get_db()
    m = db_execute(db, "SELECT * FROM messages WHERE id=?", (mid,)).fetchone()
    if not m or m["status"] != "pending":
        return jsonify(error="That message is no longer pending"), 400
    if u["role"] == "admin" and m["kind"] == "directive" and m["visibility"] == "private":
        return jsonify(error="Private directives can only be reviewed by the committee chair"), 403
    if u["role"] == "chair" and m["committee"] != u["committee"]:
        return jsonify(error="Not your committee"), 403
    result = db_execute(
        db,
        "UPDATE messages SET status=?, note=?, delivered_at=CASE "
        "WHEN ?='approved' AND kind='chit' THEN ? ELSE delivered_at END "
        "WHERE id=? AND status='pending'",
        (
            "approved" if action == "approve" else "rejected", note,
            "approved" if action == "approve" else "rejected", int(time.time()), mid,
        ),
    )
    if result.rowcount != 1:
        return jsonify(error="That message is no longer pending"), 400
    db.commit()
    return jsonify(ok=True)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "5000")), log_level="info")