import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from urllib.parse import quote


@unittest.skipUnless(shutil.which("node"), "Node is required")
class ChromePublishTest(unittest.TestCase):
    def run_publish(self, responses):
        mock = """
const responses = JSON.parse(process.env.MOCK_RESPONSES);
const requests = [];
globalThis.setTimeout = (callback) => { callback(); return 0; };
globalThis.fetch = async (url, options) => {
  requests.push([url, options.method || 'GET']);
  if (!responses.length) throw new Error('Unexpected API request');
  const data = responses.shift();
  return new Response(JSON.stringify(data), {status: 200});
};
process.on('exit', () => console.log('REQUESTS=' + requests.length));
"""
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "extension.zip"
            archive.write_bytes(b"fake archive")
            return subprocess.run([
                "node", "--import", "data:text/javascript," + quote(mock),
                "scripts/publish-chrome.mjs", str(archive),
            ], text=True, capture_output=True, timeout=10, env={
                **os.environ, "CHROME_ACCESS_TOKEN": "fake-token", "CHROME_PUBLISHER_ID": "publisher",
                "CHROME_EXTENSION_ID": "a" * 32, "TAG": "v1.0.1", "MOCK_RESPONSES": json.dumps(responses),
            })

    def test_upload_and_submit(self):
        result = self.run_publish([{}, {"uploadState": "SUCCEEDED", "crxVersion": "1.0.1"}, {"state": "PENDING_REVIEW"}])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("REQUESTS=3", result.stdout)

    def test_async_upload_waits_for_success(self):
        result = self.run_publish([{}, {"uploadState": "IN_PROGRESS"}, {"lastAsyncUploadState": "IN_PROGRESS"}, {"lastAsyncUploadState": "SUCCEEDED"}, {}])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("REQUESTS=5", result.stdout)

    def test_failed_upload_is_not_published(self):
        result = self.run_publish([{}, {"uploadState": "FAILED"}])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("REQUESTS=2", result.stdout)

    def test_already_submitted_version_is_not_uploaded_again(self):
        revision = {"state": "PENDING_REVIEW", "distributionChannels": [{"crxVersion": "1.0.1"}]}
        result = self.run_publish([{"submittedItemRevisionStatus": revision}])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("REQUESTS=1", result.stdout)

    def test_rejected_version_is_not_reported_as_success(self):
        revision = {"state": "REJECTED", "distributionChannels": [{"crxVersion": "1.0.1"}]}
        result = self.run_publish([{"submittedItemRevisionStatus": revision}])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("REQUESTS=1", result.stdout)
