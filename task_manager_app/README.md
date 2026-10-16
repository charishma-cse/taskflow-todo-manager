# TaskFlow — To-Do Task Manager

A responsive, full-stack To-Do Task Manager built with **HTML, CSS, JavaScript, Flask, REST APIs, and SQLite**. The interface is inspired by the trainee's reference design, with a light lilac sidebar, warm-white workspace, lavender action accents, pastel priority/status pills, and a clean task table.

## Features

- Create, view, edit, and delete tasks
- Task title validation; optional description and deadline
- Low / Medium / High priority
- Pending / In progress / Completed statuses
- Search title and description
- Filter by status, priority, and deadline
- Overdue labels and task summary counts
- Pagination and responsive mobile layout
- Fixed desktop sidebar: the logo and all navigation icons stay in place while only the main content pane scrolls
- Light and dark themes
- SQLite storage
- REST API with GET, POST, PUT, PATCH, and DELETE
- API smoke tests

## Run locally (Windows / VS Code)

1. Install Python 3.11 or newer from [python.org](https://www.python.org/downloads/). During installation, select **Add Python to PATH**.
2. Extract this folder and open it in VS Code.
3. Open **Terminal → New Terminal** in VS Code and run:

   ```powershell
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install -r requirements.txt
   python app.py
   ```

   If PowerShell blocks activation, use `py -m pip install -r requirements.txt` and then `py app.py`, or allow activation for the current terminal session.
4. Open `http://127.0.0.1:5000` in your browser.

The SQLite database is created automatically at `instance/tasks.db`. On first startup, four editable sample tasks are added so the dashboard looks populated for a demo; they are only seeded once per database. Delete or edit them freely. The database file is intentionally ignored by Git; it contains local task records, not the source code.

## API endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Check that the backend is running |
| `GET` | `/api/stats` | Get total, pending, in-progress, completed, and overdue counts |
| `GET` | `/api/tasks` | List all tasks |
| `GET` | `/api/tasks?status=pending` | Filter tasks by status |
| `GET` | `/api/tasks?q=demo` | Search title/description |
| `GET` | `/api/tasks?priority=high` | Filter by priority |
| `GET` | `/api/tasks?deadline=2026-10-31` | Filter by deadline |
| `GET` | `/api/tasks/1` | Get one task |
| `POST` | `/api/tasks` | Create a task |
| `PUT` | `/api/tasks/1` | Update task fields |
| `PATCH` | `/api/tasks/1` | Partially update a task, for example its status |
| `DELETE` | `/api/tasks/1` | Delete a task |

Example JSON body for `POST /api/tasks`:

```json
{
  "title": "Prepare project demo",
  "description": "Finish the slides and test the app",
  "deadline": "2026-10-25",
  "priority": "high",
  "status": "pending"
}
```

A successful create returns HTTP `201`. Invalid or empty titles return HTTP `422` with a field-level error. Missing task IDs return HTTP `404`.

## API smoke tests

Run:

```powershell
python test_api.py
```

The tests use a temporary SQLite database and cover create/read, validation, updating/filtering, deletion, and stats. They do not modify your real local task database.

A Postman collection is included as `TaskFlow.postman_collection.json` so you can import a ready-made set of API requests. You can also test the API with Postman or Thunder Client in VS Code. Start the app, use `http://127.0.0.1:5000/api/tasks`, choose the method, and set the request body to JSON for `POST`, `PUT`, or `PATCH`.

## Deploy to Render

### 1. Push the project to GitHub

Create a **new repository** for this project, for example `taskflow-todo-manager`. In the VS Code terminal, from this folder, run:

```powershell
git init
git add .
git commit -m "Build TaskFlow task manager"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/taskflow-todo-manager.git
git push -u origin main
```

Replace the URL with your actual GitHub repository URL. Do not upload your virtual environment or `instance/tasks.db`.

### 2. Create the Render Web Service

1. Open [Render Dashboard](https://dashboard.render.com/) and choose **New → Web Service**.
2. Connect the GitHub repository you just pushed.
3. Use these settings:
   - **Runtime:** Python
   - **Build command:** `pip install -r requirements.txt`
   - **Start command:** `gunicorn app:app`
   - **Health check path:** `/api/health`
4. Deploy. Open the `onrender.com` URL once the status becomes **Live**.

The included `render.yaml` pre-fills the build/start commands when using Render Blueprints.

### Important note about SQLite persistence on Render

The app stores tasks in SQLite, as required by the assignment. SQLite data persists across normal local app restarts. Render's default service filesystem is ephemeral, however, so a SQLite database stored there can be lost when a service restarts, spins down, or redeploys. To preserve SQLite data on Render, attach a **persistent disk** to the web service with mount path `/var/data`, then add an environment variable:

- `DATABASE_PATH` = `/var/data/tasks.db`

Render currently requires a paid web service for persistent disks. If you deploy on a free service without a disk, the app will still run and be shareable, but don't rely on saved tasks surviving restarts/redeploys. See Render's [Flask deployment guide](https://render.com/docs/deploy-flask) and [persistent disk documentation](https://render.com/docs/disks).

## Project structure

```text
taskflow_todo_manager/
├── app.py                 # Flask routes and SQLite data layer
├── requirements.txt       # Python dependencies
├── render.yaml            # Render service configuration
├── test_api.py            # API smoke tests
├── templates/
│   └── index.html         # Application structure and task modals
└── static/
    ├── styles.css         # Responsive pastel UI
    └── app.js             # UI state and REST API calls
```
