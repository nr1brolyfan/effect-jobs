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
out = root / os.environ.get('DEMO_UNLOCK_OUTPUT_DIRECTORY', '.toolchain/demo-unlock')
out.mkdir(parents=True, exist_ok=True)
now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
deadline = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=10)).isoformat()
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
    paths = [path for folder in ['src', 'packages/playground-contracts/src',
             'apps/playground-worker/src', 'apps/website/src',
             'apps/playground-worker/tests/integration', 'apps/playground-worker/tests/repairs']
             for path in (root / folder).rglob('*') if path.is_file() and '__pycache__' not in path.parts]
    paths += [root / name for name in ['package.json', 'bun.lock', 'tsconfig.playground.json',
              'apps/playground-worker/tsconfig.json', 'apps/website/tsconfig.json',
              '.oxfmtrc.json', 'apps/playground-worker/package.json', 'apps/website/package.json']]
    paths += [out / 'BaselinePg.mjs', out / 'RepairPg.mjs',
              root / 'apps/playground-worker/dist/Worker.js',
              root / 'apps/website/dist/Client.js', root / 'apps/website/dist/Jobs.css']
    inputs = {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
              for path in paths if path.is_file()}
    try:
        result = call(args, timeout, extra)
        text = (result.stdout or '') + (result.stderr or '')
        for secret in secret_values:
            text = text.replace(secret, '[REDACTED]')
        (out / (label + '.log')).write_text(text[:131072])
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
    receipt['runtime'] = {name: call(args).stdout.strip() for name, args in {
        'node': ['node', '--version'], 'bun': ['bun', '--version'],
        'dockerClient': ['docker.exe', '--version']}.items()}
    password = secrets.token_hex(32)
    secret_values.append(password)
    pg = {'POSTGRES_USER': 'qualification', 'POSTGRES_DB': 'effect_jobs_d6', 'POSTGRES_PASSWORD': password}
    labels = {'project': '52ccc13e-4995-4a3f-be37-6f4cf6bebe3e', 'issue': 'UPVE-2187',
              'owner': '4db2ab95-49f8-43f8-aa5b-adda16e76a53', 'deadline': deadline}
    args = ['docker.exe', 'create', '--name', 'upve-2187-unlock-' + secrets.token_hex(6),
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

    inspected = call(['docker.exe', 'inspect', '--format', '{{json .}}', cid])
    receipt['inspect'] = {'exit': inspected.returncode, 'stdoutBytes': len(inspected.stdout), 'stderr': inspected.stderr}
    actual = json.loads(inspected.stdout)
    ports = actual['NetworkSettings']['Ports']
    assert ports['5432/tcp'][0]['HostIp'] == '127.0.0.1'
    receipt['imageId'] = actual['Image']
    receipt['ports'] = ports
    (out / 'ownership.json').write_text(json.dumps({'container_id': cid, 'image': actual['Image'],
        'labels': labels, 'ports': ports, 'deadline': deadline}, indent=2) + '\n')
    receipt['stage'] = 'bounded readiness'

    # One exact-resource readiness probe after independent setup work.
    ready = call(['docker.exe', 'exec', cid, 'sh', '-c', 'for n in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do pg_isready -h 127.0.0.1 -t 1 -U qualification -d effect_jobs_d6 && exit 0; sleep 0.5; done; exit 1'], 20)
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
    env.update(D6_RESOURCE_DIRECTORY=str(out), PLAYGROUND_PRIVATE_CONFIG=cfg)
    gate('demo-unlock', ['node', 'apps/playground-worker/tests/integration/DemoUnlock.mjs'])
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
    if receipt.get('failureClass') or any(row['exit'] != 0 for row in receipt['gates']):
        sys.exit(1)
