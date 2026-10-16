"""Small API smoke-test suite. Run with: python test_api.py"""
import os
import tempfile
import unittest

from app import app


class TaskApiTests(unittest.TestCase):
    def setUp(self):
        handle, path = tempfile.mkstemp(suffix=".db")
        os.close(handle)
        self.db_path = path
        app.config["DATABASE_PATH"] = path
        app.config["SEED_DEMO_DATA"] = False
        self.client = app.test_client()
        with self.client.get("/api/tasks") as response:
            self.assertEqual(response.status_code, 200)

    def tearDown(self):
        try:
            os.remove(self.db_path)
        except FileNotFoundError:
            pass

    def create_task(self, title="Review project", **overrides):
        payload = {"title": title, "description": "A test task", "priority": "high", **overrides}
        return self.client.post("/api/tasks", json=payload)

    def test_create_and_read_task(self):
        created = self.create_task()
        self.assertEqual(created.status_code, 201)
        task_id = created.get_json()["task"]["id"]
        fetched = self.client.get(f"/api/tasks/{task_id}")
        self.assertEqual(fetched.status_code, 200)
        self.assertEqual(fetched.get_json()["task"]["title"], "Review project")

    def test_title_is_required(self):
        response = self.client.post("/api/tasks", json={"title": "   "})
        self.assertEqual(response.status_code, 422)
        self.assertIn("title", response.get_json()["details"])

    def test_update_and_filter(self):
        task_id = self.create_task().get_json()["task"]["id"]
        updated = self.client.patch(f"/api/tasks/{task_id}", json={"status": "completed"})
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.get_json()["task"]["status"], "completed")
        filtered = self.client.get("/api/tasks?status=completed")
        self.assertEqual(filtered.status_code, 200)
        self.assertEqual(filtered.get_json()["count"], 1)

    def test_delete_task(self):
        task_id = self.create_task().get_json()["task"]["id"]
        deleted = self.client.delete(f"/api/tasks/{task_id}")
        self.assertEqual(deleted.status_code, 200)
        missing = self.client.get(f"/api/tasks/{task_id}")
        self.assertEqual(missing.status_code, 404)

    def test_stats_endpoint(self):
        self.create_task()
        response = self.client.get("/api/stats")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["total"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
