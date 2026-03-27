const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, Notification } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const { createTray } = require('./tray');
const { setupUpdater, installUpdate } = require('./updater');

// ── Globals ──────────────────────────────────────────────────
let mainWindow = null;
let splashWindow = null;
let tray = null;
let serverProcess = null;

const SERVER_PORT = 7821;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;
const isDev = !app.isPackaged;
let currentScore = null;

// ── Data Directory (AppData in production) ───────────────────
function getDataDir() {
  if (app.isPackaged) {
    const dir = path.join(app.getPath('userData'), 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Ensure scans subdirectory exists
    const scansDir = path.join(dir, 'scans');
    if (!fs.existsSync(scansDir)) fs.mkdirSync(scansDir, { recursive: true });
    return dir;
  }
  return path.join(__dirname, '..', 'data');
}

// ── 1. Start the backend Node server ─────────────────────────
function startServer() {
  const serverPath = path.join(__dirname, '..', 'server', 'index.js');

  // Use current Electron as Node to ensure ABI match for better-sqlite3
  const clientDistPath = app.isPackaged
    ? path.join(process.resourcesPath, 'client', 'dist')
    : path.join(app.getAppPath(), 'client', 'dist');

  serverProcess = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      AUTO_OPEN: 'false',
      ELECTRON: 'true',
      LAPSCORE_DATA_DIR: getDataDir(),
      CLIENT_DIST_PATH: clientDistPath,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  serverProcess.stdout?.on('data', (data) => {
    console.log(`[Server] ${data.toString().trim()}`);
  });

  serverProcess.stderr?.on('data', (data) => {
    console.error(`[Server] ${data.toString().trim()}`);
  });

  serverProcess.on('exit', (code) => {
    console.log(`[Server] Process exited with code ${code}`);
    if (!app.isQuitting && code !== 0) {
      console.log('[Server] Restarting crashed server...');
      setTimeout(startServer, 2000);
    }
  });
}

// ── 2. Wait for server to be ready ───────────────────────────
const waitForServer = (port, timeout = 30000) => {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = 500;
    
    const check = () => {
      http.get(`http://localhost:${port}/api/health`, (res) => {
        if (res.statusCode === 200) {
          console.log(`[LapScore] Server ready on port ${port}`);
          resolve(port);
        } else {
          retry();
        }
        res.resume();
      }).on('error', retry);
    };
    
    const retry = () => {
      if (Date.now() - start > timeout) {
        reject(new Error(`Server failed to start within ${timeout/1000}s`));
        return;
      }
      setTimeout(check, interval);
    };
    
    check();
  });
};

// ── Splash Screen ────────────────────────────────────────────
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 340,
    height: 220,
    frame: false,
    alwaysOnTop: true,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: { nodeIntegration: false },
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.center();
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
}

function createWindow() {
  const iconPath = path.join(
    app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'),
    'assets', 'icon.ico'
  );

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hidden',
    frame: false,
    backgroundColor: '#080810',
    icon: iconPath,
    show: false,                  // Don't show until ready-to-show
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: isDev,
    },
  });

  // ── CSP Security ──────────────────────────────────────────
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' http://localhost:* ws://localhost:*;" + 
          "img-src 'self' data: blob:;" + 
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;" + 
          "font-src 'self' https://fonts.gstatic.com;"
        ]
      }
    });
  });

  mainWindow.loadURL(SERVER_URL);

  // Show window only when content is painted
  mainWindow.once('ready-to-show', () => {
    closeSplash();
    if (!process.argv.includes('--hidden')) {
      mainWindow.show();
    }
  });

  // Open DevTools automatically if window is blank after 5 seconds
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript('document.body.innerHTML').then(html => {
        if (!html || html.trim() === '') {
          mainWindow.webContents.openDevTools();
          console.error('[LapScore] Black screen detected — opening DevTools');
        }
      });
    }
  }, 5000);

  // Handle load failure
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, url) => {
    console.error(`[LapScore] Page load failed: ${url} Error: ${errorCode} — ${errorDescription}`);
    
    mainWindow.loadURL(`data:text/html,
      <body style="background:#080810;color:#ef4444;font-family:sans-serif;padding:40px">
        <h2>⚠ LapScore failed to start</h2>
        <p>Error ${errorCode}: ${errorDescription}</p>
        <p>Try restarting the application.</p>
        <p style="color:#475569;font-size:12px">Check that port 7821 is not blocked by your firewall.</p>
      </body>
    `);
  });

  // Periodically update the taskbar badge with the latest score/status
  setInterval(updateTaskbarBadge, 60000);
  updateTaskbarBadge();

  // ── 4. Handle window close → minimize to tray ──────────────
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── Taskbar Badge ────────────────────────────────────────────-
function updateTaskbarBadge() {
  if (!mainWindow) return;

  fetchLatestScore().then(score => {
    currentScore = score;
    if (score == null) return;
    
    const color = score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444';
    const svg = `
      <svg width="16" height="16" xmlns="http://www.w3.org/2000/svg">
        <circle cx="8" cy="8" r="8" fill="${color}"/>
        <text x="8" y="11.5" text-anchor="middle" font-size="${score >= 100 ? '7' : '8'}" font-family="Arial, sans-serif" font-weight="bold" fill="white">
          ${score}
        </text>
      </svg>
    `;
    
    const badge = nativeImage.createFromDataURL(
      `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
    );
    
    mainWindow.setOverlayIcon(badge, `Health Score: ${score}`);
  }).catch(() => {});
}

async function fetchLatestScore() {
  return new Promise((resolve) => {
    http.get(`${SERVER_URL}/api/scan/latest`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.scores?.total || 0);
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

// ── IPC Handlers (window controls from React) ────────────────
function setupIPC() {
  ipcMain.on('window-minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.on('window-close', () => {
    if (mainWindow) {
      mainWindow.hide(); // hide to tray, don't quit
    }
  });

  ipcMain.on('send-notification', (event, { title, body, severity }) => {
    const iconPath = path.join(__dirname, '..', 'assets', `tray-${severity || 'good'}.png`);
    
    const notification = new Notification({
      title,
      body,
      icon: nativeImage.createFromPath(iconPath),
      silent: false,
    });

    notification.on('click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    notification.show();
  });

  ipcMain.handle('get-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('is-maximized', () => {
    return mainWindow?.isMaximized() ?? false;
  });

  // Auto-updater: user clicked "Install Update" in the UI
  ipcMain.on('install-update', () => {
    installUpdate();
  });
}

// ── App Lifecycle ────────────────────────────────────────────
app.whenReady().then(async () => {
  console.log('[Electron] Starting LapScore desktop app...');

  // Show splash screen while server starts
  createSplash();

  // Start the backend server
  startServer();

  // Set up IPC before window creation
  setupIPC();

  // Wait until server is ready
  waitForServer(SERVER_PORT, 30000)
    .then(() => {
      createWindow();
      tray = createTray(mainWindow, () => currentScore);
      setupUpdater(mainWindow);
    })
    .catch((err) => {
      console.error('[LapScore] Server timeout:', err.message);
      closeSplash();
      createWindow(); // Create window anyway to show the error state
      mainWindow.loadURL(`data:text/html,
        <body style="background:#080810;color:#f59e0b;font-family:sans-serif;padding:40px">
          <h2>⏱ LapScore is taking too long to start</h2>
          <p>The background service did not respond.</p>
          <p>Please close and reopen the application.</p>
          <p style="color:#475569;font-size:12px">Common causes: antivirus blocking, port 7821 in use.</p>
        </body>
      `);
    });
});

// macOS: re-create window when dock icon is clicked
app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// Clean shutdown
app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverProcess) {
    console.log('[Electron] Shutting down server...');
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
});

app.on('window-all-closed', (e) => {
  // Don't quit — keep the server and tray running in background
  e.preventDefault();
});
