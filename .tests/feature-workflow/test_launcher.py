import importlib.machinery
import importlib.util
import json
from pathlib import Path
import tempfile
import sys
sys.dont_write_bytecode = True
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
loader = importlib.machinery.SourceFileLoader("feature_start", str(ROOT / "agents/dot-local/bin/feature-start"))
spec = importlib.util.spec_from_loader(loader.name, loader)
m = importlib.util.module_from_spec(spec)
loader.exec_module(m)


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.expected = dict(nonce="n", cwd="/tmp/worker", branch="feature/foo", head="abc", session="new",
                             parent_session="old", provider="openai-codex", model="gpt-6-astra", pane="w1:p2", tab="w1:t2", workspace="w1")
        self.observed = {**self.expected, "session_file": "/tmp/new.jsonl"}
        self.agent = dict(agent="pi", pane_id="w1:p2", foreground_cwd="/tmp/worker", agent_status="idle",
                          agent_session={"value": "/tmp/new.jsonl"})

    def test_matching_identity(self):
        m.validate_identity(self.expected, self.observed, self.agent)

    def test_every_identity_dimension_is_checked(self):
        for key in ("nonce", "cwd", "branch", "head", "session", "provider", "model", "pane", "tab", "workspace"):
            with self.subTest(key=key), self.assertRaises(m.LaunchError):
                m.validate_identity(self.expected, {**self.observed, key: "wrong"}, self.agent)

    def test_worker_error_reported_directly(self):
        with self.assertRaisesRegex(m.LaunchError, "not fresh"):
            m.validate_identity(self.expected, {"error": "not fresh"}, self.agent)

    def test_parent_session_refused(self):
        with self.assertRaises(m.LaunchError):
            m.validate_identity({**self.expected, "parent_session": "new"}, self.observed, self.agent)

    def test_herdr_identity_and_busy_states_refused(self):
        for values in ({"agent_status": "blocked"}, {"agent_status": "working"}, {"agent_status": "unknown"},
                       {"agent_session": {"value": "/tmp/other.jsonl"}}, {"foreground_cwd": "/tmp/main"},
                       {"agent": "codex"}, {"pane_id": "w1:p1"}):
            with self.subTest(values=values), self.assertRaises(m.LaunchError):
                m.validate_identity(self.expected, self.observed, {**self.agent, **values})

    def test_brief_preserved_verbatim(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "brief"
            brief = 'Plan foo\n\n  - preserve "quotes" and $(not-a-command)\n'
            path.write_text(brief)
            self.assertEqual(m.read_text(str(path)), brief)
            path.write_bytes(b"Plan foo\r\n\r\nPreserve CRLF\r\n")
            self.assertEqual(m.read_text(str(path)), "Plan foo\r\n\r\nPreserve CRLF\r\n")
            path.write_text("  \n")
            with self.assertRaises(m.LaunchError):
                m.read_text(str(path))
            path.write_text("x" * (128 * 1024 + 1))
            with self.assertRaises(m.LaunchError):
                m.read_text(str(path))

    def test_atomic_receipt_and_timeout(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "receipt.json"
            with self.assertRaises(m.LaunchError):
                m.wait_json(path, timeout=0)
            m.write_json(path, {"phase": "verified"})
            self.assertEqual(m.wait_json(path), {"phase": "verified"})
            self.assertFalse(path.with_suffix(".tmp").exists())

    def test_not_in_herdr_does_not_invoke_tools(self):
        with patch.dict(m.os.environ, {"HERDR_ENV": "0"}), patch.object(m, "run") as run:
            with self.assertRaises(m.LaunchError):
                m.launch(None, None, None)
            run.assert_not_called()

    def test_bad_names_do_not_invoke_tools(self):
        from types import SimpleNamespace
        for name in ("../foo", "Foo", "--from", "a;touch", "a/b", "a--b", "a" * 49):
            with self.subTest(name=name), patch.dict(m.os.environ, {"HERDR_ENV": "1"}), patch.object(m, "run") as run:
                with self.assertRaises(m.LaunchError):
                    m.launch(SimpleNamespace(name=name), None, None)
                run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
