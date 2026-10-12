# Foreground native resource FFI; exact-ID cleanup on every exit, no existing DB access.
import subprocess, json, secrets, os, pathlib, datetime, hashlib, time, sys, shutil
root = pathlib.Path(__file__).resolve().parents[4]
evidence = root / '.multica/integration'
evidence.mkdir(parents=True, exist_ok=True)
image = 'postgres:16.15-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'
now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
preview = '--preview' in sys.argv
expiry = None if preview else os.environ.get('PLAYGROUND_DEADLINE', '2026-10-11T22:18:50Z')
receipt = {'owner':'UPVE-1872 / Implementor','startedAt':now(),'expiry':expiry,'image':image,'storage':'tmpfs; no volume','commands':[]}
cid = None
docker = os.environ.get('DOCKER_BIN', 'docker')
# Docker Desktop can be available through its Windows client before WSL integration
# reconnects the Linux socket. Do not change the user's global Docker context.
if docker == 'docker' and shutil.which('docker.exe'):
    try:
        probe = subprocess.run([docker, 'version', '--format', '{{.Server.Version}}'], capture_output=True, text=True, timeout=10)
        if probe.returncode != 0: docker = 'docker.exe'
    except (OSError, subprocess.TimeoutExpired):
        docker = 'docker.exe'
receipt['dockerClient'] = docker
private = evidence / ('private-' + secrets.token_hex(6) + '.json')
def run(label, args, env=None, timeout=60):
    start = now()
    result = subprocess.run(args, cwd=root, env=env, stdout=None if label=='preview' else subprocess.PIPE, stderr=None if label=='preview' else subprocess.PIPE, text=True, timeout=timeout)
    receipt['commands'].append({'label':label,'start':start,'end':now(),'exit':result.returncode})
    if label not in ['create','port','preview']:
        (evidence / (label+'.log')).write_text((result.stdout or '')+(result.stderr or ''))
    if label=='preview' and result.returncode in [-2,-15,130,143]:
        receipt.update(status='Stopped',reason='manual preview shutdown')
    elif result.returncode: raise RuntimeError(label+' failed; see bounded evidence')
    return (result.stdout or '').strip()
try:
    deadline = None if preview else datetime.datetime.fromisoformat(expiry.replace('Z','+00:00'))
    if not preview and datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=8)>deadline: raise RuntimeError('insufficient finite resource window')
    previous = ['31d8e343ea817a4504b93f912759b36ec3057813e7e70b2482a810a1dbacca37','18fd83acfe26704faa4fa4831c311fc2f6506d46c9902afc86b79f09439a4eab','04a25e4d9457d93c327875341cc076cad651f6799fbf942f9c7170b8aa5fe7cf','840685eeadb8b0ef083d08dac0caae25d33c26dfa9ca1ab43e937b3769078b87','4005e807c4d3372f523f8077b8170e43e7cf3aa486e72879eed1cd3196e75a9d','22c1b1d2ca07fc7e1e58d75f3293b317bbe55fb1eefeb90ec3030526449a9f56']
    # If this integration attempt itself is continued, verify its exact previous resource.
    prior_receipt = evidence/'owned-resource-receipt.json'
    if prior_receipt.exists():
        old=json.loads(prior_receipt.read_text())
        if old.get('containerId'): previous.append(old['containerId'])
        (evidence/('prior-attempt-'+secrets.token_hex(4)+'.json')).write_text(prior_receipt.read_text())
    checks=[]
    for identifier in previous:
        r=subprocess.run([docker,'inspect','--format','{{.Id}}',identifier],capture_output=True,text=True,timeout=10)
        absent=r.returncode!=0 and 'no such object' in r.stderr.lower()
        checks.append({'id':identifier,'absent':absent})
        if not absent: raise RuntimeError('previous owned resource not absent')
    receipt['previousResources']=checks
    files=subprocess.check_output(['git','ls-files','-co','--exclude-standard','src','apps','packages/playground-contracts','package.json','bun.lock','tsconfig.playground.json'],cwd=root,text=True).splitlines()
    inputs={p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in sorted(set(files)) if (root/p).is_file()}
    (evidence/'gate-inputs.json').write_text(json.dumps(inputs,indent=2)+'\n')
    receipt['gateInputsSha256']=hashlib.sha256((evidence/'gate-inputs.json').read_bytes()).hexdigest()
    env=os.environ.copy();env.update(POSTGRES_USER='integration_probe',POSTGRES_DB='integration_probe',POSTGRES_PASSWORD=secrets.token_hex(32))
    if docker.endswith('.exe'):
        env['WSLENV']=':'.join(filter(None,[env.get('WSLENV',''),'POSTGRES_USER','POSTGRES_DB','POSTGRES_PASSWORD']))
    name='upve-1872-pg-'+secrets.token_hex(6)
    lifetime=['--label','lifetime=manual-preview'] if preview else ['--label','expires='+expiry]
    cid=run('create',[docker,'create','--name',name,'--label','task=UPVE-1872',*lifetime,'--publish','127.0.0.1::5432','--tmpfs','/var/lib/postgresql/data:rw','-e','POSTGRES_USER','-e','POSTGRES_DB','-e','POSTGRES_PASSWORD',image,'postgres','-c','shared_preload_libraries=pg_stat_statements'],env=env)
    receipt.update(containerId=cid,containerName=name,cleanupHandle=[docker,'rm','--force',cid])
    run('start',[docker,'start',cid])
    ports=json.loads(run('port',[docker,'inspect','--format','{{json .NetworkSettings.Ports}}',cid]));receipt['ports']=ports
    for attempt in range(30):
        result=subprocess.run([docker,'exec',cid,'pg_isready','-U','integration_probe','-d','integration_probe'],capture_output=True,timeout=5)
        if result.returncode==0: break
        time.sleep(0.5)
    else: raise RuntimeError('bounded readiness failed')
    receipt['readyAt']=now()
    cfg={'user':env['POSTGRES_USER'],'database':env['POSTGRES_DB'],'password':env['POSTGRES_PASSWORD'],'port':int(ports['5432/tcp'][0]['HostPort']),'schema':'integration_pg','encryptionKey':secrets.token_hex(32),'fingerprintKey':secrets.token_hex(32),'cursorKey':secrets.token_hex(32)}
    fd=os.open(private,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as out: json.dump(cfg,out)
    testenv=os.environ.copy();testenv['PLAYGROUND_PRIVATE_CONFIG']=str(private)
    if preview: testenv.pop('PLAYGROUND_DEADLINE',None)
    else: testenv['PLAYGROUND_DEADLINE']=expiry
    program='Preview.mjs' if preview else 'Demo.mjs' if '--demo-test' in sys.argv else 'Harness.mjs'
    timeout=None if preview else 450
    run('preview' if preview else 'integrated',['node','apps/playground-worker/tests/integration/'+program],env=testenv,timeout=timeout)
    receipt.setdefault('status','PASS')
except KeyboardInterrupt:
    receipt.update(status='Stopped',reason='foreground preview interrupted by caller')
except Exception as error:
    receipt.update(status='FAIL',failureClass=type(error).__name__)
finally:
    if cid:
        r=subprocess.run([docker,'rm','--force',cid],capture_output=True,text=True,timeout=30)
        receipt['cleanup']={'exit':r.returncode,'removedId':r.stdout.strip(),'at':now()}
        r=subprocess.run([docker,'inspect','--format','{{.Id}}',cid],capture_output=True,text=True,timeout=10)
        receipt['cleanup']['absentVerified']=r.returncode!=0 and 'no such object' in r.stderr.lower()
    if private.exists(): private.unlink()
    receipt['privateConfigRemoved']=not private.exists();receipt['finishedAt']=now()
    (evidence/'owned-resource-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt,indent=2))
    if receipt.get('status') not in ['PASS','Stopped']: raise SystemExit(1)
