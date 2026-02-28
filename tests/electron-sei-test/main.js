const { app, BrowserWindow } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('enable-blink-features', 'RTCInsertableStreams');

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      enableBlinkFeatures: 'RTCInsertableStreams'
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
