import json, os, pathlib, secrets, subprocess, time, socket
root = pathlib.Path(__file__).resolve().parents[4]
evidence = root / os.environ.get('PLAYGROUND_EVIDENCE_DIRECTORY', '.multica/c1')
evidence.mkdir(parents=True, exist_ok=True)
snapshot = root / 'apps/playground-worker/tests/integration'
docker = '/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe'
image = 'postgres:16.15-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'
cfg_path = evidence / ('private-' + secrets.token_hex(8) + '.json')
receipt = {'owner': 'UPVE-2111 C1 original-author fix', 'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(), 'image': image}
cid = None
try:
    env = os.environ.copy()
    env.update(POSTGRES_USER='counter_probe', POSTGRES_DB='counter_probe', POSTGRES_PASSWORD=secrets.token_hex(32))
    env['WSLENV'] = ':'.join(filter(None, [env.get('WSLENV', ''), 'POSTGRES_USER/w', 'POSTGRES_DB/w', 'POSTGRES_PASSWORD/w']))
    cid = subprocess.check_output([docker, 'create', '--label', 'task=UPVE-2111-c1', '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data:rw', '-e', 'POSTGRES_USER', '-e', 'POSTGRES_DB', '-e', 'POSTGRES_PASSWORD', image], env=env, text=True, timeout=30).strip()
    receipt['containerId'] = cid
    subprocess.run([docker, 'start', cid], check=True, capture_output=True, timeout=30)
    ports = json.loads(subprocess.check_output([docker, 'inspect', '--format', '{{json .NetworkSettings.Ports}}', cid], text=True, timeout=10))
    assert ports['5432/tcp'][0]['HostIp'] == '127.0.0.1'
    receipt['ports'] = ports
    for _ in range(40):
        if subprocess.run([docker, 'exec', cid, 'pg_isready', '-U', 'counter_probe'], capture_output=True, timeout=5).returncode == 0: break
        time.sleep(0.25)
    else: raise RuntimeError('PG readiness timeout')
    port = ports['5432/tcp'][0]['HostPort']
    cfg = {'connectionString': f"postgres://counter_probe:{env['POSTGRES_PASSWORD']}@127.0.0.1:{port}/counter_probe", **{key: secrets.token_hex(32) for key in ['encryptionKey', 'fingerprintKey', 'cursorKey']}}
    with os.fdopen(os.open(cfg_path, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600), 'w') as stream: json.dump(cfg, stream)
    testenv = os.environ.copy()
    testenv['PLAYGROUND_PRIVATE_CONFIG'] = str(cfg_path)
    testenv['DEMO_COUNTER_PROBE'] = str(evidence / 'DemoCounterProbe.mjs')
    with (evidence / 'demo-counter.log').open('w') as log:
        result = subprocess.run(['node', 'DemoCounter.mjs'], cwd=snapshot, env=testenv, stdout=log, stderr=log, timeout=60)
    receipt['exit'] = result.returncode
finally:
    if cid:
        receipt['removeExit'] = subprocess.run([docker, 'rm', '--force', cid], capture_output=True, timeout=30).returncode
        receipt['containerAbsent'] = subprocess.run([docker, 'inspect', '--format', '{{.Id}}', cid], capture_output=True, timeout=10).returncode != 0
        if 'ports' in receipt:
            try:
                with socket.create_connection(('127.0.0.1', int(receipt['ports']['5432/tcp'][0]['HostPort'])), timeout=1): pass
            except OSError: receipt['portClosed'] = True
            else: receipt['portClosed'] = False
    cfg_path.unlink(missing_ok=True)
    receipt['privateConfigRemoved'] = not cfg_path.exists()
    (evidence / 'demo-counter-receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
raise SystemExit(receipt.get('exit', 1))
