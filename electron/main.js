// Pixel Office — optional Electron desktop shell.
//
// Runs the standalone server (dist/cli.js) as a sidecar using Electron's
// bundled Node (ELECTRON_RUN_AS_NODE, so no system Node is required) and shows
// it in a native window. This is one of three ways to run Pixel Office
// (the others: `node dist/cli.js` in a browser, or install as a PWA).
//
// It's kept out of the root install on purpose — Electron is heavy, so only
// people who want the desktop app run `cd electron && npm install`.

const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

// Repo root (one level up from electron/) — where dist/cli.js and node_modules live.
const SRC = process.env.PIXEL_OFFICE_SRC || path.join(__dirname, '..');
const CLI = path.join(SRC, 'dist', 'cli.js');
const PORT = Number(process.env.PORT || 3111);

let serverProc = null;

function startServer() {
  // Run the server with Electron's binary as Node (no system Node needed).
  serverProc = spawn(process.execPath, [CLI, '--port', String(PORT), '--host', '127.0.0.1'], {
    cwd: SRC, // resolve fastify etc. from the repo's node_modules
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
  });
  serverProc.on('exit', (code) => console.log(`[shell] server exited: ${code}`));
}

function waitForServer(cb, tries = 0) {
  const req = http.get({ host: '127.0.0.1', port: PORT, path: '/' }, (res) => {
    res.resume();
    console.log(`[shell] server up (HTTP ${res.statusCode}) after ${tries} tries`);
    cb();
  });
  req.on('error', () => {
    if (tries < 80) setTimeout(() => waitForServer(cb, tries + 1), 250);
    else {
      console.error('[shell] server did not come up');
      cb();
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Pixel Office',
    backgroundColor: '#141019',
    autoHideMenuBar: true,
  });
  win.loadURL(`http://127.0.0.1:${PORT}`);
  console.log('[shell] window loading', `http://127.0.0.1:${PORT}`);
}

app.whenReady().then(() => {
  startServer();
  waitForServer(createWindow);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function shutdown() {
  if (serverProc) {
    serverProc.kill();
    serverProc = null;
  }
}
app.on('window-all-closed', () => {
  shutdown();
  app.quit();
});
app.on('before-quit', shutdown);
