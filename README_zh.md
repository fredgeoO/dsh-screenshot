# dsh-screenshot

给 [DeepSeek Harness](https://github.com/deepseek-ai) 用的 Windows 截图插件：两个面向模型的工具（`screenshot`、`list_windows`）加一个运行时 skill（`ui-visual-check`），让 agent 能真的“看见”窗口、页面和界面改动的前后差异。

[English](README.md) · **中文** · [日本語](README_ja.md) · [Español](README_es.md)

> 本文是 [README.md](README.md)（英文原文）的译本，内容冲突时以英文原文为准。

## 为什么是插件 + skill

截图是**能力**：需要结构化参数、稳定返回值、把图片回传给模型，所以是工具。什么时候截、截哪个、怎么对比是**流程**：所以是 skill。skill 由插件通过 `ctx.skills.register()` 注册，安装一次两者都有，随插件启停。

## 仓库结构

```
plugin/dsh-screenshot/     # 插件本体（@local/dsh-screenshot）
├─ index.js                # 工具注册、参数校验、后端探测、图片回传
├─ cordis.patch.yml        # 部署配置（行 config 是契约）
├─ scripts/capture.py      # Win32 截图（DWM 边界 + 屏幕矩形裁剪 + Pillow）
├─ skill/SKILL.md          # ui-visual-check：先截、再改、再复看
└─ test/                   # 单元测试 + 真截图集成测试
bin/obscura/               # Obscura 可执行文件（不进 git，见下）
```

## 快速开始

```powershell
git clone https://github.com/fredgeoO/dsh-screenshot C:\dev\dsh-screenshot
# 编辑 %DSH_PROFILE_DIR%\package.json：
#   dependencies 增加 "@local/dsh-screenshot": "link:C:/dev/dsh-screenshot/plugin/dsh-screenshot"
#   dsh.profile.bundles 追加 "@local/dsh-screenshot"
$rt = "$env:DSH_HOME\dsh-runtimes\dsh-primary-runtime\dependencies"
Push-Location $env:DSH_PROFILE_DIR
& "$rt\node\bin\node.exe" "$rt\pnpm\bin\pnpm.cjs" install
Pop-Location
```

然后下载 [Obscura](https://github.com/h4ckf0r0day/obscura) 解压到 `bin/obscura/`（URL 截图后端，约 30 MB 内存；不装则退回 Chrome/Edge），重启 DSH，在**新会话**里确认 `screenshot`、`list_windows` 与 `ui-visual-check` 出现。

> 让其他 agent 代为安装：直接指向 [INSTALL.md](INSTALL.md)，内含自检脚本、分步 Checkpoint 与失败对照表。

## 用法

```text
screenshot({ target: "active" })
screenshot({ target: "window", window: "DeepSeek Harness", activate: true })
screenshot({ target: "screen" })
screenshot({ target: "url", url: "http://127.0.0.1:62714", width: 1440, height: 900 })
screenshot({ target: "active", region: { x: 0, y: 0, width: 800, height: 600 } })
list_windows({})
```

窗口截图是从屏幕矩形裁剪的（Electron/Chromium 下 `PrintWindow` 会全黑），目标窗口必须可见；全黑会报 `SCREENSHOT_BLACK`，不会假装成功。

## 依赖

- Windows 10/11，DSH Desktop（`0.2.2-rc.3` 验证）。
- DSH 自带 Python 3.12 + Pillow（自动发现）。
- Obscura；需要精确视口时用 Chrome，找不到回退 Edge。
- DSH 运行时自带 Node 24 与 pnpm 11 —— 不要用全局工具链。

## 测试

```powershell
node test/unit.test.mjs     # 不依赖 DSH
node test/capture.test.mjs  # 真截屏，需桌面会话
```

不要用 `node --test`：沙箱下管道受限会 EPERM。

## 隐私

截图会捕获可见屏幕，可能含密码、私信、密钥，并随图像请求发送给模型提供方。优先截窗口，别默认全屏。

## License

[MIT](LICENSE) © 2026 FredgeoO。仓库不含 Obscura 二进制（按需从上游下载），其许可为 Apache-2.0，与本项目分开。
