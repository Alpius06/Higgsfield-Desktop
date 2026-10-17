# Changelog

## Unreleased

### New

- **macOS version.** Higgsfield Desktop now runs and builds on macOS (Apple Silicon and Intel), with the conventions a Mac app is expected to have:
  - The toolbar is the title bar: the window buttons sit at its left, and dragging any empty part of it moves the window.
  - A **Higgsfield** app menu with About, Settings (⌘,), Hotkeys, Hide and Quit, and a **Window** menu.
  - Default shortcuts use ⌘: ⌘T, ⌘W, ⇧⌘T, ⌘[ / ⌘] for back and forward, ⌘R, ⌥⌘→ / ⌥⌘↓ to split, ⌃⌘F for full screen, ⌥⌘L for the downloads folder; ⌃⌥H shows or hides the app from anywhere. The Hotkeys page shows them with Mac symbols and refuses ones macOS keeps for itself (⌘Q, ⌘H, ⌘M…) or that would type a character (⌥ with a letter).
  - ⌘-click opens a section or project in a new tab (Ctrl+click is a right-click on a Mac).
  - Closing the window keeps the app running in the Dock instead of a tray icon; the Dock icon brings it back, and right-clicking it offers New Tab and Open Downloads Folder. The Dock icon shows how many generations are running and bounces when one finishes in the background.
  - Downloads, notifications and "Show in Finder" use the Mac's own wording and places; data lives in `~/Library/Application Support/Higgsfield`.
  - `npm run dist:mac` builds a `.dmg` and `.zip` for each architecture, ad-hoc signed.

## 2.4.1

### Changed

- **Tabs show the project's name.** A tab inside a Cinema Studio project is titled with the project, e.g. **Overclock**, instead of "Cinema Studio". It follows renames, and goes back to the page's own title when the tab leaves the project.

## 2.4.0

### New

- **Projects menu.** A **Projects** button now sits in the toolbar all the time, not only while a tab is inside a project. It lists every Cinema Studio project you have opened in the app: pinned ones first, then your own, then projects others shared with you, most recently used first. Click one to go to a tab already inside it, or open it in a new tab; Ctrl+click always opens a new tab. From seven projects on, the menu has a search box.
- **Pinned project buttons.** The pin on each project in the Projects menu (or press **P** on it), **Pin to toolbar** at the top of the menu while you're in a project, or **Pin to toolbar** in Settings → Projects gives a project its own toolbar button after the section buttons. Pinning leaves the menu open, with every project where it was.
  - Each project has a lettered badge in its Higgsfield colour, drawn in softer shades of the web's named colours. A project without a colour keeps one of its own. Numbered names get their number, so "New project 3" is **N3**.
  - The pinned project you're in is underlined in its colour, and the Projects button stops repeating its name.
  - Right-click a pinned button to open it in a new tab, open its folder, move it left or right, or unpin it.
  - When the toolbar runs out of room, the names go first, then the last pinned buttons, which stay at the top of the Projects menu; the Projects button shows how many, e.g. **+2**.
- **Settings → Projects.** Projects have their own page in Settings, with the same badges and pin buttons. Long folder paths are shortened at the start, so the project's folder stays in view.

### Fixed

- **Project names.** Projects were named after their web address, so a project called "Overclock" showed up as "Ai film festival" and three different projects as "New project 2/3/4". The app now reads each project's real name, owner and id from Higgsfield when you open it, and the project lists Cinema Studio loads keep the names of projects already in the app up to date. Projects you have not opened in the app are not added.
- **Renames made on Higgsfield** now reach the app. They were matched by project id, which the app never had for projects opened by their address.
- A project opened both by its id and by its address is kept as one project.
- **Shared projects** are listed under *Shared with you* as soon as the app has seen one of your own projects, instead of waiting for Higgsfield to describe each one.
- The toolbar status no longer runs into the Workspace button in a narrow window.

## 2.3.0

### Changed

- **Continue with Google** no longer tries to carry a login over from a separate browser: Higgsfield's sign-in service rejects a login made in one browser and replayed in another, so it could not stay signed in. It now shows a short message that Google sign-in needs official support from Higgsfield, with a **Sign in with email** button that opens Higgsfield's own email login in the tab. Email, Apple, Microsoft and Discord sign-in work directly in the app and use the same account.

## 2.2.1

### Fixed

- **Google sign-in "Permission denied" error.** After the browser window closed, the app deleted its temporary sign-in profile before the browser had released the folder, which failed with `EPERM` and aborted the sign-in. The login is now taken over first, and clearing that profile is best-effort, so a locked folder no longer stops you signing in.

## 2.2.0

### New

- **Continue with Google.** Google does not allow signing in inside apps, so Continue with Google now runs in a separate Chrome or Edge window, with a fresh profile of its own.
  - Once you have signed in there and closed the window, the app takes over the Higgsfield login and the separate profile is deleted.
  - Only Higgsfield's login cookies are copied. Nothing of Google's is.
  - This is a stand-in until Higgsfield offers an official sign-in for desktop apps.

## 2.1.0

### New

- **Section buttons.** Image, Video and Cinema Studio buttons sit at the left of the toolbar.
  - Clicking one goes to a tab already showing that section, or opens one.
  - Ctrl+click or middle-click always opens a new tab.
  - The **▾** next to them picks any of Higgsfield's ten sections.
  - When the toolbar runs out of room, the buttons show only their icons.
- **Download finished generations.** A new option in **Settings → Downloads**, off by default.
  - When on, each image or video you generate in the app is saved to its tab's folder as soon as it is ready.
  - Failed and cancelled generations are never saved.

### Changed

- **Save without asking.** This is the new name for "Save downloads automatically". It only decides whether Higgsfield's Download button shows a Save dialog.
- **Saving workspaces.** You now save a workspace only from the toolbar's **Workspace ▾** or the **Workspaces** menu. **Settings → Workspaces** lists them to load, rename or delete.
- **Narrow panels.** They always keep the desktop layout from 1024 px down. The minimum page width setting is gone.
- **Removed from Settings and menus:**
  - the second Save form in Settings
  - reordering workspaces
  - the "Load workspace 1–9" hotkeys
  - the list of open tabs in the Tabs menu

### Fixed

- Links to Higgsfield's image server (`images.higgs.ai`) opened the home page instead of the image.
- When you recorded a new show/hide shortcut, the app never checked whether another program already uses it.

### Under the hood

- **Fewer duplicates.** Higgsfield's addresses and the login session are defined once, and one helper reads and writes all the app's files.
- **Less wasted work:**
  - Your layout is not rewritten when nothing changed.
  - The menu bar is not rebuilt on every page change.
  - Back/Forward state is remembered per tab.
  - Zoom is only re-applied when it changes.
- **Cleanup.** Code left over from earlier designs is gone.

## 2.0.0

The first release of the desktop app:

- dockable tabs, with the desktop layout kept in narrow panels and zoom per tab
- saved workspaces and a layout lock
- Cinema Studio projects recognised automatically, with a download folder for each
- generation-finished alerts and a running count
- close to tray, and a show/hide shortcut that works from any app
- a hotkey editor
- Clear Cache, and Clear All Data and Sign Out
