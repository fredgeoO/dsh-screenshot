import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { __internals } from '../index.js'

const { resolveConfig, resolvePython, captureDesktop, captureUrl } = __internals
const WINDOWS = process.platform === 'win32'

async function runJson(executable, args, timeoutMs = 30000) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-shot-test-result-'))
  const resultPath = join(directory, 'result.json')
  try {
    const child = spawn(executable, [args[0], '--result', resultPath, ...args.slice(1)], { windowsHide: true, stdio: 'ignore' })
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error(`timed out after ${timeoutMs} ms`))
      }, timeoutMs)
      child.on('error', error => {
        clearTimeout(timer)
        reject(error)
      })
      child.on('close', exitCode => {
        clearTimeout(timer)
        resolve(exitCode)
      })
    })
    const text = await readFile(resultPath, 'utf8').catch(() => '')
    try {
      const parsed = JSON.parse(text)
      if (parsed.ok) return parsed.value
      throw new Error(`${parsed.error?.code}: ${parsed.error?.message}`)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('SCREENSHOT_')) throw error
      throw new Error(`bad result (exit ${code}) at ${resultPath}: ${text.slice(0, 400)}`)
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('capture.py lists visible windows', { skip: !WINDOWS, timeout: 30000 }, async () => {
  const python = resolvePython(resolveConfig({}))
  const script = fileURLToPath(new URL('../scripts/capture.py', import.meta.url))
  const value = await runJson(python, [script, 'list'])
  assert.ok(Array.isArray(value.windows))
  for (const window of value.windows) {
    assert.equal(typeof window.title, 'string')
    assert.equal(typeof window.pid, 'number')
    assert.equal(typeof window.rect.width, 'number')
    assert.equal(typeof window.foreground, 'boolean')
  }
})

test('capture.py captures the screen and crops it', { skip: !WINDOWS, timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-shot-screen-'))
  try {
    const python = resolvePython(resolveConfig({}))
    const scriptPath = fileURLToPath(new URL('../scripts/capture.py', import.meta.url))
    const full = join(directory, 'screen.png')
    const cropped = join(directory, 'crop.png')

    const screen = await runJson(python, [scriptPath, 'screen', '--out', full, '--max-edge', '1280'])
    assert.ok(existsSync(full))
    assert.ok(screen.width > 0 && screen.height > 0)
    assert.ok(Math.max(screen.width, screen.height) <= 1280)

    const crop = await runJson(python, [
      scriptPath, 'crop', '--in', full, '--out', cropped, '--region', '10,10,100,80',
    ])
    assert.equal(crop.width, 100)
    assert.equal(crop.height, 80)
    assert.ok(screen.width >= 110 && screen.height >= 90)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('captureDesktop writes a PNG through the plugin orchestration', { skip: !WINDOWS, timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-shot-desktop-'))
  try {
    const config = resolveConfig({ outputDir: directory, maxEdge: 1280 })
    const output = join(directory, 'screen.png')
    const value = await captureDesktop(config, { target: 'screen' }, output, undefined)
    assert.equal(value.kind, 'screen')
    assert.ok(existsSync(value.path))
    assert.ok(value.width > 0 && value.height > 0)
    assert.equal(value.scale, 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('captureUrl uses Obscura by default and Chrome for an explicit viewport', { skip: !WINDOWS, timeout: 90000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-shot-url-'))
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><html><body style="margin:0;background:#123456;color:#fff;font:48px sans-serif">DSH screenshot</body></html>')
  })
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    const config = resolveConfig({ outputDir: directory, urlWaitMs: 1500, urlTimeoutMs: 60000 })
    const pageUrl = `http://127.0.0.1:${port}/`

    const obscuraOutput = join(directory, 'obscura.png')
    const obscura = await captureUrl(config, {
      target: 'url',
      url: pageUrl,
      waitMs: 1500,
    }, obscuraOutput, undefined)
    assert.equal(obscura.kind, 'url')
    assert.ok(existsSync(obscura.path))
    assert.equal(basename(obscura.browser).toLowerCase(), 'obscura.exe')
    assert.equal(obscura.width, 1280)
    assert.equal(obscura.height, 720)

    const chromeOutput = join(directory, 'chrome.png')
    const chrome = await captureUrl(config, {
      target: 'url',
      url: pageUrl,
      width: 400,
      height: 300,
      scale: 1,
      waitMs: 1500,
    }, chromeOutput, undefined)
    assert.equal(chrome.kind, 'url')
    assert.ok(existsSync(chrome.path))
    assert.equal(basename(chrome.browser).toLowerCase(), 'chrome.exe')
    assert.ok(chrome.width > 0 && chrome.height > 0)

    for (const file of [obscura.path, chrome.path]) {
      const bytes = await readFile(file)
      assert.deepEqual([...bytes.subarray(1, 4)], [0x50, 0x4e, 0x47])
    }
  } finally {
    await new Promise(resolve => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
})
