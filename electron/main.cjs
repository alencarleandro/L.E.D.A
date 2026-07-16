const path = require('node:path')
const { execFile } = require('node:child_process')
const { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, screen, session, shell, Tray } = require('electron')
const { HealthMonitor } = require('./monitoring.cjs')

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

let mainWindow = null
let monitor = null
let tray = null
let alertWindow = null
let isQuitting = false
let alarmTimer = null
let alarmSilenced = false
let alarmSimulation = false
const WINDOWS_RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const WINDOWS_RUN_VALUE = 'LEDA Health Monitor'
const APP_ICON_PATH = path.join(__dirname, 'assets', 'app-icon.png')

function createTrayIcon() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-icon.png'))
  if (icon.isEmpty()) throw new Error('Não foi possível carregar o ícone da bandeja.')
  return icon.resize({ width: 16, height: 16 })
}

function getTrayStatus(snapshot = monitor?.getSnapshot()) {
  if (!snapshot || snapshot.summary.total === 0) return 'Nenhuma aplicação monitorada'
  const { online, degraded, offline, total } = snapshot.summary
  if (offline) return `${offline} aplicação(ões) indisponível(is)`
  if (degraded) return `${degraded} aplicação(ões) com desempenho degradado`
  return `${online}/${total} aplicações operacionais`
}

function buildTrayMenu(snapshot = monitor?.getSnapshot()) {
  const settings = snapshot?.settings || monitor?.state.settings
  return Menu.buildFromTemplate([
    { label: 'L.E.D.A — Health Monitor', enabled: false },
    { label: getTrayStatus(snapshot), enabled: false },
    { type: 'separator' },
    { label: 'Abrir painel', click: () => createWindow({ show: true }) },
    { label: 'Verificar tudo agora', click: () => monitor?.checkAll() },
    { type: 'separator' },
    {
      label: 'Iniciar com o Windows',
      type: 'checkbox',
      checked: Boolean(settings?.startWithSystem),
      click: (item) => {
        const updated = monitor?.updateSettings({ startWithSystem: item.checked })
        if (updated) applyAutoLaunch(updated.startWithSystem)
      },
    },
    { type: 'separator' },
    {
      label: 'Encerrar L.E.D.A',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])
}

function updateTray(snapshot = monitor?.getSnapshot()) {
  if (!tray) return
  tray.setToolTip(`L.E.D.A — ${getTrayStatus(snapshot)}`)
  tray.setContextMenu(buildTrayMenu(snapshot))
}

function createTray() {
  if (tray) return tray
  tray = new Tray(createTrayIcon())
  tray.on('click', () => createWindow({ show: true }))
  tray.on('double-click', () => createWindow({ show: true }))
  updateTray()
  return tray
}

function createWindow({ show = true } = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (show) {
      mainWindow.show()
      mainWindow.focus()
    }
    return mainWindow
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: '#090a0b',
    title: 'L.E.D.A',
    icon: APP_ICON_PATH,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) mainWindow.loadURL(devUrl)
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))

  mainWindow.once('ready-to-show', () => {
    if (show) mainWindow.show()
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow.hide()
    }
  })

  mainWindow.on('closed', () => { mainWindow = null })
  return mainWindow
}

function applyAutoLaunch(enabled) {
  if (!app.isPackaged) return
  const startupArgs = ['--start-hidden']
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    enabled: Boolean(enabled),
    name: 'LEDA Health Monitor',
    path: process.execPath,
    args: startupArgs,
  })

  if (process.platform === 'win32') {
    const args = enabled
      ? ['add', WINDOWS_RUN_KEY, '/v', WINDOWS_RUN_VALUE, '/t', 'REG_SZ', '/d', `"${process.execPath}" --start-hidden`, '/f']
      : ['delete', WINDOWS_RUN_KEY, '/v', WINDOWS_RUN_VALUE, '/f']
    execFile('reg.exe', args, { windowsHide: true }, () => {})
  }
}

function withAlarm(snapshot = monitor?.getSnapshot()) {
  if (!snapshot) return snapshot
  return {
    ...snapshot,
    alarm: {
      active: Boolean(alarmTimer),
      silenced: alarmSilenced,
      simulation: alarmSimulation,
    },
  }
}

function sendSnapshot(snapshot = monitor?.getSnapshot()) {
  updateTray(snapshot)
  if (mainWindow && !mainWindow.isDestroyed() && snapshot) {
    mainWindow.webContents.send('leda:snapshot', withAlarm(snapshot))
  }
}

function stopCriticalAlarm({ rearm = false } = {}) {
  if (alarmTimer) clearInterval(alarmTimer)
  alarmTimer = null
  alarmSimulation = false
  if (alertWindow && !alertWindow.isDestroyed()) alertWindow.destroy()
  alertWindow = null
  if (rearm) alarmSilenced = false
  mainWindow?.flashFrame(false)
}

function createCriticalAlertWindow(service, simulation) {
  if (alertWindow && !alertWindow.isDestroyed()) return alertWindow
  alertWindow = new BrowserWindow({
    width: 1000,
    height: 640,
    minWidth: 800,
    minHeight: 520,
    show: false,
    fullscreen: true,
    kiosk: true,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    backgroundColor: '#190605',
    title: 'L.E.D.A • Alerta crítico',
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'alarm-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  alertWindow.setBounds(display.bounds)
  alertWindow.setKiosk(true)
  alertWindow.setFullScreen(true)
  alertWindow.setAlwaysOnTop(true, 'screen-saver')
  alertWindow.loadFile(path.join(__dirname, 'alarm.html'), {
    query: { service: service.name, simulation: String(simulation) },
  })
  alertWindow.show()
  alertWindow.focus()
  alertWindow.on('close', (event) => {
    event.preventDefault()
    alertWindow.focus()
  })
  alertWindow.on('closed', () => { alertWindow = null })
  return alertWindow
}

function startCriticalAlarm(service, { force = false, simulation = false } = {}) {
  if ((!monitor?.state.settings.criticalAlarm && !force) || alarmSilenced || alarmTimer) return
  alarmSimulation = simulation
  const alert = () => {
    shell.beep()
    mainWindow?.flashFrame(true)
  }
  alert()
  alarmTimer = setInterval(alert, 4000)
  createCriticalAlertWindow(service, simulation)
  if (Notification.isSupported()) {
    new Notification({
    title: `L.E.D.A • ${simulation ? 'SIMULAÇÃO DE ALERTA' : `ALERTA CRÍTICO: ${service.name} offline`}`,
    body: simulation ? 'Teste de alarme ativo. Abra a L.E.D.A para silenciar.' : 'Alarme ativo. Abra a L.E.D.A para silenciar o aviso.',
      silent: false,
    }).show()
  }
}

function showSystemNotification({ service, incident, check }) {
  const snapshot = monitor?.getSnapshot()
  if (snapshot?.summary.offline) startCriticalAlarm(service)
  else stopCriticalAlarm({ rearm: true })

  if (!monitor?.state.settings.notifications || !Notification.isSupported()) return
  const recovered = incident.toStatus === 'online'
  const title = recovered ? `${service.name} voltou ao normal` : `${service.name} requer atenção`
  const body = recovered
    ? `Aplicação online novamente • ${check.latency} ms`
    : `${incident.toStatus === 'degraded' ? 'Resposta lenta' : 'Aplicação offline'} • ${check.message}`
  const notification = new Notification({ title: `L.E.D.A • ${title}`, body, silent: recovered })
  notification.on('click', () => createWindow({ show: true }))
  notification.show()
}

function registerIpc() {
  ipcMain.handle('leda:get-snapshot', () => withAlarm(monitor.getSnapshot()))
  ipcMain.handle('leda:add-service', (_event, service) => monitor.addService(service))
  ipcMain.handle('leda:update-service', (_event, id, service) => monitor.updateService(id, service))
  ipcMain.handle('leda:remove-service', (_event, id) => monitor.removeService(id))
  ipcMain.handle('leda:check-now', (_event, id) => id ? monitor.checkService(id) : monitor.checkAll())
  ipcMain.handle('leda:update-settings', (_event, settings) => {
    const updated = monitor.updateSettings(settings)
    applyAutoLaunch(updated.startWithSystem)
    if (!updated.criticalAlarm) stopCriticalAlarm()
    sendSnapshot()
    return updated
  })
  ipcMain.handle('leda:silence-alarm', () => {
    alarmSilenced = true
    stopCriticalAlarm()
    sendSnapshot()
    return withAlarm(monitor.getSnapshot())
  })
  ipcMain.handle('leda:test-alarm', () => {
    alarmSilenced = false
    startCriticalAlarm({ name: 'Simulação de alerta' }, { force: true, simulation: true })
    sendSnapshot()
    return withAlarm(monitor.getSnapshot())
  })
  ipcMain.handle('leda:quit', () => {
    isQuitting = true
    app.quit()
  })
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.alencarleandro.leda')
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  monitor = new HealthMonitor({
    filePath: path.join(app.getPath('userData'), 'leda-data.json'),
    onAlert: showSystemNotification,
  })
  monitor.on('snapshot', sendSnapshot)
  registerIpc()
  applyAutoLaunch(monitor.state.settings.startWithSystem)
  createTray()
  monitor.start()

  const startHidden = process.argv.includes('--start-hidden')
  createWindow({ show: !startHidden })
})

app.on('second-instance', () => createWindow({ show: true }))
app.on('activate', () => createWindow({ show: true }))
app.on('before-quit', () => {
  isQuitting = true
  monitor?.stop()
  stopCriticalAlarm()
  tray?.destroy()
  tray = null
})
