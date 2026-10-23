# RPG Migrate

Migrate RPG Maker games from Windows to macOS or Linux.

## Basic Usage
This is a [node](https://nodejs.org) project
```sh
npm install
npm run build -- "/path/to/game/folder"
```

By default, the builder targets the operating system and architecture on which it runs.
Generated packages appear in `dist/` and contain the game assets, and Electron runtime.

## Platform

Native builds require no platform option:

```sh
# On macOS, produces a .app. On Linux, produces a portable folder
npm run build -- "/path/to/game"
```

To choose a platform explicitly, pass `--platform darwin` or `--platform linux`:

```sh
npm run build -- "/path/to/game" --platform linux
```

**NOTE:** A Linux build is named `<game title>-linux-<architecture>/`. Move the entire folder wherever you want and run the executable inside it. The executable uses a lowercase form of the game title, such as `my-game`.

## Architecture

The builder selects the computer's native architecture by default: `x64` on Intel or `arm64` on Apple Silicon and ARM.
It detects Apple Silicon even if Node runs through Rosetta. To choose explicitly, pass `--arch x64` or `--arch arm64`:

```sh
npm run build -- "/path/to/game" --platform linux --arch x64 # linux
npm run build -- "/path/to/game" --platform darwin --arch arm64 # macOS
```

When the requested target differs from the installed Electron runtime, the builder downloads the matching pinned Electron version and caches it in `.electron-cache/`. Games that require native Node plugins need binaries compatible with the target platform and architecture.


## App icon

The builder automatically uses the first icon it finds at `<game>/icon/icon.png` or `<game>/www/icon/icon.png`. To choose a different image, pass `--icon` after the game folder:

```sh
npm run build -- "/path/to/game" --icon "/path/to/my-icon.png"
```

A relative `--icon` path is resolved from the game folder. If no icon is supplied or found, the package is generated without a game-specific icon. An explicit icon path that does not exist is an error.

## Save files

Generated packages store RPG Maker saves outside the package:

- macOS: `~/Library/Application Support/<game title>/save/`
- Linux: `~/.config/<game title>/save/`, unless `XDG_CONFIG_HOME` changes the config directory

The packager does not import saves from the source game's `save/` folder; copy existing `.rmmzsave` files to the new save folder if you want to continue a previous game.

Run `npm install` once to install the pinned Electron version and download the runtime for your computer. Later native builds reuse that installation. Node 22.12 or newer is required.

The wrapper supplies common NW.js functions used by RPG Maker games. Games with other NW.js plugins may need changes to `app/preload.js`.
