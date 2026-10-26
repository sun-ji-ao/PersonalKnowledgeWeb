#!/usr/bin/env python3
"""Website-only releases on the existing Ubuntu host; never restore live data.

Run as the website owner. preflight/status need no sudo. activate/rollback need
an existing sudo login (sudo -v in the same terminal); no sudoers rule is added.
Persistence or dependency changes require a separate reviewed migration plan.
"""
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import sqlite3
import subprocess
import sys
import time
import urllib.request
import uuid

UNIT = "technical-notes.service"
OVERRIDE = Path("/etc/systemd/system/technical-notes.service.d/90-website-release.conf")
MARKER = "# Managed by website-release.py\n"
GUARDED = ("package.json", "package-lock.json", "server.mjs", "lib/store.mjs",
           "lib/html-store.mjs", "lib/html-core.mjs", "lib/html-media.mjs",
           "lib/html-discovery.mjs", "lib/source-archive.mjs", "lib/html-backup.mjs")


def execute(args, *, cwd=None, timeout=180):
    # sudo must keep the invoking terminal/session so sudo -v authentication is
    # reusable. Only unprivileged backup/drill workers get their own process group.
    isolated = os.name == "posix" and Path(str(args[0])).name != "sudo"
    process = subprocess.Popen([str(a) for a in args], cwd=cwd, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True, start_new_session=isolated)
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except BaseException:
        # A timed-out recovery script may have a child web server. Kill the group.
        if isolated:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        else:
            process.kill()
        process.communicate()
        raise
    if process.returncode:
        # Commands only handle website source, paths and synthetic drill records.
        raise RuntimeError(f"{Path(str(args[0])).name} exited {process.returncode}: "
                           f"{(stderr or stdout)[-2000:]}")
    return stdout.strip()


def write_json(file, value):
    temporary = file.with_name(file.name + "." + uuid.uuid4().hex + ".tmp")
    with temporary.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, file)


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def database_digest(file):
    # Logical content/schema comparison ignores SQLite page layout and WAL state.
    with contextlib.closing(sqlite3.connect(file.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("Database integrity check failed")
        return hashlib.sha256("\n".join(db.iterdump()).encode()).hexdigest()


class Releases:
    def __init__(self, base):
        self.base = Path(base).resolve(strict=True)
        self.releases = self.base / "releases"
        self.runtime = self.base / "runtime"
        self.records = self.runtime / "deployments"
        self.records.mkdir(mode=0o700, exist_ok=True)
        self.node = self.base / "node-runtime/node_modules/node/bin/node"
        self.pending = self.records / "pending.json"
        self.last = self.records / "last-success.json"

    def release(self, name):
        if not re.fullmatch(r"[a-z][a-z0-9-]{0,63}", name):
            raise RuntimeError("Invalid release name")
        target = self.releases / name
        if target.is_symlink() or target.resolve(strict=True).parent != self.releases.resolve(strict=True):
            raise RuntimeError("Release must be a direct real directory under releases")
        for file in (*GUARDED, "scripts/html-data.mjs", "scripts/html-recovery-drill.mjs",
                     "public/html-editor.bundle.js"):
            source = target / file
            if not source.is_file() or source.is_symlink():
                raise RuntimeError(f"Missing or linked release file: {file}")
        return target

    def active(self):
        value = execute(["systemctl", "show", UNIT, "-p", "WorkingDirectory", "--value"])
        release = self.release(Path(value).name)
        if str(release) != value:
            raise RuntimeError("Unexpected production WorkingDirectory")
        return release

    def validate_environment(self):
        expected = {"HTML_EDITOR": "1", "DEPLOYMENT_MODE": "production",
                    "PUBLIC_ORIGIN": "https://sunjiao.me", "SEED_DEMO": "0", "PORT": "4310",
                    "DATA_DIR": str(self.runtime), "HTML_DB_PATH": str(self.base / "content/notes.sqlite"),
                    "HTML_ARCHIVE_DIR": str(self.base / "content/source-archives"),
                    "HTML_MEDIA_DIR": str(self.base / "content/media")}
        values = {}
        # Do not source shell code or print secrets from this existing file.
        for line in Path("/etc/technical-notes/site.env").read_text().splitlines():
            key, separator, value = line.partition("=")
            if separator and key in expected:
                values[key] = value.strip().strip("\"'")
        if values != expected:
            raise RuntimeError("Website environment differs from supported production paths/mode")
        env_files = execute(["systemctl", "show", UNIT, "-p", "EnvironmentFiles", "--value"])
        if env_files != "/etc/technical-notes/site.env (ignore_errors=no)":
            raise RuntimeError("Unexpected website EnvironmentFiles")

    def compatible(self, old, candidate):
        changed = [file for file in GUARDED if digest(old / file) != digest(candidate / file)]
        if changed:
            raise RuntimeError("Automatic release blocked; persistence/startup/dependency changes "
                               "need a migration review: " + ", ".join(changed))

    def health(self, release, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                pid = int(execute(["systemctl", "show", UNIT, "-p", "MainPID", "--value"]))
                running = pid > 0 and Path(f"/proc/{pid}/cwd").resolve(strict=True) == release
                with urllib.request.urlopen("http://127.0.0.1:4310/_health", timeout=2) as response:
                    healthy = response.status == 200 and json.load(response) == {"ok": True, "mode": "html"}
                if running and healthy:
                    return
            except (OSError, ValueError, RuntimeError):
                pass
            time.sleep(0.5)
        raise RuntimeError(f"Website health/process-directory check failed for {release.name}")

    def backup(self, release, destination):
        return json.loads(execute([self.node, release / "scripts/html-data.mjs", "backup", self.runtime,
                                  destination, "--db", self.base / "content/notes.sqlite",
                                  "--archives", self.base / "content/source-archives",
                                  "--media", self.base / "content/media"], cwd=release))

    def preflight(self, name, *, require_current_health=True):
        if self.pending.exists():
            raise RuntimeError("Interrupted activation exists; run recover before another release")
        self.validate_environment()
        old, candidate = self.active(), self.release(name)
        if require_current_health:
            self.health(old)
        self.compatible(old, candidate)
        if shutil.disk_usage(self.base).free < 2 * 1024 ** 3:
            raise RuntimeError("At least 2 GiB free space is required")
        if not (candidate / "node_modules").exists():
            # Only allowed with byte-identical package/lock files. Retain every release.
            execute(["cp", "-a", "--reflink=auto", old / "node_modules", candidate / "node_modules"])
        run_id = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + "-" + uuid.uuid4().hex[:8]
        work = self.records / run_id
        work.mkdir(mode=0o700)
        # Use the normal backup name so the existing offsite job includes this snapshot.
        snapshot = self.base / "backups" / ("backup-" + time.strftime("%Y-%m-%dT%H-%M-%S-000Z-", time.gmtime()) + uuid.uuid4().hex[:8])
        report = {"id": run_id, "from": old.name, "to": candidate.name, "status": "checking",
                  "backup": str(snapshot), "work": str(work)}
        write_json(work / "result.json", report)
        try:
            self.backup(old, snapshot)
            before = database_digest(snapshot / "notes.sqlite")
            restored = work / "candidate-data"
            candidate_check = json.loads(execute([self.node, candidate / "scripts/html-recovery-drill.mjs",
                                                  snapshot, restored], cwd=candidate))
            if database_digest(restored / "notes.sqlite") != before:
                raise RuntimeError("Candidate changed the restored schema or existing content")
            # Exercise a new private draft on the isolated copy, then old-code restore.
            probe = """import {openHtmlStore} from './lib/html-store.mjs';
import {normalizeHtml,renderHtml} from './lib/html-content.mjs';
const store=openHtmlStore(process.argv[1]);
try { const note=store.create({title:'Isolated release compatibility probe',result:await renderHtml(await normalizeHtml('<p>Release probe: keep new draft on rollback.</p>'))}); console.log(JSON.stringify({id:note.id})); } finally {store.close();}"""
            note = json.loads(execute([self.node, "--input-type=module", "-e", probe,
                                       restored / "notes.sqlite"], cwd=candidate))
            upgraded = work / "after-new-draft"
            execute([self.node, candidate / "scripts/html-data.mjs", "backup", restored, upgraded,
                     "--db", restored / "notes.sqlite", "--archives", restored / "source-archives",
                     "--media", restored / "media"], cwd=candidate)
            # Normal activation proves both directions. Emergency rollback must
            # not depend on starting the broken current app again.
            recovery_release = old if require_current_health else candidate
            old_check = json.loads(execute([self.node, recovery_release / "scripts/html-recovery-drill.mjs",
                                            upgraded, work / "rollback-data"], cwd=recovery_release))
            with contextlib.closing(sqlite3.connect((work / "rollback-data/notes.sqlite").as_uri() + "?mode=ro", uri=True)) as db:
                found = db.execute("SELECT published_revision_id FROM html_notes WHERE id=?", (note["id"],)).fetchone()
                if found != (None,) or old_check["notes"] != candidate_check["notes"] + 1:
                    raise RuntimeError("Rollback recovery did not preserve the new private draft")
            report.update(status="ready", candidateCheck=candidate_check, rollbackCheck=old_check,
                          recoveryCheckRelease=recovery_release.name, newPrivateDraftPreserved=True)
        except BaseException as error:
            report.update(status="failed", error=str(error))
            raise
        finally:
            write_json(work / "result.json", report)
        return report

    def override_text(self):
        if OVERRIDE.is_symlink():
            raise RuntimeError("Refusing a symlink at the managed systemd drop-in")
        if not OVERRIDE.exists():
            return None
        value = OVERRIDE.read_text()
        if not value.startswith(MARKER):
            raise RuntimeError("Existing drop-in is not owned by this tool")
        return value

    def install_override(self, text, work):
        if text is None:
            execute(["sudo", "-n", "rm", "-f", "--", OVERRIDE])
        else:
            local = work / ("override-" + uuid.uuid4().hex + ".conf")
            local.write_text(text)
            execute(["sudo", "-n", "mkdir", "-p", "--", OVERRIDE.parent])
            temporary = OVERRIDE.with_name(".website-release-" + uuid.uuid4().hex + ".tmp")
            execute(["sudo", "-n", "install", "-m", "644", "--", local, temporary])
            execute(["sudo", "-n", "mv", "-T", "--", temporary, OVERRIDE])
        execute(["sudo", "-n", "systemctl", "daemon-reload"])

    def restore_previous(self, report):
        previous = self.release(report["from"])
        self.install_override(report["previousOverride"], Path(report["work"]))
        if self.active() != previous:
            raise RuntimeError("Restored systemd configuration does not select the previous release")
        execute(["sudo", "-n", "systemctl", "restart", UNIT])
        self.health(previous)

    def restore_history(self, report):
        if report["previousSuccess"] is None:
            self.last.unlink(missing_ok=True)
        else:
            write_json(self.last, report["previousSuccess"])

    def activate(self, name, kind="activate"):
        execute(["sudo", "-n", "true"])
        # A failed current service must not prevent an emergency code rollback.
        report = self.preflight(name, require_current_health=kind != "rollback")
        if report["from"] == name:
            raise RuntimeError("Target release is already active; no service changes made")
        if self.active().name != report["from"]:
            raise RuntimeError("Production release changed during preflight; retry from current state")
        execute(["sudo", "-n", "true"])
        previous = self.override_text()
        prior_success = json.loads(self.last.read_text()) if self.last.exists() else None
        report.update(status="switch-pending", kind=kind, previousOverride=previous,
                      previousSuccess=prior_success)
        write_json(self.pending, report)  # Written before changing the service.
        try:
            self.install_override(MARKER + "[Service]\nWorkingDirectory=" + str(self.release(name)) + "\n",
                                  Path(report["work"]))
            if self.active() != self.release(name):
                raise RuntimeError("Another systemd setting overrides the candidate release")
            execute(["sudo", "-n", "systemctl", "restart", UNIT])
            self.health(self.release(name))
            report.update(status="active", completedAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
            write_json(self.last, {key: report[key] for key in
                                  ("id", "from", "to", "status", "completedAt", "work", "backup")})
        except BaseException as error:
            report.update(status="rollback-required", error=str(error))
            # The initial pending record already exists. A full disk must not
            # prevent restoration just because additional diagnostics cannot save.
            try:
                write_json(self.pending, report)
            except OSError as journal_error:
                report["journalUpdateError"] = str(journal_error)
            try:
                self.restore_previous(report)
                self.restore_history(report)
                report["status"] = "rolled-back-after-failure"
            except BaseException as recovery_error:
                report["recoveryError"] = str(recovery_error)
                with contextlib.suppress(OSError):
                    write_json(self.pending, report)
                raise RuntimeError("Activation and automatic recovery failed; run recover after inspecting website service") from recovery_error
            raise
        finally:
            write_json(Path(report["work"]) / "result.json", report)
            if report["status"] in ("active", "rolled-back-after-failure"):
                self.pending.unlink(missing_ok=True)
        return report

    def recover(self):
        execute(["sudo", "-n", "true"])
        report = json.loads(self.pending.read_text())
        self.restore_previous(report)
        self.restore_history(report)
        report["status"] = "recovered-after-interruption"
        write_json(Path(report["work"]) / "result.json", report)
        self.pending.unlink()
        return report


@contextlib.contextmanager
def deployment_lock(runtime):
    import fcntl  # Ubuntu-only execution; unit tests can import helpers on Windows.
    with (runtime / "website-release.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("status", "preflight", "activate", "rollback", "recover"))
    parser.add_argument("release", nargs="?")
    args = parser.parse_args()
    if sys.platform != "linux" or os.geteuid() == 0:
        parser.error("Run as the ordinary website user on Ubuntu, not as root")
    os.umask(0o077)
    app = Releases(Path.home() / "technical-notes")
    with deployment_lock(app.runtime):
        if args.command == "status":
            print(json.dumps({"active": app.active().name, "recoveryRequired": app.pending.exists()}, indent=2))
            return
        if args.command == "recover":
            result = app.recover()
        elif args.command == "rollback":
            prior = json.loads(app.last.read_text())
            if app.active().name != prior["to"]:
                raise RuntimeError("Service changed outside this tool; inspect before rollback")
            result = app.activate(prior["from"], kind="rollback")
        elif not args.release:
            parser.error("A release name is required")
        else:
            result = getattr(app, args.command)(args.release)
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        sys.exit(1)
