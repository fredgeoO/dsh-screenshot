# INSTALL.md — prerequisites and installation for agents

> The reader is an **agent**, not a human. Follow the steps; every step ends in a **Checkpoint**. If a Checkpoint fails, stop and report — do not keep guessing.
> Repository: <https://github.com/fredgeoO/dsh-screenshot>　Verified on: Windows 11 + DSH Desktop `0.2.2-rc.3`.

**English** · [中文](INSTALL_zh.md)

## 0. TL;DR (three commands, only when the runtime is complete)

```powershell
git clone https://github.com/fredgeoO/dsh-screenshot C:\dev\dsh-screenshot
# edit %DSH_PROFILE_DIR%\package.json: add the link: dependency and the bundle entry (see §2 Step 4)
& "$env:DSH_HOME\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" `
  "$env:DSH_HOME\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.cjs" install
```

Then restart DSH and, in a **new session**, verify that the `screenshot` / `list_windows` tools and the `ui-visual-check` skill exist.

---

## 1. Hard prerequisites

**Do not guess paths.** Run the self-check below first; continue only when everything is PASS.

```powershell
$profile = if ($env:DSH_PROFILE_DIR) { $env:DSH_PROFILE_DIR } else { Join-Path $env:USERPROFILE '.dsh\profiles\desktop' }
$home2   = if ($env:DSH_HOME)     { $env:DSH_HOME }     else { Join-Path $env:USERPROFILE '.dsh' }
$rt      = Join-Path $home2 'dsh-runtimes\dsh-primary-runtime\dependencies'
$node    = Join-Path $rt 'node\bin\node.exe'
$pnpm    = Join-Path $rt 'pnpm\bin\pnpm.cjs'
$python  = Join-Path $rt 'python\python.exe'

$ok = $true
function Check($name, $cond, $hint) {
  if ($cond) { "PASS  $name" } else { "FAIL  $name  ->  $hint"; $script:ok = $false }
}
Check 'Windows 10/11'            ([Environment]::OSVersion.Version.Major -ge 10) 'Windows 10/11 only'
Check 'DSH profile dir'          (Test-Path $profile)        'DSH Desktop missing or never started; start it once'
Check 'profile is a pnpm workspace' (Test-Path (Join-Path $profile 'pnpm-workspace.yaml')) 'profile broken or non-standard'
Check 'profile has node_modules' (Test-Path (Join-Path $profile 'node_modules')) 'start DSH once so it installs its base dependencies'
Check 'bundled node 24'          (Test-Path $node)          'DSH runtime missing; reinstall DSH Desktop'
Check 'bundled pnpm 11'          (Test-Path $pnpm)          'same as above'
Check 'bundled python 3.12'      (Test-Path $python)        'same as above'
Check 'Pillow available'         ((& $python -c "import PIL;print(PIL.__version__)" 2>$null) -ne $null) 'runtime lacks Pillow; reinstall DSH Desktop'
Check 'git'                      ($null -ne (Get-Command git -ErrorAction SilentlyContinue)) 'install Git for Windows'
if ($ok) { 'ALL PASS' } else { 'BLOCKED: fix the FAIL lines first' }
```

| Requirement | Why | If missing |
|---|---|---|
| Windows 10/11 x64 | Uses Win32 APIs + DWM for window rectangles | Unusable (no macOS/Linux support) |
| DSH Desktop ≥ `0.2.2-rc.3` | Loads plugins via profile `link:` + `dsh.profile.bundles` | Tools are never registered |
| Bundled Node 24 / pnpm 11 | **Do not use a global node/npm/pnpm**; version and `nodeLinker: hoisted` would mismatch | `pnpm install` fails with peer/hoist errors |
| Bundled Python 3.12 + Pillow | The only dependency of `scripts/capture.py` | `SCREENSHOT_PYTHON_MISSING` |
| Network (first run only) | Downloads Obscura; optional but needed for URL capture | URL capture falls back to Chrome/Edge; neither → `SCREENSHOT_BROWSER_MISSING` |
| Chrome or Edge (optional) | Needed for **exact viewports** (`width/height/scale`) | Only Obscura's fixed 1280×720 |

> Runtime versions come from `$home2\dsh-runtimes\dsh-primary-runtime\runtime.json` (this machine: node `24.21.0`, pnpm `11.28.5`, python `3.12.14`, Pillow `12.3.0`).

---

## 2. Installation

### Step 1 — Get the repo and fix the plugin path

```powershell
if (-not (Test-Path C:\dev\dsh-screenshot)) {
  git clone https://github.com/fredgeoO/dsh-screenshot C:\dev\dsh-screenshot
}
$repo = 'C:\dev\dsh-screenshot\plugin\dsh-screenshot'
Test-Path (Join-Path $repo 'index.js')          # Checkpoint: True
Test-Path (Join-Path $repo 'cordis.patch.yml')  # Checkpoint: True
```

- The repository root is `dsh-screenshot`; **the plugin lives in the `plugin\dsh-screenshot` subdirectory**. Do not point at the repository root.
- Install through `link:` (a symlink). **Never copy** the plugin into the profile: edits then stop taking effect and upgrades require a reinstall.

### Step 2 — (Optional) Download Obscura

Without it you can still capture windows and the screen; only `target:"url"` falls back to Chrome/Edge.

```powershell
$bin = 'C:\dev\dsh-screenshot\bin'
$zip = Join-Path $bin 'obscura-x86_64-windows.zip'
New-Item -ItemType Directory -Force (Join-Path $bin 'obscura') | Out-Null
curl.exe -L --fail -o $zip 'https://github.com/h4ckf0r0day/obscura/releases/download/v0.2.7/obscura-x86_64-windows.zip'
(Get-FileHash $zip -Algorithm SHA256).Hash   # expected be983b663552e11faf8c1e07696578bad622dbeb48afb9f59036032ca8e97fb3
Expand-Archive $zip -DestinationPath (Join-Path $bin 'obscura') -Force
Remove-Item $zip
Test-Path (Join-Path $bin 'obscura\obscura.exe')   # Checkpoint: True
```

`obscura.exe`, `obscura-worker.exe`, and both `vcruntime140*.dll` must stay in the same directory; do not keep the exe alone.

### Step 3 — Back up the profile's `package.json`

```powershell
Copy-Item "$profile\package.json" "$profile\package.json.bak-screenshot-$(Get-Date -Format yyyyMMdd-HHmmss)"
```

### Step 4 — Idempotent registration (two edits, both required)

```powershell
$repo    = 'C:\dev\dsh-screenshot\plugin\dsh-screenshot'   # the actual path from Step 1
$profile = if ($env:DSH_PROFILE_DIR) { $env:DSH_PROFILE_DIR } else { Join-Path $env:USERPROFILE '.dsh\profiles\desktop' }
$pkgPath = Join-Path $profile 'package.json'
$pkg     = Get-Content $pkgPath -Raw | ConvertFrom-Json
$link    = 'link:' + ($repo -replace '\\', '/')            # link values must use forward slashes

$pkg.dependencies | Add-Member -NotePropertyName '@local/dsh-screenshot' -NotePropertyValue $link -Force
if ($pkg.dsh.profile.bundles -notcontains '@local/dsh-screenshot') {
  $pkg.dsh.profile.bundles += '@local/dsh-screenshot'
}
[IO.File]::WriteAllText($pkgPath, ($pkg | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))

# Checkpoint
$check = Get-Content $pkgPath -Raw | ConvertFrom-Json
$check.dependencies.'@local/dsh-screenshot'                    # expect link:...
$check.dsh.profile.bundles -contains '@local/dsh-screenshot'   # expect True
```

- The `link` value must be an **absolute path with forward slashes**; `C:\...` backslashes fail to resolve.
- `bundles` is what makes DSH load the plugin. Without it the dependency installs but no tools appear.

### Step 5 — Install with the bundled pnpm

```powershell
Push-Location $profile
& $node $pnpm install
$code = $LASTEXITCODE
Pop-Location
"pnpm_exit=$code"        # Checkpoint: 0
```

Checkpoints (both):

```powershell
$p = Join-Path $profile 'node_modules\@local\dsh-screenshot'
Test-Path (Join-Path $p 'index.js')            # expect True
(Get-Item $p).Target                           # expect the Step 1 $repo path
```

If you see `ERR_PNPM_*` network errors, confirm `https://registry.npmjs.org/` is reachable; with only `link:` dependencies you can also try `... install --offline`.
**Do not** work around failures with `npm i` or a global `pnpm`.

### Step 6 — Reload and verify

Host-side plugin changes do not go through frontend HMR: **restart DSH** or wait for it to hot-load plugins. Restarting ends the current session — confirm with the user first.

Checkpoints in a new session (any missing one means failure):

| Check | Expectation |
|---|---|
| tool `list_windows` | returns a table with title/PID/process/rect/foreground |
| tool `screenshot` | `target:"active", inline:false` returns a PNG path |
| skill `ui-visual-check` | appears in the skill list |
| no `SCREENSHOT_PYTHON_MISSING` | Python discovery succeeded |

---

## 3. Acceptance

```powershell
Push-Location 'C:\dev\dsh-screenshot\plugin\dsh-screenshot'
& $node test/unit.test.mjs      # expect tests 10 / pass 10 / fail 0 (no DSH needed)
& $node test/capture.test.mjs   # real capture; needs an interactive desktop session
Pop-Location
```

- **Do not** use `node --test`: pipe restrictions in the sandbox produce `EPERM`. Run the test files directly.
- `capture.test.mjs` writes PNGs to a temp directory and cleans up; if it fails, first check whether a desktop session exists.

---

## 4. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `screenshot` tool missing in a new session | `bundles` entry missing, or DSH not restarted | add Step 4's second edit → restart |
| `Cannot find module '@local/dsh-screenshot'` | `pnpm install` never ran or failed | rerun Step 5, read `pnpm_exit` |
| pnpm `ERR_PNPM_LINKED_PKG_DIR_NOT_EXIST` | wrong `link:` path / plugin directory moved | fix the path, rerun Steps 4–5 |
| `pnpm: command not found` | used a pnpm from PATH | use the absolute `$node $pnpm` from §1 |
| `SCREENSHOT_PYTHON_MISSING` | runtime Python not found | set `pythonPath` in the `cordis.patch.yml` row config |
| `SCREENSHOT_BROWSER_MISSING` | no Obscura, Chrome, or Edge | run Step 2, or set `obscuraPath`/`browserPath` |
| `SCREENSHOT_WINDOW_NOT_FOUND` | wrong title substring | call `list_windows` first for the real title |
| `SCREENSHOT_BLACK` / `SCREENSHOT_OFFSCREEN` | window occluded, minimized, or off-screen | `activate:true`, restore the window, or capture `screen` |
| `SCREENSHOT_UNSUPPORTED_MODEL` | the current model route declares no image input | switch to a vision route, or `inline:false` + `read_image` |

---

## 5. Rollback

```powershell
$profile = if ($env:DSH_PROFILE_DIR) { $env:DSH_PROFILE_DIR } else { Join-Path $env:USERPROFILE '.dsh\profiles\desktop' }
Copy-Item (Get-ChildItem "$profile\package.json.bak-screenshot-*" | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName "$profile\package.json" -Force
Push-Location $profile; & $node $pnpm install; Pop-Location
# then restart DSH
```

Or manually: remove `@local/dsh-screenshot` from `dependencies` and from `bundles` → `pnpm install` → restart. The repository and `bin/` can simply be deleted.

---

## 6. Things an agent must not do

1. Do not `cp`/`robocopy` the plugin into the profile — it must be `link:`.
2. Do not use a global `node`/`pnpm`/`npm`; only the DSH runtime discovered in §1.
3. Do not change system-level configuration (`gitconfig`, system PATH, system Python).
4. Do not edit `node_modules` by hand; edit the profile `package.json` and run `pnpm install`.
5. Do not claim "the tool is installed" before a restart — the **new session** is the only evidence.
6. Do not paste passwords, private messages, or keys from screenshots into the repo or logs; captures are sent to the model provider.
