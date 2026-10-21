# Foreground qualification FFI. One disposable resource, exact-ID cleanup, no config reuse.
import datetime
import json
import os
import pathlib
import secrets
import signal
import subprocess
import time

root = pathlib.Path(__file__).resolve().parents[4]
evidence = root / os.environ.get('PLAYGROUND_EVIDENCE_DIRECTORY', '.multica/website-qualification')
evidence.mkdir(parents=True, exist_ok=True)
image = 'postgres:16.15-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'
now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
receipt = {'deadline': (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=8)).isoformat(), 'owner': 'UPVE-2534', 'startedAt': now(), 'image': image, 'storage': 'tmpfs', 'status': 'FAIL'}
cid = None
private = evidence / ('private-' + secrets.token_hex(8) + '.json')
try:
    subprocess.run(['apps/playground-worker/node_modules/.bin/esbuild', 'apps/playground-worker/tests/integration/SchemaEntry.ts', '--bundle', '--platform=node', '--format=esm', '--external:effect', '--external:effect/*', '--external:effect-jobs/*', '--outfile=' + str(evidence / 'Migrations.mjs')], cwd=root, check=True, capture_output=True, timeout=60)
    import hashlib
    paths = ['apps/website/dist/Client.js', 'apps/website/dist/Jobs.css', 'apps/playground-worker/dist/Worker.js']
    (evidence / 'artifact-hashes.json').write_text(json.dumps({p: hashlib.sha256((root / p).read_bytes()).hexdigest() for p in paths}, indent=2))
    env = os.environ.copy()
    env.update(POSTGRES_USER='react_probe', POSTGRES_DB='react_probe', POSTGRES_PASSWORD=secrets.token_hex(32))
    cid = subprocess.check_output(['docker', 'create', '--label', 'task=UPVE-2534', '--label', 'project=52ccc13e-4995-4a3f-be37-6f4cf6bebe3e', '--label', 'deadline=' + receipt['deadline'], '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data:rw', '-e', 'POSTGRES_USER', '-e', 'POSTGRES_DB', '-e', 'POSTGRES_PASSWORD', image], env=env, text=True, timeout=30).strip()
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
        process = subprocess.Popen(['node', 'apps/website/tests/ui/RealPg.mjs'], cwd=root, env=testenv, stdout=log, stderr=log, start_new_session=True)
        try:
            exit_code = process.wait(timeout=360)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=10)
            # The node test's process group owns workerd and Chromium too.
            # A successful parent exit is insufficient if a child remains alive.
            try:
                os.killpg(process.pid, 0)
            except ProcessLookupError:
                receipt['childProcessGroupAbsent'] = True
            else:
                os.killpg(process.pid, signal.SIGTERM)
                for _ in range(40):
                    try:
                        os.killpg(process.pid, 0)
                    except ProcessLookupError:
                        receipt['childProcessGroupAbsent'] = True
                        break
                    time.sleep(0.05)
                else:
                    os.killpg(process.pid, signal.SIGKILL)
                    receipt['childProcessGroupAbsent'] = False
    receipt['exit'] = exit_code
    if exit_code == 0 and receipt.get('childProcessGroupAbsent') is True:
        receipt['status'] = 'PASS'
except Exception as error:
    receipt['failureClass'] = type(error).__name__
finally:
    if cid:
        owned = json.loads(subprocess.check_output(['docker', 'inspect', '--format', '{{json .Config.Labels}}', cid], text=True, timeout=10))
        assert owned.get('task') == 'UPVE-2534'
        removed = subprocess.run(['docker', 'rm', '--force', cid], capture_output=True, text=True, timeout=30)
        absent = subprocess.run(['docker', 'inspect', '--format', '{{.Id}}', cid], capture_output=True, text=True, timeout=10)
        receipt['cleanup'] = {'exit': removed.returncode, 'absentVerified': absent.returncode != 0 and 'no such object' in absent.stderr.lower()}
        if not receipt['cleanup']['absentVerified']:
            receipt['status'] = 'FAIL'
    private.unlink(missing_ok=True)
    receipt['privateConfigRemoved'] = not private.exists()
    receipt['finishedAt'] = now()
    (evidence / 'resource-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt, indent=2))
    if receipt['status'] != 'PASS':
        raise SystemExit(1)
