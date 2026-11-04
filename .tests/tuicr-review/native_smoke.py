#!/usr/bin/env python3
"""Private real Herdr/Pi/tuicr acceptance mechanics; deterministic offline model only.
Never contacts the user's Herdr server or installs candidate configuration.
Fixtures and failure logs remain in .tmp for inspection.
"""
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import signal
import struct
import subprocess
import tempfile
import termios
import time

ROOT = Path(__file__).resolve().parents[2]
parent = ROOT / '.tests/tuicr-review/.tmp'
parent.mkdir(exist_ok=True)
tmp = Path(tempfile.mkdtemp(prefix='native-', dir=parent))
NAME = 'review-test-' + str(os.getpid())
assert os.environ.get('HERDR_ENV') == '1'
env = {k: v for k, v in os.environ.items() if not k.startswith(('HERDR_', 'PI_', 'GIT_'))}
config = tmp / 'pi'
config.mkdir()
(tmp / 'home').mkdir()
env.update(HOME=str(tmp / 'home'), HISTFILE='/dev/null')
(config / 'settings.json').write_text(json.dumps({'defaultProvider': 'feature-offline', 'defaultModel': 'coordinator'}))
herdr_config = tmp / 'herdr.toml'
herdr_config.write_text('onboarding = false\n[terminal]\ndefault_shell = "/bin/bash"\n[ui.sound]\nenabled = false\n[ui.toast]\ndelivery = "off"\n')
# AF_UNIX paths are limited to 108 bytes. A proc-fd alias keeps all writes in
# this worktree while giving the isolated Herdr socket a short pathname.
(tmp / 'config').mkdir()
config_fd = os.open(tmp / 'config', os.O_RDONLY | os.O_DIRECTORY)
short_config = f'/proc/{os.getpid()}/fd/{config_fd}'
env.update(PI_CODING_AGENT_DIR=str(config), XDG_STATE_HOME=str(tmp / 'state'), XDG_CONFIG_HOME=short_config,
           XDG_DATA_HOME=str(tmp / 'data'), HERDR_CONFIG_PATH=str(herdr_config), TERM='xterm-256color')
repo = tmp / 'repo'
repo.mkdir()
def run(*args, cwd=None, timeout=60):
    return subprocess.check_output(args, env=env, cwd=cwd, text=True, stderr=subprocess.STDOUT, timeout=timeout)
def cli(*args):
    value = run('herdr', '--session', NAME, *args)
    return json.loads(value)['result'] if value.strip() else {}
run('git', 'init', '-q', '-b', 'main', str(repo))
(repo / 'chosen.txt').write_text('old\n')
(repo / 'unrelated.txt').write_text('old unrelated\n')
(repo / 'delete.txt').write_text('delete me\n')
(repo / 'mode.sh').write_text('#!/bin/sh\nexit 0\n')
(repo / 'oldname.txt').write_text('renamed text\n')
run('git', 'add', '.', cwd=repo)
run('git', '-c', 'user.name=Test', '-c', 'user.email=test@invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Fixture', cwd=repo)
(repo / 'chosen.txt').write_text('new\n')
(repo / 'unrelated.txt').write_text('UNRELATED PRIVATE DATA\n')
(repo / 'delete.txt').unlink()
(repo / 'mode.sh').chmod(0o755)
(repo / 'oldname.txt').rename(repo / 'newname.txt')
(repo / 'newfile.txt').write_text('selected new file\n')
run('git', 'add', 'unrelated.txt', cwd=repo)
index = (repo / '.git/index').read_bytes()
status = run('git', '--no-optional-locks', 'status', '--porcelain', cwd=repo)
pid, fd = pty.fork()
if pid == 0:
    os.chdir(repo)
    os.execvpe('herdr', ['herdr', '--session', NAME], env)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 42, 140, 0, 0))
transcript = bytearray()
def drain():
    while select.select([fd], [], [], .02)[0]:
        try: chunk = os.read(fd, 65536)
        except OSError: break
        if not chunk: break
        transcript.extend(chunk)
def until(predicate, seconds=60):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        drain()
        try:
            value = predicate()
            if value: return value
        except (subprocess.CalledProcessError, KeyError, ValueError, FileNotFoundError): pass
        time.sleep(.15)
    raise AssertionError('Timeout; inspect ' + str(tmp))
def load(path): return json.loads(path.read_text())
try:
    origin = until(lambda: cli('pane', 'list')['panes'])[0]
    time.sleep(1)
    request = {'action': 'open', 'repo': str(repo), 'base': 'main', 'paths': ['chosen.txt'], 'requestKey': 'native-one'}
    session = tmp / 'pi-session.jsonl'
    cli('agent', 'start', 'review-fixture', '--kind', 'pi', '--pane', origin['pane_id'], '--timeout', '60000', '--',
        '--no-extensions', '--extension', str(ROOT / 'pi/dot-config/pi/extensions/tuicr-review.ts'),
        '--extension', str(ROOT / '.tests/feature-workflow/offline-provider.ts'),
        '--extension', str(Path.home() / '.config/pi/extensions/herdr-agent-state.ts'),
        '--provider', 'feature-offline', '--model', 'coordinator', '--session', str(session))
    # Pi may defer creating a virgin session file until its first model turn.
    # Warm up the disposable offline conversation so its header is verifiable.
    cli('agent', 'prompt', origin['pane_id'], 'Offline fixture warmup')
    until(lambda: 'OFFLINE_COORDINATOR_OK' in session.read_text())
    until(lambda: cli('agent', 'get', origin['pane_id'])['agent']['agent_status'] in ('idle', 'done'))
    # An intervening tab reproduces Craig's failure: adjacency is not the origin.
    intervening = cli('tab', 'create', '--cwd', str(repo), '--label', 'not-the-origin', '--no-focus')
    # Only synthetic Pi receives test input. Real command shares the tool lifecycle.
    cli('agent', 'prompt', origin['pane_id'], '/review ' + json.dumps(request))
    reviews = tmp / 'state/feature-workflow/reviews'
    manifest_path = until(lambda: next(reviews.glob('*/manifest.json'), None))
    review = manifest_path.parent
    manifest = load(manifest_path)
    launch = until(lambda: load(review / 'launch.json').get('pane') and load(review / 'launch.json'))
    until(lambda: (review / 'started.json').exists())
    assert manifest['snapshot']['fileCount'] == 1
    assert not (review / 'snapshot/unrelated.txt').exists()
    assert (repo / '.git/index').read_bytes() == index
    # Observe actual tuicr controls in the private terminal, then mark one file reviewed.
    until(lambda: 'chosen.txt' in run('herdr', '--session', NAME, 'pane', 'read', launch['pane'], '--source', 'recent-unwrapped', '--lines', '100'))
    (tmp / 'tuicr-screen.txt').write_text(run('herdr', '--session', NAME, 'pane', 'read', launch['pane'], '--lines', '100'))
    (tmp / 'before-close.json').write_text(json.dumps(cli('api', 'snapshot'), indent=2))
    # tuicr marks the selected file reviewed with r.
    cli('pane', 'send-keys', launch['pane'], 'r')
    cli('pane', 'send-text', launch['pane'], ':wq')
    cli('pane', 'send-keys', launch['pane'], 'enter')
    completion = until(lambda: load(review / 'completion.json'))
    assert completion['state'] == 'completed', completion
    assert completion['reviewed'] == completion['total'] == 1 and completion['commentCount'] == 0, completion
    until(lambda: load(review / 'delivery.json')['state'] == 'delivered')
    until(lambda: session.read_text().count('OFFLINE_COORDINATOR_OK') >= 2)
    entries = [json.loads(line) for line in session.read_text().splitlines()]
    reports = [e for e in entries if e.get('customType') == 'feature-review-completion']
    assert len(reports) == 1
    assert '"name":"feature_review"' in session.read_text(), 'Tool was not exposed to the real Pi model context'
    report_index = entries.index(reports[0])
    assert any(e.get('message', {}).get('role') == 'assistant' for e in entries[report_index + 1:]), 'No actual Pi turn after completion'
    assert (repo / '.git/index').read_bytes() == index
    assert run('git', '--no-optional-locks', 'status', '--porcelain', cwd=repo) == status
    until(lambda: launch['pane'] not in [p['pane_id'] for p in cli('pane', 'list')['panes']])
    after_close = cli('api', 'snapshot')
    (tmp / 'after-close.json').write_text(json.dumps(after_close, indent=2))
    assert after_close['snapshot']['focused_tab_id'] == origin['tab_id'], ('Focused close returned to adjacent tab instead of exact origin', load(review / 'return-focus.json'))
    assert load(review / 'origin.json')['terminal'] == origin['terminal_id']
    assert load(review / 'return-focus.json')['state'] == 'acknowledged'
    print('PASS native focused return to exact origin across intervening tab; frozen review and real offline completion turn', flush=True)

    def next_review(key):
        until(lambda: cli('agent', 'get', origin['pane_id'])['agent']['agent_status'] in ('idle', 'done'))
        cli('agent', 'prompt', origin['pane_id'], '/review ' + json.dumps({**request, 'requestKey': key}))
        path = until(lambda: next((p for p in reviews.glob('*/manifest.json') if load(p)['requestKey'] == key), None))
        directory = path.parent
        until(lambda: (directory / 'started.json').exists())
        opened = load(directory / 'launch.json')
        until(lambda: request['paths'][0] in run('herdr', '--session', NAME, 'pane', 'read', opened['pane'], '--lines', '100'))
        return directory, opened

    second, second_ui = next_review('native-two')
    # Reload only this disposable session while the review runs independently.
    cli('agent', 'prompt', origin['pane_id'], '/offline-reload')
    time.sleep(2)
    # Add explicitly synthetic feedback to this private tuicr store only.
    private_env = {**env, 'XDG_DATA_HOME': str(second / 'data')}
    listed = json.loads(subprocess.check_output(['tuicr', 'review', 'list', '--repo', str(second / 'snapshot')], env=private_env, text=True))
    subprocess.check_call(['tuicr', 'review', 'add', '--repo', str(second / 'snapshot'), '--session', listed[0]['slug'],
                           '--target-file', 'chosen.txt', '--line', '1', '--type', 'note', '--username', 'fixture',
                           'SYNTHETIC_NATIVE_FEEDBACK'], env=private_env, stdout=subprocess.DEVNULL)
    time.sleep(1)
    # Put the invoking Pi into a genuine offline busy turn.
    session_id = load(second / 'manifest.json')['owner']['session']
    controls = tmp / 'state/offline-controls' / session_id
    (controls / 'busy.json').write_text(json.dumps({'delay': 8000}))
    until(lambda: cli('agent', 'get', origin['pane_id'])['agent']['agent_status'] == 'working')
    elsewhere = cli('tab', 'create', '--cwd', str(repo), '--label', 'elsewhere', '--focus')
    cli('pane', 'send-keys', second_ui['pane'], 'r')
    cli('pane', 'send-text', second_ui['pane'], ':wq')
    cli('pane', 'send-keys', second_ui['pane'], 'enter')
    until(lambda: (second / 'completion.json').exists())
    until(lambda: load(second / 'delivery.json')['state'] == 'queued')
    until(lambda: load(second / 'delivery.json')['state'] == 'delivered')
    assert load(second / 'completion.json')['state'] == 'completed'
    assert any(c['content'] == 'SYNTHETIC_NATIVE_FEEDBACK' for c in load(second / 'feedback.json'))
    assert cli('api', 'snapshot')['snapshot']['focused_tab_id'] == elsewhere['tab']['tab_id'], 'Focus stolen after completion'
    until(lambda: second_ui['pane'] not in [p['pane_id'] for p in cli('pane', 'list')['panes']])
    print('PASS native reload during review, busy queue, preserved comments and no focus stealing', flush=True)

    third, third_ui = next_review('native-partial')
    cli('pane', 'send-text', third_ui['pane'], ':q')
    cli('pane', 'send-keys', third_ui['pane'], 'enter')
    until(lambda: (third / 'completion.json').exists())
    assert load(third / 'completion.json')['state'] == 'incomplete'
    until(lambda: load(third / 'delivery.json')['state'] == 'delivered')
    fourth, fourth_ui = next_review('native-cancelled')
    cli('tab', 'close', fourth_ui['tab'])
    until(lambda: (fourth / 'completion.json').exists())
    assert load(fourth / 'completion.json')['state'] == 'cancelled'
    until(lambda: load(fourth / 'delivery.json')['state'] == 'delivered')
    reports = [json.loads(line) for line in session.read_text().splitlines() if json.loads(line).get('customType') == 'feature-review-completion']
    assert len(reports) == 4 and len({r['details']['reviewId'] for r in reports}) == 4, 'Report replay or loss'
    assert (repo / '.git/index').read_bytes() == index
    assert run('git', '--no-optional-locks', 'status', '--porcelain', cwd=repo) == status
    print('PASS native partial vs cancelled UI, no replay after reload, original index/worktree unchanged', flush=True)
    request['paths'] = ['delete.txt', 'mode.sh', 'oldname.txt', 'newname.txt', 'newfile.txt']
    fifth, fifth_ui = next_review('native-file-kinds')
    for _ in range(5):
        cli('pane', 'send-keys', fifth_ui['pane'], 'r')
        cli('pane', 'send-keys', fifth_ui['pane'], '}')
    cli('pane', 'send-text', fifth_ui['pane'], ':wq')
    cli('pane', 'send-keys', fifth_ui['pane'], 'enter')
    until(lambda: (fifth / 'completion.json').exists())
    assert load(fifth / 'completion.json')['state'] == 'completed', load(fifth / 'completion.json')
    assert load(fifth / 'completion.json')['total'] == 5
    until(lambda: load(fifth / 'delivery.json')['state'] == 'delivered')
    assert (repo / '.git/index').read_bytes() == index
    assert run('git', '--no-optional-locks', 'status', '--porcelain', cwd=repo) == status
    print('PASS native selected new file, deletion, executable-only change and explicit rename path pair', flush=True)
    request['paths'] = ['chosen.txt']
    moved, moved_ui = next_review('native-moved-review')
    move = cli('pane', 'move', moved_ui['pane'], '--new-tab', '--label', 'moved-review', '--no-focus')
    moved_pane = move['move_result']['pane']['pane_id']
    cli('tab', 'focus', elsewhere['tab']['tab_id'])
    cli('pane', 'send-text', moved_pane, ':q')
    cli('pane', 'send-keys', moved_pane, 'enter')
    until(lambda: (moved / 'close.json').exists())
    assert load(moved / 'close.json')['state'] == 'retained'
    assert not (moved / 'return-focus.json').exists(), 'Moved review attempted focus return'
    assert cli('api', 'snapshot')['snapshot']['focused_tab_id'] == elsewhere['tab']['tab_id']
    until(lambda: load(moved / 'delivery.json')['state'] == 'delivered')
    stale, stale_ui = next_review('native-closed-origin')
    cli('tab', 'close', origin['tab_id'])  # Only our disposable Pi; runner stays independent.
    cli('pane', 'send-text', stale_ui['pane'], ':q')
    cli('pane', 'send-keys', stale_ui['pane'], 'enter')
    until(lambda: (stale / 'return-focus.json').exists())
    assert load(stale / 'return-focus.json') == {'state': 'skipped', 'reason': 'origin_unavailable', 'atomic': False}
    assert (repo / '.git/index').read_bytes() == index
    print('PASS native moved-review ownership refusal and closed-origin return refusal', flush=True)
finally:
    drain()
    (tmp / 'terminal.log').write_bytes(transcript)
    subprocess.run(['herdr', '--session', NAME, 'server', 'stop'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try: os.kill(pid, signal.SIGTERM)
    except ProcessLookupError: pass
    os.waitpid(pid, 0)
    os.close(fd)
    os.close(config_fd)
    # Test-only server shutdown; retained files are all under this worktree fixture.
    print('Retained private test evidence:', tmp, flush=True)
