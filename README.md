# gentoo-dotfiles

Versioned configs for my Asahi Gentoo-on-M1 setup ([gentoo-overlay](https://github.com/craig-miller/gentoo-overlay)). Managed with [GNU stow](https://www.gnu.org/software/stow/).

Each package mirrors `~/.config/<name>/`. The `dot-config/` directory translates to `.config/` via stow's `--dotfiles` flag.

## Packages

- `niri` — niri compositor config + the `noctalia-launcher` PipeWire-ready wrapper.
- `noctalia` — Noctalia v5 Wayland shell config.
- `soundthemed` — event-sound daemon config.
- `nvim` — minimal neovim init.
- `tmux` — minimal tmux config (prefix `C-a`, vi mode).

## Usage

```
git clone https://github.com/craig-miller/gentoo-dotfiles.git ~/dotfiles
cd ~/dotfiles
stow --dotfiles --no-folding niri noctalia soundthemed nvim tmux
```

`--no-folding` keeps `~/.config/<pkg>/` as a real directory with individual file symlinks, so apps that write runtime state into their config dir (noctalia, nvim, soundthemed) don't dump files back into this repo.
