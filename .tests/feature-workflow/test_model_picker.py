import curses
import json
from pathlib import Path
import runpy
import subprocess
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
p = SimpleNamespace(**runpy.run_path(str(ROOT / 'agents/dot-local/bin/feature-popup')))
MODELS = [('alpha', 'same'), ('beta', 'same'), p.DEFAULT_MODEL]


class Window:
    def __init__(self): self.drawn = []; self.timeouts = []
    def getmaxyx(self): return 24, 90
    def erase(self): pass
    def refresh(self): pass
    def move(self, *args): pass
    def timeout(self, value): self.timeouts.append(value)
    def addstr(self, y, x, text, attr): self.drawn.append(text)


class ImmediateThread:
    def __init__(self, target, **kwargs): self.target = target
    def start(self): self.target()


class ModelPickerTests(unittest.TestCase):
    def picker(self, keys, models=MODELS):
        window = Window()
        keys = iter(keys)
        with patch.dict(p.model_picker.__globals__, available_models=lambda repo: models, read_key=lambda w: next(keys)), \
             patch.object(p.threading, 'Thread', ImmediateThread), patch.object(curses, 'curs_set'):
            result = p.model_picker(window, '/repo', p.DEFAULT_MODEL, p.PopupStyle())
        self.assertEqual(window.timeouts[-1], -1)
        return result, window

    def test_parser_retains_provider_identity_and_full_ids(self):
        self.assertEqual(p.parse_models('provider model context max-out thinking images\na same 1M 32K yes no\nb accounts/x/model 32K 8K no yes\n'),
                         [('a', 'same'), ('b', 'accounts/x/model')])
        for text in ('No models available', 'provider model context max-out thinking images\nbroken row'):
            with self.assertRaises(p.core.LaunchError): p.parse_models(text)

    def test_discovery_uses_origin_cwd_and_no_session(self):
        with patch.object(p.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stderr='', stdout='provider model context max-out thinking images\np m 1M 1K yes yes')) as run:
            self.assertEqual(p.available_models('/repo'), [('p', 'm')])
        self.assertEqual(run.call_args.args[0], ['pi', '--list-models', '--no-session'])
        self.assertEqual(run.call_args.kwargs['cwd'], '/repo')
        self.assertEqual(run.call_args.kwargs['stdin'], subprocess.DEVNULL)
        self.assertEqual(run.call_args.kwargs['timeout'], 25)

    def test_discovery_without_shell_setup_uses_launcher_config_and_honors_override(self):
        response = SimpleNamespace(returncode=0, stderr='', stdout='provider model context max-out thinking images\np m 1M 1K yes yes')
        for environment, expected in (({}, str(Path.home() / '.config/pi')), ({'PI_CODING_AGENT_DIR': '/custom/pi'}, '/custom/pi')):
            with patch.dict(p.os.environ, environment, clear=True), patch.object(p.subprocess, 'run', return_value=response) as run:
                p.available_models('/repo')
                self.assertEqual(run.call_args.kwargs['env']['PI_CODING_AGENT_DIR'], expected)

    def test_fuzzy_matches_provider_model_and_reordered_terms(self):
        self.assertEqual(p.fuzzy_models(MODELS, 'sm bt'), [('beta', 'same')])
        self.assertEqual(p.fuzzy_models(MODELS, 'g6as codex'), [p.DEFAULT_MODEL])
        self.assertEqual(p.fuzzy_models(MODELS, 'nonexistent'), [])

    def test_accept_cancel_navigation_and_empty_results(self):
        self.assertEqual(self.picker(['\n'])[0], p.DEFAULT_MODEL)
        self.assertEqual(self.picker([curses.KEY_UP, '\n'])[0], ('beta', 'same'))
        self.assertEqual(self.picker([('paste', 'bt sm'), '\n'])[0], ('beta', 'same'))
        self.assertEqual(self.picker(['x', '\n', '\x1b'])[0], p.DEFAULT_MODEL)
        self.assertEqual(self.picker(['\n', '\x1b'], [])[0], p.DEFAULT_MODEL)

    def test_form_keeps_draft_and_passes_chosen_model(self):
        window = Window()
        keys = iter([('paste', 'test-name'), '\t', ('paste', 'Plan\nonly'), '\x10', '\x13'])
        launched = []
        def launch(*args): launched.append(args); return {'tab': 'w1:t2', 'coordinator': {'tab': 'w1:t3'}}
        with patch.dict(p.form.__globals__, read_key=lambda w: next(keys), model_picker=lambda *args: ('beta', 'same'), execute_launch=launch), \
             patch.object(p.threading, 'Thread', ImmediateThread), patch.object(curses, 'curs_set'), \
             patch.object(curses, 'flushinp'), patch.object(p.core, 'herdr') as herdr:
            p.form(window, 'w1:p1', {'repo': '/repo', 'base': 'main'})
        self.assertEqual(launched[0][2:], ('test-name', 'Plan\nonly', ('beta', 'same'), None))
        herdr.assert_not_called()  # Focus is owned by the verified launcher.
        self.assertIn('beta/same', window.drawn)

    def test_launch_passes_model_as_separate_argv_without_changing_brief(self):
        admitted = {'repo': '/repo', 'base': 'main', 'common': '/git', 'require_sibling': False}
        def run(command, **kwargs):
            self.assertEqual(command[-4:], ['--provider', 'beta', '--model', 'accounts/x/model'])
            self.assertEqual(Path(command[command.index('--brief-file') + 1]).read_text(), 'Plan\nonly')
            return SimpleNamespace(returncode=0, stdout=json.dumps({'ok': True}), stderr='')
        with tempfile.TemporaryDirectory() as state, patch.dict(p.os.environ, XDG_STATE_HOME=state), \
             patch.object(p.core, 'preflight', return_value=admitted), patch.object(p.subprocess, 'run', side_effect=run):
            self.assertTrue(p.execute_launch('w1:p1', admitted, 'test', 'Plan\nonly', ('beta', 'accounts/x/model'))['ok'])

    def test_existing_coordinator_picker_and_cancellation_keep_explicit_identity(self):
        existing = {'epoch': 'selected-epoch', 'session': 'session', 'tab': 'w1:t7', 'name': 'Control', 'busy': True}
        for keys, expected in (([curses.KEY_DOWN, '\n'], existing), ([curses.KEY_DOWN, '\x1b'], None)):
            window = Window()
            key_iter = iter(keys)
            with patch.object(p.core, 'coordinators', return_value=[existing]), \
                 patch.dict(p.coordinator_picker.__globals__, read_key=lambda w: next(key_iter)), patch.object(curses, 'curs_set'):
                self.assertEqual(p.coordinator_picker(window, {'common': '/git'}, None, p.PopupStyle()), expected)
            self.assertTrue(any('Control' in text and 'w1:t7' in text for text in window.drawn))
        admitted = {'repo': '/repo', 'base': 'main', 'common': '/git', 'require_sibling': False}
        with tempfile.TemporaryDirectory() as state, patch.dict(p.os.environ, XDG_STATE_HOME=state), \
             patch.object(p.core, 'preflight', return_value=admitted), \
             patch.object(p.core, 'coordinator_identity', return_value=existing), \
             patch.object(p.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='{"ok":true}', stderr='')) as run:
            p.execute_launch('w1:p1', admitted, 'test', 'Plan', coordinator=existing)
            command = run.call_args.args[0]
            self.assertEqual(command[command.index('--coordinator') + 1], 'selected-epoch')

    def test_discovery_failure_preserves_current_model(self):
        window = Window()
        def fail(repo): raise TimeoutError()
        with patch.dict(p.model_picker.__globals__, available_models=fail, read_key=lambda w: '\x1b'), \
             patch.object(p.threading, 'Thread', ImmediateThread), patch.object(curses, 'curs_set'):
            result = p.model_picker(window, '/repo', p.DEFAULT_MODEL, p.PopupStyle())
        self.assertEqual(result, p.DEFAULT_MODEL)
        self.assertTrue(any('Cannot load models' in text for text in window.drawn))
