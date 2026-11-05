import json
import os
from pathlib import Path
import runpy
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
f = runpy.run_path(str(ROOT / 'agents/dot-local/bin/feature-preflight'))


class FreshnessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name); self.repo = self.root / 'repo'; self.repo.mkdir()
        self.git('init', '-q', '-b', 'main')
        self.commit('base'); self.base = self.git('rev-parse', 'HEAD')
        for branch, parent in [('feature/a', 'main'), ('feature/b', 'feature/a'), ('feature/c', 'feature/b')]:
            revision = self.git('rev-parse', 'HEAD')
            self.git('checkout', '-qb', branch); self.commit(branch); self.track(branch, parent, revision)
        self.git('checkout', '-q', 'feature/b')
        self.git('remote', 'add', 'upstream', 'https://invalid.example/never-contacted')
        self.git('config', 'branch.main.remote', 'upstream'); self.git('config', 'branch.main.merge', 'refs/heads/main')
        self.git('update-ref', 'refs/remotes/upstream/main', self.base)
        self.sync = self.root / 'sync.json'; self.accepted = self.root / 'accepted.json'
        self.proof()

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args, data=None):
        return subprocess.check_output(['git', *args], cwd=self.repo, input=data, text=True, stderr=subprocess.DEVNULL).strip()

    def commit(self, message):
        self.git('-c', 'user.name=Fixture', '-c', 'user.email=test@invalid', '-c', 'core.hooksPath=/dev/null',
                 '-c', 'commit.gpgsign=false', 'commit', '-qm', message, '--allow-empty')

    def track(self, branch, parent, revision):
        blob = self.git('hash-object', '-w', '--stdin', data=json.dumps({'parentBranchName': parent, 'parentBranchRevision': revision}))
        self.git('update-ref', 'refs/branch-metadata/' + branch, blob)

    def proof(self):
        self.sync.write_text(json.dumps({'outcome': 'fetch-and-ff-verified', 'common': str(self.repo / '.git'), 'remote': 'upstream',
            'url': 'https://invalid.example/never-contacted', 'merge_ref': 'refs/heads/main',
            'upstream': 'refs/remotes/upstream/main', 'head': self.git('rev-parse', 'refs/remotes/upstream/main'),
            'fetched_at': datetime.now(timezone.utc).isoformat(), 'authorization': 'Synthetic test-only evidence; no remote was contacted'}))

    def check(self, **kwargs):
        return f['evaluate'](str(self.repo), **kwargs)

    def test_unchanged_checkpoint_full_stack_and_no_mutation(self):
        before = self.git('show-ref')
        result = self.check()
        self.assertEqual(result['gate'], 'local-only')
        self.assertEqual([b['branch'] for b in result['checkpoint']['stack']], ['feature/a', 'feature/b', 'feature/c'])
        self.assertEqual(result['remote_freshness'], 'unverified-no-network')
        self.assertEqual(before, self.git('show-ref')); self.assertFalse(result['mutation_authorized'])

    def test_advanced_already_included_base_is_not_stale(self):
        self.git('update-ref', 'refs/heads/main', self.git('rev-parse', 'feature/a'))
        self.assertEqual(self.check()['stale_branches'], [])

    def test_genuinely_stale_stack_with_dirty_progress_is_preserved(self):
        self.git('checkout', '-q', 'main'); self.commit('new upstream history'); self.git('checkout', '-q', 'feature/b')
        (self.repo / 'progress').write_text('do not stash or discard')
        before = self.git('show-ref')
        result = self.check()
        self.assertEqual(result['gate'], 'blocked'); self.assertEqual(len(result['stale_branches']), 3)
        self.assertTrue(result['dirty_progress']); self.assertEqual(before, self.git('show-ref'))
        self.assertEqual((self.repo / 'progress').read_text(), 'do not stash or discard')

    def test_intermediate_parent_and_descendant_levels_are_checked(self):
        self.git('checkout', '-q', 'feature/a'); self.commit('parent advanced')
        result = self.check()
        self.assertIn('feature/b', result['stale_branches'])
        self.git('checkout', '-q', 'feature/b')
        self.git('update-ref', 'refs/heads/feature/c', self.base)
        self.assertIn('feature/c', self.check()['stale_branches'])

    def test_non_main_base_and_wrong_identity(self):
        self.git('branch', 'develop', self.base); self.track('feature/a', 'develop', self.base)
        self.assertEqual(self.check(base='develop')['gate'], 'local-only')
        with self.assertRaises(f['PreflightError']): self.check(base='main')
        with self.assertRaises(f['PreflightError']): self.check(base='develop', branch='feature/c')

    def test_live_and_review_require_sync_evidence_and_matching_accepted_checkpoint(self):
        self.assertEqual(self.check(stage='live')['gate'], 'blocked')
        live = self.check(stage='live', sync_evidence=self.sync)
        self.assertEqual(live['gate'], 'ready'); self.assertFalse(live['approval'])
        self.accepted.write_text(json.dumps(live))
        self.assertEqual(self.check(stage='review', sync_evidence=self.sync, accepted=self.accepted)['gate'], 'ready')
        self.git('update-ref', 'refs/heads/main', self.git('rev-parse', 'feature/a'))
        changed = self.check(stage='review', sync_evidence=self.sync, accepted=self.accepted)
        self.assertEqual(changed['stale_branches'], [])
        self.assertTrue(any('since acceptance' in b for b in changed['blockers']))

    def test_dirty_content_change_after_acceptance_requires_revalidation(self):
        note = self.repo / ' note '; note.write_text('first')
        live = self.check(stage='live', sync_evidence=self.sync)
        self.assertTrue(live['dirty_progress']); self.assertEqual(live['gate'], 'ready')
        self.accepted.write_text(json.dumps(live)); note.write_text('second')
        self.assertEqual(self.check(stage='review', sync_evidence=self.sync, accepted=self.accepted)['gate'], 'blocked')

    def test_upstream_divergence_behind_and_stale_evidence_fail_closed(self):
        proof = json.loads(self.sync.read_text()); proof['fetched_at'] = '2000-01-01T00:00:00+00:00'; self.sync.write_text(json.dumps(proof))
        self.assertEqual(self.check(stage='live', sync_evidence=self.sync)['gate'], 'blocked')
        self.git('update-ref', 'refs/remotes/upstream/main', self.git('rev-parse', 'feature/c'))
        self.assertEqual(self.check()['checkpoint']['upstream']['relation'], 'behind')
        self.git('checkout', '-q', 'main'); self.commit('diverged local'); self.git('checkout', '-q', 'feature/b')
        self.assertEqual(self.check()['checkpoint']['upstream']['relation'], 'diverged')

    def test_drift_between_reads_and_in_progress_operations_block(self):
        real = f['checkpoint']; count = 0
        def changing(*args):
            nonlocal count
            count += 1
            if count == 2: self.git('update-ref', 'refs/heads/main', self.git('rev-parse', 'feature/a'))
            return real(*args)
        with patch.dict(f['evaluate'].__globals__, checkpoint=changing):
            self.assertTrue(any('drifted' in b for b in self.check()['blockers']))
        (self.repo / '.git' / 'MERGE_HEAD').write_text(self.base)
        self.assertTrue(any('operation/lock' in b for b in self.check()['blockers']))

    def validation(self, names, stderr=None, code=1, extra=''):
        stdout = ('Stack validation\n\nPASS No orphaned metadata\nPASS All parents exist\nPASS No cycles detected\nPASS All metadata is valid JSON\n'
                  f'WARN {len(names)} branch(es) need restack:\n' + ''.join('  ' + n + '\n' for n in names) + '\n1 issue(s) found. Run `stax fix` to repair.' + extra)
        return subprocess.CompletedProcess(['stax', 'validate'], code, stdout, stderr if stderr is not None else 'A new version of stax is available: old → new — run `st update` to upgrade (uses: manual upgrade required)')

    def test_unrelated_stale_warning_is_visible_but_does_not_block_new_base_launch(self):
        original = f['command']; response = self.validation(['feature/a'])
        def cmd(args, cwd): return response if args[0] == 'stax' else original(args, cwd)
        with patch.dict(f['launch_validation'].__globals__, command=cmd):
            result = f['launch_validation'](self.repo, 'main')
            self.assertEqual(result['status'], 'unrelated-stack-warning')
            for text in ('exit 1', 'stdout:', 'stderr:', 'feature/a', 'Gentoo: ebuild/Portage'):
                self.assertIn(text, result['message'])
            self.assertNotIn('run `st update`', result['message'])
            with self.assertRaises(f['PreflightError']): f['launch_validation'](self.repo, 'feature/b')

    def test_coordinator_started_command_retains_both_streams_and_status(self):
        core = runpy.run_path(str(ROOT / 'agents/dot-local/bin/feature-start'))
        with patch.object(subprocess, 'run', return_value=self.validation(['feature/a'])):
            with self.assertRaises(core['LaunchError']) as caught:
                core['run'](['stax', 'validate'], cwd=self.repo)
        for text in ('exit 1', 'stdout:', 'stderr:', 'feature/a', 'ebuild/Portage'):
            self.assertIn(text, str(caught.exception))

    def test_unknown_nonzero_validation_and_corrupt_metadata_are_not_ignored(self):
        original = f['command']
        for response in (self.validation(['feature/a'], stderr='fatal validation problem'), self.validation(['feature/a'], code=2), self.validation(['feature/a'], extra='\nFAIL unknown issue'), self.validation(['unknown'])):
            with patch.dict(f['launch_validation'].__globals__, command=lambda args, cwd: response if args[0] == 'stax' else original(args, cwd)):
                with self.assertRaises(f['PreflightError']): f['launch_validation'](self.repo, 'main')
        self.track('feature/a', 'feature/c', self.base)
        with self.assertRaises(f['PreflightError']): self.check()


if __name__ == '__main__': unittest.main()
