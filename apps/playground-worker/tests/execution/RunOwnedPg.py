# Native resource/process FFI. Exact-ID cleanup is foreground and always runs.
import subprocess, json, secrets, os, time, pathlib, datetime, hashlib, shutil, tempfile
root = pathlib.Path(__file__).resolve().parents[4]
evidence = pathlib.Path(os.environ.get('EXECUTOR_EVIDENCE', root / '.multica/executor-evidence'))
prepared = json.loads((evidence / 'prepared.json').read_text())
consumer = pathlib.Path(prepared['consumer'])
image = 'postgres:16.15-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'
now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
receipt = {'owner':'UPVE-2533 / Implementor','startedAt':now(),'expiry':os.environ.get('EXECUTOR_DEADLINE', (datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=10)).isoformat()),'image':image,'storage':'tmpfs; no volume','commands':[], 'inputManifestSha256':hashlib.sha256((evidence/'prepared.json').read_bytes()).hexdigest()}
cid = None
private = evidence / ('private-' + secrets.token_hex(6) + '.json')
name = 'upve-2533-pg-' + secrets.token_hex(6)
def run(label,args,cwd=None,env=None,timeout=90):
    start = now()
    result = subprocess.run(args,cwd=cwd,env=env,capture_output=True,text=True,timeout=timeout)
    receipt['commands'].append({'label':label,'start':start,'end':now(),'exit':result.returncode})
    if label not in ['create','port']:
        (evidence / (label+'.log')).write_text(result.stdout+result.stderr)
    if result.returncode:
        raise RuntimeError(label+' failed (sanitized)')
    return result.stdout.strip()
try:
    deadline = datetime.datetime.fromisoformat(receipt['expiry'].replace('Z', '+00:00'))
    if datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=5)>deadline:
        raise RuntimeError('insufficient finite resource window')
    env = os.environ.copy()
    env.update(POSTGRES_USER='executor_probe',POSTGRES_DB='executor_probe',POSTGRES_PASSWORD=secrets.token_hex(32))
    cid = run('create',['docker','create','--name',name,'--label','task=UPVE-2533','--label','project=52ccc13e-4995-4a3f-be37-6f4cf6bebe3e','--label','expires='+receipt['expiry'],
        '--publish','127.0.0.1::5432','--tmpfs','/var/lib/postgresql/data:rw','-e','POSTGRES_USER','-e','POSTGRES_DB','-e','POSTGRES_PASSWORD',image],env=env)
    receipt.update(containerId=cid,containerName=name,stopHandle=['docker','stop',cid],cleanupHandle=['docker','rm',cid])
    run('start',['docker','start',cid])
    ports = json.loads(run('port',['docker','inspect','--format','{{json .NetworkSettings.Ports}}',cid]))
    receipt['ports'] = ports
    for attempt in range(30):
        result = subprocess.run(['docker','exec',cid,'pg_isready','-U','executor_probe','-d','executor_probe'],capture_output=True,timeout=5)
        if result.returncode==0:
            break
        time.sleep(0.5)
    else:
        raise RuntimeError('readiness failed')
    receipt['readyAt'] = now()
    cfg = {'user':'executor_probe','database':'executor_probe','password':env['POSTGRES_PASSWORD'],'port':int(ports['5432/tcp'][0]['HostPort'])}
    fd = os.open(private,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as output:
        json.dump(cfg,output)
    testenv = os.environ.copy()
    testenv.update(EXECUTOR_PRIVATE_CONFIG=str(private),EXECUTOR_EVIDENCE=str(evidence),CF_PRIVATE_CONFIG=str(private),CF_EVIDENCE=str(evidence/'cloudflare'))
    (evidence/'cloudflare').mkdir(exist_ok=True)
    for label,harness in [('executor','Harness.mjs'),('cloudflare','RealPgHarness.mjs')]:
        for runtime in ['node','bun']:
            try:
                run(label+'-'+runtime+'-pg',[runtime,harness],cwd=consumer,env=testenv,timeout=150)
            except RuntimeError:
                receipt[label+'-'+runtime+'Gate']='FAIL'
            else:
                receipt[label+'-'+runtime+'Gate']='PASS'
    receipt['status']='PASS' if all(receipt.get(label+'-'+runtime+'Gate')=='PASS' for label in ['executor','cloudflare'] for runtime in ['node','bun']) else 'FAIL'
except Exception as error:
    receipt.update(status='FAIL',failureClass=type(error).__name__)
finally:
    if cid:
        result = subprocess.run(['docker','rm','--force',cid],capture_output=True,text=True,timeout=30)
        receipt['cleanup']={'exit':result.returncode,'removedId':result.stdout.strip(),'at':now()}
        result = subprocess.run(['docker','inspect','--format','{{.Id}}',cid],capture_output=True,text=True,timeout=10)
        receipt['cleanup']['absentVerified']=result.returncode!=0 and 'no such object' in result.stderr.lower()
    if private.exists():
        private.unlink()
    receipt['privateConfigRemoved']=not private.exists()
    if consumer.parent == pathlib.Path(tempfile.gettempdir()) and consumer.name.startswith('effect-jobs-executor-'):
        shutil.rmtree(consumer)
    receipt['consumerRemoved']=not consumer.exists()
    receipt['finishedAt']=now()
    (evidence/'owned-resource-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt,indent=2))

raise SystemExit(0 if receipt.get('status') == 'PASS' else 1)
