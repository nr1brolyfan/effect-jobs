import subprocess, json, secrets, os, pathlib, datetime, shutil
root=pathlib.Path.cwd()
out=root/'.multica/task/real'
out.mkdir(parents=True,exist_ok=True)
docker='docker'
try:
    result=subprocess.run([docker,'version','--format','{{.Server.Version}}'],capture_output=True,timeout=10)
    if result.returncode: docker='docker.exe'
except (OSError,subprocess.TimeoutExpired): docker='docker.exe'
cid=None
private=out/'private.json'
receipt={'docker':docker,'status':'FAIL'}
try:
    password=secrets.token_hex(32)
    env=os.environ.copy()
    env.update(POSTGRES_USER='applicability',POSTGRES_DB='applicability',POSTGRES_PASSWORD=password)
    if docker.endswith('.exe'): env['WSLENV']=':'.join(filter(None,[env.get('WSLENV',''),'POSTGRES_USER','POSTGRES_DB','POSTGRES_PASSWORD']))
    image='postgres:16.15-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'
    cid=subprocess.check_output([docker,'run','-d','--name','upve-2382-'+secrets.token_hex(5),'--label','task=UPVE-2382','--publish','127.0.0.1::5432','--tmpfs','/var/lib/postgresql/data:rw','-e','POSTGRES_USER','-e','POSTGRES_DB','-e','POSTGRES_PASSWORD',image],env=env,text=True,timeout=60).strip()
    receipt.update(containerId=cid,image=image)
    import time
    for i in range(40):
        if subprocess.run([docker,'exec',cid,'pg_isready','-U','applicability'],capture_output=True,timeout=5).returncode==0: break
        time.sleep(.25)
    else: raise RuntimeError('readiness timeout')
    ports=json.loads(subprocess.check_output([docker,'inspect','--format','{{json .NetworkSettings.Ports}}',cid],text=True,timeout=10))
    cfg={'user':'applicability','database':'applicability','password':password,'port':int(ports['5432/tcp'][0]['HostPort']),'schema':'applicability','encryptionKey':secrets.token_hex(32),'fingerprintKey':secrets.token_hex(32),'cursorKey':secrets.token_hex(32)}
    with os.fdopen(os.open(private,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as f: json.dump(cfg,f)
    env=os.environ.copy();env['PLAYGROUND_PRIVATE_CONFIG']=str(private)
    with (out/'run.log').open('w') as log:
        result=subprocess.run(['node','apps/website/tests/ui/repair/Applicability.real.mjs'],env=env,stdout=log,stderr=log,timeout=300)
    receipt['exit']=result.returncode
    if result.returncode==0: receipt['status']='PASS'
finally:
    if cid:
        result=subprocess.run([docker,'rm','--force',cid],capture_output=True,text=True,timeout=30)
        absent=subprocess.run([docker,'inspect',cid],capture_output=True,text=True,timeout=10)
        receipt['cleanup']={'exit':result.returncode,'absentVerified':absent.returncode!=0 and 'no such object' in absent.stderr.lower()}
    private.unlink(missing_ok=True)
    receipt['privateConfigRemoved']=not private.exists()
    (out/'owned-resource.json').write_text(json.dumps(receipt,indent=2))
    print(json.dumps(receipt))
    if receipt['status']!='PASS': raise SystemExit(1)
