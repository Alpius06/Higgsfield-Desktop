<div align="center">

# Higgsfield Desktop

**[higgsfield.ai](https://higgsfield.ai) as a real Windows and macOS app** — dockable tabs, saved workspaces, per-project downloads and generation alerts, wrapped around the site you already use.

[![Latest release](https://img.shields.io/github/v/release/badwolf-ro/Higgsfield-Desktop?label=release&color=2ea44f)](https://github.com/badwolf-ro/Higgsfield-Desktop/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/badwolf-ro/Higgsfield-Desktop/total?color=blue)](https://github.com/badwolf-ro/Higgsfield-Desktop/releases)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-0078D6)
![Built with Electron](https://img.shields.io/badge/built%20with-Electron-47848F)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

### [⬇ Download the latest release](https://github.com/badwolf-ro/Higgsfield-Desktop/releases/latest)

[Install](#install) · [Features](#features) · [Hotkeys](#hotkeys) · [Development](#development) · [How it works](#how-it-is-put-together)

</div>

---

> **Unofficial wrapper.** Not made by or affiliated with Higgsfield. The site itself is untouched — your account, credits, projects and generations stay on higgsfield.ai; the app only displays it. You use Higgsfield exactly as you would in a browser.

## Highlights

| | |
|---|---|
| 🗂️ **Dockable tabs** | Open Image and Video side by side and split them however you like — pages never reload when you drag them. |
| ⭐ **Section buttons** | One-click Image, Video and Cinema Studio in the toolbar, customisable to any of the site's sections. |
| 💾 **Workspaces** | Save a tab layout and bring it back with one click, like presets in Unity or DaVinci Resolve. |
| 📁 **Project downloads** | Files land in `Downloads\Higgsfield`, sorted into a folder per Cinema Studio project automatically. |
| 🔔 **Generation alerts** | A Windows notification and taskbar flash when a render finishes, even in the background or the tray. |
| ⌨️ **Configurable hotkeys** | Every shortcut is rebindable, plus a show/hide hotkey that works from any app. |

## Install

<table>
<tr><th>File</th><th>What it does</th></tr>
<tr><td><code>Higgsfield&nbsp;Setup&nbsp;&lt;version&gt;.exe</code></td><td>Installs for your Windows user with Desktop and Start&nbsp;Menu shortcuts. No admin rights needed, and it installs over an earlier version keeping your settings.</td></tr>
<tr><td><code>Higgsfield-Portable-&lt;version&gt;.exe</code></td><td>Runs without installing.</td></tr>
</table>

On a **Mac**:

<table>
<tr><th>File</th><th>What it does</th></tr>
<tr><td><code>Higgsfield-&lt;version&gt;-arm64.dmg</code></td><td>Apple Silicon (M1 and later). Open it and drag Higgsfield to Applications.</td></tr>
<tr><td><code>Higgsfield-&lt;version&gt;-x64.dmg</code></td><td>Intel Macs.</td></tr>
</table>

Grab either from the **[Releases page](https://github.com/badwolf-ro/Higgsfield-Desktop/releases/latest)**, or [build them yourself](#development).

> [!NOTE]
> The app is not code-signed, so the first time you run it Windows SmartScreen shows *"Windows protected your PC"*. Click **More info → Run anyway**.
>
> On macOS it is not notarised by Apple, so the first launch is blocked with *"Higgsfield can't be opened"*. Open **System Settings → Privacy & Security**, scroll down and click **Open Anyway**, or run `xattr -dr com.apple.quarantine /Applications/Higgsfield.app` once.

Your login is kept between launches. Each version's changes are in the [changelog](CHANGELOG.md).

## The window

- **Toolbar** — one thin row, left to right: your **section buttons**, **Projects ▾** (named after the Cinema Studio project you're in, if any), your **pinned projects**, how many **generations are running**, the **last file you saved**, **Workspace ▾**, and a **padlock** that locks the layout.
- **Tab bar** — below the toolbar; each group of tabs has its own Back, Forward and Reload buttons.
- **The site** — everything else is Higgsfield.
- **Menus** — File, Edit, View, Tabs and Workspaces.

## Features

### ⭐ Section buttons

The buttons at the left of the toolbar jump to the parts of Higgsfield you use most.

- **Click** a button to go to a tab already showing that section, or to open one.
- **Ctrl+click** or middle-click to always open a new tab.
- **Choose which appear** with the **▾** beside them — tick any of Explore, Image, Video, Audio, Cinema Studio, Canvas, Supercomputer, Effects, Marketing Studio and Community. They keep the site's order.
- **Narrow window?** The buttons shrink to icons when the toolbar runs out of room; hover for the name.

### 🗂️ Tabs and docking

- **Open a tab** with **Ctrl+T** or **+**. The **▾** next to **+** (or **Tabs → Open in New Tab**) opens a section directly.
- **Dock a tab** by dragging its title:
  - onto the **edge of a panel** to split the view — Image on the left, Video on the right;
  - onto **another tab bar** to join that group.

  Pages never reload when you move them, so work in progress is safe.
- **Split with a shortcut** — **Ctrl+Alt+→** sends the current tab to a new split on the right, **Ctrl+Alt+↓** below.
- **Right-click a tab** for Duplicate, Split, Close Others and Close to the Right.
- **Middle-click** a tab to close it; **Ctrl+Shift+T** brings it back.
- **Layout is remembered** and restored next launch.

### 🖥️ The desktop layout in every panel

Split the window and each panel gets narrower — where Higgsfield would normally flip to its cramped mobile layout. The app prevents that: a panel under 1024 px shows the full **desktop** page scaled down to fit, with the scale shown as a small percentage chip in the tab bar.

- **Zoom one tab** — **Ctrl+=**, **Ctrl+-**, **Ctrl+0** or Ctrl+mouse-wheel. It never affects other tabs.
- Turn the scaling off in **Settings → General**.

### 💾 Workspaces

A workspace is a named snapshot of your tabs and splits.

- **Save** — **Workspace ▾ → Save Workspace…** in the toolbar (or the Workspaces menu), then name it.
- **Load** — pick it from the same menu; it replaces your current tabs.
- **Manage** — rename or delete in **Settings → Workspaces**.
- **Lock Layout** — the padlock stops tabs being dragged by accident.
- **Reset Layout** — start over with one tab.

### 📁 Cinema Studio projects and downloads

- **The Download button.** Press Download on Higgsfield and the file saves straight to `Downloads\Higgsfield`, no Save dialog. Nothing is ever overwritten — a second `image.png` becomes `image (1).png`. The app never downloads on its own unless you turn on *Download finished generations* (below).
- **Project folders.** When a tab is inside a **Cinema Studio project**, its downloads go into a folder named after the project — e.g. `Downloads\Higgsfield\Nike spot\`. Detected automatically; nothing to set up.
- **Projects ▾.** Every Cinema Studio project you've opened in the app, under its real Higgsfield name and a lettered badge in its colour: pinned first, then yours, then ones shared with you. Click one to jump straight into it (Ctrl+click: new tab); search once the list grows. Inside a project, the button shows its name and also opens its folder or renames it.
- **Pinned projects.** Click the pin next to a project in the Projects menu (or press **P** on it), or use Settings → Projects, and it gets its own toolbar button. The one you're in is underlined in its colour. Right-click a pinned button to move it left or right, open its folder or unpin it. If the toolbar runs out of room, the last ones move into the Projects menu (the button shows **+2** and so on).
- **Settings → Downloads** lets you:
  - change the main download folder, or have the Download button ask where each file goes;
  - turn on **Download finished generations** — *off by default*, since it saves every result including ones you'd throw away. When on, each image or video you generate is saved to its tab's folder the moment it's ready. Failed generations are never saved.
- **Settings → Projects** lists every Cinema Studio project the app has seen. Pin one, give it a different folder, rename its folder, or forget it (forgetting deletes nothing on Higgsfield or disk).
- **Saved notice.** A small toast appears on each save, with a **Show in folder** button.
- **Right-click an image or video** for **Save Image / Video** (to the right folder) or **Save … As…** (choose where).

### 🔔 Generation alerts

When an image or video finishes, you get a Windows notification and the taskbar button flashes — whether the app is in the background, minimised, in the tray, or on another tab.

- **Click the notification** to jump back to the tab that started it.
- **Failures** (blocked or failed) are reported too; ones you cancel are not.
- The toolbar shows a **running count**, and both alerts can be turned off in **Settings → General**.

> Higgsfield raises no notifications of its own for image or video jobs. The app reads the same live job-status updates the site receives, entirely on your machine, and never sends anything anywhere.

### 📌 Tray

- **Closing keeps it running** in the system tray, so long renders finish and alerts still arrive.
- **Click** the tray icon to show or hide the window; **right-click** for **Quit Higgsfield**.
- Turn this off in **Settings → General**.

### ⌨️ Hotkeys

**File → Hotkeys…** lists every shortcut. Click **Change** and press the new combination (**Esc** cancels, **Backspace** clears). The app warns you if a shortcut is already used, would interfere with typing, or is taken by another program.

| Action | Default |
|---|---|
| New / close / reopen tab | `Ctrl+T` · `Ctrl+W` · `Ctrl+Shift+T` |
| Next / previous tab | `Ctrl+Tab` · `Ctrl+Shift+Tab` |
| Split right / down | `Ctrl+Alt+→` · `Ctrl+Alt+↓` |
| Back / forward | `Alt+←` · `Alt+→` (or the mouse side buttons) |
| Reload / without cache | `F5` · `Ctrl+F5` |
| Home | `Alt+Home` |
| Zoom in / out / reset (this tab) | `Ctrl+=` · `Ctrl+-` · `Ctrl+0` |
| Full screen | `F11` |
| Developer tools for this tab | `Ctrl+Shift+I` |
| Open downloads folder | `Ctrl+J` |
| Settings | `Ctrl+,` |
| Clear cache | `Ctrl+Shift+Delete` |
| **Show / hide Higgsfield (from any app)** | **`Ctrl+Alt+H`** |

Opening a section in a new tab, saving a workspace, locking the layout and opening Hotkeys have no default shortcut — you can add one for each.

### 🧹 Clearing the cache

- **File → Clear Cache** removes cached files and reloads every tab; you stay signed in. Use it when the site looks broken or out of date.
- **File → Clear All Data and Sign Out…** removes everything the app stores for the site, including your login, after a confirmation.

### 🔑 Signing in, links and payments

- **Inside the app** — signing in with email, Apple, Microsoft or Discord, and checkout pages, all open in the app so the session returns to Higgsfield. These stay signed in between launches.
- **In your browser** — links to other sites (Instagram, X, a Discord invite) open in your normal browser.
- **Google sign-in** — Google doesn't allow signing in to a Google account inside an app like this one, and a login carried over from a real browser is rejected by Higgsfield's sign-in service. So **Continue with Google** shows a short note that it needs official support from Higgsfield, with a **Sign in with email** button that opens Higgsfield's own email login in the tab. Email uses the **same account** as Google.

## On a Mac

The app works the same way on macOS, with Mac conventions where they differ:

- **Shortcuts use ⌘** in place of Ctrl: ⌘T, ⌘W, ⇧⌘T, ⌘R / ⇧⌘R, ⌘= / ⌘- / ⌘0, ⌘, for Settings. Back and forward are **⌘[** and **⌘]** (⌥← and ⌥→ move by word in text), splits are **⌥⌘→** and **⌥⌘↓**, full screen is **⌃⌘F**, the downloads folder **⌥⌘L**, developer tools **⌥⌘I**, and **⌃⌥H** shows or hides Higgsfield from any app. Next and previous tab stay **⌃⇥** and **⌃⇧⇥**.
- **⌘-click** a section or project button to open it in a new tab.
- **The toolbar is the title bar** — the red, yellow and green buttons sit at its left; drag any empty part of it to move the window.
- **No tray icon.** Closing the window keeps Higgsfield running in the Dock, so renders finish and alerts still arrive; click the Dock icon to bring it back and **⌘Q** to quit. The Dock icon shows how many generations are running and bounces when one finishes while you're elsewhere.
- **Settings, Hotkeys and Quit** are in the **Higgsfield** menu.
- Files go to `~/Downloads/Higgsfield`, and everything else to `~/Library/Application Support/Higgsfield`.

## Where your data lives

Everything sits in `%APPDATA%\Higgsfield` (on a Mac, `~/Library/Application Support/Higgsfield`):

| File | Contents |
|---|---|
| `settings.json` | Settings and hotkeys |
| `layout.json` | Your current tabs and splits |
| `workspaces.json` | Saved workspaces |
| `projects.json` | Cinema Studio projects the app has seen, and their folders |
| `window-state.json` | Window size and position |
| `Partitions\higgsfield\` | The site's cookies, login and cache |

Deleting the folder resets the app completely.

## Development

Requires **Node.js 20+** on Windows or macOS.

```bat
npm install
npx install-electron   :: Electron 44 downloads its binary on first use; this fetches it now
npm start              :: run from source
npm run dist           :: build the installer and portable exe into dist\
```

On a Mac the same `npm install` and `npm start` work; `npm run dist:mac` builds an ad-hoc signed `.dmg` and `.zip` for Apple Silicon and Intel into `dist/`. A Windows build has to be made on Windows, and a Mac build on a Mac.

Run against a separate, clean profile (handy next to your everyday app) by setting `HIGGSFIELD_PROFILE` first:

```bat
set HIGGSFIELD_PROFILE=%TEMP%\hf-test
npm start
```

### How it is put together

```
main.js                     Entry point: windows, IPC, link rules, context menu, wiring
src/main/settings.js        Settings store (settings.json)
src/main/store.js           Reading and writing the JSON files in the profile folder
src/main/hotkeys.js         App shortcuts (before-input-event on every tab) and the global shortcut
src/main/downloads.js       Where each download goes, Save without asking, unique file names, taskbar progress
src/main/projects.js        Cinema Studio projects: detection, real names, pinning, project folders
src/main/folders.js         Reads project names, owners and ids from Higgsfield's API responses in each tab
src/main/workspaces.js      Saved workspaces
src/main/viewport.js        Per-tab desktop-width layout and zoom (CDP device-metrics emulation)
src/main/notify.js          Generation-finished detection, Windows notifications, finished files for auto-download
src/main/cdp.js             One DevTools Protocol session per tab, shared by the two above
src/main/tray.js            Tray icon and close-to-tray
src/main/menu.js            Menu bar
src/shared/actions.js       Which addresses are Higgsfield, its sections, every action and its default shortcut
src/shared/keys.js          Shortcut parsing, display and validation (main + pages)
src/shared/badge.js         A project's lettered badge: initials and colour (toolbar and Settings)
src/renderer/shell/         Toolbar (section buttons, Projects menu, pinned projects, workspaces), tabs and docking (dockview-core, one <webview> per tab)
src/renderer/settings/      Settings window
src/preload/                Bridges between those pages and the main process
build/icon.png              App icon
build/icon-mac.png          App icon on the macOS grid (1024 px, padded, with its shadow)
```

- **Tabs.** Each tab is a `<webview>`; all share the `persist:higgsfield` session, so they share one login.
- **Docking.** dockview's `renderer: 'always'` mode repositions a webview instead of moving it in the page, so dragging a tab never reloads it.
- **Zoom.** Chromium zoom is shared per-site, so per-tab zoom and the desktop layout in narrow panels use `Emulation.setDeviceMetricsOverride` on each tab instead. Clicks and scrolling map through it correctly.
- **Generation alerts.** From Higgsfield's job-status event stream (`fnf-notification/notifications/stream`, event `job:status_changed`) and its `jobs/status-batch` poll, applying the site's own "finished" rule: `completed` once the IP check is done; `failed`, `nsfw`, `ip_detected`.
- **Download finished generations.** When a job the app saw start finishes as `completed`, its full-size file (`results.raw.url`, the same one the site's Download button fetches) is saved through the tab that started it.
- **Google sign-in.** A tab heading to `accounts.google.com` is stopped and email sign-in offered instead. Google blocks account sign-in in embedded browsers, and Higgsfield's sign-in service (Clerk) binds a login to the browser that created it, so a copied login is rejected — an official desktop sign-in has to come from Higgsfield.
- **Cinema Studio projects.** Recognised from the tab's address: `/generate?projectId=<id>` or `/generate/@user/<project>`. Higgsfield calls projects folders; opening one fetches `fnf/generate/<user>/<project>`, whose response gives its id, real name and owner, and the lists `fnf/folders/accessible` and `fnf/folders/pinned` refresh the projects already known. These are read from each tab's traffic, the same way as generation alerts; the app makes no requests of its own.

## License

[MIT](LICENSE). "Higgsfield" and the Higgsfield logo belong to Higgsfield; this project is an independent wrapper and is not affiliated with or endorsed by them.
