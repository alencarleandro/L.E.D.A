import { useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, Bell, Check, ChevronRight, CircleGauge, Clock3,
  ExternalLink, Gauge, LayoutDashboard, ListChecks, LoaderCircle, LogOut, Menu,
  Pencil, Plus, RefreshCw, Search, ServerCog, Settings, ShieldCheck, Trash2, X, Zap,
} from 'lucide-react'

const STATUS_META = {
  online: { label: 'Operacional', short: 'Online' },
  degraded: { label: 'Desempenho degradado', short: 'Degradado' },
  offline: { label: 'Indisponível', short: 'Offline' },
  unknown: { label: 'Aguardando diagnóstico', short: 'Pendente' },
}

const DEMO_NOW = Date.now()
const demoChecks = (status, latency, pattern) => pattern.map((value, index) => ({
  status: value ? status : 'offline',
  latency: value ? latency + ((index * 17) % 34) : null,
  checkedAt: new Date(DEMO_NOW - index * 30_000).toISOString(),
}))

const DEMO_SNAPSHOT = {
  services: [
    {
      id: 'demo-api', name: 'API Principal', description: 'Gateway e autenticação',
      url: 'https://api.exemplo.com/health', expectedStatus: '200-399', keyword: '', enabled: true,
      status: 'online', latency: 184, statusCode: 200, message: 'HTTP 200', uptime24h: 99.98,
      lastCheckedAt: new Date(DEMO_NOW - 12_000).toISOString(), checking: false,
      history: demoChecks('online', 160, [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]),
    },
    {
      id: 'demo-web', name: 'Portal do Cliente', description: 'Aplicação web de produção',
      url: 'https://app.exemplo.com', expectedStatus: '200-399', keyword: '', enabled: true,
      status: 'degraded', latency: 1487, statusCode: 200, message: 'HTTP 200', uptime24h: 99.72,
      lastCheckedAt: new Date(DEMO_NOW - 18_000).toISOString(), checking: false,
      history: demoChecks('degraded', 1320, [1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1]),
    },
    {
      id: 'demo-worker', name: 'Worker de Pedidos', description: 'Processamento assíncrono',
      url: 'https://worker.exemplo.com/health', expectedStatus: '200-399', keyword: '', enabled: true,
      status: 'online', latency: 92, statusCode: 204, message: 'HTTP 204', uptime24h: 100,
      lastCheckedAt: new Date(DEMO_NOW - 5_000).toISOString(), checking: false,
      history: demoChecks('online', 78, [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]),
    },
  ],
  incidents: [
    { id: 'inc-1', serviceId: 'demo-web', serviceName: 'Portal do Cliente', fromStatus: 'online', toStatus: 'degraded', message: 'Tempo de resposta acima do limite', createdAt: new Date(DEMO_NOW - 24 * 60_000).toISOString() },
    { id: 'inc-2', serviceId: 'demo-api', serviceName: 'API Principal', fromStatus: 'offline', toStatus: 'online', message: 'HTTP 200', createdAt: new Date(DEMO_NOW - 3.4 * 60 * 60_000).toISOString() },
  ],
  settings: { checkIntervalSec: 30, timeoutMs: 5000, slowThresholdMs: 1200, startWithSystem: true, notifications: true },
  summary: { total: 3, online: 2, degraded: 1, offline: 0, unknown: 0, avgLatency: 588, uptime24h: 99.9 },
  generatedAt: new Date().toISOString(),
}

function createDemoBridge(setSnapshot) {
  return {
    getSnapshot: async () => DEMO_SNAPSHOT,
    addService: async (service) => {
      const created = { ...service, id: crypto.randomUUID(), status: 'unknown', history: [], uptime24h: null, checking: false }
      DEMO_SNAPSHOT.services.unshift(created)
      DEMO_SNAPSHOT.summary.total += 1
      setSnapshot({ ...DEMO_SNAPSHOT, services: [...DEMO_SNAPSHOT.services] })
      return created
    },
    updateService: async (id, service) => {
      const index = DEMO_SNAPSHOT.services.findIndex((item) => item.id === id)
      DEMO_SNAPSHOT.services[index] = { ...DEMO_SNAPSHOT.services[index], ...service }
      setSnapshot({ ...DEMO_SNAPSHOT, services: [...DEMO_SNAPSHOT.services] })
    },
    removeService: async (id) => {
      DEMO_SNAPSHOT.services = DEMO_SNAPSHOT.services.filter((item) => item.id !== id)
      DEMO_SNAPSHOT.summary.total = DEMO_SNAPSHOT.services.length
      setSnapshot({ ...DEMO_SNAPSHOT, services: [...DEMO_SNAPSHOT.services] })
    },
    checkNow: async () => DEMO_SNAPSHOT,
    updateSettings: async (settings) => {
      DEMO_SNAPSHOT.settings = { ...DEMO_SNAPSHOT.settings, ...settings }
      setSnapshot({ ...DEMO_SNAPSHOT, settings: { ...DEMO_SNAPSHOT.settings } })
      return DEMO_SNAPSHOT.settings
    },
    onSnapshot: () => () => {},
    quit: async () => {},
  }
}

function formatRelativeDate(value) {
  if (!value) return 'Nunca'
  const diff = Math.max(0, Date.now() - new Date(value).getTime())
  if (diff < 60_000) return 'Agora'
  if (diff < 3_600_000) return `Há ${Math.floor(diff / 60_000)} min`
  if (diff < 86_400_000) return `Há ${Math.floor(diff / 3_600_000)} h`
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function StatusPill({ status = 'unknown', compact = false }) {
  return <span className={`status-pill status-${status}`}><span className="status-dot" />{compact ? STATUS_META[status].short : STATUS_META[status].label}</span>
}

function HistoryBars({ history = [] }) {
  const items = [...history].slice(0, 24).reverse()
  const padded = [...Array(Math.max(0, 24 - items.length)).fill(null), ...items]
  return (
    <div className="history-bars" aria-label="Histórico das últimas verificações">
      {padded.map((check, index) => (
        <span key={`${check?.checkedAt || 'empty'}-${index}`} className={`history-bar history-${check?.status || 'empty'}`} title={check ? `${STATUS_META[check.status].short} • ${check.latency ?? '—'} ms` : 'Sem dados'} />
      ))}
    </div>
  )
}

function MetricCard({ icon: Icon, label, value, detail, tone = 'neutral' }) {
  return <article className={`metric-card metric-${tone}`}><div className="metric-icon"><Icon size={18} /></div><div><span className="metric-label">{label}</span><strong className="metric-value">{value}</strong><small>{detail}</small></div></article>
}

function ServiceCard({ service, onCheck, onEdit, onDelete }) {
  return (
    <article className={`service-card service-${service.status}`}>
      <div className="service-accent" />
      <div className="service-card-head">
        <div className="service-identity"><div className="service-monogram">{service.name.slice(0, 2).toUpperCase()}</div><div><h3>{service.name}</h3><p>{service.description || new URL(service.url).hostname}</p></div></div>
        <StatusPill status={service.status} compact />
      </div>
      <div className="service-url" title={service.url}><span>{service.url}</span><ExternalLink size={14} /></div>
      <HistoryBars history={service.history} />
      <div className="service-stats">
        <div><span>Resposta</span><strong>{service.latency == null ? '—' : `${service.latency} ms`}</strong></div>
        <div><span>Uptime 24h</span><strong>{service.uptime24h == null ? '—' : `${service.uptime24h}%`}</strong></div>
        <div><span>Última checagem</span><strong>{formatRelativeDate(service.lastCheckedAt)}</strong></div>
      </div>
      <div className="service-footer">
        <span className="service-message">{service.message}</span>
        <div className="service-actions">
          <button className="icon-button" onClick={() => onCheck(service.id)} aria-label={`Verificar ${service.name}`} title="Verificar agora"><RefreshCw size={16} className={service.checking ? 'spin' : ''} /></button>
          <button className="icon-button" onClick={() => onEdit(service)} aria-label={`Editar ${service.name}`} title="Editar"><Pencil size={16} /></button>
          <button className="icon-button danger" onClick={() => onDelete(service)} aria-label={`Excluir ${service.name}`} title="Excluir"><Trash2 size={16} /></button>
        </div>
      </div>
    </article>
  )
}

function EmptyState({ onAdd }) {
  return (
    <div className="empty-state">
      <div className="empty-radar"><Activity size={38} /></div><span>PRIMEIRO SINAL</span><h3>Adicione sua primeira aplicação</h3>
      <p>Informe uma URL de health check. A L.E.D.A vai acompanhar disponibilidade, latência e mudanças de estado.</p>
      <button className="primary-button" onClick={onAdd}><Plus size={17} /> Adicionar aplicação</button>
    </div>
  )
}

function ServiceModal({ service, onClose, onSave }) {
  const [form, setForm] = useState({ name: service?.name || '', url: service?.url || '', description: service?.description || '', expectedStatus: service?.expectedStatus || '200-399', keyword: service?.keyword || '', enabled: service?.enabled ?? true })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }))
  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError('')
    try { await onSave(form); onClose() } catch (caught) { setError(caught?.message || 'Não foi possível salvar esta aplicação.') } finally { setSaving(false) }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="service-modal-title">
        <div className="modal-header"><div><span className="eyebrow">MONITOR HTTP</span><h2 id="service-modal-title">{service ? 'Editar aplicação' : 'Nova aplicação'}</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={19} /></button></div>
        <form onSubmit={submit}>
          <div className="field-grid">
            <label className="field"><span>Nome da aplicação</span><input autoFocus required value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Ex.: API de pagamentos" /></label>
            <label className="field field-wide"><span>URL de verificação</span><input required type="url" value={form.url} onChange={(e) => update('url', e.target.value)} placeholder="https://api.seudominio.com/health" /></label>
            <label className="field field-wide"><span>Descrição <small>opcional</small></span><input value={form.description} onChange={(e) => update('description', e.target.value)} placeholder="Uma referência curta para você" /></label>
            <label className="field"><span>Status HTTP esperado</span><input required value={form.expectedStatus} onChange={(e) => update('expectedStatus', e.target.value)} placeholder="200-399" /><small>Use 200, 204 ou intervalos como 200-399</small></label>
            <label className="field"><span>Texto esperado <small>opcional</small></span><input value={form.keyword} onChange={(e) => update('keyword', e.target.value)} placeholder="Ex.: UP" /><small>Confirma se a resposta contém este texto</small></label>
          </div>
          <label className="toggle-row compact-toggle"><span><strong>Monitor ativo</strong><small>Inclui esta aplicação nas verificações automáticas.</small></span><input type="checkbox" checked={form.enabled} onChange={(e) => update('enabled', e.target.checked)} /></label>
          {error && <div className="form-error"><AlertTriangle size={16} /> {error}</div>}
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button type="submit" className="primary-button" disabled={saving}>{saving ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />} {service ? 'Salvar alterações' : 'Começar a monitorar'}</button></div>
        </form>
      </section>
    </div>
  )
}

function Overview({ snapshot, onAdd, onEdit, onDelete, onCheck, setView }) {
  const { summary, services, incidents } = snapshot
  const systemStatus = summary.offline > 0 ? 'offline' : summary.degraded > 0 ? 'degraded' : summary.unknown === summary.total ? 'unknown' : 'online'
  const systemCopy = systemStatus === 'online' ? 'Tudo funcionando como esperado.' : systemStatus === 'degraded' ? 'Há uma aplicação com resposta lenta.' : systemStatus === 'offline' ? 'Uma ou mais aplicações estão indisponíveis.' : 'Adicione aplicações para iniciar o diagnóstico.'

  return (
    <>
      <section className={`health-hero hero-${systemStatus}`}>
        <div className="hero-grid" /><div className="health-orbit"><div className="health-core"><Activity size={28} /></div></div>
        <div className="hero-copy"><span className="eyebrow">DIAGNÓSTICO GERAL</span><h1>{STATUS_META[systemStatus].label}</h1><p>{systemCopy}</p></div>
        <div className="hero-side"><span>PRÓXIMA VARREDURA</span><strong>em até {snapshot.settings.checkIntervalSec}s</strong><button className="ghost-button" onClick={() => onCheck()}><RefreshCw size={15} /> Verificar tudo agora</button></div>
      </section>
      <section className="metric-grid" aria-label="Resumo do ambiente">
        <MetricCard icon={ShieldCheck} label="Aplicações online" value={`${summary.online}/${summary.total}`} detail={summary.total ? 'serviços monitorados' : 'nenhum monitor ainda'} tone="positive" />
        <MetricCard icon={AlertTriangle} label="Alertas ativos" value={summary.offline + summary.degraded} detail={summary.offline ? `${summary.offline} indisponível` : summary.degraded ? `${summary.degraded} com lentidão` : 'ambiente estável'} tone={summary.offline + summary.degraded ? 'warning' : 'neutral'} />
        <MetricCard icon={CircleGauge} label="Uptime médio" value={summary.uptime24h == null ? '—' : `${summary.uptime24h}%`} detail="últimas 24 horas" />
        <MetricCard icon={Zap} label="Tempo de resposta" value={summary.avgLatency == null ? '—' : `${summary.avgLatency} ms`} detail="média da última checagem" />
      </section>
      <section className="section-block">
        <div className="section-heading"><div><span className="eyebrow">AMBIENTE</span><h2>Aplicações monitoradas</h2></div><div className="section-actions"><button className="text-button" onClick={() => setView('applications')}>Ver todas <ChevronRight size={15} /></button><button className="primary-button compact" onClick={onAdd}><Plus size={16} /> Adicionar</button></div></div>
        {services.length ? <div className="service-grid">{services.slice(0, 6).map((service) => <ServiceCard key={service.id} service={service} onCheck={onCheck} onEdit={onEdit} onDelete={onDelete} />)}</div> : <EmptyState onAdd={onAdd} />}
      </section>
      <section className="section-block activity-block">
        <div className="section-heading"><div><span className="eyebrow">LINHA DO TEMPO</span><h2>Atividade recente</h2></div><button className="text-button" onClick={() => setView('incidents')}>Ver histórico <ChevronRight size={15} /></button></div>
        {incidents.length ? <IncidentList incidents={incidents.slice(0, 5)} /> : <div className="quiet-state"><Check size={17} /> Nenhuma mudança de estado registrada até agora.</div>}
      </section>
    </>
  )
}

function IncidentList({ incidents }) {
  return (
    <div className="incident-list">
      {incidents.map((incident) => {
        const recovered = incident.toStatus === 'online'
        return <div className="incident-row" key={incident.id}><div className={`incident-icon ${recovered ? 'recovered' : incident.toStatus}`}>{recovered ? <Check size={16} /> : <AlertTriangle size={16} />}</div><div className="incident-copy"><strong>{incident.serviceName}</strong><span>{recovered ? 'Operação normalizada' : STATUS_META[incident.toStatus]?.label} · {incident.message}</span></div><time>{formatRelativeDate(incident.createdAt)}</time></div>
      })}
    </div>
  )
}

function ApplicationsView({ snapshot, query, onAdd, onEdit, onDelete, onCheck }) {
  const filtered = snapshot.services.filter((service) => `${service.name} ${service.url}`.toLowerCase().includes(query.toLowerCase()))
  return (
    <section className="page-section">
      <div className="page-intro"><div><span className="eyebrow">INVENTÁRIO</span><h1>Aplicações</h1><p>Todos os endpoints que a L.E.D.A acompanha nesta máquina.</p></div><button className="primary-button" onClick={onAdd}><Plus size={17} /> Nova aplicação</button></div>
      {filtered.length ? <div className="service-grid wide-grid">{filtered.map((service) => <ServiceCard key={service.id} service={service} onCheck={onCheck} onEdit={onEdit} onDelete={onDelete} />)}</div> : snapshot.services.length ? <div className="empty-state small"><Search size={32} /><h3>Nenhum resultado</h3><p>Tente buscar por outro nome ou endereço.</p></div> : <EmptyState onAdd={onAdd} />}
    </section>
  )
}

function IncidentsView({ incidents }) {
  return <section className="page-section"><div className="page-intro"><div><span className="eyebrow">EVENTOS</span><h1>Histórico de incidentes</h1><p>Mudanças de disponibilidade e desempenho registradas pela L.E.D.A.</p></div></div><div className="panel incident-panel">{incidents.length ? <IncidentList incidents={incidents} /> : <div className="empty-state small"><ShieldCheck size={34} /><h3>Nenhum incidente registrado</h3><p>As mudanças de estado aparecerão aqui.</p></div>}</div></section>
}

function SettingsView({ settings, onSave, onQuit, isDemo }) {
  const [form, setForm] = useState(settings)
  const [saved, setSaved] = useState(false)
  useEffect(() => setForm(settings), [settings])
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }))
  const submit = async (event) => { event.preventDefault(); await onSave(form); setSaved(true); setTimeout(() => setSaved(false), 2200) }
  return (
    <section className="page-section settings-page">
      <div className="page-intro"><div><span className="eyebrow">PREFERÊNCIAS</span><h1>Configurações</h1><p>Ajuste o ritmo das checagens e como a L.E.D.A deve avisar você.</p></div></div>
      <form className="settings-layout" onSubmit={submit}>
        <div className="panel settings-panel"><div className="panel-title"><Clock3 size={18} /><div><h2>Monitoramento</h2><p>Frequência e tolerância das verificações.</p></div></div><div className="field-grid settings-fields">
          <label className="field"><span>Intervalo entre checagens</span><div className="input-suffix"><input type="number" min="10" max="3600" value={form.checkIntervalSec} onChange={(e) => update('checkIntervalSec', Number(e.target.value))} /><span>segundos</span></div><small>Mínimo recomendado: 30 segundos</small></label>
          <label className="field"><span>Tempo limite da requisição</span><div className="input-suffix"><input type="number" min="1000" max="30000" step="500" value={form.timeoutMs} onChange={(e) => update('timeoutMs', Number(e.target.value))} /><span>ms</span></div></label>
          <label className="field"><span>Considerar resposta lenta após</span><div className="input-suffix"><input type="number" min="100" max="30000" step="100" value={form.slowThresholdMs} onChange={(e) => update('slowThresholdMs', Number(e.target.value))} /><span>ms</span></div></label>
        </div></div>
        <div className="panel settings-panel"><div className="panel-title"><Bell size={18} /><div><h2>Sistema e alertas</h2><p>Mantenha a sentinela ativa em segundo plano.</p></div></div>
          <label className="toggle-row"><span><strong>Iniciar com o Windows</strong><small>{isDemo ? 'Será aplicado na versão instalada.' : 'A L.E.D.A inicia minimizada e continua monitorando.'}</small></span><input type="checkbox" checked={form.startWithSystem} onChange={(e) => update('startWithSystem', e.target.checked)} /></label>
          <label className="toggle-row"><span><strong>Notificações do sistema</strong><small>Receba alertas quando uma aplicação cair ou se recuperar.</small></span><input type="checkbox" checked={form.notifications} onChange={(e) => update('notifications', e.target.checked)} /></label>
        </div>
        <div className="settings-actions"><button type="submit" className="primary-button">{saved ? <Check size={17} /> : <Settings size={17} />} {saved ? 'Configurações salvas' : 'Salvar configurações'}</button>{!isDemo && <button type="button" className="danger-button" onClick={onQuit}><LogOut size={16} /> Encerrar L.E.D.A</button>}</div>
      </form>
    </section>
  )
}

const NAV_ITEMS = [
  { id: 'overview', label: 'Visão geral', icon: LayoutDashboard },
  { id: 'applications', label: 'Aplicações', icon: ServerCog },
  { id: 'incidents', label: 'Incidentes', icon: ListChecks },
  { id: 'settings', label: 'Configurações', icon: Settings },
]

export default function App() {
  const [snapshot, setSnapshot] = useState(null)
  const [view, setView] = useState('overview')
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const isDemo = !window.leda
  const api = useMemo(() => window.leda || createDemoBridge(setSnapshot), [])

  useEffect(() => {
    api.getSnapshot().then(setSnapshot).catch((error) => setToast({ type: 'error', message: error.message }))
    return api.onSnapshot(setSnapshot)
  }, [api])

  const notify = (message, type = 'success') => { setToast({ message, type }); setTimeout(() => setToast(null), 3000) }
  const saveService = async (form) => { if (modal?.id) await api.updateService(modal.id, form); else await api.addService(form); notify(modal?.id ? 'Aplicação atualizada.' : 'Aplicação adicionada ao monitoramento.') }
  const deleteService = async (service) => { if (!window.confirm(`Remover “${service.name}” do monitoramento?`)) return; await api.removeService(service.id); notify('Aplicação removida.') }
  const checkNow = async (id) => { await api.checkNow(id); notify(id ? 'Verificação concluída.' : 'Varredura completa concluída.') }

  if (!snapshot) return <div className="app-loader"><div className="loader-mark"><Activity size={30} /></div><strong>L.E.D.A</strong><span>Inicializando diagnóstico...</span></div>

  const status = snapshot.summary.offline ? 'offline' : snapshot.summary.degraded ? 'degraded' : 'online'
  const viewTitle = NAV_ITEMS.find((item) => item.id === view)?.label

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="brand"><div className="brand-mark"><Activity size={22} /></div><div><strong>L.E.D.A</strong><span>HEALTH MONITOR</span></div></div>
        <nav aria-label="Navegação principal">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'active' : ''} onClick={() => { setView(id); setSidebarOpen(false) }}><Icon size={18} /><span>{label}</span>{id === 'incidents' && snapshot.summary.offline + snapshot.summary.degraded > 0 && <b>{snapshot.summary.offline + snapshot.summary.degraded}</b>}</button>)}
        </nav>
        <div className="sidebar-spacer" /><div className={`sentinel-card sentinel-${status}`}><div className="sentinel-head"><Gauge size={17} /><span>SENTINELA ATIVA</span></div><strong>{snapshot.summary.total} {snapshot.summary.total === 1 ? 'alvo' : 'alvos'}</strong><small>checagem a cada {snapshot.settings.checkIntervalSec}s</small></div><div className="sidebar-footer"><span>LEDA CORE</span><b>v0.1.0</b></div>
      </aside>
      {sidebarOpen && <button className="sidebar-scrim" aria-label="Fechar menu" onClick={() => setSidebarOpen(false)} />}
      <main className="main-area">
        <header className="topbar"><div className="topbar-left"><button className="mobile-menu icon-button" onClick={() => setSidebarOpen(true)} aria-label="Abrir menu"><Menu size={20} /></button><div className="breadcrumb"><span>LEDA</span><ChevronRight size={13} /><strong>{viewTitle}</strong></div></div><div className="topbar-actions"><label className="search-box"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar aplicação..." aria-label="Buscar aplicação" /></label>{isDemo && <span className="demo-badge">PRÉVIA</span>}<button className="icon-button notification-button" aria-label="Notificações"><Bell size={18} />{snapshot.summary.offline + snapshot.summary.degraded > 0 && <span />}</button><button className="primary-button compact top-add" onClick={() => setModal({})}><Plus size={16} /> Nova aplicação</button></div></header>
        <div className="content">
          {view === 'overview' && <Overview snapshot={snapshot} onAdd={() => setModal({})} onEdit={setModal} onDelete={deleteService} onCheck={checkNow} setView={setView} />}
          {view === 'applications' && <ApplicationsView snapshot={snapshot} query={query} onAdd={() => setModal({})} onEdit={setModal} onDelete={deleteService} onCheck={checkNow} />}
          {view === 'incidents' && <IncidentsView incidents={snapshot.incidents} />}
          {view === 'settings' && <SettingsView settings={snapshot.settings} onSave={(settings) => api.updateSettings(settings)} onQuit={() => api.quit()} isDemo={isDemo} />}
        </div>
      </main>
      {modal && <ServiceModal service={modal.id ? modal : null} onClose={() => setModal(null)} onSave={saveService} />}
      {toast && <div className={`toast toast-${toast.type}`}><Check size={17} /><span>{toast.message}</span></div>}
    </div>
  )
}
