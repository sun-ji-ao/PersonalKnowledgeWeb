"""Replace only the known website cron entry, preserving other jobs."""
import pathlib
import subprocess
import time

base = pathlib.Path.home() / 'technical-notes'
old = f'15 3 * * * /bin/sh {base}/releases/b8/deploy/private-backup.sh >> {base}/runtime/backup.log 2>&1'
new = f'15 3 * * * /bin/sh {base}/production-backup.sh >> {base}/runtime/backup.log 2>&1'
current = subprocess.run(['crontab', '-l'], capture_output=True, text=True, check=True).stdout
if new in current.splitlines() and old not in current.splitlines():
    print('Production backup cron already installed')
elif current.splitlines().count(old) == 1 and new not in current.splitlines():
    saved = base / 'runtime' / f'crontab-before-production-{time.time_ns()}.txt'
    saved.write_text(current)
    saved.chmod(0o600)
    updated = '\n'.join(new if line == old else line for line in current.splitlines()) + '\n'
    subprocess.run(['crontab', '-'], input=updated, text=True, check=True)
    assert subprocess.check_output(['crontab', '-l'], text=True) == updated
    print(f'Installed; previous cron saved to {saved}')
else:
    raise SystemExit('Unexpected cron configuration; no changes made')
