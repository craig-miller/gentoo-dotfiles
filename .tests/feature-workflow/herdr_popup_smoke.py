#!/usr/bin/env python3
"""Opt-in real Herdr popup/worker smoke in an isolated named session and test repo."""
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
import sys
import tempfile
import termios
import time
from vt_screen import screen

ROOT = Path(__file__).resolve().parents[2]
NAME = f"feature-popup-smoke-{os.getpid()}"
ENV = {k: v for k, v in os.environ.items() if not k.startswith('HERDR_') and k not in ('PI_SESSION_ID', 'PI_SESSION_FILE')}
# Real Herdr popup children bypass Fish's pi.fish setup. Do not accidentally
# make discovery work only because this test was launched by a Pi agent.
if '--ui-only' in sys.argv:
    ENV.pop('PI_CODING_AGENT_DIR', None)
ENV['TERM'] = 'xterm-256color'
transcript = bytearray()


def run(*args, cwd=None):
    return subprocess.check_output(args, cwd=cwd, env=ENV, stderr=subprocess.STDOUT, text=True)


def cli(*args):
    output = run('herdr', '--session', NAME, *args)
    return json.loads(output)['result'] if output.strip() else {}


def drain(fd):
    while select.select([fd], [], [], 0.05)[0]:
        try: chunk = os.read(fd, 65536)
        except OSError: break
        if not chunk: break
        transcript.extend(chunk)


def until(fd, predicate, seconds=30):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        drain(fd)
        try:
            if predicate(): return
        except (subprocess.CalledProcessError, KeyError, ValueError): pass
        time.sleep(0.1)
    processes = subprocess.check_output(['ps', '-eo', 'pid,ppid,comm,args'], text=True)
    Path('/tmp/feature-popup-processes.log').write_text('\n'.join(line for line in processes.splitlines() if any(word in line for word in ('feature-popup', 'stax validate', 'herdr pane'))))
    raise AssertionError('Timed out; see /tmp/feature-popup-native.log and /tmp/feature-popup-processes.log')


with tempfile.TemporaryDirectory(prefix='feature-popup-native-') as temporary:
    tmp = Path(temporary); repo = tmp / 'repo'; repo.mkdir()
    ENV['XDG_STATE_HOME'] = str(tmp / 'state')
    config = tmp / 'herdr.toml'
    popup = ROOT / 'agents/dot-local/bin/feature-popup'
    config.write_text('onboarding = false\n[terminal]\ndefault_shell = "/bin/bash"\n'
                      '[[keys.command]]\nkey = "prefix+f"\ntype = "popup"\n'
                      f'command = "exec {popup}"\nwidth = "70%"\nheight = "60%"\n')
    ENV['HERDR_CONFIG_PATH'] = str(config)
    run('git', 'init', '-q', '-b', 'main', str(repo))
    (repo / 'stax.toml').write_text('[worktree]\nroot_dir = ".."\n')
    run('git', 'add', 'stax.toml', cwd=repo)
    run('git', '-c', 'user.name=Test', '-c', 'user.email=test@invalid', '-c', 'core.hooksPath=/dev/null',
        '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Synthetic popup fixture', cwd=repo)
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(repo)
        os.execvpe('herdr', ['herdr', '--session', NAME], ENV)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
    try:
        until(fd, lambda: len(cli('pane', 'list')['panes']) == 1)
        pane = cli('pane', 'list')['panes'][0]['pane_id']
        time.sleep(1); drain(fd)
        os.write(fd, b'\x02f')
        until(fd, lambda: b'New feature' in transcript)
        assert b'Traceback' not in transcript
        # Herdr preserves indexed terminal colors and the default background;
        # Foot resolves these slots through its current Noctalia palette.
        assert b'\x1b[0;1;38;5;5;49mNew feature' in transcript
        assert b'\x1b[0;38;5;7;49mRepository' in transcript
        os.write(fd, b'\t')
        until(fd, lambda: b'\x1b[0;1;38;5;5;49mBrief' in transcript)
        print('PASS native palette slots/default background and active-field accent', flush=True)
        os.write(fd, b'\x1b[200~Preserved\nbrief\x1b[201~\x10')
        before = len(transcript)
        until(fd, lambda: 'Choose model' in screen(transcript))
        os.write(fd, b'g6as codex')
        until(fd, lambda: b'openai-codex/gpt-6-astra' in transcript[before:])
        before = len(transcript)
        os.write(fd, b'\r')
        until(fd, lambda: 'New feature' in screen(transcript))
        assert 'Preserved' in screen(transcript) and 'brief' in screen(transcript)
        before = len(transcript)
        os.write(fd, b'\x10')
        until(fd, lambda: 'Choose model' in screen(transcript))
        os.write(fd, b'no-such-model-zzzz')
        until(fd, lambda: 'No matching models' in screen(transcript))
        before = len(transcript)
        os.write(fd, b'\x1b')
        until(fd, lambda: 'New feature' in screen(transcript))
        assert 'Preserved' in screen(transcript)
        print('PASS Ctrl-P discovers Pi models, fuzzy search/accept/cancel preserve draft', flush=True)
        os.write(fd, b'\x0f')
        until(fd, lambda: 'New session' in screen(transcript) and 'Enter: accept' in screen(transcript))
        os.write(fd, b'\x1b')
        until(fd, lambda: 'New feature' in screen(transcript))
        assert 'Preserved' in screen(transcript)
        print('PASS explicit coordinator picker cancels without losing draft', flush=True)
        os.write(fd, b'\x1b'); time.sleep(0.3)
        sentinel = tmp / 'cancelled'
        os.write(fd, ('printf done > ' + shlex.quote(str(sentinel)) + '\n').encode())
        until(fd, sentinel.exists)
        assert len(cli('tab', 'list')['tabs']) == 1
        assert len(run('git', 'worktree', 'list', cwd=repo).splitlines()) == 1
        print('PASS form opens; Escape closes without resources', flush=True)

        cli('pane', 'run', pane, 'cd ' + shlex.quote(str(tmp)))
        until(fd, lambda: cli('pane', 'get', pane)['pane'].get('foreground_cwd') == str(tmp))
        before = len(transcript)
        os.write(fd, b'\x02f')
        until(fd, lambda: b'Not a worktree-compatible' in transcript[before:])
        assert b'New feature' not in transcript[before:]
        assert b'dismiss' not in transcript[before:]
        assert b'\x1b[0;38;5;1;49mNot a worktree-compatible' in transcript[before:]
        os.write(fd, b'\r'); time.sleep(0.3)
        sentinel = tmp / 'dismissed'
        os.write(fd, ('printf done > ' + shlex.quote(str(sentinel)) + '\n').encode())
        until(fd, sentinel.exists)
        print('PASS preflight error contains no form/hint; Enter dismisses', flush=True)
        if '--ui-only' in sys.argv:
            raise SystemExit(0)

        cli('pane', 'run', pane, 'cd ' + shlex.quote(str(repo)))
        until(fd, lambda: cli('pane', 'get', pane)['pane'].get('foreground_cwd') == str(repo))
        before = len(transcript)
        os.write(fd, b'\x02f')
        until(fd, lambda: b'New feature' in transcript[before:])
        # Paste multiline data, then Ctrl-S. No terminal flow-control freeze.
        brief = 'Read-only popup smoke.\nUse bash to check cwd, branch, PI_SESSION_ID and PI_MODEL.\nReply POPUP_WORKER_OK and stop. No edits, builds, commits or other workers.'
        os.write(fd, b'popup-check\t\x1b[200~' + brief.encode() + b'\x1b[201~')
        time.sleep(0.2)
        os.write(fd, b'\x13')
        records = tmp / 'state/feature-workflow'
        def submitted():
            for path in records.glob('*/receipt.json'):
                record = json.loads(path.read_text())
                if record.get('phase') == 'failed': raise RuntimeError(str(record))
                if record.get('phase') == 'submitted': return record
        until(fd, submitted, seconds=180)
        record = submitted()
        assert record['brief'] == brief
        def answered():
            agent = cli('agent', 'get', record['agent_name'])['agent']
            entries = [json.loads(line) for line in Path(agent['agent_session']['value']).read_text().splitlines()]
            return any(entry.get('message', {}).get('role') == 'assistant' and any(
                block.get('type') == 'text' and 'POPUP_WORKER_OK' in block.get('text', '')
                for block in entry['message'].get('content', [])) for entry in entries)
        until(fd, answered, seconds=90)
        output = run('herdr', '--session', NAME, 'agent', 'read', record['agent_name'], '--source', 'recent-unwrapped', '--lines', '100')
        assert 'POPUP_WORKER_OK' in output
        snapshot = cli('api', 'snapshot')
        Path('/tmp/feature-popup-native-snapshot.json').write_text(json.dumps(snapshot, indent=2))
        # Snapshot nests state in snapshot on this Herdr version.
        snapshot = snapshot.get('snapshot', snapshot)
        assert snapshot['focused_tab_id'] == record['coordinator']['tab'], snapshot
        assert not run('git', 'status', '--porcelain', cwd=Path(record['cwd'])).strip()
        Path('/tmp/feature-popup-native-worker.log').write_text(output)
        print('PASS Ctrl-S launches exact brief in verified worker and focuses coordinator', flush=True)
    finally:
        drain(fd)
        log = '/tmp/feature-popup-native-ui.log' if '--ui-only' in sys.argv else '/tmp/feature-popup-native.log'
        Path(log).write_bytes(transcript)
        subprocess.run(['herdr', '--session', NAME, 'server', 'stop'], env=ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try: os.kill(pid, signal.SIGTERM)
        except ProcessLookupError: pass
        os.waitpid(pid, 0); os.close(fd)
        subprocess.run(['herdr', 'session', 'delete', NAME, '--json'], env=ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
