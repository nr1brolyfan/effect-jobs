"""Actual OS descendants, including setsid grandchildren and failed cleanup."""
import json
import os
import pathlib
import signal
import subprocess
import sys
import tempfile
from unittest.mock import patch
import OwnedProcesses

root = pathlib.Path(__file__).resolve().parents[4]
out = root / os.environ.get('PLAYGROUND_EVIDENCE_DIRECTORY', '.multica/owned-process-controls')
out.mkdir(parents=True, exist_ok=True)
receipts = []
with tempfile.TemporaryDirectory(dir=out) as temp:
    temp = pathlib.Path(temp)
    # A pre-existing unrelated child must never become owned by an invocation.
    sentinel = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
    sentinel_ticks = OwnedProcesses.process_table()[sentinel.pid][1]
    try:
        child = temp / 'child.py'
        child.write_text('import time,signal\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\ntime.sleep(60)\n')
        parent = temp / 'parent.py'
        parent.write_text('import pathlib,subprocess,sys,time\np=subprocess.Popen([sys.executable,sys.argv[1]],start_new_session=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)\npathlib.Path(sys.argv[2]).write_text(str(p.pid))\ntime.sleep(.2)\nif sys.argv[3]=="timeout":time.sleep(60)\nraise SystemExit(7 if sys.argv[3]=="error" else 0)\n')
        for mode in ['success', 'error', 'timeout']:
            receipt = {}
            marker = temp / (mode + '.pid')
            try:
                result = OwnedProcesses.run([sys.executable, str(parent), str(child), str(marker), mode],
                                            timeout=.5, receipt=receipt)
            except subprocess.TimeoutExpired:
                assert mode == 'timeout'
            else:
                assert mode != 'timeout'
                assert result == (7 if mode == 'error' else 0)
            pid = int(marker.read_text())
            assert not pathlib.Path('/proc', str(pid)).exists()
            assert receipt['absentVerified']
            assert pid in [row['pid'] for row in receipt['ownedProcesses']]
            assert sentinel.pid not in [row['pid'] for row in receipt['ownedProcesses']]
            assert sentinel.poll() is None
            receipts.append({'control': mode, **receipt})
        receipt = {}
        try:
            OwnedProcesses.run([str(temp / 'absent')], timeout=1, receipt=receipt)
        except FileNotFoundError:
            assert receipt['absentVerified']
            receipts.append({'control': 'spawn-error', **receipt})
        else:
            raise AssertionError('spawn failure must propagate')
        # Signal failure cannot be reported as absence or a successful call.
        receipt = {}
        marker = temp / 'failure.pid'
        try:
            with patch.object(OwnedProcesses.os, 'kill', side_effect=PermissionError('synthetic')):
                OwnedProcesses.run([sys.executable, str(parent), str(child), str(marker), 'success'],
                                   timeout=2, receipt=receipt)
        except OwnedProcesses.ResourceCleanupError:
            assert not receipt['absentVerified']
            assert receipt['errors'] == ['PermissionError']
            receipts.append({'control': 'cleanup-failure', **receipt})
        else:
            raise AssertionError('failed cleanup must fail the call')
        finally:
            # Recover only this test's exact child identity, never a process name.
            daemon = json.loads(subprocess.check_output(['multica', 'daemon', 'status', '--output', 'json'], text=True))['pid']
            for owned in receipt['ownedProcesses']:
                row = OwnedProcesses.process_table().get(owned['pid'])
                if row and row[1] == owned['startTicks']:
                    assert owned['pid'] not in [daemon, os.getpid(), sentinel.pid]
                    os.kill(owned['pid'], signal.SIGKILL)
                    os.waitpid(owned['pid'], 0)
        assert sentinel.poll() is None
    finally:
        row = OwnedProcesses.process_table().get(sentinel.pid)
        if row and row[1] == sentinel_ticks:
            sentinel.terminate()
        sentinel.wait(timeout=5)
(out / 'owned-process-controls.json').write_text(json.dumps(receipts, indent=2) + '\n')
print(json.dumps({'controlsPassed': len(receipts), 'unrelatedChildPreserved': True}))
