"""Finite controls for the actual qualification wrapper, without shared Docker faults."""
import ast
import json
import os
import pathlib
import subprocess
import sys
import tempfile
from unittest.mock import patch

source = pathlib.Path(__file__).with_name('RunQualification.py')
root = source.resolve().parents[4]
out = root / '.qualification/resource-controls'
out.mkdir(parents=True, exist_ok=True)
tree = ast.parse(source.read_text())
# Execute the actual definitions, but not the top-level resource acquisition.
cut = next(i for i, n in enumerate(tree.body) if isinstance(n, ast.Try))
ns = {'__file__': str(source)}
exec(compile(ast.Module(body=tree.body[:cut], type_ignores=[]), str(source), 'exec'), ns)
receipts = []


def absent(pid):
    return not pathlib.Path('/proc', str(pid)).exists()


# Both timeout and successful-parent/error exits must collect a detached child.
with tempfile.TemporaryDirectory(dir=out) as temp:
    temp = pathlib.Path(temp)
    child = temp / 'child.py'
    child.write_text('import time,signal\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\ntime.sleep(60)\n')
    parent = temp / 'parent.py'
    parent.write_text('import pathlib,subprocess,sys,time\np=subprocess.Popen([sys.executable,sys.argv[1]],start_new_session=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)\npathlib.Path(sys.argv[2]).write_text(str(p.pid))\ntime.sleep(.2)\nif sys.argv[3]=="timeout":time.sleep(60)\nraise SystemExit(7 if sys.argv[3]=="error" else 0)\n')
    for mode in ['timeout', 'success', 'error']:
        marker = temp / (mode + '.pid')
        try:
            result = ns['call']([sys.executable, str(parent), str(child), str(marker), mode], timeout=.5)
        except subprocess.TimeoutExpired:
            assert mode == 'timeout'
        else:
            assert mode != 'timeout'
            assert result.returncode == (7 if mode == 'error' else 0)
        pid = int(marker.read_text())
        assert absent(pid), (mode, pid)
        assert ns['r']['process_cleanup'][-1]['absent_verified']
        receipts.append({'control': mode, 'detached_child_pid': pid, 'absent_verified': True})
    try:
        ns['call']([str(temp/'does-not-exist')])
    except FileNotFoundError:
        receipts.append({'control': 'spawn-error', 'original_error_preserved': True})
    else:
        raise AssertionError('missing executable must fail')

# Original F2 full-runner reproduction: execute the actual acquisition, all three
# success gate commands, and finally/exit. Double only the external command boundary.
for mode in ['success', 'rm-fails-present', 'rm-fails-absent', 'inspect-unknown', 'rm-error', 'inspect-error', 'private-error', 'gate-error', 'process-cleanup-error']:
    with tempfile.TemporaryDirectory(dir=out) as temp:
        script = pathlib.Path(temp)/'apps/playground-worker/tests/integration/RunQualification.py'
        script.parent.mkdir(parents=True)
        local = {'__file__': str(script)}
        exec(compile(ast.Module(body=tree.body[:cut], type_ignores=[]), str(source), 'exec'), local)
        commands = []
        def call(args, env=None, timeout=60):
            commands.append(args)
            code, stdout, stderr = 0, '', ''
            if args[:2] == ['docker', 'create']:
                stdout = 'task-control-cid\n'
            elif args[:2] == ['docker', 'rm']:
                if mode == 'rm-error': raise OSError('synthetic boundary failure')
                code = 1 if mode.startswith('rm-fails') else 0
            elif args[:2] == ['docker', 'inspect']:
                if 'Ports' in args[3]:
                    stdout = json.dumps({'5432/tcp': [{'HostPort': '5432'}]})
                else:
                    if mode == 'inspect-error': raise OSError('synthetic boundary failure')
                    code = 0 if mode == 'rm-fails-present' else 1
                    stderr = '' if mode in ['rm-fails-present', 'inspect-unknown'] else 'Error: No such object: task-control-cid'
            elif args[0] == 'node' and mode == 'process-cleanup-error':
                local['r'].setdefault('process_cleanup', []).append({'absent_verified': False})
                raise local['ResourceCleanupError']('synthetic process cleanup failure')
            elif args[0] == 'node' and mode == 'gate-error':
                raise subprocess.TimeoutExpired(args, timeout)
            return subprocess.CompletedProcess(args, code, stdout, stderr)
        local['call'] = call
        original_unlink = pathlib.Path.unlink
        def unlink(path, *args, **kwargs):
            if mode == 'private-error' and path == local['private']:
                raise PermissionError('synthetic private cleanup failure')
            return original_unlink(path, *args, **kwargs)
        with patch.object(pathlib.Path, 'unlink', unlink):
            try:
                exec(compile(ast.Module(body=tree.body[cut:], type_ignores=[]), str(source), 'exec'), local)
            except SystemExit as error:
                exitcode = error.code
        receipt = json.loads((local['base']/'runtime-resource.json').read_text())
        assert receipt['status'] == ('PASS' if mode == 'success' else 'FAIL'), mode
        assert exitcode == (0 if mode == 'success' else 1), mode
        if mode not in ['gate-error', 'process-cleanup-error']:
            assert [a[0] for a in commands].count('node') == 3
        else:
            assert receipt['failure_class'] == ('TimeoutExpired' if mode == 'gate-error' else 'ResourceCleanupError')
        assert any(a[:2] == ['docker','rm'] and a[-1] == 'task-control-cid' for a in commands)
        assert any(a[:2] == ['docker','inspect'] and a[-1] == 'task-control-cid' for a in commands)
        assert receipt['private_config_removed'] == (mode != 'private-error')
        receipts.append({'control': mode, 'status': receipt['status'], 'exit': exitcode, 'cleanup_errors': receipt['cleanup_errors'], 'absence': receipt.get('absent_verified')})

(out/'receipt.json').write_text(json.dumps({'controls': receipts, 'process_cleanup': ns['r'].get('process_cleanup')}, indent=2)+'\n')
print(json.dumps({'controls_passed': len(receipts)}))
