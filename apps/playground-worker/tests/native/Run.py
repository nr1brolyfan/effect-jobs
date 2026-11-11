"""Owned finite loopback PG plus actual native application; never an existing DB."""
import datetime, hashlib, json, os, pathlib, secrets, signal, socket, subprocess, sys, time

root = pathlib.Path(__file__).resolve().parents[4]
cwd = pathlib.Path(__file__).resolve().parent
evidence = pathlib.Path(os.environ.get("NATIVE_EVIDENCE_DIRECTORY", root / ".multica/native-phase-b"))
evidence.mkdir(parents=True, exist_ok=True)
image = "postgres:16.15-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea"
receipt = {"image": image, "storage": "owned tmpfs", "commands": [], "startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
cid = None
child = None
def call(label, args, env=None, timeout=30):
    result = subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)
    receipt["commands"].append({"command": label, "exit": result.returncode})
    if result.returncode: raise RuntimeError(label + " failed")
    return result.stdout.strip()
try:
    if (cwd / ".env").exists(): raise RuntimeError("refuse private dotenv in native fixture cwd")
    env = os.environ.copy()
    env.update(POSTGRES_USER="native_application", POSTGRES_DB="native_application", POSTGRES_PASSWORD=secrets.token_hex(32))
    cid = call("create", ["docker", "create", "--name", "native-phase-b-" + secrets.token_hex(6), "--label", "task=UPVE-2768", "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw", "-e", "POSTGRES_USER", "-e", "POSTGRES_DB", "-e", "POSTGRES_PASSWORD", image], env)
    receipt["containerId"] = cid
    receipt["cleanupHandle"] = ["docker", "rm", "--force", cid]
    (evidence / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    call("start", ["docker", "start", cid])
    ports = json.loads(call("port", ["docker", "inspect", "--format", "{{json .NetworkSettings.Ports}}", cid]))
    port = ports["5432/tcp"][0]["HostPort"]
    for attempt in range(40):
        ready = subprocess.run(["docker", "exec", cid, "pg_isready", "-h", "127.0.0.1", "-U", "native_application", "-d", "native_application"], capture_output=True, timeout=5)
        if ready.returncode == 0:
            with socket.socket() as probe:
                probe.settimeout(1)
                if probe.connect_ex(("127.0.0.1", int(port))) == 0: break
        time.sleep(.25)
    else: raise RuntimeError("bounded PG readiness failed")
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        http_port = listener.getsockname()[1]
    assets = evidence / "assets"
    assets.mkdir(exist_ok=True)
    (assets / "native-ready").write_text("native application ready")
    for reserved in ["jobs.html", "demo.html", "api.html", "api", "demo/foreign"]:
        target = assets / reserved
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("reserved native asset must remain hidden")
    env.update(NATIVE_EVIDENCE_DIRECTORY=str(evidence.resolve()), PG_connectionString=f"postgres://native_application:{env['POSTGRES_PASSWORD']}@127.0.0.1:{port}/native_application", SCHEMA="native_application", ORIGIN=f"http://127.0.0.1:{http_port}", LOCAL_PREVIEW="true", LOCAL_PRIVATE="false" if "--public" in sys.argv else "true", ENCRYPTION_KEY=secrets.token_hex(32), FINGERPRINT_KEY=secrets.token_hex(32), CURSOR_KEY=secrets.token_hex(32), ASSET_DIRECTORY=str(assets.resolve()), ALCHEMY_TEST_DEV="1", ALCHEMY_TEST_STAGE="native_" + secrets.token_hex(6))
    for key in list(env):
        if key.startswith("CLOUDFLARE_"): del env[key]
    env["PATH"] = "/home/itsbroly/.local/share/fnm/node-versions/v24.15.0/installation/bin:" + env["PATH"]
    source_paths = [*root.glob("apps/playground-worker/src/**/*.ts"), *cwd.glob("*.ts"), cwd / "tsconfig.json", pathlib.Path(__file__).resolve(), root / "bun.lock"]
    source_inputs = {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest() for path in source_paths}
    with (evidence / "application.log").open("w") as log:
        test = "./Concurrency.test.ts" if "--concurrency" in sys.argv else "./Observation.test.ts" if "--observation" in sys.argv else "./Public.test.ts" if "--public" in sys.argv else "./Application.test.ts"
        child = subprocess.Popen(["bun", "test", test], cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        try: code = child.wait(timeout=240)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGTERM)
            try: child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=10)
            raise RuntimeError("native application timeout")
    receipt["testExit"] = code
    receipt["failureMarkerAbsentFromLogs"] = "native-sensitive-marker" not in (evidence / "application.log").read_text()
    if not receipt["failureMarkerAbsentFromLogs"]: raise RuntimeError("native callback exposed internal failure marker")
    with socket.socket() as probe:
        probe.settimeout(1)
        receipt["httpClosedAfterAwaitedDestroy"] = probe.connect_ex(("127.0.0.1", http_port)) != 0
    if not receipt["httpClosedAfterAwaitedDestroy"]: raise RuntimeError("native HTTP survived teardown")
    receipt["sourceHashes"] = source_inputs
    receipt["sourceStable"] = all(hashlib.sha256((root / path).read_bytes()).hexdigest() == digest for path, digest in source_inputs.items())
    if not receipt["sourceStable"]: raise RuntimeError("native source inputs changed during qualification")
    receipt["nativeArtifactHashes"] = {str(path.relative_to(cwd)): hashlib.sha256(path.read_bytes()).hexdigest() for path in (cwd / ".alchemy/bundles").glob("*" + env["ALCHEMY_TEST_STAGE"] + "*/*") if path.is_file()}
    receipt["stage"] = env["ALCHEMY_TEST_STAGE"]
    if code: raise RuntimeError("native application failed; see owned evidence")
    receipt["status"] = "PASS"
except Exception as error:
    receipt.update(status="FAIL", failureClass=type(error).__name__, reason=str(error))
finally:
    if cid:
        removed = subprocess.run(["docker", "rm", "--force", cid], capture_output=True, text=True, timeout=30)
        absent = subprocess.run(["docker", "inspect", cid], capture_output=True, text=True, timeout=10)
        receipt["cleanup"] = {"exit": removed.returncode, "absentVerified": absent.returncode != 0 and "no such object" in absent.stderr.lower()}
        if removed.returncode or not receipt["cleanup"]["absentVerified"]: receipt["status"] = "FAIL"
    receipt["finishedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    (evidence / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({key: receipt[key] for key in ["status", "testExit", "httpClosedAfterAwaitedDestroy", "sourceStable", "cleanup", "reason"] if key in receipt}, indent=2))
    if receipt.get("status") != "PASS": raise SystemExit(1)
