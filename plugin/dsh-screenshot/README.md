# @local/dsh-screenshot

Windows 截图能力：两个 Model-facing 工具 + 一个运行时 skill。

| 名称 | 类型 | 作用 |
|---|---|---|
| `screenshot` | tool | 截前台窗口 / 指定窗口 / 全屏 / http(s) 页面；可内联图片 |
| `list_windows` | tool | 列可见顶层窗口（标题、PID、进程、矩形、前台/最小化） |
| `ui-visual-check` | skill | 改前/改后同条件截图、坐标映射、图片预算、隐私与失败回退 |

## 为什么是插件 + skill

截图是**能力**：需要结构化参数、稳定返回值、把图片直接回传给模型，所以是工具（插件）。
“什么时候截、截哪个、怎么对比、坐标怎么换算”是**流程**：所以是 skill。
skill 由插件通过 `ctx.skills.register()` 注册，安装一次两者都有；skill 随插件启停，不会悬空。

## 依赖

- Windows 10/11。
- DSH Desktop（`0.2.2-rc.3` 验证过）。
- DSH 主运行时自带的 Python 3.12 + Pillow（默认从 `$DSH_HOME/dsh-runtimes/*/dependencies/python/python.exe` 自动发现）。
- URL 截图优先用 [Obscura](https://github.com/h4ckf0r0day/obscura)（Rust 无 Chromium，约 30 MB 内存、启动即时；放在仓库根的 `bin/obscura/`，二进制不进 git，需按下文自行下载）。
- Chrome 作为备选：需要精确视口（Obscura CLI 固定 1280×720）或 Obscura 失败时使用；找不到 Chrome 再回退 Edge。也可在配置里指定 `browserPath` / `obscuraPath`。

## 安装到 desktop profile

> 面向 agent 的完整前置条件、自检脚本与分步 Checkpoint 见仓库根 [INSTALL.md](../../INSTALL.md)。下面是人读的简版。

1. 把仓库放到任意目录，例如 `C:\dev\dsh-screenshot`，插件在 `plugin\dsh-screenshot`。
2. 编辑 `%USERPROFILE%\.dsh\profiles\desktop\package.json`：
   - `dependencies` 增加 `"@local/dsh-screenshot": "link:C:/dev/dsh-screenshot/plugin/dsh-screenshot"`
   - `dsh.profile.bundles` 增加 `"@local/dsh-screenshot"`
3. 在 profile 目录执行 `pnpm install`（用 DSH 自带 pnpm，见仓库内的安装命令）。
4. 等 HMR 重载，或重启 DSH；新会话里检查工具和 skill 是否出现。

先备份 profile 的 `package.json`。回滚时删掉上面两行、`pnpm install`、重启。

## 配置（cordis.patch.yml 行 config）

| 字段 | 默认 | 说明 |
|---|---|---|
| `outputDir` | `$DSH_HOME/cache/screenshots` | PNG 输出目录 |
| `pythonPath` | 自动发现 | 指定带 Pillow 的 Python |
| `obscuraPath` | 自动发现 | Obscura 可执行文件；空 = 依次找本仓库 `bin/obscura`、PATH、Scoop |
| `browserPath` | 自动发现 Chrome（回退 Edge） | 强制用 Chromium；需要精确视口时 |
| `maxEdge` | 2560 | 长边超过就缩小 |
| `inline` | true | 默认把图片回传给模型 |
| `retentionDays` | 7 | 保留天数；0 = 不按时间删 |
| `maxFiles` | 200 | 最多保留张数 |
| `urlWaitMs` | 4000 | headless 页面等待预算 |
| `timeoutMs` / `urlTimeoutMs` | 30000 / 45000 | 桌面 / URL 超时 |

## 截图后端要点

- `ImageGrab.grab(window=hwnd)` 和 `PrintWindow` 对 Electron/Chromium 返回全黑（本机实测），所以窗口截图是**屏幕矩形裁剪**；窗口必须可见，`activate:true` 只负责置前。
- `EnumWindows` + `DwmGetWindowAttribute(EXTENDED_FRAME_BOUNDS)` 取窗口矩形；`Get-Process.MainWindowTitle` 对 Chrome/Electron 不可靠。
- 启动即设 per-monitor DPI awareness，保证 Win32 矩形与 GDI 像素同一坐标空间。
- 全黑截图会报 `SCREENSHOT_BLACK`，不会把黑图当成功。
- URL 截图默认用 **Obscura**：`obscura --allow-private-network fetch <url> --screenshot <png>`；固定 1280×720，启动快、内存低；结果里带 `browser` 字段，便于确认实际用的是哪个后端。
- 传了 `width`/`height`/`scale` 时自动改用 headless Chrome（`--headless=new --screenshot=...`），以支持精确视口；Chrome 不存在时仍用 Obscura 并返回 warning。Obscura 失败且是自动探测时，会回退 Chrome 并在 warnings 里说明。

## 工具用法

```text
screenshot({ target: "active" })
screenshot({ target: "window", window: "DeepSeek Harness", activate: true })
screenshot({ target: "screen" })
screenshot({ target: "url", url: "http://127.0.0.1:62714", width: 1440, height: 900 })
screenshot({ target: "active", region: { x: 0, y: 0, width: 800, height: 600 } })
screenshot({ target: "active", inline: false })
list_windows({})
```

返回 `path/kind/width/height/bytes/origin/scale/capturedAt`，可选 `window/url/warnings/image`。`inline:true` 时 `image` 是 attachment 引用，`render` 会同时返回 text envelope 和 image block。

## 安装/更新 Obscura

默认从仓库根的 `bin/obscura/obscura.exe` 自动发现。安装 v0.2.7：

```powershell
$bin = 'C:\dev\dsh-screenshot\bin'
$zip = Join-Path $bin 'obscura-x86_64-windows.zip'
curl.exe -L --fail -o $zip 'https://github.com/h4ckf0r0day/obscura/releases/download/v0.2.7/obscura-x86_64-windows.zip'
(Get-FileHash $zip -Algorithm SHA256).Hash  # be983b663552e11faf8c1e07696578bad622dbeb48afb9f59036032ca8e97fb3
Expand-Archive $zip -DestinationPath (Join-Path $bin 'obscura') -Force
```

保留 `obscura.exe`、`obscura-worker.exe` 和两个 `vcruntime140*.dll`；不要把 DLL 分开。

## 测试

```text
node test/unit.test.mjs
node test/capture.test.mjs
```

（沙箱内 `node --test` 会因管道/命名管道受限而 EPERM；直接跑测试文件即可。）

- 单元测试不需要 DSH：参数校验、路由门禁、渲染、文件名、后端探测。
- 集成测试会真实调用 `capture.py list/screen/crop`、Obscura（无显式视口）和 Chrome（显式视口）；写临时文件，测试后删除。

## 隐私

截图会捕获可见屏幕，可能包含密码、私信、密钥，并随正常图像请求发送给模型。工具描述和 skill 都要求优先窗口级截图、不要后台/连续自动截图。v1 不做每次截图的审批弹窗；需要时可加 `tools/pre-execute` 审批。
