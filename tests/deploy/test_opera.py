import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from urllib.parse import quote


@unittest.skipUnless(shutil.which("node"), "Node is required")
class OperaPublishTest(unittest.TestCase):
    def run_publish(self, responses):
        mock = """
const responses = JSON.parse(process.env.MOCK_RESPONSES);
let requests = 0;
globalThis.fetch = async (url, options = {}) => {
  requests++;
  if (!responses.length) throw new Error('Unexpected API request');
  if (url.endsWith('/api/file-upload/')) {
    if (options.headers.Referer !== 'https://addons.opera.com/developer/package/123/') throw new Error('Missing Referer');
    if (options.headers['X-CSRFToken'] !== 'fake-csrf' || !options.headers.Cookie.includes('sessionid=fake-session')) throw new Error('Missing CSRF credentials');
    if (!(options.body instanceof FormData)) throw new Error('Expected multipart upload');
  }
  if (url.includes('/api/developer/package-versions/?')) {
    if (new URL(url).searchParams.get('package_id') !== '123') throw new Error('Package id must be a query parameter');
    const data = JSON.parse(options.body);
    if ('package_id' in data || data.metadata_from !== '1.3.0') throw new Error('Wrong version registration payload');
  }
  const {status = 200, data = {}} = responses.shift();
  return new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json'}});
};
process.on('exit', () => console.log('REQUESTS=' + requests));
"""
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "extension.zip"
            archive.write_bytes(b"test archive")
            return subprocess.run([
                "node", "--import", "data:text/javascript," + quote(mock),
                "scripts/publish-opera.mjs", str(archive),
            ], text=True, capture_output=True, timeout=10, env={
                **os.environ, "OPERA_SESSION_ID": "fake-session", "OPERA_CSRF_TOKEN": "fake-csrf",
                "OPERA_PACKAGE_ID": "123", "TAG": "v1.10.0", "MOCK_RESPONSES": json.dumps(responses),
            })

    def test_multipart_upload_includes_referer_and_csrf_then_submits(self):
        result = self.run_publish([
            {"data": {"versions": [{"version": "1.3.0"}]}}, {}, {}, {},
            {"data": {"versions": [{"version": "1.10.0", "submitted_for_moderation": True}]}},
        ])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Successfully submitted 1.10.0", result.stdout)
        self.assertIn("REQUESTS=5", result.stdout)

    def test_failed_upload_never_registers_or_submits(self):
        result = self.run_publish([{}, {"status": 403, "data": {"detail": "CSRF failed"}}])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("REQUESTS=2", result.stdout)

    def test_already_submitted_version_is_not_uploaded_again(self):
        result = self.run_publish([{"data": {"versions": [{"version": "1.10.0", "submitted_for_moderation": True}]}}])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("REQUESTS=1", result.stdout)

    def test_existing_draft_is_submitted_without_duplicate_upload(self):
        result = self.run_publish([
            {"data": {"versions": [{"version": "1.10.0", "submitted_for_moderation": False}]}}, {},
            {"data": {"versions": [{"version": "1.10.0", "submitted_for_moderation": True}]}},
        ])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("REQUESTS=3", result.stdout)

    def test_unconfirmed_submission_is_not_reported_as_success(self):
        result = self.run_publish([
            {"data": {"versions": [{"version": "1.10.0", "submitted_for_moderation": False}]}}, {},
            {"data": {"versions": [{"version": "1.10.0", "submitted_for_moderation": False}]}},
        ])
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("Successfully submitted", result.stdout)
