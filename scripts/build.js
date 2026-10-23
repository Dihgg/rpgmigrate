/**
 * @fileoverview Builds a macOS app or portable Linux folder from an RPG Maker game.
 * The source game is copied without changing its files.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const projectDir = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
let sourceArg;
let iconArg;
let archArg;
let platformArg;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--icon') {
    if (!args[i + 1]) throw new Error('--icon requires a path');
    iconArg = args[++i];
  } else if (arg.startsWith('--icon=')) {
    iconArg = arg.slice('--icon='.length);
  } else if (arg === '--arch') {
    if (!args[i + 1]) throw new Error('--arch requires x64 or arm64');
    archArg = args[++i];
  } else if (arg.startsWith('--arch=')) {
    archArg = arg.slice('--arch='.length);
  } else if (arg === '--platform') {
    if (!args[i + 1]) throw new Error('--platform requires darwin or linux');
    platformArg = args[++i];
  } else if (arg.startsWith('--platform=')) {
    platformArg = arg.slice('--platform='.length);
  } else if (arg.startsWith('-')) {
    throw new Error(`Unknown option: ${arg}`);
  } else if (!sourceArg) {
    sourceArg = arg;
  } else {
    throw new Error(`Unexpected argument: ${arg}`);
  }
}

if (!['darwin', 'linux'].includes(process.platform)) {
  throw new Error('This build command requires macOS or Linux.');
}
if (platformArg !== undefined && !['darwin', 'linux'].includes(platformArg)) {
  throw new Error(`Unsupported platform: ${platformArg}. Use darwin or linux.`);
}
if (archArg !== undefined && !['x64', 'arm64'].includes(archArg)) {
  throw new Error(`Unsupported architecture: ${archArg}. Use x64 or arm64.`);
}

/**
 * Detects the host architecture, including Apple Silicon running Node in Rosetta.
 *
 * @returns {'x64'|'arm64'} The native host architecture.
 */
function nativeArch() {
  if (process.platform === 'darwin' && process.arch === 'x64') {
    try {
      if (execFileSync('sysctl', ['-in', 'sysctl.proc_translated'], {
        stdio: ['ignore', 'pipe', 'ignore']
      }).toString().trim() === '1') return 'arm64';
    } catch { /* Intel Macs do not expose this setting. */ }
  }
  if (process.arch === 'x64' || process.arch === 'arm64') return process.arch;
  throw new Error(`Unsupported Node architecture: ${process.arch}`);
}

const targetPlatform = platformArg || process.platform;
const targetArch = archArg || nativeArch();
if (!sourceArg) {
  throw new Error('Usage: npm run build -- "/path/to/game" [--platform darwin|linux] [--arch arm64|x64] [--icon "/path/to/icon.png"]');
}

const source = path.resolve(sourceArg);
const contentDir = fs.existsSync(path.join(source, 'index.html')) ? source : path.join(source, 'www');
const manifestPath = [path.join(source, 'package.json'), path.join(contentDir, 'package.json')]
  .find(candidate => fs.existsSync(candidate));
if (!fs.existsSync(path.join(contentDir, 'index.html')) || !manifestPath) {
  throw new Error(`No RPG Maker index.html and package.json found in ${source} or its www/ folder`);
}

const gameManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const title = (gameManifest.window?.title || path.basename(source)).replace(/[/:]/g, '-');
const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'game';
const dist = path.join(projectDir, 'dist');
const macSuffix = archArg ? `-${targetArch}` : '';
const outputName = targetPlatform === 'darwin'
  ? `${title}${macSuffix}.app`
  : `${title}-linux-${targetArch}`;
const output = path.join(dist, outputName);
const staging = path.join(dist, `.building-${slug}-${targetPlatform}-${targetArch}`);
const extraction = path.join(dist, `.electron-extract-${slug}-${targetPlatform}-${targetArch}`);

/**
 * Reports whether the npm-installed Electron runtime matches the requested target.
 *
 * @param {string} executable - Installed Electron executable path.
 * @returns {boolean} Whether the executable can be used for this target.
 */
function installedElectronMatches(executable) {
  if (targetPlatform !== process.platform) return false;
  if (targetPlatform === 'linux') return targetArch === process.arch;
  const installedArchs = execFileSync('lipo', ['-archs', executable]).toString().trim().split(/\s+/);
  const machoArch = targetArch === 'x64' ? 'x86_64' : 'arm64';
  return installedArchs.includes(machoArch);
}

/**
 * Uses npm's Electron runtime when it matches the target. Otherwise downloads
 * the pinned Electron release for the requested platform and architecture.
 *
 * @returns {Promise<{directory: string}|{archive: string}>} Matching Electron source.
 * @throws {Error} If Electron is not installed or the requested binary is unavailable.
 */
async function findElectron() {
  let executable;
  try {
    executable = require('electron');
  } catch (error) {
    throw new Error('Electron is not installed. Run npm install in the project folder.', { cause: error });
  }
  if (installedElectronMatches(executable)) {
    const directory = targetPlatform === 'darwin'
      ? path.resolve(path.dirname(executable), '../..')
      : path.dirname(executable);
    return { directory };
  }
  const { downloadArtifact } = await import('@electron/get');
  const version = require('electron/package.json').version;
  const archive = await downloadArtifact({
    version,
    artifactName: 'electron',
    platform: targetPlatform,
    arch: targetArch,
    checksums: require('electron/checksums.json'),
    cacheRoot: path.join(projectDir, '.electron-cache')
  });
  return { archive };
}

/**
 * Chooses the explicit icon, or searches the two RPG Maker icon locations.
 *
 * @returns {string|undefined} Absolute image path, or undefined for no icon.
 * @throws {Error} If an explicit icon path is not a file.
 */
function findIcon() {
  if (iconArg !== undefined) {
    const explicit = path.resolve(source, iconArg);
    if (!fs.existsSync(explicit) || !fs.statSync(explicit).isFile()) {
      throw new Error(`Icon not found: ${explicit}`);
    }
    return explicit;
  }
  return [path.join(source, 'icon/icon.png'), path.join(source, 'www/icon/icon.png')]
    .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

/**
 * Converts an image to ICNS and installs it in a macOS app bundle. Without an
 * image, removes Electron's icon so macOS displays its generic application icon.
 *
 * @param {string} bundle - Absolute path to the staged .app bundle.
 * @param {string|undefined} icon - Source image path, if one was selected.
 * @returns {void}
 */
function applyMacIcon(bundle, icon) {
  const resources = path.join(bundle, 'Contents/Resources');
  const plist = path.join(bundle, 'Contents/Info.plist');
  if (!icon) {
    fs.rmSync(path.join(resources, 'electron.icns'), { force: true });
    execFileSync('plutil', ['-remove', 'CFBundleIconFile', plist]);
    console.log('No game icon found; using the generic macOS app icon.');
    return;
  }
  const iconTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'rpgmaker-icon-'));
  const iconset = path.join(iconTemp, 'Game.iconset');
  fs.mkdirSync(iconset);
  try {
    for (const [name, size] of [
      ['icon_16x16.png', 16], ['icon_16x16@2x.png', 32],
      ['icon_32x32.png', 32], ['icon_32x32@2x.png', 64],
      ['icon_128x128.png', 128], ['icon_128x128@2x.png', 256],
      ['icon_256x256.png', 256], ['icon_256x256@2x.png', 512],
      ['icon_512x512.png', 512], ['icon_512x512@2x.png', 1024]
    ]) {
      execFileSync('sips', ['-s', 'format', 'png', '-z', String(size), String(size),
        icon, '--out', path.join(iconset, name)], { stdio: 'ignore' });
    }
    const entries = [
      ['icp4', 'icon_16x16.png'], ['icp5', 'icon_32x32.png'],
      ['icp6', 'icon_32x32@2x.png'], ['ic07', 'icon_128x128.png'],
      ['ic08', 'icon_256x256.png'], ['ic09', 'icon_512x512.png'],
      ['ic10', 'icon_512x512@2x.png']
    ];
    const chunks = entries.map(([type, file]) => {
      const image = fs.readFileSync(path.join(iconset, file));
      const header = Buffer.alloc(8);
      header.write(type, 0, 'ascii');
      header.writeUInt32BE(image.length + 8, 4);
      return Buffer.concat([header, image]);
    });
    const header = Buffer.alloc(8);
    header.write('icns', 0, 'ascii');
    header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
    fs.writeFileSync(path.join(resources, 'game.icns'), Buffer.concat([header, ...chunks]));
    execFileSync('plutil', ['-replace', 'CFBundleIconFile', '-string', 'game.icns', plist]);
    fs.rmSync(path.join(resources, 'electron.icns'), { force: true });
    console.log(`Game icon: ${icon}`);
  } finally {
    fs.rmSync(iconTemp, { recursive: true, force: true });
  }
}

/**
 * Copies a Linux icon into the packaged app for the BrowserWindow.
 *
 * @param {string} appDir - Electron resources/app directory.
 * @param {string|undefined} icon - Source image path, if one was selected.
 * @returns {void}
 */
function applyLinuxIcon(appDir, icon) {
  if (!icon) {
    console.log('No game icon found; building without a game-specific icon.');
    return;
  }
  const extension = path.extname(icon).toLowerCase() || '.png';
  fs.copyFileSync(icon, path.join(appDir, `game-icon${extension}`));
  console.log(`Game icon: ${icon}`);
}

const omittedDirs = new Set(['nwjs.app', 'linux', 'save', '.git', 'temp', 'tools', 'swiftshader', 'locales']);
const omittedRootFiles = new Set([
  'icudtl.dat', 'resources.pak', 'v8_context_snapshot.bin',
  'nw_100_percent.pak', 'nw_200_percent.pak', 'vk_swiftshader_icd.json'
]);

/**
 * Selects game content while excluding bundled runtimes and native binaries.
 *
 * @param {string} src - Absolute source path being considered.
 * @returns {boolean} Whether the path should be copied into the app.
 */
function includeGameFile(src) {
  if (src === source) return true;
  const rel = path.relative(source, src);
  const parts = rel.split(path.sep);
  if (fs.lstatSync(src).isSymbolicLink()) return false;
  if (parts.some(part => part === '.DS_Store')) return false;
  if (parts.length === 1 && omittedDirs.has(parts[0]) && fs.statSync(src).isDirectory()) return false;
  if (parts.length === 1 && omittedRootFiles.has(parts[0])) return false;
  if (/\.(exe|dll|so|lib|node)$/i.test(src)) return false;
  return true;
}

/**
 * Extracts or copies Electron into the staging location.
 *
 * @param {{directory?: string, archive?: string}} electron - Runtime source.
 * @returns {Promise<void>}
 */
async function stageElectron(electron) {
  if (electron.directory) {
    if (targetPlatform === 'darwin') {
      execFileSync('ditto', [electron.directory, staging], { stdio: 'inherit' });
    } else {
      fs.cpSync(electron.directory, staging, { recursive: true });
    }
    return;
  }
  const { extract } = require('@electron-internal/extract-zip');
  fs.mkdirSync(extraction);
  await extract(electron.archive, { dir: extraction });
  const extracted = targetPlatform === 'darwin'
    ? path.join(extraction, 'Electron.app')
    : extraction;
  if (!fs.existsSync(extracted)) throw new Error('Electron archive had an unexpected layout');
  if (targetPlatform === 'darwin') {
    fs.renameSync(extracted, staging);
  } else {
    fs.renameSync(extraction, staging);
  }
}

/**
 * Returns the resources/app directory for the target package layout.
 *
 * @returns {string} Absolute app directory.
 */
function packagedAppDirectory() {
  return targetPlatform === 'darwin'
    ? path.join(staging, 'Contents/Resources/app')
    : path.join(staging, 'resources/app');
}

const selectedIcon = findIcon();

/** Builds the package using Electron for the selected platform and architecture. */
async function build() {
  fs.mkdirSync(dist, { recursive: true });
  for (const temp of [staging, extraction]) {
    if (fs.existsSync(temp)) fs.rmSync(temp, { recursive: true, force: true });
  }
  try {
    const electron = await findElectron();
    console.log(`Electron (${targetPlatform}-${targetArch}): ${electron.directory || electron.archive}`);
    await stageElectron(electron);

    const appDir = packagedAppDirectory();
    fs.mkdirSync(appDir, { recursive: true });
    for (const file of ['package.json', 'main.js', 'preload.js']) {
      fs.copyFileSync(path.join(projectDir, 'app', file), path.join(appDir, file));
    }
    console.log(`Copying game: ${source}`);
    fs.cpSync(source, path.join(appDir, 'game'), { recursive: true, filter: includeGameFile });

    if (targetPlatform === 'darwin') {
      const plist = path.join(staging, 'Contents/Info.plist');
      for (const [key, value] of [
        ['CFBundleDisplayName', title],
        ['CFBundleName', title],
        ['CFBundleIdentifier', `local.rpgm.${slug}`]
      ]) {
        execFileSync('plutil', ['-replace', key, '-string', value, plist]);
      }
      applyMacIcon(staging, selectedIcon);
      console.log('Signing app locally…');
      execFileSync('codesign', ['--force', '--deep', '--sign', '-', staging], { stdio: 'inherit' });
    } else {
      const electronExecutable = path.join(staging, 'electron');
      const gameExecutable = path.join(staging, slug);
      if (!fs.existsSync(electronExecutable)) throw new Error('Linux Electron executable was not found');
      fs.renameSync(electronExecutable, gameExecutable);
      fs.chmodSync(gameExecutable, 0o755);
      applyLinuxIcon(appDir, selectedIcon);
    }

    if (fs.existsSync(output)) fs.rmSync(output, { recursive: true, force: true });
    fs.renameSync(staging, output);
    console.log(`Built: ${output}`);
    if (targetPlatform === 'linux') console.log(`Run: ${path.join(output, slug)}`);
  } catch (error) {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  } finally {
    if (fs.existsSync(extraction)) fs.rmSync(extraction, { recursive: true, force: true });
  }
}

build().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
