const path = require('node:path')
const { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, session, shell, Tray } = require('electron')
const { HealthMonitor } = require('./monitoring.cjs')

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

let mainWindow = null
let monitor = null
let tray = null
let isQuitting = false

function createTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="7" fill="#f3c735"/>
      <path d="M5 17h6l3-9 4.5 16 3-10 1.8 3H27" fill="none" stroke="#101214" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2"/>
    </svg>`
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
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
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    openAsHidden: Boolean(enabled),
    path: process.execPath,
    args: ['--start-hidden'],
  })
}

function sendSnapshot(snapshot = monitor?.getSnapshot()) {
  updateTray(snapshot)
  if (mainWindow && !mainWindow.isDestroyed() && snapshot) {
    mainWindow.webContents.send('leda:snapshot', snapshot)
  }
}

function showSystemNotification({ service, incident, check }) {
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
  ipcMain.handle('leda:get-snapshot', () => monitor.getSnapshot())
  ipcMain.handle('leda:add-service', (_event, service) => monitor.addService(service))
  ipcMain.handle('leda:update-service', (_event, id, service) => monitor.updateService(id, service))
  ipcMain.handle('leda:remove-service', (_event, id) => monitor.removeService(id))
  ipcMain.handle('leda:check-now', (_event, id) => id ? monitor.checkService(id) : monitor.checkAll())
  ipcMain.handle('leda:update-settings', (_event, settings) => {
    const updated = monitor.updateSettings(settings)
    applyAutoLaunch(updated.startWithSystem)
    return updated
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
  tray?.destroy()
  tray = null
})
