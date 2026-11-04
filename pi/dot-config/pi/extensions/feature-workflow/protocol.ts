import { readFileSync, writeFileSync, renameSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const stateRoot = () => join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "feature-workflow");
export const readJSON = (path: string) => JSON.parse(readFileSync(path, "utf8"));
export function atomicJSON(path: string, value: unknown) {
  writeFileSync(path + ".tmp", JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  renameSync(path + ".tmp", path);
}
export function herdrInstance() {
  if (!process.env.HERDR_SOCKET_PATH) throw new Error("Herdr socket identity unavailable");
  const socket = realpathSync(process.env.HERDR_SOCKET_PATH);
  const info = statSync(socket, { bigint: true });
  if (!info.isSocket()) throw new Error("Herdr endpoint is not a socket");
  return { socket, device: String(info.dev), inode: String(info.ino), created: String(info.ctimeNs) };
}
export function sameInstance(a: any, b: any) {
  return !!a && !!b && ["socket", "device", "inode", "created"].every(k => typeof a[k] === "string" && a[k] === b[k]);
}
export function matchesDestination(message: any, registration: any) {
  return sameInstance(message.target?.instance, registration.instance) && ["epoch", "session", "session_file", "common", "pane", "tab", "workspace"].every(k => message.target?.[k] === registration[k]);
}
