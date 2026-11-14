import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { apply, __internals } from '../index.js'

const {
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
} = __internals

test('resolveConfig applies defaults and clamps', () => {
  const config = resolveConfig({})
  assert.match(config.outputDir, /cache[\\/]screenshots$/u)
  assert.equal(config.maxEdge, 2560)
  assert.equal(config.inline, true)
  assert.equal(config.retentionDays, 7)

  const clamped = resolveConfig({ maxEdge: 1, retentionDays: -4, maxFiles: 0, inline: false })
  assert.equal(clamped.maxEdge, 256)
  assert.equal(clamped.retentionDays, 0)
  assert.equal(clamped.maxFiles, 1)
  assert.equal(clamped.inline, false)
})

test('validateArgs enforces the target contract', () => {
  assert.throws(() => validateArgs({}), /target must be one of/u)
  assert.throws(() => validateArgs({ target: 'window' }), /window is required/u)
  assert.throws(() => validateArgs({ target: 'url' }), /url is required/u)
  assert.throws(() => validateArgs({ target: 'url', url: 'file:///tmp/a.html' }), /http or https/u)
  assert.throws(() => validateArgs({ target: 'active', url: 'https://example.com' }), /url is only accepted/u)
  assert.throws(() => validateArgs({ target: 'active', region: { x: 0, y: 0, width: 0, height: 10 } }), /must be positive/u)
  assert.doesNotThrow(() => validateArgs({ target: 'active' }))
  assert.doesNotThrow(() => validateArgs({ target: 'window', window: 'DeepSeek Harness' }))
  assert.doesNotThrow(() => validateArgs({ target: 'url', url: 'http://127.0.0.1:62714' }))
})

test('validateUrl normalizes and restricts protocols', () => {
  assert.equal(validateUrl('http://127.0.0.1:62714'), 'http://127.0.0.1:62714/')
  assert.throws(() => validateUrl('javascript:alert(1)'), /http or https/u)
  assert.throws(() => validateUrl('not a url'), /not a valid URL/u)
})

test('validateRegion returns a plain rectangle', () => {
  assert.deepEqual(validateRegion({ x: 1, y: 2, width: 30, height: 40 }), { x: 1, y: 2, width: 30, height: 40 })
  assert.throws(() => validateRegion({ x: -1, y: 0, width: 3, height: 4 }), /non-negative/u)
})

test('fileName sanitizes the label and keeps a png suffix', () => {
  const name = fileName({ target: 'window', label: 'My UI: Header!' })
  assert.match(name, /^screenshot-\d{8}-\d{6}-window-my-ui-header-[0-9a-f]{8}\.png$/u)
  const fallback = fileName({ target: 'active' })
  assert.match(fallback, /^screenshot-\d{8}-\d{6}-active-[0-9a-f]{8}\.png$/u)
})

test('renderScreenshot returns a text envelope and an optional image block', () => {
  const base = {
    path: 'C:\\shots\\a.png',
    kind: 'window',
    width: 800,
    height: 600,
    bytes: 1234,
    origin: { x: 10, y: 20 },
    scale: 1,
    capturedAt: '2026-11-14T00:00:00Z',
    window: {
      title: 'DeepSeek Harness',
      pid: 1,
      process: 'DeepSeek Harness.exe',
      rect: { x: 10, y: 20, width: 800, height: 600 },
      foreground: true,
      minimized: false,
    },
  }
  const textOnly = renderScreenshot(base)
  assert.equal(textOnly.length, 1)
  assert.match(textOnly[0].text, /<path>C:\\shots\\a\.png<\/path>/u)
  assert.match(textOnly[0].text, /not attached/u)

  const withImage = renderScreenshot({
    ...base,
    image: {
      attachmentId: 'att-1',
      mediaType: 'image/png',
      bytes: 1234,
      width: 800,
      height: 600,
      name: 'a.png',
    },
  })
  assert.equal(withImage.length, 2)
  assert.equal(withImage[1].type, 'image')
  assert.equal(withImage[1].attachment.attachmentId, 'att-1')
  assert.equal(withImage[1].attachment.mediaType, 'image/png')
})

test('renderWindowList is a readable table', () => {
  const blocks = renderWindowList({
    windows: [{
      title: 'DeepSeek Harness', pid: 10, process: 'DeepSeek Harness.exe',
      rect: { x: 1, y: 2, width: 3, height: 4 }, foreground: true, minimized: false,
    }],
  })
  assert.match(blocks[0].text, /DeepSeek Harness \| pid 10/u)
  assert.match(blocks[0].text, /foreground/u)
})

test('apply registers two tools and the runtime skill', () => {
  const tools = []
  const skills = []
  const fake = {
    tools: { register(definition) { tools.push(definition); return () => undefined } },
    effect(fn) { return fn() },
    inject(deps, callback) {
      if (deps.includes('skills')) {
        callback({
          skills: { register(skill) { skills.push(skill); return () => undefined } },
          effect(fn) { return fn() },
        })
      }
    },
    get() { return undefined },
  }
  apply(fake, {})
  assert.deepEqual(tools.map(tool => tool.name), ['screenshot', 'list_windows'])
  assert.equal(skills.length, 1)
  assert.equal(skills[0].name, 'ui-visual-check')
  assert.equal(skills[0].source, 'runtime')
  assert.match(skills[0].content, /ui-visual-check/u)
  assert.deepEqual(skills[0].resourceBase.kind, 'directory')
})

test('pngDimensions reads a real PNG', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-shot-unit-'))
  try {
    const file = join(directory, 'one.png')
    await writeFile(file, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ))
    assert.deepEqual(await pngDimensions(file), { width: 1, height: 1 })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('bundled Python, Obscura, and Chromium are discoverable', () => {
  const config = resolveConfig({})
  const python = resolvePython(config)
  assert.ok(existsSync(python), `python exists: ${python}`)
  const obscura = findObscura(config)
  assert.ok(obscura !== undefined && existsSync(obscura), `obscura exists: ${obscura}`)
  assert.equal(chooseUrlBackend(config, {}).kind, 'obscura')
  const chromium = findChromium(config)
  assert.ok(chromium !== undefined && existsSync(chromium), `chromium exists: ${chromium}`)
  assert.equal(chooseUrlBackend(config, { width: 1440, height: 900 }).kind, 'chromium')
})
