import { app, BrowserWindow, ipcMain } from 'electron'
import { fileURLToPath } from 'url'
import path from 'path'
import { agentBridge } from './bridge.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.resolve(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true,
    },
  })

  const indexHtml = path.resolve(__dirname, '../../index.html')
  win.loadFile(indexHtml)
}

app.whenReady().then(() => {
  agentBridge.registerIpcHandlers(ipcMain)
  // 应用启动时尝试自动拉起 MCP（可通过环境变量控制）
  agentBridge.autostart().catch((err) => {
    console.warn('[Main] MCP autostart error:', err?.message || err)
  })
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', async () => {
  await agentBridge.cleanup()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

process.on('SIGINT', async () => {
  await agentBridge.cleanup()
  app.quit()
})
process.on('SIGTERM', async () => {
  await agentBridge.cleanup()
  app.quit()
})
