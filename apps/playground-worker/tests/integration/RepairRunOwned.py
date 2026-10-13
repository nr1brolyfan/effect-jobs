"""Finite qualification FFI; one exact-ID PG resource, foreground cleanup."""
import datetime
import hashlib
import json
import os
import pathlib
import secrets
import socket
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parents[4]
out = root / '.toolchain/repair-continuation'
out.mkdir(parents=True, exist_ok=True)
now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
deadline = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=60)).isoformat()
env = os.environ.copy()
# Process-local WSL interoperability transport; never change Docker context.
env['WSL_INTEROP'] = env.get('REPAIR_WSL_INTEROP', env.get('WSL_INTEROP', ''))
image = 'postgres:16.15-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'
receipt = {'startedAt': now(), 'deadline': deadline, 'imageReference': image,
           'dockerClient': 'docker.exe', 'wslInterop': env['WSL_INTEROP'], 'gates': []}
cid = None
private = []
secret_values = []

def call(args, timeout=30, extra=None):
    return subprocess.run(args, cwd=root, env={**env, **(extra or {})},
                          capture_output=True, text=True, timeout=timeout)

def gate(label, args, extra=None, timeout=600):
    start = now()
    inputs = {
        str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in [pathlib.Path(__file__), out / 'RepairPg.mjs',
                     root / 'apps/playground-worker/dist/Worker.js',
                     root / 'apps/website/dist/Client.js', root / 'apps/website/dist/Jobs.css']
        if path.is_file()
    }
    try:
        result = call(args, timeout, extra)
        text = (result.stdout or '') + (result.stderr or '')
        for secret in secret_values:
            text = text.replace(secret, '[REDACTED]')
        (out / (label + '.log')).write_text(text)
        row = {'label': label, 'command': args, 'start': start, 'end': now(),
               'exit': result.returncode, 'inputs': inputs,
               'logSha256': hashlib.sha256(text.encode()).hexdigest()}
    except subprocess.TimeoutExpired:
        row = {'label': label, 'command': args, 'start': start, 'end': now(), 'exit': 'timeout'}
    receipt['gates'].append(row)
    (out / 'resource-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(label + ': ' + str(row['exit']), flush=True)
    return row['exit'] == 0

def write_private(name, content):
    path = out / name
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(content)
    private.append(path)
    receipt.setdefault('privateInputHashes', {})[name] = hashlib.sha256(content.encode()).hexdigest()
    return str(path)

try:
    version = call(['docker.exe', 'info', '--format', '{{.ServerVersion}}'])
    assert version.returncode == 0
    receipt['dockerServer'] = version.stdout.strip()
    password = secrets.token_hex(32)
    secret_values.append(password)
    pg = {'POSTGRES_USER': 'qualification', 'POSTGRES_DB': 'effect_jobs_d6', 'POSTGRES_PASSWORD': password}
    labels = {'project': '52ccc13e-4995-4a3f-be37-6f4cf6bebe3e', 'issue': 'UPVE-2151',
              'owner': '4db2ab95-49f8-43f8-aa5b-adda16e76a53', 'deadline': deadline}
    args = ['docker.exe', 'create', '--name', 'upve-2151-repair-' + secrets.token_hex(6),
            '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data:rw']
    for key, value in labels.items():
        args += ['--label', key + '=' + value]
    credential_file = write_private('docker.env', ''.join(k + '=' + v + '\n' for k, v in pg.items()))
    windows_file = call(['wslpath', '-w', credential_file]).stdout.strip()
    created = call(args + ['--env-file', windows_file, image], 120)
    assert created.returncode == 0, 'exact owned resource creation failed'
    cid = created.stdout.strip()
    receipt['containerId'] = cid
    assert call(['docker.exe', 'start', cid]).returncode == 0
    gate('affected-playground-types', ['bun', 'run', 'playground:check'])
    gate('affected-playground-build', ['bun', 'run', 'playground:build'])

    inspected = call(['docker.exe', 'inspect', '--format', '{{json .}}', cid])
    receipt['inspect'] = {'exit': inspected.returncode, 'stdoutBytes': len(inspected.stdout), 'stderr': inspected.stderr}
    actual = json.loads(inspected.stdout)
    ports = actual['NetworkSettings']['Ports']
    assert ports['5432/tcp'][0]['HostIp'] == '127.0.0.1'
    receipt['imageId'] = actual['Image']
    receipt['ports'] = ports
    (out / 'ownership.json').write_text(json.dumps({'container_id': cid, 'image': actual['Image'],
        'labels': labels, 'ports': ports, 'deadline': deadline}, indent=2) + '\n')
    write_private('postgres.env', ''.join(k + '=' + v + '\n' for k, v in pg.items()))
    receipt['stage'] = 'bounded readiness'
    gate('owned-warning-lint', ['node_modules/.bin/oxlint', '--deny-warnings', 'apps/playground-worker/src/demo/Http.ts', 'apps/playground-worker/src/demo/RepairShowcase.ts', 'apps/playground-worker/src/persistence/SyntheticTenantBackfill.ts'])
    # One exact-resource readiness probe after independent setup work.
    ready = call(['docker.exe', 'exec', cid, 'pg_isready', '-t', '10', '-U', 'qualification', '-d', 'effect_jobs_d6'], 15)
    receipt['readiness'] = {'exit': ready.returncode, 'response': ready.stdout.strip()}
    if ready.returncode != 0:
        state = call(['docker.exe','inspect','--format','{{json .State}}',cid])
        receipt['readinessState'] = json.loads(state.stdout)
        logs = call(['docker.exe','logs','--tail','30',cid])
        logtext = logs.stdout + logs.stderr
        for secret in secret_values: logtext = logtext.replace(secret, '[REDACTED]')
        (out/'postgres-startup.log').write_text(logtext)
    assert ready.returncode == 0, 'bounded PG readiness failed'
    receipt['stage'] = 'WSL loopback probe'
    port = int(ports['5432/tcp'][0]['HostPort'])
    with socket.create_connection(('127.0.0.1', port), timeout=3):
        pass
    receipt['wslLoopbackReachable'] = True
    config = {'host': '127.0.0.1', 'port': port, 'user': pg['POSTGRES_USER'],
              'password': password, 'database': pg['POSTGRES_DB'], 'schema': 'repair_integrated'}
    for key in ['encryptionKey', 'fingerprintKey', 'cursorKey']:
        config[key] = secrets.token_hex(32)
        secret_values.append(config[key])
    cfg = write_private('config.json', json.dumps(config))
    adapter = out / 'bin'
    adapter.mkdir(exist_ok=True)
    (adapter / 'docker').write_text('#!/usr/bin/env python3\nimport os,subprocess,sys\nr=subprocess.run(["docker.exe",*sys.argv[1:]],capture_output=True,env=os.environ,timeout=15)\nsys.stdout.buffer.write(r.stdout)\nsys.stderr.buffer.write(r.stderr)\nsys.exit(r.returncode)\n')
    (adapter / 'docker').chmod(0o700)
    env.update(PATH=str(adapter) + ':' + env['PATH'], D6_RESOURCE_DIRECTORY=str(out),
               OPERATORS_PG_CONFIG_FILE=cfg, PLAYGROUND_PRIVATE_CONFIG=cfg,
               EFFECT_JOBS_ARCHIVE=str(out / 'effect-jobs-0.1.0-alpha.1.tgz'))
    # Rerun only missing gates; completed receipts are retained separately.
    if env.get('REPAIR_PHASE') != 'recorded':
        for runtime in ['node', 'bun']:
            gate(runtime + '-operators-pg', [runtime, *(['--bun'] if runtime == 'bun' else []),
                 'node_modules/vitest/vitest.mjs', 'run', '--config', 'tests/postgresql/vitest.config.ts',
                 'tests/postgresql/operators/Operators.test.ts'], {'PG_EXPECT_RUNTIME': runtime})
        ambient = env.get('REPAIR_AMBIENT_PROGRAM')
        if ambient:
            gate('native-bun-ambient', ['bun', ambient], {'AMBIENT_EVIDENCE_FILE': str(out/'bun-ambient-evidence.json')})
        else:
            gate('native-packed', ['node', 'tests/qualification/drizzle-native/Run.mjs'])
        gate('installed-pg', ['node', 'scripts/qualify-postgresql.mjs'])
        gate('app-pg', ['node', str(out / 'RepairPg.mjs')])
    gate('combined-pg-workerd-browser', ['node', 'apps/playground-worker/tests/integration/RepairCombined.mjs'])
except Exception as error:
    receipt['failureClass'] = type(error).__name__
    receipt['failureStage'] = receipt.get('stage','resource creation')
    print('resource: ' + type(error).__name__, flush=True)
finally:
    if cid:
        removed = call(['docker.exe', 'rm', '--force', cid])
        absent = call(['docker.exe', 'inspect', '--format', '{{.Id}}', cid])
        receipt['cleanup'] = {'exit': removed.returncode, 'removedId': removed.stdout.strip(),
                              'inspectExit': absent.returncode, 'absentVerified': ('no such object' in absent.stderr.lower() or 'no such container' in absent.stderr.lower())}
    for path in private:
        path.unlink(missing_ok=True)
    receipt['privateFilesRemoved'] = all(not path.exists() for path in private)
    receipt['finishedAt'] = now()
    (out / 'resource-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print('cleanup: ' + str(receipt.get('cleanup')), flush=True)
    if receipt.get('failureClass'):
        sys.exit(1)
