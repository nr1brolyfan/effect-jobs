# Foreground qualification tooling owns only its exact disposable PG container.
import datetime
import hashlib
import json
import os
import pathlib
import secrets
import subprocess
import time

root = pathlib.Path(__file__).resolve().parents[3]
out = root / '.toolchain/observability/postgres'
out.mkdir(parents=True, exist_ok=True)
image = 'postgres:16.15-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'
now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
deadline = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=15)).isoformat()
labels = {'project': '52ccc13e-4995-4a3f-be37-6f4cf6bebe3e', 'issue': 'UPVE-2740', 'owner': 'observability-qualification', 'deadline': deadline}
receipt = {'startedAt': now(), 'deadline': deadline, 'gates': [], 'status': 'FAIL'}
password = secrets.token_hex(32)
cid = None
try:
    env = {**os.environ, 'POSTGRES_USER': 'observability_probe', 'POSTGRES_DB': 'effect_jobs_d6', 'POSTGRES_PASSWORD': password}
    command = ['docker', 'create', '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data:rw', '-e', 'POSTGRES_USER', '-e', 'POSTGRES_DB', '-e', 'POSTGRES_PASSWORD']
    for key, value in labels.items():
        command += ['--label', key + '=' + value]
    cid = subprocess.check_output(command + [image], env=env, text=True, timeout=30).strip()
    subprocess.run(['docker', 'start', cid], check=True, capture_output=True, timeout=30)
    actual = json.loads(subprocess.check_output(['docker', 'inspect', '--format', '{{json .}}', cid], text=True, timeout=10))
    ports = actual['NetworkSettings']['Ports']
    assert ports['5432/tcp'][0]['HostIp'] == '127.0.0.1'
    record = {'container_id': cid, 'image': actual['Image'], 'labels': labels, 'deadline': deadline, 'ports': ports}
    (out / 'ownership.json').write_text(json.dumps(record))
    private = out / 'postgres.env'
    with os.fdopen(os.open(private, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as stream:
        stream.write('POSTGRES_USER=observability_probe\nPOSTGRES_DB=effect_jobs_d6\nPOSTGRES_PASSWORD=' + password + '\n')
    for _ in range(40):
        if subprocess.run(['docker', 'exec', cid, 'pg_isready', '-U', 'observability_probe', '-d', 'effect_jobs_d6'], capture_output=True, timeout=5).returncode == 0:
            break
        time.sleep(0.25)
    else:
        raise RuntimeError('bounded PG readiness failed')
    config = out / 'private-config.json'
    with os.fdopen(os.open(config, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as stream:
        json.dump({'user': 'observability_probe', 'database': 'effect_jobs_d6', 'password': password, 'port': int(ports['5432/tcp'][0]['HostPort']), 'host': '127.0.0.1'}, stream)
    testenv = {**os.environ, 'D6_RESOURCE_DIRECTORY': str(out), 'CREATION_TIME_PRIVATE_CONFIG': str(config), 'OPERATORS_PG_CONFIG_FILE': str(config)}
    gates = [
        ('source-node', ['bun', 'run', 'test:postgresql:node'], {'PG_EVIDENCE_FILE': str(out / 'node-evidence.json')}),
        ('source-bun', ['bun', 'run', 'test:postgresql:bun'], {'PG_EVIDENCE_FILE': str(out / 'bun-evidence.json')})
    ]
    if os.environ.get('EFFECT_JOBS_ARCHIVE'):
        gates += [
            ('installed', ['node', 'scripts/qualify-postgresql.mjs'], {}),
            ('native', ['node', 'tests/qualification/drizzle-native/Run.mjs'], {})
        ]
    for label, command, extra in gates:
        started = now()
        result = subprocess.run(command, cwd=root, env={**testenv, **extra}, capture_output=True, text=True, timeout=240)
        log = (result.stdout + result.stderr).replace(password, '[REDACTED]')
        (out / (label + '.log')).write_text(log)
        receipt['gates'].append({'name': label, 'command': command, 'exit': result.returncode, 'startedAt': started, 'finishedAt': now(), 'logSha256': hashlib.sha256(log.encode()).hexdigest()})
        print(label + ': ' + str(result.returncode), flush=True)
    receipt['status'] = 'PASS' if all(gate['exit'] == 0 for gate in receipt['gates']) else 'FAIL'
finally:
    if cid:
        removed = subprocess.run(['docker', 'rm', '--force', cid], capture_output=True, timeout=30)
        absent = subprocess.run(['docker', 'inspect', cid], capture_output=True, timeout=10)
        receipt['cleanup'] = {'container': cid, 'removed': removed.returncode == 0, 'absent': absent.returncode != 0 and b'no such object' in absent.stderr.lower()}
        if not receipt['cleanup']['removed'] or not receipt['cleanup']['absent']:
            receipt['status'] = 'FAIL'
    (out / 'postgres.env').unlink(missing_ok=True)
    (out / 'private-config.json').unlink(missing_ok=True)
    receipt['privateConfigRemoved'] = not (out / 'postgres.env').exists()
    receipt['finishedAt'] = now()
    (out / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(receipt['status'], flush=True)
if receipt['status'] != 'PASS':
    raise SystemExit(1)
