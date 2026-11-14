# dsh-screenshot

[DeepSeek Harness](https://github.com/deepseek-ai) 用の Windows スクリーンショットプラグインです。モデル向けツール 2 つ（`screenshot`、`list_windows`）とランタイム skill（`ui-visual-check`）を提供し、エージェントが実際に画面を見て UI 変更の前後を比較できるようにします。

[English](README.md) · [中文](README_zh.md) · **日本語** · [Español](README_es.md)

> これは [README.md](README.md)（英語の原文）の翻訳です。内容が食い違う場合は英語版を優先します。

## なぜプラグインと skill に分けるのか

画面のキャプチャは**能力**です。構造化された引数、安定した戻り値、画像をモデルへ返す仕組みが必要なのでツールにします。いつ撮るか、どのウィンドウを撮るか、前後をどう比べるかは**手順**なので skill にします。skill は `ctx.skills.register()` で登録され、プラグインと一緒に読み込まれ、一緒に外れます。

## リポジトリ構成

```
plugin/dsh-screenshot/     # プラグイン本体（@local/dsh-screenshot）
├─ index.js                # ツール登録・引数検証・バックエンド検出・画像返却
├─ cordis.patch.yml        # デプロイ設定（row config が契約）
├─ scripts/capture.py      # Win32 キャプチャ（DWM 境界＋画面矩形の切り出し＋Pillow）
├─ skill/SKILL.md          # ui-visual-check：撮る → 直す → 撮り直す
└─ test/                   # ユニットテスト＋実キャプチャの統合テスト
bin/obscura/               # Obscura 実行ファイル（git 管理外、下記参照）
```

## はじめに

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

> 他のエージェントにインストールさせる場合は [INSTALL.md](INSTALL.md)（英語・エージェント向け）を渡してください。自己診断スクリプト、段階ごとのチェックポイント、失敗時の対処表があります。

## 使い方

```text
screenshot({ target: "active" })
screenshot({ target: "window", window: "DeepSeek Harness", activate: true })
screenshot({ target: "screen" })
screenshot({ target: "url", url: "http://127.0.0.1:62714", width: 1440, height: 900 })
screenshot({ target: "active", region: { x: 0, y: 0, width: 800, height: 600 } })
list_windows({})
```

ウィンドウのキャプチャは画面上の矩形を切り出す方式です（Electron/Chromium では `PrintWindow` が真っ黒になるため）。対象ウィンドウは可視である必要があり、真っ黒の場合は `SCREENSHOT_BLACK` を返します（成功として扱いません）。

## 依存関係

- Windows 10/11 と DSH Desktop（`0.2.2-rc.3` で検証）。
- Python 3.12＋Pillow は DSH 同梱（自動検出）。
- Obscura。正確なビューポートが必要なときは Chrome、なければ Edge。
- Node 24 と pnpm 11 は DSH 同梱のものを使う（グローバルのツールチェーンは使わない）。

## テスト

```powershell
node test/unit.test.mjs     # DSH 不要
node test/capture.test.mjs  # 実際に撮影（デスクトップセッションが必要）
```

`node --test` は使わないでください（サンドボックスでパイプが制限され EPERM になります）。

## プライバシー

画面にはパスワードや私信、API キーが写り得ます。キャプチャは通常の画像リクエストとしてモデル提供元へ送信されます。全画面ではなくウィンドウ単位で撮ってください。

## ライセンス

[MIT](LICENSE) © 2026 FredgeoO。Obscura のバイナリは同梱せず、必要時に上流から取得します（Apache-2.0、本プロジェクトとは別扱い）。
