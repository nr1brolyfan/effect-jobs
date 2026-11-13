# Foreground qualification FFI. One disposable resource, exact-ID cleanup, no config reuse.
import datetime
import json
import os
import pathlib
import secrets
import subprocess
import time
import sys
import OwnedProcesses

root = pathlib.Path(__file__).resolve().parents[4]
evidence = root / os.environ.get('PLAYGROUND_EVIDENCE_DIRECTORY', '.multica/react-qualification')
evidence.mkdir(parents=True, exist_ok=True)
image = 'postgres:16.15-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'
now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
receipt = {'owner': 'UPVE-2010', 'startedAt': now(), 'image': image, 'storage': 'tmpfs', 'status': 'FAIL'}
cid = None
private = evidence / ('private-' + secrets.token_hex(8) + '.json')
try:
    env = os.environ.copy()
    env.update(POSTGRES_USER='react_probe', POSTGRES_DB='react_probe', POSTGRES_PASSWORD=secrets.token_hex(32))
    cid = subprocess.check_output(['docker', 'create', '--label', 'task=UPVE-2010', '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data:rw', '-e', 'POSTGRES_USER', '-e', 'POSTGRES_DB', '-e', 'POSTGRES_PASSWORD', image], env=env, text=True, timeout=30).strip()
    receipt['containerId'] = cid
    subprocess.run(['docker', 'start', cid], check=True, capture_output=True, timeout=30)
    ports = json.loads(subprocess.check_output(['docker', 'inspect', '--format', '{{json .NetworkSettings.Ports}}', cid], text=True, timeout=10))
    assert ports['5432/tcp'][0]['HostIp'] == '127.0.0.1'
    receipt['ports'] = ports
    for _ in range(40):
        ready = subprocess.run(['docker', 'exec', cid, 'pg_isready', '-U', 'react_probe', '-d', 'react_probe'], capture_output=True, timeout=5)
        if ready.returncode == 0:
            break
        time.sleep(0.25)
    else:
        raise RuntimeError('bounded PG readiness failed')
    cfg = {'user': env['POSTGRES_USER'], 'database': env['POSTGRES_DB'], 'password': env['POSTGRES_PASSWORD'], 'port': int(ports['5432/tcp'][0]['HostPort']), 'schema': 'react_probe', **{key: secrets.token_hex(32) for key in ['encryptionKey', 'fingerprintKey', 'cursorKey']}}
    with os.fdopen(os.open(private, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as stream:
        json.dump(cfg, stream)
    testenv = os.environ.copy()
    testenv.update(PLAYGROUND_PRIVATE_CONFIG=str(private), PLAYGROUND_EVIDENCE_DIRECTORY=str(evidence))
    with (evidence / 'runtime.log').open('w') as log:
        receipt['processCleanup'] = {}
        exit_code = OwnedProcesses.run(['node', 'apps/playground-worker/tests/integration/NativeHostQualification.ts' if '--native-host' in sys.argv else 'apps/playground-worker/tests/integration/React.ts', *(['--combined-private'] if '--combined-private' in sys.argv else [])], cwd=root, env=testenv, stdout=log, stderr=log, timeout=240, receipt=receipt['processCleanup'])
    receipt['exit'] = exit_code
    if exit_code == 0 and receipt['processCleanup']['absentVerified'] is True:
        receipt['status'] = 'PASS'
except Exception as error:
    receipt['failureClass'] = type(error).__name__
finally:
    cleanup_errors = []
    if cid:
        try:
            owned = json.loads(subprocess.check_output(['docker', 'inspect', '--format', '{{json .Config.Labels}}', cid], text=True, timeout=10))
            assert owned.get('task') == 'UPVE-2010'
            removed = subprocess.run(['docker', 'rm', '--force', cid], capture_output=True, text=True, timeout=30)
            receipt['cleanup'] = {'exit': removed.returncode}
            if removed.returncode != 0:
                cleanup_errors.append('container-removal-failed')
        except Exception as error:
            cleanup_errors.append('container-removal-' + type(error).__name__)
        try:
            absent = subprocess.run(['docker', 'inspect', '--format', '{{.Id}}', cid], capture_output=True, text=True, timeout=10)
            receipt.setdefault('cleanup', {})['absentVerified'] = absent.returncode != 0 and 'no such object' in absent.stderr.lower()
            if not receipt['cleanup']['absentVerified']:
                cleanup_errors.append('container-absence-unverified')
        except Exception as error:
            cleanup_errors.append('container-inspect-' + type(error).__name__)
    try:
        private.unlink(missing_ok=True)
        receipt['privateConfigRemoved'] = not private.exists()
        if not receipt['privateConfigRemoved']:
            cleanup_errors.append('private-config-remains')
    except Exception as error:
        receipt['privateConfigRemoved'] = False
        cleanup_errors.append('private-config-' + type(error).__name__)
    receipt['cleanupErrors'] = cleanup_errors
    if cleanup_errors:
        receipt['status'] = 'FAIL'
    receipt['finishedAt'] = now()
    (evidence / 'resource-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt, indent=2))
    if receipt['status'] != 'PASS':
        raise SystemExit(1)
