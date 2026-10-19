"""Exercise the production deploy helper with isolated Docker/network substitutes."""
import os
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest


class DeployTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.app = self.root / "app"
        self.data = self.root / "data"
        self.tools = self.root / "tools"
        for directory in (self.app, self.data, self.tools):
            directory.mkdir()
        (self.app / "compose.production.yaml").touch()
        source = Path("deploy/avari-jobs-deploy").read_text()
        source = source.replace("root=/opt/avari-jobs", f"root={self.app}")
        source = source.replace("/var/lib/docker/volumes/avari-jobs-data/_data", str(self.data))
        self.script = self.root / "deploy"
        self.script.write_text(source)
        self.image_a = "ghcr.io/ostkost/avari-job-applications@sha256:" + "a" * 64
        self.image_b = "ghcr.io/ostkost/avari-job-applications@sha256:" + "b" * 64
        self.env = {**os.environ, "PATH": f"{self.tools}:{os.environ['PATH']}", "FAKE_DATA": str(self.data), "FAKE_ROOT": str(self.root)}
        self.tool("docker", r"""#!/usr/bin/env python3
import json, os, pathlib, sqlite3, sys
root = pathlib.Path(os.environ['FAKE_ROOT'])
with (root / 'commands').open('a') as output: output.write(' '.join(sys.argv[1:]) + '\n')
if sys.argv[1] == 'login': sys.stdin.read()
if 'exec' in sys.argv and os.environ.get('FAKE_TELEGRAM_FAILURE') == '1': sys.exit(1)
if sys.argv[1:3] == ['volume', 'inspect']: print(os.environ['FAKE_DATA'])
if 'up' in sys.argv:
    image = os.environ['AVARI_IMAGE']
    (root / 'running').write_text(image)
    database = pathlib.Path(os.environ['FAKE_DATA']) / 'avari.db'
    if database.exists() and image.endswith('b' * 64):
        with sqlite3.connect(database) as db: db.execute("UPDATE records SET value='new-version-change'")
""")
        self.tool("curl", """#!/usr/bin/env python3
import json, os, pathlib, sys
root = pathlib.Path(os.environ['FAKE_ROOT'])
image = (root / 'running').read_text() if (root / 'running').exists() else ''
if image.endswith(os.environ.get('FAKE_FAILURE', '!')): sys.exit(22)
if sys.argv[-1].endswith('/release.json'): print(json.dumps({'version': '1.0.1' if image.endswith('b' * 64) else '1.0.0'}))
""")
        self.tool("sleep", "#!/bin/sh\nexit 0\n")
        self.tool("chown", "#!/bin/sh\nexit 0\n")

    def tearDown(self):
        self.temporary.cleanup()

    def tool(self, name, text):
        path = self.tools / name
        path.write_text(text)
        path.chmod(0o755)

    def seed(self):
        (self.app / "current").write_text(f"v1.0.0 {self.image_a}\n")
        with sqlite3.connect(self.data / "avari.db") as db:
            db.execute("CREATE TABLE records(value TEXT)")
            db.execute("INSERT INTO records VALUES('original')")

    def deploy(self, tag="v1.0.1", digest=None):
        return subprocess.run(["bash", str(self.script), tag, digest or "sha256:" + "b" * 64, "OstKost"], input="fake-token", text=True, capture_output=True, env=self.env, timeout=20)

    def test_telegram_config_is_atomic_private_and_preserves_other_settings(self):
        env_file = self.app / ".env"
        env_file.write_text("UNRELATED=keep\nAVARI_TELEGRAM_ENABLED=false\n")
        data = {"enabled": True, "token": "123456789:" + "a" * 35, "username": "AvariJobsBot", "webhookSecret": "s" * 64}
        result = subprocess.run(["bash", str(self.script), "--telegram-config"], input=json.dumps(data), text=True, capture_output=True, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("UNRELATED=keep", env_file.read_text())
        self.assertIn("AVARI_TELEGRAM_ENABLED=true", env_file.read_text())
        self.assertEqual(env_file.stat().st_mode & 0o777, 0o600)
        self.assertNotIn(data["token"], result.stdout + result.stderr)
        before = env_file.read_bytes()
        data["token"] = "invalid\nINJECTED=unsafe"
        result = subprocess.run(["bash", str(self.script), "--telegram-config"], input=json.dumps(data), text=True, capture_output=True, env=self.env)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(env_file.read_bytes(), before)

    def test_telegram_config_validates_optional_delivery_mode(self):
        data = {"enabled": True, "token": "123456789:" + "a" * 35, "username": "AvariJobsBot", "webhookSecret": "s" * 64, "deliveryMode": "polling"}
        result = subprocess.run(["bash", str(self.script), "--telegram-config"], input=json.dumps(data), text=True, capture_output=True, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        env_file = self.app / ".env"
        self.assertIn("AVARI_TELEGRAM_DELIVERY_MODE=polling", env_file.read_text().splitlines())
        self.assertEqual(len(env_file.read_text().splitlines()), 5)
        before = env_file.read_bytes()
        data["deliveryMode"] = "unsafe"
        result = subprocess.run(["bash", str(self.script), "--telegram-config"], input=json.dumps(data), text=True, capture_output=True, env=self.env)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(env_file.read_bytes(), before)

    def test_first_deploy_without_backups(self):
        result = self.deploy("v1.0.0", "sha256:" + "a" * 64)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.app / "maintenance").exists())

    def test_upgrade_makes_checked_backup(self):
        self.seed()
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        backups = list((self.app / "backups").glob("*.db"))
        self.assertEqual(len(backups), 1)
        with sqlite3.connect(backups[0]) as db:
            self.assertEqual(db.execute("SELECT value FROM records").fetchone()[0], "original")

    def test_failed_readiness_restores_database_and_image(self):
        self.seed()
        self.env["FAKE_FAILURE"] = "b" * 64
        result = self.deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.root / "running").read_text(), self.image_a)
        self.assertTrue((self.app / "current").read_text().startswith("v1.0.0 "))
        self.assertFalse((self.app / "maintenance").exists())
        with sqlite3.connect(self.data / "avari.db") as db:
            self.assertEqual(db.execute("SELECT value FROM records").fetchone()[0], "original")

    def test_wrong_release_version_rolls_back(self):
        self.seed()
        result = self.deploy("v1.0.2")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.root / "running").read_text(), self.image_a)

    def test_telegram_setup_is_opt_in_without_secret_arguments(self):
        self.seed()
        self.env["AVARI_TELEGRAM_BOT_TOKEN"] = "must-stay-secret"
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        commands = (self.root / "commands").read_text()
        self.assertIn('if [ "$AVARI_TELEGRAM_ENABLED" = true ]', commands)
        self.assertIn('/app/avari -telegram-setup', commands)
        self.assertNotIn("must-stay-secret", commands)

    def test_failed_telegram_setup_restores_database_and_image(self):
        self.seed()
        self.env["FAKE_TELEGRAM_FAILURE"] = "1"
        result = self.deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.root / "running").read_text(), self.image_a)
        self.assertTrue((self.app / "current").read_text().startswith("v1.0.0 "))
        with sqlite3.connect(self.data / "avari.db") as db:
            self.assertEqual(db.execute("SELECT value FROM records").fetchone()[0], "original")

    def test_repeated_release_has_no_side_effects(self):
        self.seed()
        result = self.deploy("v1.0.0", "sha256:" + "a" * 64)
        self.assertEqual(result.returncode, 0)
        self.assertFalse((self.root / "commands").exists())

    def test_old_and_invalid_releases_are_rejected(self):
        self.seed()
        for tag in ("v0.9.0", "v1.0.1-rc1", "main", "v01.0.1"):
            self.assertNotEqual(self.deploy(tag).returncode, 0)
        self.assertFalse((self.root / "commands").exists())


if __name__ == "__main__":
    unittest.main()
