import curses
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
popup = SimpleNamespace(**runpy.run_path(str(ROOT / 'agents/dot-local/bin/feature-popup')))
core = popup.core


class PreflightTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.repo = self.root / 'repo'
        self.git('init', '-q', '-b', 'main', str(self.repo), cwd=self.root)
        self.git('-c', 'user.name=Test', '-c', 'user.email=test@invalid', '-c', 'core.hooksPath=/dev/null',
                 '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'Fixture')
        original = core.run
        self.calls = []
        def command(args, **kwargs):
            self.calls.append(args)
            if args[:2] == ['stax', 'validate']:
                return ''
            return original(args, **kwargs)
        # Functions loaded via runpy retain their original global dictionary.
        self.run_patch = patch.dict(core.preflight.__globals__, run=command)
        self.run_patch.start()
        self.env_patch = patch.dict(os.environ, {'XDG_CONFIG_HOME': str(self.root / 'config')})
        self.env_patch.start()

    def tearDown(self):
        self.run_patch.stop(); self.env_patch.stop(); self.temp.cleanup()

    def git(self, *args, cwd=None):
        return subprocess.check_output(['git', *args], cwd=cwd or self.repo, stderr=subprocess.STDOUT, text=True).strip()

    def test_dirty_and_nested_working_tree_allowed_without_mutations(self):
        (self.repo / 'unrelated').write_text('preserve me')
        nested = self.repo / 'nested'; nested.mkdir()
        before = self.git('status', '--porcelain')
        admitted = core.preflight(nested)
        self.assertEqual(admitted['repo'], str(self.repo))
        self.assertEqual(self.git('status', '--porcelain'), before)
        self.assertNotIn(['stax', 'validate'], self.calls)  # No interactive Stax setup in preflight.
        self.assertEqual(len(self.git('worktree', 'list').splitlines()), 1)

    def test_initialized_stax_validation_is_read_only(self):
        blob = subprocess.check_output(['git', 'hash-object', '-w', '--stdin'], cwd=self.repo, input='main', text=True).strip()
        self.git('update-ref', 'refs/stax/trunk', blob)
        core.preflight(self.repo)
        self.assertIn(['stax', 'validate'], self.calls)

    def test_non_repo_bare_and_missing_main_refused(self):
        with self.assertRaisesRegex(core.LaunchError, 'Not a worktree-compatible'):
            core.preflight(self.root)
        bare = self.root / 'bare'; self.git('init', '-q', '--bare', str(bare))
        with self.assertRaises(core.LaunchError): core.preflight(bare)
        self.git('branch', '-m', 'other')
        with self.assertRaisesRegex(core.LaunchError, 'main.*missing'):
            core.preflight(self.repo)

    def test_operations_and_locks_refused(self):
        for marker in ('MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'index.lock', 'rebase-merge'):
            path = self.repo / '.git' / marker; path.touch()
            try:
                with self.subTest(marker=marker), self.assertRaisesRegex(core.LaunchError, 'operation in progress'):
                    core.preflight(self.repo)
            finally: path.unlink()

    def test_stax_errors_refused_and_sibling_policy_detected(self):
        (self.repo / 'stax.toml').write_text('[worktree]\nroot_dir=".."\n')
        self.assertTrue(core.preflight(self.repo)['require_sibling'])
        with patch.dict(core.preflight.__globals__, run=lambda *a, **kw: (_ for _ in ()).throw(core.LaunchError('invalid'))):
            with self.assertRaises(core.LaunchError): core.preflight(self.repo)


class ThemeTests(unittest.TestCase):
    def test_theme_uses_palette_slots_and_default_background_without_rgb_overrides(self):
        with patch.object(curses, 'has_colors', return_value=True), patch.object(curses, 'start_color'), \
             patch.object(curses, 'use_default_colors') as defaults, patch.object(curses, 'COLORS', 256, create=True), \
             patch.object(curses, 'init_pair') as pairs, patch.object(curses, 'init_color') as rgb, \
             patch.object(curses, 'color_pair', side_effect=lambda n: n << 8):
            style = popup.PopupStyle.terminal()
        self.assertEqual([call.args for call in pairs.call_args_list], [(1, 5, -1), (2, 1, -1), (3, 7, -1), (4, 8, -1)])
        defaults.assert_called_once()
        rgb.assert_not_called()
        self.assertEqual((style.accent, style.error, style.muted, style.border), (256, 512, 768, 1024))

    def test_monochrome_and_eight_color_terminals(self):
        with patch.object(curses, 'has_colors', return_value=False), patch.object(curses, 'init_pair') as pairs:
            style = popup.PopupStyle.terminal()
            self.assertEqual(style.accent, curses.A_BOLD)
            pairs.assert_not_called()
        with patch.object(curses, 'has_colors', return_value=True), patch.object(curses, 'start_color'), \
             patch.object(curses, 'use_default_colors'), patch.object(curses, 'COLORS', 8, create=True), \
             patch.object(curses, 'init_pair') as pairs, patch.object(curses, 'color_pair', return_value=0):
            popup.PopupStyle.terminal()
            self.assertEqual(pairs.call_args.args, (4, 7, -1))

    def test_focus_uses_accent_but_text_keeps_default_foreground(self):
        class Window:
            def __init__(self): self.drawn = []
            def getmaxyx(self): return 24, 90
            def erase(self): pass
            def refresh(self): pass
            def move(self, *args): pass
            def addstr(self, y, x, text, attr): self.drawn.append((text, attr))
        window = Window()
        style = popup.PopupStyle()
        style.accent, style.muted, style.border, style.error = 256, 768, 1024, 512
        keys = iter(['\t', '\x1b'])
        with patch.dict(popup.form.__globals__, read_key=lambda w: next(keys)), patch.object(curses, 'curs_set'):
            popup.form(window, 'w1:p1', {'repo': '/repo', 'base': 'main'}, style)
        self.assertIn(('Name', 256 | curses.A_BOLD), window.drawn)
        self.assertIn(('Name', 768), window.drawn)
        self.assertIn(('Brief', 256 | curses.A_BOLD), window.drawn)
        self.assertIn(('Repository', 768), window.drawn)
        self.assertIn(('/repo', 0), window.drawn)


class PopupTests(unittest.TestCase):
    def test_origin_is_frozen_active_context_not_focused_or_inherited_pane(self):
        env = {'HERDR_ENV': '1', 'HERDR_ACTIVE_PANE_ID': 'w1:p3', 'HERDR_ACTIVE_PANE_CWD': '/tmp', 'HERDR_PANE_ID': 'w2:p1'}
        self.assertEqual(popup.origin_context(env), ('w1:p3', '/tmp'))
        del env['HERDR_ACTIVE_PANE_CWD']
        with self.assertRaises(core.LaunchError): popup.origin_context(env)

    def test_editor_newlines_arrows_and_paste_are_data(self):
        editor = popup.Editor(multiline=True)
        editor.insert('Plan "foo"\n$(not-a-command)')
        editor.key(curses.KEY_HOME); editor.key(curses.KEY_BACKSPACE)
        self.assertEqual(editor.text, 'Plan "foo"$(not-a-command)')
        editor.key('\n')
        self.assertEqual(editor.text, 'Plan "foo"\n$(not-a-command)')
        editor.key(curses.KEY_UP)
        self.assertEqual(editor.pos, 0)
        editor.key(curses.KEY_DOWN)
        self.assertEqual(editor.pos, 11)
        self.assertEqual(popup.Editor('abc').layout(3), (['abc', ''], (1, 0)))
        self.assertEqual(popup.clip('漢字abc', 5), '漢字a')

    def test_error_popup_contains_only_error_and_enter_dismisses(self):
        class Window:
            def __init__(self): self.drawn = []; self.reads = 0
            def getmaxyx(self): return 20, 70
            def erase(self): pass
            def refresh(self): pass
            def addstr(self, y, x, text, attr): self.drawn.append(text)
            def get_wch(self): self.reads += 1; return '\n'
        window = Window()
        with patch.object(curses, 'curs_set'):
            popup.error_popup(window, 'Not a Git repository')
        self.assertEqual(window.drawn, ['Not a Git repository'])
        self.assertEqual(window.reads, 1)

    def test_bracketed_paste_does_not_submit_or_cancel(self):
        class Window:
            def __init__(self): self.keys = iter('\x1b[200~a\n\x13b\x1b[201~')
            def timeout(self, value): pass
            def get_wch(self): return next(self.keys)
        self.assertEqual(popup.read_key(Window()), ('paste', 'a\n\x13b'))

    def test_failed_launch_preserves_form_and_blocks_duplicate_submission(self):
        class Window:
            def __init__(self): self.drawn = []
            def getmaxyx(self): return 24, 90
            def erase(self): pass
            def refresh(self): pass
            def move(self, *args): pass
            def addstr(self, y, x, text, attr): self.drawn.append(text)
        window = Window()
        keys = iter([('paste', 'foo'), '\t', ('paste', 'Plan only'), '\x13', '\x13', '\x1b'])
        calls = []
        def fail(*args):
            calls.append(args)
            raise core.LaunchError('Launch failed. Receipt: /private/receipt.json')
        with patch.dict(popup.form.__globals__, read_key=lambda w: next(keys), execute_launch=fail):
            with patch.object(curses, 'curs_set'), patch.object(curses, 'flushinp'):
                popup.form(window, 'w1:p1', {'repo': '/repo', 'base': 'main'})
        self.assertEqual(len(calls), 1)
        self.assertIn('foo', window.drawn)
        self.assertIn('Plan only', window.drawn)
        self.assertTrue(any('receipt.json' in text for text in window.drawn))
        self.assertTrue(any('inspect receipt before retrying' in text for text in window.drawn))

    def test_revalidation_failure_never_launches(self):
        with patch.object(core, 'preflight', side_effect=core.LaunchError('rebase started')):
            with patch.object(subprocess, 'run') as run:
                with self.assertRaisesRegex(core.LaunchError, 'rebase started'):
                    popup.execute_launch('w1:p1', {'repo': '/repo', 'base': 'main'}, 'foo', 'Plan')
                run.assert_not_called()


if __name__ == '__main__': unittest.main()
