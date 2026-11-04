# Feature workflow checks

```sh
python3 -B -m unittest discover -s .tests/feature-workflow -p 'test_*.py'
bun test ./.tests/feature-workflow/feature.test.ts ./.tests/feature-workflow/coordination.test.ts ./.tests/feature-workflow/attachment.test.ts
python3 -B .tests/feature-workflow/herdr_popup_smoke.py --ui-only
python3 -B .tests/feature-workflow/herdr_coordinator_smoke.py
python3 -B .tests/feature-workflow/herdr_coordinator_smoke.py --attachment
```

Native checks use named Herdr PTYs and disposable synthetic repositories, never desktop windows or existing panes. The coordinator smoke uses an isolated Pi configuration, the installed Herdr integration read-only, and `offline-provider.ts`: deterministic text, no network or tool execution. It checks actual registration, coordinator/worker startup, API delivery, report acknowledgement and focus, not real-model task performance. `--attachment` additionally checks legacy reporting attachment, committed/dirty progress, busy queues, same-session reload/explicit renewal, rebind and rejection of late old-owner reports. Test-only file controls invoke Pi APIs for deterministic turns/reload in disposable sessions, never terminal-pasted prompts.

The popup UI-only check intentionally removes `PI_CODING_AGENT_DIR` to cover popup children bypassing Fish configuration. Omitting `--ui-only` makes real provider requests and requires separate authorization. Never load the test provider/trust hook in live agents. Native scripts dispose only resources they create; failure logs are under `/tmp/feature-*-*.log`.
