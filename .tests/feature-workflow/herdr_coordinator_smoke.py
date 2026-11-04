#!/usr/bin/env python3
"""Real Herdr/Pi/launcher mechanics in a named PTY, deterministic offline provider only."""
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import shlex
import signal
import struct
import subprocess
import tempfile
import termios
import time
import threading
import sys
import uuid
from vt_screen import screen

ROOT = Path(__file__).resolve().parents[2]
NAME = f'fc-test-{os.getpid()}'
assert os.environ.get('HERDR_ENV') == '1', 'Run from Herdr, controlling only the named test session'
env = {k: v for k, v in os.environ.items() if not k.startswith(('HERDR_', 'PI_'))}
transcript = bytearray()

with tempfile.TemporaryDirectory(prefix='fc-') as directory:
    tmp = Path(directory)
    repo = tmp / 'repo'
    repo.mkdir()
    config = tmp / 'pi'
    (config / 'extensions').mkdir(parents=True)
    # Match candidate testing's individual-file links, including the new helper.
    # This setup is private to the fixture; live links are never modified.
    (config / 'extensions/feature-workflow').mkdir()
    for module in ('index.ts', 'worker.ts', 'coordination.ts', 'protocol.ts', 'attachment.ts'):
        (config / 'extensions/feature-workflow' / module).symlink_to(ROOT / 'pi/dot-config/pi/extensions/feature-workflow' / module)
    (config / 'extensions/offline.ts').symlink_to(ROOT / '.tests/feature-workflow/offline-provider.ts')
    # Reuse the installed integration read-only; never install/update live agents.
    (config / 'extensions/herdr-agent-state.ts').symlink_to(Path.home() / '.config/pi/extensions/herdr-agent-state.ts')
    (config / 'settings.json').write_text(json.dumps({'defaultProvider': 'feature-offline', 'defaultModel': 'coordinator'}))
    herdr_config = tmp / 'herdr.toml'
    popup = ROOT / 'agents/dot-local/bin/feature-popup'
    herdr_config.write_text('onboarding = false\n[terminal]\ndefault_shell = "/bin/bash"\n'
                            '[[keys.command]]\nkey = "prefix+f"\ntype = "popup"\n'
                            f'command = "exec {popup}"\nwidth = "80%"\nheight = "70%"\n')
    env.update(PI_CODING_AGENT_DIR=str(config), XDG_STATE_HOME=str(tmp / 'state'), XDG_CONFIG_HOME=str(tmp / 'config'),
               HERDR_CONFIG_PATH=str(herdr_config), TERM='xterm-256color')
    def run(*args, cwd=None):
        return subprocess.check_output(args, cwd=cwd, env=env, stderr=subprocess.STDOUT, text=True, timeout=75)
    def cli(*args):
        output = run('herdr', '--session', NAME, *args)
        return json.loads(output)['result'] if output.strip() else {}
    run('git', 'init', '-q', '-b', 'main', str(repo))
    (repo / 'stax.toml').write_text('[worktree]\nroot_dir = ".."\n')
    run('git', 'add', 'stax.toml', cwd=repo)
    run('git', '-c', 'user.name=Test', '-c', 'user.email=test@invalid', '-c', 'core.hooksPath=/dev/null',
        '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Fixture', cwd=repo)
    (repo / 'dirty').write_text('preserve')
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(repo)
        os.execvpe('herdr', ['herdr', '--session', NAME], env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
    def drain():
        while select.select([fd], [], [], 0.02)[0]:
            try: chunk = os.read(fd, 65536)
            except OSError: break
            if not chunk: break
            transcript.extend(chunk)
    def until(predicate, seconds=90):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            drain()
            try:
                value = predicate()
                if value: return value
            except (subprocess.CalledProcessError, KeyError, ValueError, FileNotFoundError): pass
            time.sleep(.1)
        Path('/tmp/feature-coordinator-screen.txt').write_text(screen(transcript))
        raise AssertionError('Timeout: /tmp/feature-coordinator-offline.log; /tmp/feature-coordinator-screen.txt')
    def probe(origin, instance):
        code = ('import json,runpy,sys; p=runpy.run_path(sys.argv[1]); c=p["core"]; '
                'origin=json.loads(sys.argv[2]); instance=json.loads(sys.argv[3]); '
                'print(json.dumps({"selected":p["origin_coordinator"](origin,instance,sys.argv[4]),'
                '"listed":c.coordinators(sys.argv[4])}))')
        probe_env = {**env, 'HERDR_ENV': '1', 'HERDR_SOCKET_PATH': instance['socket']}
        return json.loads(subprocess.check_output(['python3', '-B', '-c', code, str(popup), json.dumps(origin),
                         json.dumps(instance), str(repo / '.git')], env=probe_env, text=True))
    other_pid = other_fd = None
    try:
        pane = until(lambda: cli('pane', 'list')['panes'])[0]['pane_id']
        time.sleep(1)
        brief = tmp / 'brief.md'
        brief.write_bytes(b'Investigate only.\r\n  Preserve "quotes" and newlines.\r\n')
        coordinator = 'new'
        for name in ('first', 'second'):
            output = tmp / (name + '.json')
            command = [str(ROOT / 'agents/dot-local/bin/feature-start'), name, '--repo', str(repo), '--brief-file', str(brief),
                       '--coordinator', coordinator, '--provider', 'feature-offline', '--model', 'worker',
                       '--coordinator-provider', 'feature-offline', '--coordinator-model', 'coordinator']
            cli('pane', 'run', pane, shlex.join(command) + ' > ' + shlex.quote(str(output)) + ' 2>&1')
            record = until(lambda: json.loads(output.read_text()))
            assert record['ok'], record
            receipt = json.loads(Path(record['receipt']).read_text())
            assert receipt['brief'] == brief.read_bytes().decode()
            assert receipt['model'] == 'worker' and receipt['coordinator']['model'] == 'coordinator'
            assert receipt['worker']['session'] != receipt['coordinator']['session']
            assert receipt['worker']['epoch']
            coordinator = receipt['coordinator']['epoch']
            if name == 'first':
                first = receipt
            inbox = tmp / 'state/feature-workflow/inbox' / coordinator
            def report_received():
                for path in inbox.glob('*.request.json'):
                    message = json.loads(path.read_text())
                    if message['kind'] == 'status' and message['feature'] == receipt['nonce']:
                        ack = json.loads(Path(str(path).replace('.request.json', '.ack.json')).read_text())
                        if ack['status'] == 'submitted': return message
            message = until(report_received)
            assert 'OFFLINE_WORKER_OK' in message['content']
            snapshot = cli('api', 'snapshot')
            snapshot = snapshot.get('snapshot', snapshot)
            assert snapshot['focused_tab_id'] == receipt['coordinator']['tab']
            assert (repo / 'dirty').read_text() == 'preserve'
            assert not run('git', 'status', '--porcelain', cwd=receipt['cwd'])
            print(f'PASS {name}: verified independent identities/models, exact brief, coordinator focus, acknowledged worker report', flush=True)
        assert len(cli('tab', 'list')['tabs']) == 4  # Origin + one coordinator + two workers.
        print('PASS existing coordinator reused explicitly; no duplicate coordinator; zero network inference', flush=True)
        target = first['coordinator']
        if '--attachment' in sys.argv:
            # Existing sessions only: synthesize an old receipt without coordinator fields.
            legacy = tmp / 'legacy-receipt.json'
            legacy.write_text(json.dumps({k: v for k, v in first.items() if k not in ('coordinator', 'coordinator_handoff', 'instance', 'relationship')}, indent=2))
            original_bytes = legacy.read_bytes()
            worktree = Path(first['cwd'])
            run('git', '-c', 'user.name=Test', '-c', 'user.email=test@invalid', '-c', 'core.hooksPath=/dev/null',
                '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'Legitimate fixture progress', cwd=worktree)
            (worktree / 'progress').write_text('uncommitted progress must survive')
            progressed_head = run('git', 'rev-parse', 'HEAD', cwd=worktree)
            def registration(session, old_epoch=None):
                for path in (tmp / 'state/feature-workflow/sessions').glob('*.json'):
                    item = json.loads(path.read_text())
                    if item['session'] == session and item.get('live') and item['epoch'] != old_epoch:
                        return item
            def control(session, action='settle', delay=0):
                directory = tmp / 'state/offline-controls' / session
                path = directory / (str(uuid.uuid4()) + '.json')
                temporary = path.with_suffix('.tmp')
                temporary.write_text(json.dumps({'action': action, 'delay': delay}))
                temporary.replace(path)
            def reports(destination, revision):
                inbox = tmp / 'state/feature-workflow/inbox' / destination['epoch']
                return [(path, json.loads(path.read_text())) for path in inbox.glob('*.request.json')
                        if json.loads(path.read_text()).get('revision') == revision]
            def status(path):
                return json.loads(Path(str(path).replace('.request.json', '.ack.json')).read_text())['status']
            def attach(worker, destination, replace=None, ok=True):
                argv = [str(ROOT / 'agents/dot-local/bin/feature-attach'), str(legacy), '--worker', worker['epoch'], '--coordinator', destination['epoch']]
                if replace: argv += ['--replace', replace]
                result = subprocess.run(argv, env={**env, 'HERDR_ENV': '1', 'HERDR_SOCKET_PATH': target['instance']['socket']},
                                        text=True, capture_output=True, timeout=90)
                value = json.loads(result.stdout if result.returncode == 0 else result.stderr)
                assert value['ok'] == ok, value
                return value
            worker = until(lambda: registration(first['session']))
            assert worker['role'] == 'worker'
            before_tabs = len(cli('tab', 'list')['tabs'])
            def assignment_count():
                entries = [json.loads(line) for line in Path(worker['session_file']).read_text().splitlines()]
                return sum(e.get('message', {}).get('role') == 'user' and 'USER BRIEF (verbatim)' in str(e['message'].get('content')) for e in entries)
            assignments = assignment_count()
            control(target['session'], delay=8000)
            until(lambda: cli('agent', 'get', target['pane'])['agent']['agent_status'] == 'working')
            binding = attach(worker, target)
            assert binding['prepared']['coordinator']['busy']
            assert not reports(target, binding['revision'])  # Attach never resends old status.
            control(worker['session'])
            queued = until(lambda: reports(target, binding['revision']))[0][0]
            until(lambda: status(queued) == 'queued')
            until(lambda: status(queued) == 'submitted')
            assert len(cli('tab', 'list')['tabs']) == before_tabs
            assert legacy.read_bytes() == original_bytes
            print('PASS native legacy attach: both endpoints acknowledge, committed/dirty progress preserved, busy reporting queues, no resources/brief replay', flush=True)
            old_worker = worker
            control(worker['session'], action='reload')
            worker = until(lambda: registration(first['session'], old_worker['epoch']))
            assert worker['role'] == 'worker'
            assert assignment_count() == assignments
            attach(old_worker, target, binding['revision'], ok=False)
            control(worker['session'])
            time.sleep(1)
            drain()
            assert len(reports(target, binding['revision'])) == 1
            renewed = attach(worker, target, binding['revision'])
            assert not reports(target, renewed['revision'])
            control(worker['session'])
            renewed_report = until(lambda: reports(target, renewed['revision']))[0][0]
            until(lambda: status(renewed_report) == 'submitted')
            assert assignment_count() == assignments
            print('PASS native same-session reload: stale epoch blocked, explicit renewal restores only future reports, original assignment not replayed', flush=True)
            alternate_tab = cli('tab', 'create', '--cwd', str(repo), '--label', 'rebind-target', '--no-focus')
            alternate_pane = alternate_tab['root_pane']['pane_id']
            cli('agent', 'start', 'rebind-target', '--kind', 'pi', '--pane', alternate_pane, '--timeout', '60000', '--',
                '--provider', 'feature-offline', '--model', 'coordinator')
            alternate_file = cli('agent', 'get', alternate_pane)['agent']['agent_session']['value']
            def alternate_registration():
                for path in (tmp / 'state/feature-workflow/sessions').glob('*.json'):
                    item = json.loads(path.read_text())
                    if item['session_file'] == alternate_file and item.get('live'): return item
            alternate = until(alternate_registration)
            control(target['session'], delay=10000)
            until(lambda: cli('agent', 'get', target['pane'])['agent']['agent_status'] == 'working')
            control(worker['session'])
            late = until(lambda: [p for p, _ in reports(target, renewed['revision']) if p != renewed_report])[0]
            until(lambda: status(late) == 'queued')
            count = len(cli('tab', 'list')['tabs'])
            rebound = attach(worker, alternate, renewed['revision'])
            until(lambda: status(late) == 'rejected')
            assert not reports(alternate, rebound['revision'])
            control(worker['session'])
            delivered = until(lambda: reports(alternate, rebound['revision']))[0][0]
            until(lambda: status(delivered) == 'submitted')
            assert len(cli('tab', 'list')['tabs']) == count
            assert assignment_count() == assignments
            assert legacy.read_bytes() == original_bytes
            assert run('git', 'rev-parse', 'HEAD', cwd=worktree) == progressed_head
            assert (worktree / 'progress').read_text() == 'uncommitted progress must survive'
            print('PASS native explicit rebind: late old-owner message rejected, new owner receives only future status, conversations/worktrees retained', flush=True)
            raise SystemExit(0)
        captured = cli('pane', 'get', target['pane'])['pane']
        assert probe(captured, target['instance'])['selected']['epoch'] == target['epoch']
        assert probe(cli('pane', 'get', pane)['pane'], target['instance'])['selected'] is None
        worker_origin = cli('pane', 'get', first['pane'])['pane']
        worker_default = probe(worker_origin, target['instance'])['selected']
        assert worker_default is None, (worker_default, worker_origin,
            [json.loads(p.read_text()) for p in (tmp / 'state/feature-workflow/sessions').glob('*.json')])
        # Real popup captures coordinator before focus changes, preserves explicit override and cancels without resources.
        cli('tab', 'focus', target['tab'])
        os.write(fd, b'\x02f')
        until(lambda: 'Existing:' in screen(transcript) and target['session'][:8] in screen(transcript))
        cli('tab', 'focus', cli('pane', 'get', pane)['pane']['tab_id'])
        drain()
        # Herdr hides the popup on tab focus changes. No submission occurs;
        # resolving the frozen invocation still names the original coordinator.
        assert 'New feature' not in screen(transcript)
        assert probe(captured, target['instance'])['selected']['epoch'] == target['epoch']
        cli('tab', 'focus', target['tab'])
        time.sleep(.3)
        drain()
        if 'New feature' not in screen(transcript):
            os.write(fd, b'\x02f')
        until(lambda: 'Existing:' in screen(transcript) and target['session'][:8] in screen(transcript))
        os.write(fd, b'\x0f')
        until(lambda: 'Enter: accept' in screen(transcript))
        os.write(fd, b'\x1b')
        until(lambda: 'New feature' in screen(transcript) and 'Existing:' in screen(transcript))
        os.write(fd, b'\x0f')
        until(lambda: 'Enter: accept' in screen(transcript))
        os.write(fd, b'\x1b[A')  # Up selects explicit New session.
        time.sleep(.1)
        os.write(fd, b'\r')
        until(lambda: 'New feature' in screen(transcript) and 'New session' in screen(transcript))
        os.write(fd, b'\x1b')
        until(lambda: 'New feature' not in screen(transcript))
        assert len(cli('tab', 'list')['tabs']) == 4
        print('PASS native invoking coordinator default, shell/worker exclusion, changed focus, picker cancel/New override', flush=True)
        # A second actual server sharing repository/state and colliding public pane IDs.
        other_name = NAME + '-b'
        other_pid, other_fd = pty.fork()
        if other_pid == 0:
            os.chdir(repo)
            os.execvpe('herdr', ['herdr', '--session', other_name], env)
        fcntl.ioctl(other_fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
        def drain_other():
            while True:
                try:
                    if not os.read(other_fd, 65536): return
                except OSError: return
        threading.Thread(target=drain_other, daemon=True).start()
        def other(*args):
            output = run('herdr', '--session', other_name, *args)
            return json.loads(output)['result'] if output.strip() else {}
        until(lambda: other('pane', 'list')['panes'])
        other_tab = other('tab', 'create', '--cwd', str(repo), '--label', 'other-coordinator', '--no-focus')
        other_pane = other_tab['root_pane']['pane_id']
        assert other_pane == target['pane'], (other_pane, target['pane'])
        print('CHECK second isolated server ready; starting colliding-pane coordinator', flush=True)
        other('agent', 'start', 'other-coordinator', '--kind', 'pi', '--pane', other_pane, '--timeout', '60000', '--',
              '--provider', 'feature-offline', '--model', 'coordinator')
        print('CHECK second coordinator started', flush=True)
        other_snapshot = other('pane', 'get', other_pane)['pane']
        def other_registration():
            for path in (tmp / 'state/feature-workflow/sessions').glob('*.json'):
                item = json.loads(path.read_text())
                if item['session_file'] == other_snapshot['agent_session']['value']: return item
        other_reg = until(other_registration)
        assert other_reg['instance'] != target['instance']
        assert probe(other_snapshot, other_reg['instance'])['selected']['epoch'] == other_reg['epoch']
        assert all(item['instance'] == other_reg['instance'] for item in probe(other_snapshot, other_reg['instance'])['listed'])
        assert probe(captured, target['instance'])['selected']['epoch'] == target['epoch']
        # Unregistered actual Pi: only test provider and read-only installed Herdr integration loaded.
        unregistered_tab = cli('tab', 'create', '--cwd', str(repo), '--label', 'unregistered', '--no-focus')
        unknown_pane = unregistered_tab['root_pane']['pane_id']
        cli('agent', 'start', 'unregistered', '--kind', 'pi', '--pane', unknown_pane, '--timeout', '60000', '--',
            '--no-extensions', '--extension', str(config / 'extensions/offline.ts'),
            '--extension', str(config / 'extensions/herdr-agent-state.ts'), '--provider', 'feature-offline', '--model', 'coordinator')
        unknown = cli('pane', 'get', unknown_pane)['pane']
        assert probe(unknown, target['instance'])['selected']['unregistered']
        cli('tab', 'focus', unregistered_tab['tab']['tab_id'])
        time.sleep(.3)
        drain()
        os.write(fd, b'\x02f')
        until(lambda: 'Unregistered invoking Pi' in screen(transcript) and '/reload' in screen(transcript))
        os.write(fd, b'\x1b')
        # Close only our synthetic second coordinator; stale captured identity must not fall back.
        other('tab', 'close', other_tab['tab']['tab_id'])
        assert probe(other_snapshot, other_reg['instance'])['selected']['unregistered']
        print('PASS native colliding pane IDs across servers, unregistered Pi /reload guidance, closed destination rejection', flush=True)
    finally:
        if other_pid:
            subprocess.run(['herdr', '--session', NAME + '-b', 'server', 'stop'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try: os.kill(other_pid, signal.SIGTERM)
            except ProcessLookupError: pass
            os.waitpid(other_pid, 0)
            os.close(other_fd)
            subprocess.run(['herdr', 'session', 'delete', NAME + '-b', '--json'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        drain()
        Path('/tmp/feature-coordinator-offline.log').write_bytes(transcript)
        subprocess.run(['herdr', '--session', NAME, 'server', 'stop'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try: os.kill(pid, signal.SIGTERM)
        except ProcessLookupError: pass
        os.waitpid(pid, 0)
        os.close(fd)
        subprocess.run(['herdr', 'session', 'delete', NAME, '--json'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
