---
name: gentoo-overlay-workflow
description: "Maintain Craig's public gentoo-overlay or internal gentoo-overlay-private Portage overlays. Use when creating, updating, testing, QA-scanning, manifesting, committing, publishing, or installing ebuilds, especially Rust/Cargo packages and pinned Forgejo or GitHub snapshots."
---

# Gentoo Overlay Workflow

Use this skill for work in either of Craig's Portage overlays:

| Repository | Maintainer tree | Convenience path | Canonical remote |
| --- | --- | --- | --- |
| `gentoo-overlay` | `/var/db/repos/gentoo-overlay` | `~/src/gentoo-overlay` | public GitHub `origin` |
| `gentoo-overlay-private` | `/var/db/repos/gentoo-overlay-private` | `~/src/gentoo-overlay-private` | Forgejo `origin` |

The workflow applies equally to both overlays. Determine which repository owns the package before making changes; never infer repository ownership from the hostname (currently `wabisabi`).

Read `references/local-overlay-workflow.md` completely before writing or modifying an ebuild. Its worked examples happen to come primarily from `gentoo-overlay`, but the packaging, Cargo, Manifest, QA, distfile, and publication rules apply to both repositories.

## Core rules

- The local overlay tree is the maintainer source of truth and is owned by `craig`; normal edits, tests, and Git operations do not need `sudo`.
- Inspect `git status`, the current branch, and remotes before editing. Preserve unrelated work.
- Work directly on `main`, as Craig requests. Do not create feature/package branches unless he explicitly asks.
- Only repository `origin` remotes may receive pushes. Never push to an `upstream`, mirror, or GitHub remote that is not `origin`.
- Use `pkgdev manifest` after changing an ebuild, `SRC_URI`, or `FILESDIR` content.
- Use `pkgcheck scan` and `git diff --check` before committing.
- Use `pkgdev commit`, not plain `git commit`, for package commits. Keep each ebuild and its regenerated Manifest in the same commit.
- Do not emerge packages, write to `/var/cache/distfiles`, or make other root-level changes. Give Craig only the minimal `sudo` commands after non-root validation.
- Do not start or enable a newly installed daemon unless Craig explicitly approves it.

## Required preflight

```bash
repo=/var/db/repos/gentoo-overlay      # or /var/db/repos/gentoo-overlay-private
git -C "$repo" status --short --branch
git -C "$repo" remote -v
git -C "$repo" switch main
```

Inspect the working tree before switching branches; never discard or move unrelated work. If the publication plan is ambiguous, stop and ask before editing.

## Rust/Cargo workflow

For new Rust packages, follow the documented `pycargoebuild` flow:

```bash
mkdir -p /tmp/distfiles
pycargoebuild -L -F aria2 -d /tmp/distfiles -o /tmp/<pkg>-draft.ebuild <crate-or-workspace-member>
```

Then hand-edit the draft, pin source revisions, bundle git dependencies through `SRC_URI`, rewrite them to local paths in `src_prepare`, and build with Cargo offline through the `cargo` eclass.

For untagged snapshots, use:

```text
<base>_p<YYYYMMDD>
```

Pin every source repository to an exact commit SHA. If upstream is a Cargo workspace and `pycargoebuild` rejects the root, generate from a representative member using the root `Cargo.lock`, then override build/install phases as required.

## Distfile and DNS discipline

Overlay distfiles are generally absent from official Gentoo mirrors. Their 404 responses are expected; the authoritative `SRC_URI` must succeed. `RESTRICT="mirror"` may be used in an overlay to skip pointless Gentoo-mirror attempts, but it does not fix authoritative-host DNS failures.

Do not rely on DNS remaining healthy during Craig's later `emerge`. During packaging:

1. Fetch changed source archives into a user-owned staging directory with bounded retries.
2. Give each archive exactly the canonical filename used after `->` in `SRC_URI`.
3. Generate the Manifest against a writable staged distdir.
4. Verify the staged archive against the resulting Manifest.
5. Before test/install emerge, ask Craig to copy only the verified missing files into Portage's real distdir.

Recommended staging shape:

```bash
stage=$(mktemp -d)
cp -as "$(portageq envvar DISTDIR)/." "$stage/"
curl --fail --location --retry 8 --retry-all-errors --retry-delay 2 \
  --output "$stage/<canonical-distfile>" '<authoritative-URI>'
pkgdev manifest -v -d "$stage" <category>/<package>
```

Then give Craig the minimal root command:

```fish
sudo install -o portage -g portage -m 0664 \
  <verified-staged-distfile> \
  /var/cache/distfiles/
```

Portage will independently check the Manifest during emerge. A fetch failure followed by successful `ping` usually means intermittent resolver behavior, not a corrupt ebuild; inspect the final authoritative-URI error rather than treating preceding Gentoo-mirror 404s as the root cause.

## Validation and publication

At minimum:

```bash
pkgdev manifest -v -d <writable-staged-distdir> <category>/<package>
pkgcheck scan <category>/<package>
git diff --check
```

For isolated non-root phase validation, use a user-writable `DISTDIR` and `PORTAGE_TMPDIR` with `ebuild ... clean unpack prepare compile`. Then ask Craig to run the pretend and real merge.

After validation, stage only the intended package files and commit with `pkgdev commit`. Push `main` to `origin` only when Craig authorizes publication. Keep each package and its Manifest in a separate related-unit commit.
