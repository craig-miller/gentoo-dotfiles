// Resolve host SDK/types without installing dependencies into the live configuration.
import { dirname, resolve, join } from "node:path";
import { realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
const ts = require(join(dirname(dirname(realpathSync(execFileSync("which", ["tsc"], { encoding: "utf8" }).trim()))), "lib/typescript.js"));
const modules = dirname(dirname(require.resolve("typebox/package.json")));
const files = ["extension.ts", "lifecycle.ts", "reporting.ts", "snapshot.ts", "store.ts"].map(f => resolve(import.meta.dir, "../../pi/dot-config/pi/extensions/tuicr-review", f));
const program = ts.createProgram(files, { noEmit: true, strict: true, skipLibCheck: true, allowImportingTsExtensions: true,
  target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowJs: true, checkJs: false, typeRoots: [join(modules, "@types")], types: ["node"],
  paths: { "typebox": [join(modules, "typebox/build/index.d.mts")], "@earendil-works/pi-coding-agent": [join(modules, "@earendil-works/pi-coding-agent/dist/index.d.ts")] },
});
const diagnostics = ts.getPreEmitDiagnostics(program);
console.log(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => process.cwd(), getCanonicalFileName: f => f, getNewLine: () => "\n" }));
process.exitCode = diagnostics.length ? 1 : 0;
