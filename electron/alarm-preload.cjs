const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('ledaAlarm', {
  silence: () => ipcRenderer.invoke('leda:silence-alarm'),
})
