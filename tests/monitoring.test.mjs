import assert from 'node:assert/strict'
import http from 'node:http'
import { createRequire } from 'node:module'
import { after, before, describe, it } from 'node:test'

const require = createRequire(import.meta.url)
const { buildSnapshot, calculateUptime, matchesExpectedStatus, normalizeService, probeEndpoint } = require('../electron/monitoring.cjs')

describe('regras de monitoramento', () => {
  it('aceita status isolados e intervalos', () => {
    assert.equal(matchesExpectedStatus(204, '200-299'), true)
    assert.equal(matchesExpectedStatus(302, '200, 300-399'), true)
    assert.equal(matchesExpectedStatus(503, '200-399'), false)
  })

  it('normaliza URLs e rejeita protocolos não HTTP', () => {
    const service = normalizeService({ name: 'API', url: 'https://example.com/health' })
    assert.equal(service.url, 'https://example.com/health')
    assert.throws(() => normalizeService({ name: 'Arquivo', url: 'file:///tmp/status' }))
  })

  it('calcula uptime das últimas 24 horas', () => {
    const now = Date.now()
    const checks = [
      { status: 'online', checkedAt: new Date(now - 1_000).toISOString() },
      { status: 'online', checkedAt: new Date(now - 2_000).toISOString() },
      { status: 'offline', checkedAt: new Date(now - 3_000).toISOString() },
      { status: 'offline', checkedAt: new Date(now - 26 * 60 * 60 * 1000).toISOString() },
    ]
    assert.equal(calculateUptime(checks, now), 66.67)
  })

  it('gera um resumo consolidado', () => {
    const state = {
      services: [
        { id: 'a', name: 'A', url: 'https://a.test/', enabled: true },
        { id: 'b', name: 'B', url: 'https://b.test/', enabled: true },
      ],
      checks: {
        a: [{ status: 'online', latency: 100, checkedAt: new Date().toISOString() }],
        b: [{ status: 'offline', latency: 300, checkedAt: new Date().toISOString() }],
      },
      incidents: [],
      settings: { checkIntervalSec: 30 },
    }
    const snapshot = buildSnapshot(state)
    assert.equal(snapshot.summary.total, 2)
    assert.equal(snapshot.summary.online, 1)
    assert.equal(snapshot.summary.offline, 1)
    assert.equal(snapshot.summary.avgLatency, 200)
  })
})

describe('sondagem HTTP', () => {
  let server
  let baseUrl

  before(async () => {
    server = http.createServer((request, response) => {
      if (request.url === '/health') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"status":"UP"}')
      } else {
        response.writeHead(503)
        response.end('unavailable')
      }
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${server.address().port}`
  })

  after(async () => new Promise((resolve) => server.close(resolve)))

  it('valida status e conteúdo esperado', async () => {
    const result = await probeEndpoint({ url: `${baseUrl}/health`, expectedStatus: '200', keyword: 'UP' }, { timeoutMs: 1000 })
    assert.equal(result.ok, true)
    assert.equal(result.statusCode, 200)
  })

  it('marca um status HTTP inesperado como falha', async () => {
    const result = await probeEndpoint({ url: `${baseUrl}/offline`, expectedStatus: '200-399', keyword: '' }, { timeoutMs: 1000 })
    assert.equal(result.ok, false)
    assert.equal(result.statusCode, 503)
  })
})
