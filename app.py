import csv
import os
import re
import sqlite3
import time

from flask import Flask, g, jsonify, render_template, request, session

app = Flask(__name__)
LOCAL_RUN = __name__ == "__main__"
DEBUG_MODE = os.environ.get("FLASK_DEBUG") == "1"
LOCAL_MODE = LOCAL_RUN or DEBUG_MODE
secret_key = os.environ.get("SECRET_KEY")
if not secret_key and not LOCAL_MODE:
    raise RuntimeError("Set SECRET_KEY before starting the application outside local debug mode")
app.secret_key = secret_key or "dev-only-change-me"
app.config.update(
    MAX_CONTENT_LENGTH=16 * 1024,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE") == "1",
)

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE, "echits.db"))
CODE_RE = re.compile(r"^(DEL|CHR|ADN)\d{5}$")
ROLES = {"DEL": "delegate", "CHR": "chair", "ADN": "admin"}
FAILS = {}  # ip -> list of failed login times


# ---------- database ----------
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db:
        db.close()


def find_users_file():
    candidates = (
        os.environ.get("USERS_FILE"),
        "/etc/secrets/users.csv",           # Render "Secret File" (your real list)
        os.path.join(BASE, "users.csv"),    # local real list (never uploaded to GitHub)
    )
    if LOCAL_MODE:
        candidates += (os.path.join(BASE, "users.sample.csv"),)
    for path in candidates:
        if path and os.path.exists(path):
            return path
    raise FileNotFoundError("No users.csv found. Set USERS_FILE or provide a users.csv file.")


def init_db():
    with open(find_users_file(), newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
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

    con = sqlite3.connect(DB_PATH)
    try:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS users(
                code TEXT PRIMARY KEY, name TEXT, role TEXT, committee TEXT, country TEXT);
            CREATE TABLE IF NOT EXISTS messages(
                id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT, recipient TEXT,
                committee TEXT, kind TEXT, subject TEXT, body TEXT,
                status TEXT, note TEXT, created INTEGER);
            """
        )
        con.execute("DELETE FROM users")
        con.executemany("INSERT OR REPLACE INTO users VALUES (?,?,?,?,?)", users)
        con.commit()
    finally:
        con.close()


init_db()


# ---------- helpers ----------
def current_user():
    code = session.get("code")
    if not code:
        return None
    return get_db().execute("SELECT * FROM users WHERE code=?", (code,)).fetchone()


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
    return [dict(r) for r in get_db().execute(sql, args).fetchall()]


def client_ip():
    return (request.headers.get("X-Forwarded-For") or request.remote_addr or "?").split(",")[0].strip()


# Never sends anyone's access code to the browser.
MSG_SQL = """
SELECT m.id, m.kind, m.subject, m.body, m.status, m.note, m.created, m.committee,
       s.name AS sname, s.role AS srole, s.country AS scountry,
       r.name AS rname, r.role AS rrole, r.country AS rcountry
FROM messages m
JOIN users s ON s.code = m.sender
LEFT JOIN users r ON r.code = m.recipient
"""


# ---------- pages ----------
@app.get("/")
def home():
    return render_template("index.html")


# ---------- auth ----------
@app.post("/api/login")
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
    u = get_db().execute("SELECT * FROM users WHERE code=?", (code,)).fetchone()
    if not u:
        FAILS[ip].append(now)
        return jsonify(error="Code not recognised. Check it and try again."), 401
    session.clear()
    session["code"] = code
    return jsonify(user_dict(u))


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.get("/api/me")
def me():
    u = current_user()
    return jsonify(user=user_dict(u) if u else None)


@app.get("/api/directory")
def directory():
    u, err = need_login()
    if err:
        return err
    if u["role"] == "admin":
        data = rows("SELECT rowid AS id, name, role, country, committee FROM users "
                    "WHERE code != ? ORDER BY committee, role, name", (u["code"],))
    else:
        data = rows("SELECT rowid AS id, name, role, country, committee FROM users "
                    "WHERE (committee=? OR role='admin') AND code != ? ORDER BY role, name",
                    (u["committee"], u["code"]))
    return jsonify(data)


# ---------- messaging ----------
@app.post("/api/send")
def send():
    u, err = need_login()
    if err:
        return err
    d = request.get_json(silent=True)
    if not isinstance(d, dict):
        return jsonify(error="Invalid message details"), 400
    kind = d.get("kind")
    subject = d.get("subject", "")
    body = d.get("body", "")
    if not isinstance(subject, str) or not isinstance(body, str):
        return jsonify(error="Subject and message must be text"), 400
    subject = subject.strip()[:120]
    body = body.strip()[:2000]
    if kind not in ("chit", "directive", "resolution"):
        return jsonify(error="Unknown message type"), 400
    if d.get("reply_to") is not None and kind != "chit":
        return jsonify(error="Only chits can be replied to"), 400
    if not subject or not body:
        return jsonify(error="Subject and message are both required"), 400

    db = get_db()
    if kind in ("directive", "resolution"):
        if u["role"] != "delegate":
            return jsonify(error="Only delegates submit directives/resolutions"), 403
        chair = db.execute("SELECT code FROM users WHERE role='chair' AND committee=?",
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
            original = db.execute(
                "SELECT sender FROM messages "
                "WHERE id=? AND recipient=? AND kind='chit' AND status IN ('delivered','approved')",
                (original_id, u["code"]),
            ).fetchone()
            if not original:
                return jsonify(error="That chit is no longer available to reply to"), 400
            target = db.execute("SELECT * FROM users WHERE code=?", (original["sender"],)).fetchone()
        else:
            try:
                to_id = int(d.get("to"))
            except (TypeError, ValueError):
                return jsonify(error="Pick a recipient"), 400
            target = db.execute("SELECT * FROM users WHERE rowid=?", (to_id,)).fetchone()
        if not target or target["code"] == u["code"]:
            return jsonify(error="Pick a valid recipient"), 400
        if u["role"] != "admin" and target["role"] != "admin" and target["committee"] != u["committee"]:
            return jsonify(error="You can only message people in your committee"), 403
        recipient = target["code"]
        committee = u["committee"] if u["role"] != "admin" else target["committee"]
        # delegate -> delegate chits need chair approval; everything else is instant
        status = "pending" if (u["role"] == "delegate" and target["role"] == "delegate") else "delivered"

    db.execute(
        "INSERT INTO messages(sender,recipient,committee,kind,subject,body,status,note,created) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        (u["code"], recipient, committee, kind, subject, body, status, "", int(time.time())),
    )
    db.commit()
    return jsonify(ok=True, status=status)


@app.get("/api/inbox")
def inbox():
    u, err = need_login()
    if err:
        return err
    received = rows(MSG_SQL + "WHERE m.recipient=? AND m.status IN ('delivered','approved') "
                    "ORDER BY m.id DESC", (u["code"],))
    sent = rows(MSG_SQL + "WHERE m.sender=? ORDER BY m.id DESC", (u["code"],))
    return jsonify(received=received, sent=sent)


@app.get("/api/queue")
def queue():
    u, err = need_login(("chair", "admin"))
    if err:
        return err
    if u["role"] == "admin":
        data = rows(MSG_SQL + "WHERE m.status='pending' ORDER BY m.id")
    else:
        data = rows(MSG_SQL + "WHERE m.status='pending' AND m.committee=? ORDER BY m.id",
                    (u["committee"],))
    return jsonify(data)


@app.post("/api/review")
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
    m = db.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone()
    if not m or m["status"] != "pending":
        return jsonify(error="That message is no longer pending"), 400
    if u["role"] == "chair" and m["committee"] != u["committee"]:
        return jsonify(error="Not your committee"), 403
    result = db.execute(
        "UPDATE messages SET status=?, note=? WHERE id=? AND status='pending'",
        ("approved" if action == "approve" else "rejected", note, mid),
    )
    if result.rowcount != 1:
        return jsonify(error="That message is no longer pending"), 400
    db.commit()
    return jsonify(ok=True)


if __name__ == "__main__":
    app.run(
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "5000")),
        debug=DEBUG_MODE,
    )