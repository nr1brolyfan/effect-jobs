"""Isolated cleanup contract tests: no Docker, process, or private environment access."""
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).with_name('ApplicabilityOwned.py')


class CleanupContract(unittest.TestCase):
    def exercise(self, case):
        commands = []
        original_unlink = Path.unlink
        original_exists = Path.exists

        def run(args, **kwargs):
            commands.append(args)
            if args[1:3] == ['rm', '--force']:
                if case == 'remove-timeout':
                    raise subprocess.TimeoutExpired(args, 30)
                if case == 'remove-exception':
                    raise OSError('synthetic')
                return subprocess.CompletedProcess(args, 1 if case == 'remove-failed' else 0, '', '')
            if args[1:] == ['inspect', 'mock-owned-container']:
                if case == 'inspect-exception':
                    raise OSError('synthetic')
                if case == 'inspect-failed':
                    return subprocess.CompletedProcess(args, 1, '', 'daemon unavailable')
                if case == 'still-present':
                    return subprocess.CompletedProcess(args, 0, '{}', '')
                return subprocess.CompletedProcess(args, 1, '', 'Error: No such object')
            if args[0] == 'node':
                if case == 'child-exception':
                    raise subprocess.TimeoutExpired(args, 300)
                return subprocess.CompletedProcess(args, 1 if case == 'child-failed' else 0)
            return subprocess.CompletedProcess(args, 0)

        def output(args, **kwargs):
            commands.append(args)
            if args[1:3] == ['run', '-d']:
                return 'mock-owned-container\n'
            if args[1:3] == ['inspect', '--format']:
                return json.dumps({'5432/tcp': [{'HostPort': '12345'}]})
            raise AssertionError(args)

        def unlink(path, *args, **kwargs):
            if path.name == 'private.json':
                if case == 'config-exception':
                    raise OSError('synthetic')
                if case == 'config-remaining':
                    return None
            return original_unlink(path, *args, **kwargs)

        def exists(path):
            return original_exists(path)

        with tempfile.TemporaryDirectory(prefix='effect-jobs-cleanup-') as scratch:
            with patch.object(Path, 'cwd', return_value=Path(scratch)), patch.object(os, 'environ', {}), patch.object(subprocess, 'run', run), patch.object(subprocess, 'check_output', output), patch.object(Path, 'unlink', unlink), patch.object(Path, 'exists', exists), contextlib.redirect_stdout(io.StringIO()):
                exit_code = 0
                try:
                    exec(compile(SOURCE.read_text(), str(SOURCE), 'exec'), {'__name__': '__main__'})
                except SystemExit as error:
                    exit_code = error.code
            receipt = json.loads((Path(scratch) / '.multica/task/real/owned-resource.json').read_text())
            self.assertEqual(receipt['status'], 'PASS' if case == 'success' else 'FAIL')
            self.assertEqual(exit_code, 0 if case == 'success' else 1)
            self.assertIn(['docker', 'rm', '--force', 'mock-owned-container'], commands)
            self.assertIn(['docker', 'inspect', 'mock-owned-container'], commands)
            self.assertFalse(any('synthetic' in str(value) for value in receipt.values()))
            if case not in ('config-exception', 'config-remaining'):
                self.assertTrue(receipt['privateConfigRemoved'])

    def test_all_postconditions(self):
        for case in ('success', 'child-failed', 'child-exception', 'remove-failed', 'still-present', 'inspect-failed', 'inspect-exception', 'config-remaining', 'config-exception', 'remove-exception', 'remove-timeout'):
            with self.subTest(case=case):
                self.exercise(case)


if __name__ == '__main__':
    unittest.main()
