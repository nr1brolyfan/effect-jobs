"""Native-boundary regression tests; no Docker or real database is touched."""
import contextlib
import datetime
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


class PreviewLifetime(unittest.TestCase):
    def execute_owner(self, preview, deadline, node_exit=0):
        source = Path(__file__).with_name('RunOwned.py').read_text()
        calls = []
        def run(args, **kwargs):
            calls.append((args, kwargs))
            if args[0] == 'node':
                return subprocess.CompletedProcess(args, node_exit, '', '')
            if args[:2] == ['docker', 'inspect']:
                if '.Ports' in args[3]:
                    return subprocess.CompletedProcess(args, 0, json.dumps({'5432/tcp': [{'HostPort': '54321'}]}), '')
                return subprocess.CompletedProcess(args, 1, '', 'no such object')
            output = 'owned-test-id' if args[:2] in [['docker', 'create'], ['docker', 'rm']] else ''
            return subprocess.CompletedProcess(args, 0, output, '')
        temporary_root = '/tmp/opencode' if Path('/tmp/opencode').is_dir() else None
        with tempfile.TemporaryDirectory(dir=temporary_root) as directory:
            root = Path(directory)
            fake_file = root / 'apps/playground-worker/tests/integration/RunOwned.py'
            with patch.object(subprocess, 'run', run), patch.object(subprocess, 'check_output', return_value=''), \
                 patch.object(sys, 'argv', ['RunOwned.py'] + (['--preview'] if preview else [])), \
                 patch.dict(os.environ, {'PLAYGROUND_DEADLINE': deadline}), contextlib.redirect_stdout(io.StringIO()):
                exec(compile(source, str(fake_file), 'exec'), {'__file__': str(fake_file)})
            receipt = json.loads((root / '.multica/integration/owned-resource-receipt.json').read_text())
        return calls, receipt

    def test_preview_ignores_expired_deadline_and_has_no_process_timeout(self):
        calls, receipt = self.execute_owner(True, '2000-01-01T00:00:00Z')
        node, = [(args, kwargs) for args, kwargs in calls if args[0] == 'node']
        self.assertTrue(node[0][-1].endswith('Preview.mjs'))
        self.assertIsNone(node[1]['timeout'])
        self.assertNotIn('PLAYGROUND_DEADLINE', node[1]['env'])
        self.assertIsNone(receipt['expiry'])
        self.assertTrue(receipt['cleanup']['absentVerified'])
        self.assertTrue(receipt['privateConfigRemoved'])

    def test_integration_keeps_deadline_and_finite_timeout(self):
        deadline = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=10)).isoformat()
        calls, receipt = self.execute_owner(False, deadline)
        node, = [(args, kwargs) for args, kwargs in calls if args[0] == 'node']
        self.assertEqual(node[1]['timeout'], 450)
        self.assertEqual(node[1]['env']['PLAYGROUND_DEADLINE'], deadline)
        self.assertEqual(receipt['expiry'], deadline)

    def test_manual_shutdown_is_not_a_failure_and_still_cleans_up(self):
        _, receipt = self.execute_owner(True, '2000-01-01T00:00:00Z', node_exit=143)
        self.assertEqual(receipt['status'], 'Stopped')
        self.assertTrue(receipt['cleanup']['absentVerified'])
        self.assertTrue(receipt['privateConfigRemoved'])


if __name__ == '__main__':
    unittest.main()
