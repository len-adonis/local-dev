# Herdr desktop mods

My setup for the Herdr desktop app: personal mods, a layout, keys and settings. The files in `config/` mirror `~/.config/herdr-app`.

## What is here

| Mod | What it does |
|---|---|
| `my-status` | The status bar: branch, stack position, next meeting and its room, keyboard time, and database dots. It shows the machine only for a remote space, and agents only when they need you. It also splits each new tab 70/30. |
| `db` | A popup for database access: Teleport sign-in, one access request, Postgres checks, and buttons that run commands. All names, hosts and commands come from `local/db.json`. |
| `len-commands` | A personal command palette on `cmd-shift-k`. |
| `notes` | Daily notes in a side panel. |
| `rest` | A break reminder after 90 minutes of keyboard time. |
| `droid-cloud` | Factory Droid sessions in the sidebar. The API key stays in the macOS Keychain. |
| `my-toast` | Herdr's own toast, plus desktop notifications for agent alerts when Herdr is not in front. Clicking one goes to the agent. Only `desktop.js` and `make-my-toast.sh` are here; the script builds the mod from your Herdr install. Turn it on with `"toast": "my-toast"` at the top of `layouts/herdr-chrome.json`. Needs `terminal-notifier`. |
| `next-meeting` | A small Swift app that reads Apple Calendar for the status bar. |
| `space-vscode` | A top bar button that opens the space's repo in VS Code. |

`config/len-kit/README.md` has the details and the problems we found.

## What is not here

- **Work settings.** Copy `config/mods/db/db.example.json` to `~/.config/herdr-app/local/db.json` and fill it in. The `local/` folder never goes into git.
- **Live app data**: `data/`, `shared.json`, `view.json`, `window.json`, `seen.json`, `layouts/.state/`.
- **Files that ship with Herdr**: `AGENTS.md`, the `.d.ts` files, `frame/`, and the built-in mods. You get them when you install Herdr.
- **Most of `my-toast`**: its `main.js` is Herdr's toast code. `make-my-toast.sh` copies it from your install and adds a two-line hook. `sync.sh --install` runs it.
- **`my-chrome`**: a changed copy of Herdr's `workspace-chrome` mod. To make it, copy `mods/workspace-chrome` to `mods/my-chrome` and remove "Add machine".
- **Media that belongs to someone else**:
  - `sounds/*.mp3`: get the source song, then run `sounds/make-sounds.sh`. Its first lines give the source.
  - `mods/rest/art.png`: put your own picture there, or leave it out to show the sun. `art-source/make-art.py` prepares a picture.
  - `mods/space-vscode/vscode.png`: a 14 px VS Code icon.
- **`NextMeeting.app`'s binary**: build it in `mods/next-meeting`:
  ```sh
  mkdir -p NextMeeting.app/Contents/MacOS
  swiftc -O src/main.swift -o NextMeeting.app/Contents/MacOS/next-meeting
  codesign -s - --force NextMeeting.app
  ```

## Install on a new machine

1. Install Herdr and open it once.
2. Run `herdr-app/sync.sh --install`. It copies `config/` into `~/.config/herdr-app` and gives each mod its copy of `len-kit.js`.
3. Add the files from "What is not here".
4. Run `~/.config/herdr-app/len-kit/check-all.sh`.

## Update this repo

1. Run `herdr-app/sync.sh`. It copies only the files in its list.
2. Read `git diff` before you commit. This repo is public.
