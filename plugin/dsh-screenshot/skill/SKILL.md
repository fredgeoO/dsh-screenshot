# ui-visual-check：先看见，再改，再复看

> 这个 skill 依赖 `screenshot` 与 `list_windows` 两个工具。截图是证据，不是装饰：
> 没有截图的“UI 已经好了”不算验收。

## 什么时候用

- 用户要求看界面、截图、对比改前改后、做视觉验收、核对布局/间距/颜色。
- 你改的是 UI 代码（DSH 的 Web GUI、客户端插件面板、HTML/CSS、Electron 窗口），且结果“看起来对不对”会影响结论。
- 需要把截图里的像素坐标映射回屏幕坐标，或者判断某个控件是否真的出现。

不需要用时：纯后端逻辑、单行文案、用户明确说不要截图、或截图会暴露与任务无关的敏感内容。

## 核心循环

1. **先说清要看什么**：哪个窗口/页面、哪个状态、改前还是改后。
2. **截改前**：`screenshot`，`inline:true` 让图片直接进上下文；记录可见事实（标题、按钮文案、布局、颜色、溢出、错位）。
3. **改代码**：按需要刷新/HMR；不要在没有新截图的情况下声称视觉已修复。
4. **截改后**：**同样的 target、窗口、视口宽高、scale、主题、滚动位置**。条件不同就不是对比。
5. **给结论**：逐条说“改前是什么、改后是什么、是否达到预期”；有残留问题就直说。

## 选哪个 target

| 场景 | target | 说明 |
|---|---|---|
| 用户正在看的窗口 | `active` | 最省事，截前台窗口；先确认前台确实是目标 |
| 知道窗口标题 | `window` | 先 `list_windows` 找标题；必要时 `activate:true` 置前 |
| 需要整个桌面/多窗口 | `screen` | 包含无关窗口，隐私风险最高，尽量不用 |
| Web UI / 本地页面 | `url` | 默认 Obscura（固定 1280×720、低内存、启动快）；传 `width`/`height`/`scale` 时才用 headless Chrome，适合可重复的视口对比 |

窗口截图是从**屏幕上的矩形**裁剪的：目标被遮挡、最小化、移出屏幕都会导致错误或截到别的窗口。`list_windows` 的 `foreground` / `minimized` / `rect` 先用起来。

## 图片怎么进上下文

- `inline:true`（默认）：工具内部把 PNG 存成 attachment 并返回 image 内容块；当前路由必须声明 `image` 输入。
- 如果报 `SCREENSHOT_UNSUPPORTED_MODEL`：换成支持图像的模型路由（例如本机的 `ninfer/qwen3.8-27b-vision-256k` 或 `strata/...vision-256k`），或者用 `inline:false` 只保存文件，之后再 `read_image`。
- `inline:false`：只返回路径和元数据，适合连续截多张、先不占上下文；最后对关键一张调用 `read_image`。
- 一张截图会留在会话里，后续每轮请求都可能重复携带。**每一步最多一张全图**；细节用 `region` 裁剪，不要连续截 4K 全屏。

## 坐标与 DPI

- 截图像素 ≠ 屏幕坐标，除非你知道 `origin` 和 `scale`。
- 工具返回：
  - `origin`：截图左上角在屏幕/窗口中的坐标；
  - `scale`：URL 截图的 device scale factor（桌面截图为 1）；
  - `region` 裁剪后 `origin` 会平移到裁剪起点。
- 换算：`screen_x = origin.x + image_x / scale`，`screen_y = origin.y + image_y / scale`。
- 多显示器可能出现负坐标；以 `origin` 为准，不要假设 (0,0) 是屏幕左上角。
- 不要凭截图猜 DPI 或窗口边框；需要精确点击/对齐时，先截一张带 `origin` 的窗口图，再用返回的矩形核对。

## DSH 场景注意

- 当前 GUI 地址在 `$env:DSH_WEB_URL`（本机通常是 `http://127.0.0.1:62714`）。`target:"url"` 用 headless 浏览器打开的是**新会话**，可能没有当前登录态/当前会话上下文；如果截到空白或登录页，退回 `active` 截当前 Electron 窗口，或让用户提供带会话的 URL。
- `url` 默认走 Obscura（固定 1280×720，低内存）；需要和改前严格同视口时，显式传 `width`/`height`/`scale`，工具会自动改用 Chrome。Obscura 失败会自动回退 Chrome，结果里的 `warnings` 会说明。
- 客户端插件改动只有在 `pnpm run dev:web` 正在构建、且页面已刷新时才会出现；否则截到的是旧 bundle。先确认 watcher，再截。
- 宿主插件/服务端改动可能需要重启 DSH；重启会结束当前会话，先和用户确认。
- 截当前 DSH 窗口时，截图里会包含本次对话本身——这是正常的；但不要把与任务无关的私信、密钥、密码管理器窗口截进来。

## 失败时怎么办

| 现象 | 处理 |
|---|---|
| `SCREENSHOT_WINDOW_NOT_FOUND` | `list_windows` 看真实标题；用更短、更稳定的子串 |
| `SCREENSHOT_WINDOW_MINIMIZED` | 让用户恢复，或 `activate:true` |
| `SCREENSHOT_BLACK` | 窗口被遮挡/最小化/DRM；`activate:true`、切到 `screen`，或让用户置前 |
| `SCREENSHOT_OFFSCREEN` | 窗口在屏幕外；移动/恢复窗口，或截 `screen` |
| `SCREENSHOT_REGION_OUT_OF_BOUNDS` | 先截全图看尺寸，再改 region |
| `SCREENSHOT_URL_FAILED` / 空白 | 页面加载慢 → 增大 `waitMs`；登录态 → 退回窗口截图；Obscura 失败会自动回退 Chrome，看 `warnings`；浏览器缺失 → 报路径 |
| `SCREENSHOT_PYTHON_MISSING` | 检查插件配置 `pythonPath`；不要改用 Windows Store 的 `python.exe` |
| `SCREENSHOT_BROWSER_MISSING` | 配置 `obscuraPath`/`browserPath`，或用 `active`/`window` |
| 文本模型 | 换视觉路由，或 `inline:false` + 后续 `read_image` |

## 隐私边界

- 优先截**应用窗口**，不要默认全屏。
- 不截密码管理器、私信、API key、身份证件等与任务无关的内容。
- 截图会随正常图像请求发送给模型提供方；用户没有要求时，不要为了“看看”而截敏感窗口。
- 只保留必要的截图；工具会按保留策略清理自己的文件，但不要主动把截图复制进仓库。

## 交付前检查清单

- [ ] 改前、改后各有一张同条件截图（或明确说明无法改前）。
- [ ] 截图里能看到用户关心的元素/状态，而不是空白或遮挡。
- [ ] 结论逐条对应截图中的可见事实。
- [ ] 没有把“代码通过”当成“视觉通过”。
- [ ] 截图/输出路径没有泄密，临时文件没有进 git。
