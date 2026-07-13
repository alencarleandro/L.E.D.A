const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { EventEmitter } = require('node:events')

const DEFAULT_SETTINGS = {
  checkIntervalSec: 30,
  timeoutMs: 5000,
  slowThresholdMs: 1200,
  startWithSystem: true,
  notifications: true,
}

function clamp(value, min, max, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function normalizeSettings(settings = {}) {
  return {
    checkIntervalSec: clamp(settings.checkIntervalSec, 10, 3600, DEFAULT_SETTINGS.checkIntervalSec),
    timeoutMs: clamp(settings.timeoutMs, 1000, 30000, DEFAULT_SETTINGS.timeoutMs),
    slowThresholdMs: clamp(settings.slowThresholdMs, 100, 30000, DEFAULT_SETTINGS.slowThresholdMs),
    startWithSystem: settings.startWithSystem ?? DEFAULT_SETTINGS.startWithSystem,
    notifications: settings.notifications ?? DEFAULT_SETTINGS.notifications,
  }
}

function normalizeService(input, previous = {}) {
  const rawUrl = String(input.url ?? previous.url ?? '').trim()
  const parsedUrl = new URL(rawUrl)
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Use uma URL HTTP ou HTTPS válida.')
  }

  const name = String(input.name ?? previous.name ?? '').trim()
  if (!name) throw new Error('Informe um nome para a aplicação.')

  return {
    id: previous.id || crypto.randomUUID(),
    name,
    url: parsedUrl.toString(),
    description: String(input.description ?? previous.description ?? '').trim(),
    expectedStatus: String(input.expectedStatus ?? previous.expectedStatus ?? '200-399').trim(),
    keyword: String(input.keyword ?? previous.keyword ?? '').trim(),
    enabled: input.enabled ?? previous.enabled ?? true,
    createdAt: previous.createdAt || new Date().toISOString(),
  }
}

function matchesExpectedStatus(status, expression = '200-399') {
  return String(expression)
    .split(',')
    .map((part) => part.trim())
    .some((part) => {
      if (/^\d{3}$/.test(part)) return status === Number(part)
      const match = part.match(/^(\d{3})\s*-\s*(\d{3})$/)
      return match ? status >= Number(match[1]) && status <= Number(match[2]) : false
    })
}

async function probeEndpoint(service, settings = DEFAULT_SETTINGS) {
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), settings.timeoutMs)

  try {
    const response = await fetch(service.url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'LEDA-Monitor/0.1' },
    })
    const latency = Date.now() - startedAt
    let keywordFound = true

    if (service.keyword) {
      const body = (await response.text()).slice(0, 250_000)
      keywordFound = body.toLocaleLowerCase().includes(service.keyword.toLocaleLowerCase())
    }

    const statusMatches = matchesExpectedStatus(response.status, service.expectedStatus)
    const ok = statusMatches && keywordFound
    let message = `HTTP ${response.status}`
    if (!statusMatches) message = `Status inesperado: HTTP ${response.status}`
    if (!keywordFound) message = `Conteúdo esperado não encontrado: “${service.keyword}”`

    return { ok, latency, statusCode: response.status, message }
  } catch (error) {
    const latency = Date.now() - startedAt
    const timedOut = error?.name === 'AbortError'
    return {
      ok: false,
      latency,
      statusCode: null,
      message: timedOut ? `Tempo limite de ${settings.timeoutMs} ms excedido` : (error?.message || 'Falha de conexão'),
    }
  } finally {
    clearTimeout(timeout)
  }
}

function calculateUptime(checks = [], now = Date.now()) {
  const cutoff = now - 24 * 60 * 60 * 1000
  const recent = checks.filter((check) => new Date(check.checkedAt).getTime() >= cutoff)
  if (!recent.length) return null
  const successful = recent.filter((check) => check.status === 'online' || check.status === 'degraded').length
  return Number(((successful / recent.length) * 100).toFixed(2))
}

function createInitialState(raw = {}) {
  const services = Array.isArray(raw.services)
    ? raw.services.flatMap((service) => {
        try { return [normalizeService(service, service)] } catch { return [] }
      })
    : []

  return {
    version: 1,
    services,
    checks: raw.checks && typeof raw.checks === 'object' ? raw.checks : {},
    incidents: Array.isArray(raw.incidents) ? raw.incidents.slice(0, 100) : [],
    settings: normalizeSettings(raw.settings),
  }
}

function readState(filePath) {
  try {
    return createInitialState(JSON.parse(fs.readFileSync(filePath, 'utf8')))
  } catch {
    return createInitialState()
  }
}

function writeState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8')
}

function buildSnapshot(state, checkingIds = new Set()) {
  const services = state.services.map((service) => {
    const history = state.checks[service.id] || []
    const latest = history[0] || null
    const effectiveStatus = service.enabled ? (latest?.status || 'unknown') : 'unknown'
    return {
      ...service,
      status: effectiveStatus,
      latency: latest?.latency ?? null,
      statusCode: latest?.statusCode ?? null,
      message: service.enabled ? (latest?.message || 'Aguardando primeira verificação') : 'Monitor pausado',
      lastCheckedAt: latest?.checkedAt || null,
      uptime24h: calculateUptime(history),
      history: history.slice(0, 48),
      checking: checkingIds.has(service.id),
    }
  })

  const enabled = services.filter((service) => service.enabled)
  const knownLatency = enabled.filter((service) => Number.isFinite(service.latency))
  const uptimeValues = enabled.map((service) => service.uptime24h).filter(Number.isFinite)
  const summary = {
    total: enabled.length,
    online: enabled.filter((service) => service.status === 'online').length,
    degraded: enabled.filter((service) => service.status === 'degraded').length,
    offline: enabled.filter((service) => service.status === 'offline').length,
    unknown: enabled.filter((service) => service.status === 'unknown').length,
    avgLatency: knownLatency.length
      ? Math.round(knownLatency.reduce((total, service) => total + service.latency, 0) / knownLatency.length)
      : null,
    uptime24h: uptimeValues.length
      ? Number((uptimeValues.reduce((total, value) => total + value, 0) / uptimeValues.length).toFixed(2))
      : null,
  }

  return {
    services,
    incidents: state.incidents,
    settings: state.settings,
    summary,
    generatedAt: new Date().toISOString(),
  }
}

class HealthMonitor extends EventEmitter {
  constructor({ filePath, probe = probeEndpoint, onAlert = () => {} }) {
    super()
    this.filePath = filePath
    this.probe = probe
    this.onAlert = onAlert
    this.state = readState(filePath)
    this.checkingIds = new Set()
    this.timer = null
  }

  getSnapshot() {
    return buildSnapshot(this.state, this.checkingIds)
  }

  emitSnapshot() {
    this.emit('snapshot', this.getSnapshot())
  }

  persist() {
    writeState(this.filePath, this.state)
  }

  start() {
    this.stop()
    this.checkAll()
    this.timer = setInterval(() => this.checkAll(), this.state.settings.checkIntervalSec * 1000)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  addService(input) {
    const service = normalizeService(input)
    this.state.services.unshift(service)
    this.state.checks[service.id] = []
    this.persist()
    this.emitSnapshot()
    this.checkService(service.id)
    return service
  }

  updateService(id, input) {
    const index = this.state.services.findIndex((service) => service.id === id)
    if (index === -1) throw new Error('Aplicação não encontrada.')
    this.state.services[index] = normalizeService(input, this.state.services[index])
    this.persist()
    this.emitSnapshot()
    this.checkService(id)
    return this.state.services[index]
  }

  removeService(id) {
    this.state.services = this.state.services.filter((service) => service.id !== id)
    delete this.state.checks[id]
    this.persist()
    this.emitSnapshot()
  }

  updateSettings(input) {
    this.state.settings = normalizeSettings({ ...this.state.settings, ...input })
    this.persist()
    this.start()
    this.emitSnapshot()
    return this.state.settings
  }

  async checkAll() {
    const ids = this.state.services.filter((service) => service.enabled).map((service) => service.id)
    await Promise.all(ids.map((id) => this.checkService(id)))
    return this.getSnapshot()
  }

  async checkService(id) {
    const service = this.state.services.find((item) => item.id === id)
    if (!service || !service.enabled || this.checkingIds.has(id)) return this.getSnapshot()

    this.checkingIds.add(id)
    this.emitSnapshot()
    const previous = this.state.checks[id]?.[0] || null
    const result = await this.probe(service, this.state.settings)
    const status = result.ok
      ? (result.latency > this.state.settings.slowThresholdMs ? 'degraded' : 'online')
      : 'offline'
    const check = { ...result, status, checkedAt: new Date().toISOString() }
    this.state.checks[id] = [check, ...(this.state.checks[id] || [])].slice(0, 180)

    if (previous?.status !== status) {
      const incident = {
        id: crypto.randomUUID(),
        serviceId: service.id,
        serviceName: service.name,
        fromStatus: previous?.status || 'unknown',
        toStatus: status,
        message: result.message,
        createdAt: check.checkedAt,
      }
      this.state.incidents = [incident, ...this.state.incidents].slice(0, 100)
      if (previous || status !== 'online') this.onAlert({ service, incident, check })
    }

    this.checkingIds.delete(id)
    this.persist()
    this.emitSnapshot()
    return this.getSnapshot()
  }
}

module.exports = {
  DEFAULT_SETTINGS,
  HealthMonitor,
  buildSnapshot,
  calculateUptime,
  createInitialState,
  matchesExpectedStatus,
  normalizeService,
  normalizeSettings,
  probeEndpoint,
}
