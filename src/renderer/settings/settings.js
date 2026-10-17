// Settings window: General, Downloads, Cinema Studio projects, Workspaces and the Hotkeys editor.
// The main process owns the settings; this page only renders what it sends back.
(function () {
  'use strict';

  const api = window.settingsApi;
  const Keys = window.HFKeys;
  const { ACTIONS: actions, byId } = window.HFActions;
  const SECTIONS = ['general', 'downloads', 'projects', 'workspaces', 'hotkeys'];
  const MODIFIER_LABELS = Keys.IS_MAC
    ? [['ctrlKey', '⌃'], ['altKey', '⌥'], ['shiftKey', '⇧'], ['metaKey', '⌘']]
    : [['ctrlKey', 'Ctrl'], ['altKey', 'Alt'], ['shiftKey', 'Shift'], ['metaKey', 'Win']];
  // Keys that only change what the next key means; pressing them alone must not end recording.
  const NON_KEYS = new Set(['Control', 'Alt', 'AltGraph', 'Shift', 'Meta', 'OS', 'Super', 'Hyper',
    'Fn', 'FnLock', 'CapsLock', 'NumLock', 'ScrollLock', 'Symbol', 'SymbolLock']);
  const GROUP_NOTES = {
    'Open in new tab': 'Open a part of Higgsfield in a new tab. None are set until you add one.',
    'From any app': `Registered with ${Keys.IS_MAC ? 'macOS' : 'Windows'}, so these work even while another app is in front.`,
  };

  // Wording for macOS: the Dock instead of the tray and taskbar, Finder instead of Explorer.
  function adaptToMac() {
    if (!Keys.IS_MAC) return;
    const text = (sel, value) => { const node = $(sel); if (node) node.textContent = value; };
    text('#t-tray', 'Keep running when the window is closed');
    text('#d-tray', 'Closing the window leaves Higgsfield in the Dock, so generations still finish and '
      + 'alerts still arrive. Click its Dock icon to bring it back; quit with ⌘Q.');
    const menuRow = $('[data-setting="menuBar.autoHide"]');
    if (menuRow) menuRow.closest('.row').hidden = true;
    text('#d-notify', 'Shows a macOS notification when an image or video is ready.');
    text('#t-flash', 'Bounce the Dock icon');
    text('#open-folder', 'Show in Finder');
  }

  let settings = null;
  let recording = null; // { id, mods: [], rejected: '', busy }
  const rows = new Map(); // action id -> { action, row, keys, hint, error, reset, change, errorText }

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function svg(markup) {
    const wrap = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    wrap.setAttribute('viewBox', '0 0 24 24');
    wrap.setAttribute('aria-hidden', 'true');
    for (const [tag, attrs] of markup) {
      const child = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [k, v] of Object.entries(attrs)) child.setAttribute(k, v);
      wrap.append(child);
    }
    return wrap;
  }

  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  function patchFor(path, value) {
    return path.split('.').reduceRight((v, k) => ({ [k]: v }), value);
  }

  let announceTimer = 0;
  function announce(text) {
    const live = $('#live');
    live.textContent = '';
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { live.textContent = text; }, 30);
  }

  // One in-page confirm for the whole window; resolves true when the user confirms.
  function confirmDialog({ title, message, ok, tone = 'primary' }) {
    const dialog = $('#confirm-dialog');
    $('#confirm-title').textContent = title;
    $('#confirm-desc').textContent = message;
    const okBtn = $('#confirm-ok');
    okBtn.textContent = ok;
    okBtn.className = 'btn btn-' + tone;
    dialog.returnValue = '';
    return new Promise(resolve => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
      dialog.showModal();
    });
  }

  // ---- sections ----

  function showSection(name) {
    if (!SECTIONS.includes(name)) name = 'general';
    if (recording) finishRecording();
    const changed = currentSection() !== name;
    for (const btn of $$('.nav-item')) {
      const on = btn.dataset.section === name;
      btn.classList.toggle('active', on);
      if (on) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    }
    for (const page of $$('.page')) page.hidden = page.dataset.section !== name;
    if (changed) $('#content').scrollTop = 0;
    try { history.replaceState(null, '', '?section=' + name); } catch { /* cosmetic only */ }
  }

  function currentSection() {
    const btn = $('.nav-item.active');
    return btn ? btn.dataset.section : null;
  }

  function initNav() {
    const items = $$('.nav-item');
    items.forEach((btn, i) => {
      btn.addEventListener('click', () => showSection(btn.dataset.section));
      btn.addEventListener('keydown', e => {
        let next = null;
        if (e.key === 'ArrowDown') next = items[(i + 1) % items.length];
        else if (e.key === 'ArrowUp') next = items[(i - 1 + items.length) % items.length];
        else if (e.key === 'Home') next = items[0];
        else if (e.key === 'End') next = items[items.length - 1];
        if (!next) return;
        e.preventDefault();
        next.focus();
        showSection(next.dataset.section);
      });
    });
  }

  // ---- general / downloads / notifications ----

  function initToggles() {
    for (const input of $$('input[data-setting]')) {
      input.addEventListener('change', async () => {
        const value = input.checked;
        try {
          apply(await api.update(patchFor(input.dataset.setting, value)));
        } catch (err) {
          console.error(err);
          input.checked = !value;
        }
      });
    }
    $('#choose-folder').addEventListener('click', async () => {
      const folder = await api.chooseDownloadFolder();
      if (folder) apply(await api.update({ downloads: { folder } }));
    });
    $('#open-folder').addEventListener('click', () => api.openDownloadFolder());
  }

  function renderGeneral() {
    for (const input of $$('input[data-setting]')) input.checked = !!getPath(settings, input.dataset.setting);
    const folder = settings.downloads.folder;
    $('#folder-path').textContent = folder;
    $('#folder-path').title = folder;
  }

  // ---- hotkeys ----

  function bindingOf(id) {
    return Keys.normalize(settings.hotkeys[id] || '');
  }

  function defaultOf(id) {
    return Keys.normalize(byId[id].hotkey);
  }

  function keycaps(parts, className) {
    const wrap = el('span', 'keycaps' + (className ? ' ' + className : ''));
    parts.forEach((part, i) => {
      if (i) wrap.append(el('span', 'kbd-plus', '+'));
      wrap.append(el('kbd', 'kbd', part));
    });
    return wrap;
  }

  function buildHotkeys() {
    const list = $('#hk-list');
    const groups = new Map();
    for (const action of actions) {
      if (!groups.has(action.group)) groups.set(action.group, []);
      groups.get(action.group).push(action);
    }
    for (const [name, items] of groups) {
      const group = el('section', 'hk-group');
      const head = el('div', 'hk-group-head');
      const title = el('h2', 'hk-group-title', name);
      title.id = 'group-' + name.toLowerCase().replace(/\W+/g, '-');
      group.setAttribute('aria-labelledby', title.id);
      head.append(title);
      if (GROUP_NOTES[name]) head.append(el('p', 'hk-group-note', GROUP_NOTES[name]));
      const card = el('div', 'card hk-card');
      for (const action of items) card.append(buildRow(action));
      group.append(head, card);
      list.append(group);
    }
  }

  function buildRow(action) {
    const row = el('div', 'hk-row');
    row.dataset.id = action.id;

    const info = el('div', 'hk-info');
    const label = el('div', 'hk-label');
    label.append(el('span', 'hk-name', action.label));
    if (action.global) {
      const badge = el('span', 'badge');
      badge.append(svg([
        ['circle', { cx: 12, cy: 12, r: 8 }],
        ['path', { d: 'M4 12h16M12 4c2.2 2.3 3.2 5 3.2 8s-1 5.7-3.2 8c-2.2-2.3-3.2-5-3.2-8s1-5.7 3.2-8z' }],
      ]), el('span', null, 'Works in any app'));
      label.append(badge);
    }
    const hint = el('div', 'hk-hint');
    const hintPart = (key, text) => {
      const part = el('span', 'hk-hint-part');
      part.append(el('kbd', 'kbd kbd-sm', key), document.createTextNode(' ' + text));
      return part;
    };
    hint.append(hintPart('Esc', 'cancels'), el('span', 'hk-hint-sep', '·'), hintPart('Backspace', 'clears'));
    const error = el('div', 'hk-error');
    info.append(label, hint, error);

    const keys = el('div', 'hk-keys');
    keys.addEventListener('click', () => startRecording(action.id));

    const reset = el('button', 'btn btn-ghost btn-sm hk-reset', 'Reset');
    reset.type = 'button';
    reset.addEventListener('click', () => resetRow(action.id));

    const change = el('button', 'btn btn-sm hk-change', 'Change');
    change.type = 'button';
    change.addEventListener('click', () => {
      if (recording && recording.id === action.id) finishRecording();
      else startRecording(action.id);
    });

    const buttons = el('div', 'hk-buttons');
    buttons.append(reset, change);
    row.append(info, keys, buttons);
    rows.set(action.id, { action, row, keys, hint, error, reset, change, errorText: '' });
    return row;
  }

  function captureField() {
    const box = el('div', 'hk-capture');
    box.append(el('span', 'rec-dot'));
    if (recording.mods.length) {
      box.append(keycaps(recording.mods.concat('…'), 'keycaps-live'));
    } else if (recording.rejected) {
      box.classList.add('rejected');
      box.append(keycaps(Keys.parts(recording.rejected)));
    } else {
      box.append(el('span', 'hk-capture-text', 'Press a shortcut…'));
    }
    return box;
  }

  function renderRow(id) {
    const r = rows.get(id);
    if (!r) return;
    const accel = bindingOf(id);
    const def = defaultOf(id);
    const isRec = !!recording && recording.id === id;
    const name = r.action.title;

    r.row.classList.toggle('recording', isRec);
    r.row.classList.toggle('has-error', !!r.errorText);
    r.error.textContent = r.errorText;

    if (isRec) {
      r.keys.replaceChildren(captureField());
      r.keys.removeAttribute('aria-label');
      // The row grows while recording (hint, error, held keys); keep all of it on screen.
      r.row.scrollIntoView({ block: 'nearest' });
    } else if (accel) {
      r.keys.replaceChildren(keycaps(Keys.parts(accel)));
      r.keys.setAttribute('aria-label', Keys.display(accel));
    } else {
      r.keys.replaceChildren(el('span', 'kbd-empty', 'Not set'));
      r.keys.setAttribute('aria-label', 'Not set');
    }

    r.change.textContent = isRec ? 'Cancel' : 'Change';
    r.change.setAttribute('aria-label', isRec ? `Cancel recording for ${name}` : `Change shortcut for ${name}`);

    const same = accel === def;
    r.reset.classList.toggle('invisible', same);
    r.reset.disabled = same;
    r.reset.title = def ? `Reset to ${Keys.display(def)}` : 'Reset to no shortcut';
    r.reset.setAttribute('aria-label', `Reset ${name} to ${def ? Keys.display(def) : 'no shortcut'}`);
  }

  function renderHotkeys() {
    for (const id of rows.keys()) renderRow(id);
    const changed = actions.some(a => bindingOf(a.id) !== defaultOf(a.id));
    $('#hk-reset-all').disabled = !changed;
    applySearch();
  }

  function flashSaved(id) {
    const r = rows.get(id);
    if (!r) return;
    r.row.classList.remove('saved');
    void r.row.offsetWidth; // restart the animation
    r.row.classList.add('saved');
    setTimeout(() => r.row.classList.remove('saved'), 1600);
  }

  function heldModifiers(e) {
    return MODIFIER_LABELS.filter(([prop]) => e[prop]).map(([, label]) => label);
  }

  function startRecording(id) {
    if (recording && recording.id === id) return;
    if (recording) finishRecording();
    const r = rows.get(id);
    if (!r) return;
    r.errorText = '';
    recording = { id, mods: [], rejected: '', busy: false };
    api.setRecording(true);
    $('#hk-list').classList.add('is-recording');
    document.body.classList.add('recording');
    renderRow(id);
    r.change.focus({ preventScroll: true });
    announce(`Recording a shortcut for ${r.action.title}. Press the keys. Escape cancels, Backspace clears.`);
  }

  function finishRecording() {
    if (!recording) return;
    const { id } = recording;
    recording = null;
    api.setRecording(false);
    $('#hk-list').classList.remove('is-recording');
    document.body.classList.remove('recording');
    const r = rows.get(id);
    if (r) r.errorText = '';
    renderRow(id);
  }

  function reject(message, accel) {
    const r = rows.get(recording.id);
    r.errorText = message;
    recording.rejected = accel || '';
    recording.mods = [];
    renderRow(recording.id);
    announce(message);
  }

  async function commit(accel) {
    const { id } = recording;
    const r = rows.get(id);
    recording.busy = true;
    let res;
    try {
      res = await api.setHotkey(id, accel);
    } catch (err) {
      console.error(err);
      res = { ok: false, error: 'Could not save this shortcut.' };
    }
    const stillHere = recording && recording.id === id;
    if (res && res.ok) {
      r.errorText = '';
      if (stillHere) finishRecording();
      apply(res.settings);
      flashSaved(id);
      announce(accel ? `${r.action.title}: ${Keys.display(accel)}` : `${r.action.title}: no shortcut`);
      return;
    }
    if (!stillHere) return;
    recording.busy = false;
    reject((res && res.error) || 'Could not save this shortcut.', accel);
  }

  function onRecordKeyDown(e) {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (recording.busy || e.repeat) return;

    if (NON_KEYS.has(e.key) || /^(Control|Alt|Shift|Meta|OS)(Left|Right)$/.test(e.code)) {
      recording.mods = heldModifiers(e);
      renderRow(recording.id);
      return;
    }
    const accel = Keys.fromKeyboardEvent(e);
    recording.mods = [];
    if (!accel) return reject('This key cannot be used in a shortcut.', '');
    if (accel === 'Esc') return finishRecording();
    if (accel === 'Backspace') return commit('');

    const action = rows.get(recording.id).action;
    const problem = Keys.validate(accel, { global: !!action.global });
    if (problem) return reject(problem, accel);
    if (accel === bindingOf(action.id)) return finishRecording();
    commit(accel);
  }

  function onRecordKeyUp(e) {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (!recording.mods.length) return;
    recording.mods = heldModifiers(e);
    renderRow(recording.id);
  }

  async function resetRow(id) {
    if (recording) finishRecording();
    const r = rows.get(id);
    let res;
    try {
      res = await api.setHotkey(id, defaultOf(id));
    } catch (err) {
      console.error(err);
      res = { ok: false, error: 'Could not reset this shortcut.' };
    }
    if (res && res.ok) {
      r.errorText = '';
      apply(res.settings);
      flashSaved(id);
    } else {
      r.errorText = (res && res.error) || 'Could not reset this shortcut.';
      renderRow(id);
      announce(r.errorText);
    }
    r.change.focus();
  }

  async function resetAll() {
    const next = await api.resetHotkeys();
    for (const r of rows.values()) r.errorText = '';
    apply(next);
    announce('All shortcuts are back to their defaults.');
  }

  function searchText(action) {
    const accel = bindingOf(action.id);
    return [action.title, action.group, accel, Keys.display(accel),
      action.global ? 'works in any app global' : ''].join(' ').toLowerCase();
  }

  function applySearch() {
    const query = $('#hk-search').value.trim();
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    let anyVisible = false;
    for (const group of $$('.hk-group')) {
      let visible = 0;
      for (const row of group.querySelectorAll('.hk-row')) {
        const { action } = rows.get(row.dataset.id);
        const text = searchText(action);
        const show = terms.every(t => text.includes(t));
        row.hidden = !show;
        if (show) visible++;
      }
      group.hidden = !visible;
      if (visible) anyVisible = true;
    }
    $('#hk-empty').hidden = anyVisible;
    $('#hk-empty-query').textContent = query;
    if (recording && rows.get(recording.id).row.hidden) finishRecording();
  }

  function initHotkeys() {
    buildHotkeys();

    const search = $('#hk-search');
    search.addEventListener('input', applySearch);
    search.addEventListener('focus', () => { if (recording) finishRecording(); });
    search.addEventListener('keydown', e => {
      if (e.key === 'Escape' && search.value) {
        e.preventDefault();
        search.value = '';
        applySearch();
      }
    });

    $('#hk-reset-all').addEventListener('click', async () => {
      if (recording) finishRecording();
      const confirmed = await confirmDialog({
        title: 'Reset all shortcuts?',
        message: 'Every shortcut goes back to its default. Shortcuts you added yourself are removed.',
        ok: 'Reset all',
      });
      if (confirmed) resetAll();
      else $('#hk-reset-all').focus();
    });

    // Capture phase so no button or input reacts to keys meant for the recorder.
    window.addEventListener('keydown', onRecordKeyDown, true);
    window.addEventListener('keyup', onRecordKeyUp, true);
    window.addEventListener('blur', finishRecording);
    window.addEventListener('beforeunload', () => { if (recording) api.setRecording(false); });
    document.addEventListener('pointerdown', e => {
      if (recording && !rows.get(recording.id).row.contains(e.target)) finishRecording();
    }, true);

    // Ctrl+F (⌘F on macOS) or / jumps to the search box on the Hotkeys page.
    document.addEventListener('keydown', e => {
      if (recording || currentSection() !== 'hotkeys') return;
      const typing = e.target instanceof HTMLInputElement && e.target.type !== 'checkbox';
      const find = ((Keys.IS_MAC ? e.metaKey : e.ctrlKey) && e.code === 'KeyF') || (e.key === '/' && !typing);
      if (!find) return;
      e.preventDefault();
      search.focus();
      search.select();
    });
  }

  // ---- shared by the lists (Cinema Studio projects, workspaces) ----

  const ICONS = {
    rename: [['path', { d: 'M5 19h3.5L18.2 9.3a2.1 2.1 0 0 0-3-3L5.5 16v3z' }], ['path', { d: 'M13.5 8l3 3' }]],
    del: [['path', { d: 'M5 7h14M10 7V5h4v2M7 7l.8 12h8.4L17 7' }], ['path', { d: 'M10.5 10.5v5.5M13.5 10.5v5.5' }]],
    folder: [['path', { d: 'M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z' }]],
    pin: [['path', { d: 'M9 4h6M10 4v5l-3 4h10l-3-4V4' }], ['path', { d: 'M12 13v7' }]],
  };

  function iconButton(className, label, icon) {
    const btn = el('button', 'icon-btn ' + className);
    btn.type = 'button';
    btn.title = label;
    btn.append(svg(icon));
    return btn;
  }

  function timeValue(when) {
    const t = typeof when === 'number' ? when : Date.parse(when);
    return Number.isFinite(t) ? t : null;
  }

  // "just now", "5 min ago", "yesterday", "Sep 16"
  function relativeTime(when) {
    const t = timeValue(when);
    if (t === null) return '';
    const minutes = Math.round((Date.now() - t) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
    const days = Math.round(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    const date = new Date(t);
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return date.toLocaleDateString(undefined,
      sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function exactTime(when) {
    const t = timeValue(when);
    return t === null ? '' : new Date(t).toLocaleString();
  }

  function tabCountText(n) {
    if (!n) return 'No tabs';
    return n === 1 ? '1 tab' : `${n} tabs`;
  }

  function cleanName(name) {
    return String(name || '').replace(/\s+/g, ' ').trim();
  }

  // Always resolves to a result; a failure without a message gets a generic one.
  async function callApi(call) {
    let res = null;
    try {
      res = await call();
    } catch (err) {
      console.error(err);
    }
    if (!res) res = { ok: false };
    if (!res.ok && !res.error) res.error = 'Something went wrong. Try again.';
    return res;
  }

  function setRowError(r, message) {
    if (!r || r.errorText === message) return;
    r.errorText = message;
    r.row.classList.toggle('has-error', !!message);
    r.error.textContent = message;
    if (message) {
      announce(message);
      r.row.scrollIntoView({ block: 'nearest' });
    }
  }

  function flashRow(r) {
    if (!r) return;
    r.row.classList.remove('flash');
    void r.row.offsetWidth; // restart the animation
    r.row.classList.add('flash');
    setTimeout(() => r.row.classList.remove('flash'), 1600);
  }

  // Puts the rows for `ids` into `list` in that order, reusing existing rows so an open
  // rename field survives updates pushed by the main process.
  function syncRows(list, rowMap, ids, build) {
    const focused = document.activeElement;
    for (const [id, r] of rowMap) {
      if (!ids.includes(id)) { r.row.remove(); rowMap.delete(id); }
    }
    for (const id of ids) if (!rowMap.has(id)) rowMap.set(id, build(id));
    const shown = Array.from(list.children).map(n => n.dataset.id);
    if (shown.join('\n') !== ids.join('\n')) {
      for (const id of ids) list.append(rowMap.get(id).row);
      // Re-appending a row blurs whatever was focused inside it.
      if (focused && focused.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
    }
  }

  function nameParts() {
    const nameBtn = el('button', 'item-name');
    nameBtn.type = 'button';
    nameBtn.title = 'Rename (F2)';
    const editor = el('input', 'item-editor');
    editor.type = 'text';
    editor.maxLength = 60;
    editor.spellcheck = false;
    editor.autocomplete = 'off';
    editor.hidden = true;
    return { nameBtn, editor };
  }

  // Inline rename: click the name, F2 or a Rename button. Enter saves, Esc cancels, leaving the field saves.
  // ctrl: { rows: Map, item(id), save(id, name) → Promise<boolean>, render(), emptyMessage }
  function inlineRename(ctrl) {
    function start(id) {
      const r = ctrl.rows.get(id);
      const item = ctrl.item(id);
      if (!r || !item || r.editing) return;
      r.editing = true;
      r.errorText = '';
      r.editor.value = item.name;
      ctrl.render();
      r.editor.focus();
      r.editor.select();
    }

    function end(id, { focusAfter } = {}) {
      const r = ctrl.rows.get(id);
      if (!r || !r.editing) return;
      r.editing = false;
      r.errorText = '';
      ctrl.render();
      if (focusAfter) r.nameBtn.focus();
    }

    async function commit(id, { focusAfter, fromBlur } = {}) {
      const r = ctrl.rows.get(id);
      const item = ctrl.item(id);
      if (!r || !r.editing || r.saving) return;
      if (!item) return end(id);
      const name = cleanName(r.editor.value);
      if (name === item.name || (!name && fromBlur)) return end(id, { focusAfter });
      if (!name) return setRowError(r, ctrl.emptyMessage);
      r.saving = true;
      const ok = await ctrl.save(id, name);
      r.saving = false;
      if (ok) {
        end(id, { focusAfter });
        flashRow(r);
        announce(`Renamed to ${name}.`);
      } else if (!fromBlur && r.editing) {
        r.editor.focus();
      }
    }

    function wire(id, r, renameBtn) {
      r.nameBtn.addEventListener('click', () => start(id));
      if (renameBtn) renameBtn.addEventListener('click', () => start(id));
      r.row.addEventListener('keydown', e => {
        if (e.key === 'F2' && !r.editing) {
          e.preventDefault();
          start(id);
        }
      });
      r.editor.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit(id, { focusAfter: true });
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          end(id, { focusAfter: true });
        }
      });
      r.editor.addEventListener('input', () => setRowError(r, ''));
      r.editor.addEventListener('blur', () => { if (r.editing) commit(id, { fromBlur: true }); });
    }

    return { start, end, commit, wire };
  }

  // ---- Cinema Studio projects (Projects page) ----
  // The main process finds them from tab URLs. Here the user can pin one to the toolbar, rename the folder,
  // move it, or forget one.

  let projects = []; // most recently used first
  const pjRows = new Map(); // project key -> row elements + { editing, saving, errorText }

  function pjItem(key) {
    return projects.find(p => p.key === key);
  }

  const pjRename = inlineRename({
    rows: pjRows,
    item: pjItem,
    save: (key, name) => pjOp(key, 'rename', { key, name }),
    render: () => renderProjects(),
    emptyMessage: 'Give the folder a name.',
  });

  // Main sends the current list back even when an op fails, so apply it either way.
  async function pjOp(key, op, args) {
    setRowError(pjRows.get(key), '');
    const res = await callApi(() => api.project(op, args));
    if (res.projects) applyProjects(res.projects);
    if (res.ok) return true;
    if (pjRows.get(key)) setRowError(pjRows.get(key), res.error);
    else announce(res.error);
    return false;
  }

  function buildPjRow(key) {
    const row = el('div', 'pj-row');
    row.dataset.id = key;
    row.setAttribute('role', 'listitem');

    const head = el('div', 'pj-head');
    const icon = el('i', 'pj-badge');
    icon.setAttribute('aria-hidden', 'true');
    const title = el('div', 'pj-title');
    const { nameBtn, editor } = nameParts();
    nameBtn.title = 'Rename the folder (F2)';
    title.append(nameBtn, editor);
    const pin = el('button', 'btn btn-sm pj-pin');
    pin.type = 'button';
    const pinLabel = el('span');
    pin.append(svg(ICONS.pin), pinLabel);
    const open = el('button', 'btn btn-sm pj-open', 'Open in Cinema Studio');
    open.type = 'button';
    head.append(icon, title, pin, open);

    const body = el('div', 'pj-body');
    const hint = el('div', 'pj-rename-hint', 'Only the folder name changes. The project on Higgsfield keeps its name.');
    const meta = el('div', 'pj-meta');
    const used = el('span', 'pj-used');
    const owner = el('span', 'pj-owner');
    const forget = el('button', 'btn btn-xs btn-ghost pj-forget', 'Forget');
    forget.type = 'button';
    meta.append(used, owner, forget);

    const folderLine = el('div', 'pj-line');
    const folderPath = el('span', 'pj-path');
    const actions = el('span', 'pj-actions');
    const change = el('button', 'btn btn-xs pj-change', 'Change…');
    change.type = 'button';
    const reset = el('button', 'btn btn-xs btn-ghost pj-reset-folder', 'Reset');
    reset.type = 'button';
    reset.title = 'Use the folder named after the project again';
    const openFolder = el('button', 'btn btn-xs pj-open-folder', Keys.IS_MAC ? 'Show in Finder' : 'Open folder');
    openFolder.type = 'button';
    actions.append(change, reset, openFolder);
    folderLine.append(svg(ICONS.folder), folderPath, actions);

    const error = el('div', 'item-error pj-error');
    body.append(hint, meta, folderLine, error);
    row.append(head, body);

    const r = { row, icon, nameBtn, editor, hint, pin, pinLabel, open, used, owner, forget, folderPath, change, reset, openFolder, error,
      editing: false, saving: false, errorText: '' };

    pjRename.wire(key, r);
    pin.addEventListener('click', async () => {
      const p = pjItem(key);
      if (!p) return;
      if (await pjOp(key, p.pinned ? 'unpin' : 'pin', { key })) {
        announce(p.pinned ? `Unpinned ${p.name} from the toolbar.` : `Pinned ${p.name} to the toolbar.`);
      }
    });
    open.addEventListener('click', async () => {
      const name = pjItem(key) && pjItem(key).name;
      if (await pjOp(key, 'open', { key })) announce(`Opened ${name} in Cinema Studio.`);
    });
    change.addEventListener('click', () => pjOp(key, 'chooseFolder', { key }));
    reset.addEventListener('click', async () => {
      if (await pjOp(key, 'resetFolder', { key })) change.focus();
    });
    openFolder.addEventListener('click', () => pjOp(key, 'openFolder', { key }));
    forget.addEventListener('click', () => forgetProject(key));
    return r;
  }

  function renderPjRow(key) {
    const r = pjRows.get(key);
    const p = pjItem(key);
    const name = p.name;

    r.row.classList.toggle('has-error', !!r.errorText);
    r.nameBtn.textContent = name;
    r.nameBtn.hidden = r.editing;
    r.editor.hidden = !r.editing;
    r.editor.setAttribute('aria-label', `Folder name for ${name}`);
    r.hint.hidden = !r.editing;

    const when = relativeTime(p.lastSeen);
    r.used.textContent = when ? `Used ${when}` : '';
    r.used.title = exactTime(p.lastSeen);
    r.owner.textContent = p.shared && p.owner ? `Shared by @${p.owner}` : '';
    r.owner.hidden = !r.owner.textContent;

    const badge = HFBadge.badge(p);
    r.icon.textContent = badge.text;
    r.icon.style.background = badge.bg;
    r.icon.style.color = badge.fg;

    r.pinLabel.textContent = p.pinned ? 'Unpin' : 'Pin to toolbar';
    r.pin.classList.toggle('is-on', !!p.pinned);
    r.pin.setAttribute('aria-pressed', String(!!p.pinned));
    r.pin.title = p.pinned ? 'Remove its button from the toolbar' : 'Give it its own button on the toolbar';
    // Shown right to left so a long path is cut at its start and the project's folder stays in view.
    r.folderPath.textContent = p.downloadFolder ? '\u200e' + p.downloadFolder + '\u200e' : '';
    r.folderPath.title = p.downloadFolder || '';
    r.reset.hidden = !p.customFolder;

    r.open.title = p.url || '';
    r.open.setAttribute('aria-label', `Open ${name} in Cinema Studio`);
    r.forget.setAttribute('aria-label', `Forget ${name}`);
    r.change.setAttribute('aria-label', `Change the folder for ${name}`);
    r.reset.setAttribute('aria-label', `Reset the folder for ${name}`);
    r.openFolder.setAttribute('aria-label', `Open the folder for ${name}`);
    r.error.textContent = r.errorText;
  }

  function renderProjects() {
    const keys = projects.map(p => p.key);
    syncRows($('#pj-list'), pjRows, keys, buildPjRow);
    keys.forEach(renderPjRow);
    $('#pj-empty').hidden = keys.length > 0;
  }

  function applyProjects(next) {
    if (!Array.isArray(next)) return;
    projects = next;
    renderProjects();
  }

  async function forgetProject(key) {
    const p = pjItem(key);
    const r = pjRows.get(key);
    if (!p) return;
    const confirmed = await confirmDialog({
      title: `Forget “${p.name}”?`,
      message: 'Nothing is deleted on Higgsfield or on your disk.',
      ok: 'Forget',
      tone: 'strong',
    });
    if (!confirmed) {
      if (r) r.forget.focus();
      return;
    }
    const index = projects.findIndex(x => x.key === key);
    if (!(await pjOp(key, 'forget', { key }))) {
      if (r && r.row.isConnected) r.forget.focus();
      return;
    }
    announce(`Forgot ${p.name}.`);
    const next = projects[Math.min(index, projects.length - 1)];
    if (next) pjRows.get(next.key).nameBtn.focus();
    else $('#choose-folder').focus();
  }

  function initProjects(initial) {
    api.onProjectsChanged(applyProjects);
    applyProjects(initial);
  }

  // ---- workspaces ----
  // Saved from the toolbar or the Workspaces menu; here they can be loaded, renamed or deleted.

  let workspaces = []; // [{ id, name, tabCount, savedAt }] in the order they were saved
  const wsRows = new Map(); // workspace id -> row elements + { editing, saving, errorText }

  function wsItem(id) {
    return workspaces.find(w => w.id === id);
  }

  const wsRename = inlineRename({
    rows: wsRows,
    item: wsItem,
    save: (id, name) => wsOp(id, 'rename', { id, name }),
    render: () => renderWorkspaces(),
    emptyMessage: 'Give the workspace a name.',
  });

  // Runs an op for one row; a failure is shown on that row. Main sends the list back either way.
  async function wsOp(id, op, args) {
    setRowError(wsRows.get(id), '');
    const res = await callApi(() => api.workspace(op, args));
    if (res.workspaces) applyWorkspaces(res.workspaces);
    if (res.ok) return true;
    setRowError(wsRows.get(id), res.error);
    return false;
  }

  function buildWsRow(id) {
    const row = el('div', 'ws-row');
    row.dataset.id = id;
    row.setAttribute('role', 'listitem');

    const main = el('div', 'ws-main');
    const line = el('div', 'ws-line');
    const { nameBtn, editor } = nameParts();
    line.append(nameBtn, editor);

    const meta = el('div', 'ws-meta');
    const tabs = el('span', 'ws-tabs');
    const saved = el('span', 'ws-saved');
    meta.append(tabs, saved);

    const error = el('div', 'item-error ws-error');
    main.append(line, meta, error);

    const load = el('button', 'btn btn-sm ws-load', 'Load');
    load.type = 'button';

    const tools = el('div', 'ws-tools');
    const rename = iconButton('ws-rename', 'Rename', ICONS.rename);
    const del = iconButton('ws-delete', 'Delete', ICONS.del);
    tools.append(rename, del);

    row.append(main, load, tools);
    const r = { row, nameBtn, editor, tabs, saved, error, load, rename, del,
      editing: false, saving: false, errorText: '' };

    wsRename.wire(id, r, rename);
    load.addEventListener('click', async () => {
      const name = wsItem(id) && wsItem(id).name;
      if (await wsOp(id, 'load', { id })) {
        flashRow(r);
        announce(`Loaded ${name}.`);
      }
    });
    del.addEventListener('click', () => deleteWorkspace(id));
    return r;
  }

  function renderWsRow(id) {
    const r = wsRows.get(id);
    const w = wsItem(id);

    r.row.classList.toggle('has-error', !!r.errorText);
    r.nameBtn.textContent = w.name;
    r.nameBtn.hidden = r.editing;
    r.editor.hidden = !r.editing;
    r.editor.setAttribute('aria-label', `Name of ${w.name}`);

    r.tabs.textContent = tabCountText(w.tabCount);
    const when = relativeTime(w.savedAt);
    r.saved.hidden = !when;
    r.saved.textContent = when ? 'saved ' + when : '';
    r.saved.title = exactTime(w.savedAt);

    r.load.setAttribute('aria-label', `Load ${w.name}`);
    r.rename.setAttribute('aria-label', `Rename ${w.name}`);
    r.del.setAttribute('aria-label', `Delete ${w.name}`);
    r.error.textContent = r.errorText;
  }

  function renderWorkspaces() {
    const ids = workspaces.map(w => w.id);
    syncRows($('#ws-list'), wsRows, ids, buildWsRow);
    ids.forEach(renderWsRow);
    $('#ws-empty').hidden = ids.length > 0;
    $('#ws-list-head').hidden = ids.length === 0;
  }

  function applyWorkspaces(next) {
    if (!Array.isArray(next)) return;
    workspaces = next;
    renderWorkspaces();
  }

  async function deleteWorkspace(id) {
    const w = wsItem(id);
    const r = wsRows.get(id);
    if (!w) return;
    const confirmed = await confirmDialog({
      title: `Delete “${w.name}”?`,
      message: 'The saved layout is removed. Your open tabs stay as they are.',
      ok: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) {
      if (r) r.del.focus();
      return;
    }
    const index = workspaces.findIndex(x => x.id === id);
    if (!(await wsOp(id, 'delete', { id }))) {
      if (r) r.del.focus();
      return;
    }
    announce(`Deleted ${w.name}.`);
    const next = workspaces[Math.min(index, workspaces.length - 1)];
    if (next) wsRows.get(next.id).nameBtn.focus();
    else $('.nav-item.active').focus();
  }

  function initWorkspaces(initial) {
    api.onWorkspacesChanged(applyWorkspaces);
    applyWorkspaces(initial);
  }

  // ---- state ----

  function apply(next) {
    if (!next) return;
    settings = next;
    renderGeneral();
    renderHotkeys();
  }

  async function init() {
    adaptToMac();
    initNav();
    showSection(new URLSearchParams(location.search).get('section') || 'general');
    api.onShowSection(section => showSection(section));
    try {
      const state = await api.getState();
      initToggles();
      initHotkeys();
      initProjects(state.projects);
      initWorkspaces(state.workspaces);
      setInterval(() => { renderProjects(); renderWorkspaces(); }, 60000); // keeps "N min ago" honest
      apply(state.settings);
      api.onChanged(apply);
      document.body.classList.add('ready');
    } catch (err) {
      console.error(err);
      const msg = el('p', 'load-error', 'Settings could not be loaded. Close this window and open it again.');
      $('#content').replaceChildren(msg);
      document.body.classList.add('ready');
    }
  }

  init();
})();
