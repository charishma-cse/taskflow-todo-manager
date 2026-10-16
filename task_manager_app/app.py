from __future__ import annotations

import os
from contextlib import contextmanager
import sqlite3
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, render_template, request

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_DATABASE = BASE_DIR / "instance" / "tasks.db"

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False
app.config["DATABASE_PATH"] = os.environ.get("DATABASE_PATH", str(DEFAULT_DATABASE))
app.config["SEED_DEMO_DATA"] = os.environ.get("SEED_DEMO_DATA", "true").lower() in {"1", "true", "yes"}

VALID_PRIORITIES = {"low", "medium", "high"}
VALID_STATUSES = {"pending", "in_progress", "completed"}

@contextmanager
def get_db():
    db_path = Path(app.config["DATABASE_PATH"])
    db_path.parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(db_path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")

    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def init_db() -> None:
    with get_db() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL CHECK(length(trim(title)) > 0),
                description TEXT NOT NULL DEFAULT '',
                priority TEXT NOT NULL DEFAULT 'medium'
                    CHECK(priority IN ('low', 'medium', 'high')),
                status TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending', 'in_progress', 'completed')),
                deadline TEXT,
                created_by TEXT NOT NULL DEFAULT 'You',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
        )
        seeded = connection.execute(
            "SELECT value FROM app_meta WHERE key = 'demo_data_seeded'"
        ).fetchone()
        if app.config.get("SEED_DEMO_DATA", True) and seeded is None:
            today = date.today()
            now = datetime.now()
            demo_tasks = [
                ("Finish UI implementation", "Polish the task dashboard and verify all buttons.", "high", "in_progress", 2, 0),
                ("Review REST API endpoints", "Check GET, POST, PUT, PATCH, and DELETE responses.", "high", "completed", -2, 2),
                ("Prepare deployment checklist", "Confirm the app runs locally and the Render settings are ready.", "medium", "pending", 3, 1),
                ("Test mobile responsive layout", "Check the table and modals at phone and tablet widths.", "low", "pending", -1, 3),
            ]
            for title, description, priority, status, deadline_offset, created_days_ago in demo_tasks:
                # Keep deadlines relative to today's date so the sample list stays useful over time.
                created_at = (now.replace(microsecond=0) - timedelta(days=created_days_ago)).isoformat()
                connection.execute(
                    """INSERT INTO tasks (title, description, priority, status, deadline, created_by, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, 'You', ?, ?)""",
                    (title, description, priority, status, (today + timedelta(days=deadline_offset)).isoformat(), created_at, created_at),
                )
            connection.execute(
                "INSERT INTO app_meta (key, value) VALUES ('demo_data_seeded', '1')"
            )


def row_to_task(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    task = dict(row)
    task["overdue"] = bool(
        task.get("deadline")
        and task["status"] != "completed"
        and task["deadline"] < date.today().isoformat()
    )
    return task


def json_error(message: str, status_code: int = 400, **details: Any):
    payload: dict[str, Any] = {"error": message}
    if details:
        payload["details"] = details
    return jsonify(payload), status_code


def validate_task_payload(data: dict[str, Any], *, partial: bool = False) -> dict[str, Any] | None:
    """Validate incoming JSON and return field errors, if any."""
    errors: dict[str, str] = {}

    if not partial or "title" in data:
        title = data.get("title")
        if not isinstance(title, str) or not title.strip():
            errors["title"] = "Please enter a task title."
        elif len(title.strip()) > 180:
            errors["title"] = "Title must be 180 characters or fewer."

    if "description" in data and not isinstance(data["description"], str):
        errors["description"] = "Description must be text."

    if "priority" in data:
        priority = data["priority"]
        if not isinstance(priority, str) or priority.lower() not in VALID_PRIORITIES:
            errors["priority"] = "Priority must be Low, Medium, or High."

    if "status" in data:
        status = data["status"]
        if not isinstance(status, str) or status.lower() not in VALID_STATUSES:
            errors["status"] = "Status must be Pending, In progress, or Completed."

    if "deadline" in data:
        deadline = data["deadline"]
        if deadline in (None, ""):
            pass
        elif not isinstance(deadline, str):
            errors["deadline"] = "Deadline must be a date in YYYY-MM-DD format."
        else:
            try:
                datetime.strptime(deadline, "%Y-%m-%d")
            except ValueError:
                errors["deadline"] = "Deadline must be a valid date in YYYY-MM-DD format."

    return errors or None


@app.get("/")
def index():
    init_db()
    return render_template("index.html")


@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "application": "TaskFlow Task Manager"})


@app.get("/api/stats")
def stats():
    init_db()
    with get_db() as connection:
        rows = connection.execute("SELECT status, deadline FROM tasks").fetchall()
    today = date.today().isoformat()
    total = len(rows)
    completed = sum(row["status"] == "completed" for row in rows)
    pending = sum(row["status"] == "pending" for row in rows)
    in_progress = sum(row["status"] == "in_progress" for row in rows)
    overdue = sum(
        bool(row["deadline"] and row["deadline"] < today and row["status"] != "completed")
        for row in rows
    )
    return jsonify({
        "total": total,
        "pending": pending,
        "in_progress": in_progress,
        "completed": completed,
        "overdue": overdue,
    })


@app.route("/api/tasks", methods=["GET", "POST"])
def tasks_collection():
    init_db()

    if request.method == "GET":
        status = request.args.get("status", "").strip().lower()
        priority = request.args.get("priority", "").strip().lower()
        query = request.args.get("q", "").strip()
        deadline = request.args.get("deadline", "").strip()

        clauses: list[str] = []
        values: list[Any] = []
        if status and status != "all":
            if status not in VALID_STATUSES:
                return json_error("Unknown status filter.", 400, status="Use pending, in_progress, completed, or all.")
            clauses.append("status = ?")
            values.append(status)
        if priority and priority != "all":
            if priority not in VALID_PRIORITIES:
                return json_error("Unknown priority filter.", 400, priority="Use low, medium, high, or all.")
            clauses.append("priority = ?")
            values.append(priority)
        if query:
            clauses.append("(title LIKE ? OR description LIKE ?)")
            values.extend([f"%{query}%", f"%{query}%"])
        if deadline:
            try:
                datetime.strptime(deadline, "%Y-%m-%d")
            except ValueError:
                return json_error("Invalid deadline filter. Use YYYY-MM-DD.")
            clauses.append("deadline = ?")
            values.append(deadline)

        sql = "SELECT * FROM tasks"
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, " \
               "CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, " \
               "COALESCE(deadline, '9999-12-31'), id DESC"
        with get_db() as connection:
            rows = connection.execute(sql, values).fetchall()
        return jsonify({"tasks": [row_to_task(row) for row in rows], "count": len(rows)})

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return json_error("Request body must be a JSON object.")
    errors = validate_task_payload(data)
    if errors:
        return json_error("Please fix the highlighted fields.", 422, **errors)

    now = datetime.now().isoformat(timespec="seconds")
    title = data["title"].strip()
    description = data.get("description", "").strip()
    priority = data.get("priority", "medium").lower()
    status = data.get("status", "pending").lower()
    deadline = data.get("deadline") or None

    with get_db() as connection:
        cursor = connection.execute(
            """INSERT INTO tasks (title, description, priority, status, deadline, created_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (title, description, priority, status, deadline, "You", now, now),
        )
        row = connection.execute("SELECT * FROM tasks WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return jsonify({"message": "Task created successfully.", "task": row_to_task(row)}), 201


@app.route("/api/tasks/<int:task_id>", methods=["GET", "PUT", "PATCH", "DELETE"])
def task_item(task_id: int):
    init_db()
    with get_db() as connection:
        current = connection.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if current is None:
            return json_error("Task not found.", 404)

        if request.method == "GET":
            return jsonify({"task": row_to_task(current)})

        if request.method == "DELETE":
            connection.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
            return jsonify({"message": "Task deleted successfully.", "id": task_id})

        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return json_error("Request body must be a JSON object.")
        partial = request.method == "PATCH"
        errors = validate_task_payload(data, partial=partial)
        if errors:
            return json_error("Please fix the highlighted fields.", 422, **errors)
        if not data:
            return json_error("Provide at least one field to update.")

        existing = dict(current)
        updated = {
            "title": data.get("title", existing["title"]),
            "description": data.get("description", existing["description"]),
            "priority": data.get("priority", existing["priority"]),
            "status": data.get("status", existing["status"]),
            "deadline": data.get("deadline", existing["deadline"]),
        }
        updated["title"] = updated["title"].strip()
        updated["description"] = updated["description"].strip()
        updated["priority"] = updated["priority"].lower()
        updated["status"] = updated["status"].lower()
        updated["deadline"] = updated["deadline"] or None
        now = datetime.now().isoformat(timespec="seconds")
        connection.execute(
            """UPDATE tasks SET title = ?, description = ?, priority = ?, status = ?, deadline = ?, updated_at = ?
               WHERE id = ?""",
            (updated["title"], updated["description"], updated["priority"], updated["status"],
             updated["deadline"], now, task_id),
        )
        row = connection.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return jsonify({"message": "Task updated successfully.", "task": row_to_task(row)})


# Create the schema when the WSGI server imports the application.
init_db()

if __name__ == "__main__":
    app.run(debug=True)
