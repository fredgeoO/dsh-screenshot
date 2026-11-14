// Host half of @local/dsh-screenshot.
//
// One plugin, two model-facing tools and one runtime skill:
//   screenshot   captures the foreground window, a named window, the desktop,
//                or an http(s) page, and optionally returns the image itself
//   list_windows discovers visible window titles for the `window` target
//   ui-visual-check teaches the before/after visual verification loop
//
// The Windows capture details live in scripts/capture.py (Pillow + Win32).
// This file owns argument validation, browser capture, attachment routing,
// retention, and the skill registration.

import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, unlink } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const name = 'screenshot'
export const inject = ['tools']

const HERE = dirname(fileURLToPath(import.meta.url))
const CAPTURE_SCRIPT = join(HERE, 'scripts', 'capture.py')
const SKILL_FILE = join(HERE, 'skill', 'SKILL.md')
const SKILL_NAME = 'ui-visual-check'
const SKILL_DESCRIPTION = 'UI/视觉任务的截图与验收流程：用 screenshot 截当前窗口、指定窗口、全屏或 http(s) 页面，先看截图再改代码，改后用同样的 target/视口/缩放再截一次对比；含窗口选择、坐标/DPI 换算、图片预算、隐私与文本模型回退。用户说「截图」「看看界面」「UI 调一下」「前后对比」「视觉验收」时加载。'
const SKILL_WHEN_TO_USE = '任何需要“看见”界面再判断的任务：UI 改动、样式对比、布局验收、截图核对、像素坐标确认。'

const DEFAULTS = {
  maxEdge: 2560,
  inline: true,
  retentionDays: 7,
  maxFiles: 200,
  urlWaitMs: 4000,
  timeoutMs: 30000,
  urlTimeoutMs: 45000,
}

const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

// Raw tool definitions are validated as plain JSON Schema (unlike defineTool's
// parameter DSL), so required members use the standard object-level array.
const WINDOW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'pid', 'process', 'rect', 'foreground', 'minimized'],
  properties: {
    title: { type: 'string' },
    pid: { type: 'integer' },
    process: { type: 'string' },
    rect: {
      type: 'object',
      additionalProperties: false,
      required: ['x', 'y', 'width', 'height'],
      properties: {
        x: { type: 'integer' },
        y: { type: 'integer' },
        width: { type: 'integer' },
        height: { type: 'integer' },
      },
    },
    foreground: { type: 'boolean' },
    minimized: { type: 'boolean' },
  },
}

const SCREENSHOT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['path', 'kind', 'width', 'height', 'bytes', 'origin', 'scale', 'capturedAt'],
  properties: {
    path: { type: 'string' },
    kind: { type: 'string', enum: ['active', 'screen', 'window', 'url'] },
    width: { type: 'integer' },
    height: { type: 'integer' },
    bytes: { type: 'integer' },
    origin: {
      type: 'object',
      additionalProperties: false,
      required: ['x', 'y'],
      properties: {
        x: { type: 'integer' },
        y: { type: 'integer' },
      },
    },
    scale: { type: 'number' },
    capturedAt: { type: 'string' },
    sourceWidth: { type: 'integer' },
    sourceHeight: { type: 'integer' },
    window: WINDOW_SCHEMA,
    url: { type: 'string' },
    browser: { type: 'string' },
    warnings: { type: 'array', items: { type: 'string' } },
    image: {
      type: 'object',
      additionalProperties: false,
      required: ['attachmentId', 'mediaType', 'bytes', 'width', 'height'],
      properties: {
        attachmentId: { type: 'string' },
        mediaType: { type: 'string', enum: IMAGE_MEDIA_TYPES },
        bytes: { type: 'integer' },
        width: { type: 'integer' },
        height: { type: 'integer' },
        name: { type: 'string' },
        originalDimensions: {
          type: 'object',
          additionalProperties: false,
          required: ['width', 'height'],
          properties: {
            width: { type: 'integer' },
            height: { type: 'integer' },
          },
        },
      },
    },
  },
}

/**
 * Register the tools and the runtime skill.
 * @param ctx - Cordis plugin context.
 * @param config - the row config from cordis.patch.yml.
 */
export function apply(ctx, config = {}) {
  const resolved = resolveConfig(config)
  ctx.effect(() => ctx.tools.register(createScreenshotTool(ctx, resolved)))
  ctx.effect(() => ctx.tools.register(createListWindowsTool(ctx, resolved)))

  // The tool is useful without the skill service; register the workflow only
  // when skills are composed, and let disposal follow the service lifetime.
  ctx.inject(['skills'], (inner) => {
    inner.effect(() => inner.skills.register({
      name: SKILL_NAME,
      description: SKILL_DESCRIPTION,
      whenToUse: SKILL_WHEN_TO_USE,
      source: 'runtime',
      content: readFileSync(SKILL_FILE, 'utf8'),
      resourceBase: { kind: 'directory', path: HERE },
    }))
  })
}

function createScreenshotTool(ctx, config) {
  return {
    name: 'screenshot',
    description: [
      'Capture a screenshot of the foreground window, a named window, the whole desktop, or an http(s) page.',
      'Returns the PNG path plus dimensions/origin/scale, and the image itself when the current model route declares image input.',
      'Windows are captured from their on-screen rectangle, so the target must be visible and unobstructed; set activate=true to raise it first. Use list_windows to discover titles, and prefer target="active" for the window the user is looking at.',
      'URL pages use Obscura by default (fixed 1280x720, low memory); pass width/height/scale to force headless Chrome for an exact viewport.',
      'Screenshots may contain sensitive content. Capture the narrowest target that answers the question.',
    ].join('\n'),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['target'],
      properties: {
        target: {
          type: 'string',
          enum: ['active', 'screen', 'window', 'url'],
          description: 'active = foreground window; screen = whole virtual desktop; window = title match; url = headless browser page.',
        },
        window: { type: 'string', description: 'Window title (exact or substring). Required for target="window".' },
        url: { type: 'string', description: 'http(s) page URL. Required for target="url".' },
        region: {
          type: 'object',
          additionalProperties: false,
          required: ['x', 'y', 'width', 'height'],
          properties: {
            x: { type: 'integer', description: 'Crop origin X in captured-image pixels.' },
            y: { type: 'integer', description: 'Crop origin Y in captured-image pixels.' },
            width: { type: 'integer', description: 'Crop width in pixels.' },
            height: { type: 'integer', description: 'Crop height in pixels.' },
          },
        },
        inline: { type: 'boolean', description: 'Return the image itself (default true). false returns only the file path.' },
        activate: { type: 'boolean', description: 'Raise a window target to the foreground before capture. Default false.' },
        width: { type: 'integer', description: 'URL viewport width; default 1440.' },
        height: { type: 'integer', description: 'URL viewport height; default 900.' },
        scale: { type: 'number', description: 'URL device scale factor; default 1.' },
        waitMs: { type: 'integer', description: 'URL virtual-time wait budget in milliseconds; default 4000.' },
        label: { type: 'string', description: 'Optional filename label, sanitized to [a-z0-9-].' },
      },
    },
    output: {
      schema: SCREENSHOT_VALUE_SCHEMA,
      render: (_args, value) => renderScreenshot(value),
    },
    timeoutMs: config.urlTimeoutMs + 15000,
    isConcurrencySafe: () => false,
    presentCall(args) {
      const target = String(args?.target ?? 'screenshot')
      const title = target === 'window' && args?.window ? `Screenshot window ${args.window}`
        : target === 'url' && args?.url ? `Screenshot ${args.url}`
          : `Screenshot ${target}`
      return { card: 'generic', title, kind: 'read', rawInput: args ?? {} }
    },
    async execute(args, exec) {
      return captureScreenshot(ctx, config, args, exec)
    },
  }
}

function createListWindowsTool(ctx, config) {
  return {
    name: 'list_windows',
    description: [
      'List visible top-level windows with title, process, screen rectangle, and whether the window is foreground or minimized.',
      'Use it to choose the window title for screenshot({target:"window"}). The list is read-only and does not capture the screen.',
    ].join('\n'),
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['windows'],
        properties: {
          windows: { type: 'array', items: WINDOW_SCHEMA },
        },
      },
      render: (_args, value) => renderWindowList(value),
    },
    timeoutMs: config.timeoutMs,
    isConcurrencySafe: () => true,
    presentCall: args => ({ card: 'generic', title: 'List windows', kind: 'read', rawInput: args ?? {} }),
    async execute(args, exec) {
      const python = resolvePython(config)
      const value = await runJson(python, [CAPTURE_SCRIPT, 'list'], config.timeoutMs, exec.signal)
      return { windows: Array.isArray(value?.windows) ? value.windows : [] }
    },
  }
}

async function captureScreenshot(ctx, config, args, exec) {
  validateArgs(args)
  await mkdir(config.outputDir, { recursive: true })

  const outputPath = join(config.outputDir, fileName(args))
  const inline = args.inline ?? config.inline

  let value
  if (args.target === 'url') {
    value = await captureUrl(config, args, outputPath, exec.signal)
    if (args.region !== undefined) value = await cropUrl(config, args.region, value, exec.signal)
  } else {
    value = await captureDesktop(config, args, outputPath, exec.signal)
  }

  if (inline) value.image = await saveInline(ctx, exec, value.path, config)
  await prune(config).catch(() => undefined)
  return value
}

async function captureDesktop(config, args, outputPath, signal) {
  const python = resolvePython(config)
  const command = [CAPTURE_SCRIPT, args.target]
  if (args.target === 'window') command.push('--title', args.window.trim())
  command.push('--out', outputPath, '--max-edge', String(config.maxEdge))
  if (args.region !== undefined) command.push('--region', regionArgument(args.region))
  if (args.target === 'window' && args.activate === true) command.push('--activate')
  const value = await runJson(python, command, config.timeoutMs, signal)
  return normalizeValue(value)
}

async function captureUrl(config, args, outputPath, signal) {
  const backend = chooseUrlBackend(config, args)
  const url = validateUrl(args.url)

  if (backend.kind === 'obscura') {
    try {
      return await captureUrlObscura(config, args, url, outputPath, backend.path, signal)
    } catch (error) {
      // An auto-detected Obscura should not make URL capture worse than Chrome.
      const fallback = backend.explicit ? undefined : findChromium(config)
      if (fallback === undefined) throw error
      const value = await captureUrlChromium(config, args, url, outputPath, fallback, signal)
      value.warnings = [
        ...value.warnings ?? [],
        `Obscura failed (${error.message}) Fell back to ${basename(fallback)}.`,
      ]
      return value
    }
  }
  return captureUrlChromium(config, args, url, outputPath, backend.path, signal)
}

async function captureUrlObscura(config, args, url, outputPath, obscura, signal) {
  // Obscura's fetch screenshot uses a fixed 1280x720 viewport and blocks
  // loopback by default; the local dev/UI case needs --allow-private-network.
  const timeoutSeconds = Math.max(1, Math.ceil(config.urlTimeoutMs / 1000))
  const command = [
    obscura,
    '--allow-private-network',
    'fetch', url,
    '--screenshot', outputPath,
    '--quiet',
    '--timeout', String(timeoutSeconds),
  ]
  if (args.waitMs !== undefined) {
    // Obscura's --wait is whole seconds; round a millisecond budget up.
    command.push('--wait', String(Math.max(1, Math.ceil(args.waitMs / 1000))))
  }
  // runBrowser takes the executable separately; command[0] is only for diagnostics.
  const outcome = await runBrowser(obscura, command.slice(1), config.urlTimeoutMs + 5000, signal)
  if (!existsSync(outputPath)) {
    throw new Error(`SCREENSHOT_URL_FAILED: Obscura exited ${outcome.code} without writing ${outputPath}. Check the URL, waitMs, or config.obscuraPath.`)
  }
  const info = await stat(outputPath)
  const dimensions = await pngDimensions(outputPath)
  const warnings = []
  if (args.width !== undefined || args.height !== undefined || args.scale !== undefined) {
    warnings.push('Obscura renders a fixed 1280x720 viewport; width/height/scale were ignored (use config.browserPath=Chrome for an exact viewport).')
  }
  return {
    path: outputPath,
    kind: 'url',
    width: dimensions.width,
    height: dimensions.height,
    bytes: info.size,
    origin: { x: 0, y: 0 },
    scale: 1,
    capturedAt: isoNow(),
    url,
    browser: obscura,
    ...warnings.length === 0 ? {} : { warnings },
  }
}

async function captureUrlChromium(config, args, url, outputPath, browser, signal) {
  const width = clampInteger(args.width, 200, 7680, 1440)
  const height = clampInteger(args.height, 200, 4320, 900)
  const scale = clampNumber(args.scale, 0.25, 4, 1)
  const waitMs = clampInteger(args.waitMs, 250, 60000, config.urlWaitMs)
  const profileDir = await mkdtemp(join(tmpdir(), 'dsh-screenshot-'))

  const browserArgs = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    `--user-data-dir=${join(profileDir, 'profile')}`,
    `--window-size=${width},${height}`,
    `--force-device-scale-factor=${scale}`,
    `--virtual-time-budget=${waitMs}`,
    '--run-all-compositor-stages-before-draw',
    `--screenshot=${outputPath}`,
    url,
  ]

  try {
    let outcome = await runBrowser(browser, browserArgs, config.urlTimeoutMs, signal)
    if (!existsSync(outputPath) && outcome.code !== 0) {
      // Older Chromium builds reject --headless=new; retry with the legacy switch.
      const legacy = browserArgs.map(argument => argument === '--headless=new' ? '--headless' : argument)
      outcome = await runBrowser(browser, legacy, config.urlTimeoutMs, signal)
    }
    if (!existsSync(outputPath)) {
      throw new Error(`SCREENSHOT_URL_FAILED: the browser exited ${outcome.code} without writing ${outputPath}. Check the URL, waitMs, or config.browserPath.`)
    }
  } finally {
    await rm(profileDir, { recursive: true, force: true }).catch(() => undefined)
  }

  const info = await stat(outputPath)
  const dimensions = await pngDimensions(outputPath)
  return {
    path: outputPath,
    kind: 'url',
    width: dimensions.width,
    height: dimensions.height,
    bytes: info.size,
    origin: { x: 0, y: 0 },
    scale,
    capturedAt: isoNow(),
    url,
    browser,
  }
}

async function cropUrl(config, region, value, signal) {
  const normalized = validateRegion(region)
  const source = value.path
  const target = source.replace(/\.png$/iu, '') + '-crop.png'
  const python = resolvePython(config)
  const result = await runJson(python, [
    CAPTURE_SCRIPT, 'crop',
    '--in', source,
    '--out', target,
    '--region', regionArgument(normalized),
  ], config.timeoutMs, signal)
  await rm(source, { force: true }).catch(() => undefined)
  return {
    ...value,
    path: target,
    width: result.width,
    height: result.height,
    bytes: result.bytes,
    origin: { x: normalized.x, y: normalized.y },
  }
}

async function saveInline(ctx, exec, file, config) {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) {
    throw new Error('SCREENSHOT_ATTACHMENTS_UNAVAILABLE: no attachment service is mounted; pass inline:false to keep only the file path.')
  }
  const agent = exec.agent
  const llm = ctx.get('llm')
  if (agent === undefined || llm === undefined) {
    throw new Error('SCREENSHOT_ROUTE_UNAVAILABLE: the calling model route could not be resolved; pass inline:false to keep only the file path.')
  }
  const header = agent.session.requestHeader()?.config
  const provider = header?.provider ?? agent.options.provider
  const model = header?.model ?? agent.options.model
  if (provider === undefined || model === undefined) {
    throw new Error('SCREENSHOT_ROUTE_UNAVAILABLE: the calling model route has no provider/model; pass inline:false to keep only the file path.')
  }
  const info = await llm.resolveModelInfo(provider, model, exec.signal)
  if (info.inputModalities === undefined || !info.inputModalities.includes('image')) {
    throw new Error(`SCREENSHOT_UNSUPPORTED_MODEL: model "${model}" does not declare image input; switch to an image-capable route or pass inline:false.`)
  }

  let bytes = await readFile(file)
  try {
    return plainRef(await attachments.saveImage({ data: bytes, mediaType: 'image/png', name: basename(file) }))
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
    if (!/^(IMAGE_|ATTACHMENT_)/u.test(code)) throw error
    const smaller = file.replace(/\.png$/iu, '') + '-small.png'
    const python = resolvePython(config)
    await runJson(python, [
      CAPTURE_SCRIPT, 'shrink',
      '--in', file,
      '--out', smaller,
      '--max-edge', String(Math.min(1600, config.maxEdge)),
    ], config.timeoutMs, exec.signal)
    bytes = await readFile(smaller)
    return plainRef(await attachments.saveImage({ data: bytes, mediaType: 'image/png', name: basename(smaller) }))
  }
}

function plainRef(ref) {
  return {
    attachmentId: String(ref.attachmentId),
    mediaType: ref.mediaType,
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
    ...ref.name === undefined ? {} : { name: ref.name },
    ...ref.originalDimensions === undefined ? {} : { originalDimensions: { ...ref.originalDimensions } },
  }
}

function normalizeValue(value) {
  return {
    path: value.path,
    kind: value.kind,
    width: value.width,
    height: value.height,
    bytes: value.bytes,
    origin: value.origin ?? { x: 0, y: 0 },
    scale: value.scale ?? 1,
    capturedAt: value.capturedAt ?? isoNow(),
    ...value.sourceWidth === undefined ? {} : { sourceWidth: value.sourceWidth },
    ...value.sourceHeight === undefined ? {} : { sourceHeight: value.sourceHeight },
    ...value.window === undefined ? {} : { window: value.window },
    ...value.url === undefined ? {} : { url: value.url },
    ...value.warnings === undefined || value.warnings.length === 0 ? {} : { warnings: value.warnings },
  }
}

function renderScreenshot(value) {
  const subject = value.kind === 'url'
    ? `url ${value.url ?? ''}`.trim()
    : value.window
      ? `${value.kind === 'window' ? '' : `${value.kind} `}window "${value.window.title}"`
      : value.kind
  const lines = [
    `<path>${value.path}</path>`,
    '<type>screenshot</type>',
    '<content>',
    `${subject}: ${value.width}x${value.height} px, ${value.bytes} bytes, origin (${value.origin.x},${value.origin.y}), scale ${value.scale}.`,
  ]
  if (value.sourceWidth !== undefined && (value.sourceWidth !== value.width || value.sourceHeight !== value.height)) {
    lines.push(`Downscaled from ${value.sourceWidth}x${value.sourceHeight} px.`)
  }
  if (value.browser !== undefined) {
    lines.push(`Browser: ${value.browser}.`)
  }
  if (value.window !== undefined) {
    lines.push(`Window: ${value.window.title} (pid ${value.window.pid}, ${value.window.process}), ${value.window.foreground ? 'foreground' : 'not foreground'}${value.window.minimized ? ', minimized' : ''}.`)
  }
  if (value.warnings !== undefined && value.warnings.length > 0) {
    lines.push(`Warnings: ${value.warnings.join('; ')}.`)
  }
  if (value.image === undefined) {
    lines.push('The image is not attached to this result. Call read_image on the path above with an image-capable model, or retry with inline:true.')
  }
  lines.push('</content>')
  const blocks = [{ type: 'text', text: lines.join('\n') }]
  if (value.image !== undefined) {
    blocks.push({
      type: 'image',
      attachment: {
        attachmentId: value.image.attachmentId,
        mediaType: value.image.mediaType,
        bytes: value.image.bytes,
        width: value.image.width,
        height: value.image.height,
        ...value.image.name === undefined ? {} : { name: value.image.name },
        ...value.image.originalDimensions === undefined ? {} : {
          originalDimensions: { ...value.image.originalDimensions },
        },
      },
    })
  }
  return blocks
}

function renderWindowList(value) {
  const windows = Array.isArray(value?.windows) ? value.windows : []
  if (windows.length === 0) return [{ type: 'text', text: 'No visible top-level windows were found.' }]
  const lines = windows.map(window => {
    const flags = [
      window.foreground ? 'foreground' : '',
      window.minimized ? 'minimized' : '',
    ].filter(Boolean).join(', ')
    return `${window.title} | pid ${window.pid} ${window.process} | ${window.rect.x},${window.rect.y} ${window.rect.width}x${window.rect.height}${flags === '' ? '' : ` | ${flags}`}`
  })
  return [{ type: 'text', text: lines.join('\n') }]
}

function validateArgs(args) {
  const target = args?.target
  if (!['active', 'screen', 'window', 'url'].includes(target)) {
    throw new Error('SCREENSHOT_ARGS: target must be one of active, screen, window, url.')
  }
  if (target === 'window' && (typeof args.window !== 'string' || args.window.trim() === '')) {
    throw new Error('SCREENSHOT_ARGS: window is required for target="window".')
  }
  if (target === 'url') {
    validateUrl(args.url)
    if (args.window !== undefined) {
      throw new Error('SCREENSHOT_ARGS: window is not accepted for target="url".')
    }
  }
  if (target !== 'url' && args.url !== undefined) {
    throw new Error('SCREENSHOT_ARGS: url is only accepted for target="url".')
  }
  if (args.region !== undefined) validateRegion(args.region)
  if (args.label !== undefined && typeof args.label !== 'string') {
    throw new Error('SCREENSHOT_ARGS: label must be a string.')
  }
}

function validateUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('SCREENSHOT_ARGS: url is required for target="url".')
  }
  if (value.length > 2048) throw new Error('SCREENSHOT_ARGS: url is too long.')
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`SCREENSHOT_ARGS: url is not a valid URL: ${value}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`SCREENSHOT_ARGS: url must use http or https, got ${parsed.protocol}`)
  }
  return parsed.toString()
}

function validateRegion(value) {
  const fields = ['x', 'y', 'width', 'height']
  if (typeof value !== 'object' || value === null) throw new Error('SCREENSHOT_ARGS: region must be an object.')
  const normalized = {}
  for (const field of fields) {
    const number = value[field]
    if (!Number.isInteger(number)) throw new Error(`SCREENSHOT_ARGS: region.${field} must be an integer.`)
    normalized[field] = number
  }
  if (normalized.width <= 0 || normalized.height <= 0) {
    throw new Error('SCREENSHOT_ARGS: region width and height must be positive.')
  }
  if (normalized.x < 0 || normalized.y < 0) {
    throw new Error('SCREENSHOT_ARGS: region x and y must be non-negative.')
  }
  return normalized
}

function regionArgument(region) {
  const normalized = validateRegion(region)
  return `${normalized.x},${normalized.y},${normalized.width},${normalized.height}`
}

function resolveConfig(config) {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  return {
    dshHome,
    outputDir: typeof config.outputDir === 'string' && config.outputDir.trim() !== ''
      ? resolve(config.outputDir)
      : join(dshHome, 'cache', 'screenshots'),
    pythonPath: typeof config.pythonPath === 'string' ? config.pythonPath : '',
    browserPath: typeof config.browserPath === 'string' ? config.browserPath : '',
    obscuraPath: typeof config.obscuraPath === 'string' ? config.obscuraPath : '',
    maxEdge: clampInteger(config.maxEdge, 256, 8192, DEFAULTS.maxEdge),
    inline: config.inline !== false,
    retentionDays: clampInteger(config.retentionDays, 0, 3650, DEFAULTS.retentionDays),
    maxFiles: clampInteger(config.maxFiles, 1, 10000, DEFAULTS.maxFiles),
    urlWaitMs: clampInteger(config.urlWaitMs, 250, 60000, DEFAULTS.urlWaitMs),
    timeoutMs: clampInteger(config.timeoutMs, 5000, 120000, DEFAULTS.timeoutMs),
    urlTimeoutMs: clampInteger(config.urlTimeoutMs, 5000, 180000, DEFAULTS.urlTimeoutMs),
  }
}

let cachedPython
function resolvePython(config) {
  if (typeof config.pythonPath === 'string' && config.pythonPath.trim() !== '') {
    if (!existsSync(config.pythonPath)) {
      throw new Error(`SCREENSHOT_PYTHON_MISSING: configured pythonPath does not exist: ${config.pythonPath}`)
    }
    return config.pythonPath
  }
  if (cachedPython !== undefined) return cachedPython
  const runtimes = join(config.dshHome, 'dsh-runtimes')
  const candidates = []
  try {
    for (const entry of readdirSync(runtimes)) {
      candidates.push(join(runtimes, entry, 'dependencies', 'python', 'python.exe'))
    }
  } catch {
    // The deterministic fallback below produces the useful error.
  }
  candidates.push(join(runtimes, 'dsh-primary-runtime', 'dependencies', 'python', 'python.exe'))
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      cachedPython = candidate
      return candidate
    }
  }
  throw new Error(`SCREENSHOT_PYTHON_MISSING: no bundled Python found under ${runtimes}; set config.pythonPath in the plugin row.`)
}

function chooseUrlBackend(config, args) {
  if (config.browserPath) {
    return { kind: 'chromium', path: resolveChromium(config), explicit: true }
  }
  const obscura = findObscura(config)
  const wantsViewport = args.width !== undefined || args.height !== undefined || args.scale !== undefined
  // Obscura's CLI screenshot is fixed at 1280x720. Use Chrome when the caller
  // asks for an exact viewport, unless the operator explicitly pinned Obscura.
  if (obscura !== undefined && (!wantsViewport || config.obscuraPath)) {
    return { kind: 'obscura', path: obscura, explicit: config.obscuraPath !== '' }
  }
  const chromium = findChromium(config)
  if (chromium !== undefined) return { kind: 'chromium', path: chromium, explicit: false }
  if (obscura !== undefined) return { kind: 'obscura', path: obscura, explicit: config.obscuraPath !== '' }
  throw new Error('SCREENSHOT_BROWSER_MISSING: no Obscura, Chrome, or Edge found; set config.obscuraPath/browserPath or use target="active"/"window".')
}

function findObscura(config) {
  if (config.obscuraPath) {
    if (!existsSync(config.obscuraPath)) {
      throw new Error(`SCREENSHOT_BROWSER_MISSING: configured obscuraPath does not exist: ${config.obscuraPath}`)
    }
    return config.obscuraPath
  }
  if (process.env.OBSCURA_PATH && existsSync(process.env.OBSCURA_PATH)) return process.env.OBSCURA_PATH
  const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
  const candidates = [
    // The workspace-local install made by this plugin's README.
    join(HERE, '..', '..', 'bin', 'obscura', 'obscura.exe'),
    join(HERE, '..', 'bin', 'obscura', 'obscura.exe'),
    join(HERE, 'bin', 'obscura', 'obscura.exe'),
    join(localAppData, 'Programs', 'obscura', 'obscura.exe'),
    join(homedir(), 'scoop', 'apps', 'obscura', 'current', 'obscura.exe'),
  ]
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (directory.trim() !== '') candidates.push(join(directory, 'obscura.exe'))
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function findChromium(config) {
  if (config.browserPath) {
    if (!existsSync(config.browserPath)) {
      throw new Error(`SCREENSHOT_BROWSER_MISSING: configured browserPath does not exist: ${config.browserPath}`)
    }
    return config.browserPath
  }
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
  const candidates = [
    join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function resolveChromium(config) {
  const chromium = findChromium(config)
  if (chromium === undefined) {
    throw new Error('SCREENSHOT_BROWSER_MISSING: no Chrome or Edge found; set config.browserPath or use target="active"/"window".')
  }
  return chromium
}

async function runJson(executable, args, timeoutMs, signal) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-shot-result-'))
  const resultPath = join(directory, 'result.json')
  try {
    // No piped stdio: DSH's Windows sandbox can deny captured child output, and
    // a result file is also easier to diagnose than a truncated JSON stream.
    // args[0] is the capture script; --result belongs to that script, not to
    // the Python executable, so it goes after the script path.
    const command = args.length > 0
      ? [args[0], '--result', resultPath, ...args.slice(1)]
      : ['--result', resultPath]
    const child = spawn(executable, command, { windowsHide: true, stdio: 'ignore' })
    const outcome = await waitForChild(child, timeoutMs, signal, 'capture')
    const text = await readFile(resultPath, 'utf8').catch(() => '')
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error(`SCREENSHOT_BAD_OUTPUT: capture exited ${outcome.code} without a readable result file at ${resultPath}.`)
    }
    if (parsed?.ok === true) return parsed.value
    throw new Error(`${parsed?.error?.code ?? 'SCREENSHOT_FAILED'}: ${parsed?.error?.message ?? 'capture failed'}`)
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function runBrowser(executable, args, timeoutMs, signal) {
  const child = spawn(executable, args, { windowsHide: true, stdio: 'ignore' })
  return waitForChild(child, timeoutMs, signal, 'browser')
}

function waitForChild(child, timeoutMs, signal, label) {
  return new Promise((resolvePromise, rejectPromise) => {
    if (signal?.aborted === true) {
      child.kill()
      rejectPromise(new Error('SCREENSHOT_ABORTED: the calling operation was aborted.'))
      return
    }
    let settled = false
    let timer
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const settle = (run, value) => {
      if (settled) return
      settled = true
      cleanup()
      run(value)
    }
    const onAbort = () => {
      child.kill()
      settle(rejectPromise, new Error('SCREENSHOT_ABORTED: the calling operation was aborted.'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => {
      child.kill()
      settle(rejectPromise, new Error(`SCREENSHOT_TIMEOUT: the ${label} did not finish within ${timeoutMs} ms.`))
    }, timeoutMs)
    child.on('error', error => settle(rejectPromise, new Error(`SCREENSHOT_SPAWN_FAILED: ${error.message}`)))
    child.on('close', code => settle(resolvePromise, { code }))
  })
}

async function pngDimensions(file) {
  const bytes = await readFile(file)
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) {
    throw new Error(`SCREENSHOT_NOT_PNG: the browser wrote something that is not a PNG: ${file}`)
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

async function prune(config) {
  if (config.retentionDays === 0 && config.maxFiles >= 10000) return
  let entries
  try {
    entries = await readdir(config.outputDir, { withFileTypes: true })
  } catch {
    return
  }
  const files = []
  for (const entry of entries) {
    if (!entry.isFile() || !/^screenshot-.*\.png$/iu.test(entry.name)) continue
    const file = join(config.outputDir, entry.name)
    try {
      const info = await stat(file)
      files.push({ file, mtime: info.mtimeMs })
    } catch {
      // A concurrently removed file is already clean.
    }
  }
  files.sort((left, right) => right.mtime - left.mtime)
  const cutoff = config.retentionDays > 0
    ? Date.now() - config.retentionDays * 86_400_000
    : Number.NEGATIVE_INFINITY
  for (let index = 0; index < files.length; index += 1) {
    if (index < config.maxFiles && files[index].mtime >= cutoff) continue
    await unlink(files[index].file).catch(() => undefined)
  }
}

function fileName(args) {
  const label = typeof args.label === 'string'
    ? args.label.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 32)
    : ''
  const stamp = new Date().toISOString().replace(/[-:]/gu, '').replace(/\..*$/u, '').replace('T', '-')
  return `screenshot-${stamp}-${args.target}${label === '' ? '' : `-${label}`}-${randomUUID().slice(0, 8)}.png`
}

function isoNow() {
  return new Date().toISOString()
}

function clampInteger(value, min, max, fallback) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(number)))
}

function clampNumber(value, min, max, fallback) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

// Kept for the workspace regression tests: pure helpers that do not need a
// Cordis context or the Windows capture backend.
export const __internals = {
  resolveConfig,
  validateArgs,
  validateUrl,
  validateRegion,
  renderScreenshot,
  renderWindowList,
  fileName,
  chooseUrlBackend,
  findChromium,
  findObscura,
  resolvePython,
  pngDimensions,
  captureDesktop,
  captureUrl,
}
