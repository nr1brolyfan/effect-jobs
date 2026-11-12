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
    # The browser imports this exact bundle; prepare it here rather than relying
    # on the README's optional manual command or another runner's evidence path.
    migration_command = [str(root / 'node_modules/.bin/esbuild'),
        'apps/playground-worker/tests/integration/SchemaEntry.ts', '--bundle',
        '--platform=node', '--format=esm', '--external:effect', '--external:effect/*',
        '--external:effect-jobs/*', '--outfile=' + str(out / 'Migrations.mjs')]
    migration_started = now()
    migration = subprocess.run(migration_command, cwd=root, capture_output=True, text=True, timeout=120)
    migration_log = (migration.stdout or '') + (migration.stderr or '')
    (out / 'migration-build.log').write_text(migration_log)
    receipt['gates'].append({'label': 'migration-build', 'command': migration_command,
        'exit': migration.returncode, 'startedAt': migration_started, 'finishedAt': now(),
        'logSha256': hashlib.sha256(migration_log.encode()).hexdigest()})
    if migration.returncode:
        raise RuntimeError('migration bundle failed')
    # Local.ts consumes the actual built provider host. Require the normal
    # playground build and record its bytes; do not synthesize a native manifest.
    native_pointer = json.loads((root / 'apps/playground-worker/dist/native.json').read_text())
    native_manifest_path = pathlib.Path(native_pointer['directory']) / 'manifest.json'
    native_manifest = json.loads(native_manifest_path.read_text())
    native_modules = {}
    if not native_manifest['modules']:
        raise RuntimeError('native build manifest has no modules')
    for module in native_manifest['modules']:
        digest = hashlib.sha256(pathlib.Path(module['path']).read_bytes()).hexdigest()
        if digest != module['sha256']:
            raise RuntimeError('native module differs from build manifest')
        native_modules[str(pathlib.Path(module['path']).relative_to(native_manifest_path.parent))] = digest
    for public_path, source_path in [('Client.js', 'apps/playground/dist/Client.js'),
                                     ('Jobs.css', 'apps/playground/dist/Jobs.css')]:
        source_bytes = (root / source_path).read_bytes()
        if (pathlib.Path(native_manifest['assets']) / public_path).read_bytes() != source_bytes:
            raise RuntimeError('native staged playground asset differs from current build')
    receipt['prerequisites'] = {
        'migrationBundleSha256': hashlib.sha256((out / 'Migrations.mjs').read_bytes()).hexdigest(),
        'migrationEntrySha256': hashlib.sha256((root / 'apps/playground-worker/tests/integration/SchemaEntry.ts').read_bytes()).hexdigest(),
        'nativeManifestSha256': hashlib.sha256(native_manifest_path.read_bytes()).hexdigest(),
        'nativeModules': native_modules,
        'clientSha256': hashlib.sha256((root / 'apps/playground/dist/Client.js').read_bytes()).hexdigest(),
        'cssSha256': hashlib.sha256((root / 'apps/playground/dist/Jobs.css').read_bytes()).hexdigest()
    }
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
