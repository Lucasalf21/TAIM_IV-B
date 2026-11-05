import csv
import io
import json
import random
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, Response, jsonify, render_template, request

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "study_results.db"
EPISODES_PATH = BASE_DIR.parent / "data" / "episodes.csv"
MEMBERS_PATH = BASE_DIR.parent / "data" / "episodes_members.csv"

app = Flask(__name__)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@app.template_filter("admin_datetime")
def admin_datetime(value):
    if not value:
        return ""
    try:
        return datetime.fromisoformat(value).strftime("%d-%m-%Y %H:%M:%S")
    except (TypeError, ValueError):
        return value


@app.template_filter("admin_number")
def admin_number(value):
    try:
        return f"{int(value):,}"
    except (TypeError, ValueError):
        return value


def fetch_episode_rows():
    rows = []
    with EPISODES_PATH.open(newline="") as csvfile:
        for row in csv.DictReader(csvfile):
            row["n_members"] = int(row["n_members"])
            row["p_ensemble"] = float(row["p_ensemble"])
            row["ens_median"] = float(row["ens_median"])
            row["threshold"] = float(row["threshold"])
            row["height"] = int(row["height"])
            row["window_h"] = int(row["window_h"])
            row["exceeded"] = int(row["exceeded"])
            row["normative"] = row["normative"]
            row["ambiguous"] = int(row["ambiguous"])
            rows.append(row)
    return rows


def fetch_member_series():
    grouped = {}
    with MEMBERS_PATH.open(newline="") as csvfile:
        for row in csv.DictReader(csvfile):
            ep = row["episode"]
            group = grouped.setdefault(ep, [])
            group.append(
                {
                    "member": int(row["member"]),
                    "step": int(row["step"]),
                    "time": row["time"],
                    "wind_speed_100m": float(row["wind_speed_100m"]),
                    "in_window": int(row["in_window"]),
                }
            )
    return grouped


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS participants (
            participant_code TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'in_progress',
            order_json TEXT NOT NULL,
            total_elapsed_ms INTEGER NOT NULL DEFAULT 0,
            total_cost INTEGER NOT NULL DEFAULT 0,
            perfect_cost INTEGER NOT NULL DEFAULT 0,
            correct_count INTEGER NOT NULL DEFAULT 0,
            completed_at TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS responses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            participant_code TEXT NOT NULL,
            episode_id TEXT NOT NULL,
            order_index INTEGER NOT NULL,
            started_at TEXT NOT NULL,
            submitted_at TEXT NOT NULL,
            elapsed_ms INTEGER NOT NULL,
            choice TEXT NOT NULL,
            correct INTEGER NOT NULL,
            actual_exceeded INTEGER NOT NULL,
            cost INTEGER NOT NULL,
            FOREIGN KEY(participant_code) REFERENCES participants(participant_code)
        )
        """
    )
    conn.commit()
    conn.close()


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def participant_order_for(code):
    conn = get_db()
    row = conn.execute(
        "SELECT order_json FROM participants WHERE participant_code = ?",
        (code,),
    ).fetchone()
    conn.close()
    if row is None:
        return None
    return json.loads(row["order_json"])


def compute_perfect_cost_for_episode(episode):
    return 5000 if int(episode["exceeded"]) == 1 else 0


def record_session_summary(participant_code):
    conn = get_db()
    order = participant_order_for(participant_code)
    if not order:
        conn.close()
        return

    row = conn.execute(
        """
        SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END), 0) AS correct_count,
               COALESCE(SUM(elapsed_ms), 0) AS elapsed_ms,
               COALESCE(SUM(cost), 0) AS total_cost
        FROM responses WHERE participant_code = ?
        """,
        (participant_code,),
    ).fetchone()

    perfect_cost = 0
    episode_map = {episode["episode"]: episode for episode in fetch_episode_rows()}
    for episode_id in order:
        perfect_cost += compute_perfect_cost_for_episode(episode_map[episode_id])

    total = row["total"] if row else 0
    correct_count = row["correct_count"] if row else 0
    total_elapsed = row["elapsed_ms"] if row else 0
    total_cost = row["total_cost"] if row else 0
    completed = total == len(order)

    conn.execute(
        """
        UPDATE participants
        SET status = ?,
            total_elapsed_ms = ?,
            total_cost = ?,
            perfect_cost = ?,
            correct_count = ?,
            completed_at = ?
        WHERE participant_code = ?
        """,
        (
            "completed" if completed else "in_progress",
            total_elapsed,
            total_cost,
            perfect_cost,
            correct_count,
            utc_now_iso() if completed else None,
            participant_code,
        ),
    )
    conn.commit()
    conn.close()


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/admin")
def admin_dashboard():
    conn = get_db()
    participants = conn.execute(
        """
        SELECT participant_code, created_at, status, total_elapsed_ms, total_cost, perfect_cost, correct_count
        FROM participants
        ORDER BY created_at DESC
        """
    ).fetchall()
    conn.close()
    return render_template("admin.html", participants=participants)


@app.route("/admin/participant/<participant_code>")
def admin_participant(participant_code):
    conn = get_db()
    participant = conn.execute(
        """
        SELECT participant_code, created_at, status, total_elapsed_ms, total_cost,
               perfect_cost, correct_count
        FROM participants
        WHERE participant_code = ?
        """,
        (participant_code,),
    ).fetchone()
    if participant is None:
        conn.close()
        return "Participant not found", 404

    responses = conn.execute(
        """
        SELECT episode_id, order_index, choice, correct, elapsed_ms, cost,
               actual_exceeded, started_at, submitted_at
        FROM responses
        WHERE participant_code = ?
        ORDER BY order_index ASC
        """,
        (participant_code,),
    ).fetchall()
    conn.close()
    return render_template(
        "admin_participant.html",
        participant=participant,
        responses=responses,
    )


@app.route("/admin/export.csv")
def export_csv():
    conn = get_db()
    rows = conn.execute(
        """
        SELECT p.participant_code, r.episode_id, r.order_index, r.started_at, r.submitted_at, r.elapsed_ms,
               r.choice, r.correct, r.actual_exceeded, r.cost,
               p.total_elapsed_ms, p.total_cost, p.perfect_cost, p.correct_count
        FROM responses r
        JOIN participants p ON p.participant_code = r.participant_code
        ORDER BY p.created_at ASC, r.order_index ASC
        """
    ).fetchall()
    conn.close()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "participant_code",
            "episode_id",
            "order_index",
            "started_at",
            "submitted_at",
            "elapsed_ms",
            "choice",
            "correct",
            "actual_exceeded",
            "cost",
            "session_total_elapsed_ms",
            "session_total_cost",
            "session_perfect_cost",
            "session_correct_count",
        ]
    )
    for row in rows:
        writer.writerow(row)

    data = output.getvalue()
    response = Response(data, mimetype="text/csv")
    response.headers["Content-Disposition"] = "attachment; filename=participant_results.csv"
    return response


@app.route("/api/episode-data")
def episode_data():
    episodes = fetch_episode_rows()
    member_series = fetch_member_series()
    data = {}
    for episode in episodes:
        episode_id = episode["episode"]
        series = member_series.get(episode_id, [])
        points = []
        for item in series:
            points.append(
                {
                    "member": item["member"],
                    "step": item["step"],
                    "time": item["time"],
                    "wind_speed_100m": item["wind_speed_100m"],
                    "in_window": item["in_window"],
                }
            )
        data[episode_id] = {
            "episode": episode_id,
            "window_start": episode["window_start"],
            "window_end": episode["window_end"],
            "threshold": episode["threshold"],
            "exceeded": episode["exceeded"],
            "p_ensemble": episode["p_ensemble"],
            "ens_median": episode["ens_median"],
            "points": points,
        }
    return jsonify(data)


@app.route("/api/session/new", methods=["POST"])
def new_session():
    init_db()
    episode_ids = [episode["episode"] for episode in fetch_episode_rows()]
    random.shuffle(episode_ids)
    participant_code = "P" + str(random.randint(100000, 999999))
    created_at = utc_now_iso()
    conn = get_db()
    conn.execute(
        "INSERT INTO participants (participant_code, created_at, status, order_json) VALUES (?, ?, 'in_progress', ?)",
        (participant_code, created_at, json.dumps(episode_ids)),
    )
    conn.commit()
    conn.close()
    return jsonify({"participant_code": participant_code, "order": episode_ids})


@app.route("/api/session/<participant_code>/summary")
def session_summary(participant_code):
    conn = get_db()
    participant = conn.execute(
        "SELECT * FROM participants WHERE participant_code = ?",
        (participant_code,),
    ).fetchone()
    if participant is None:
        conn.close()
        return jsonify({"error": "participant not found"}), 404

    rows = conn.execute(
        """
        SELECT r.episode_id, r.order_index, r.choice, r.correct, r.elapsed_ms, r.cost, r.actual_exceeded,
               r.submitted_at
        FROM responses r
        WHERE r.participant_code = ?
        ORDER BY r.order_index ASC
        """,
        (participant_code,),
    ).fetchall()
    conn.close()

    episode_map = {episode["episode"]: episode for episode in fetch_episode_rows()}
    perfect_cost = sum(compute_perfect_cost_for_episode(episode_map[r["episode_id"]]) for r in rows)
    total_cost = sum(r["cost"] for r in rows)
    total_elapsed_ms = sum(r["elapsed_ms"] for r in rows)
    correct_count = sum(1 for r in rows if r["correct"]) 

    return jsonify(
        {
            "participant_code": participant_code,
            "total_elapsed_ms": total_elapsed_ms,
            "total_cost": total_cost,
            "perfect_cost": perfect_cost,
            "correct_count": correct_count,
            "episode_count": len(rows),
            "episodes": [
                {
                    "episode_id": r["episode_id"],
                    "order_index": r["order_index"],
                    "choice": r["choice"],
                    "correct": bool(r["correct"]),
                    "elapsed_ms": r["elapsed_ms"],
                    "cost": r["cost"],
                    "actual_exceeded": bool(r["actual_exceeded"]),
                    "submitted_at": r["submitted_at"],
                }
                for r in rows
            ],
        }
    )


@app.route("/api/session/<participant_code>/decision", methods=["POST"]) 
def submit_decision(participant_code):
    payload = request.get_json(force=True)
    if not payload:
        return jsonify({"error": "missing decision payload"}), 400

    if payload.get("choice") not in {"send", "not_send"}:
        return jsonify({"error": "invalid decision"}), 400

    episode_id = payload.get("episode_id")
    if not episode_id:
        return jsonify({"error": "missing episode_id"}), 400

    episode_order = participant_order_for(participant_code)
    if episode_order is None:
        return jsonify({"error": "participant not found"}), 404
    if episode_id not in episode_order:
        return jsonify({"error": "episode not assigned to participant"}), 400

    episode = {episode["episode"]: episode for episode in fetch_episode_rows()}.get(episode_id)
    if episode is None:
        return jsonify({"error": "episode not found"}), 404

    actual_exceeded = int(episode["exceeded"])
    choice = payload["choice"]
    elapsed_ms = int(payload.get("elapsed_ms", 0))
    started_at = payload.get("started_at") or utc_now_iso()
    submitted_at = payload.get("submitted_at") or utc_now_iso()

    if choice == "send":
        cost = 0 if actual_exceeded == 0 else 40000
    else:
        cost = 5000

    correct = 1 if ((choice == "send" and actual_exceeded == 0) or (choice == "not_send" and actual_exceeded == 1)) else 0
    conn = get_db()
    existing = conn.execute(
        "SELECT id FROM responses WHERE participant_code = ? AND episode_id = ?",
        (participant_code, episode_id),
    ).fetchone()
    if existing is not None:
        conn.close()
        return jsonify({"status": "already recorded"})

    conn.execute(
        """
        INSERT INTO responses (participant_code, episode_id, order_index, started_at, submitted_at, elapsed_ms, choice, correct, actual_exceeded, cost)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            participant_code,
            episode_id,
            episode_order.index(episode_id),
            started_at,
            submitted_at,
            elapsed_ms,
            choice,
            correct,
            actual_exceeded,
            cost,
        ),
    )
    conn.commit()
    conn.close()
    record_session_summary(participant_code)
    return jsonify({"status": "saved", "correct": bool(correct), "cost": cost})


if __name__ == "__main__":
    init_db()
    app.run(host="127.0.0.1", port=5000, debug=True)
