/**
 * Minimal OpenAI-compatible streaming adapter.
 *
 * It exposes the small `llm.stream()` contract consumed by the copied analysis
 * engine, so the standalone app can use DeepSeek or any compatible endpoint
 * without depending on a Host service.
 */

function endpointFor (baseUrl) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) throw new Error('请先在模型设置中填写 API Base URL')
  return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`
}

function responsesEndpoint (baseUrl) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) throw new Error('请先在模型设置中填写 API Base URL')
  if (/\/responses$/i.test(base)) return base
  return `${base.replace(/\/chat\/completions$/i, '')}/responses`
}

function modelRoot (baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '').replace(/\/(chat\/completions|responses)$/i, '')
}

function responseInput (messages, system) {
  const parts = []
  if (system) parts.push({ role: 'system', content: system })
  for (const message of messages || []) {
    parts.push({ role: message.role, content: flattenContent(message.content) })
  }
  return parts
}

async function * streamResponses ({ baseUrl, apiKey, options, provider, settings }) {
  const body = {
    model: options.model || provider?.defaultModel || settings.model,
    input: responseInput(options.messages, options.system),
    stream: true,
    ...(Number.isFinite(options.maxTokens) ? { max_output_tokens: options.maxTokens } : {}),
    ...(options.reasoningEffort ? { reasoning: { effort: options.reasoningEffort } } : {}),
  }
  const response = await fetch(responsesEndpoint(baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: options.signal,
  })
  if (!response.ok) throw await responseError(response)
  if (!response.body) throw new Error('模型接口没有返回流式响应')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let usage = null
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') continue
        let event
        try { event = JSON.parse(data) } catch { continue }
        if (event.type === 'response.output_text.delta' && event.delta) {
          yield { type: 'text-delta', text: String(event.delta) }
        } else if ((event.type === 'response.reasoning_summary_text.delta' || event.type === 'response.reasoning_text.delta') && event.delta) {
          yield { type: 'reasoning-delta', text: String(event.delta) }
        } else if (event.type === 'response.completed') {
          usage = usageFrom(event.response?.usage)
        } else if (event.type === 'response.failed' || event.type === 'error') {
          const message = event.response?.error?.message || event.error?.message || event.message || 'Responses API 调用失败'
          throw new Error(message)
        }
      }
    }
  } finally {
    reader.releaseLock?.()
  }
  if (usage) yield { type: 'usage', usage }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

function flattenContent (content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(part => (part && part.type === 'text' ? part.text : '')).join('')
}

function usageFrom (value) {
  if (!value) return undefined
  const inputTokens = Number(value.prompt_tokens ?? value.input_tokens ?? 0) || 0
  const outputTokens = Number(value.completion_tokens ?? value.output_tokens ?? 0) || 0
  const cacheReadTokens = Number(
    value.prompt_tokens_details?.cached_tokens ??
    value.input_tokens_details?.cached_tokens ??
    value.prompt_cache_hit_tokens ??
    value.cache_read_input_tokens ??
    value.cacheReadTokens ??
    0
  ) || 0
  const cacheWriteTokens = Number(
    value.prompt_tokens_details?.cache_write_tokens ??
    value.cache_creation_input_tokens ??
    value.cacheWriteTokens ??
    0
  ) || 0
  // OpenAI-style prompt_tokens/input_tokens already include cache reads.
  // Anthropic-style input_tokens excludes them, so add them for the prompt total.
  const includesCache = value.prompt_tokens !== undefined ||
    value.input_tokens_details !== undefined ||
    value.prompt_cache_hit_tokens !== undefined
  const promptTokens = includesCache ? inputTokens : inputTokens + cacheReadTokens
  const totalTokens = Number(value.total_tokens) || promptTokens + outputTokens
  return {
    inputTokens,
    promptTokens,
    outputTokens,
    totalTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens: Number(
      value.completion_tokens_details?.reasoning_tokens ??
      value.output_tokens_details?.reasoning_tokens ??
      value.reasoning_tokens ??
      0
    ) || 0,
  }
}

async function responseError (response) {
  let detail = ''
  try {
    const body = await response.text()
    try {
      const parsed = JSON.parse(body)
      detail = parsed?.error?.message || parsed?.message || body
    } catch { detail = body }
  } catch {}
  const text = String(detail || '')
  if (/missing field [`'\"]?model|model[`'\"]?.{0,20}(required|missing)/i.test(text)) {
    return new Error('没有可以被检测的模型（例如对话模型）')
  }
  return new Error(`模型接口 HTTP ${response.status}${text ? `：${text.slice(0, 500)}` : ''}`)
}

export function createOpenAiLlm (getSettings) {
  return {
    async *stream (options = {}) {
      const settings = getSettings() || {}
      const providers = Array.isArray(settings.providers) ? settings.providers : []
      const provider = providers.find(item => item.id === options.provider) ||
        providers.find(item => item.id === settings.active?.providerId) ||
        providers[0]
      const baseUrl = provider?.baseUrl || settings.baseUrl
      const apiKey = provider?.apiKey || settings.apiKey
      if (!apiKey) throw new Error('请先在模型设置中填写 API Key')
      if ((provider?.protocol || 'chat') === 'responses') {
        yield * streamResponses({ baseUrl, apiKey, options, provider, settings })
        return
      }
      const response = await fetch(endpointFor(baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: options.model || provider?.defaultModel || settings.model,
          messages: [
            ...(options.system ? [{ role: 'system', content: options.system }] : []),
            ...(options.messages || []).map(message => ({
              role: message.role,
              content: flattenContent(message.content),
            })),
          ],
          stream: true,
          ...(Number.isFinite(options.maxTokens) ? { max_tokens: options.maxTokens } : {}),
          ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
        }),
        signal: options.signal,
      })
      if (!response.ok) throw await responseError(response)
      if (!response.body) throw new Error('模型接口没有返回流式响应')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let usage = null
      let finish = 'stop'
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let newline
          while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline).trim()
            buffer = buffer.slice(newline + 1)
            if (!line.startsWith('data:')) continue
            const data = line.slice(5).trim()
            if (!data || data === '[DONE]') continue
            let event
            try { event = JSON.parse(data) } catch { continue }
            if (event.usage) usage = usageFrom(event.usage)
            const choice = event.choices?.[0]
            if (!choice) continue
            const delta = choice.delta || {}
            if (delta.reasoning_content) yield { type: 'reasoning-delta', text: String(delta.reasoning_content) }
            if (delta.content) yield { type: 'text-delta', text: String(delta.content) }
            if (choice.finish_reason) finish = choice.finish_reason
          }
        }
      } finally {
        reader.releaseLock?.()
      }
      if (usage) yield { type: 'usage', usage }
      yield { type: 'finish', reason: { kind: finish === 'length' ? 'length' : 'stop' } }
    },
  }
}

export async function testModelConnection (settings) {
  if (!settings.apiKey) throw new Error('请先填写 API Key')
  const model = settings.model || settings.defaultModel
  if (!model) throw new Error('没有可以被检测的模型（例如对话模型）')
  const responses = (settings.protocol || 'chat') === 'responses'
  const response = await fetch(responses ? responsesEndpoint(settings.baseUrl) : endpointFor(settings.baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(responses
      ? { model, input: 'ping', max_output_tokens: 16, stream: false }
      : { model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false }),
  })
  if (!response.ok) throw await responseError(response)
  return { ok: true, model }
}

function tokenCount (value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value)
  const text = String(value ?? '').trim().toUpperCase().replace(/,/g, '').replace(/\s+/g, '')
  const match = /^(\d+(?:\.\d+)?)([KM]?)$/.exec(text)
  if (!match) return null
  const multiplier = match[2] === 'M' ? 1024 * 1024 : match[2] === 'K' ? 1024 : 1
  const result = Math.round(Number(match[1]) * multiplier)
  return result > 0 ? result : null
}

function firstCount (row, keys) {
  for (const key of keys) {
    const value = key.split('.').reduce((node, part) => node?.[part], row)
    const count = tokenCount(value)
    if (count) return count
  }
  return null
}

function inputTypesOf (row) {
  const raw = row?.input_types ?? row?.inputTypes ?? row?.architecture?.input_modalities ?? row?.capabilities?.input_types
  const list = Array.isArray(raw) ? raw : row?.capabilities?.vision === true ? ['text', 'image'] : null
  if (!list) return null
  const allowed = ['text', 'image']
  return allowed.filter(type => list.includes(type))
}

function modelInfo (row) {
  if (!row || typeof row !== 'object') {
    const id = String(row || '').trim()
    return id ? { id, name: id } : null
  }
  const id = String(row.id || row.model || row.slug || '').trim()
  if (!id) return null
  const name = String(row.display_name || row.displayName || row.name || id).trim() || id
  return {
    id,
    name,
    contextWindow: firstCount(row, [
      'context_length', 'context_window', 'max_context_length', 'max_input_tokens',
      'input_token_limit', 'context_length_tokens', 'limits.context_window',
    ]),
    maxTokens: firstCount(row, [
      'max_output_tokens', 'max_completion_tokens', 'max_output', 'max_tokens',
      'top_provider.max_completion_tokens', 'limits.max_output_tokens',
    ]),
    inputTypes: inputTypesOf(row),
  }
}

export async function fetchModelList (provider) {
  const root = modelRoot(provider.baseUrl)
  if (!root) throw new Error('请先填写 API Base URL')
  if (!provider.apiKey) throw new Error('请先填写 API Key')
  const response = await fetch(`${root}/models`, {
    headers: { authorization: `Bearer ${provider.apiKey}` },
  })
  if (!response.ok) throw await responseError(response)
  const body = await response.json()
  const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : []
  const byId = new Map()
  for (const row of rows) {
    const info = modelInfo(row)
    if (info) byId.set(info.id, info)
  }
  return [...byId.values()]
}
