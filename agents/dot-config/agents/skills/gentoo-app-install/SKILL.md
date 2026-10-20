---
name: gentoo-app-install
description: "Use when Craig asks to choose, compare, install, or configure software on his Asahi Gentoo workstation. Covers researching tools against Craig's app preferences, checking Gentoo ebuild keywords/dependencies, giving only sudo commands to Craig, and configuring user-local apps directly."
---

# Gentoo App Selection and Installation Workflow

Use this skill when Craig asks about adding, comparing, installing, keywording, or configuring apps on his Asahi Gentoo workstation.

Also use the `dotfiles-config-management` skill when the install or app setup creates durable non-private user configuration.

## Environment assumptions

Craig's workstation is highly customized Asahi Gentoo Linux with fish as the default shell.

Important local sources:
- System docs: `~/docs/gentoo-docs/`
- Custom overlay: `~/src/gentoo-overlay`
- Noctalia shell customizations: `~/src/noctalia-plugins/`
- Portage package keywords: `/etc/portage/package.accept_keywords/wabisabi`

## App preference filter

Prefer software that is:
- Wayland-native.
- GTK4-friendly when GUI is relevant.
- Written in C, C++, Rust, or Swift.
- Minimal, native, and aligned with the existing stack.

Acceptable but less preferred:
- Go applications.

Avoid unless strongly justified:
- Python-based apps, because the system already has a lot of Python.
- Qt6 apps; Sioyek is the known tolerated Qt6 exception.
- X11-only software.

## Workflow

1. Clarify the job only if needed.
   - Prefer one strong recommendation over a large option list.
   - Keep comparisons short and decision-oriented.

2. Research candidate tools.
   - Check local docs first when the question is specific to Craig's Gentoo setup.
   - Use web search for current upstream facts when comparing tools.
   - Evaluate candidates against Craig's language/toolkit/Wayland preferences.

3. Check Gentoo availability.
   - Use `eix <package>` if Craig has already shown it, otherwise use local Portage commands as needed.
   - Inspect the ebuild in `/var/db/repos/gentoo` or the custom overlay when useful.
   - Run pretend merges with no system changes, for example:
     - `emerge -pv <atom>`
     - `ACCEPT_KEYWORDS='**' emerge -pv <atom>` when testing masked packages.
   - Identify exact package atoms, USE flags, new dependencies, required Rust/toolchain constraints, and keyword masks.

4. Determine keywords.
   - Prefer the narrowest useful atom, usually `=<category>/<package>-<version> **` when the ebuild lacks arm64 keywords entirely.
   - Put keyword recommendations in `/etc/portage/package.accept_keywords/wabisabi`.
   - Do not suggest creating separate keyword files unless Craig asks.

5. Give Craig only commands that require sudo.
   - Do not give commands for actions the agent can perform without sudo.
   - Use fish-compatible command examples unless bash is specifically needed.
   - For Portage keyword additions, prefer commands like:
     ```fish
     echo '=category/package-version **' | sudo tee -a /etc/portage/package.accept_keywords/wabisabi
     sudo emerge -av category/package
     ```

6. Configure after install.
   - If configuration is user-local, do it yourself after Craig installs the package or grants permission.
   - If configuration requires sudo/root, guide Craig with the minimal sudo commands.
   - Verify the app works with non-invasive commands before declaring it done.

## Response style

- Be brief and practical.
- Explain only the decisive reasons.
- Prefer a single recommendation.
- Mention privacy or risk only when relevant.
