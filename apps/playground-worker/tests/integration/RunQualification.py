import pathlib,subprocess,datetime,json,os,secrets,time,signal,ctypes
root=pathlib.Path(__file__).resolve().parents[4]; out=root/'.qualification/backend/runtime'; out.mkdir(parents=True,exist_ok=True); base=out
now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
r={'issue':'UPVE-2533','start':now(),'commands':[],'hosted':'NotTested'};cid=None;private=out/'generated-config.json';password=secrets.token_hex(32)
class ResourceCleanupError(RuntimeError):
 pass

def process_table():
 # Linux start ticks prevent signalling a PID that has been recycled.
 rows={}
 for entry in pathlib.Path('/proc').iterdir():
  if entry.name.isdecimal():
   try:
    fields=(entry/'stat').read_text().rsplit(')',1)[1].split()
    rows[int(entry.name)]=(int(fields[1]),fields[19],fields[0])
   except (FileNotFoundError,ProcessLookupError):pass
 return rows

def call(args,env=None,timeout=60):
 # Calls are serial. Subreaping keeps detached native grandchildren owned here
 # after their Node parent exits, including Chromium crash handlers using setsid.
 libc=ctypes.CDLL(None,use_errno=True)
 if libc.prctl(36,1,0,0,0)!=0:raise OSError(ctypes.get_errno(),'subreaper setup failed')
 before=process_table();owned={};p=None;operation=None;result=None;cleanup=[]
 def discover():
  table=process_table();parents={os.getpid()}
  for _ in range(len(table)+1):
   found={pid for pid,(ppid,ticks,_) in table.items() if ppid in parents and pid not in before}
   if found<=parents:break
   parents.update(found)
  for pid in parents-{os.getpid()}:
   if pid in table:owned.setdefault(pid,table[pid][1])
  return table
 def alive():
  table=discover()
  return [pid for pid,ticks in owned.items() if pid in table and table[pid][1]==ticks]
 try:
  p=subprocess.Popen(args,cwd=root,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
  owned[p.pid]=process_table()[p.pid][1]
  deadline=time.monotonic()+timeout
  while True:
   discover()
   remaining=deadline-time.monotonic()
   if remaining<=0:raise subprocess.TimeoutExpired(args,timeout)
   try:
    stdout,stderr=p.communicate(timeout=min(.1,remaining))
    result=subprocess.CompletedProcess(args,p.returncode,stdout,stderr);break
   except subprocess.TimeoutExpired:pass
 except BaseException as error:operation=error
 finally:
  try:
   if alive():
    # Compare exact owned PIDs before any explicit termination; fail closed if
    # the daemon identity cannot be obtained. Never match executable names.
    probe=subprocess.run(['multica','daemon','status','--output','json'],capture_output=True,text=True,timeout=10)
    if probe.returncode!=0:raise ResourceCleanupError('daemon identity unavailable')
    daemon=int(json.loads(probe.stdout)['pid'])
    for sig,bound in [(signal.SIGTERM,2),(signal.SIGKILL,3)]:
     deadline=time.monotonic()+bound
     while True:
      live=alive()
      if not live:break
      if daemon in live or os.getpid() in live:raise ResourceCleanupError('protected process in owned tree')
      for pid in live:
       # Recheck identity at the signal boundary. Only this call's descendants.
       current=process_table().get(pid)
       if current and current[1]==owned[pid] and current[2] not in ('Z','X'):
        try:os.kill(pid,sig)
        except ProcessLookupError:pass
      if p is not None:p.poll()
      for pid in live:
       if p is not None and pid==p.pid:continue
       try:os.waitpid(pid,os.WNOHANG)
       except ChildProcessError:pass
      if time.monotonic()>=deadline:break
      time.sleep(.02)
    if alive():raise ResourceCleanupError('owned processes remain')
   if p is not None:p.communicate(timeout=1)
  except BaseException as error:cleanup.append(type(error).__name__)
  r.setdefault('process_cleanup',[]).append({'owned_pids':sorted(owned),'absent_verified':not cleanup,'errors':cleanup})
 if cleanup:
  if operation:r['operation_failure_class']=type(operation).__name__
  raise ResourceCleanupError('process cleanup failed') from operation
 if operation:raise operation
 return result
def gate(name,args,env):
 start=now();p=call(args,env,360);text=p.stdout+p.stderr
 assert password not in text,'secret appeared in runtime output'
 (base/(name+'.log')).write_text(text);r['commands'].append({'name':name,'args':args,'start':start,'end':now(),'exit':p.returncode});print(name,p.returncode,flush=True)
 return p.returncode
try:
 env=os.environ.copy();env.update(POSTGRES_USER='task_worker',POSTGRES_DB='task_worker',POSTGRES_PASSWORD=password)
 image='postgres:16.15-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'
 p=call(['docker','create','--name','upve-2533-'+secrets.token_hex(5),'--label','project=52ccc13e-4995-4a3f-be37-6f4cf6bebe3e','--label','issue=UPVE-2533','--label','expires='+str(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=12)),'--publish','127.0.0.1::5432','--tmpfs','/var/lib/postgresql/data:rw','-e','POSTGRES_USER','-e','POSTGRES_DB','-e','POSTGRES_PASSWORD',image,'postgres','-c','shared_preload_libraries=pg_stat_statements'],env)
 assert p.returncode==0,'owned resource creation failed';cid=p.stdout.strip();r['container_id']=cid;r['image']=image
 assert call(['docker','start',cid]).returncode==0
 for i in range(40):
  if call(['docker','exec',cid,'pg_isready','-U','task_worker','-d','task_worker']).returncode==0:break
  time.sleep(.25)
 else:raise RuntimeError('readiness timeout')
 ports=json.loads(call(['docker','inspect','--format','{{json .NetworkSettings.Ports}}',cid]).stdout)
 cfg={'host':'127.0.0.1','port':int(ports['5432/tcp'][0]['HostPort']),'user':'task_worker','database':'task_worker','password':password,'schema':'worker_task','encryptionKey':secrets.token_hex(32),'fingerprintKey':secrets.token_hex(32),'cursorKey':secrets.token_hex(32)}
 with private.open('x') as f:os.chmod(private,0o600);json.dump(cfg,f)
 testenv=os.environ.copy();testenv.update(PLAYGROUND_PRIVATE_CONFIG=str(private),D6_RESOURCE_DIRECTORY=str(out),PLAYGROUND_EVIDENCE_DIRECTORY=str(out))
 if not os.environ.get('QUALIFICATION_BROWSER_ONLY'):
  gate('real-pg',['node',str(out/'RepairPg.mjs')],testenv)
  gate('live-qualification',['node','apps/playground-worker/tests/integration/LiveQualification.mjs'],testenv)
 cfg['schema']='worker_demo_task'
 private.write_text(json.dumps(cfg))
 gate('real-browser',['node','apps/playground-worker/tests/integration/RepairCombined.mjs'],testenv)
 r['status']='PASS' if all(c['exit']==0 for c in r['commands']) else 'FAIL'
except BaseException as e:r['status']='FAIL';r['failure_class']=type(e).__name__
finally:
 cleanup_errors=[]
 if cid:
  try:
   p=call(['docker','rm','--force',cid]);r['cleanup_exit']=p.returncode
   if p.returncode!=0:cleanup_errors.append('container-removal-failed')
  except BaseException as e:cleanup_errors.append('container-removal-'+type(e).__name__)
  try:
   p=call(['docker','inspect','--format','{{.Id}}',cid]);r['absent_verified']=p.returncode!=0 and 'no such object' in p.stderr.lower()
   if not r['absent_verified']:cleanup_errors.append('container-absence-unverified')
  except BaseException as e:
   r['absent_verified']=False;cleanup_errors.append('container-inspect-'+type(e).__name__)
 try:
  private.unlink(missing_ok=True);r['private_config_removed']=not private.exists()
  if not r['private_config_removed']:cleanup_errors.append('private-config-remains')
 except BaseException as e:
  r['private_config_removed']=False;cleanup_errors.append('private-config-'+type(e).__name__)
 r['cleanup_errors']=cleanup_errors
 if cleanup_errors or any(not c['absent_verified'] for c in r.get('process_cleanup',[])):r['status']='FAIL'
 r['end']=now();(base/'runtime-resource.json').write_text(json.dumps(r,indent=2));print(json.dumps(r))
raise SystemExit(0 if r['status']=='PASS' else 1)
