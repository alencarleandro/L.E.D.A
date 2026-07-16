const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

const projectRoot = path.join(__dirname, '..')
const sourcePath = path.join(projectRoot, 'src', 'assets', 'leda-logo.svg')
const pngPath = path.join(projectRoot, 'electron', 'assets', 'app-icon.png')
const icoPath = path.join(projectRoot, 'build', 'icon.ico')
const sizes = [16, 24, 32, 48, 64, 128, 256]

function createIco(images) {
  const headerSize = 6 + (images.length * 16)
  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)

  let offset = headerSize
  images.forEach(({ size, buffer }, index) => {
    const entry = 6 + (index * 16)
    header.writeUInt8(size === 256 ? 0 : size, entry)
    header.writeUInt8(size === 256 ? 0 : size, entry + 1)
    header.writeUInt8(0, entry + 2)
    header.writeUInt8(0, entry + 3)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(buffer.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += buffer.length
  })

  return Buffer.concat([header, ...images.map(({ buffer }) => buffer)])
}

app.whenReady().then(async () => {
  const svg = fs.readFileSync(sourcePath, 'utf8')
  const window = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
  })
  const html = `<!doctype html><style>html,body{width:100%;height:100%;margin:0;background:transparent}svg{display:block;width:100%;height:100%}</style>${svg}`
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((resolve) => setTimeout(resolve, 250))
  const image = await window.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 })
  const images = sizes.map((size) => ({ size, buffer: image.resize({ width: size, height: size, quality: 'best' }).toPNG() }))

  fs.mkdirSync(path.dirname(pngPath), { recursive: true })
  fs.mkdirSync(path.dirname(icoPath), { recursive: true })
  fs.writeFileSync(pngPath, image.toPNG())
  fs.writeFileSync(icoPath, createIco(images))
  window.destroy()
  app.quit()
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
