/**
 * Shared headless-Chrome / CDP plumbing for browser-level checks.
 *
 * The browser E2E and the typography check both need a local static server, a
 * headless Chrome process and a tiny CDP client. Keeping that setup here avoids
 * two slightly different copies of the same lifecycle code.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'

/** Default Chrome location on this Mac; override with CHROME_BIN. */
export const chromeBinary = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

/**
 * Check whether the configured Chrome binary exists.
 * @returns whether the browser can be launched.
 */
export async function chromeExists() {
  try {
    await readFile(chromeBinary)
    return true
  } catch {
    return false
  }
}

/**
 * Serve one directory on a random loopback port.
 * @param dir - directory to serve.
 * @returns the URL and a close function.
 */
export async function startStaticServer(dir) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname)
      const path = join(dir, pathname === '/' ? 'index.html' : pathname.slice(1))
      const body = await readFile(path)
      response.writeHead(200, { 'content-type': CONTENT_TYPES[extname(path)] ?? 'application/octet-stream' })
      response.end(body)
    } catch {
      response.writeHead(404)
      response.end()
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => { server.close() },
  }
}

/** Pick one free TCP port. */
async function freePort() {
  const server = createNetServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

/**
 * Launch headless Chrome with a disposable profile.
 * @param options - page URL and window size.
 * @returns the debug port, Chrome process, profile path and cleanup function.
 */
export async function launchChrome({ url, width = 1200, height = 1200 }) {
  if (!(await chromeExists())) return null
  const port = await freePort()
  const profile = await mkdtemp(join(tmpdir(), 'dsh-browser-'))
  const process = spawn(chromeBinary, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-extensions',
    `--window-size=${width},${height}`,
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${profile}`,
    url,
  ], { stdio: 'ignore' })
  const cleanup = async () => {
    try { process.kill('SIGKILL') } catch { /* already gone */ }
    await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }).catch(() => {})
  }
  return { port, process, profile, cleanup }
}

/**
 * Connect to the first page target Chrome exposes.
 * @param port - DevTools port.
 * @returns a tiny CDP client.
 */
export async function connectCdp(port) {
  let target
  for (let attempt = 0; attempt < 100 && target === undefined; attempt += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      target = list.find(entry => entry.type === 'page' && entry.url.startsWith('http://127.0.0.1:'))
    } catch { /* Chrome is still starting */ }
    if (target === undefined) await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (target === undefined) throw new Error('Chrome did not expose the page target')

  const socket = new WebSocket(target.webSocketDebuggerUrl)
  let sequence = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const entry = pending.get(message.id)
    if (entry === undefined) return
    pending.delete(message.id)
    if (message.error !== undefined) entry.reject(new Error(JSON.stringify(message.error)))
    else entry.resolve(message.result)
  })
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject) })

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result?.exceptionDetails !== undefined) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'evaluate failed')
    }
    return result?.result?.value
  }
  const waitFor = async (expression, label, { timeout = 8000, step = 80 } = {}) => {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      if (await evaluate(expression)) return
      await new Promise(resolve => setTimeout(resolve, step))
    }
    throw new Error(`timeout: ${label}`)
  }
  return { send, evaluate, waitFor, close: () => { socket.close() } }
}
