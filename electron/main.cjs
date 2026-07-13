const path = require('node:path')
const { app, BrowserWindow, ipcMain, Notification, session, shell } = require('electron')
const { HealthMonitor } = require('./monitoring.cjs')

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

let mainWindow = null
let monitor = null
let isQuitting = false

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
    path: process.execPath,
    args: ['--start-hidden'],
  })
}

function sendSnapshot(snapshot = monitor?.getSnapshot()) {
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
  monitor.start()

  const startHidden = process.argv.includes('--start-hidden')
  createWindow({ show: !startHidden })
})

app.on('second-instance', () => createWindow({ show: true }))
app.on('activate', () => createWindow({ show: true }))
app.on('before-quit', () => {
  isQuitting = true
  monitor?.stop()
})
