import { test, expect } from "bun:test";
import { originIdentity, returnAndClose } from "../../pi/dot-config/pi/extensions/tuicr-review/runner.mjs";

function fixture() {
  const owner = { session: "session", sessionFile: "/session.jsonl", pane: "w:p1", tab: "w:t1", workspace: "w" };
  const launch = { pane: "w:p3", tab: "w:t3", terminal: "review-terminal" };
  const originPane = { pane_id: owner.pane, tab_id: owner.tab, workspace_id: "w", terminal_id: "origin-terminal", agent: "pi",
    agent_session: { agent: "pi", kind: "path", value: owner.sessionFile } };
  const snapshot: any = { panes: [originPane, { pane_id: launch.pane, tab_id: launch.tab, workspace_id: "w", terminal_id: launch.terminal }],
    agents: [structuredClone(originPane)], tabs: [{ tab_id: owner.tab, workspace_id: "w" }, { tab_id: "w:t2", workspace_id: "w" }, { tab_id: launch.tab, workspace_id: "w" }],
    focused_pane_id: launch.pane, focused_tab_id: launch.tab, focused_workspace_id: "w" };
  const calls: string[][] = [], receipts: any = {};
  let shell = 123, same = true, identity = owner.session, snapshots = 0, elapsed = 0;
  let beforeSnapshot = (_n: number) => {}, beforeFocus = () => {};
  const api = {
    owner, launch, pid: 123, origin: originIdentity(owner, snapshot),
    now: () => elapsed, sameServer: () => same, readSessionId: () => identity,
    record: (name: string, value: any) => { receipts[name] = value; },
    herdr: (args: string[]) => {
      calls.push(args);
      if (args[1] === "process-info") return { process_info: { shell_pid: shell } };
      if (args[1] === "snapshot") { beforeSnapshot(++snapshots); return { snapshot: structuredClone(snapshot) }; }
      if (args[1] === "focus") { beforeFocus(); snapshot.focused_tab_id = args[2]; return {}; }
      if (args[1] === "close") return {};
      throw Error("unexpected command");
    },
  };
  return { owner, snapshot, api, calls, receipts, run: () => returnAndClose(api),
    setSession: (value: string) => identity = value, setServer: (value: boolean) => same = value, setShell: (value: number) => shell = value,
    onSnapshot: (fn: (n: number) => void) => beforeSnapshot = fn, onFocus: (fn: () => void) => beforeFocus = fn,
    expire: () => elapsed = 1501,
    focusElsewhere: () => { snapshot.focused_tab_id = "w:t2"; snapshot.focused_pane_id = "w:p2"; } };
}

test("focused review returns to exact pinned origin, never intervening tab order", () => {
  const f = fixture(); f.run();
  expect(f.calls.filter(c => c[1] === "focus")).toEqual([["tab", "focus", "w:t1"]]);
  expect(f.calls.at(-1)).toEqual(["pane", "close", "w:p3"]);
  expect(f.receipts["return-focus.json"]).toMatchObject({ state: "acknowledged", atomic: false });
});

test("focus elsewhere initially or during validation is preserved; owned review still closes", () => {
  for (const during of [false, true]) {
    const f = fixture();
    if (during) f.onSnapshot(n => { if (n === 2) f.focusElsewhere(); }); else f.focusElsewhere();
    f.run(); expect(f.calls.some(c => c[1] === "focus")).toBe(false);
    expect(f.receipts["return-focus.json"].reason).toBe("focus_elsewhere");
    expect(f.calls.at(-1)).toEqual(["pane", "close", "w:p3"]);
  }
});

test("missing/replaced/moved origin and changed session fail safe without fallback focus", () => {
  for (const kind of ["closed", "terminal", "session", "tab", "workspace", "agent", "header", "unpinned"]) {
    const f = fixture();
    if (kind === "closed") f.snapshot.panes.shift();
    if (kind === "terminal") f.snapshot.panes[0].terminal_id = "replacement";
    if (kind === "session") f.snapshot.agents[0].agent_session.value = "/different.jsonl";
    if (kind === "tab") f.snapshot.panes[0].tab_id = "w:t2";
    if (kind === "workspace") f.snapshot.panes[0].workspace_id = "new-workspace";
    if (kind === "agent") f.snapshot.agents[0].agent = "bash";
    if (kind === "header") f.setSession("new-session");
    if (kind === "unpinned") f.api.origin = null;
    f.run(); expect(f.calls.some(c => c[1] === "focus")).toBe(false);
    expect(f.receipts["close.json"].state).toBe("requested");
  }
});

test("moved/replaced review or server never focuses or closes via stale identities", () => {
  for (const kind of ["tab", "pane", "terminal", "workspace", "shell", "server"]) {
    const f = fixture(), review = f.snapshot.panes[1];
    if (kind === "tab") review.tab_id = "w:t4";
    if (kind === "pane") review.pane_id = "w:p4";
    if (kind === "terminal") review.terminal_id = "replacement";
    if (kind === "workspace") review.workspace_id = "other";
    if (kind === "shell") f.setShell(999);
    if (kind === "server") f.setServer(false);
    f.run(); expect(f.calls.some(c => ["focus", "close"].includes(c[1]))).toBe(false);
    expect(f.receipts["close.json"].state).toBe("retained");
  }
});

test("late origin replacement, slow validation and post-focus review move are checked", () => {
  const stale = fixture(); stale.onSnapshot(n => { if (n === 2) stale.snapshot.agents[0].agent_session.value = "/other"; }); stale.run();
  expect(stale.calls.some(c => c[1] === "focus")).toBe(false);
  const slow = fixture(); slow.onSnapshot(n => { if (n === 2) slow.expire(); }); slow.run();
  expect(slow.receipts["return-focus.json"].reason).toBe("validation_expired");
  const moved = fixture(); moved.onFocus(() => { moved.snapshot.panes[1].tab_id = "w:t4"; }); moved.run();
  expect(moved.calls.some(c => c[1] === "close")).toBe(false);
});

test("unconditional Herdr focus still has a last-check/action race; never retry or undo", () => {
  const f = fixture(); let raced = false;
  f.onFocus(() => { f.focusElsewhere(); raced = true; }); f.run();
  // This deliberately demonstrates the residual limitation, not a guarantee:
  // navigation after the final snapshot cannot be protected client-side.
  expect(raced).toBe(true); expect(f.snapshot.focused_tab_id).toBe("w:t1");
  expect(f.calls.filter(c => c[1] === "focus")).toHaveLength(1);
  const uncertain = fixture(); uncertain.onFocus(() => { throw Error("API acknowledgement lost"); }); uncertain.run();
  expect(uncertain.receipts["return-focus.json"].state).toBe("uncertain");
  expect(uncertain.calls.filter(c => c[1] === "focus")).toHaveLength(1);
});
