const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('leda', {
  getSnapshot: () => ipcRenderer.invoke('leda:get-snapshot'),
  addService: (service) => ipcRenderer.invoke('leda:add-service', service),
  updateService: (id, service) => ipcRenderer.invoke('leda:update-service', id, service),
  removeService: (id) => ipcRenderer.invoke('leda:remove-service', id),
  checkNow: (id) => ipcRenderer.invoke('leda:check-now', id),
  updateSettings: (settings) => ipcRenderer.invoke('leda:update-settings', settings),
  quit: () => ipcRenderer.invoke('leda:quit'),
  onSnapshot: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot)
    ipcRenderer.on('leda:snapshot', listener)
    return () => ipcRenderer.removeListener('leda:snapshot', listener)
  },
})
