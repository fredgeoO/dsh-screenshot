# INSTALL_zh.md —— 给 agent 的安装前置条件与步骤

> 读者是 **agent**，不是人。照做即可，每步都有 **Checkpoint**；Checkpoint 不通过就停下报告，不要继续往下猜。
> 仓库：<https://github.com/fredgeoO/dsh-screenshot>　验证环境：Windows 11 + DSH Desktop `0.2.2-rc.3`。

[English](INSTALL.md) · **中文**

> 本文是 [INSTALL.md](INSTALL.md)（英文原文）的译本，内容冲突时以英文原文为准。

## 0. TL;DR（三条命令，仅在运行时齐全时）

```powershell
git clone https://github.com/fredgeoO/dsh-screenshot C:\dev\dsh-screenshot
# 编辑 %DSH_PROFILE_DIR%\package.json：dependencies 加 link:、bundles 加 "@local/dsh-screenshot"（见 §2 Step 4）
& "$env:DSH_HOME\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" `
  "$env:DSH_HOME\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.cjs" install
```

然后重启 DSH，在**新会话**里验证 `screenshot` / `list_windows` 工具与 `ui-visual-check` skill 存在。

---

## 1. 硬性前置条件

**不要猜路径**：先跑下面这段自检，全部 PASS 再往下。

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
Check 'Windows 10/11'            ([Environment]::OSVersion.Version.Major -ge 10) '只支持 Windows 10/11'
Check 'DSH profile 目录'          (Test-Path $profile)        'DSH Desktop 未安装/未启动过；先正常启动一次'
Check 'profile 是 pnpm workspace' (Test-Path (Join-Path $profile 'pnpm-workspace.yaml')) 'profile 被改坏或不是标准布局'
Check 'profile 已有 node_modules' (Test-Path (Join-Path $profile 'node_modules')) '先让 DSH 正常启动一次，让它装好基础依赖'
Check '自带 node 24'              (Test-Path $node)          'DSH 运行时缺失；重装 DSH Desktop'
Check '自带 pnpm 11'              (Test-Path $pnpm)          '同上'
Check '自带 python 3.12'          (Test-Path $python)        '同上'
Check 'Pillow 可用'               ((& $python -c "import PIL;print(PIL.__version__)" 2>$null) -ne $null) '运行时缺 Pillow；重装 DSH Desktop'
Check 'git'                       ($null -ne (Get-Command git -ErrorAction SilentlyContinue)) '安装 Git for Windows'
if ($ok) { 'ALL PASS' } else { 'BLOCKED: 先修上面 FAIL 项' }
```

| 条件 | 说明 | 缺失后果 |
|---|---|---|
| Windows 10/11 x64 | 用 Win32 API + DWM 取窗口矩形 | 完全不可用（仅 macOS/Linux 不支持） |
| DSH Desktop ≥ `0.2.2-rc.3` | 插件通过 profile 的 `link:` + `dsh.profile.bundles` 装载 | 工具不会注册 |
| 自带 Node 24 / pnpm 11 | **不要用全局 node/npm/pnpm**，版本与 `nodeLinker: hoisted` 不一致会装歪 | `pnpm install` 报 peer/hoist 错 |
| 自带 Python 3.12 + Pillow | `scripts/capture.py` 的唯一依赖 | `SCREENSHOT_PYTHON_MISSING` |
| 网络（仅首次） | 下载 Obscura；可选但 URL 截图需要 | URL 截图回退 Chrome/Edge；两者都没有则 `SCREENSHOT_BROWSER_MISSING` |
| Chrome 或 Edge（可选） | 需要**精确视口**（传 `width/height/scale`）时用 | 只能截 Obscura 固定 1280×720 |

> 运行时版本以 `$home2\dsh-runtimes\dsh-primary-runtime\runtime.json` 为准（本机为 node `24.21.0`、pnpm `11.28.5`、python `3.12.14`、Pillow `12.3.0`）。

---

## 2. 安装步骤

### Step 1 —— 取得仓库，确定插件路径

```powershell
if (-not (Test-Path C:\dev\dsh-screenshot)) {
  git clone https://github.com/fredgeoO/dsh-screenshot C:\dev\dsh-screenshot
}
$repo = 'C:\dev\dsh-screenshot\plugin\dsh-screenshot'
Test-Path (Join-Path $repo 'index.js')     # Checkpoint: True
Test-Path (Join-Path $repo 'cordis.patch.yml')  # Checkpoint: True
```

- 仓库根是 `dsh-screenshot`，**插件在 `plugin\dsh-screenshot` 子目录**，不要指向仓库根。
- 安装走 `link:`（符号链接），**不要**把插件目录复制进 profile：复制后改代码不生效，且升级要重装。

### Step 2 ——（可选）下载 Obscura

没有它也能截窗口/全屏，只是 `target:"url"` 会退到 Chrome/Edge。

```powershell
$bin = 'C:\dev\dsh-screenshot\bin'
$zip = Join-Path $bin 'obscura-x86_64-windows.zip'
New-Item -ItemType Directory -Force (Join-Path $bin 'obscura') | Out-Null
curl.exe -L --fail -o $zip 'https://github.com/h4ckf0r0day/obscura/releases/download/v0.2.7/obscura-x86_64-windows.zip'
(Get-FileHash $zip -Algorithm SHA256).Hash   # 期望 be983b663552e11faf8c1e07696578bad622dbeb48afb9f59036032ca8e97fb3
Expand-Archive $zip -DestinationPath (Join-Path $bin 'obscura') -Force
Remove-Item $zip
Test-Path (Join-Path $bin 'obscura\obscura.exe')   # Checkpoint: True
```

`obscura.exe`、`obscura-worker.exe`、两个 `vcruntime140*.dll` 必须在同一目录，别只留 exe。

### Step 3 —— 备份 profile 的 `package.json`

```powershell
Copy-Item "$profile\package.json" "$profile\package.json.bak-screenshot-$(Get-Date -Format yyyyMMdd-HHmmss)"
```

### Step 4 —— 幂等注册（改两处，缺一不可）

```powershell
$repo    = 'C:\dev\dsh-screenshot\plugin\dsh-screenshot'   # 按 Step 1 实际路径
$profile = if ($env:DSH_PROFILE_DIR) { $env:DSH_PROFILE_DIR } else { Join-Path $env:USERPROFILE '.dsh\profiles\desktop' }
$pkgPath = Join-Path $profile 'package.json'
$pkg     = Get-Content $pkgPath -Raw | ConvertFrom-Json
$link    = 'link:' + ($repo -replace '\\', '/')            # link 值必须用正斜杠

$pkg.dependencies | Add-Member -NotePropertyName '@local/dsh-screenshot' -NotePropertyValue $link -Force
if ($pkg.dsh.profile.bundles -notcontains '@local/dsh-screenshot') {
  $pkg.dsh.profile.bundles += '@local/dsh-screenshot'
}
[IO.File]::WriteAllText($pkgPath, ($pkg | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))

# Checkpoint
$check = Get-Content $pkgPath -Raw | ConvertFrom-Json
$check.dependencies.'@local/dsh-screenshot'          # 期望 link:...
$check.dsh.profile.bundles -contains '@local/dsh-screenshot'   # 期望 True
```

- `dependencies` 里的 `link` 要求**绝对路径 + 正斜杠**；用 `C:\...` 反斜杠会解析失败。
- `bundles` 决定插件被加载；漏了它，装完依赖也不会有工具。

### Step 5 —— 用自带 pnpm 安装

```powershell
Push-Location $profile
& $node $pnpm install
$code = $LASTEXITCODE
Pop-Location
"pnpm_exit=$code"        # Checkpoint: 0
```

Checkpoint（两个都要看）：

```powershell
$p = Join-Path $profile 'node_modules\@local\dsh-screenshot'
Test-Path (Join-Path $p 'index.js')            # 期望 True
(Get-Item $p).Target                           # 期望指向 Step 1 的 $repo
```

若报 `ERR_PNPM_*` 网络相关，先确认能访问 `https://registry.npmjs.org/`；依赖全是 `link:` 时也可试 `... install --offline`。
**不要**为了绕过错误改用 `npm i` 或全局 `pnpm`。

### Step 6 —— 重载并验证

宿主侧插件改动不走前端 HMR：需要**重启 DSH** 或等它热加载插件。重启会结束当前会话，先和用户确认。

新会话里的 Checkpoint（缺一即失败）：

| 检查 | 期望 |
|---|---|
| 工具 `list_windows` | 返回表格，含标题/PID/进程/矩形/前台 |
| 工具 `screenshot` | `target:"active", inline:false` 返回 PNG 路径 |
| skill `ui-visual-check` | 出现在 skill 列表 |
| 无 `SCREENSHOT_PYTHON_MISSING` | 说明 Python 发现成功 |

---

## 3. 验收清单

```powershell
Push-Location 'C:\dev\dsh-screenshot\plugin\dsh-screenshot'
& $node test/unit.test.mjs      # 期望 tests 10 / pass 10 / fail 0（不需要 DSH）
& $node test/capture.test.mjs   # 真截屏；需要交互式桌面会话，远程/锁屏会失败
Pop-Location
```

- **不要**用 `node --test`：沙箱下管道受限会 `EPERM`，直接跑测试文件。
- `capture.test.mjs` 会在临时目录写 PNG 并清理；失败先看是不是无桌面会话。

---

## 4. 常见失败与处理

| 现象 | 原因 | 处理 |
|---|---|---|
| 新会话没有 `screenshot` 工具 | `bundles` 漏了，或没重启 | 补 Step 4 第二处 → 重启 |
| `Cannot find module '@local/dsh-screenshot'` | `pnpm install` 没跑或失败 | 重跑 Step 5，看 `pnpm_exit` |
| pnpm 报 `ERR_PNPM_LINKED_PKG_DIR_NOT_EXIST` | `link:` 路径写错/插件目录被移动 | 修正路径后重跑 Step 4/5 |
| `pnpm: command not found` | 用了 PATH 里的 pnpm | 用 §1 的 `$node $pnpm` 绝对路径 |
| `SCREENSHOT_PYTHON_MISSING` | 运行时 Python 找不到 | 在 `cordis.patch.yml` 的 row config 里设 `pythonPath` |
| `SCREENSHOT_BROWSER_MISSING` | Obscura 与 Chrome/Edge 都没有 | 执行 Step 2，或设 `obscuraPath`/`browserPath` |
| `SCREENSHOT_WINDOW_NOT_FOUND` | 标题子串不对 | 先 `list_windows` 拿真实标题 |
| `SCREENSHOT_BLACK` / `SCREENSHOT_OFFSCREEN` | 窗口被遮挡/最小化/移出屏幕 | `activate:true`，恢复窗口，或改截 `screen` |
| `SCREENSHOT_UNSUPPORTED_MODEL` | 当前模型路由不支持图像输入 | 换视觉路由，或 `inline:false` 后 `read_image` |

---

## 5. 回滚

```powershell
$profile = if ($env:DSH_PROFILE_DIR) { $env:DSH_PROFILE_DIR } else { Join-Path $env:USERPROFILE '.dsh\profiles\desktop' }
Copy-Item (Get-ChildItem "$profile\package.json.bak-screenshot-*" | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName "$profile\package.json" -Force
Push-Location $profile; & $node $pnpm install; Pop-Location
# 然后重启 DSH
```

或手动：删掉 `dependencies` 里的 `@local/dsh-screenshot` 与 `bundles` 里的同名项 → `pnpm install` → 重启。仓库和 `bin/` 可以直接删。

---

## 6. agent 不要做的事

1. 不要 `cp`/`robocopy` 插件目录进 profile —— 必须 `link:`。
2. 不要用全局 `node`/`pnpm`/`npm`，只用 §1 发现的 DSH 运行时。
3. 不要改系统级配置（`gitconfig`、系统 PATH、系统 Python）。
4. 不要手改 `node_modules`；只改 profile `package.json` 再 `pnpm install`。
5. 不要在没重启时断言“工具已安装”——以**新会话**里工具真实出现为准。
6. 不要把截图里的密码/私信/密钥贴进仓库或日志；截图会随图像请求发给模型提供方。
