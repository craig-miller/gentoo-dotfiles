import curses
import json
from pathlib import Path
import runpy
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import test_coordinator as fixture
from test_model_picker import Window, ImmediateThread

ROOT = Path(__file__).resolve().parents[2]
p = SimpleNamespace(**runpy.run_path(str(ROOT / 'agents/dot-local/bin/feature-popup')))


class OriginTests(fixture.CoordinatorTests):
    # Reuse only the disposable Git/socket/session fixture, not inherited test methods.
    def origin(self, **changes):
        return {'pane_id': self.item['pane'], 'agent': 'pi', 'agent_session': {'value': self.item['session_file']}, **changes}

    def capture(self, origin=None):
        with patch.dict(p.core.coordinator_identity.__globals__, herdr=lambda *args: {'agent': self.agent}):
            return p.origin_coordinator(origin or self.origin(), self.item['instance'], self.item['common'])

    def test_exact_invoker_not_another_same_repo_session_or_current_focus(self):
        chosen = self.capture()
        self.assertEqual(chosen['epoch'], self.epoch)
        self.assertIsNone(self.capture(self.origin(agent=None)))
        different = self.origin(pane_id='w:p9')
        self.assertTrue(self.capture(different)['unregistered'])
        # Captured default remains unchanged after focus changes; form never re-queries it.
        window, calls = Window(), []
        keys = iter([('paste', 'test'), '\t', ('paste', 'Plan only'), '\x13'])
        with patch.dict(p.form.__globals__, read_key=lambda w: next(keys), execute_launch=lambda *args: calls.append(args) or {}), \
             patch.object(p.core, 'herdr', side_effect=AssertionError('must not query focus')), \
             patch.object(p.threading, 'Thread', ImmediateThread), patch.object(curses, 'curs_set'), patch.object(curses, 'flushinp'):
            p.form(window, 'w:p1', {'repo': '/repo', 'base': 'main', 'default_coordinator': chosen})
        self.assertEqual(calls[0][-1], chosen)
        self.assertTrue(any('Existing:' in text for text in window.drawn))

    def test_other_socket_with_colliding_ids_or_old_schema_is_not_selected(self):
        for instance in ({**self.item['instance'], 'inode': 'other-server'}, None):
            item = {**self.item, 'instance': instance}
            self.registry.joinpath(self.epoch + '.json').write_text(json.dumps(item))
            self.assertTrue(self.capture()['unregistered'])
            with patch.object(p.core, 'herdr', return_value={'agent': self.agent}):
                self.assertEqual(p.core.coordinators(self.item['common']), [])

    def test_worker_defaults_new_and_unregistered_pi_requires_explicit_choice(self):
        self.registry.joinpath(self.epoch + '.json').write_text(json.dumps({**self.item, 'role': 'worker'}))
        self.assertIsNone(self.capture())
        self.registry.joinpath(self.epoch + '.json').unlink()
        unknown = self.capture()
        self.assertTrue(unknown['unregistered'])
        window = Window()
        keys = iter([('paste', 'test'), '\t', ('paste', 'Plan'), '\x13', '\x1b'])
        with patch.dict(p.form.__globals__, read_key=lambda w: next(keys), execute_launch=lambda *args: self.fail('must not launch')), patch.object(curses, 'curs_set'):
            p.form(window, 'w:p1', {'repo': '/repo', 'base': 'main', 'default_coordinator': unknown})
        self.assertTrue(any('/reload' in text for text in window.drawn))

    def test_overrides_and_picker_cancel_are_preserved(self):
        chosen = self.capture()
        for override in (None, {**chosen, 'epoch': 'explicit-other'}):
            window, calls = Window(), []
            keys = iter([('paste', 'test'), '\t', ('paste', 'Plan'), '\x0f', '\x13'])
            with patch.dict(p.form.__globals__, read_key=lambda w: next(keys), coordinator_picker=lambda *args: override,
                            execute_launch=lambda *args: calls.append(args) or {}), \
                 patch.object(p.threading, 'Thread', ImmediateThread), patch.object(curses, 'curs_set'), patch.object(curses, 'flushinp'):
                p.form(window, 'w:p1', {'repo': '/repo', 'base': 'main', 'default_coordinator': chosen})
            self.assertEqual(calls[0][-1], override)
        with patch.object(p.core, 'coordinators', return_value=[chosen]), \
             patch.dict(p.coordinator_picker.__globals__, read_key=lambda w: '\x1b'), patch.object(curses, 'curs_set'):
            self.assertEqual(p.coordinator_picker(Window(), {'common': self.item['common']}, chosen, p.PopupStyle()), chosen)

    def test_stale_replaced_or_changed_instance_at_submit_blocks_before_resources(self):
        chosen = self.capture()
        admitted = {'repo': str(self.repo), 'base': 'main', 'common': self.item['common'], 'origin_instance': self.item['instance']}
        for change in ({'live': False}, {'session': 'changed'}, {'instance': {**self.item['instance'], 'inode': 'replaced'}}):
            self.registry.joinpath(self.epoch + '.json').write_text(json.dumps({**self.item, **change}))
            with patch.dict(p.core.coordinator_identity.__globals__, herdr=lambda *args: {'agent': self.agent}), patch.object(p.subprocess, 'run') as run:
                with self.assertRaises(p.core.LaunchError):
                    p.execute_launch('w:p1', admitted, 'test', 'Plan', coordinator=chosen)
                run.assert_not_called()
        with patch.object(p.core, 'herdr_instance', return_value={**self.item['instance'], 'inode': 'new'}), patch.object(p.subprocess, 'run') as run:
            with self.assertRaises(p.core.LaunchError):
                p.execute_launch('w:p1', admitted, 'test', 'Plan', coordinator=None)
            run.assert_not_called()

    def test_socket_rebind_at_same_path_changes_identity(self):
        import socket
        before = p.core.herdr_instance()
        self.socket.close()
        Path(before['socket']).unlink()
        self.socket = socket.socket(socket.AF_UNIX)
        self.socket.bind(before['socket'])
        self.assertNotEqual(before, p.core.herdr_instance())


# Don't duplicate the parent's tests when unittest discovers this subclass.
for name in list(fixture.CoordinatorTests.__dict__):
    if name.startswith('test_') and name not in OriginTests.__dict__:
        setattr(OriginTests, name, None)

if __name__ == '__main__': unittest.main()
