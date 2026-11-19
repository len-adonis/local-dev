# Len's Herdr mods

Read this before you add or change a mod. The app's own manual is `~/.config/herdr-app/AGENTS.md`.

## The mods

| Mod | Where it shows | What it does |
|---|---|---|
| `my-status` | Status bar | Machine, branch, stack position (`stack-watch.js`), agents, next meeting, `DB ● ●` (`db-watch.js`). It also runs the 70/30 auto-split for new tabs (`auto-split.js`, `split7030.py`). |
| `notes` | Top bar button (`props.button`) and side panel | Daily notes in `~/src/notes/daily/YYYY-MM-DD.md`. Key commands: `notes.prev`, `notes.next`, `notes.today`. |
| `droid-cloud` | Sidebar, under Agents | Factory Droid sessions, cloud and local. The key is in the Keychain (`factory-api-key`). Sessions can hold PHI: memory only. |
| `db` | Popup (status bar, Len commands) | A general access dashboard: Teleport sign-in, one access request, Postgres checks, buttons. Every name, host, command and link is in `local/db.json` (not in git); `mods/db/db.example.json` shows the shape. |
| `rest` | Dialog (rest-watch.js in my-status, or Len commands) | The white break reminder. Tune LIMIT_MS, AWAY_MS, SNOOZE_MS in `my-status/rest-watch.js`. |
| `len-commands` | Popup, `cmd-shift-k` | The personal palette. To add a command, add an entry to `COMMANDS`. |
| `space-vscode` | Top bar | Opens the space's repo in VS Code. |
| `my-toast` | Every notification (the layout's `"toast"`) | Herdr's shipped `toast`, plus: an agent alert (`agent.focus`) while Herdr is not the front app also goes to macOS through terminal-notifier; clicking it runs the same `agent.focus`. |
| `my-chrome` | Sidebar footer | A copy of `workspace-chrome` without "Add machine". |
| `next-meeting` | (helper app) | `NextMeeting.app` reads Apple Calendar for `my-status`. |

The layout is `layouts/herdr-chrome.json`.

## Shared helpers: len-kit

A mod can import only files inside its own folder: `../` imports and symlinks both fail the check. So each mod has a copy of `len-kit.js`.

1. Edit only `len-kit/len-kit.js`.
2. Run `len-kit/sync.sh`. It copies the file into each mod that imports `./len-kit.js`, and then checks those mods.

The kit has: `find`, `sh`, `readText`, `writeText`, `keychain`, `clock`, `ago`, `dur`, `keyStretch` (keyboard time for the break modal and status bar), `panelShown`, `togglePanel`, `openInSpaceChrome`, `nextMeeting`, `googleCalendarUrl`, `loadLocal`.

## Local settings: `local/`

Settings that name work systems or one machine go in `~/.config/herdr-app/local/<name>.json`, read with `loadLocal(name)`. That folder stays out of git. A mod that reads one ships `<name>.example.json` beside it.

## Before you call a change done

Run `len-kit/check-all.sh`. It checks every mod in the layout and the popups, and it reports a `len-kit.js` copy that is out of date.

## Traps we hit

- `readTextFile` never settles for a missing file. Use `readText` from the kit.
- A mod can write only under `~/.config/herdr-app`. For other files, use `writeText` from the kit.
- `herdr-app check` runs `init()` for real. Put `if (checking()) return;` before timers, watchers and network calls.
- `InputState.set_value("")` does not clear a field. Make a new state with `value` instead.
- In a class, a later method with the same name silently replaces the earlier one.
- `TextView` and `Textarea` come from `gpui-base`, not `gpui-kit`.
- A plain `ScrollHandle` has no `scroll_to_bottom`. Use `scroll_to_item`.
- Do not call `setShared` in the `init` of a dialog copy.
- `hc ls --json` does not include terminal labels. `hc get` does.
- One unbalanced `)` stops the whole mod from loading, and its button disappears. Run the check.
