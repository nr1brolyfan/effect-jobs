# Foreground qualification FFI. Own one disposable PG and remove its exact ID.
import datetime
import hashlib
import json
import os
import pathlib
import secrets
import signal
import shutil
import subprocess
import time

root = pathlib.Path(__file__).resolve().parents[3]
out = root / '.toolchain/creation-time'
out.mkdir(parents=True, exist_ok=True)
image = 'postgres:16.15-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'
now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
deadline = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=10)).isoformat()
receipt = {'issue': 'UPVE-2486', 'startedAt': now(), 'deadline': deadline, 'image': image, 'gates': [], 'status': 'FAIL'}
docker = 'docker'
if shutil.which('docker.exe'):
    try:
        if subprocess.run([docker, 'version', '--format', '{{.Server.Version}}'], capture_output=True, timeout=10).returncode:
            docker = 'docker.exe'
    except (OSError, subprocess.TimeoutExpired):
        docker = 'docker.exe'
private = out / ('private-' + secrets.token_hex(8) + '.json')
cid = None
password = secrets.token_hex(32)
try:
    env = os.environ.copy()
    env.update(POSTGRES_USER='creation_probe', POSTGRES_DB='creation_probe', POSTGRES_PASSWORD=password)
    if docker.endswith('.exe'):
        env['WSLENV'] = ':'.join(filter(None, [env.get('WSLENV', ''), 'POSTGRES_USER', 'POSTGRES_DB', 'POSTGRES_PASSWORD']))
    cid = subprocess.check_output([docker, 'create', '--label', 'task=UPVE-2486', '--label', 'deadline='+deadline,
        '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data:rw',
        '-e', 'POSTGRES_USER', '-e', 'POSTGRES_DB', '-e', 'POSTGRES_PASSWORD', image], env=env, text=True, timeout=30).strip()
    receipt.update(containerId=cid, dockerClient=docker)
    subprocess.run([docker, 'start', cid], check=True, capture_output=True, timeout=30)
    ports = json.loads(subprocess.check_output([docker, 'inspect', '--format', '{{json .NetworkSettings.Ports}}', cid], text=True, timeout=10))
    assert ports['5432/tcp'][0]['HostIp'] == '127.0.0.1'
    receipt['ports'] = ports
    for _ in range(40):
        if subprocess.run([docker, 'exec', cid, 'pg_isready', '-U', 'creation_probe', '-d', 'creation_probe'], capture_output=True, timeout=5).returncode == 0:
            break
        time.sleep(0.25)
    else:
        raise RuntimeError('bounded PG readiness failed')
    cfg = {'user': 'creation_probe', 'database': 'creation_probe', 'password': password,
        'port': int(ports['5432/tcp'][0]['HostPort']), 'schema': 'creation_browser',
        **{key: secrets.token_hex(32) for key in ['encryptionKey', 'fingerprintKey', 'cursorKey']}}
    with os.fdopen(os.open(private, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as stream:
        json.dump(cfg, stream)
    testenv = {**os.environ, 'CREATION_TIME_PRIVATE_CONFIG': str(private),
        'PLAYGROUND_PRIVATE_CONFIG': str(private), 'PLAYGROUND_EVIDENCE_DIRECTORY': str(out)}
    gates = [
        ('postgresql', ['node', 'node_modules/vitest/vitest.mjs', 'run', 'tests/postgresql/CreationTime.test.ts']),
        ('browser', ['node', 'apps/playground-worker/tests/integration/CreationTime.mjs'])
    ]
    for label, command in gates:
        started = now()
        process = subprocess.Popen(command, cwd=root, env=testenv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
        try:
            stdout, stderr = process.communicate(timeout=240)
        finally:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            if process.poll() is None:
                process.wait(timeout=10)
            for _ in range(40):
                try:
                    os.killpg(process.pid, 0)
                except ProcessLookupError:
                    break
                time.sleep(0.05)
            else:
                os.killpg(process.pid, signal.SIGKILL)
                raise RuntimeError('child process group remained after cleanup')
        log = (stdout or '') + (stderr or '')
        for secret in [password, cfg['encryptionKey'], cfg['fingerprintKey'], cfg['cursorKey']]:
            log = log.replace(secret, '[REDACTED]')
        (out / (label + '.log')).write_text(log)
        receipt['gates'].append({'label': label, 'command': command, 'exit': process.returncode,
            'startedAt': started, 'finishedAt': now(), 'childProcessGroupAbsent': True, 'logSha256': hashlib.sha256(log.encode()).hexdigest()})
        print(label + ': ' + str(process.returncode), flush=True)
        if process.returncode:
            raise RuntimeError(label + ' failed')
    receipt['status'] = 'PASS'
except Exception as error:
    receipt['failureClass'] = type(error).__name__
finally:
    if cid:
        removed = subprocess.run([docker, 'rm', '--force', cid], capture_output=True, text=True, timeout=30)
        absent = subprocess.run([docker, 'inspect', '--format', '{{.Id}}', cid], capture_output=True, text=True, timeout=10)
        receipt['cleanup'] = {'exit': removed.returncode, 'absentVerified': absent.returncode != 0 and 'no such object' in absent.stderr.lower()}
        if not receipt['cleanup']['absentVerified']:
            receipt['status'] = 'FAIL'
    private.unlink(missing_ok=True)
    receipt['privateConfigRemoved'] = not private.exists()
    receipt['finishedAt'] = now()
    (out / 'resource-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt, indent=2))
    if receipt['status'] != 'PASS':
        raise SystemExit(1)
