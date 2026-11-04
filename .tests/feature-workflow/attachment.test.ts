import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { atomicJSON, herdrInstance, readJSON, stateRoot } from "../../pi/dot-config/pi/extensions/feature-workflow/protocol.ts";
import { pollAttachments, readyAttachment, reportingDirectory, reportAttached, validBoundMessage } from "../../pi/dot-config/pi/extensions/feature-workflow/attachment.ts";

async function fixture(run: (f: any) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'attach-test-')), previous = { ...process.env };
  const socket = Bun.listen({ unix: join(directory, 'socket'), socket: { data() {} } });
  Object.assign(process.env, { XDG_STATE_HOME: directory, HERDR_ENV: '1', HERDR_SOCKET_PATH: join(directory, 'socket') });
  const common = join(directory, 'git'); mkdirSync(common);
  const source = join(directory, 'source'), worktree = join(directory, 'worker'); mkdirSync(source); mkdirSync(worktree);
  const root = stateRoot(); mkdirSync(join(root, 'sessions'), { recursive: true });
  const base = { capabilities: ['reporting-attach-v1'], instance: herdrInstance(), common, workspace: 'w', live: true, updated: Date.now() };
  const worker: any = { ...base, role: 'worker', epoch: randomUUID(), session: 'worker-session', session_file: '/worker.jsonl', cwd: worktree, pane: 'w:p2', tab: 'w:t2' };
  const coordinator: any = { ...base, role: 'coordinator', epoch: randomUUID(), session: 'coord-session', session_file: '/coord.jsonl', cwd: source, pane: 'w:p1', tab: 'w:t1' };
  const publish = (item: any) => {
    atomicJSON(join(root, 'sessions', item.epoch + '.json'), { ...item, updated: Date.now() });
    mkdirSync(join(root, 'inbox', item.epoch), { recursive: true });
  };
  publish(worker); publish(coordinator);
  const receipt = join(directory, 'legacy.json');
  atomicJSON(receipt, { nonce: 'feature', session: worker.session, cwd: worktree, repo: source, branch: 'feature/test', head: 'initial-head', brief: 'Plan only\r\nverbatim', worker: { session_file: worker.session_file } });
  const original = readFileSync(receipt, 'utf8');
  let busy = false, replaced = false, branch = 'feature/test';
  const messages: any[] = [], notices: any[] = [];
  const context = (item: any): any => ({ cwd: item.cwd, isIdle: () => !busy, hasPendingMessages: () => false,
    sessionManager: { getSessionId: () => item.session, getSessionFile: () => item.session_file,
      getBranch: () => [{ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Ready for review' }] } }] },
    ui: { setStatus: (...args: any[]) => notices.push(args), notify: (...args: any[]) => notices.push(args) } });
  const pi: any = { sendMessage: (m: any) => messages.push(m), sendUserMessage: (m: any) => messages.push(m),
    exec: async (cmd: string, args: string[]) => {
      if (cmd === 'git') return { code: 0, stdout: args[0] === 'branch' ? branch : args.includes('--show-toplevel') ? worktree : common };
      const item = args[2] === worker.pane ? worker : coordinator;
      return { code: 0, stdout: JSON.stringify({ result: { agent: { agent: 'pi', pane_id: item.pane, tab_id: item.tab, workspace_id: item.workspace,
        foreground_cwd: item.cwd, agent_session: { value: replaced ? '/replacement.jsonl' : item.session_file } } } }) };
    } };
  const create = () => {
    const revision = randomUUID(), dir = join(reportingDirectory(worker.session), 'revisions', revision), path = join(dir, 'request.json');
    mkdirSync(dir, { recursive: true });
    const request = { revision, feature: 'feature', worker: { ...worker }, coordinator: { ...coordinator }, receipt,
      receipt_sha256: createHash('sha256').update(readFileSync(receipt)).digest('hex'), cwd: worktree, branch: 'feature/test', common };
    atomicJSON(path, request);
    atomicJSON(join(reportingDirectory(worker.session), 'current.json'), { revision, feature: 'feature', request: path });
    for (const role of ['worker', 'coordinator'] as const) atomicJSON(join(root, 'inbox', request[role].epoch, revision + '.binding.json'),
      { revision, request: path, target: request[role], role });
    return { path, request, dir };
  };
  const poll = async (item: any) => pollAttachments(pi, context(item), item, () => true);
  const finish = async (tx: any) => {
    await poll(worker); await poll(coordinator);
    atomicJSON(join(tx.dir, 'commit.json'), { revision: tx.request.revision, feature: 'feature' });
    await poll(worker); await poll(coordinator);
    atomicJSON(join(tx.dir, 'ready.json'), { revision: tx.request.revision, feature: 'feature', status: 'ready', worker_epoch: worker.epoch, coordinator_epoch: coordinator.epoch });
  };
  try { await run({ directory, root, worker, coordinator, pi, context, create, poll, finish, publish, receipt, original, notices, messages,
    busy: (v: boolean) => busy = v, replaced: () => replaced = true, wrongBranch: () => branch = 'other' }); }
  finally { socket.stop(true); process.env = previous; rmSync(directory, { recursive: true }); }
}

test('legacy attachment is metadata-only, acknowledges both busy endpoints, and reports only future settles', async () => {
  await fixture(async ({ create, finish, busy, worker, coordinator, pi, context, messages, receipt, original, root }) => {
    const tx = create(); busy(true); await finish(tx);
    expect(readJSON(join(tx.dir, 'prepared-worker.json')).busy).toBe(true);
    expect(readyAttachment(tx.path).revision).toBe(tx.request.revision);
    expect(messages).toHaveLength(0);
    expect(readFileSync(receipt, 'utf8')).toBe(original);
    expect(readdirSync(join(root, 'inbox', coordinator.epoch)).filter(f => f.endsWith('.request.json'))).toHaveLength(0);
    await reportAttached(pi, context(worker), worker, false, () => true);
    const file = readdirSync(join(root, 'inbox', coordinator.epoch)).find(f => f.endsWith('.request.json'))!;
    const report = readJSON(join(root, 'inbox', coordinator.epoch, file));
    expect(validBoundMessage(report, coordinator)).toBe(true);
    expect(report.content).toContain("NOT Craig's approval");
  });
});

test('same-session reload needs explicit epoch renewal; old report is never replayed or adopted by rebind', async () => {
  await fixture(async ({ create, finish, worker, coordinator, publish, pi, context, root, notices }) => {
    const first = create(); await finish(first);
    await reportAttached(pi, context(worker), worker, false, () => true);
    const inbox = join(root, 'inbox', coordinator.epoch);
    const firstFile = readdirSync(inbox).find(f => f.endsWith('.request.json'))!;
    const oldMessage = readJSON(join(inbox, firstFile));
    publish({ ...worker, live: false }); worker.epoch = randomUUID(); publish(worker);
    await reportAttached(pi, context(worker), worker, false, () => true);
    expect(readdirSync(inbox).filter(f => f.endsWith('.request.json'))).toHaveLength(1);
    expect(notices.some((n: any[]) => String(n).includes('not sent'))).toBe(true);
    const second = create(); await finish(second);
    expect(validBoundMessage(oldMessage, coordinator)).toBe(false);
    expect(readdirSync(inbox).filter(f => f.endsWith('.request.json'))).toHaveLength(1); // No saved-report resend.
    await reportAttached(pi, context(worker), worker, false, () => true);
    expect(readdirSync(inbox).filter(f => f.endsWith('.request.json'))).toHaveLength(2);
  });
});

test('rejected endpoint/branch and uncertain claim never acknowledge ready or replay control', async () => {
  for (const variant of ['replaced', 'branch', 'claim']) await fixture(async ({ create, poll, worker, replaced, wrongBranch, messages }) => {
    const tx = create();
    if (variant === 'replaced') replaced();
    if (variant === 'branch') wrongBranch();
    if (variant === 'claim') writeFileSync(join(tx.dir, 'prepared-worker.json.claim'), 'uncertain');
    await poll(worker); await poll(worker);
    if (variant === 'claim') expect(existsSync(join(tx.dir, 'prepared-worker.json'))).toBe(false);
    else expect(readJSON(join(tx.dir, 'prepared-worker.json')).status).toBe('rejected');
    expect(existsSync(join(tx.dir, 'ready.json'))).toBe(false);
    expect(messages).toHaveLength(0);
  });
});

test('late old-binding event during endpoint verification cannot be delivered after explicit rebind', async () => {
  await fixture(async ({ create, finish, worker, coordinator, pi, context, root }) => {
    const first = create(); await finish(first);
    const exec = pi.exec;
    pi.exec = async (...args: any[]) => { const result = await exec(...args); create(); return result; };
    await reportAttached(pi, context(worker), worker, false, () => true);
    expect(readdirSync(join(root, 'inbox', coordinator.epoch)).filter(f => f.endsWith('.request.json'))).toHaveLength(0);
  });
});
