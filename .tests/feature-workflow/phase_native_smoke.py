#!/usr/bin/env python3
"""Private Herdr/Pi phase transitions with real Stax and offline compaction.
No user-server controls, live installation, network inference or desktop windows.
"""
import fcntl
import hashlib
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
import uuid

ROOT = Path(__file__).resolve().parents[2]
parent = ROOT / '.tests/feature-workflow/.tmp'
parent.mkdir(exist_ok=True)
tmp = Path(tempfile.mkdtemp(prefix='phase-', dir=parent))
NAME = 'phase-test-' + str(os.getpid())
assert os.environ.get('HERDR_ENV') == '1'
env = {k: v for k, v in os.environ.items() if not k.startswith(('HERDR_', 'PI_', 'GIT_'))}
(tmp / 'home').mkdir()
config = tmp / 'pi'
(config / 'extensions').mkdir(parents=True)
(config / 'extensions/feature-workflow').symlink_to(ROOT / 'pi/dot-config/pi/extensions/feature-workflow')
(config / 'extensions/offline.ts').symlink_to(ROOT / '.tests/feature-workflow/offline-provider.ts')
(config / 'extensions/herdr-agent-state.ts').symlink_to(Path.home() / '.config/pi/extensions/herdr-agent-state.ts')
(config / 'settings.json').write_text(json.dumps({'defaultProvider': 'feature-offline', 'defaultModel': 'coordinator', 'compaction': {'enabled': False, 'keepRecentTokens': 0}}))
herdr_config = tmp / 'herdr.toml'
herdr_config.write_text('onboarding = false\n[terminal]\ndefault_shell = "/bin/bash"\n[ui.sound]\nenabled = false\n[ui.toast]\ndelivery = "off"\n')
(tmp / 'config').mkdir()
config_fd = os.open(tmp / 'config', os.O_RDONLY | os.O_DIRECTORY)
env.update(HOME=str(tmp / 'home'), HISTFILE='/dev/null', PI_CODING_AGENT_DIR=str(config),
           XDG_STATE_HOME=str(tmp / 'state'), XDG_CONFIG_HOME=f'/proc/{os.getpid()}/fd/{config_fd}',
           XDG_DATA_HOME=str(tmp / 'data'), HERDR_CONFIG_PATH=str(herdr_config), TERM='xterm-256color')
repo = tmp / 'repo'
repo.mkdir()
def run(*args, cwd=None, timeout=90):
    return subprocess.check_output(args, cwd=cwd, env=env, text=True, stderr=subprocess.STDOUT, timeout=timeout)
def cli(*args):
    text = run('herdr', '--session', NAME, *args)
    return json.loads(text)['result'] if text.strip() else {}
def load(path): return json.loads(path.read_text())
run('git', 'init', '-qb', 'main', str(repo))
(repo / 'stax.toml').write_text('[worktree]\nroot_dir = ".."\n')
run('git', 'add', 'stax.toml', cwd=repo)
run('git', '-c', 'user.name=Test', '-c', 'user.email=test@invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Fixture', cwd=repo)
pid, fd = pty.fork()
if pid == 0:
    os.chdir(repo)
    os.execvpe('herdr', ['herdr', '--session', NAME], env)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 42, 140, 0, 0))
terminal = bytearray()
def drain():
    while select.select([fd], [], [], .02)[0]:
        try: chunk = os.read(fd, 65536)
        except OSError: break
        if not chunk: break
        terminal.extend(chunk)
def until(predicate, seconds=90):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        drain()
        try:
            result = predicate()
            if result: return result
        except (FileNotFoundError, ValueError, KeyError, subprocess.CalledProcessError): pass
        time.sleep(.1)
    raise AssertionError('Timeout; evidence: ' + str(tmp))
state = tmp / 'state/feature-workflow'
def control(session, **payload):
    folder = tmp / 'state/offline-controls' / session
    path = folder / (str(uuid.uuid4()) + '.json')
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(payload))
    temporary.replace(path)
def registration(session, old=None):
    for path in (state / 'sessions').glob('*.json'):
        entry = load(path)
        if entry['session'] == session and entry.get('live') and entry['epoch'] != old: return entry
try:
    pane = until(lambda: cli('pane', 'list')['panes'])[0]['pane_id']
    time.sleep(1)
    brief = tmp / 'brief.md'
    brief.write_bytes(b'Investigate only.\r\n  Exact original brief.\r\n')
    out = tmp / 'launch.json'
    argv = [str(ROOT / 'agents/dot-local/bin/feature-start'), 'fixture', '--repo', str(repo), '--brief-file', str(brief),
            '--coordinator', 'new', '--provider', 'feature-offline', '--model', 'worker', '--coordinator-provider', 'feature-offline', '--coordinator-model', 'coordinator']
    cli('pane', 'run', pane, shlex.join(argv) + ' > ' + shlex.quote(str(out)) + ' 2>&1')
    result = until(lambda: load(out))
    assert result['ok'], result
    receipt_file = Path(result['receipt'])
    original = receipt_file.read_bytes()
    receipt = json.loads(original)
    worker = until(lambda: registration(receipt['session']))
    coordinator = until(lambda: registration(receipt['coordinator']['session']))
    worktree = Path(worker['cwd'])
    head = run('git', 'rev-parse', 'HEAD', cwd=worktree).strip()
    until(lambda: cli('agent', 'get', worker['pane'])['agent']['agent_status'] in ('idle', 'done'))
    until(lambda: 'OFFLINE_WORKER_OK' in Path(worker['session_file']).read_text())
    private = {**env, 'HERDR_ENV': '1', 'HERDR_SOCKET_PATH': worker['instance']['socket'].replace(str(tmp / 'config'), env['XDG_CONFIG_HOME'], 1)}
    binding = json.loads(subprocess.check_output([str(ROOT / 'agents/dot-local/bin/feature-attach'), str(receipt_file), '--worker', worker['epoch'], '--coordinator', coordinator['epoch']], env=private, text=True, timeout=90))
    assert binding['ok']
    count_tabs = len(cli('tab', 'list')['tabs'])
    before = Path(worker['session_file']).read_bytes()
    handoff = tmp / 'handoff.md'
    handoff.write_text('Synthetic completed checkpoint. Keep original feature/session. Planning only; no release permissions.')
    auth = tmp / 'auth.md'
    auth.write_text('Synthetic user authorization: stack the next planning-only phase, keep or compact this same offline session. No commit/release/live operations.')
    next_brief = tmp / 'next.md'
    next_brief.write_bytes(b'Plan the next generic phase.\r\n  Preserve exact text.\r\n')
    reporting = state / 'reporting' / hashlib.sha256(worker['session'].encode()).hexdigest()
    def assessment():
        def current_observation():
            live = registration(worker['session'])
            leaf = json.loads(Path(worker['session_file']).read_text().splitlines()[-1]).get('id')
            return live['context'] if live.get('context', {}).get('leaf') == leaf else None
        observed = until(current_observation)
        return dict(usagePercent=observed['percent'], leaf=observed['leaf'], continuity='Continue the same synthetic feature',
                    debuggingHistory='Short deterministic fixture history; no unresolved debugging hypothesis',
                    rationale='Coordinator explicitly evaluates usage, continuity and history; requested compact tests its API, not an automatic threshold')
    def native_followup(key, busy=False, modal=False, mode='followUp', tools=False):
        focused = cli('api', 'snapshot')['snapshot']['focused_tab_id']
        opid = str(uuid.UUID(hex=hashlib.sha256((coordinator['session'] + ':' + key).encode()).hexdigest()[:32]))
        trace = state.parent / 'offline-controls' / worker['session'] / (key + '.trace.jsonl')
        if tools:
            control(worker['session'], action='tool-run', id=key, messageId=opid)
            until(lambda: trace.exists() and 'tool-start' in trace.read_text())
        if busy:
            control(worker['session'], action='settle', delay=8000)
            until(lambda: cli('agent', 'get', worker['pane'])['agent']['agent_status'] == 'working')
        if modal:
            control(worker['session'], action='modal')
            until(lambda: registration(worker['session']).get('busy'))
        follow_auth = tmp / (key + '-auth.md')
        follow_auth.write_bytes(b'/new\r\nSynthetic user authorizes a bounded read-only status; no release/live actions.\r\n')
        current = load(reporting / 'current.json')
        follow = dict(action='send', mode=mode, requestKey=key, feature=receipt['nonce'], relationship=current['request'], expectedRevision=current['revision'],
                      workerEpoch=worker['epoch'], coordinatorEpoch=coordinator['epoch'], busyPolicy='queue', scope='Return bounded read-only fixture evidence',
                      provenance='Synthetic private user request ' + key, authorizationFile=str(follow_auth), contextFile=str(handoff))
        prefix = Path(worker['session_file']).read_bytes()
        control(coordinator['session'], action='followup', input=follow)
        opid = str(uuid.UUID(hex=hashlib.sha256((coordinator['session'] + ':' + key).encode()).hexdigest()[:32]))
        operation = state / 'followups' / opid
        until(lambda: (operation / 'record.json').exists())
        if busy or modal or tools:
            until(lambda: load(operation / 'status.json')['status'] == 'queued')
            assert not (operation / 'claim.json').exists(), 'Queued work entered Pi prematurely'
        until(lambda: (operation / 'settled.json').exists())
        report = until(lambda: load(operation / 'report.json'))
        assert report['status'] == 'queued', report
        until(lambda: load(Path(report['acknowledgement']))['status'] == 'submitted')
        assert load(operation / 'persisted.json')['id'] == opid
        assert '"name":"feature_followup"' in Path(worker['session_file']).read_text(), 'Follow-up tool missing from real Pi context'
        assert Path(worker['session_file']).read_bytes().startswith(prefix)
        assert receipt_file.read_bytes() == original
        assert registration(worker['session'])['epoch'] == worker['epoch']
        assert len(cli('tab', 'list')['tabs']) == count_tabs
        assert cli('api', 'snapshot')['snapshot']['focused_tab_id'] == focused
        control(coordinator['session'], action='followup', input=follow)
        time.sleep(1.5)
        messages = [json.loads(line) for line in Path(worker['session_file']).read_text().splitlines()]
        assert sum(e.get('customType') == 'feature-followup' and e.get('details', {}).get('id') == opid for e in messages) == 1
        assert load(operation / 'claim.json')['mode'] == mode
        if tools:
            events = [json.loads(line) for line in trace.read_text().splitlines()]
            requests = [e for e in events if e['type'] == 'provider']
            assert [e['seen'] for e in requests] == ([False, True, True] if mode == 'steer' else [False, False, False, True]), events
            ends = [e for e in events if e['type'] == 'tool-end']
            assert len(ends) == 3 and all(not e['isError'] for e in ends), events
            next_request = next(i for i, e in enumerate(events) if e['type'] == 'provider' and e['step'] == 1)
            assert sum(e['type'] == 'tool-end' for e in events[:next_request]) == 2, events
            assert load(operation / 'claim.json')['boundary'] == ('turn_end' if mode == 'steer' else 'agent_before_settle')
            assert events[-1] == {'type': 'settled', 'aborted': False}, events
        return operation
    initial_followup = native_followup('legacy-followup', busy=True)
    native_followup('modal-followup', modal=True)
    native_followup('streaming-steer', mode='steer', tools=True)
    native_followup('post-work-followup', mode='followUp', tools=True)
    native_followup('idle-steer', mode='steer')
    print('PASS native steer reaches the next model request only after both in-flight tools finish; followUp waits through subsequent tools and final answer; neither aborts tools', flush=True)
    print('PASS native legacy follow-ups queue for actual busy/modal Pi, preserve slash text and transcript, deliver once and report to pinned coordinator without focus', flush=True)
    request = dict(action='start', requestKey='native-next', relationship=binding['request'], expectedRevision=binding['revision'], expectedHead=head,
                   expectedParent='main', nextBranch='feature/second', sessionMode='compact', contextEvaluation=assessment(), handoffFile=str(handoff), briefFile=str(next_brief), authorizationFile=str(auth))
    control(coordinator['session'], action='phase', input=request)
    phase_path = until(lambda: next((p for p in (state / 'phases').glob('*/record.json') if load(p)['nextBranch'] == 'feature/second'), None))
    phase = phase_path.parent
    until(lambda: (phase / 'delivered.json').exists())
    evaluation = load(phase_path)['contextEvaluation']
    assert evaluation['decision'] == 'compact' and evaluation['continuity'] and evaluation['debuggingHistory'] and evaluation['rationale']
    assert 'usagePercent' in evaluation  # null remains explicit unknown, never zero-coerced.
    assert (phase / 'compacted.json').exists(), load(phase / 'blocked.json') if (phase / 'blocked.json').exists() else phase
    after = Path(worker['session_file']).read_bytes()
    assert after.startswith(before), 'Compaction deleted/replaced transcript history'
    entries = [json.loads(line) for line in after.splitlines()]
    assert any(e.get('type') == 'compaction' and e['id'] == load(phase / 'compacted.json')['entry'] for e in entries)
    assert sum(e.get('customType') == 'feature-phase-assignment' for e in entries) == 1
    assert receipt_file.read_bytes() == original
    assert run('git', 'branch', '--show-current', cwd=worktree).strip() == 'feature/second'
    assert run('git', 'rev-parse', 'HEAD', cwd=worktree).strip() == head
    meta = json.loads(run('git', 'show', 'refs/branch-metadata/feature/second', cwd=worktree))
    assert meta['parentBranchName'] == 'feature/fixture' and meta['parentBranchRevision'] == head
    assert len(cli('tab', 'list')['tabs']) == count_tabs
    assert registration(worker['session'])['epoch'] == worker['epoch']
    binding2 = load(phase / 'binding.json')
    def received(revision):
        for path in (state / 'inbox' / coordinator['epoch']).glob('*.request.json'):
            if load(path).get('revision') == revision and load(Path(str(path).replace('.request.json', '.ack.json'))).get('status') == 'submitted': return path
    until(lambda: received(binding2['revision']))
    print('PASS native same-session real compaction, transcript/receipt preservation, Stax parent/HEAD, two-endpoint reporting and one assignment', flush=True)
    control(coordinator['session'], action='phase', input=request)
    time.sleep(2)
    assert Path(worker['session_file']).read_text().count('"customType":"feature-phase-assignment"') == 1
    control(worker['session'], action='reload')
    old_worker = worker
    worker = until(lambda: registration(worker['session'], old_worker['epoch']))
    pointer = load(reporting / 'current.json')
    control(coordinator['session'], action='phase', input=dict(action='renew', id=load(phase_path)['id'], expectedRevision=pointer['revision'], workerEpoch=worker['epoch']))
    def renewal_ready():
        ptr = load(reporting / 'current.json')
        if ptr['revision'] != pointer['revision'] and (Path(ptr['request']).parent / 'ready.json').exists(): return ptr
    renewed = until(renewal_ready)
    control(worker['session'], action='settle')
    until(lambda: received(renewed['revision']))
    assert Path(worker['session_file']).read_text().count('"customType":"feature-phase-assignment"') == 1
    native_followup('renewed-phase-followup')
    native_followup('renewed-phase-steer', mode='steer')
    print('PASS native reload requires explicit phase-aware renewal; only future status forwarded, no assignment replay; renewed phase follow-up works', flush=True)
    until(lambda: cli('agent', 'get', worker['pane'])['agent']['agent_status'] in ('idle', 'done'))
    fail_flag = tmp / 'state/offline-controls' / worker['session'] / 'fail-compaction'
    fail_flag.write_text('Synthetic cancellation through real Pi compaction API')
    third_request = {**request, 'requestKey': 'native-third', 'relationship': renewed['request'], 'expectedRevision': renewed['revision'],
                     'expectedParent': 'feature/fixture', 'nextBranch': 'feature/third', 'contextEvaluation': assessment()}
    control(coordinator['session'], action='phase', input=third_request)
    third_file = until(lambda: next((p for p in (state / 'phases').glob('*/record.json') if load(p)['nextBranch'] == 'feature/third'), None))
    third = third_file.parent
    until(lambda: (third / 'compact-failed.json').exists())
    assert not (third / 'branch-claim.json').exists()
    assert run('git', 'branch', '--show-current', cwd=worktree).strip() == 'feature/second'
    control(coordinator['session'], action='phase', input=dict(action='recover', id=load(third_file)['id'], expectedStage='compaction-failed',
            resolution='keep-after-failed-compaction', authorizationFile=str(auth)))
    until(lambda: (third / 'delivered.json').exists())
    assert (third / 'compact-skipped.json').exists()
    assert len(cli('tab', 'list')['tabs']) == count_tabs
    assert receipt_file.read_bytes() == original
    assert not run('git', 'status', '--porcelain', cwd=worktree).strip()
    assert run('git', 'rev-parse', 'HEAD', cwd=worktree).strip() == head
    print('PASS native compaction failure blocks branch; correlated explicit keep recovery advances subsequent phase without retrying compaction', flush=True)
finally:
    drain()
    (tmp / 'terminal.log').write_bytes(terminal)
    subprocess.run(['herdr', '--session', NAME, 'server', 'stop'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try: os.kill(pid, signal.SIGTERM)
    except ProcessLookupError: pass
    os.waitpid(pid, 0)
    os.close(fd)
    os.close(config_fd)
    print('Retained private test evidence:', tmp, flush=True)
