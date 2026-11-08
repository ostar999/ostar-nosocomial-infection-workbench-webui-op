/**
 * Standalone workbench server.
 *
 * Serves the unchanged workbench panel as a normal web app and replaces the
 * DeepSeek Harness model service with a user-configured OpenAI-compatible
 * endpoint stored in ./data/settings.json.
 */
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createStore } from './lib/store.js'
import { createAssistantStore } from './lib/assistant.js'
import { loadSkill, createStandardReader } from './lib/prompt.js'
import { createEngine } from './lib/analysis.js'
import { createHandler, API_PREFIX } from './lib/server.js'
import { createCitationLookup } from './lib/citation-cards.js'
import { createEnvironment } from './lib/environment.js'
import { createStandaloneSettings } from './lib/standalone-settings.js'
import { createOpenAiLlm, testModelConnection, fetchModelList } from './lib/openai-llm.js'

const root = path.dirname(fileURLToPath(import.meta.url))
const dataDir = process.env.IW_DATA_DIR ? path.resolve(process.env.IW_DATA_DIR) : path.join(root, 'data')
const publicDir = path.join(root, 'public')
const port = Number(process.env.PORT || 8787)
const host = process.env.HOST || '127.0.0.1'
const version = '1.8.6'

function openBrowser (url) {
  if (process.env.IW_NO_OPEN === '1' || process.env.IW_OPEN === '0' || process.env.BROWSER === 'none' || process.env.CI) return
  let command = ''
  let args = []
  if (process.platform === 'darwin') {
    command = 'open'
    args = [url]
  } else if (process.platform === 'win32') {
    command = 'cmd'
    args = ['/c', 'start', '', url]
  } else {
    command = 'xdg-open'
    args = [url]
  }
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
  } catch {}
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
}

function sendJson (res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

async function readJson (req, limit = 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('请求体不是合法 JSON') }
}

async function serveStatic (req, res) {
  const url = new URL(req.url || '/', 'http://workbench.local')
  let pathname = decodeURIComponent(url.pathname)
  if (pathname === '/') pathname = '/index.html'
  const file = path.normalize(path.join(publicDir, pathname))
  if (!file.startsWith(publicDir + path.sep)) {
    sendJson(res, 403, { error: '禁止访问' })
    return
  }
  try {
    const body = await fs.readFile(file)
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': pathname.startsWith('/vendor/') ? 'public, max-age=86400' : 'no-store',
      'content-length': body.length,
    })
    res.end(body)
  } catch {
    if (path.extname(pathname) === '') {
      try {
        const body = await fs.readFile(path.join(publicDir, 'index.html'))
        res.writeHead(200, { 'content-type': CONTENT_TYPES['.html'], 'cache-control': 'no-store', 'content-length': body.length })
        res.end(body)
        return
      } catch {}
    }
    sendJson(res, 404, { error: '页面不存在' })
  }
}

async function main () {
  await fs.mkdir(dataDir, { recursive: true })
  const settings = createStandaloneSettings({ dataDir })
  await settings.load()
  const skill = await loadSkill(path.join(root, 'skill'))
  const readStandard = createStandardReader(skill)
  const store = await createStore({ dataDir })
  const assistantStore = await createAssistantStore({ dataDir })
  const llm = createOpenAiLlm(() => settings.get())
  const config = { materialChars: 260000, standardsChars: 420000, chatChars: 420000, standardsMode: 'full' }

  const engine = createEngine({
    store,
    assistantStore,
    skill,
    readStandard,
    config,
    resolveTarget: async () => settings.target(),
    getLlm: () => llm,
    getWeb: () => null,
    getOfficeToPdf: () => null,
    logger: console,
  })

  const environment = createEnvironment({ appRoot: root, version })

  const handler = createHandler({
    store,
    engine,
    environment,
    getConnection: () => ({ requestRejection: () => undefined }),
    getModelTarget: async () => settings.target(),
    getModelCatalog: async () => settings.catalog(),
    selectModel: async (body = {}) => {
      await settings.select({
        providerId: body.provider,
        model: body.model,
        reasoningEffort: body.reasoningEffort,
      })
      return settings.target()
    },
    lookupCitation: createCitationLookup(skill.citationCards || []),
    skill,
    version,
    getOfficeToPdf: () => null,
  })

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://workbench.local')
      if (url.pathname === `${API_PREFIX}/settings` && req.method === 'GET') {
        sendJson(res, 200, settings.publicView())
        return
      }
      if (url.pathname === `${API_PREFIX}/settings` && req.method === 'POST') {
        const body = await readJson(req)
        sendJson(res, 200, await settings.save(body))
        return
      }
      if (url.pathname === `${API_PREFIX}/settings/models` && req.method === 'POST') {
        const body = await readJson(req)
        const current = settings.get()
        const providerId = String(body.providerId || current.active.providerId)
        const stored = settings.providerFor(providerId)
        try {
          const models = await fetchModelList({
            baseUrl: String(body.baseUrl || stored.baseUrl),
            apiKey: body.apiKey ? String(body.apiKey) : stored.apiKey,
          })
          sendJson(res, 200, { models })
        } catch (error) {
          sendJson(res, 400, { error: String(error?.message || error) })
        }
        return
      }
      if (url.pathname === `${API_PREFIX}/settings/test` && req.method === 'POST') {
        const body = await readJson(req)
        const current = settings.get()
        const providerId = String(body.providerId || body.id || current.active.providerId)
        const stored = settings.providerFor(providerId)
        const draft = {
          baseUrl: String(body.baseUrl || stored.baseUrl),
          protocol: String(body.protocol || stored.protocol || 'chat'),
          model: String(body.model || stored.defaultModel),
          apiKey: body.apiKey ? String(body.apiKey) : stored.apiKey,
        }
        try {
          sendJson(res, 200, await testModelConnection(draft))
        } catch (error) {
          sendJson(res, 400, { error: String(error?.message || error) })
        }
        return
      }
      if (url.pathname.startsWith(API_PREFIX)) {
        await handler(req, res)
        return
      }
      await serveStatic(req, res)
    } catch (error) {
      console.error('[infection-workbench-webui]', error)
      if (!res.headersSent) sendJson(res, 500, { error: String(error?.message || error) })
      else res.end()
    }
  })

  server.listen(port, host, () => {
    const shownHost = host === '0.0.0.0' ? '127.0.0.1' : host
    const url = `http://${shownHost}:${port}`
    console.log(`\n  欧星星·AI院感工作台 (standalone)`)
    console.log(`  ${url}\n`)
    console.log(`  数据目录: ${dataDir}`)
    console.log(`  模型设置: ${settings.file}`)
    if (host === '0.0.0.0') console.warn('  警告: 当前监听所有网卡，API Key 与病例数据由本机文件保存，请勿直接暴露到公网。')
    openBrowser(url)
  })

  const shutdown = async () => {
    server.close()
    await store.flush?.()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
