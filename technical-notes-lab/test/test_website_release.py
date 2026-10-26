"""Run: python -m unittest discover -s test -p test_website_release.py -v"""
import importlib.util
from contextlib import closing
import json
import os
import shutil
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("website_release", Path(__file__).resolve().parents[1] / "deploy/website-release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        (self.base / "runtime").mkdir()
        (self.base / "content").mkdir()
        self.live = self.base / "content/notes.sqlite"
        self.live.write_bytes(b"production content including newly written articles")
        for name in ("old", "new"):
            for filename in (*release.GUARDED, "scripts/html-data.mjs", "scripts/html-recovery-drill.mjs", "public/html-editor.bundle.js"):
                path = self.base / "releases" / name / filename
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("unchanged application\n")
        self.app = release.Releases(self.base)
        self.work = self.app.records / "test-operation"
        self.work.mkdir()

    def report(self):
        return {"id": "test-operation", "from": "old", "to": "new", "status": "ready", "work": str(self.work), "backup": str(self.base / "backups/isolated-test")}

    def test_release_names_and_missing_files_are_rejected(self):
        for name in ("../content", "old/..", "old;id", "/tmp", ""):
            with self.assertRaises(RuntimeError):
                self.app.release(name)
        (self.base / "releases/new/server.mjs").unlink()
        with self.assertRaises(RuntimeError):
            self.app.release("new")

    def test_changed_database_implementation_blocks_automatic_release(self):
        old, new = self.app.release("old"), self.app.release("new")
        self.app.compatible(old, new)
        (new / "lib/html-store.mjs").write_text("new schema migration")
        with self.assertRaisesRegex(RuntimeError, "migration review"):
            self.app.compatible(old, new)

    def test_database_digest_detects_content_and_schema_changes(self):
        file = self.base / "isolated.sqlite"
        with closing(sqlite3.connect(file, isolation_level=None)) as db:
            db.executescript("CREATE TABLE notes(id INTEGER PRIMARY KEY,body TEXT); INSERT INTO notes VALUES(1,'original');")
        initial = release.database_digest(file)
        with closing(sqlite3.connect(file, isolation_level=None)) as db:
            db.execute("UPDATE notes SET body='changed'")
        updated = release.database_digest(file)
        self.assertNotEqual(initial, updated)
        with closing(sqlite3.connect(file, isolation_level=None)) as db:
            db.execute("ALTER TABLE notes ADD COLUMN extra TEXT")
        self.assertNotEqual(updated, release.database_digest(file))

    def test_sudo_failure_occurs_before_preflight_or_service_mutation(self):
        with patch.object(release, "execute", side_effect=RuntimeError("password required")), patch.object(self.app, "preflight") as preflight:
            with self.assertRaisesRegex(RuntimeError, "password required"):
                self.app.activate("new")
            preflight.assert_not_called()
        self.assertFalse(self.app.pending.exists())

    def test_rollback_preflight_can_reach_backup_when_current_service_is_down(self):
        (self.base / "releases/new/node_modules").mkdir()
        with patch.object(self.app, "validate_environment"), \
             patch.object(self.app, "active", return_value=self.app.release("old")), \
             patch.object(self.app, "health", side_effect=RuntimeError("current service down")) as health, \
             patch.object(self.app, "backup", side_effect=RuntimeError("backup boundary reached")) as backup:
            with self.assertRaisesRegex(RuntimeError, "backup boundary reached"):
                self.app.preflight("new", require_current_health=False)
            health.assert_not_called()
            backup.assert_called_once()

    def test_complete_emergency_preflight_never_starts_the_broken_current_release(self):
        candidate = self.app.release("new")
        (candidate / "node_modules").mkdir()
        (self.base / "backups").mkdir()
        started = []

        def backup(old, destination):
            destination.mkdir()
            with closing(sqlite3.connect(destination / "notes.sqlite", isolation_level=None)) as db:
                db.executescript("CREATE TABLE html_notes(id TEXT PRIMARY KEY,published_revision_id TEXT); INSERT INTO html_notes VALUES('existing','published');")

        def command(args, **kwargs):
            if str(args[1]).endswith("html-recovery-drill.mjs"):
                app = Path(args[1]).parent.parent
                started.append(app.name)
                if app.name == "old":
                    raise RuntimeError("Broken current release cannot start")
                source, destination = Path(args[2]), Path(args[3])
                destination.mkdir()
                shutil.copyfile(source / "notes.sqlite", destination / "notes.sqlite")
                with closing(sqlite3.connect(destination / "notes.sqlite")) as db:
                    count = db.execute("SELECT COUNT(*) FROM html_notes").fetchone()[0]
                return json.dumps({"notes": count, "published": 1, "integrity": "ok"})
            if args[1] == "--input-type=module":
                with closing(sqlite3.connect(args[-1], isolation_level=None)) as db:
                    db.execute("INSERT INTO html_notes VALUES('probe',NULL)")
                return json.dumps({"id": "probe"})
            if str(args[1]).endswith("html-data.mjs"):
                Path(args[4]).mkdir()
                shutil.copyfile(Path(args[3]) / "notes.sqlite", Path(args[4]) / "notes.sqlite")
                return "{}"
            self.fail(f"Unexpected command: {args}")

        with patch.object(self.app, "validate_environment"), \
             patch.object(self.app, "active", return_value=self.app.release("old")), \
             patch.object(self.app, "health", side_effect=RuntimeError("current service down")), \
             patch.object(self.app, "backup", side_effect=backup), \
             patch.object(release, "execute", side_effect=command):
            report = self.app.preflight("new", require_current_health=False)
        self.assertEqual(report["status"], "ready")
        self.assertEqual(report["rollbackCheck"]["notes"], 2)
        self.assertEqual(started, ["new", "new"])

    @unittest.skipUnless(sys.platform == "linux", "Process-group cleanup is Ubuntu-specific")
    def test_timeout_terminates_child_recovery_server_too(self):
        marker = self.base / "child.pid"
        code = ("import subprocess,sys,time; from pathlib import Path; "
                "child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)']); "
                f"Path({str(marker)!r}).write_text(str(child.pid)); time.sleep(60)")
        with self.assertRaises(subprocess.TimeoutExpired):
            release.execute([sys.executable, "-c", code], timeout=1)
        pid = int(marker.read_text())
        stat = Path(f"/proc/{pid}/stat")
        if stat.exists():
            self.assertEqual(stat.read_text().split(")", 1)[1].split()[0], "Z")
        else:
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)

    def exercise(self, *, health_failure=False, recovery_failure=False, interruption=False):
        calls = []
        current = ["old"]

        def install(text, work):
            # Real journal must be present before any simulated root operation.
            self.assertTrue(self.app.pending.exists())
            calls.append("install")
            current[0] = "new"
            if interruption:
                raise KeyboardInterrupt("interrupted during systemd change")

        def restore(report):
            calls.append("restore")
            if recovery_failure:
                raise RuntimeError("sudo session unavailable")
            current[0] = "old"

        def health(target):
            calls.append("health:" + target.name)
            if health_failure:
                raise RuntimeError("candidate failed")

        before = self.live.read_bytes()
        with patch.object(release, "execute", return_value=""), \
             patch.object(self.app, "preflight", return_value=self.report()), \
             patch.object(self.app, "override_text", return_value=None), \
             patch.object(self.app, "install_override", side_effect=install), \
             patch.object(self.app, "restore_previous", side_effect=restore), \
             patch.object(self.app, "health", side_effect=health), \
             patch.object(self.app, "active", side_effect=lambda: self.app.release(current[0])):
            if interruption:
                with self.assertRaises(KeyboardInterrupt):
                    self.app.activate("new")
            elif health_failure:
                with self.assertRaises(RuntimeError):
                    self.app.activate("new")
            else:
                self.assertEqual(self.app.activate("new")["status"], "active")
        self.assertEqual(self.live.read_bytes(), before)
        return calls, current[0]

    def test_successful_switch_records_previous_release_without_touching_live_data(self):
        calls, current = self.exercise()
        self.assertEqual(current, "new")
        self.assertNotIn("restore", calls)
        self.assertEqual(json.loads(self.app.last.read_text())["from"], "old")
        self.assertFalse(self.app.pending.exists())

    def test_health_failure_restores_code_and_keeps_live_content(self):
        calls, current = self.exercise(health_failure=True)
        self.assertEqual(current, "old")
        self.assertEqual(calls[-1], "restore")
        self.assertFalse(self.app.last.exists())
        self.assertFalse(self.app.pending.exists())
        self.assertEqual(json.loads((self.work / "result.json").read_text())["status"], "rolled-back-after-failure")

    def test_failed_diagnostic_write_still_attempts_service_restoration(self):
        write = release.write_json

        def fail_diagnostic(path, value):
            if path == self.app.pending and value.get("status") == "rollback-required":
                raise OSError("No space left while logging failure")
            write(path, value)

        with patch.object(release, "write_json", side_effect=fail_diagnostic):
            calls, current = self.exercise(health_failure=True)
        self.assertEqual(current, "old")
        self.assertIn("restore", calls)
        self.assertFalse(self.app.pending.exists())

    def test_recovery_failure_keeps_durable_pending_journal(self):
        self.exercise(health_failure=True, recovery_failure=True)
        self.assertTrue(self.app.pending.exists())
        self.assertEqual(json.loads(self.app.pending.read_text())["status"], "rollback-required")
        with self.assertRaisesRegex(RuntimeError, "Interrupted activation"):
            self.app.preflight("new")

    def test_keyboard_interrupt_also_restores_previous_service(self):
        calls, current = self.exercise(interruption=True)
        self.assertEqual(current, "old")
        self.assertIn("restore", calls)
        self.assertFalse(self.app.pending.exists())

    def test_recover_uses_saved_configuration_and_clears_pending_only_after_success(self):
        report = {**self.report(), "previousOverride": None, "previousSuccess": None, "status": "switch-pending"}
        release.write_json(self.app.pending, report)
        with patch.object(release, "execute", return_value=""), patch.object(self.app, "restore_previous") as restore:
            result = self.app.recover()
            restore.assert_called_once()
            self.assertEqual(restore.call_args.args[0]["from"], report["from"])
            self.assertEqual(restore.call_args.args[0]["previousOverride"], report["previousOverride"])
        self.assertEqual(result["status"], "recovered-after-interruption")
        self.assertFalse(self.app.pending.exists())

    def test_crash_after_success_write_recovers_previous_rollback_history(self):
        previous = {"id": "earlier", "from": "older", "to": "old", "status": "active"}
        report = {**self.report(), "previousOverride": None, "previousSuccess": previous, "status": "switch-pending"}
        release.write_json(self.app.pending, report)
        release.write_json(self.app.last, {"id": report["id"], "from": "old", "to": "new", "status": "active"})
        with patch.object(release, "execute", return_value=""), patch.object(self.app, "restore_previous"):
            self.app.recover()
        self.assertEqual(json.loads(self.app.last.read_text()), previous)
        self.assertFalse(self.app.pending.exists())


if __name__ == "__main__":
    unittest.main()
