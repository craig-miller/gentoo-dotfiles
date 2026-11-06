import json
import os
from pathlib import Path
import subprocess
import socket
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from test_launcher import m, ROOT


class CoordinatorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.repo = self.root / 'repo'
        self.git('init', '-q', '-b', 'main', str(self.repo), cwd=self.root)
        self.git('-c', 'user.name=Test', '-c', 'user.email=test@invalid', '-c', 'core.hooksPath=/dev/null',
                 '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'Fixture')
        self.env = patch.dict(os.environ, HERDR_ENV='1', XDG_STATE_HOME=str(self.root / 'state'),
                              XDG_CONFIG_HOME=str(self.root / 'config'),
                              PI_CODING_AGENT_DIR=str(ROOT / 'pi/dot-config/pi'))
        self.env.start()
        self.socket = socket.socket(socket.AF_UNIX)
        self.socket.bind(str(self.root / 'herdr.sock'))
        os.environ['HERDR_SOCKET_PATH'] = str(self.root / 'herdr.sock')
        self.session_file = self.root / 'session.jsonl'
        self.session_file.write_text(json.dumps({'type': 'session', 'id': 'coordinator'}) + '\n')
        self.registry = m.state_root() / 'sessions'
        self.registry.mkdir(parents=True)
        self.epoch = '12345678-1234-1234-1234-123456789abc'
        self.item = dict(instance=m.herdr_instance(), epoch=self.epoch, session='coordinator', session_file=str(self.session_file), common=str(self.repo / '.git'),
                         cwd=str(self.repo), pane='w:p1', tab='w:t1', workspace='w', role='coordinator', live=True,
                         updated=m.time.time() * 1000, provider='cp', model='cm')
        self.item['enrollment'] = {**self.item, 'version': 1}
        self.agent = dict(agent='pi', pane_id='w:p1', tab_id='w:t1', workspace_id='w', foreground_cwd=str(self.repo), agent_session={'value': str(self.session_file)})
        m.write_json(self.registry / (self.epoch + '.json'), self.item)
        (m.state_root() / 'inbox' / self.epoch).mkdir(parents=True)

    def tearDown(self):
        self.socket.close()
        self.env.stop()
        self.temp.cleanup()

    def git(self, *args, cwd=None):
        return subprocess.check_output(['git', *args], cwd=cwd or self.repo, stderr=subprocess.STDOUT, text=True).strip()

    def test_common_directory_across_worktrees_not_folder_name(self):
        other = self.root / 'linked'
        self.git('worktree', 'add', '-q', '-b', 'linked', str(other))
        common = self.git('-C', str(other), 'rev-parse', '--path-format=absolute', '--git-common-dir')
        with patch.object(m, 'herdr', return_value={'agent': self.agent}):
            self.assertEqual(m.coordinator_identity(self.epoch, common)['session'], 'coordinator')
            with self.assertRaises(m.LaunchError):
                m.coordinator_identity(self.epoch, self.root / 'other/repo/.git')

    def test_stale_closed_replaced_and_wrong_role_refuse(self):
        for changes in ({'live': False}, {'updated': 0}, {'role': 'worker'}, {'epoch': 'wrong'}, {'enrollment': None}, {'enrollment': {}}):
            m.write_json(self.registry / (self.epoch + '.json'), {**self.item, **changes})
            with self.subTest(changes=changes), self.assertRaises(m.LaunchError):
                m.coordinator_identity(self.epoch, self.item['common'])
        m.write_json(self.registry / (self.epoch + '.json'), self.item)
        for agent in ({**self.agent, 'agent_session': {'value': '/new.jsonl'}}, {**self.agent, 'agent': 'fish'}):
            with patch.object(m, 'herdr', return_value={'agent': agent}), self.assertRaises(m.LaunchError):
                m.coordinator_identity(self.epoch, self.item['common'])
        with patch.object(m, 'herdr', side_effect=m.LaunchError('closed')), self.assertRaises(m.LaunchError):
            m.coordinator_identity(self.epoch, self.item['common'])

    def launch_fixture(self, choice, acknowledgement='queued'):
        directory = m.state_root() / 'run'
        directory.mkdir()
        receipt = directory / 'receipt.json'
        brief = self.root / 'brief.md'
        brief.write_bytes(b'Investigate only.\r\n\r\n  "reuse"\r\n')
        (self.repo / 'dirty.txt').write_text('untouched')
        args = SimpleNamespace(name='test', brief_file=str(brief), context_file=None, repo=str(self.repo), base='main',
                               coordinator=choice, coordinator_provider='coord-provider', coordinator_model='coord-model',
                               provider='worker-provider', model='worker-model', require_sibling=False, origin_pane='w:p1')
        calls, agents, latest = [], {}, {}
        original_run, original_wait = m.run, m.wait_json
        def save(state):
            latest.update(state)
            m.write_json(receipt, latest)
        def run(argv, **kwargs):
            if argv[:3] == ['stax', 'worktree', 'create']:
                target = self.root / 'worker'
                self.git('worktree', 'add', '-q', '-b', argv[3], str(target), 'main')
                return ''
            return original_run(argv, **kwargs)
        def herdr(*argv, **kwargs):
            calls.append(argv)
            if argv[:2] == ('pane', 'get'): return {'pane': {'workspace_id': 'w'}}
            if argv[:2] == ('tab', 'create'):
                num = sum(call[:2] == ('tab', 'create') for call in calls) + 1
                return {'root_pane': {'pane_id': f'w:p{num}'}, 'tab': {'tab_id': f'w:t{num}'}}
            if argv[:2] == ('tab', 'focus'): return {}
            if argv[:2] == ('agent', 'start'):
                path = Path(argv[argv.index('--feature-request') + 1])
                request = json.loads(path.read_text())
                session_file = self.root / (request['session'] + '.jsonl')
                session_file.write_text(json.dumps({'type': 'session', 'id': request['session']}) + '\n')
                observed = {**request, 'epoch': 'worker-epoch', 'session_file': str(session_file)}
                m.write_json(path.parent / 'ready.json', observed)
                agent = dict(agent='pi', pane_id=request['pane'], tab_id=request['tab'], workspace_id=request['workspace'], foreground_cwd=request['cwd'], agent_status='idle',
                             agent_session={'value': observed['session_file']})
                agents[argv[2]] = agent
                if request['role'] == 'coordinator':
                    item = {**self.item, **{k: observed[k] for k in ('session', 'session_file', 'pane', 'tab', 'provider', 'model')}}
                    item['enrollment'] = {k: v for k, v in {**item, 'version': 1}.items() if k != 'enrollment'}
                    self.item = item
                    self.agent = agent
                    m.write_json(self.registry / (self.epoch + '.json'), item)
                return {}
            if argv[:2] == ('agent', 'get'):
                return {'agent': agents.get(argv[2], self.agent)}
            raise AssertionError(argv)
        def wait(path, **kwargs):
            if str(path).endswith('.ack.json'):
                request = json.loads(Path(str(path).replace('.ack.json', '.request.json')).read_text())
                self.assertIn(brief.read_bytes().decode(), request['content'])
                self.assertIn('not implementation permission', request['content'])
                self.assert_generic_guidance(request['content'])
                self.assertIn('as coordinator', request['content'])
                return dict(id=request['id'], feature=request['feature'], epoch=self.epoch, status=acknowledgement)
            if path.name == 'delivery.json':
                return {'nonce': latest['nonce'], 'status': 'submitted'}
            return original_wait(path, **kwargs)
        with patch.object(m, 'run', side_effect=run), patch.object(m, 'herdr', side_effect=herdr), patch.object(m, 'wait_json', side_effect=wait):
            if acknowledgement == 'uncertain':
                with self.assertRaisesRegex(m.LaunchError, 'not acknowledged'):
                    m.launch(args, receipt, save)
                self.assertFalse((directory / 'release.json').exists())
                self.assertTrue((self.root / 'worker').is_dir())
                return
            result = m.launch(args, receipt, save)
        self.assertEqual((self.repo / 'dirty.txt').read_text(), 'untouched')
        self.assertEqual(result['model'], 'worker-model')
        self.assertEqual(result['coordinator']['epoch'], self.epoch)
        self.assertEqual(result['coordinator_handoff']['status'], acknowledgement)
        starts = [call for call in calls if call[:2] == ('agent', 'start')]
        self.assertEqual(len(starts), 2 if choice == 'new' else 1)
        if choice == 'new':
            self.assertEqual(result['coordinator']['model'], 'coord-model')
            self.assertEqual(result['coordinator_startup']['cwd'], str(self.repo))
            self.assertNotEqual(result['coordinator']['session'], result['session'])
        self.assertEqual(result['brief'], brief.read_bytes().decode())
        for call in starts:
            guard = call[call.index('--append-system-prompt') + 1]
            self.assert_generic_guidance(guard)
        for repo in (self.repo, self.root / 'worker'):
            self.assertFalse((repo / 'AGENTS.md').exists())
            self.assertFalse((repo / 'docs/development-workflow.md').exists())
        worker_guard = starts[-1][starts[-1].index('--append-system-prompt') + 1]
        self.assertIn('do not launch another feature worker', worker_guard)
        self.assertIn('Only this worktree is writable', worker_guard)
        self.assertEqual([c for c in calls if c[:2] == ('tab', 'focus')], [('tab', 'focus', result['coordinator']['tab'])])
        self.assertEqual(len([c for c in calls if c[:2] == ('tab', 'create')]), len(starts))

    def assert_generic_guidance(self, text):
        self.assertIn('~/.config/agents/skills/feature-workflow/SKILL.md', text)
        self.assertIn('project instructions already supplied by Pi', text)
        self.assertNotIn('AGENTS.md', text)
        self.assertNotIn('development-workflow.md', text)
        self.assertNotIn('Zentoo', text)

    def test_existing_busy_coordinator_acknowledges_queue_without_second_coordinator(self):
        self.launch_fixture(self.epoch)

    def test_new_coordinator_and_worker_models_and_sessions_are_independent(self):
        self.launch_fixture('new', 'submitted')

    def test_uncertain_coordinator_ack_keeps_resources_and_does_not_release_worker(self):
        self.launch_fixture(self.epoch, 'uncertain')


if __name__ == '__main__': unittest.main()
