# dsh-screenshot

Windows 截图插件 · Windows スクリーンショットプラグイン · Windows screenshot plugin · Plugin de capturas de pantalla para Windows — for [DeepSeek Harness](https://github.com/deepseek-ai).

[中文](#zh) · [日本語](#ja) · [English](#en) · [Español](#es)

---

<a id="zh"></a>

## 中文

给 DeepSeek Harness 用的 Windows 截图插件：两个面向模型的工具（`screenshot`、`list_windows`）加一个运行时 skill（`ui-visual-check`），让模型能真的“看见”窗口、页面和界面改动的前后差异。

### 仓库结构

```
plugin/dsh-screenshot/     # 插件本体（@local/dsh-screenshot）
├─ index.js                # 工具注册、参数校验、后端探测、图片回传
├─ cordis.patch.yml        # 部署配置（行 config 是契约）
├─ scripts/capture.py      # Win32 截图（DWM 边界 + 屏幕矩形裁剪 + Pillow）
├─ skill/SKILL.md          # ui-visual-check：先截、再改、再复看
└─ test/                   # 单元测试 + 真截图集成测试
bin/obscura/               # Obscura 可执行文件（不进 git，见下）
```

### 快速开始

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

然后下载 [Obscura](https://github.com/h4ckf0r0day/obscura) 到 `bin/obscura/`（URL 截图后端，约 30 MB 内存；不装则退回 Chrome/Edge），重启 DSH，在**新会话**里确认 `screenshot`、`list_windows` 与 `ui-visual-check` 出现。

> 让其他 agent 代为安装：直接指向 [INSTALL.md](INSTALL.md)，内含自检脚本、分步 Checkpoint 与失败对照表。

### 用法

```text
screenshot({ target: "active" })
screenshot({ target: "window", window: "DeepSeek Harness", activate: true })
screenshot({ target: "screen" })
screenshot({ target: "url", url: "http://127.0.0.1:62714", width: 1440, height: 900 })
screenshot({ target: "active", region: { x: 0, y: 0, width: 800, height: 600 } })
list_windows({})
```

窗口截图是从屏幕矩形裁剪的（Electron/Chromium 下 `PrintWindow` 会全黑），目标窗口必须可见；全黑会报 `SCREENSHOT_BLACK`，不会假装成功。

### 依赖与测试

Windows 10/11，DSH Desktop（`0.2.2-rc.3` 验证）；DSH 自带 Python 3.12 + Pillow；精确视口用 Chrome，找不到回退 Edge。

```powershell
node test/unit.test.mjs     # 不依赖 DSH
node test/capture.test.mjs  # 真截屏，需桌面会话
```

不要用 `node --test`：沙箱下管道受限会 EPERM。

### 隐私

截图会捕获可见屏幕，可能含密码、私信、密钥，并随图像请求发送给模型提供方。优先截窗口，别默认全屏。

### License

[MIT](LICENSE) © 2026 FredgeoO。仓库不含 Obscura 二进制（按需从上游下载），其许可为 Apache-2.0，与本项目分开。

[↑ 回到语言选择](#dsh-screenshot)

---

<a id="ja"></a>

## 日本語

DeepSeek Harness 用の Windows スクリーンショットプラグインです。モデル向けツール 2 つ（`screenshot`、`list_windows`）とランタイム skill（`ui-visual-check`）を提供し、エージェントが実際に画面を見て UI 変更の前後を比較できるようにします。

### リポジトリ構成

```
plugin/dsh-screenshot/     # プラグイン本体（@local/dsh-screenshot）
├─ index.js                # ツール登録・引数検証・バックエンド検出・画像返却
├─ cordis.patch.yml        # デプロイ設定（row config が契約）
├─ scripts/capture.py      # Win32 キャプチャ（DWM 境界＋画面矩形の切り出し＋Pillow）
├─ skill/SKILL.md          # ui-visual-check：撮る → 直す → 撮り直す
└─ test/                   # ユニットテスト＋実キャプチャの統合テスト
bin/obscura/               # Obscura 実行ファイル（git 管理外、下記参照）
```

### はじめに

```powershell
git clone https://github.com/fredgeoO/dsh-screenshot C:\dev\dsh-screenshot
# %DSH_PROFILE_DIR%\package.json を編集：
#   dependencies に "@local/dsh-screenshot": "link:C:/dev/dsh-screenshot/plugin/dsh-screenshot"
#   dsh.profile.bundles に "@local/dsh-screenshot" を追加
$rt = "$env:DSH_HOME\dsh-runtimes\dsh-primary-runtime\dependencies"
Push-Location $env:DSH_PROFILE_DIR
& "$rt\node\bin\node.exe" "$rt\pnpm\bin\pnpm.cjs" install
Pop-Location
```

続いて [Obscura](https://github.com/h4ckf0r0day/obscura) を `bin/obscura/` に展開し（URL キャプチャ用、メモリ約 30 MB。未導入なら Chrome/Edge にフォールバック）、DSH を再起動して、**新しいセッション**で `screenshot`、`list_windows`、`ui-visual-check` が現れることを確認します。

> 他のエージェントにインストールさせる場合は [INSTALL.md](INSTALL.md)（中国語・エージェント向け）を渡してください。自己診断スクリプト、段階ごとのチェックポイント、失敗時の対処表があります。

### 使い方

```text
screenshot({ target: "active" })
screenshot({ target: "window", window: "DeepSeek Harness", activate: true })
screenshot({ target: "screen" })
screenshot({ target: "url", url: "http://127.0.0.1:62714", width: 1440, height: 900 })
screenshot({ target: "active", region: { x: 0, y: 0, width: 800, height: 600 } })
list_windows({})
```

ウィンドウのキャプチャは画面上の矩形を切り出す方式です（Electron/Chromium では `PrintWindow` が真っ黒になるため）。対象ウィンドウは可視である必要があり、真っ黒の場合は `SCREENSHOT_BLACK` を返します（成功として扱いません）。

### 依存関係とテスト

Windows 10/11、DSH Desktop（`0.2.2-rc.3` で検証）。Python 3.12＋Pillow は DSH 同梱。正確なビューポートが必要なときは Chrome、なければ Edge。

```powershell
node test/unit.test.mjs     # DSH 不要
node test/capture.test.mjs  # 実際に撮影（デスクトップセッションが必要）
```

`node --test` は使わないでください（サンドボックスでパイプが制限され EPERM になります）。

### プライバシー

画面にはパスワードや私信、API キーが写り得ます。キャプチャは通常の画像リクエストとしてモデル提供元へ送信されます。全画面ではなくウィンドウ単位で撮ってください。

### ライセンス

[MIT](LICENSE) © 2026 FredgeoO。Obscura のバイナリは同梱せず、必要時に上流から取得します（Apache-2.0、本プロジェクトとは別扱い）。

[↑ 言語選択へ戻る](#dsh-screenshot)

---

<a id="en"></a>

## English

A Windows screenshot plugin for DeepSeek Harness: two model-facing tools (`screenshot`, `list_windows`) plus a runtime skill (`ui-visual-check`) that let the agent actually see windows, pages, and before/after UI changes.

### Repository layout

```
plugin/dsh-screenshot/     # the plugin (@local/dsh-screenshot)
├─ index.js                # tool registration, argument validation, backend discovery, image return
├─ cordis.patch.yml        # deployment config (row config is the contract)
├─ scripts/capture.py      # Win32 capture (DWM bounds + on-screen rectangle crop + Pillow)
├─ skill/SKILL.md          # ui-visual-check: capture, change, capture again
└─ test/                   # unit tests + real-capture integration tests
bin/obscura/               # Obscura binaries (not in git, see below)
```

### Getting started

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

Then unpack [Obscura](https://github.com/h4ckf0r0day/obscura) into `bin/obscura/` (the URL backend, ~30 MB RAM; without it URL capture falls back to Chrome/Edge), restart DSH, and verify in a **new session** that `screenshot`, `list_windows`, and `ui-visual-check` are present.

> Handing installation to another agent? Point it at [INSTALL.md](INSTALL.md) (Chinese, agent-oriented): self-check script, per-step checkpoints, and a failure table.

### Usage

```text
screenshot({ target: "active" })
screenshot({ target: "window", window: "DeepSeek Harness", activate: true })
screenshot({ target: "screen" })
screenshot({ target: "url", url: "http://127.0.0.1:62714", width: 1440, height: 900 })
screenshot({ target: "active", region: { x: 0, y: 0, width: 800, height: 600 } })
list_windows({})
```

Window captures are cropped from the on-screen rectangle (`PrintWindow` returns black for Electron/Chromium), so the target window must be visible. A black frame is reported as `SCREENSHOT_BLACK`, never as success.

### Requirements and tests

Windows 10/11 and DSH Desktop (verified on `0.2.2-rc.3`). Python 3.12 + Pillow ship with DSH. Exact viewports use Chrome, falling back to Edge.

```powershell
node test/unit.test.mjs     # no DSH needed
node test/capture.test.mjs  # real capture; needs a desktop session
```

Do not use `node --test`: pipe restrictions in the sandbox produce EPERM.

### Privacy

Captures include whatever is visible on screen — passwords, private messages, keys — and are sent to the model provider as ordinary image requests. Prefer window-level captures over full screen.

### License

[MIT](LICENSE) © 2026 FredgeoO. The repository does not bundle Obscura binaries; they are fetched from upstream on demand (Apache-2.0, separate from this project).

[↑ Back to languages](#dsh-screenshot)

---

<a id="es"></a>

## Español

Plugin de capturas de pantalla para Windows para DeepSeek Harness: dos herramientas para el modelo (`screenshot`, `list_windows`) y una skill de ejecución (`ui-visual-check`) que permiten al agente ver de verdad ventanas, páginas y el antes/después de un cambio de interfaz.

### Estructura del repositorio

```
plugin/dsh-screenshot/     # el plugin (@local/dsh-screenshot)
├─ index.js                # registro de herramientas, validación, detección de backend, retorno de imagen
├─ cordis.patch.yml        # configuración de despliegue (row config es el contrato)
├─ scripts/capture.py      # captura Win32 (límites DWM + recorte del rectángulo en pantalla + Pillow)
├─ skill/SKILL.md          # ui-visual-check: capturar, cambiar, volver a capturar
└─ test/                   # pruebas unitarias + pruebas de captura real
bin/obscura/               # binarios de Obscura (fuera de git, ver abajo)
```

### Primeros pasos

```powershell
git clone https://github.com/fredgeoO/dsh-screenshot C:\dev\dsh-screenshot
# edita %DSH_PROFILE_DIR%\package.json:
#   dependencies: añade "@local/dsh-screenshot": "link:C:/dev/dsh-screenshot/plugin/dsh-screenshot"
#   dsh.profile.bundles: añade "@local/dsh-screenshot"
$rt = "$env:DSH_HOME\dsh-runtimes\dsh-primary-runtime\dependencies"
Push-Location $env:DSH_PROFILE_DIR
& "$rt\node\bin\node.exe" "$rt\pnpm\bin\pnpm.cjs" install
Pop-Location
```

Después descomprime [Obscura](https://github.com/h4ckf0r0day/obscura) en `bin/obscura/` (backend para URL, ~30 MB de RAM; sin él, las capturas de URL usan Chrome/Edge), reinicia DSH y comprueba en una **sesión nueva** que aparecen `screenshot`, `list_windows` y `ui-visual-check`.

> ¿Le encargas la instalación a otro agente? Pásale [INSTALL.md](INSTALL.md) (en chino, orientado a agentes): script de autodiagnóstico, checkpoints por paso y tabla de fallos.

### Uso

```text
screenshot({ target: "active" })
screenshot({ target: "window", window: "DeepSeek Harness", activate: true })
screenshot({ target: "screen" })
screenshot({ target: "url", url: "http://127.0.0.1:62714", width: 1440, height: 900 })
screenshot({ target: "active", region: { x: 0, y: 0, width: 800, height: 600 } })
list_windows({})
```

Las capturas de ventana se recortan del rectángulo visible en pantalla (`PrintWindow` devuelve negro en Electron/Chromium), así que la ventana debe estar visible. Una imagen negra se reporta como `SCREENSHOT_BLACK`, nunca como éxito.

### Requisitos y pruebas

Windows 10/11 y DSH Desktop (probado en `0.2.2-rc.3`). Python 3.12 + Pillow vienen con DSH. Para viewports exactos se usa Chrome y, si no está, Edge.

```powershell
node test/unit.test.mjs     # no requiere DSH
node test/capture.test.mjs  # captura real; requiere sesión de escritorio
```

No uses `node --test`: las restricciones de tuberías en el sandbox provocan EPERM.

### Privacidad

Las capturas incluyen todo lo visible en pantalla (contraseñas, mensajes privados, claves) y se envían al proveedor del modelo como peticiones de imagen normales. Prefiere capturas de ventana en lugar de pantalla completa.

### Licencia

[MIT](LICENSE) © 2026 FredgeoO. El repositorio no incluye los binarios de Obscura; se descargan del upstream cuando hacen falta (Apache-2.0, independiente de este proyecto).

[↑ Volver a idiomas](#dsh-screenshot)
