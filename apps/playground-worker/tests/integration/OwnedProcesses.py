"""Serial Linux qualification calls own detached descendants through subreaping."""
import ctypes
import json
import os
import pathlib
import signal
import subprocess
import time


class ResourceCleanupError(RuntimeError):
    pass


def process_table():
    rows = {}
    for entry in pathlib.Path('/proc').iterdir():
        if entry.name.isdecimal():
            try:
                fields = (entry / 'stat').read_text().rsplit(')', 1)[1].split()
                rows[int(entry.name)] = (int(fields[1]), fields[19], fields[0])
            except (FileNotFoundError, ProcessLookupError):
                pass
    return rows


def run(args, *, cwd=None, env=None, stdout=None, stderr=None, timeout, receipt):
    # Calls must be serial within the wrapper: adopted children belong to this
    # one invocation. Processes already present are never claimed.
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), 'subreaper setup failed')
    before = process_table()
    owned = {}
    process = None
    operation = None
    result = None
    errors = []

    def discover():
        table = process_table()
        parents = {os.getpid()}
        for _ in range(len(table) + 1):
            found = {pid for pid, row in table.items()
                     if row[0] in parents and (pid not in before or row[1] != before[pid][1])}
            if found <= parents:
                break
            parents.update(found)
        for pid in parents - {os.getpid()}:
            if pid in table:
                owned.setdefault(pid, table[pid][1])
        return table

    def remaining():
        table = discover()
        return [pid for pid, ticks in owned.items()
                if pid in table and table[pid][1] == ticks]

    def reap(pids):
        if process is not None:
            process.poll()
        for pid in pids:
            if process is not None and pid == process.pid:
                continue
            try:
                os.waitpid(pid, os.WNOHANG)
            except ChildProcessError:
                pass

    try:
        process = subprocess.Popen(args, cwd=cwd, env=env, stdout=stdout,
                                   stderr=stderr, start_new_session=True)
        discover()
        deadline = time.monotonic() + timeout
        while True:
            discover()
            budget = deadline - time.monotonic()
            if budget <= 0:
                raise subprocess.TimeoutExpired(args, timeout)
            try:
                result = process.wait(timeout=min(.05, budget))
                break
            except subprocess.TimeoutExpired:
                pass
    except BaseException as error:
        operation = error
    finally:
        try:
            reap(remaining())
            if remaining():
                for sig, bound in [(signal.SIGTERM, 2), (signal.SIGKILL, 3)]:
                    # Fail closed when the protected daemon identity is unknown.
                    probe = subprocess.run(['multica', 'daemon', 'status', '--output', 'json'],
                                           capture_output=True, text=True, timeout=10)
                    if probe.returncode != 0:
                        raise ResourceCleanupError('daemon identity unavailable')
                    daemon = int(json.loads(probe.stdout)['pid'])
                    deadline = time.monotonic() + bound
                    while True:
                        pids = remaining()
                        if not pids:
                            break
                        if daemon in pids or os.getpid() in pids:
                            raise ResourceCleanupError('protected process in owned tree')
                        for pid in pids:
                            # Recheck start ticks immediately before signalling.
                            row = process_table().get(pid)
                            if row and row[1] == owned[pid] and row[2] not in ('Z', 'X'):
                                try:
                                    os.kill(pid, sig)
                                except ProcessLookupError:
                                    pass
                        reap(pids)
                        if time.monotonic() >= deadline:
                            break
                        time.sleep(.02)
                reap(remaining())
                if remaining():
                    raise ResourceCleanupError('owned processes remain')
        except BaseException as error:
            errors.append(type(error).__name__)
        receipt.update(ownedProcesses=[{'pid': pid, 'startTicks': ticks}
                                       for pid, ticks in sorted(owned.items())],
                       absentVerified=not errors, errors=errors)
    if errors:
        raise ResourceCleanupError('process cleanup failed') from operation
    if operation:
        raise operation
    return result
