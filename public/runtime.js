/* Standalone shell: mounts the unchanged workbench panel and adds model settings. */
(function () {
  const state = {
    plugin: null,
    main: null,
    dictionaries: {},
    mounted: false,
    lastError: null,
  }
  const localeSnapshot = { active: 'zh' }

  const locale = {
    register (ns, dictionaries) {
      const zh = dictionaries && dictionaries.zh ? dictionaries.zh : {}
      state.dictionaries[ns] = zh
    },
    bind (ns) {
      return function t (key) {
        const dictionary = state.dictionaries[ns] || state.dictionaries['infection-workbench'] || {}
        const entry = dictionary[key]
        return Array.isArray(entry) ? entry[0] : (entry || key)
      }
    },
    getSnapshot () { return localeSnapshot },
    subscribe () { return function unsubscribe () {} },
  }

  const uiWorkspace = {
    async pickDirectory () {
      return null
    },
  }

  function mountPanel (Component) {
    if (!Component || state.mounted) return
    if (!window.React || !window.ReactDOM) {
      showFatal('React 未加载，无法启动工作台')
      return
    }
    state.mounted = true
    const root = window.ReactDOM.createRoot(document.getElementById('root'))
    root.render(window.React.createElement(Component, {
      t: locale.bind('infection-workbench'),
      host: {
        pickDirectory: uiWorkspace.pickDirectory,
        openSettings: () => openSettings(),
        openTheme: () => openTheme(),
      },
      locale,
    }))
  }

  function showFatal (message) {
    state.lastError = message
    const root = document.getElementById('root')
    if (!root) return
    root.innerHTML = ''
    const panel = document.createElement('div')
    panel.style.cssText = 'margin:48px auto;max-width:640px;padding:20px;border:1px solid #5f2b2b;border-radius:12px;background:#2a1518;color:#ffb4b4;font:14px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;white-space:pre-wrap'
    panel.textContent = '工作台启动失败\n\n' + message
    root.appendChild(panel)
  }

  window.__ModuleLoader__ = {
    load (definition) {
      state.plugin = definition
      setTimeout(function () {
        try {
          if (!definition || typeof definition.factory !== 'function') throw new Error('插件定义缺少 factory')
          const plugin = definition.factory(function require (id) {
            if (id === 'react') return window.React
            throw new Error('未知模块: ' + id)
          })
          const ctx = {
            effect (fn) {
              const dispose = fn()
              return typeof dispose === 'function' ? dispose : function () {}
            },
            inject (deps, callback) {
              callback({ uiWorkspace })
              return function () {}
            },
            get (name) {
              return name === 'uiWorkspace' ? uiWorkspace : undefined
            },
            locale,
            slots: {
              inject (slot, callback) {
                callback()
                return function () {}
              },
              register (options, component) {
                if (options && options.name === 'main') {
                  state.main = component
                  setTimeout(function () { mountPanel(component) }, 0)
                }
                return function () {}
              },
            },
          }
          if (typeof plugin.apply !== 'function') throw new Error('插件定义缺少 apply')
          plugin.apply(ctx)
        } catch (error) {
          console.error(error)
          showFatal(String(error && error.stack || error))
        }
      }, 0)
    },
  }

  // ---------------------------------------------------------------------------
  // Model connection settings
  // ---------------------------------------------------------------------------
  const API = '/infection-workbench'
  let currentSettings = null

  // ---------------------------------------------------------------------------
  // Appearance
  // ---------------------------------------------------------------------------
  const THEME_KEY = 'iw.theme'
  const ACCENT_KEY = 'iw.accent'
  const ACCENTS = [
    { id: 'cyan', color: '#46b5d9', name: '青色 / Cyan' },
    { id: 'blue', color: '#3d7cff', name: '蓝色 / Blue' },
    { id: 'teal', color: '#0f9b8e', name: '青绿 / Teal' },
    { id: 'green', color: '#17945c', name: '绿色 / Green' },
    { id: 'purple', color: '#7c5ce5', name: '紫色 / Purple' },
    { id: 'orange', color: '#d47a16', name: '橙色 / Orange' },
    { id: 'rose', color: '#d94f8e', name: '玫红 / Rose' },
  ]

  function readPreference (key, fallback) {
    try { return localStorage.getItem(key) || fallback } catch { return fallback }
  }

  function systemLight () {
    try { return window.matchMedia('(prefers-color-scheme: light)').matches } catch { return false }
  }

  function applyTheme (mode = readPreference(THEME_KEY, 'dark'), accent = readPreference(ACCENT_KEY, 'cyan')) {
    const resolved = mode === 'system' ? (systemLight() ? 'light' : 'dark') : (mode === 'light' ? 'light' : 'dark')
    document.documentElement.dataset.theme = resolved
    document.documentElement.dataset.themeMode = mode
    document.documentElement.dataset.accent = ACCENTS.some(item => item.id === accent) ? accent : 'cyan'
    try {
      localStorage.setItem(THEME_KEY, mode)
      localStorage.setItem(ACCENT_KEY, accent)
    } catch {}
  }

  function openTheme () {
    const root = document.getElementById('settings-root')
    if (!root || root.querySelector('.iw-theme-mask')) return
    const currentMode = readPreference(THEME_KEY, 'dark')
    let currentAccent = readPreference(ACCENT_KEY, 'cyan')
    const modes = [
      { id: 'dark', label: '深色 / Dark' },
      { id: 'light', label: '浅色 / Light' },
      { id: 'system', label: '跟随系统 / System' },
    ]
    const modeButtons = new Map()
    const swatches = new Map()
    const close = () => { root.innerHTML = '' }
    const modeRow = el('div', { className: 'iw-theme-modes' })
    for (const mode of modes) {
      const button = el('button', {
        className: 'iw-theme-mode',
        type: 'button',
        text: mode.label,
        'data-active': currentMode === mode.id ? 'true' : 'false',
        onclick: () => {
          applyTheme(mode.id, currentAccent)
          for (const [id, item] of modeButtons) item.setAttribute('data-active', id === mode.id ? 'true' : 'false')
        },
      })
      modeButtons.set(mode.id, button)
      modeRow.appendChild(button)
    }
    const accentRow = el('div', { className: 'iw-theme-swatches' })
    for (const accent of ACCENTS) {
      const button = el('button', {
        className: 'iw-accent-swatch',
        type: 'button',
        title: accent.name,
        'aria-label': accent.name,
        style: { '--swatch': accent.color },
        'data-active': currentAccent === accent.id ? 'true' : 'false',
        onclick: () => {
          currentAccent = accent.id
          applyTheme(readPreference(THEME_KEY, 'dark'), accent.id)
          for (const [id, item] of swatches) item.setAttribute('data-active', id === accent.id ? 'true' : 'false')
        },
      })
      swatches.set(accent.id, button)
      accentRow.appendChild(button)
    }
    const panel = el('div', { className: 'iw-theme-panel' }, [
      el('div', { className: 'iw-theme-head' }, [
        el('h2', { text: '外观 / Appearance' }),
        el('button', { className: 'iw-settings-close', type: 'button', text: '×', title: '关闭 / Close', onclick: close }),
      ]),
      el('div', { className: 'iw-theme-body' }, [
        el('div', { className: 'iw-theme-label', text: '主题模式 / Theme mode' }),
        modeRow,
        el('div', { className: 'iw-theme-label', text: '主题颜色 / Accent color' }),
        accentRow,
        el('div', { className: 'iw-theme-hint', text: '设置保存在本机浏览器，立即生效 / Saved locally and applied instantly.' }),
      ]),
      el('div', { className: 'iw-theme-foot' }, [
        el('span', { className: 'spacer' }),
        el('button', { className: 'iw-settings-btn primary', type: 'button', text: '完成 / Done', onclick: close }),
      ]),
    ])
    const mask = el('div', { className: 'iw-settings-mask iw-theme-mask' }, [panel])
    mask.addEventListener('mousedown', event => { if (event.target === mask) close() })
    const onKey = event => { if (event.key === 'Escape') { document.removeEventListener('keydown', onKey); close() } }
    document.addEventListener('keydown', onKey)
    root.appendChild(mask)
  }

  function initTheme () {
    applyTheme(readPreference(THEME_KEY, 'dark'), readPreference(ACCENT_KEY, 'cyan'))
    try {
      const media = window.matchMedia('(prefers-color-scheme: light)')
      media.addEventListener?.('change', () => {
        if (readPreference(THEME_KEY, 'dark') === 'system') {
          applyTheme('system', readPreference(ACCENT_KEY, 'cyan'))
        }
      })
    } catch {}
  }

  function el (tag, attrs, children) {
    const node = document.createElement(tag)
    for (const [key, value] of Object.entries(attrs || {})) {
      if (key === 'text') node.textContent = value
      else if (key === 'className') node.className = value
      else if (key === 'html') node.innerHTML = value
      else if (key === 'style' && value && typeof value === 'object') {
        for (const [property, styleValue] of Object.entries(value)) {
          if (property.startsWith('--')) node.style.setProperty(property, styleValue)
          else node.style[property] = styleValue
        }
      }
      else if (key === 'checked' || key === 'disabled' || key === 'selected') node[key] = Boolean(value)
      else if (key === 'value') node.value = value
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value)
      else if (value !== undefined && value !== null) node.setAttribute(key, value)
    }
    for (const child of [].concat(children || [])) {
      if (child === undefined || child === null) continue
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
    }
    return node
  }

  function svgIcon (name, size = 14) {
    const paths = {
      edit: ['M4 20h4L20 8l-4-4L4 16z', 'M14 6l4 4'],
      trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v6M14 11v6'],
    }[name] || []
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('width', String(size))
    svg.setAttribute('height', String(size))
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('fill', 'none')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-width', '1.7')
    svg.setAttribute('stroke-linecap', 'round')
    svg.setAttribute('stroke-linejoin', 'round')
    svg.setAttribute('aria-hidden', 'true')
    for (const d of paths) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', d)
      svg.appendChild(path)
    }
    return svg
  }

  function sizeParts (value) {
    const number = Number(value) || 0
    if (number >= 1024 * 1024 && number % (1024 * 1024) === 0) return { number: number / (1024 * 1024), unit: 'M' }
    if (number >= 1024 && number % 1024 === 0) return { number: number / 1024, unit: 'K' }
    if (number >= 1024 * 1024) return { number: Number((number / (1024 * 1024)).toFixed(4)), unit: 'M' }
    return { number: Number((number / 1024).toFixed(4)), unit: 'K' }
  }

  function makeSizeControl ({ value, min, max, onChange }) {
    const parts = sizeParts(value)
    const numberInput = el('input', {
      className: 'iw-size-number',
      type: 'number',
      min: '0.001',
      step: 'any',
      inputmode: 'decimal',
      value: String(parts.number),
    })
    const unitSelect = el('select', { className: 'iw-size-unit', 'aria-label': '单位 / Unit' }, [
      el('option', { value: 'K', text: 'K' }),
      el('option', { value: 'M', text: 'M' }),
    ])
    unitSelect.value = parts.unit
    let currentUnit = parts.unit
    const multiplier = unit => (unit === 'M' ? 1024 * 1024 : 1024)
    const clamp = number => Math.min(max, Math.max(min, Math.round(number)))
    const commit = () => {
      const number = Number(numberInput.value)
      if (!Number.isFinite(number) || number <= 0) return
      onChange(clamp(number * multiplier(currentUnit)))
    }
    numberInput.addEventListener('input', commit)
    unitSelect.addEventListener('change', () => {
      const number = Number(numberInput.value)
      const actual = Number.isFinite(number) && number > 0 ? clamp(number * multiplier(currentUnit)) : value
      onChange(actual)
      currentUnit = unitSelect.value
      numberInput.value = String(Number((actual / multiplier(currentUnit)).toFixed(4)))
    })
    return el('div', { className: 'iw-size-control' }, [numberInput, unitSelect])
  }

  function openSettings () {
    const root = document.getElementById('settings-root')
    if (!root || root.querySelector('.iw-settings-mask')) return
    const s = currentSettings || {
      providers: [{
        id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', apiKey: '',
        models: [], defaultModel: '',
        efforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'high', contextWindow: 1048576,
        maxTokens: 393216, enabled: true, docsUrl: 'https://api-docs.deepseek.com/zh-cn/',
      }],
      active: { providerId: 'deepseek', model: '', reasoningEffort: 'high' },
      maxTokens: 393216,
      configured: false,
    }
    const providers = Array.isArray(s.providers) && s.providers.length > 0
      ? s.providers.map(provider => {
        const models = [...(provider.models || [])]
        const defaultModel = models.includes(provider.defaultModel)
          ? provider.defaultModel
          : (models[0] || '')
        return {
          ...provider,
          apiKey: '',
          models,
          defaultModel,
          protocol: provider.protocol === 'responses' ? 'responses' : 'chat',
          modelConfigs: { ...(provider.modelConfigs || {}) },
          enabled: provider.enabled !== false,
          docsUrl: provider.docsUrl || '',
        }
      })
      : []
    let activeId = s.active?.providerId || providers[0]?.id || ''
    let selectedId = activeId
    let filter = ''
    let uid = 0
    const error = el('div', { className: 'iw-footer-error' })
    const providerList = el('div', { className: 'iw-ps-list' })
    const detail = el('div', { className: 'iw-provider-detail' })
    const search = el('input', { className: 'iw-ps-search', placeholder: '搜索模型平台… / Search provider…' })
    const close = () => { root.innerHTML = '' }
    const save = el('button', { className: 'iw-settings-btn primary', type: 'button', text: '保存并重载 / Save & reload' })
    const cancel = el('button', { className: 'iw-settings-btn', type: 'button', text: '取消 / Cancel', onclick: close })
    const add = el('button', { className: 'iw-ps-add', type: 'button', text: '＋ 添加供应商 / Add provider' })

    function tone (provider) {
      let hash = 0
      for (const char of String(provider.name || provider.id)) hash = (hash * 31 + char.charCodeAt(0)) % 5
      return 'iw-tone-' + hash
    }

    function preview (baseUrl, protocol = 'chat') {
      const raw = String(baseUrl || '').trim().replace(/\/+$/, '').replace(/\/(chat\/completions|responses)$/i, '')
      if (!raw) return `https://api.deepseek.com/${protocol === 'responses' ? 'responses' : 'chat/completions'}`
      return `${raw}/${protocol === 'responses' ? 'responses' : 'chat/completions'}`
    }

    function currentProvider () {
      return providers.find(item => item.id === selectedId) || providers[0]
    }

    function enabledProviders () {
      return providers.filter(item => item.enabled !== false)
    }

    function ensureActive () {
      if (!providers.some(item => item.id === activeId && item.enabled !== false)) {
        activeId = enabledProviders()[0]?.id || providers[0]?.id || ''
      }
      if (!providers.some(item => item.id === selectedId)) selectedId = activeId || providers[0]?.id || ''
    }

    function defaultModelConfig (provider, model) {
      const deepseek = /deepseek/i.test(provider?.id || '') || /deepseek/i.test(provider?.name || '') ||
        /deepseek\.com/i.test(provider?.baseUrl || '') || /deepseek/i.test(model || '')
      const efforts = ['low', 'medium', 'high', 'max']
      return {
        displayName: model,
        inputTypes: ['text'],
        maxTokens: deepseek ? 393216 : 131072,
        contextWindow: deepseek ? 1048576 : 262144,
        reasoning: true,
        efforts,
        effortValues: Object.fromEntries(efforts.map(id => [id, id])),
        defaultEffort: deepseek ? 'high' : 'medium',
      }
    }

    function ensureModelConfig (provider, model) {
      if (!provider.modelConfigs || typeof provider.modelConfigs !== 'object') provider.modelConfigs = {}
      if (!provider.modelConfigs[model]) provider.modelConfigs[model] = defaultModelConfig(provider, model)
      return provider.modelConfigs[model]
    }

    function sizeLabel (value) {
      const n = Number(value) || 0
      if (n >= 1024 * 1024 && n % (1024 * 1024) === 0) return `${n / (1024 * 1024)}M`
      if (n >= 1024 && n % 1024 === 0) return `${n / 1024}K`
      return String(n)
    }

    function addProvider () {
      uid += 1
      const provider = {
        id: 'provider-' + Date.now().toString(36) + '-' + uid,
        name: '新供应商 / Provider ' + (providers.length + 1),
        baseUrl: 'https://api.openai.com/v1',
        protocol: 'chat',
        apiKey: '',
        models: [],
        modelConfigs: {},
        defaultModel: '',
        enabled: true,
        docsUrl: '',
      }
      providers.push(provider)
      selectedId = provider.id
      if (!activeId) activeId = provider.id
      renderProviders()
      renderDetail()
    }

    function renderProviders () {
      providerList.innerHTML = ''
      const keyword = filter.trim().toLowerCase()
      const visible = providers.filter(provider => !keyword || provider.name.toLowerCase().includes(keyword) || provider.id.toLowerCase().includes(keyword))
      for (const provider of visible) {
        const row = el('div', {
          className: 'iw-ps-row' + (provider.id === selectedId ? ' selected' : '') + (provider.enabled === false ? ' disabled' : ''),
          role: 'button',
          tabindex: '0',
          'data-provider-id': provider.id,
        }, [
          el('span', { className: 'iw-ps-logo ' + tone(provider), text: (provider.name || '?').trim().slice(0, 1).toUpperCase() }),
          el('span', { className: 'iw-ps-name', text: provider.name }),
        ])
        const toggle = el('button', {
          className: 'iw-switch',
          type: 'button',
          'data-on': provider.enabled !== false ? 'true' : 'false',
          'aria-label': provider.enabled !== false ? '关闭供应商 / Disable' : '启用供应商 / Enable',
          title: provider.enabled !== false ? 'ON' : 'OFF',
        }, [el('span', { className: 'iw-switch-knob' })])
        toggle.addEventListener('click', event => {
          event.stopPropagation()
          if (provider.enabled !== false && enabledProviders().length <= 1) {
            error.textContent = '至少保留一个启用的供应商 / keep at least one enabled provider'
            return
          }
          provider.enabled = provider.enabled === false
          if (provider.enabled && !activeId) activeId = provider.id
          if (!provider.enabled && activeId === provider.id) activeId = enabledProviders()[0]?.id || ''
          ensureActive()
          renderProviders()
          renderDetail()
        })
        row.appendChild(toggle)
        row.addEventListener('click', () => {
          selectedId = provider.id
          renderProviders()
          renderDetail()
        })
        row.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            selectedId = provider.id
            renderProviders()
            renderDetail()
          }
        })
        providerList.appendChild(row)
      }
      if (visible.length === 0) providerList.appendChild(el('div', { className: 'iw-ps-empty', text: '没有匹配的供应商 / No provider found' }))
    }

    function renderModels (provider) {
      if (provider.models.length > 0 && !provider.models.includes(provider.defaultModel)) {
        provider.defaultModel = provider.models[0]
      }
      const wrap = el('div', { className: 'iw-model-list' })
      const testStatus = el('div', { className: 'iw-model-test-status' })
      for (const model of provider.models) {
        const isDefault = model === provider.defaultModel
        const config = ensureModelConfig(provider, model)
        wrap.appendChild(el('div', { className: 'iw-model-row' + (isDefault ? ' default' : '') }, [
          el('span', { className: 'iw-model-icon', text: (provider.name || 'M').trim().slice(0, 1).toUpperCase() }),
          el('span', { className: 'iw-model-name', text: config.displayName || model, title: model }),
          el('span', { className: 'iw-model-size', text: `${sizeLabel(config.maxTokens)} / ${sizeLabel(config.contextWindow)}` }),
          isDefault ? el('span', { className: 'iw-model-default', text: '默认 / default' }) : null,
          el('button', {
            className: 'iw-model-action iw-model-test',
            type: 'button',
            title: `检测该模型 / Test ${model}`,
            text: '测',
            onclick: async (event) => {
              const button = event.currentTarget
              button.disabled = true
              testStatus.textContent = `检测中 / Testing… ${model}`
              testStatus.style.color = ''
              try {
                const response = await fetch(API + '/settings/test', {
                  method: 'POST', headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ providerId: provider.id, baseUrl: provider.baseUrl, protocol: provider.protocol || 'chat', model, apiKey: provider.apiKey || '' }),
                })
                const data = await response.json()
                if (!response.ok) throw new Error(data.error || 'failed')
                testStatus.style.color = '#6fdc9b'
                testStatus.textContent = `✓ 连接成功 / Connected：${data.model || model}`
              } catch (e) {
                testStatus.style.color = '#ff8a8a'
                testStatus.textContent = `✗ ${model}：${String(e.message || e)}`
              } finally {
                button.disabled = false
              }
            },
          }),
          el('button', {
            className: 'iw-model-action',
            type: 'button',
            title: '模型设置 / Model settings',
            text: '⚙',
            onclick: () => openModelSettings(provider, model),
          }),
          el('button', {
            className: 'iw-model-action' + (isDefault ? ' active' : ''),
            type: 'button',
            title: '设为默认模型 / Set default',
            text: isDefault ? '★' : '☆',
            onclick: () => {
              provider.defaultModel = model
              renderDetail()
            },
          }),
          el('button', {
            className: 'iw-model-action danger',
            type: 'button',
            title: '移除模型 / Remove model',
            text: '−',
            onclick: () => {
              if (provider.models.length <= 1) {
                error.textContent = '至少保留一个模型 / keep at least one model'
                return
              }
              provider.models = provider.models.filter(item => item !== model)
              if (provider.modelConfigs) delete provider.modelConfigs[model]
              if (provider.defaultModel === model) provider.defaultModel = provider.models[0]
              renderDetail()
            },
          }),
        ]))
      }
      const addInput = el('input', { className: 'iw-model-add-input', placeholder: '添加模型名称 / Add model id' })
      const addButton = el('button', {
        className: 'iw-model-add-button',
        type: 'button',
        text: '添加 / Add',
        onclick: () => {
          const value = addInput.value.trim()
          if (!value) return
          if (!provider.models.includes(value)) provider.models.push(value)
          ensureModelConfig(provider, value)
          if (!provider.defaultModel) provider.defaultModel = value
          addInput.value = ''
          renderDetail()
        },
      })
      addInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); addButton.click() }
      })
      return el('div', null, [wrap, testStatus, el('div', { className: 'iw-model-add' }, [addInput, addButton])])
    }

    function applyModelCapabilities (provider, model, info = {}) {
      const config = ensureModelConfig(provider, model)
      if (info.name && info.name !== model) config.displayName = info.name
      if (Number.isFinite(Number(info.contextWindow)) && Number(info.contextWindow) > 0) {
        config.contextWindow = Math.round(Number(info.contextWindow))
      }
      if (Number.isFinite(Number(info.maxTokens)) && Number(info.maxTokens) > 0) {
        config.maxTokens = Math.round(Number(info.maxTokens))
      }
      if (Array.isArray(info.inputTypes) && info.inputTypes.length > 0) {
        config.inputTypes = [...info.inputTypes]
      }
      return config
    }

    function openModelPicker (provider, fetched) {
      const available = []
      const seen = new Set()
      for (const raw of fetched || []) {
        const id = String(typeof raw === 'string' ? raw : raw?.id || '').trim()
        if (!id || seen.has(id) || provider.models.includes(id)) continue
        seen.add(id)
        available.push(typeof raw === 'string' ? { id, name: id } : { ...raw, id })
      }
      const mask = el('div', { className: 'iw-model-picker-mask' })
      const search = el('input', { className: 'iw-model-picker-search', placeholder: '搜索模型 ID 或名称 / Search model ID…' })
      const list = el('div', { className: 'iw-model-picker-list' })
      const count = el('span', { className: 'iw-model-picker-count', text: String(available.length) })
      let query = ''
      const close = () => { mask.remove(); renderDetail() }
      const render = () => {
        list.innerHTML = ''
        const needle = query.trim().toLowerCase()
        const visible = available.filter(model => !needle || `${model.id} ${model.name}`.toLowerCase().includes(needle))
        count.textContent = String(available.length)
        if (visible.length === 0) {
          list.appendChild(el('div', { className: 'iw-model-picker-empty', text: available.length === 0 ? '没有可添加的模型 / No models left to add' : '没有匹配的模型 / No matching model' }))
          return
        }
        for (const model of visible) {
          const meta = [
            model.contextWindow ? `上下文 ${sizeLabel(model.contextWindow)}` : '',
            model.maxTokens ? `输出 ${sizeLabel(model.maxTokens)}` : '',
            Array.isArray(model.inputTypes) && model.inputTypes.length > 0 ? model.inputTypes.join(' / ') : '',
          ].filter(Boolean).join(' · ')
          const addButton = el('button', {
            className: 'iw-model-picker-add',
            type: 'button',
            title: '添加到该供应商 / Add to provider',
            text: '+',
            onclick: () => {
              if (!provider.models.includes(model.id)) provider.models.push(model.id)
              applyModelCapabilities(provider, model.id, model)
              if (!provider.defaultModel) provider.defaultModel = model.id
              const index = available.indexOf(model)
              if (index >= 0) available.splice(index, 1)
              render()
            },
          })
          list.appendChild(el('div', { className: 'iw-model-picker-row' }, [
            el('span', { className: 'iw-model-picker-icon', text: (provider.name || 'M').trim().slice(0, 1).toUpperCase() }),
            el('div', { className: 'iw-model-picker-main' },
              el('div', { className: 'iw-model-picker-name', text: model.name || model.id }),
              meta ? el('div', { className: 'iw-model-picker-meta', text: meta }) : null),
            addButton,
          ]))
        }
      }
      search.addEventListener('input', () => { query = search.value; render() })
      const picker = el('div', { className: 'iw-model-picker' }, [
        el('div', { className: 'iw-model-picker-head' }, [
          el('div', { className: 'iw-model-picker-title', text: '模型列表 / Available models' }),
          count,
          el('span', { className: 'spacer' }),
          el('button', { className: 'iw-settings-close', type: 'button', text: '×', title: '关闭 / Close', onclick: close }),
        ]),
        el('div', { className: 'iw-model-picker-hint', text: '点击 + 才会加入供应商；直接关闭不会添加 / click + to add' }),
        el('div', { className: 'iw-model-picker-search-wrap' }, [el('span', { className: 'iw-ps-search-icon', text: '⌕' }), search]),
        list,
      ])
      mask.appendChild(picker)
      mask.addEventListener('mousedown', event => { if (event.target === mask) close() })
      document.body.appendChild(mask)
      render()
    }

    function openModelSettings (provider, model) {
      const root = document.getElementById('settings-root')
      if (!root || root.querySelector('.iw-model-settings-mask')) return
      const config = ensureModelConfig(provider, model)
      const draft = {
        ...config,
        displayName: config.displayName || model,
        inputTypes: [...(config.inputTypes || ['text'])],
        reasoning: config.reasoning !== false,
        efforts: [...(config.efforts || [])],
        effortValues: { ...(config.effortValues || {}) },
        defaultEffort: config.defaultEffort || '',
      }
      const close = () => {
        const current = root.querySelector('.iw-model-settings-mask')
        if (current) current.remove()
        renderDetail()
      }
      const error = el('div', { className: 'iw-settings-error' })
      const maxControl = makeSizeControl({
        value: draft.maxTokens,
        min: 256,
        max: 1024 * 1024,
        onChange: value => { draft.maxTokens = value },
      })
      const contextControl = makeSizeControl({
        value: draft.contextWindow,
        min: 1024,
        max: 16 * 1024 * 1024,
        onChange: value => { draft.contextWindow = value },
      })
      const effortWrap = el('div', { className: 'iw-effort-tiers' })
      const tierInputs = new Map()
      for (const id of ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
        const box = el('input', { type: 'checkbox', checked: draft.efforts.includes(id) })
        const valueInput = el('input', {
          className: 'iw-settings-input iw-effort-value',
          value: draft.effortValues[id] || id,
          placeholder: 'API 参数值',
          'aria-label': 'API 参数值 / API value',
        })
        valueInput.addEventListener('input', () => { draft.effortValues[id] = valueInput.value })
        box.addEventListener('change', () => {
          draft.efforts = draft.efforts.filter(item => item !== id)
          if (box.checked) draft.efforts.push(id)
          const order = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
          draft.efforts.sort((a, b) => order.indexOf(a) - order.indexOf(b))
          if (!draft.efforts.includes(draft.defaultEffort)) draft.defaultEffort = draft.efforts[0] || ''
          if (!draft.effortValues[id]) draft.effortValues[id] = id
          renderDefaultEffort()
        })
        tierInputs.set(id, { box, valueInput })
        effortWrap.appendChild(el('div', { className: 'iw-effort-tier' }, [
          el('label', { className: 'iw-effort-label' }, [box, el('span', { text: id })]),
          valueInput,
        ]))
      }
      const reasoningToggle = el('input', { type: 'checkbox', checked: draft.reasoning })
      const syncReasoning = () => {
        draft.reasoning = reasoningToggle.checked
        for (const { box, valueInput } of tierInputs.values()) {
          box.disabled = !draft.reasoning
          valueInput.disabled = !draft.reasoning
        }
      }
      reasoningToggle.addEventListener('change', syncReasoning)
      const displayNameInput = el('input', { className: 'iw-settings-input', value: draft.displayName, placeholder: '显示名称 / Display name' })
      displayNameInput.addEventListener('input', () => { draft.displayName = displayNameInput.value })
      const inputText = el('input', { type: 'checkbox', checked: draft.inputTypes.includes('text') })
      const inputImage = el('input', { type: 'checkbox', checked: draft.inputTypes.includes('image') })
      const syncInputTypes = () => {
        draft.inputTypes = []
        if (inputText.checked) draft.inputTypes.push('text')
        if (inputImage.checked) draft.inputTypes.push('image')
        if (draft.inputTypes.length === 0) { inputText.checked = true; draft.inputTypes.push('text') }
      }
      inputText.addEventListener('change', syncInputTypes)
      inputImage.addEventListener('change', syncInputTypes)
      const defaultEffort = el('select', { className: 'iw-settings-input' })
      const renderDefaultEffort = () => {
        defaultEffort.innerHTML = ''
        if (draft.efforts.length === 0) {
          defaultEffort.appendChild(el('option', { value: '', text: '无 / none' }))
          draft.defaultEffort = ''
        } else {
          for (const id of draft.efforts) defaultEffort.appendChild(el('option', { value: id, text: id }))
          if (!draft.efforts.includes(draft.defaultEffort)) draft.defaultEffort = draft.efforts[0]
        }
        defaultEffort.value = draft.defaultEffort || ''
      }
      defaultEffort.addEventListener('change', () => { draft.defaultEffort = defaultEffort.value })
      renderDefaultEffort()
      syncReasoning()
      const panel = el('div', { className: 'iw-theme-panel iw-model-settings-panel' }, [
        el('div', { className: 'iw-theme-head' }, [
          el('div', null,
            el('h2', { text: '模型设置 / Model settings' }),
            el('div', { className: 'iw-settings-hint', text: model })),
          el('button', { className: 'iw-settings-close', type: 'button', text: '×', title: '关闭 / Close', onclick: close }),
        ]),
        el('div', { className: 'iw-theme-body' }, [
          el('div', { className: 'iw-settings-field' }, [
            el('label', { text: '显示名称 / Display name' }),
            displayNameInput,
          ]),
          el('div', { className: 'iw-metrics-grid' }, [
            el('div', { className: 'iw-metric' }, [
              el('div', { className: 'iw-detail-label' }, [el('span', { text: '最大输出 / Max output tokens' })]),
              maxControl,
              el('div', { className: 'iw-output-hint', text: '仅对该模型生效，支持 K / M。' }),
            ]),
            el('div', { className: 'iw-metric' }, [
              el('div', { className: 'iw-detail-label' }, [el('span', { text: '上下文 / Context window' })]),
              contextControl,
              el('div', { className: 'iw-output-hint', text: '仅对该模型生效，支持 K / M。' }),
            ]),
          ]),
          el('div', { className: 'iw-settings-field' }, [
            el('label', { text: '输入类型 / Input types' }),
            el('div', { className: 'iw-effort-wrap' }, [
              el('label', { className: 'iw-effort-label' }, [inputText, el('span', { text: '文本 / Text' })]),
              el('label', { className: 'iw-effort-label' }, [inputImage, el('span', { text: '图片 / Image' })]),
            ]),
          ]),
          el('div', { className: 'iw-settings-field' }, [
            el('label', { className: 'iw-effort-label' }, [reasoningToggle, el('span', { text: '推理等级 / Reasoning' })]),
            el('div', { className: 'iw-settings-hint', text: '关闭后不发送思考强度参数。' }),
          ]),
          el('div', { className: 'iw-settings-field' }, [
            el('label', { text: '档位与 API 参数值 / Tiers and API values' }),
            effortWrap,
            el('div', { className: 'iw-settings-hint', text: '勾选可用档位，并为每个档位填写实际发送给接口的参数值。' }),
          ]),
          el('div', { className: 'iw-settings-field' }, [
            el('label', { text: '默认强度 / Default effort' }),
            defaultEffort,
          ]),
          error,
        ]),
        el('div', { className: 'iw-theme-foot' }, [
          el('span', { className: 'spacer' }),
          el('button', { className: 'iw-settings-btn', type: 'button', text: '取消 / Cancel', onclick: close }),
          el('button', {
            className: 'iw-settings-btn primary',
            type: 'button',
            text: '保存 / Save',
            onclick: () => {
              if (!Number.isFinite(draft.maxTokens) || !Number.isFinite(draft.contextWindow)) {
                error.textContent = '请填写有效的最大输出与上下文长度 / invalid size'
                return
              }
              provider.modelConfigs[model] = {
                displayName: draft.displayName.trim() || model,
                inputTypes: draft.inputTypes,
                maxTokens: Math.round(draft.maxTokens),
                contextWindow: Math.round(draft.contextWindow),
                reasoning: draft.reasoning,
                efforts: draft.efforts,
                effortValues: draft.effortValues,
                defaultEffort: draft.efforts.includes(draft.defaultEffort) ? draft.defaultEffort : (draft.efforts[0] || ''),
              }
              close()
              renderDetail()
            },
          }),
        ]),
      ])
      const mask = el('div', { className: 'iw-settings-mask iw-model-settings-mask' }, [panel])
      mask.addEventListener('mousedown', event => { if (event.target === mask) close() })
      root.appendChild(mask)
    }

    function renderDetail () {
      detail.innerHTML = ''
      const provider = currentProvider()
      if (!provider) {
        detail.appendChild(el('div', { className: 'iw-ps-empty', text: '还没有供应商 / No provider configured' }))
        return
      }
      const isActive = provider.id === activeId
      const nameTitle = el('input', { className: 'iw-provider-name', value: provider.name, placeholder: '供应商名称 / Provider name', 'aria-label': '供应商名称 / Provider name' })
      nameTitle.addEventListener('input', () => {
        provider.name = nameTitle.value
        const rowName = providerList.querySelector('[data-provider-id="' + provider.id + '"] .iw-ps-name')
        if (rowName) rowName.textContent = nameTitle.value
      })
      nameTitle.addEventListener('change', () => renderProviders())
      function deleteProvider () {
        if (providers.length <= 1) {
          error.textContent = '至少保留一个供应商 / keep at least one provider'
          return
        }
        if (!window.confirm(`删除供应商「${provider.name || provider.id}」？ / Delete this provider?`)) return
        const index = providers.findIndex(item => item.id === provider.id)
        providers.splice(index, 1)
        selectedId = providers[0]?.id || ''
        ensureActive()
        renderProviders()
        renderDetail()
      }
      const head = el('div', { className: 'iw-provider-detail-head' }, [
        el('span', { className: 'iw-detail-logo ' + tone(provider), text: (provider.name || '?').trim().slice(0, 1).toUpperCase() }),
        el('div', { className: 'iw-detail-title' }, [
          el('div', { className: 'iw-name-row' }, [
            el('span', { className: 'iw-name-edit-icon', title: '名称可直接编辑 / Click to edit name' }, [svgIcon('edit', 13)]),
            nameTitle,
          ]),
        ]),
        el('span', { className: 'spacer' }),
        isActive
          ? el('span', { className: 'iw-current-badge', text: '当前使用 / Active' })
          : el('button', {
            className: 'iw-settings-btn',
            type: 'button',
            text: '设为当前 / Use',
            onclick: () => {
              if (provider.models.length === 0) {
                error.textContent = '请先添加至少一个模型 / add at least one model first'
                return
              }
              provider.enabled = true
              activeId = provider.id
              renderProviders()
              renderDetail()
            },
          }),
        el('button', {
          className: 'iw-provider-delete',
          type: 'button',
          title: '删除供应商 / Delete provider',
          'aria-label': '删除供应商 / Delete provider',
          onclick: deleteProvider,
        }, [svgIcon('trash', 15)]),
      ])

      const keyInput = el('input', { className: 'iw-key-input', type: 'password', value: provider.apiKey || '', placeholder: provider.hasApiKey ? '已保存，留空不修改 / Saved, leave blank' : 'sk-… / API Key', autocomplete: 'off' })
      keyInput.addEventListener('input', () => {
        provider.apiKey = keyInput.value
        syncCredentialState()
      })
      const eye = el('button', { className: 'iw-key-eye', type: 'button', text: '显示', title: '显示/隐藏 / Show or hide' })
      eye.addEventListener('click', () => {
        const hidden = keyInput.type === 'password'
        keyInput.type = hidden ? 'text' : 'password'
        eye.textContent = hidden ? '隐藏' : '显示'
      })
      const keyStatus = el('div', { className: 'iw-key-status' })
      const test = el('button', { className: 'iw-key-test', type: 'button', text: '检测 / Test' })
      test.addEventListener('click', async () => {
        const model = provider.models.includes(provider.defaultModel) ? provider.defaultModel : provider.models[0]
        keyStatus.textContent = `检测中 / Testing… ${model || ''}`
        keyStatus.style.color = '#9aa4b2'
        test.disabled = true
        try {
          if (!model) throw new Error('没有可以被检测的模型（例如对话模型）')
          const response = await fetch(API + '/settings/test', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ providerId: provider.id, baseUrl: provider.baseUrl, protocol: provider.protocol || 'chat', model, apiKey: provider.apiKey || '' }),
          })
          const data = await response.json()
          if (!response.ok) throw new Error(data.error || 'failed')
          keyStatus.style.color = '#6fdc9b'
          keyStatus.textContent = '连接成功 / Connected：' + (data.model || model)
        } catch (e) {
          keyStatus.style.color = '#ff8a8a'
          keyStatus.textContent = `检测 ${model} 失败 / Failed：${String(e.message || e)}`
        } finally {
          syncCredentialState()
        }
      })
      const keyRow = el('div', { className: 'iw-key-block' }, [
        el('div', { className: 'iw-detail-label' }, [
          el('span', { text: 'API 密钥 / API Key' }),
        ]),
        el('div', { className: 'iw-key-row' }, [keyInput, eye, test]),
        keyStatus,
      ])

      const baseInput = el('input', { className: 'iw-settings-input', value: provider.baseUrl || '', placeholder: 'https://api.deepseek.com' })
      const previewLine = el('div', { className: 'iw-api-preview', text: '预览 / Preview：' + preview(provider.baseUrl, provider.protocol) })
      baseInput.addEventListener('input', () => {
        provider.baseUrl = baseInput.value
        previewLine.textContent = '预览 / Preview：' + preview(baseInput.value, provider.protocol)
        syncCredentialState()
      })
      const addressBlock = el('div', { className: 'iw-address-block' }, [
        el('div', { className: 'iw-detail-label' }, [el('span', { text: 'API 地址 / API Base URL' })]),
        baseInput,
        previewLine,
      ])
      const protocolSelect = el('select', { className: 'iw-settings-input' }, [
        el('option', { value: 'chat', text: 'OpenAI Chat Completions' }),
        el('option', { value: 'responses', text: 'OpenAI Responses' }),
      ])
      protocolSelect.value = provider.protocol === 'responses' ? 'responses' : 'chat'
      protocolSelect.addEventListener('change', () => {
        provider.protocol = protocolSelect.value
        previewLine.textContent = '预览 / Preview：' + preview(provider.baseUrl, provider.protocol)
      })
      const protocolBlock = el('div', { className: 'iw-address-block' }, [
        el('div', { className: 'iw-detail-label' }, [el('span', { text: 'API 协议 / API protocol' })]),
        protocolSelect,
        el('div', { className: 'iw-output-hint', text: '支持 Chat Completions 与 Responses；按供应商实际协议选择。' }),
      ])

      const modelFetch = el('button', {
        className: 'iw-model-fetch',
        type: 'button',
        text: '↻ 获取模型列表 / Fetch models',
        onclick: async (event) => {
          if (!canFetchModels()) {
            error.textContent = '请先填写 API Key 和 API 地址 / fill API Key and Base URL first'
            return
          }
          const button = event.currentTarget
          button.disabled = true
          button.textContent = '获取中… / Fetching…'
          try {
            const response = await fetch(API + '/settings/models', {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ providerId: provider.id, baseUrl: provider.baseUrl, apiKey: provider.apiKey || '' }),
            })
            const data = await response.json()
            if (!response.ok) throw new Error(data.error || 'failed')
            const fetched = Array.isArray(data.models) ? data.models : []
            openModelPicker(provider, fetched)
          } catch (e) {
            error.textContent = String(e.message || e)
            button.textContent = '↻ 获取模型列表 / Fetch models'
            syncCredentialState()
          }
        },
      })
      function validBase () {
        try {
          const url = new URL(provider.baseUrl)
          return url.protocol === 'http:' || url.protocol === 'https:'
        } catch { return false }
      }
      function canFetchModels () {
        return validBase() && (String(provider.apiKey || '').trim().length > 0 || provider.hasApiKey === true)
      }
      function syncCredentialState () {
        const ready = canFetchModels()
        modelFetch.disabled = !ready
        modelFetch.title = ready ? '' : '请先填写 API Key 和 API 地址 / fill API Key and Base URL first'
        test.disabled = !ready
        test.title = ready ? '' : '请先填写 API Key 和 API 地址 / fill API Key and Base URL first'
      }
      syncCredentialState()
      const modelsBlock = el('div', { className: 'iw-models-block' }, [
        el('div', { className: 'iw-models-head' }, [
          el('span', { className: 'iw-detail-label-title', text: '模型 / Models' }),
          el('span', { className: 'iw-model-count', text: String(provider.models.length) }),
          el('span', { className: 'spacer' }),
          modelFetch,
        ]),
        el('div', { className: 'iw-model-hint', text: '填写 API Key 和 API 地址后可获取模型列表 / Fill API Key and Base URL to fetch models' }),
        renderModels(provider),
      ])

      detail.appendChild(head)
      detail.appendChild(keyRow)
      detail.appendChild(addressBlock)
      detail.appendChild(protocolBlock)
      detail.appendChild(modelsBlock)
    }

    const header = el('div', { className: 'iw-settings-head' }, [
      el('h2', { text: '模型供应商接入 / Model providers' }),
      el('button', { className: 'iw-settings-close', type: 'button', text: '×', title: '关闭 / Close', onclick: close }),
    ])
    const sidebar = el('aside', { className: 'iw-ps-sidebar' }, [
      el('div', { className: 'iw-ps-search-wrap' }, [el('span', { className: 'iw-ps-search-icon', text: '⌕' }), search]),
      providerList,
      el('div', { className: 'iw-ps-footer' }, [add]),
    ])
    const main = el('div', { className: 'iw-settings-main' }, [sidebar, detail])
    const footer = el('div', { className: 'iw-settings-footer' }, [
      error,
      el('div', { className: 'iw-footer-actions' }, [cancel, save]),
    ])
    const panel = el('div', { className: 'iw-settings-panel iw-provider-panel' }, [header, main, footer])
    const mask = el('div', { className: 'iw-settings-mask' }, [panel])
    mask.addEventListener('mousedown', event => { if (event.target === mask) close() })
    root.appendChild(mask)
    add.addEventListener('click', addProvider)
    search.addEventListener('input', () => { filter = search.value; renderProviders() })
    renderProviders()
    renderDetail()

    function collect () {
      if (providers.length === 0) throw new Error('至少保留一个供应商 / keep at least one provider')
      const enabled = providers.filter(item => item.enabled !== false)
      if (enabled.length === 0) throw new Error('至少启用一个供应商 / enable at least one provider')
      const activeProvider = enabled.find(item => item.id === activeId) || enabled[0]
      if (activeProvider.models.length > 0 && !activeProvider.models.includes(activeProvider.defaultModel)) {
        throw new Error('默认模型必须在模型列表中 / default model must be in the model list')
      }
      const model = activeProvider.models.length === 0
        ? ''
        : activeProvider.models.includes(s.active?.model) ? s.active.model : activeProvider.defaultModel
      const activeConfig = model ? ensureModelConfig(activeProvider, model) : null
      const effort = activeConfig?.efforts?.includes(s.active?.reasoningEffort)
        ? s.active.reasoningEffort
        : (activeConfig?.defaultEffort || '')
      return {
        providers: providers.map(provider => {
          const modelConfigs = {}
          for (const item of provider.models) modelConfigs[item] = ensureModelConfig(provider, item)
          return {
            id: provider.id,
            name: provider.name,
            baseUrl: provider.baseUrl,
            protocol: provider.protocol || 'chat',
            apiKey: provider.apiKey,
            models: provider.models,
            modelConfigs,
            defaultModel: provider.defaultModel,
            enabled: provider.enabled !== false,
            docsUrl: provider.docsUrl || '',
          }
        }),
        active: { providerId: activeProvider.id, model, reasoningEffort: effort },
        maxTokens: activeConfig?.maxTokens || 8192,
      }
    }

    save.addEventListener('click', async () => {
      error.textContent = ''
      save.disabled = true
      save.textContent = '保存中… / Saving…'
      try {
        const payload = collect()
        const response = await fetch(API + '/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || '保存失败 / save failed')
        window.location.reload()
      } catch (e) {
        error.style.color = '#ff8a8a'
        error.textContent = String(e.message || e)
        save.disabled = false
        save.textContent = '保存并重载 / Save & reload'
      }
    })

    if (!s.configured) {
      error.textContent = '当前供应商还没有 API Key / active provider has no API Key. 填写后保存并重载。'
    }
  }

  async function initSettings () {
    const root = document.getElementById('settings-root')
    if (!root) return
    try {
      const response = await fetch(API + '/settings')
      if (response.ok) currentSettings = await response.json()
    } catch {}
    // Settings stay closed on first load and refresh; the header entry is the only opener.
  }

  initTheme()
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSettings)
  else setTimeout(initSettings, 0)
})()
