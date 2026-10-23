/**
 * @fileoverview Electron main process for a packaged RPG Maker game.
 * Loads the copied game and keeps save files in the platform's user data directory.
 */
const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');

const packageRoot = path.join(__dirname, 'game');
const gameDir = fs.existsSync(path.join(packageRoot, 'index.html')) ? packageRoot : path.join(packageRoot, 'www');
const manifestPath = fs.existsSync(path.join(packageRoot, 'package.json'))
  ? path.join(packageRoot, 'package.json') : path.join(gameDir, 'package.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const title = manifest.window?.title || 'RPG Maker Game';
app.setName(title);

const saveDir = path.join(app.getPath('userData'), 'save');
fs.mkdirSync(saveDir, { recursive: true });

/**
 * Finds the optional icon copied into the packaged application directory.
 *
 * @returns {string|undefined} Icon path for BrowserWindow, if packaged.
 */
function packagedIcon() {
  const filename = fs.readdirSync(__dirname).find(name => name.startsWith('game-icon.'));
  return filename ? path.join(__dirname, filename) : undefined;
}

ipcMain.on('rpgm-quit', () => app.quit());
ipcMain.on('rpgm-devtools', event => BrowserWindow.fromWebContents(event.sender)?.webContents.openDevTools());
ipcMain.on('rpgm-clipboard', (_event, text) => clipboard.writeText(String(text)));

/**
 * Creates the game window after Electron is ready and loads its index.html.
 *
 * @returns {void}
 */
function createGameWindow() {
  process.chdir(gameDir);
  const window = new BrowserWindow({
    width: manifest.window?.width || 1280,
    height: manifest.window?.height || 720,
    backgroundColor: '#000000',
    title,
    icon: packagedIcon(),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: false,
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [
        `--rpgm-game-dir=${gameDir}`,
        `--rpgm-save-dir=${saveDir}`,
        `--rpgm-title=${title}`
      ]
    }
  });
  window.webContents.on('console-message', (_event, details) => {
    if (details.level === 'error') console.error(`[game] ${details.message}`);
  });
  window.loadFile(path.join(gameDir, 'index.html'));
}

app.whenReady().then(createGameWindow);

app.on('window-all-closed', () => app.quit());
