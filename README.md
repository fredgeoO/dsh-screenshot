# dsh-screenshot

给 [DeepSeek Harness](https://github.com/deepseek-ai) 用的 Windows 截图插件：两个面向模型的工具（`screenshot`、`list_windows`）加一个运行时 skill（`ui-visual-check`），让模型能真的“看见”窗口、页面和界面改动的前后差异。

## 仓库结构

```
.
├─ plugin/dsh-screenshot/     # 插件本体（@local/dsh-screenshot）
│   ├─ index.js               # 工具注册、参数校验、后端探测、图片回传
│   ├─ cordis.patch.yml       # 部署配置（行 config 是契约）
│   ├─ scripts/capture.py     # Win32 截图实现（DWM 边界 + 屏幕矩形裁剪 + Pillow）
│   ├─ skill/SKILL.md         # ui-visual-check：先截、再改、再复看
│   └─ test/                  # 单元测试 + 真截图集成测试
├─ bin/obscura/               # Obscura 可执行文件（不进 git，见下）
└─ README.md
```

## 快速开始

> 让**其他 agent** 代为安装时，直接把它指到 [INSTALL.md](INSTALL.md)：那里是自检脚本 + 分步 Checkpoint + 失败对照表，不需要读本文件的散文。

1. 克隆仓库，按 [插件 README](plugin/dsh-screenshot/README.md#安装到-desktop-profile) 把 `plugin/dsh-screenshot` 以 `link:` 方式挂进 DSH desktop profile 的 `dependencies` 与 `dsh.profile.bundles`，然后 `pnpm install`。
2. 下载 Obscura（URL 截图后端，约 30 MB 内存）：

   ```powershell
   $bin = 'C:\dev\dsh-screenshot\bin'
   $zip = Join-Path $bin 'obscura-x86_64-windows.zip'
   New-Item -ItemType Directory -Force (Join-Path $bin 'obscura') | Out-Null
   curl.exe -L --fail -o $zip 'https://github.com/h4ckf0r0day/obscura/releases/download/v0.2.7/obscura-x86_64-windows.zip'
   Expand-Archive $zip -DestinationPath (Join-Path $bin 'obscura') -Force
   ```

   保留 `obscura.exe`、`obscura-worker.exe` 和两个 `vcruntime140*.dll`，不要拆开。
3. 重启 DSH 或等 HMR，新会话里应出现 `screenshot`、`list_windows` 工具和 `ui-visual-check` skill。

## 用法

```text
screenshot({ target: "active" })
screenshot({ target: "window", window: "DeepSeek Harness", activate: true })
screenshot({ target: "screen" })
screenshot({ target: "url", url: "http://127.0.0.1:62714", width: 1440, height: 900 })
screenshot({ target: "active", region: { x: 0, y: 0, width: 800, height: 600 } })
list_windows({})
```

窗口截图是从屏幕矩形裁剪的（Electron/Chromium 下 `PrintWindow` 会全黑），所以目标窗口必须可见；全黑会报 `SCREENSHOT_BLACK` 而不是假装成功。

## 依赖

- Windows 10/11，DSH Desktop（在 `0.2.2-rc.3` 上验证）。
- DSH 自带的 Python 3.12 + Pillow（自动发现），以及 Obscura；URL 需要精确视口时用本机 Chrome，找不到再回退 Edge。

## 测试

```powershell
node test/unit.test.mjs     # 不依赖 DSH
node test/capture.test.mjs  # 真截屏，需 Windows 桌面会话
```

不要用 `node --test`：沙箱下管道受限会 EPERM。

## 隐私

截图会捕获可见屏幕，可能包含密码、私信、密钥，并随正常图像请求发送给模型提供方。优先截应用窗口，别截全屏，别截与任务无关的敏感窗口。

## License

未附带许可证文件；如需商用或再分发，请先在此添加许可证。
