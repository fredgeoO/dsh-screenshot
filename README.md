# dsh-screenshot

A Windows screenshot plugin for [DeepSeek Harness](https://github.com/deepseek-ai): two model-facing tools (`screenshot`, `list_windows`) plus a runtime skill (`ui-visual-check`) that let an agent actually see windows, pages, and before/after UI changes.

**English** · [中文](README_zh.md) · [日本語](README_ja.md) · [Español](README_es.md)

## Why a plugin and a skill

Capturing the screen is a *capability*: it needs structured arguments, stable return values, and the image handed back to the model — so it is a tool. Deciding *when* to capture, *which* window, and *how* to compare before/after is a *procedure* — so it is a skill. The skill is registered through `ctx.skills.register()`, so it ships and unloads with the plugin.

## Repository layout

```
plugin/dsh-screenshot/     # the plugin (@local/dsh-screenshot)
├─ index.js                # tool registration, argument validation, backend discovery, image return
├─ cordis.patch.yml        # deployment config (row config is the contract)
├─ scripts/capture.py      # Win32 capture (DWM bounds + on-screen rectangle crop + Pillow)
├─ skill/SKILL.md          # ui-visual-check: capture, change, capture again
└─ test/                   # unit tests + real-capture integration tests
bin/obscura/               # Obscura binaries (not in git, see below)
```

## Getting started

```powershell
git clone https://github.com/fredgeoO/dsh-screenshot C:\dev\dsh-screenshot
# edit %DSH_PROFILE_DIR%\package.json:
#   dependencies: add "@local/dsh-screenshot": "link:C:/dev/dsh-screenshot/plugin/dsh-screenshot"
#   dsh.profile.bundles: add "@local/dsh-screenshot"
$rt = "$env:DSH_HOME\dsh-runtimes\dsh-primary-runtime\dependencies"
Push-Location $env:DSH_PROFILE_DIR
& "$rt\node\bin\node.exe" "$rt\pnpm\bin\pnpm.cjs" install
Pop-Location
```

Then unpack [Obscura](https://github.com/h4ckf0r0day/obscura) into `bin/obscura/` — the URL backend, about 30 MB of RAM; without it URL capture falls back to Chrome/Edge. Restart DSH and verify in a **new session** that `screenshot`, `list_windows`, and `ui-visual-check` are present.

> Handing the installation to another agent? Point it at [INSTALL.md](INSTALL.md) (agent-oriented: self-check script, per-step checkpoints, failure table; [中文译本](INSTALL_zh.md)).

## Usage

```text
screenshot({ target: "active" })
screenshot({ target: "window", window: "DeepSeek Harness", activate: true })
screenshot({ target: "screen" })
screenshot({ target: "url", url: "http://127.0.0.1:62714", width: 1440, height: 900 })
screenshot({ target: "active", region: { x: 0, y: 0, width: 800, height: 600 } })
list_windows({})
```

Window captures are cropped from the on-screen rectangle (`PrintWindow` returns black for Electron/Chromium), so the target window must be visible. A black frame is reported as `SCREENSHOT_BLACK`, never as success.

## Requirements

- Windows 10/11 and DSH Desktop (verified on `0.2.2-rc.3`).
- Python 3.12 + Pillow, as shipped with DSH (auto-discovered).
- Obscura, or Chrome/Edge for exact viewports.
- Node 24 and pnpm 11 from the DSH runtime — do not use a global toolchain.

## Tests

```powershell
node test/unit.test.mjs     # no DSH needed
node test/capture.test.mjs  # real capture; needs a desktop session
```

Do not use `node --test`: pipe restrictions in the sandbox produce EPERM.

## Privacy

Captures include whatever is visible on screen — passwords, private messages, keys — and are sent to the model provider as ordinary image requests. Prefer window-level captures over full screen.

## License

[MIT](LICENSE) © 2026 FredgeoO. The repository does not bundle Obscura binaries; they are fetched from upstream on demand (Apache-2.0, separate from this project).
