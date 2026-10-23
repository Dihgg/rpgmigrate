/**
 * @fileoverview Renderer compatibility layer for RPG Maker's NW.js calls.
 * It also redirects local save files outside the signed app bundle.
 */
const { ipcRenderer } = require('electron');
const { createRequire } = require('module');
const path = require('path');

/**
 * Reads a value supplied through BrowserWindow.additionalArguments.
 *
 * @param {string} name - Argument name without the --rpgm- prefix.
 * @returns {string|undefined} Its value, if present.
 */
function argument(name) {
  const prefix = `--rpgm-${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length);
}

const gameDir = argument('game-dir');
const saveDir = argument('save-dir');
const title = argument('title');
window.require = createRequire(path.join(gameDir, 'index.html'));
process.mainModule = { filename: path.join(gameDir, 'index.html') };

window.nw = {
  App: {
    argv: [],
    manifest: { name: 'rmmz-game', window: { title } },
    quit: () => ipcRenderer.send('rpgm-quit')
  },
  Window: { get: () => ({
    on: () => {},
    showDevTools: () => ipcRenderer.send('rpgm-devtools')
  }) },
  Clipboard: { get: () => ({ set: text => ipcRenderer.send('rpgm-clipboard', text) }) }
};

/**
 * Overrides RPG Maker MZ and MV save-directory methods once loaded.
 *
 * @returns {boolean} Whether StorageManager was available and patched.
 */
function redirectSaves() {
  if (typeof StorageManager === 'undefined') return false;
  StorageManager.fileDirectoryPath = () => saveDir + path.sep;
  StorageManager.localFileDirectoryPath = () => saveDir + path.sep;
  return true;
}

window.addEventListener('load', () => {
  if (!redirectSaves()) {
    const retry = setInterval(() => { if (redirectSaves()) clearInterval(retry); }, 10);
  }
});
