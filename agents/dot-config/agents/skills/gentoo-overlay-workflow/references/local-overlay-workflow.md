# Gentoo Portage overlays — Personal Reference

Workflow notes for both of Craig's maintained Portage overlays: packages not in main/GURU, local patches, and pinned versions.

| Repository | Maintainer tree | Convenience path | Publication |
| --- | --- | --- | --- |
| `gentoo-overlay` | `/var/db/repos/gentoo-overlay` | `~/src/gentoo-overlay` | public GitHub `origin` |
| `gentoo-overlay-private` | `/var/db/repos/gentoo-overlay-private` | `~/src/gentoo-overlay-private` | Forgejo `origin` |

Both trees are user-owned (`craig:craig`), so daily edits and Git operations need no sudo. Only system changes such as `emerge` and copying verified archives into `/var/cache/distfiles` require sudo. Each local working copy is the maintainer source of truth (`auto-sync = false`); only its `origin` may receive pushes.

The worked package and setup examples below mostly use the public `gentoo-overlay` repository, but the ebuild, Cargo, Manifest, QA, distfile, and commit rules apply equally to `gentoo-overlay-private`. First-time public-overlay setup is captured in **Appendix A**.

## Daily workflow

```
repo=~/src/gentoo-overlay              # or ~/src/gentoo-overlay-private
cd "$repo"
git status --short --branch
git remote -v
git switch main                      # Craig's default; no feature branch unless requested
nvim <cat>/<pkg>/<pkg>-<ver>.ebuild
pkgdev manifest <cat>/<pkg>/
pkgcheck scan <cat>/<pkg>/
git diff --check
sudo emerge --pretend <cat>/<pkg>
sudo emerge --ask <cat>/<pkg>
git diff
pkgdev commit
git push origin main
```

Check the working tree before switching branches; preserve unrelated changes. Commit one package and its Manifest per related unit, and push only when Craig authorizes publication.

What each verb does:

- **`pkgdev manifest <pkg-dir>/`** regenerates the package's `Manifest` whenever you change `SRC_URI` or `FILESDIR` contents. Always run it after an ebuild edit that touches sources — otherwise Portage refuses to merge with a checksum mismatch. (`ebuild <ebuild> manifest` does the same thing; `pkgdev` is the friendlier wrapper.)
- **`pkgcheck scan <pkg-dir>/`** runs Gentoo's static QA scanner — metadata.xml validity, EAPI usage, dep resolution, license issues. Catches mistakes before emerge does. Run it before every commit.
- **`pkgdev commit`** writes a commit using Gentoo's `cat/pkg: subject` convention, runs pkgcheck pre-commit, and adds a Signed-off-by line. Skips the prompt if every staged change is in one package; asks for a subject otherwise. Prefer this over plain `git commit` so the public log stays consistent with mainstream Gentoo style.

Manifest discipline rule: the ebuild change + Manifest regen go in the *same* commit. `pkgdev commit` stages and commits together if you've run `pkgdev manifest` first; never separate them across commits.

## Adding a new package

```
mkdir -p /var/db/repos/gentoo-overlay/<category>/<app>
nvim /var/db/repos/gentoo-overlay/<category>/<app>/<app>-<version>.ebuild
nvim /var/db/repos/gentoo-overlay/<category>/<app>/metadata.xml
cd /var/db/repos/gentoo-overlay/<category>/<app>
pkgdev manifest .
pkgcheck scan .
sudo emerge --pretend <category>/<app>
sudo emerge --ask <category>/<app>
```

If the category isn't already in `profiles/categories`, add it there (`nvim /var/db/repos/gentoo-overlay/profiles/categories`) before committing — Portage uses that file to decide which subdirs to scan.

### Filename convention

`<pkgname>-<version>.ebuild` exactly. Portage parses `${P}=<pkgname>-<version>` and `${PV}=<version>` from this. If the filename is wrong, the variable substitutions in the ebuild silently produce wrong URLs and paths.

### Category convention

Match upstream/GURU placement so `--depclean` and `qlist` behave intuitively:

- CLI tools, daemons, shell apps → `gui-apps/`, `app-misc/`, `sys-apps/`
- Libraries → `dev-libs/`, `media-libs/`
- Language toolchains → `dev-lang/`
- Compilers/build tools → `dev-util/`, `dev-build/`
- X11-or-toolkit-adjacent → `x11-libs/`, `x11-misc/`

If the package is also in GURU, use the same category as GURU.

### metadata.xml template

```
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE pkgmetadata SYSTEM "https://www.gentoo.org/dtd/metadata.dtd">
<pkgmetadata>
	<upstream>
		<remote-id type="github">org/repo</remote-id>
	</upstream>
</pkgmetadata>
```

### Keyword acceptance

If the ebuild's `KEYWORDS=` lists only `~arm64` (testing) and your system runs stable arm64, add the package to `/etc/portage/package.accept_keywords/wabisabi`. Use this existing host-specific file; do not create a separate keyword file unless Craig asks. Forms:

- `<category>/<pkg> ~arm64` — accept testing
- `<category>/<pkg> **` — accept anything (unkeyworded, masked, live ebuilds)

Use `~arm64` if upstream has the keyword. Use `**` only if the package is unkeyworded entirely.

## Updating a package version

When upstream releases a new version:

```
cd /var/db/repos/gentoo-overlay/<category>/<app>
cp <app>-<old>.ebuild <app>-<new>.ebuild
pkgdev manifest .
pkgcheck scan .
sudo emerge --pretend <category>/<app>
sudo emerge --ask <category>/<app>
```

If the build process or dependencies didn't change between versions, that's the whole update. Edit the new ebuild only if it needs adjustments.

Keep old ebuilds around as fallbacks — Portage picks the highest version that's keyword-accepted, but if the new one breaks you can mask it (`>=<category>/<app>-<new>` in `/etc/portage/package.mask/wabisabi`) and fall back without deleting anything.

## Common gotchas

### Manifest goes stale after every ebuild edit

If you edit the ebuild file, the Manifest's hash for it is now wrong and Portage will refuse to merge with a "masked" error. Always run `pkgdev manifest <pkg-dir>/` after edits.

### Go ebuilds: GOFLAGS collision

If the upstream Makefile sets `GOFLAGS=...` and the go-module eclass also sets GOFLAGS, the two collide and you get errors like `parsing $GOFLAGS: unknown flag -w"`. Fix in `src_configure`:

```
src_configure() {
	sed -i '/^GOFLAGS=/d' "${S}/Makefile"
	default
}
```

This strips the Makefile's GOFLAGS line so only the eclass's value is in scope.

### Repo/asset name mismatch

If the upstream repo is named `<repo>` but releases ship `<binary>-<version>.tar.gz` where `<binary>` differs from `<repo>`, the default `${S}=${WORKDIR}/${P}` (which uses the repo name) won't match the unpacked directory (which uses the binary name). Fix in the ebuild:

```
SRC_URI="https://github.com/Org/${PN}/releases/download/v${PV}/<binary>-${PV}.tar.gz -> ${P}.tar.gz"
S="${WORKDIR}/<binary>-${PV}"
```

The `-> ${P}.tar.gz` part saves the downloaded file under the package-canonical name so Portage's distfile cache stays clean. `S=` tells Portage where the unpacked source actually lives.

Example: danksearch is the repo, dsearch is the binary/asset.

### Overlay mirror misses and DNS flakes during fetch

Official Gentoo mirrors normally do not carry distfiles referenced only by an overlay. Their 404 responses are expected; the decisive failure is the final fetch from the authoritative `SRC_URI`. `RESTRICT="mirror"` may be used in an overlay to skip those pointless mirror attempts, but it does not repair DNS for the authoritative host.

Do not rely on DNS remaining healthy until a later test emerge. Fetch each changed direct source into a user-owned staged distdir, using exactly the canonical filename from the `SRC_URI` `->` rename. Seed the stage with symlinks to existing Portage distfiles so Cargo crates are not downloaded again:

```
stage=$(mktemp -d)
cp -as "$(portageq envvar DISTDIR)/." "$stage/"
curl --fail --location --retry 8 --retry-all-errors --retry-delay 2 \
  --output "$stage/<canonical-distfile>" <authoritative-url>
pkgdev manifest -v -d "$stage" <category>/<package>
```

Verify the staged file against the resulting Manifest. Before `emerge`, have Craig place only the verified missing archive in Portage's real distdir:

```
sudo install -o portage -g portage -m 0664 \
  "$stage/<canonical-distfile>" \
  /var/cache/distfiles/
```

Portage verifies the Manifest independently during emerge. A successful `ping` immediately after a failed fetch is consistent with intermittent resolver behavior; it does not make the preceding failure a package-build error.

### Crates.io 403 for Rust packages — fix via FETCHCOMMAND

For Cargo ebuilds (`inherit cargo`), the auto-generated SRC_URI uses `crates.io/api/v1/crates/<name>/<ver>/download`, which returns **403 Forbidden** to wget's default `Wget/1.x` User-Agent. crates.io's [data-access policy](https://crates.io/data-access) requires consumers to identify themselves with a tool-and-contact UA, otherwise expect to be blocked.

**Correct fix** (also documented in `install-gentoo.md` Step 63): override Portage's FETCHCOMMAND/RESUMECOMMAND in `/etc/portage/make.conf` to send an identifying UA. One config change fixes every Rust ebuild going forward — no per-package workaround scripts.

```
FETCHCOMMAND="wget -t 3 -T 60 --passive-ftp --user-agent=\"Portage/3.0 (+https://wiki.gentoo.org/wiki/Project:Portage)\" -O \"\${DISTDIR}/\${FILE}\" \"\${URI}\""
RESUMECOMMAND="wget -c -t 3 -T 60 --passive-ftp --user-agent=\"Portage/3.0 (+https://wiki.gentoo.org/wiki/Project:Portage)\" -O \"\${DISTDIR}/\${FILE}\" \"\${URI}\""
```

Scope-correct: only Portage's wget calls get the UA. Don't set it globally in `/etc/wgetrc` — that would have every manual `wget` on the system lying about being Portage.

**pycargoebuild fetching**: pycargoebuild calls wget directly, outside Portage. Requires **`>=app-portage/pycargoebuild-0.15.2`** (which ships its own internal UA fix). Below 0.15.2, the same 403 bites; bump locally from the Gentoo tree (copy `0.15.1.ebuild` → `0.15.2.ebuild`, `pkgdev manifest .`, re-emerge) if upstream Gentoo hasn't packaged 0.15.2 yet. Also use `-F aria2` (after `emerge net-misc/aria2`) for parallel + retry-aware fetching — a 200-crate workspace finishes in ~30 seconds instead of timing out on serial wget flakes.

## Eclass cheatsheet

When writing the ebuild, `inherit` the right eclass:

- **Go binaries with vendored deps**: `inherit go-module` — expects upstream tarball to include vendor/
- **Rust binaries**: `inherit cargo` — supply `CRATES=` list (use `pycargoebuild` or extract from Cargo.lock)
- **Python packages**: `inherit distutils-r1` — set `PYTHON_COMPAT=`
- **CMake-based C/C++**: `inherit cmake`
- **Meson-based C/C++**: `inherit meson`
- **Autotools-based**: usually no eclass needed; default phases work

For Go and Rust, the dgop ebuild at `/var/db/repos/guru/gui-apps/dgop/` is a clean template. For Rust, see any GURU package with a CRATES variable like `gui-wm/niri` or `x11-misc/matugen`.

## Rust workspaces (multiple binaries from one Cargo.lock)

pycargoebuild can't run on a workspace root — it errors out with "directory is a workspace root" and asks you to pick a member. The trick: run it on the most representative member (typically `daemon/`). Cargo.lock at the workspace root captures the dependency graph for *every* member, so the resulting CRATES list covers the whole workspace.

```
cd <workspace>/daemon
pycargoebuild -L -F aria2 -d /tmp/distfiles -o /tmp/<pkg>-draft.ebuild .
```

(`-L` skips LICENSE extraction; set `LICENSE="MIT"` (or the actual license) manually in the hand-edit pass. `-F aria2` switches the fetcher to aria2 — see the crates.io section above for why.)

The draft is daemon-only and missing the workspace build logic. Hand-edit the trailer:

- **`SRC_URI`** — add the source tarball *and* `${CARGO_CRATE_URIS}`. For an untagged HEAD snapshot, pin to a commit SHA via a `<PKG>_COMMIT` shell variable and `https://github.com/<org>/<pkg>/archive/${<PKG>_COMMIT}.tar.gz -> ${P}.tar.gz`.
- **`S`** — GitHub archive of `<sha>.tar.gz` unpacks to `<repo>-<sha>/`. Set `S="${WORKDIR}/${PN}-${<PKG>_COMMIT}"` so the cargo eclass finds the source.
- **`src_compile()` override** — the eclass's default only builds the manifest at the working directory, which for a workspace produces nothing. Replace with `cargo_src_compile --workspace` to build all members in one pass.
- **`src_install()` override** — the eclass's default uses `cargo install`, which only ships *one* binary. Replace with explicit `dobin target/release/<binary>` calls, one per binary you want to ship. Use heredocs into `${T}` to construct any `.desktop` files (autostart, app-launcher) and `doins` them in afterward.

Version-string convention for untagged HEAD snapshots: `<base>_p<YYYYMMDD>` where `<base>` is whatever `Cargo.toml` claims (use `0.1.0` or `0.0.0` if nothing's set). Bumping for an ebuild-only change (e.g., new `.desktop` entry): increment with `-r1`, `-r2`, etc.

### Worked example: gui-apps/soundthemed (daemon + GUI from one workspace)

`gui-apps/soundthemed` is the canonical instance of the pattern: Rust cargo workspace with a `daemon/` member and a `config-gui/` member (GTK4 + libadwaita), both built from the same `Cargo.lock`. No upstream release tags, so the ebuild pins to a specific commit.

**Prereqs:**
```
sudo emerge --ask app-portage/pycargoebuild net-misc/aria2
```
(`pycargoebuild` must be ≥0.15.2 — gentoo-overlay carries the backport ahead of the main tree; see "Common gotchas → Crates.io 403" above for why.)

**Step 1 — clone and generate the draft.** Run pycargoebuild on `daemon/` (not the workspace root — pycargoebuild rejects workspace roots, but `Cargo.lock` at the workspace root means the resulting `CRATES=` list still covers every member):

```
mkdir -p ~/src && cd ~/src
git clone https://github.com/destructatron/soundthemed
cd soundthemed
git rev-parse HEAD                  # capture this SHA for SOUNDTHEMED_COMMIT
mkdir -p /tmp/distfiles
cd daemon
pycargoebuild -L -F aria2 -d /tmp/distfiles -o /tmp/soundthemed-draft.ebuild .
```

The draft is ~220 lines: a `CRATES=` list of ~200 crates plus `inherit cargo` and stubbed metadata. No `SRC_URI` for the source tarball, no RDEPEND, no `src_compile`, no `src_install`. Those come next.

**Step 2 — hand-edit the trailer.** Open the draft, find `inherit cargo`, and replace everything from that line to the end with:

```
inherit cargo

SOUNDTHEMED_COMMIT="<paste-the-SHA-from-git-rev-parse-HEAD>"

DESCRIPTION="Freedesktop sound theme daemon — plays event sounds for USB, battery, network, session, and more"
HOMEPAGE="https://github.com/destructatron/soundthemed"
SRC_URI="
	https://github.com/destructatron/${PN}/archive/${SOUNDTHEMED_COMMIT}.tar.gz -> ${P}.tar.gz
	${CARGO_CRATE_URIS}
"
S="${WORKDIR}/${PN}-${SOUNDTHEMED_COMMIT}"

LICENSE="MIT"
SLOT="0"
KEYWORDS="~arm64 ~amd64"

RDEPEND="
	gui-libs/gtk:4
	gui-libs/libadwaita
	media-video/pipewire
"
DEPEND="${RDEPEND}"

src_compile() {
	cargo_src_compile --workspace
}

src_install() {
	dobin target/release/soundthemed
	dobin target/release/soundthemed-config

	cat > "${T}"/soundthemed.desktop <<-EOF
		[Desktop Entry]
		Type=Application
		Name=soundthemed
		Exec=/usr/bin/soundthemed
		NoDisplay=true
	EOF
	insinto /etc/xdg/autostart
	doins "${T}"/soundthemed.desktop

	cat > "${T}"/soundthemed-config.desktop <<-EOF
		[Desktop Entry]
		Type=Application
		Name=Sound Themes
		GenericName=Sound theme daemon configuration
		Comment=Configure event sounds for desktop notifications
		Exec=/usr/bin/soundthemed-config
		Icon=preferences-desktop-sound
		Terminal=false
		Categories=Settings;AudioVideo;Audio;
		Keywords=sound;theme;event;notification;
	EOF
	insinto /usr/share/applications
	doins "${T}"/soundthemed-config.desktop

	einstalldocs
}
```

Why each piece:

- **`SOUNDTHEMED_COMMIT`** — pins to a specific git commit for reproducible builds. Bumping the package means bumping this variable plus the version in the filename.
- **`SRC_URI`** — two URIs: the GitHub commit tarball, and `${CARGO_CRATE_URIS}` (the cargo eclass expands `CRATES=` into per-crate `crates.io/api/v1/crates/...` URLs).
- **`S=`** — GitHub's `<sha>.tar.gz` unpacks to `<repo>-<sha>/`, not the usual `<repo>-<version>/`. Override `S` so the eclass finds the source.
- **`src_compile()`** — the eclass default builds only the manifest at the working directory, which for a workspace root produces nothing. `cargo_src_compile --workspace` builds every member.
- **`src_install()`** — the eclass default uses `cargo install`, which only ships one binary. We have two (`soundthemed`, `soundthemed-config`), so `dobin` them explicitly. Then the two `.desktop` files: an XDG autostart entry (dex picks it up at niri session start) and an app-launcher entry (discoverable in fuzzel as "Sound Themes"). Constructed via heredoc into `${T}` (the eclass-provided temp dir), then `doins`-ed.

Rename to the Gentoo filename — `<base>_p<YYYYMMDD>` for an untagged HEAD snapshot:

```
mv /tmp/soundthemed-draft.ebuild "/tmp/soundthemed-0.1.0_p$(date +%Y%m%d).ebuild"
```

**Step 3 — stage in the overlay and Manifest.**

```
mkdir -p /var/db/repos/gentoo-overlay/gui-apps/soundthemed
install -m 644 /tmp/soundthemed-*.ebuild /var/db/repos/gentoo-overlay/gui-apps/soundthemed/
distdir=$(portageq envvar DISTDIR)
sudo cp /tmp/distfiles/*.crate "$distdir/"
pkgdev manifest gui-apps/soundthemed/
```

The `cp` to distdir relocates the prefetched crates so `pkgdev manifest` finds them locally instead of refetching. Only the source tarball needs a fresh download. Manifest ends up ~60 KB — one DIST line per crate.

**Step 4 — QA scan and test.**

```
pkgcheck scan gui-apps/soundthemed/
sudo emerge --ask gui-apps/soundthemed
```

A single package in the plan, no transitive deps (gtk4/libadwaita/pipewire are already on disk after Chapter 12's USE rebuild). Build is ~3–5 min on M1 Pro at `-j10`. Binaries land at `/usr/bin/soundthemed{,-config}` and the autostart entry at `/etc/xdg/autostart/soundthemed.desktop`.

## Worked example: simple C ebuild (asahi-brightnessd)

`app-laptop/asahi-brightnessd` is the canonical instance of a different pattern: pure C, libc-only, hand-written `Makefile` that already does `make` + `make install DESTDIR=`, plus an in-repo OpenRC init script. No eclass beyond `toolchain-funcs` (for `tc-getCC`), no cargo, no autotools.

When to use this pattern: any project whose Makefile is already well-behaved (respects `DESTDIR`, `CC`, `CFLAGS`, `LDFLAGS`), no language-specific package manager involved. The ebuild ends up ~30 lines.

**Step 1 — create the package directory.**

```
mkdir -p /var/db/repos/gentoo-overlay/app-laptop/asahi-brightnessd
cd /var/db/repos/gentoo-overlay/app-laptop/asahi-brightnessd
```

(Category choice: `app-laptop` is the home for laptop-hardware tooling — `app-laptop/laptop-mode-tools`, `app-laptop/thinkfan`, `app-laptop/pommed`. Brightness daemons fit.)

**Step 2 — write the ebuild.** Filename uses `<base>_p<YYYYMMDD>` for an untagged HEAD snapshot:

```
nvim asahi-brightnessd-0.1.0_p20260530.ebuild
```

Paste:

```
# Copyright 2026 Craig Miller
# Distributed under the terms of the MIT License

EAPI=8

inherit toolchain-funcs

COMMIT="<paste-current-HEAD-SHA>"

DESCRIPTION="Ambient-light auto-brightness for display + keyboard backlight (Asahi Linux)"
HOMEPAGE="https://github.com/craig-miller/asahi-brightnessd"
SRC_URI="https://github.com/craig-miller/${PN}/archive/${COMMIT}.tar.gz -> ${P}.tar.gz"
S="${WORKDIR}/${PN}-${COMMIT}"

LICENSE="MIT"
SLOT="0"
KEYWORDS="~arm64"

src_compile() {
	emake CC="$(tc-getCC)"
}

src_install() {
	emake DESTDIR="${D}" install
	newinitd "${S}/${PN}.openrc" "${PN}"
	einstalldocs
}

pkg_postinst() {
	elog ""
	elog "Enable the service:"
	elog "  rc-update add ${PN} default"
	elog "  rc-service  ${PN} start"
	elog ""
	elog "Requires apple/aop-als-cal.bin in /lib/firmware/apple/ — extract"
	elog "from a macOS ioreg dump (see HOMEPAGE for details)."
	elog ""
}
```

Why each piece:

- **`inherit toolchain-funcs`** — pulls in `tc-getCC` so the Makefile gets the cross-compile-aware compiler (important for distcc / crossdev / future arm64-vs-others).
- **`COMMIT=`** — pins the source to a specific upstream SHA. Bumping the package means bumping this SHA and the date in the filename.
- **`SRC_URI` + `S=`** — GitHub archive of `<sha>.tar.gz` unpacks to `<repo>-<sha>/`; the `-> ${P}.tar.gz` part saves it in distdir under the package-canonical name (keeps the cache clean).
- **`src_compile`** — single line, the eclass-aware `emake CC="$(tc-getCC)"` handles parallelism (`MAKEOPTS`) and the right compiler.
- **`src_install`** — `emake DESTDIR="${D}" install` lets the Makefile install where Portage expects. `newinitd` ships the OpenRC service script as `/etc/init.d/asahi-brightnessd` with mode 755 (the helper renames + chmods).
- **`pkg_postinst`** — `elog` messages persist in `/var/log/portage/elog/` and print at install time. Useful for "remember to enable this service" reminders.

**Step 3 — Manifest and test.**

```
pkgdev manifest app-laptop/asahi-brightnessd/
pkgcheck scan app-laptop/asahi-brightnessd/
sudo emerge --ask app-laptop/asahi-brightnessd
```

Build is sub-second (one compilation unit, no deps to resolve). `pkg_postinst`'s elog block prints the next-step reminder.

**Contrast with the Rust workspace example above:** no `CRATES=` list to generate, no workspace overrides, no `${CARGO_CRATE_URIS}`. The C/Makefile case is simpler precisely because the Makefile already encapsulates what cargo eclasses have to invent.

## Packages currently in the overlay

(Run `ls /var/db/repos/gentoo-overlay/*/*` for the live list.)

- `app-laptop/asahi-brightnessd` — C daemon driving display + keyboard backlight from the M1 ambient-light sensor. Pure C, libc-only, no eclass. Source at [`github.com/craig-miller/asahi-brightnessd`](https://github.com/craig-miller/asahi-brightnessd).
- `app-portage/pycargoebuild-0.15.2` — local backport of pycargoebuild ahead of the main tree. Carries the crates.io UA fix needed for Rust workspace generation. Drop this once the main tree catches up.
- `dev-lang/dart-sass-bin-1.100.0` — Binary distribution of dart-sass (Sass reference compiler) AOT-compiled to native binary. Multi-arch `SRC_URI` (`amd64?`, `arm64?`, `riscv?`, `arm?` USE-conditional URIs); installs to `/opt/dart-sass/` with a `/usr/bin/sass` symlink. Reference example for binary-distribution ebuilds (no compile step, `RESTRICT="strip"`, `QA_PREBUILT`).
- `gui-apps/danksearch-0.3.1` — Go binary for indexed filesystem search (DMS launcher backend, retained post-DMS-purge). Built from upstream release tarball with vendored Go deps. Reference example for Go ebuilds.
- `gui-apps/soundthemed-0.1.0_p20260529-r1` — Rust workspace freedesktop event-sound daemon + GTK4 + libadwaita config GUI. Pinned to a specific upstream commit (`SOUNDTHEMED_COMMIT` shell variable) since no release tags exist. Reference example for Rust workspace ebuilds — overrides `src_compile` with `--workspace` to build all members in one cargo pass, overrides `src_install` to `dobin` both binaries plus install heredoc-constructed XDG autostart and `/usr/share/applications/` launcher `.desktop` entries.
- `gui-apps/wayle-0.5.0` — Wayland desktop shell (bar, OSD, notifications, wallpaper, device controls). Rust + GTK4 + Relm4. RDEPENDs on `gui-apps/awww` (from GURU), `x11-libs/libnotify`, `x11-misc/matugen` (from GURU), NetworkManager, BlueZ, upower, power-profiles-daemon. Ships one FILESDIR patch (`0001-fix-keyframes-blink.patch`).

---

## Appendix A: Setting up the overlay from scratch

These steps document how to recreate the gentoo-overlay state on a clean Gentoo system — fresh M1 install, future second machine, whatever. Already done on wabisabi; this is the recipe.

### A.1: Install maintainer tools

```
sudo emerge --ask dev-util/pkgdev dev-util/pkgcheck
```

`pkgdev` provides `pkgdev manifest` and `pkgdev commit`; `pkgcheck` is Gentoo's QA scanner. The daily workflow assumes both. They have small dep trees (Python + a few support libs); the install is quick.

### A.2: Create the overlay tree, then transfer ownership

```
sudo mkdir -p /var/db/repos/gentoo-overlay/{metadata,profiles}
sudo chown -R craig:craig /var/db/repos/gentoo-overlay
```

Portage only needs to *read* an overlay marked `auto-sync = false` — it never writes back. So the tree being user-owned is correct, despite `/var/db/repos/` historically being root territory for synced overlays.

### A.3: Symlink into `~/src/`

```
ln -s /var/db/repos/gentoo-overlay ~/src/gentoo-overlay
```

Lets the overlay live alongside your other `~/src/` projects. The two paths point at the same files; commands work the same from either.

### A.4: Write `metadata/layout.conf`

```
nvim /var/db/repos/gentoo-overlay/metadata/layout.conf
```

Paste:

```
masters = gentoo
repo-name = gentoo-overlay
thin-manifests = true
sign-manifests = false
sign-commits = false
manifest-hashes = BLAKE2B SHA512
manifest-required-hashes = BLAKE2B
profile-formats = profile-set
cache-formats = md5-dict
```

`masters = gentoo` makes the overlay inherit eclasses (cargo, go-module, distutils-r1, etc.) from the main tree. `thin-manifests = true` means `Manifest` files contain only `DIST` lines (distfile checksums), not `MISC`/`AUX` — the modern default with smaller diffs. The `sign-*` lines explicitly opt out of OpenPGP signing (we rely on GitHub for transport integrity). `manifest-hashes` and `manifest-required-hashes` declare which checksum algorithms `pkgdev manifest` writes.

### A.5: Write `profiles/repo_name` and `profiles/categories`

```
nvim /var/db/repos/gentoo-overlay/profiles/repo_name
```

Single line:

```
gentoo-overlay
```

```
nvim /var/db/repos/gentoo-overlay/profiles/categories
```

One category per line — initial set:

```
app-laptop
app-portage
dev-lang
gui-apps
```

Append new categories here whenever you add a package in one Portage doesn't already know about for this overlay.

### A.6: Register the overlay with Portage

```
sudo nvim /etc/portage/repos.conf/gentoo-overlay.conf
```

Paste:

```
[gentoo-overlay]
location = /var/db/repos/gentoo-overlay
auto-sync = false
```

No `sync-type`/`sync-uri` because this machine *is* the source of truth — you push, you don't pull. Other machines that consume the published overlay add `sync-type = git` + `sync-uri = https://github.com/craig-miller/gentoo-overlay.git` + `auto-sync = yes`.

### A.7: Verify Portage sees the overlay

```
portageq get_repos /
eselect repository list -i
```

Both should list `gentoo-overlay`. At this point the overlay exists and Portage knows about it; the next steps populate it.

### A.8: Add LICENSE, README, .gitignore

Fetch the GPL-2 text directly so the GitHub UI detects it correctly:

```
cd /var/db/repos/gentoo-overlay
curl -fsSL https://www.gnu.org/licenses/old-licenses/gpl-2.0.txt -o LICENSE
```

GPL-2 is the Gentoo convention for overlay-as-distribution. Individual ebuilds keep their own per-package `LICENSE=` field; this `LICENSE` file governs the *aggregate distribution* of the overlay itself.

Write the README:

```
nvim /var/db/repos/gentoo-overlay/README.md
```

Paste (replace placeholder packages list with the live state):

```
# gentoo-overlay

A Gentoo Portage overlay for packages not in the main tree or GURU, maintained alongside the [Gentoo install guide](https://github.com/craig-miller/gentoo-docs) — a Gentoo Linux install guide for Apple Silicon (M1) MacBooks running Asahi.

## Enabling

`sudo nvim /etc/portage/repos.conf/gentoo-overlay.conf`

Paste:

    [gentoo-overlay]
    location = /var/db/repos/gentoo-overlay
    sync-type = git
    sync-uri = https://github.com/craig-miller/gentoo-overlay.git
    auto-sync = yes

Sync:

    sudo emaint -r gentoo-overlay sync

## License

GPL-2 (see LICENSE). Individual ebuilds carry the upstream package's own license — see each ebuild's `LICENSE=` field.
```

Write the .gitignore:

```
nvim /var/db/repos/gentoo-overlay/.gitignore
```

Paste:

```
metadata/md5-cache/
metadata/dtd/
metadata/glsa/
metadata/news/
distfiles/
packages/
*.swp
*.swo
*~
.DS_Store
```

`metadata/md5-cache/` is regenerated by Portage on `egencache` or sync; not part of the source. Distfiles and binpkgs live in `/var/cache/distfiles/` and `/var/cache/binpkgs/`; they never belong in the overlay tree.

### A.9: Initialize git and make the first commit

```
cd ~/src/gentoo-overlay
git init -b main
git add -A
git commit -m "Initial commit"
```

No sudo — the tree is user-owned. Use `main` as the default branch; Portage's git sync follows the remote's default branch, so consumers get whatever's at `main`'s tip.

### A.10: Publish to GitHub

```
gh repo create craig-miller/gentoo-overlay --public \
    --description "Gentoo Portage overlay for the Gentoo install guide (Asahi M1)" \
    --source=. --remote=origin --push
```

Single command: creates the public repo on GitHub, sets `origin`, pushes `main`. Requires `gh auth status` to show authenticated.

### A.11: Verify

```
gh repo view craig-miller/gentoo-overlay --web
```

Opens the repo page. Confirm:
- README renders
- LICENSE is detected (GitHub shows "GPL-2.0" in the sidebar)
- Tree structure looks right (categories + metadata + profiles at top level)

From here, the overlay is live. Add packages with the "Adding a new package" workflow at the top of this doc; the first package commit pushes a meaningful first release.
