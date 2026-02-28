const { app, BrowserWindow } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('enable-blink-features', 'RTCInsertableStreams');

function parseArgValue(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  if (!arg) return '';
  return arg.slice(prefix.length);
}

function createWindow() {
  const signalUrl = parseArgValue('video-url') || parseArgValue('signal-url') || '';

  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      enableBlinkFeatures: 'RTCInsertableStreams'
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'), {
    query: signalUrl ? { signal: signalUrl } : {}
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
