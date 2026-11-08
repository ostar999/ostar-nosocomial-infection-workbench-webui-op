/**
 * Standalone model connection settings.
 *
 * Providers own endpoints, keys and model ids. Context window, max output and
 * reasoning-effort options belong to each model, so third-party models can
 * advertise different capabilities from DeepSeek models on the same endpoint.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const FILE = 'settings.json'
const EFFORT_IDS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const EFFORT_NAMES = {
  minimal: '最小 / Minimal',
  low: '低 / Low',
  medium: '中 / Medium',
  high: '高 / High',
  xhigh: '极高 / XHigh',
  max: '最大 / Max',
}
const OFFICIAL_CONTEXT = 1024 * 1024
const OFFICIAL_MAX_OUTPUT = 384 * 1024
const DEFAULT_GENERIC_CONTEXT = 256 * 1024
const DEFAULT_GENERIC_MAX_OUTPUT = 128 * 1024
const MAX_CONTEXT = 16 * 1024 * 1024
const MAX_OUTPUT = 1024 * 1024
const GENERIC_EFFORTS = ['low', 'medium', 'high', 'max']

function defaultProvider () {
  return {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    protocol: 'chat',
    apiKey: '',
    models: [],
    modelConfigs: {},
    defaultModel: '',
    enabled: true,
    docsUrl: 'https://api-docs.deepseek.com/zh-cn/',
  }
}

function defaults () {
  const provider = defaultProvider()
  return {
    providers: [provider],
    active: { providerId: provider.id, model: '', reasoningEffort: '' },
    maxTokens: OFFICIAL_MAX_OUTPUT,
  }
}

function cleanBaseUrl (value) {
  const raw = String(value || '').trim()
  if (!raw) throw new Error('请填写 API Base URL / API Base URL is required')
  let url
  try { url = new URL(raw) } catch { throw new Error('API Base URL 格式不正确 / invalid URL') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('API Base URL 只支持 http/https')
  return raw.replace(/\/+$/, '')
}

function cleanModelList (value, fallback = '') {
  const list = (Array.isArray(value) ? value : String(value || '').split(/[\n,，]/))
    .map(item => String(item).trim())
    .filter(Boolean)
  const unique = [...new Set(list)]
  if (unique.length === 0 && fallback) unique.push(fallback)
  return unique
}

function cleanEfforts (value) {
  const list = Array.isArray(value) ? value : []
  return EFFORT_IDS.filter(id => list.includes(id))
}

function parseCount (value, label) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  const text = String(value ?? '').trim().toUpperCase().replace(/,/g, '').replace(/\s+/g, '')
  const match = /^(\d+(?:\.\d+)?)([KM]?)$/.exec(text)
  if (!match) throw new Error(`${label}格式不正确，请使用数字或 K/M，例如 128K、1M / invalid size`)
  const multiplier = match[2] === 'M' ? 1024 * 1024 : match[2] === 'K' ? 1024 : 1
  return Math.round(Number(match[1]) * multiplier)
}

function cleanMaxTokens (value) {
  const number = parseCount(value, 'Max output')
  if (!Number.isFinite(number) || number < 256) throw new Error('Max output 至少为 256 / at least 256')
  return Math.min(number, MAX_OUTPUT)
}

function cleanContext (value) {
  const number = parseCount(value, '上下文长度')
  if (!Number.isFinite(number) || number < 1024) throw new Error('上下文长度至少为 1024 / context window must be at least 1024')
  return Math.min(number, MAX_CONTEXT)
}

function modelDefaults (provider, model) {
  const deepseek = /deepseek/i.test(provider?.id || '') || /deepseek/i.test(provider?.name || '') ||
    /deepseek\.com/i.test(provider?.baseUrl || '') || /deepseek/i.test(model || '')
  return deepseek
    ? {
        maxTokens: OFFICIAL_MAX_OUTPUT,
        contextWindow: OFFICIAL_CONTEXT,
        efforts: ['low', 'medium', 'high', 'max'],
        defaultEffort: 'high',
      }
    : {
        maxTokens: DEFAULT_GENERIC_MAX_OUTPUT,
        contextWindow: DEFAULT_GENERIC_CONTEXT,
        efforts: [...GENERIC_EFFORTS],
        defaultEffort: 'medium',
      }
}

function cleanProtocol (value) {
  return value === 'responses' ? 'responses' : 'chat'
}

function cleanInputTypes (value) {
  const allowed = ['text', 'image']
  const list = Array.isArray(value) ? value : ['text']
  const result = allowed.filter(type => list.includes(type))
  return result.length > 0 ? result : ['text']
}

function cleanModelConfig (raw, model, provider, legacy = {}) {
  const fallback = modelDefaults(provider, model)
  const sourceMax = raw?.maxTokens !== undefined ? raw.maxTokens : legacy.maxTokens
  const sourceContext = raw?.contextWindow !== undefined ? raw.contextWindow : legacy.contextWindow
  const sourceEfforts = raw?.efforts !== undefined ? raw.efforts : legacy.efforts
  const maxTokens = cleanMaxTokens(sourceMax ?? fallback.maxTokens)
  const contextWindow = cleanContext(sourceContext ?? fallback.contextWindow)
  const efforts = sourceEfforts === undefined ? [...fallback.efforts] : cleanEfforts(sourceEfforts)
  const wantedDefault = String(raw?.defaultEffort ?? legacy.defaultEffort ?? fallback.defaultEffort)
  const defaultEffort = efforts.includes(wantedDefault) ? wantedDefault : (efforts[0] || '')
  const reasoning = raw?.reasoning === undefined ? efforts.length > 0 : Boolean(raw.reasoning)
  const effortValues = {}
  for (const id of efforts) {
    effortValues[id] = String(raw?.effortValues?.[id] || id)
  }
  return {
    displayName: String(raw?.displayName || model || '').trim() || model,
    inputTypes: cleanInputTypes(raw?.inputTypes),
    maxTokens,
    contextWindow,
    reasoning,
    efforts,
    effortValues,
    defaultEffort,
  }
}

function cleanProvider (raw, index = 0, previous = null) {
  const id = String(raw?.id || previous?.id || `provider-${Date.now().toString(36)}-${index}`).trim()
  const name = String(raw?.name || previous?.name || `供应商 ${index + 1}`).trim()
  const baseUrl = cleanBaseUrl(raw?.baseUrl ?? previous?.baseUrl)
  const models = cleanModelList(raw?.models ?? previous?.models, previous?.defaultModel)
  let defaultModel = String(raw?.defaultModel || previous?.defaultModel || models[0] || '').trim()
  if (models.length === 0) defaultModel = ''
  else if (!models.includes(defaultModel)) defaultModel = models[0]
  const apiKey = raw?.apiKey !== undefined && String(raw.apiKey).trim() !== ''
    ? String(raw.apiKey).trim()
    : (previous?.apiKey || '')
  const priorConfigs = raw?.modelConfigs && typeof raw.modelConfigs === 'object'
    ? raw.modelConfigs
    : (previous?.modelConfigs && typeof previous.modelConfigs === 'object' ? previous.modelConfigs : {})
  const legacy = {
    maxTokens: raw?.maxTokens ?? previous?.maxTokens,
    contextWindow: raw?.contextWindow ?? previous?.contextWindow,
    efforts: raw?.efforts ?? previous?.efforts,
    defaultEffort: raw?.defaultEffort ?? previous?.defaultEffort,
  }
  const modelConfigs = {}
  for (const model of models) {
    modelConfigs[model] = cleanModelConfig(priorConfigs[model], model, { id, name, baseUrl }, legacy)
  }
  const activeConfig = modelConfigs[defaultModel] || Object.values(modelConfigs)[0] || cleanModelConfig(null, '', { id, name, baseUrl })
  return {
    id,
    name,
    baseUrl,
    protocol: cleanProtocol(raw?.protocol ?? previous?.protocol),
    apiKey,
    models,
    modelConfigs,
    defaultModel,
    // Legacy mirrors keep older settings files readable; the current target and
    // catalogue always read the per-model configuration above.
    efforts: activeConfig.efforts,
    defaultEffort: activeConfig.defaultEffort,
    contextWindow: activeConfig.contextWindow,
    maxTokens: activeConfig.maxTokens,
    enabled: raw?.enabled === undefined ? (previous?.enabled !== false) : raw.enabled !== false,
    docsUrl: String(raw?.docsUrl ?? previous?.docsUrl ?? ''),
  }
}

function modelConfigOf (provider, model) {
  const config = provider?.modelConfigs?.[model]
  if (config) return config
  return cleanModelConfig(null, model, provider || {})
}

function cleanActive (raw, providers) {
  const enabled = providers.filter(item => item.enabled !== false)
  const usable = enabled.filter(item => item.models.length > 0)
  const pool = usable.length > 0 ? usable : (enabled.length > 0 ? enabled : providers)
  const provider = pool.find(item => item.id === raw?.providerId) || pool[0]
  if (!provider) return { providerId: '', model: '', reasoningEffort: '' }
  const model = provider.models.includes(String(raw?.model || '')) ? String(raw.model) : (provider.defaultModel || provider.models[0] || '')
  const config = modelConfigOf(provider, model)
  const available = config.reasoning === false ? [] : config.efforts
  const effort = available.includes(String(raw?.reasoningEffort || ''))
    ? String(raw.reasoningEffort)
    : (available.includes(config.defaultEffort) ? config.defaultEffort : (available[0] || ''))
  return { providerId: provider.id, model, reasoningEffort: effort }
}

export function createStandaloneSettings ({ dataDir }) {
  const file = path.join(dataDir, FILE)
  let current = defaults()

  function normalize (saved) {
    if (saved && Array.isArray(saved.providers) && saved.providers.length > 0) {
      const previous = new Map((saved.providers || []).map(item => [String(item.id || ''), item]))
      const providers = saved.providers.map((item, index) => cleanProvider(item, index, previous.get(String(item.id || '')) || null))
      return {
        providers,
        active: cleanActive(saved.active, providers),
        maxTokens: cleanMaxTokens(saved.maxTokens ?? OFFICIAL_MAX_OUTPUT),
      }
    }
    // Migrate the old single-provider shape.
    if (saved && saved.baseUrl) {
      const provider = defaultProvider()
      provider.baseUrl = cleanBaseUrl(saved.baseUrl)
      provider.apiKey = String(saved.apiKey || '')
      provider.models = cleanModelList([saved.model || provider.defaultModel])
      provider.defaultModel = provider.models[0]
      const config = cleanModelConfig({ maxTokens: saved.maxTokens, contextWindow: saved.contextWindow }, provider.defaultModel, provider)
      provider.modelConfigs = { [provider.defaultModel]: config }
      return {
        providers: [provider],
        active: { providerId: provider.id, model: provider.defaultModel, reasoningEffort: config.defaultEffort },
        maxTokens: config.maxTokens,
      }
    }
    return defaults()
  }

  async function load () {
    try {
      current = normalize(JSON.parse(await fs.readFile(file, 'utf8')))
    } catch {
      current = defaults()
    }
    return current
  }

  async function persist (next) {
    await fs.mkdir(dataDir, { recursive: true })
    const tmp = `${file}.tmp-${process.pid}`
    await fs.writeFile(tmp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
    await fs.rename(tmp, file)
    current = next
  }

  function publicView () {
    const activeProvider = current.providers.find(item => item.id === current.active.providerId) || current.providers[0]
    const activeConfig = activeProvider ? modelConfigOf(activeProvider, current.active.model) : null
    return {
      providers: current.providers.map(provider => ({
        ...provider,
        apiKey: '',
        hasApiKey: Boolean(provider.apiKey),
      })),
      active: { ...current.active },
      maxTokens: activeConfig?.maxTokens || current.maxTokens,
      contextWindow: activeConfig?.contextWindow || OFFICIAL_CONTEXT,
      maxOutputTokens: activeConfig?.maxTokens || OFFICIAL_MAX_OUTPUT,
      enabledCount: current.providers.filter(provider => provider.enabled !== false).length,
      hasApiKey: Boolean(activeProvider?.apiKey),
      configured: Boolean(activeProvider?.apiKey) && (activeProvider?.models?.length || 0) > 0,
    }
  }

  async function save (patch = {}) {
    const incoming = Array.isArray(patch.providers) && patch.providers.length > 0 ? patch.providers : current.providers
    const previous = new Map(current.providers.map(item => [item.id, item]))
    const providers = incoming.map((item, index) => cleanProvider(item, index, previous.get(String(item.id || '')) || null))
    const maxTokens = patch.maxTokens !== undefined ? cleanMaxTokens(patch.maxTokens) : current.maxTokens
    const active = cleanActive(patch.active || current.active, providers)
    await persist({ providers, active, maxTokens })
    return publicView()
  }

  async function select (selection = {}) {
    const active = cleanActive(selection, current.providers)
    await persist({ ...current, active })
    return publicView()
  }

  async function savePartial (patch = {}) {
    const maxTokens = patch.maxTokens !== undefined ? cleanMaxTokens(patch.maxTokens) : current.maxTokens
    await persist({ ...current, maxTokens })
    return publicView()
  }

  function providerFor (id) {
    return current.providers.find(item => item.id === id) || current.providers[0]
  }

  function target () {
    let provider = providerFor(current.active.providerId)
    if (!provider || provider.enabled === false || provider.models.length === 0) {
      provider = current.providers.find(item => item.enabled !== false && item.models.length > 0) ||
        current.providers.find(item => item.enabled !== false) ||
        provider
    }
    if (!provider) {
      const error = new Error('未配置模型 / no model configured')
      error.unconfigured = true
      throw error
    }
    if (provider.models.length === 0) {
      const error = new Error('未配置模型 / no model configured')
      error.unconfigured = true
      throw error
    }
    const model = provider.models.includes(current.active.model) ? current.active.model : (provider.defaultModel || provider.models[0])
    const config = modelConfigOf(provider, model)
    const availableEfforts = config.reasoning === false ? [] : config.efforts
    const effort = availableEfforts.includes(current.active.reasoningEffort)
      ? current.active.reasoningEffort
      : (availableEfforts.includes(config.defaultEffort) ? config.defaultEffort : (availableEfforts[0] || ''))
    const efforts = availableEfforts.map(id => ({ id, name: EFFORT_NAMES[id] || id }))
    return {
      provider: provider.id,
      providerName: provider.name,
      protocol: provider.protocol || 'chat',
      model,
      modelName: config.displayName || model,
      reasoningEffort: effort,
      reasoningValue: config.effortValues?.[effort] || effort,
      effortValues: { ...(config.effortValues || {}) },
      defaultMaxTokens: config.maxTokens,
      contextWindow: config.contextWindow,
      efforts: availableEfforts,
      effortOptions: efforts,
      defaultEffort: availableEfforts.includes(config.defaultEffort) ? config.defaultEffort : (availableEfforts[0] || ''),
      leastEffort: availableEfforts[0] || '',
      origin: 'standalone-settings',
    }
  }

  function catalog () {
    return {
      providers: current.providers.filter(provider => provider.enabled !== false && provider.models.length > 0).map(provider => ({
        id: provider.id,
        name: provider.name,
        models: provider.models.map(model => {
          const config = modelConfigOf(provider, model)
          const efforts = config.reasoning === false ? [] : config.efforts
          return {
            id: model,
            name: config.displayName || model,
            efforts: efforts.map(id => ({ id, name: EFFORT_NAMES[id] || id })),
            defaultEffort: efforts.includes(config.defaultEffort) ? config.defaultEffort : (efforts[0] || ''),
            maxTokens: config.maxTokens,
            contextWindow: config.contextWindow,
            inputTypes: config.inputTypes,
          }
        }),
      })),
      selection: {
        provider: current.active.providerId,
        model: current.active.model,
        reasoningEffort: current.active.reasoningEffort,
      },
    }
  }

  return { load, save, savePartial, select, publicView, target, catalog, providerFor, get: () => current, file }
}
