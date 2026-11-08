/**
 * Durable task store.
 *
 * One JSON index holds every task's metadata, analysis state, chat history and
 * material descriptors. Extracted text and the original files live beside it so
 * a large case does not turn the index into a multi-megabyte document. Writes
 * are atomic (tmp + rename) and coalesced, so a streaming analysis can update
 * the index without writing once per token.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const STATE_VERSION = 1

function newId (prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`
}

function safeName (name) {
  const base = String(name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim()
  return base.length > 0 ? base.slice(0, 120) : 'file'
}

async function writeAtomic (file, content) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  try {
    await fs.writeFile(tmp, content, 'utf8')
    await fs.rename(tmp, file)
  } catch (error) {
    await fs.unlink(tmp).catch(() => {})
    throw error
  }
}

function processAlive (pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

/**
 * Remove zero-byte state temp files left by a process that died between
 * writeFile and rename. Only dead owners (or files older than a day) are
 * touched, so a concurrently running instance keeps its in-flight temp file.
 */
async function cleanupStaleTemps (dataDir, logger) {
  let entries
  try {
    entries = await fs.readdir(dataDir, { withFileTypes: true })
  } catch {
    return
  }
  const now = Date.now()
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith('state.json.tmp-')) continue
    const match = /^state\.json\.tmp-(\d+)-\d+$/.exec(entry.name)
    if (!match) continue
    const pid = Number(match[1])
    const file = path.join(dataDir, entry.name)
    let stat
    try {
      stat = await fs.stat(file)
    } catch {
      continue
    }
    if (stat.size !== 0) continue
    if (processAlive(pid) && now - stat.mtimeMs < 24 * 60 * 60 * 1000) continue
    try {
      await fs.unlink(file)
      logger.warn?.(`[infection-workbench] 清理残留临时文件：${entry.name}`)
    } catch {}
  }
}

export async function createStore ({ dataDir, logger = console }) {
  const stateFile = path.join(dataDir, 'state.json')
  const tasksDir = path.join(dataDir, 'tasks')
  await fs.mkdir(tasksDir, { recursive: true })
  await cleanupStaleTemps(dataDir, logger)

  let state = { version: STATE_VERSION, tasks: [] }
  try {
    const raw = await fs.readFile(stateFile, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && Array.isArray(parsed.tasks)) state = parsed
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      logger.warn?.(`[infection-workbench] state.json 无法解析，已另存备份：${error?.message || error}`)
      await fs.rename(stateFile, `${stateFile}.broken-${Date.now()}`).catch(() => {})
    }
  }

  let pending = Promise.resolve()
  let scheduled = null

  const persistNow = () => {
    pending = pending.then(() => writeAtomic(stateFile, JSON.stringify(state, null, 2))).catch((error) => {
      logger.error?.(`[infection-workbench] 保存任务状态失败：${error?.message || error}`)
    })
    return pending
  }

  const save = () => {
    if (scheduled !== null) clearTimeout(scheduled)
    scheduled = setTimeout(() => { scheduled = null; void persistNow() }, 120)
    return pending
  }

  const flush = async () => {
    if (scheduled !== null) { clearTimeout(scheduled); scheduled = null }
    await persistNow()
  }

  const find = (id) => state.tasks.find(task => task.id === id)

  const taskDir = (id) => path.join(tasksDir, id)
  const filesDir = (id) => path.join(taskDir(id), 'files')
  const textDir = (id) => path.join(taskDir(id), 'text')

  const store = {
    dataDir,
    get state () { return state },

    list () {
      return [...state.tasks]
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .map(task => ({
          id: task.id,
          title: task.title,
          patientName: task.patientName || '',
          sex: task.sex || '',
          age: task.age || '',
          note: task.note || '',
          group: task.group || '',
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          materialCount: task.materials.length,
          materialChars: task.materials.reduce((sum, m) => sum + (m.chars || 0), 0),
          analysisStatus: task.analysis.status,
          reportAt: task.analysis.finishedAt || null,
          chatCount: task.chat.length,
        }))
    },

    get (id) {
      return find(id)
    },

    async create (input = {}) {
      const now = Date.now()
      const task = {
        id: newId('case'),
        title: String(input.title || '').trim() || `未命名病例 ${new Date(now).toLocaleDateString('zh-CN')}`,
        patientName: String(input.patientName || '').trim(),
        sex: String(input.sex || '').trim(),
        age: String(input.age || '').trim(),
        group: String(input.group || '').trim(),
        note: String(input.note || '').trim(),
        createdAt: now,
        updatedAt: now,
        materials: [],
        analysis: {
          status: 'idle',
          stages: [],
          startedAt: null,
          finishedAt: null,
          model: '',
          facts: '',
          reportChars: 0,
          error: '',
          usage: null,
        },
        chat: [],
        chatSummary: '',
        chatSummaryAt: null,
        chatSummaryCount: 0,
        chatCompactions: 0,
        chatContext: null,
      }
      state.tasks.push(task)
      await fs.mkdir(filesDir(task.id), { recursive: true })
      await fs.mkdir(textDir(task.id), { recursive: true })
      await store.flush()
      return task
    },

    async update (id, patch = {}) {
      const task = find(id)
      if (!task) throw new Error('任务不存在或已被删除')
      for (const key of ['title', 'patientName', 'sex', 'age', 'note', 'group']) {
        if (patch[key] !== undefined) task[key] = String(patch[key]).trim()
      }
      task.updatedAt = Date.now()
      await store.flush()
      return task
    },

    async renameGroup (from, to) {
      const source = String(from || '').trim()
      const target = String(to || '').trim()
      if (!source) throw new Error('当前分组为空，无法重命名')
      if (!target) throw new Error('新分组名不能为空')
      if (source === target) return { updated: 0, from: source, to: target }
      const affected = state.tasks.filter(task => String(task.group || '').trim() === source)
      if (affected.length === 0) throw new Error('没有找到该分组下的任务')
      const now = Date.now()
      for (const task of affected) {
        task.group = target
        task.updatedAt = now
      }
      await store.flush()
      return { updated: affected.length, from: source, to: target }
    },

    async remove (id) {
      const index = state.tasks.findIndex(task => task.id === id)
      if (index < 0) return false
      state.tasks.splice(index, 1)
      await store.flush()
      await fs.rm(taskDir(id), { recursive: true, force: true }).catch(() => {})
      return true
    },

    async addMaterial (id, input) {
      const task = find(id)
      if (!task) throw new Error('任务不存在或已被删除')
      const material = {
        id: newId('mat'),
        name: input.name,
        rel: input.rel || '',
        ext: input.ext,
        bytes: input.bytes || 0,
        chars: input.chars || 0,
        status: input.status || 'parsed',
        warnings: input.warnings || [],
        error: input.error || '',
        addedAt: Date.now(),
        storedName: input.storedName || '',
      }
      task.materials.push(material)
      task.updatedAt = Date.now()
      await store.flush()
      return material
    },

    async updateMaterial (id, materialId, patch) {
      const task = find(id)
      if (!task) return undefined
      const material = task.materials.find(m => m.id === materialId)
      if (!material) return undefined
      Object.assign(material, patch)
      task.updatedAt = Date.now()
      await store.flush()
      return material
    },

    async removeMaterial (id, materialId) {
      const task = find(id)
      if (!task) return false
      const index = task.materials.findIndex(m => m.id === materialId)
      if (index < 0) return false
      const [material] = task.materials.splice(index, 1)
      task.updatedAt = Date.now()
      await store.flush()
      await fs.rm(path.join(filesDir(id), material.storedName || material.id), { force: true }).catch(() => {})
      await fs.rm(store.textPath(id, material), { force: true }).catch(() => {})
      return true
    },

    async setAnalysis (id, patch) {
      const task = find(id)
      if (!task) return undefined
      const next = { ...task.analysis }
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue
        next[key] = value
      }
      task.analysis = next
      task.updatedAt = Date.now()
      await store.flush()
      return task.analysis
    },

    async appendChat (id, message) {
      const task = find(id)
      if (!task) return undefined
      const entry = { id: newId('msg'), at: Date.now(), ...message }
      task.chat.push(entry)
      task.updatedAt = Date.now()
      await store.flush()
      return entry
    },

    async updateChat (id, messageId, patch) {
      const task = find(id)
      if (!task) return undefined
      const message = task.chat.find(m => m.id === messageId)
      if (!message) return undefined
      Object.assign(message, patch)
      task.updatedAt = Date.now()
      await store.flush()
      return message
    },

    chatSummary (id) {
      const task = find(id)
      return task
        ? { summary: task.chatSummary || '', at: task.chatSummaryAt || null, count: task.chatSummaryCount || 0, compactions: task.chatCompactions || 0 }
        : { summary: '', at: null, count: 0, compactions: 0 }
    },

    async setChatSummary (id, summary, { compactions, count } = {}) {
      const task = find(id)
      if (!task) return false
      task.chatSummary = String(summary || '')
      task.chatSummaryAt = task.chatSummary ? Date.now() : null
      if (Number.isFinite(count)) task.chatSummaryCount = count
      if (Number.isFinite(compactions)) task.chatCompactions = compactions
      task.updatedAt = Date.now()
      await store.flush()
      return true
    },

    chatContext (id) {
      const task = find(id)
      return task?.chatContext || null
    },

    async setChatContext (id, context) {
      const task = find(id)
      if (!task) return false
      task.chatContext = context || null
      await store.flush()
      return true
    },

    async clearChat (id) {
      const task = find(id)
      if (!task) return false
      task.chat = []
      task.chatSummary = ''
      task.chatSummaryAt = null
      task.chatSummaryCount = 0
      task.chatCompactions = 0
      task.chatContext = null
      task.updatedAt = Date.now()
      await store.flush()
      return true
    },

    taskDir,
    filesDir,
    textDir,
    textPath (id, material) {
      return path.join(textDir(id), `${material.id}.txt`)
    },
    reportPath (id, format) {
      return path.join(taskDir(id), `院感分析报告.${format}`)
    },
    async writeText (id, material, text) {
      await fs.mkdir(textDir(id), { recursive: true })
      await fs.writeFile(store.textPath(id, material), text, 'utf8')
    },
    async readText (id, material) {
      try {
        return await fs.readFile(store.textPath(id, material), 'utf8')
      } catch {
        return ''
      }
    },
    async writePiece (id, name, content) {
      await fs.mkdir(taskDir(id), { recursive: true })
      const file = path.join(taskDir(id), safeName(name))
      await writeAtomic(file, content)
      return file
    },
    safeName,
    flush,
  }

  // Repair a task that was mid-analysis when the host stopped.
  let repaired = false
  for (const task of state.tasks) {
    if (task.analysis?.status === 'running') {
      task.analysis.status = 'error'
      task.analysis.error = '上次分析因程序重启中断，请重新分析'
      repaired = true
    }
    for (const message of task.chat || []) {
      if (message.pending) {
        message.pending = false
        message.error = message.error || '上次回答因程序重启中断'
        repaired = true
      }
    }
  }
  if (repaired) await store.flush()

  return store
}
