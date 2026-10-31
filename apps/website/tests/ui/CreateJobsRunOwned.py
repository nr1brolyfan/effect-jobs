# Native resource FFI; foreground bounded UI test, exact-ID cleanup, no owner DB/config.
import subprocess, pathlib, json, secrets, os, shutil, datetime, time, signal
root = pathlib.Path(__file__).resolve().parents[4]
output = root / '.multica/create-jobs/real'
output.mkdir(parents=True, exist_ok=True)
docker = 'docker'
if shutil.which('docker.exe'):
    try:
        if subprocess.run([docker, 'version', '--format', '{{.Server.Version}}'], capture_output=True, timeout=10).returncode:
            docker = 'docker.exe'
    except (OSError, subprocess.TimeoutExpired):
        docker = 'docker.exe'
image = 'postgres:16.15-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'
cid = None
child = None
private = output / ('private-' + secrets.token_hex(8) + '.json')
receipt = {'image': image, 'docker': docker, 'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
def run(args, **kwargs):
    return subprocess.run(args, cwd=root, check=True, capture_output=True, text=True, timeout=30, **kwargs).stdout.strip()
try:
    env = os.environ.copy()
    env.update(POSTGRES_USER='ux_probe', POSTGRES_DB='ux_probe', POSTGRES_PASSWORD=secrets.token_hex(32))
    if docker.endswith('.exe'):
        env['WSLENV'] = ':'.join(filter(None, [env.get('WSLENV', ''), 'POSTGRES_USER', 'POSTGRES_DB', 'POSTGRES_PASSWORD']))
    cid = run([docker, 'run', '-d', '--name', 'upve-2487-' + secrets.token_hex(6), '--label', 'task=UPVE-2487', '--tmpfs', '/var/lib/postgresql/data:rw', '--publish', '127.0.0.1::5432', '-e', 'POSTGRES_USER', '-e', 'POSTGRES_DB', '-e', 'POSTGRES_PASSWORD', image], env=env)
    receipt['containerId'] = cid
    for attempt in range(40):
        ready = subprocess.run([docker, 'exec', cid, 'pg_isready', '-U', 'ux_probe', '-d', 'ux_probe'], capture_output=True, timeout=5)
        if ready.returncode == 0: break
        time.sleep(0.25)
    else: raise RuntimeError('bounded PostgreSQL readiness failed')
    ports = json.loads(run([docker, 'inspect', '--format', '{{json .NetworkSettings.Ports}}', cid]))
    cfg = {'user': env['POSTGRES_USER'], 'database': env['POSTGRES_DB'], 'password': env['POSTGRES_PASSWORD'], 'port': int(ports['5432/tcp'][0]['HostPort']), 'schema': 'ux_probe', 'encryptionKey': secrets.token_hex(32), 'fingerprintKey': secrets.token_hex(32), 'cursorKey': secrets.token_hex(32)}
    with os.fdopen(os.open(private, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as f:
        json.dump(cfg, f)
    testenv = os.environ.copy()
    testenv['PLAYGROUND_PRIVATE_CONFIG'] = str(private)
    child = subprocess.Popen(['node', 'apps/website/tests/ui/CreateJobs.integration.mjs'], cwd=root, env=testenv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
    stdout, stderr = child.communicate(timeout=180)
    (output / 'runtime.log').write_text(stdout + stderr)
    receipt['testExit'] = child.returncode
    if child.returncode: raise RuntimeError('UI integration failed; see runtime.log')
    receipt['result'] = 'PASS'
finally:
    if child:
        # Only this run-owned process group; never daemon or executable-name kills.
        try: os.killpg(child.pid, signal.SIGTERM)
        except ProcessLookupError: pass
        try: child.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.communicate(timeout=10)
        receipt['childExit'] = child.returncode
    if cid:
        removed = run([docker, 'rm', '--force', cid])
        absent = subprocess.run([docker, 'inspect', cid], capture_output=True, text=True, timeout=15)
        receipt['cleanup'] = {'removedId': removed, 'absentVerified': absent.returncode != 0 and 'no such object' in absent.stderr.lower()}
    if private.exists(): private.unlink()
    receipt['privateConfigRemoved'] = not private.exists()
    receipt['finishedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    (output / 'resource-receipt.json').write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt))
