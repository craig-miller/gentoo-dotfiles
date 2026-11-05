import hashlib
import json
from pathlib import Path
import runpy
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import test_coordinator as fixture

ROOT = Path(__file__).resolve().parents[2]
a = SimpleNamespace(**runpy.run_path(str(ROOT / 'agents/dot-local/bin/feature-attach')))


class AttachTests(fixture.CoordinatorTests):
    def setUp(self):
        super().setUp()
        self.item['capabilities'] = ['reporting-attach-v1']
        a.core.write_json(self.registry / (self.epoch + '.json'), self.item)
        self.worker_path = self.root / 'progress'
        self.git('worktree', 'add', '-q', '-b', 'feature/test', str(self.worker_path))
        self.git('-c', 'user.name=Test', '-c', 'user.email=test@invalid', '-c', 'core.hooksPath=/dev/null',
                 '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'Real progress', cwd=self.worker_path)
        (self.worker_path / 'uncommitted').write_text('keep progress')
        self.worker_epoch = '22222222-2222-2222-2222-222222222222'
        session_file = self.root / 'worker.jsonl'
        session_file.write_text(json.dumps({'type': 'session', 'id': 'worker-session'}) + '\n')
        self.worker = {**self.item, 'role': 'worker', 'epoch': self.worker_epoch, 'session': 'worker-session',
                       'session_file': str(session_file), 'pane': 'w:p2', 'tab': 'w:t2', 'cwd': str(self.worker_path)}
        self.worker['enrollment'] = {k: v for k, v in {**self.worker, 'version': 1}.items() if k != 'enrollment'}
        a.core.write_json(self.registry / (self.worker_epoch + '.json'), self.worker)
        (a.core.state_root() / 'inbox' / self.worker_epoch).mkdir(parents=True)
        self.receipt = self.root / 'legacy-receipt.json'
        self.original = {'version': 1, 'nonce': 'feature', 'session': 'worker-session', 'repo': str(self.repo),
                         'cwd': str(self.worker_path), 'branch': 'feature/test', 'base': 'main',
                         'head': self.git('rev-parse', 'main'), 'brief': 'Investigate only.\r\n  verbatim\r\n',
                         'context': 'No implementation permission.', 'worker': {'session_file': str(session_file)}}
        a.core.write_json(self.receipt, self.original)
        self.before = self.receipt.read_bytes()
        self.agents = {self.item['pane']: self.agent, self.worker['pane']: {**self.agent, 'pane_id': self.worker['pane'],
                       'tab_id': self.worker['tab'], 'foreground_cwd': str(self.worker_path), 'agent_session': {'value': str(session_file)}}}
        self.herdr = patch.dict(a.core.session_identity.__globals__, herdr=lambda *args: {'agent': self.agents[args[-1]]})
        self.herdr.start()
        self.addCleanup(self.herdr.stop)
        self.args = SimpleNamespace(receipt=str(self.receipt), worker=self.worker_epoch, coordinator=self.epoch, replace=None)

    def ack(self, path, **kwargs):
        request = json.loads((path.parent / 'request.json').read_text())
        stage, role = path.stem.split('-')
        value = {'revision': request['revision'], 'feature': request['feature'], 'status': stage, 'role': role,
                 'epoch': request[role]['epoch'], 'worker_epoch': request['worker']['epoch'],
                 'coordinator_epoch': request['coordinator']['epoch'], 'busy': True}
        a.core.write_json(path, value)
        return value

    def test_legacy_attachment_keeps_dirty_committed_progress_and_brief(self):
        before_head = self.git('rev-parse', 'HEAD', cwd=self.worker_path)
        self.assertNotEqual(before_head, self.original['head'])
        with patch.object(a.core, 'wait_json', side_effect=self.ack):
            result = a.attach(self.args)
        self.assertEqual(result['status'], 'ready')
        self.assertTrue(result['prepared']['worker']['busy'])
        self.assertEqual(self.receipt.read_bytes(), self.before)
        self.assertEqual(self.git('rev-parse', 'HEAD', cwd=self.worker_path), before_head)
        self.assertEqual((self.worker_path / 'uncommitted').read_text(), 'keep progress')
        self.assertEqual(len(self.git('worktree', 'list').splitlines()), 2)
        self.assertFalse((Path(result['request']).parent / 'release.json').exists())
        self.assertEqual(json.loads(Path(result['request']).read_text())['receipt_sha256'], hashlib.sha256(self.before).hexdigest())

    def test_explicit_rebind_required_even_for_same_endpoint(self):
        with patch.object(a.core, 'wait_json', side_effect=self.ack):
            first = a.attach(self.args)
            with self.assertRaisesRegex(a.core.LaunchError, '--replace'):
                a.attach(self.args)
            self.args.replace = first['revision']
            second = a.attach(self.args)
        self.assertNotEqual(first['revision'], second['revision'])
        self.assertTrue(Path(first['request']).exists())
        self.assertEqual(json.loads(Path(second['request']).read_text())['previous']['revision'], first['revision'])
        self.assertEqual(self.receipt.read_bytes(), self.before)

    def test_failed_or_uncertain_ack_keeps_intent_and_never_publishes_ready(self):
        for variant in ('rejected', 'wrong-epoch', 'timeout'):
            def fail(path, **kwargs):
                value = self.ack(path, **kwargs)
                if path.name.startswith('active'):
                    if variant == 'timeout': raise a.core.LaunchError('uncertain acknowledgement')
                    if variant == 'rejected': value['status'] = 'rejected'
                    else: value['epoch'] = 'different'
                return value
            with patch.object(a.core, 'wait_json', side_effect=fail), self.assertRaisesRegex(a.core.LaunchError, 'not confirmed'):
                a.attach(self.args)
            pointer = json.loads((a.reporting_directory(self.worker['session']) / 'current.json').read_text())
            directory = Path(pointer['request']).parent
            self.assertFalse((directory / 'ready.json').exists())
            self.assertEqual(json.loads((directory / 'result.json').read_text())['status'], 'uncertain')
            self.args.replace = pointer['revision']
        self.assertEqual(self.receipt.read_bytes(), self.before)

    def test_role_branch_repo_session_and_replaced_pane_fail_before_intent(self):
        for changes in ({'capabilities': []}, {'role': 'coordinator'}, {'session': 'other'}, {'cwd': str(self.repo)},
                        {'instance': {**self.worker['instance'], 'inode': 'other'}}, {'live': False}):
            a.core.write_json(self.registry / (self.worker_epoch + '.json'), {**self.worker, **changes})
            with self.subTest(changes=changes), self.assertRaises(a.core.LaunchError):
                a.attach(self.args)
        a.core.write_json(self.registry / (self.worker_epoch + '.json'), self.worker)
        self.git('branch', '-m', 'feature/different', cwd=self.worker_path)
        with self.assertRaisesRegex(a.core.LaunchError, 'branch/worktree'):
            a.attach(self.args)
        self.assertFalse((a.reporting_directory(self.worker['session']) / 'current.json').exists())
        self.assertEqual(self.receipt.read_bytes(), self.before)


for name in list(fixture.CoordinatorTests.__dict__):
    if name.startswith('test_') and name not in AttachTests.__dict__: setattr(AttachTests, name, None)

if __name__ == '__main__': unittest.main()
