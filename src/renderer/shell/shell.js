// Tab/dock UI. Every tab is a dockview panel holding one <webview>. Panels use the
// 'always' renderer: dockview keeps their content in one overlay container and only
// repositions it, so a webview is never re-parented (which would reload the page)
// when its tab is dragged to another group.
(() => {
  'use strict';

  const { createDockview } = window['dockview-core'];
  const hf = window.hf;

  const CLOSED_MAX = 20;
  const TOAST_MS = 5000;
  const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

  // main refuses to attach a webview to anything but a Higgsfield page, so never hand one another src.
  const { IS_MAC, HOME, PARTITION, SECTIONS, isSite } = window.HFActions;
  // Ctrl+click is a right-click on macOS, so ⌘-click opens a new tab there.
  const NEW_TAB_CLICK = IS_MAC ? '⌘-click' : 'Ctrl+click';
  const wantsNewTab = e => (IS_MAC ? e.metaKey : e.ctrlKey);
  const SHOW_IN_FOLDER = IS_MAC ? 'Show in Finder' : 'Show in folder';

  let api = null;
  let restoring = false; // panels disposed while rebuilding are not user closes
  let locked = false;
  let seq = 0;
  const pages = new Map(); // panel id -> Page
  const tabProjectNames = new Map(); // webContentsId -> name of the Cinema Studio project that tab is in
  const headerParts = new Set(); // per-group header widgets that mirror the active tab
  const headerGroups = new WeakMap(); // header widget element -> its group
  const closedUrls = [];

  // ---------- helpers ----------

  function parse(url) {
    try { return new URL(url); } catch { return null; }
  }

  function origin(u) {
    return u.protocol + '//' + u.hostname.replace(/^www\./, '');
  }

  function pageKey(url) {
    const u = parse(url);
    return u ? origin(u) + u.pathname.replace(/\/+$/, '') : '';
  }

  function sectionFor(url) {
    const key = pageKey(url);
    return key ? SECTIONS.find(s => pageKey(s.url) === key) : undefined;
  }

  const LEADING_BRAND = /^Higgsfield(?:\s+AI)?\s+[-|—–]\s+/i;
  const TRAILING_BRAND = /\s+[-|—–]\s+Higgsfield\b.*$/i;

  function cleanTitle(title) {
    const t = String(title || '').trim().replace(LEADING_BRAND, '').replace(TRAILING_BRAND, '').trim();
    // Pages without a <title> report their URL.
    if (/^Higgsfield(?:\s+AI)?$/i.test(t) || /^[a-z]+:\/\//i.test(t)) return '';
    return t;
  }

  function tabTitle(url, pageTitle) {
    const section = sectionFor(url);
    return section ? section.label : cleanTitle(pageTitle) || 'Higgsfield';
  }

  function validZoom(value) {
    const z = Number(value);
    return z >= ZOOM_STEPS[0] && z <= ZOOM_STEPS[ZOOM_STEPS.length - 1] ? z : 1;
  }

  function stepZoom(zoom, direction) {
    if (direction > 0) return ZOOM_STEPS.find(z => z > zoom + 0.001) || ZOOM_STEPS[ZOOM_STEPS.length - 1];
    return [...ZOOM_STEPS].reverse().find(z => z < zoom - 0.001) || ZOOM_STEPS[0];
  }

  function debounce(fn, ms) {
    let timer = null;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };
    schedule.cancel = () => clearTimeout(timer);
    return schedule;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function baseName(filePath) {
    return String(filePath).split(/[\\/]/).pop();
  }

  const ICONS = {
    back: ['M19 12H5', 'M11 18l-6-6 6-6'],
    forward: ['M5 12h14', 'M13 6l6 6-6 6'],
    reload: ['M20 11a8 8 0 1 0-2.34 5.66', 'M20 4v7h-7'],
    plus: ['M12 5v14', 'M5 12h14'],
    close: ['M7 7l10 10', 'M17 7L7 17'],
    chevron: ['M7 10l5 5 5-5'],
    layout: ['M4 5h16v14H4z', 'M10 5v14', 'M10 12h10'],
    lock: ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
    unlock: ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 0 1 6.8-1.2'],
    download: ['M12 4v11', 'M7 11l5 5 5-5', 'M5 20h14'],
    explore: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18', 'M15.5 8.5l-2 5-5 2 2-5z'],
    image: ['M4 5h16v14H4z', 'M4 16l5-5 4 4 3-3 4 4', 'M15.5 9h.01'],
    video: ['M3 6h12v12H3z', 'M15 10l6-3.5v11L15 14'],
    audio: ['M4 10v4', 'M8 7v10', 'M12 4v16', 'M16 8v8', 'M20 11v2'],
    cinema: ['M4 9h16v11H4z', 'M4 9l2.5-4.5h14L18 9', 'M10 9l2.5-4.5', 'M15.5 9L18 4.5'],
    canvas: ['M4 4h7v7H4z', 'M13 4h7v4h-7z', 'M13 10h7v10h-7z', 'M4 13h7v7H4z'],
    supercomputer: ['M7 7h10v10H7z', 'M10 3v4', 'M14 3v4', 'M10 17v4', 'M14 17v4', 'M3 10h4', 'M3 14h4', 'M17 10h4', 'M17 14h4'],
    effects: ['M11 3l1.8 4.7 4.7 1.8-4.7 1.8L11 16l-1.8-4.7-4.7-1.8 4.7-1.8z', 'M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z'],
    marketing: ['M4 10v4h3l8 4.5v-13L7 10z', 'M18.5 9a4 4 0 0 1 0 6'],
    community: ['M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M2.5 20a6.5 6.5 0 0 1 13 0', 'M16 4.5a3.5 3.5 0 0 1 0 6.5', 'M18 14.2a6.5 6.5 0 0 1 3.5 5.8'],
    dot: ['M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6'],
    check: ['M5 12.5l4.5 4.5L19 7.5'],
    pin: ['M9 4h6', 'M10 4v5l-3 4h10l-3-4V4', 'M12 13v7'],
    search: ['M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14', 'M16 16l4 4'],
    folder: ['M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z'],
    rename: ['M5 19h3.5L18.2 9.3a2.1 2.1 0 0 0-3-3L5.5 16v3z', 'M13.5 8l3 3'],
    sliders: ['M4 7h10', 'M18 7h2', 'M4 17h4', 'M12 17h8', 'M16 5a2 2 0 1 0 0 4a2 2 0 1 0 0-4', 'M10 15a2 2 0 1 0 0 4a2 2 0 1 0 0-4'],
  };

  function icon(name) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'hf-icon');
    for (const d of ICONS[name] || ICONS.dot) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    }
    return svg;
  }

  function iconButton(name, label, onClick, className) {
    const button = el('button', 'hf-icon-button' + (className ? ' ' + className : ''));
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.appendChild(icon(name));
    // Keep header clicks from starting a group drag or stealing focus from the page.
    button.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); });
    button.addEventListener('click', e => { e.stopPropagation(); onClick(e); });
    return button;
  }

  // ---------- tab content: one webview ----------

  class Page {
    constructor(id) {
      this.id = id;
      this.element = el('div', 'hf-page');
      this.webview = null;
      this.api = null;
      this.url = HOME; // last Higgsfield URL: what gets saved and restored
      this.currentUrl = HOME; // may be a sign-in page on another host
      this.pageTitle = '';
      this.ready = false;
      this.loading = false;
      this.canBack = false;
      this.canForward = false;
      this.webContentsId = null;
      this.zoom = 1; // the tab's own zoom; main turns it into a CDP viewport scale
      this.effectiveZoom = null; // what main applied (own zoom x fit-to-width), from viewportInfo
      this.fitted = false;
      this.lastViewport = '';
      this.viewportTimer = null;
      this.watchers = new Set();
      this.disposers = [];
    }

    init(params) {
      const p = params.params || {};
      this.api = params.api;
      this.url = this.currentUrl = isSite(p.url) ? p.url : HOME;
      this.zoom = validZoom(p.zoom);
      this.pageTitle = params.title || '';
      pages.set(this.id, this);
      this.mount();
      this.syncTitle();
      const resize = new ResizeObserver(() => {
        clearTimeout(this.viewportTimer);
        this.viewportTimer = setTimeout(() => this.reportViewport(false), 50);
      });
      resize.observe(this.webview);
      this.disposers.push(
        { dispose: () => resize.disconnect() },
        this.api.onDidVisibilityChange(e => { if (e.isVisible) this.reportViewport(false); }),
      );
    }

    mount() {
      const wv = document.createElement('webview');
      wv.setAttribute('partition', PARTITION);
      wv.setAttribute('allowpopups', '');
      wv.setAttribute('src', this.url);
      wv.addEventListener('dom-ready', () => {
        this.ready = true;
        this.webContentsId = wv.getWebContentsId();
        this.syncTitle();
        this.reportViewport(true);
        this.changed();
      });
      wv.addEventListener('did-start-loading', () => { this.loading = true; this.changed(); });
      wv.addEventListener('did-stop-loading', () => { this.loading = false; this.changed(); });
      wv.addEventListener('did-navigate', e => this.navigated(e.url));
      wv.addEventListener('did-navigate-in-page', e => { if (e.isMainFrame) this.navigated(e.url); });
      wv.addEventListener('page-title-updated', e => {
        this.pageTitle = e.title;
        this.syncTitle();
        tabsChanged();
      });
      wv.addEventListener('focus', () => this.activate());
      this.webview = wv;
      this.element.appendChild(wv);
    }

    panel() {
      return api.getPanel(this.id);
    }

    navigated(url) {
      this.currentUrl = url;
      if (this.ready) this.pageTitle = this.webview.getTitle();
      if (isSite(url) && url !== this.url) {
        this.url = url;
        this.api.updateParameters({ url });
      }
      this.syncTitle();
      this.changed();
    }

    syncTitle() {
      const title = tabProjectNames.get(this.webContentsId) || tabTitle(this.currentUrl, this.pageTitle);
      if (this.api.title !== title) this.api.setTitle(title);
    }

    changed() {
      if (this.ready) {
        // Each is a synchronous call to main, so header refreshes read these copies instead.
        this.canBack = this.webview.canGoBack();
        this.canForward = this.webview.canGoForward();
      }
      for (const watch of this.watchers) watch(this);
      refreshUi();
      tabsChanged();
    }

    // Main sizes the page from this: CSS box of the webview + the tab's own zoom.
    reportViewport(force) {
      if (this.webContentsId == null || !this.api.isVisible) return;
      const box = this.webview.getBoundingClientRect();
      const width = Math.round(box.width);
      const height = Math.round(box.height);
      if (!width || !height) return;
      const key = width + 'x' + height + '@' + this.zoom;
      if (!force && key === this.lastViewport) return;
      this.lastViewport = key;
      hf.viewport({ webContentsId: this.webContentsId, width, height, zoom: this.zoom });
    }

    setZoom(zoom) {
      this.zoom = validZoom(zoom);
      this.api.updateParameters({ zoom: this.zoom });
      this.reportViewport(true);
      refreshUi();
    }

    activate() {
      const panel = this.panel();
      if (panel && api.activePanel !== panel) panel.api.setActive();
    }

    focus() {
      this.webview.focus();
    }

    canGoBack() {
      return this.canBack;
    }

    canGoForward() {
      return this.canForward;
    }

    load(url) {
      if (!isSite(url)) return;
      if (this.ready) this.webview.loadURL(url).catch(() => {});
      else this.webview.setAttribute('src', url);
    }

    back() { if (this.canGoBack()) this.webview.goBack(); }
    forward() { if (this.canGoForward()) this.webview.goForward(); }
    reload() { if (this.ready) this.webview.reload(); }
    hardReload() { if (this.ready) this.webview.reloadIgnoringCache(); }
    devTools() { if (this.ready) this.webview.openDevTools(); }

    dispose() {
      pages.delete(this.id);
      if (!restoring) {
        closedUrls.push(this.url);
        if (closedUrls.length > CLOSED_MAX) closedUrls.shift();
      }
      clearTimeout(this.viewportTimer);
      for (const d of this.disposers) d.dispose();
      this.watchers.clear();
      this.webview.remove();
      tabsChanged();
    }
  }

  // ---------- tab header ----------

  class TabHeader {
    constructor() {
      this.element = el('div', 'hf-tab');
      this.spinner = el('span', 'hf-tab-spinner');
      this.label = el('span', 'hf-tab-title');
      this.closeButton = iconButton('close', 'Close tab', () => this.api.close(), 'hf-tab-close');
      this.closeButton.tabIndex = -1;
      this.element.append(this.spinner, this.label, this.closeButton);
      this.disposers = [];
    }

    init(params) {
      const panelApi = params.api;
      this.api = panelApi;
      this.setTitle(params.title);
      this.disposers.push(panelApi.onDidTitleChange(e => this.setTitle(e.title)));

      const page = pages.get(panelApi.id);
      if (page) {
        const watch = p => this.element.classList.toggle('hf-loading', p.loading);
        page.watchers.add(watch);
        watch(page);
        this.disposers.push({ dispose: () => page.watchers.delete(watch) });
      }

      // Middle click closes; mousedown is cancelled so Chromium's autoscroll doesn't start.
      this.element.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
      this.element.addEventListener('auxclick', e => {
        if (e.button !== 1) return;
        e.preventDefault();
        panelApi.close();
      });
      this.element.addEventListener('click', e => {
        if (e.button === 0) focusPanel(panelApi.id);
      });
    }

    setTitle(title) {
      this.label.textContent = title || 'Higgsfield';
      this.element.title = title || 'Higgsfield';
    }

    dispose() {
      for (const d of this.disposers) d.dispose();
      this.disposers = [];
    }
  }

  // ---------- group header actions ----------

  class HeaderPart {
    constructor(group) {
      this.group = group;
      this.disposers = [];
    }

    init(params) {
      this.disposers.push(params.api.onDidActivePanelChange(() => this.refresh()));
      headerParts.add(this);
      this.refresh();
    }

    page() {
      const panel = this.group.activePanel;
      return panel ? pages.get(panel.id) : undefined;
    }

    refresh() {}

    dispose() {
      headerParts.delete(this);
      for (const d of this.disposers) d.dispose();
      this.disposers = [];
    }
  }

  class NavBar extends HeaderPart {
    constructor(group) {
      super(group);
      this.element = el('div', 'hf-nav');
      headerGroups.set(this.element, group);
      this.backButton = iconButton('back', 'Back', () => this.run(p => p.back()));
      this.forwardButton = iconButton('forward', 'Forward', () => this.run(p => p.forward()));
      this.reloadButton = iconButton('reload', 'Reload', () => this.run(p => p.reload()));
      this.element.append(this.backButton, this.forwardButton, this.reloadButton);
    }

    run(fn) {
      const page = this.page();
      if (!page) return;
      fn(page);
      page.activate();
      page.focus();
    }

    refresh() {
      const page = this.page();
      this.backButton.disabled = !(page && page.canGoBack());
      this.forwardButton.disabled = !(page && page.canGoForward());
      this.reloadButton.disabled = !(page && page.ready);
    }
  }

  // "62%" chip when the group's visible tab is not shown at 100%. Click resets its own zoom.
  class ZoomBadge extends HeaderPart {
    constructor(group) {
      super(group);
      this.element = el('div', 'hf-zoom');
      headerGroups.set(this.element, group);
      this.chip = el('button', 'hf-zoom-chip');
      this.chip.type = 'button';
      this.chip.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); });
      this.chip.addEventListener('click', e => {
        e.stopPropagation();
        const page = this.page();
        if (page) page.setZoom(1);
      });
      this.element.appendChild(this.chip);
    }

    refresh() {
      const page = this.page();
      const zoom = page ? (page.effectiveZoom == null ? page.zoom : page.effectiveZoom) : 1;
      const show = Math.abs(zoom - 1) > 0.005;
      this.element.hidden = !show;
      if (!show) return;
      this.chip.textContent = Math.round(zoom * 100) + '%';
      this.chip.title = page.fitted ? 'Scaled to keep the desktop layout' : 'Zoom';
      this.chip.setAttribute('aria-label', this.chip.title + ' ' + this.chip.textContent + ', click to reset zoom');
    }
  }

  // "+" opens a home tab; the small ▾ beside it lists the site's sections.
  class AddButton {
    constructor(group) {
      this.element = el('div', 'hf-add');
      const more = iconButton('chevron', 'Open a section in a new tab', () => {
        toggleMenu(more, ({ add, label }) => {
          label('Open in new tab');
          for (const section of SECTIONS) add(section.label, () => openTab({ url: section.url, group }), { icon: section.id });
        }, 'left');
      }, 'hf-add-more');
      more.setAttribute('aria-haspopup', 'menu');
      more.setAttribute('aria-expanded', 'false');
      this.element.append(iconButton('plus', 'New tab', () => openTab({ group })), more);
      headerGroups.set(this.element, group);
    }

    init() {}
    dispose() {}
  }

  // ---------- empty state ----------

  class EmptyState {
    constructor() {
      this.element = el('div', 'hf-empty');
      const box = el('div', 'hf-empty-box');
      const newTab = el('button', 'hf-empty-new');
      newTab.type = 'button';
      newTab.append(icon('plus'), el('span', null, 'New tab'));
      newTab.addEventListener('click', () => openTab());
      const grid = el('div', 'hf-empty-grid');
      for (const section of SECTIONS) {
        const button = el('button', 'hf-empty-section');
        button.type = 'button';
        button.append(icon(section.id), el('span', null, section.label));
        button.addEventListener('click', () => openTab({ url: section.url }));
        grid.appendChild(button);
      }
      box.append(el('div', 'hf-empty-title', 'No open tabs'), newTab, grid);
      this.element.appendChild(box);
    }

    init() {}
    dispose() {}
  }

  // ---------- tabs ----------

  function nextId() {
    let id;
    do { id = 'tab-' + ++seq; } while (api.getPanel(id));
    return id;
  }

  function indexAfter(panel) {
    return panel.group.panels.indexOf(panel) + 1;
  }

  // group + direction: new group beside `group`; group (+ index): tab inside `group`;
  // nothing: the active group.
  function openTab({ url, background = false, group, index, direction } = {}) {
    const target = isSite(url) ? url : HOME;
    const reference = group || api.activeGroup;
    let position;
    if (reference) position = { referenceGroup: reference, direction: direction || 'within', index };
    const panel = api.addPanel({
      id: nextId(),
      component: 'web',
      tabComponent: 'web',
      title: tabTitle(target, ''),
      params: { url: target },
      renderer: 'always',
      position,
      inactive: background,
    });
    if (!background) focusPanel(panel.id);
    return panel;
  }

  function focusPanel(id) {
    requestAnimationFrame(() => {
      if (openPrompt) return;
      const page = pages.get(id);
      if (page) page.focus();
    });
  }

  function activePanel() {
    return api.activePanel || (api.activeGroup && api.activeGroup.activePanel) || api.panels[0];
  }

  function activePage() {
    const panel = activePanel();
    return panel ? pages.get(panel.id) : undefined;
  }

  function pageByContents(webContentsId) {
    return [...pages.values()].find(p => p.webContentsId === webContentsId);
  }

  function showPage(page) {
    page.panel().api.setActive();
    focusPanel(page.id);
  }

  function cycle(step) {
    const group = api.activeGroup;
    if (!group || !group.panels.length) return;
    const panels = group.panels;
    const i = panels.indexOf(group.activePanel);
    const next = panels[(i + step + panels.length) % panels.length];
    next.api.setActive();
    focusPanel(next.id);
  }

  // position: 'right' | 'bottom'
  function split(position, panel = activePanel()) {
    if (!panel) return openTab();
    const group = panel.group;
    if (group.panels.length > 1) {
      panel.api.moveTo({ group, position });
      focusPanel(panel.id);
    } else {
      openTab({ group, direction: position === 'right' ? 'right' : 'below' });
    }
  }

  function openAfterActive(url) {
    const panel = activePanel();
    return openTab({ url, index: panel ? indexAfter(panel) : undefined });
  }

  function reopenClosed() {
    const url = closedUrls.pop();
    if (url) openAfterActive(url);
  }

  function resetLayout() {
    api.clear();
    openTab();
  }

  // ---------- state sync with main ----------

  function groupsInLayoutOrder() {
    const ids = [];
    const walk = node => {
      if (!node) return;
      if (node.type === 'leaf') ids.push(node.data.id);
      else node.data.forEach(walk);
    };
    walk(api.toJSON().grid.root);
    const groups = ids.map(id => api.getGroup(id)).filter(Boolean);
    for (const group of api.groups) if (!groups.includes(group)) groups.push(group);
    return groups;
  }

  function collectTabs() {
    const active = api.activePanel;
    return groupsInLayoutOrder().flatMap(group => group.panels.map(panel => {
      const page = pages.get(panel.id);
      return {
        webContentsId: page ? page.webContentsId : null,
        title: panel.api.title || 'Higgsfield',
        active: panel === active,
        visible: group.activePanel === panel,
      };
    }));
  }

  let lastTabs = '';

  function sendTabs() {
    tabsChanged.cancel();
    if (!api) return;
    const tabs = collectTabs();
    const json = JSON.stringify(tabs);
    if (json === lastTabs) return;
    lastTabs = json;
    hf.tabsChanged(tabs);
  }

  const tabsChanged = debounce(sendTabs, 150);

  function saveNow() {
    saveLayout.cancel();
    if (api) hf.saveLayout(api.toJSON());
  }

  const saveLayout = debounce(saveNow, 500);

  // Rebuilds the dock from a saved layout; null or unreadable → one home tab.
  function applyLayout(layout) {
    restoring = true;
    try {
      api.clear();
      if (layout) api.fromJSON(layout);
    } catch (err) {
      console.warn('shell: layout could not be restored', err);
      api.clear();
    } finally {
      restoring = false;
    }
    if (!api.totalPanels) openTab();
    else if (api.activePanel) focusPanel(api.activePanel.id);
  }

  function loadLayout(command) {
    applyLayout(command.layout || null);
    closedUrls.length = 0;
    saveNow();
    lastTabs = '';
    sendTabs();
    refreshUi();
  }

  // ---------- window chrome: one toolbar row ----------
  // [section buttons ▾] [Projects ▾ / current project] [pinned projects] … [status] [Workspace ▾] [lock]

  const chrome = { quick: [], workspaces: [], csProject: null, csProjects: [], menu: null, menuQuery: '' };
  const SEARCH_FROM = 7; // the Projects menu gets a search box from this many projects

  function toolButton(className, children, label) {
    const button = el('button', 'hf-tool-button ' + className);
    button.type = 'button';
    if (label) button.setAttribute('aria-label', label);
    button.append(...children);
    return button;
  }

  function buildToolbar() {
    const bar = document.getElementById('toolbar');

    const quick = el('div', 'hf-quick');
    quick.setAttribute('role', 'toolbar');
    quick.setAttribute('aria-label', 'Sections');
    const quickMore = toolButton('hf-quick-more', [icon('chevron')], 'Choose toolbar buttons');
    quickMore.title = 'Choose toolbar buttons';
    quickMore.setAttribute('aria-haspopup', 'menu');
    quickMore.setAttribute('aria-expanded', 'false');
    quickMore.addEventListener('click', () => toggleMenu(quickMore, quickMenu, 'left'));

    const projectName = el('span', 'hf-project-name', 'Projects');
    const projectButton = toolButton('hf-project-chip', [icon('cinema'), projectName, icon('chevron')]);
    projectButton.title = 'Cinema Studio projects';
    projectButton.setAttribute('aria-haspopup', 'menu');
    projectButton.setAttribute('aria-expanded', 'false');
    projectButton.addEventListener('click', () => toggleMenu(projectButton, projectMenu, 'left'));

    const activity = el('span', 'hf-activity');
    const lastFile = el('button', 'hf-last-file');
    lastFile.type = 'button';
    lastFile.hidden = true;
    lastFile.addEventListener('click', () => { if (chrome.lastFilePath) hf.showInFolder(chrome.lastFilePath); });
    const status = el('div', 'hf-status');
    status.append(activity, lastFile);

    const wsButton = toolButton('hf-workspace-button', [icon('layout'), el('span', null, 'Workspace'), icon('chevron')]);
    wsButton.setAttribute('aria-haspopup', 'menu');
    wsButton.setAttribute('aria-expanded', 'false');
    wsButton.addEventListener('click', () => toggleMenu(wsButton, workspaceMenu, 'right'));

    const lockButton = toolButton('hf-lock-button', [], 'Lock layout');
    lockButton.addEventListener('click', () => {
      setLocked(!locked);
      hf.setLocked(locked);
    });

    const pinned = el('div', 'hf-quick hf-pinned');
    pinned.setAttribute('role', 'toolbar');
    pinned.setAttribute('aria-label', 'Pinned projects');

    bar.append(quick, quickMore, projectButton, pinned, el('div', 'hf-toolbar-spacer'), status, wsButton, lockButton);
    Object.assign(chrome, { bar, quickBox: quick, pinnedBox: pinned, projectButton, projectName, activity, lastFile, wsButton, lockButton });
    new ResizeObserver(fitToolbar).observe(bar);
  }

  // Section and pinned project buttons drop their labels when the row runs out of room;
  // pinned projects that still do not fit are left to the Projects menu, which lists them first.
  function fitToolbar() {
    const bar = chrome.bar;
    // Measured with nothing shrunk, since the project button and the status would shrink first.
    const over = () => {
      bar.classList.add('hf-measure');
      const result = bar.scrollWidth > bar.clientWidth;
      bar.classList.remove('hf-measure');
      return result;
    };
    const pins = [...chrome.pinnedBox.children];
    let hidden = 0;
    for (const pin of pins) pin.hidden = false;
    chrome.projectButton.dataset.more = '';
    bar.classList.remove('hf-compact');
    if (over()) bar.classList.add('hf-compact');
    while (hidden < pins.length && over()) {
      pins[pins.length - ++hidden].hidden = true;
      chrome.projectButton.dataset.more = '+' + hidden;
    }
  }

  // Goes to a tab already showing the section, or opens one.
  function openSection(section, newTab) {
    const shows = page => page && sectionFor(page.url) === section;
    const page = newTab ? null : (shows(activePage()) ? activePage() : [...pages.values()].find(shows));
    if (page) showPage(page);
    else openAfterActive(section.url);
  }

  function setQuickSections(ids) {
    chrome.quick = Array.isArray(ids) ? ids : [];
    const buttons = SECTIONS.filter(s => chrome.quick.includes(s.id)).map(section => {
      const button = toolButton('hf-quick-button', [icon(section.id), el('span', null, section.label)], section.label);
      button.title = section.label + ' (' + NEW_TAB_CLICK + ': new tab)';
      button.dataset.section = section.id;
      button.addEventListener('click', e => openSection(section, wantsNewTab(e)));
      button.addEventListener('auxclick', e => { if (e.button === 1) openSection(section, true); });
      return button;
    });
    chrome.quickBox.replaceChildren(...buttons);
    syncQuickSections();
    fitToolbar();
    if (chrome.menu && chrome.menu.build === quickMenu) reopenMenu();
  }

  // Marks the button of the section, or the pinned project, the active tab is showing.
  function syncQuickSections() {
    const page = api && activePage();
    const current = page && sectionFor(page.url);
    for (const button of chrome.quickBox.children) {
      button.classList.toggle('hf-current', !!current && current.id === button.dataset.section);
    }
    const project = chrome.csProject && chrome.csProject.key;
    for (const button of chrome.pinnedBox.children) {
      button.classList.toggle('hf-current', !!project && project === button.dataset.key);
    }
  }

  // The Cinema Studio project of the active tab (main detects it), or null.
  function setCsProject(project) {
    chrome.csProject = project && project.name ? project : null;
    syncProjectButton();
    if (chrome.menu && chrome.menu.build === projectMenu) reopenMenu();
    syncQuickSections();
    fitToolbar();
  }

  function setCsProjects(items) {
    chrome.csProjects = Array.isArray(items) ? items.filter(p => p && p.key && p.name && isSite(p.url)) : [];
    const pinned = pinnedProjects();
    chrome.pinnedBox.replaceChildren(...pinned.map((p, i) => pinnedButton(p, i, pinned.length)));
    syncProjectButton();
    syncQuickSections();
    fitToolbar();
    if (chrome.menu && chrome.menu.build === projectMenu) reopenMenu();
  }

  function pinnedProjects() {
    return chrome.csProjects.filter(p => p.pinned).sort((a, b) => a.pinned - b.pinned);
  }

  function knownProject(key) {
    return chrome.csProjects.find(p => p.key === key) || null;
  }

  // Named after the active tab's project, unless that project has its own (lit) button already.
  function syncProjectButton() {
    const project = chrome.csProject;
    const button = chrome.projectButton;
    const pinned = !!project && !!(knownProject(project.key) || {}).pinned;
    const named = !!project && !pinned;
    button.classList.toggle('hf-in-project', named);
    chrome.projectName.textContent = named ? String(project.name) : 'Projects';
    if (named) {
      button.title = project.folder ? project.name + '\n' + project.folder : String(project.name);
      button.setAttribute('aria-label', 'Cinema Studio project: ' + project.name);
    } else {
      button.title = 'Cinema Studio projects';
      button.setAttribute('aria-label', 'Cinema Studio projects');
    }
  }

  // A small square with the project's initials in its Higgsfield colour, so pinned
  // projects stay apart when the toolbar drops their names.
  function projectBadge(project) {
    const { text, bg, fg } = HFBadge.badge(project);
    const badge = el('i', 'hf-project-badge', text);
    badge.style.setProperty('--hf-badge', bg);
    badge.style.color = fg;
    return badge;
  }

  function projectTitle(project) {
    return project.shared && project.owner ? project.name + ' (shared by @' + project.owner + ')' : project.name;
  }

  function pinnedButton(project, index, count) {
    const badge = projectBadge(project);
    const button = toolButton('hf-quick-button hf-pinned-project', [badge, el('span', null, project.name)], projectTitle(project));
    button.dataset.key = project.key;
    button.style.setProperty('--hf-badge', badge.style.getPropertyValue('--hf-badge'));
    button.title = projectTitle(project) + '\n' + NEW_TAB_CLICK + ': new tab · Right-click: more';
    button.addEventListener('click', e => openProject(project, wantsNewTab(e)));
    button.addEventListener('auxclick', e => { if (e.button === 1) openProject(project, true); });
    button.addEventListener('contextmenu', e => {
      e.preventDefault();
      closeMenu();
      openMenu(button, ({ add, separator }) => {
        add('Open in new tab', () => openProject(project, true), { icon: 'plus' });
        add('Open project folder', () => hf.projectAction('openFolder', project.key), { icon: 'folder' });
        separator();
        add('Move left', () => hf.projectAction('moveLeft', project.key), { icon: 'back', disabled: index === 0 });
        add('Move right', () => hf.projectAction('moveRight', project.key), { icon: 'forward', disabled: index === count - 1 });
        add('Unpin from toolbar', () => hf.projectAction('unpin', project.key), { icon: 'pin' });
      }, 'left');
    });
    return button;
  }

  // Goes to a tab already inside the project (or one of its folders), or opens one.
  function openProject(project, newTab) {
    const norm = url => {
      try { return decodeURIComponent(pageKey(url)).toLowerCase(); } catch { return pageKey(url).toLowerCase(); }
    };
    const base = norm(project.url);
    const shows = page => page && (norm(page.url) + '/').startsWith(base + '/');
    const page = newTab ? null : (shows(activePage()) ? activePage() : [...pages.values()].find(shows));
    if (page) showPage(page);
    else openAfterActive(project.url);
  }

  function setWorkspaces(items) {
    chrome.workspaces = Array.isArray(items) ? items : [];
    if (chrome.menu && chrome.menu.build === workspaceMenu) reopenMenu();
  }

  function setLocked(value) {
    locked = !!value;
    if (api) api.updateOptions({ disableDnd: locked });
    const button = chrome.lockButton;
    button.replaceChildren(icon(locked ? 'lock' : 'unlock'));
    button.setAttribute('aria-pressed', String(locked));
    button.title = locked ? 'Layout locked (click to unlock)' : 'Lock layout';
    document.body.classList.toggle('hf-locked', locked);
  }

  function setGenerating(count) {
    const n = Math.max(0, Number(count) || 0);
    const activity = chrome.activity;
    activity.replaceChildren();
    activity.classList.toggle('hf-busy', n > 0);
    if (n > 0) activity.append(el('span', 'hf-pulse'), el('span', null, n + ' generating'));
    else activity.textContent = 'Ready';
  }

  function setLastFile(filePath) {
    chrome.lastFilePath = filePath;
    const button = chrome.lastFile;
    button.hidden = false;
    button.replaceChildren(icon('download'), el('span', null, baseName(filePath)));
    button.title = 'Show ' + baseName(filePath) + (IS_MAC ? ' in Finder' : ' in folder');
    fitToolbar();
  }

  // Menu builders get add(text, onClick, { disabled, icon, checked }), label(text), separator().
  // A checkable item leaves the menu open, so several can be toggled in a row.
  function quickMenu({ add, label }) {
    label('Show in toolbar');
    for (const section of SECTIONS) {
      const shown = chrome.quick.includes(section.id);
      add(section.label, () => hf.setQuickSections(shown
        ? chrome.quick.filter(id => id !== section.id)
        : [...chrome.quick, section.id]), { icon: section.id, checked: shown });
    }
  }

  function workspaceMenu({ add, label, separator }) {
    if (chrome.workspaces.length) {
      label('Workspaces');
      for (const ws of chrome.workspaces) add(ws.name, () => hf.workspace('load', { id: ws.id }));
    } else {
      add('No saved workspaces', null, { disabled: true });
    }
    separator();
    add('Save Workspace…', () => hf.workspace('save'));
    add('Manage Workspaces…', () => hf.workspace('manage'));
    separator();
    add('Reset Layout', resetLayout);
  }

  // Pinned first (in toolbar order), then yours and shared ones, most recently used first.
  // While the menu stays open, pinning or unpinning leaves every row where it is; the
  // groups are sorted again the next time it opens.
  function projectMenu({ add, label, separator, search }) {
    const current = chrome.csProject && knownProject(chrome.csProject.key);
    if (chrome.csProject) {
      add('Open project folder', () => hf.projectAction('openFolder'), { icon: 'folder', disabled: !chrome.csProject.folder });
      add('Rename folder…', () => hf.projectAction('rename'), { icon: 'rename' });
      if (current) {
        add(current.pinned ? 'Unpin from toolbar' : 'Pin to toolbar',
          () => hf.projectAction(current.pinned ? 'unpin' : 'pin', current.key), { icon: 'pin' });
      }
      separator();
    }
    const all = chrome.csProjects;
    if (all.length >= SEARCH_FROM) search('Find a project');
    const groupOf = p => (p.pinned ? 0 : p.shared ? 2 : 1);
    const frozen = chrome.menuGroups || (chrome.menuGroups = new Map(all.map(p => [p.key, groupOf(p)])));
    const order = new Map(all.map((p, i) => [p.key, i]));
    const groups = [['Pinned'], ['Your projects'], ['Shared with you']].map(([title]) => [title, []]);
    for (const p of all) groups[frozen.has(p.key) ? frozen.get(p.key) : groupOf(p)][1].push(p);
    groups[0][1].sort((a, b) => (a.pinned || Infinity) - (b.pinned || Infinity) || order.get(a.key) - order.get(b.key));
    for (const [title, list] of groups) {
      if (!list.length) continue;
      label(title, { filterGroup: true });
      for (const p of list) {
        add(p.name, e => openProject(p, wantsNewTab(e)), {
          lead: projectBadge(p),
          hint: p.shared && p.owner ? '@' + p.owner : '',
          title: projectTitle(p) + '\n' + NEW_TAB_CLICK + ': new tab · P: pin',
          current: !!chrome.csProject && chrome.csProject.key === p.key,
          filter: p.name + ' ' + (p.owner || ''),
          side: {
            icon: 'pin',
            label: p.pinned ? 'Unpin from toolbar' : 'Pin to toolbar',
            on: !!p.pinned,
            onClick: () => hf.projectAction(p.pinned ? 'unpin' : 'pin', p.key),
          },
        });
      }
    }
    if (!all.length) add('Open a project in Cinema Studio and it shows up here', null, { disabled: true });
    separator();
    add('All Cinema Studio projects', () => openAfterActive(HOME + 'generate?view=projects'), { icon: 'cinema' });
    add('Manage projects…', () => hf.projectAction('manage'), { icon: 'sliders' });
  }

  function toggleMenu(anchor, build, align) {
    const same = chrome.menu && chrome.menu.anchor === anchor;
    closeMenu();
    chrome.menuQuery = '';
    chrome.menuGroups = null;
    if (!same) openMenu(anchor, build, align);
  }

  // Everything in a menu that takes keyboard focus, in order.
  function focusables(menu) {
    return [...menu.querySelectorAll('.hf-menu-search, .hf-menu-item:not(:disabled), .hf-menu-side')];
  }

  // Rebuilds the open menu with fresh contents, keeping keyboard focus on the same item.
  function reopenMenu() {
    const { anchor, build, align, element } = chrome.menu;
    const focusIndex = focusables(element).indexOf(document.activeElement);
    closeMenu();
    openMenu(anchor, build, align, focusIndex < 0 ? null : focusIndex);
  }

  // Hides the items that do not match the search box, and the group labels with them.
  function filterMenu(menu, query) {
    const q = query.trim().toLowerCase();
    let shown = 0;
    for (const item of menu.querySelectorAll('[data-filter]')) {
      const match = !q || item.dataset.filter.toLowerCase().includes(q);
      (item.closest('.hf-menu-row') || item).hidden = !match;
      if (match) shown++;
    }
    for (const groupLabel of menu.querySelectorAll('.hf-menu-filter-group')) groupLabel.hidden = !!q;
    const none = menu.querySelector('.hf-menu-none');
    if (none) none.hidden = !q || shown > 0;
  }

  // focusIndex: of focusables(menu); null focuses the search box, or else the first item.
  function openMenu(anchor, build, align, focusIndex = null) {
    const menu = el('div', 'hf-menu');
    menu.setAttribute('role', 'menu');
    let searchBox = null;
    build({
      // opts: { disabled, icon, lead (node), checked, current, title, hint (quiet text at the end),
      //         filter (search text), side: { icon, label, on, onClick } (a small button at the end of the row) }
      add: (text, onClick, opts = {}) => {
        const item = el('button', 'hf-menu-item');
        const checkable = opts.checked !== undefined;
        item.type = 'button';
        item.setAttribute('role', checkable ? 'menuitemcheckbox' : 'menuitem');
        item.disabled = !!opts.disabled;
        if (opts.title) item.title = opts.title;
        if (opts.filter) item.dataset.filter = opts.filter;
        if (opts.current) item.classList.add('hf-current');
        if (opts.lead) item.appendChild(el('span', 'hf-menu-lead')).appendChild(opts.lead);
        else if (opts.icon) item.appendChild(icon(opts.icon));
        item.appendChild(el('span', 'hf-menu-text', text));
        if (opts.hint) item.appendChild(el('span', 'hf-menu-hint', opts.hint));
        if (checkable) {
          item.setAttribute('aria-checked', String(!!opts.checked));
          const check = icon('check');
          check.classList.add('hf-menu-check');
          item.appendChild(check);
        }
        item.addEventListener('click', e => {
          if (!checkable) closeMenu();
          if (onClick) onClick(e);
        });
        if (!opts.side) {
          menu.appendChild(item);
          return;
        }
        const row = el('div', 'hf-menu-row');
        const side = el('button', 'hf-menu-side');
        side.type = 'button';
        side.title = opts.side.label;
        side.setAttribute('aria-label', opts.side.label + ': ' + text);
        side.setAttribute('aria-pressed', String(!!opts.side.on));
        side.appendChild(icon(opts.side.icon));
        side.tabIndex = -1;
        side.addEventListener('click', opts.side.onClick);
        row.append(item, side);
        menu.appendChild(row);
      },
      label: (text, opts = {}) => menu.appendChild(el('div', 'hf-menu-label' + (opts.filterGroup ? ' hf-menu-filter-group' : ''), text)),
      separator: () => menu.appendChild(el('div', 'hf-menu-separator')),
      search: placeholder => {
        const box = el('label', 'hf-menu-search-box');
        searchBox = el('input', 'hf-menu-search');
        searchBox.type = 'search';
        searchBox.placeholder = placeholder;
        searchBox.spellcheck = false;
        searchBox.setAttribute('aria-label', placeholder);
        searchBox.value = chrome.menuQuery;
        searchBox.addEventListener('input', () => {
          chrome.menuQuery = searchBox.value;
          filterMenu(menu, searchBox.value);
        });
        searchBox.addEventListener('keydown', e => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const first = items().find(i => i.dataset.filter);
          if (first) first.click();
        });
        box.append(icon('search'), searchBox);
        menu.append(box, el('div', 'hf-menu-label hf-menu-none', 'No matching projects'));
      },
    });
    if (searchBox) filterMenu(menu, searchBox.value);

    const box = anchor.getBoundingClientRect();
    menu.style.top = Math.round(box.bottom + 4) + 'px';
    if (align === 'left') menu.style.left = Math.round(box.left) + 'px';
    else menu.style.right = Math.round(document.documentElement.clientWidth - box.right) + 'px';
    document.body.appendChild(menu);
    anchor.setAttribute('aria-expanded', 'true');
    anchor.classList.add('hf-open');
    document.body.classList.add('hf-menu-open');

    const items = () => [...menu.querySelectorAll('.hf-menu-item:not(:disabled)')].filter(i => !i.closest('[hidden]'));
    // Up and Down move between items; Right reaches a row's pin and Left goes back; P toggles it.
    const onKey = e => {
      const active = document.activeElement;
      const row = active && active.closest && active.closest('.hf-menu-row');
      const inSearch = active === searchBox;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMenu();
        anchor.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const list = items();
        const from = row ? row.querySelector('.hf-menu-item') : active;
        const i = list.indexOf(from);
        const next = e.key === 'ArrowDown' ? i + 1 : (i < 0 ? 0 : i) - 1;
        if (list.length) list[(next + list.length) % list.length].focus();
      } else if (row && !inSearch && e.key === 'ArrowRight') {
        e.preventDefault();
        row.querySelector('.hf-menu-side').focus();
      } else if (row && !inSearch && e.key === 'ArrowLeft') {
        e.preventDefault();
        row.querySelector('.hf-menu-item').focus();
      } else if (row && !inSearch && (e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        row.querySelector('.hf-menu-side').click();
      }
    };
    const onDown = e => {
      if (!menu.contains(e.target) && !anchor.contains(e.target)) closeMenu();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('blur', closeMenu);
    chrome.menu = {
      element: menu,
      anchor,
      build,
      align,
      dispose: () => {
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('pointerdown', onDown, true);
        window.removeEventListener('blur', closeMenu);
      },
    };
    const target = focusIndex === null ? searchBox || items()[0] : focusables(menu)[focusIndex] || items()[0];
    if (target) target.focus();
  }

  function closeMenu() {
    const menu = chrome.menu;
    if (!menu) return;
    chrome.menu = null;
    menu.dispose();
    menu.element.remove();
    menu.anchor.setAttribute('aria-expanded', 'false');
    menu.anchor.classList.remove('hf-open');
    document.body.classList.remove('hf-menu-open');
  }

  function refreshUi() {
    for (const part of headerParts) part.refresh();
    syncQuickSections();
  }

  // ---------- toasts ----------

  function toast(text, filePath) {
    const host = document.getElementById('toasts');
    const item = el('div', 'hf-toast');
    item.appendChild(el('span', 'hf-toast-text', String(text || '')));
    let timer = null;
    const dismiss = () => {
      clearTimeout(timer);
      item.classList.add('hf-toast-out');
      setTimeout(() => item.remove(), 200);
    };
    if (filePath) {
      const show = el('button', 'hf-toast-action', SHOW_IN_FOLDER);
      show.type = 'button';
      show.addEventListener('click', () => { hf.showInFolder(filePath); dismiss(); });
      item.appendChild(show);
      setLastFile(filePath);
    }
    item.appendChild(iconButton('close', 'Dismiss', dismiss, 'hf-toast-close'));
    host.appendChild(item);
    while (host.children.length > 4) host.firstElementChild.remove();
    timer = setTimeout(dismiss, TOAST_MS);
    item.addEventListener('mouseenter', () => clearTimeout(timer));
    item.addEventListener('mouseleave', () => { timer = setTimeout(dismiss, 2000); });
  }

  // ---------- prompt dialog ----------

  let openPrompt = null;

  function showPrompt({ requestId, title, message, value, okLabel }) {
    if (openPrompt) openPrompt.finish(null);
    closeMenu();

    const backdrop = el('div', 'hf-modal-backdrop');
    const form = el('form', 'hf-modal');
    form.setAttribute('role', 'dialog');
    form.setAttribute('aria-modal', 'true');
    form.setAttribute('aria-labelledby', 'hf-modal-title');
    const heading = el('div', 'hf-modal-title', title || '');
    heading.id = 'hf-modal-title';
    form.appendChild(heading);
    if (message) form.appendChild(el('div', 'hf-modal-message', message));
    const input = el('input', 'hf-modal-input');
    input.type = 'text';
    input.spellcheck = false;
    input.value = value == null ? '' : String(value);
    input.setAttribute('aria-labelledby', 'hf-modal-title');
    const actions = el('div', 'hf-modal-actions');
    const cancel = el('button', 'hf-button', 'Cancel');
    cancel.type = 'button';
    const ok = el('button', 'hf-button hf-button-primary', okLabel || 'OK');
    ok.type = 'submit';
    actions.append(cancel, ok);
    form.append(input, actions);
    backdrop.appendChild(form);

    const syncOk = () => { ok.disabled = !input.value.trim(); };
    const finish = result => {
      if (openPrompt !== entry) return;
      openPrompt = null;
      backdrop.remove();
      hf.promptResult(requestId, result);
      const page = activePage();
      if (page) page.focus();
    };
    const entry = { finish };

    input.addEventListener('input', syncOk);
    form.addEventListener('submit', e => {
      e.preventDefault();
      const text = input.value.trim();
      if (text) finish(text);
    });
    cancel.addEventListener('click', () => finish(null));
    form.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      } else if (e.key === 'Tab') {
        // Keep focus inside the dialog.
        const stops = [input, cancel, ok].filter(x => !x.disabled);
        const i = stops.indexOf(document.activeElement);
        e.preventDefault();
        stops[(i + (e.shiftKey ? -1 : 1) + stops.length) % stops.length].focus();
      }
    });
    backdrop.addEventListener('mousedown', e => {
      if (e.target === backdrop) {
        e.preventDefault();
        input.focus();
      }
    });

    openPrompt = entry;
    syncOk();
    document.body.appendChild(backdrop);
    input.focus();
    input.select();
  }

  // ---------- commands from main ----------

  function withPage(fn) {
    const page = activePage();
    if (page) fn(page);
  }

  function withTarget(command, fn) {
    const page = command.webContentsId == null ? activePage() : pageByContents(command.webContentsId);
    if (page) fn(page);
  }

  const COMMANDS = {
    newTab: c => openTab({
      url: c.url,
      background: !!c.background,
      index: activePanel() ? indexAfter(activePanel()) : undefined,
    }),
    closeTab: () => { const panel = activePanel(); if (panel) panel.api.close(); },
    reopenClosedTab: reopenClosed,
    nextTab: () => cycle(1),
    prevTab: () => cycle(-1),
    splitRight: () => split('right'),
    splitDown: () => split('bottom'),
    back: () => withPage(p => p.back()),
    forward: () => withPage(p => p.forward()),
    reload: () => withPage(p => p.reload()),
    hardReload: () => withPage(p => p.hardReload()),
    home: () => withPage(p => p.load(HOME)),
    zoomIn: c => withTarget(c, p => p.setZoom(stepZoom(p.zoom, 1))),
    zoomOut: c => withTarget(c, p => p.setZoom(stepZoom(p.zoom, -1))),
    resetZoom: c => withTarget(c, p => p.setZoom(1)),
    devTools: () => withPage(p => p.devTools()),
    focusTab: c => { const page = pageByContents(c.webContentsId); if (page) showPage(page); },
    reloadAll: () => { for (const page of pages.values()) page.hardReload(); },
    resetLayout,
    toast: c => toast(c.text, c.filePath),
    loadLayout,
    prompt: showPrompt,
    workspaces: c => setWorkspaces(c.items),
    quickSections: c => setQuickSections(c.ids),
    csProject: setCsProject,
    csProjects: c => setCsProjects(c.items),
    tabProject: c => {
      if (c.name) tabProjectNames.set(c.webContentsId, String(c.name));
      else tabProjectNames.delete(c.webContentsId);
      const page = pageByContents(c.webContentsId);
      if (page) {
        page.syncTitle();
        tabsChanged();
      }
    },
    setLocked: c => setLocked(c.locked),
    viewportInfo: c => {
      const page = pageByContents(c.webContentsId);
      if (!page) return;
      page.effectiveZoom = Number(c.zoom) || 1;
      page.fitted = !!c.fitted;
      refreshUi();
    },
    status: c => setGenerating(c.generating),
    fullScreen: c => document.body.classList.toggle('hf-fullscreen', !!c.on),
  };

  function runCommand(command) {
    const handler = command && Object.prototype.hasOwnProperty.call(COMMANDS, command.type)
      ? COMMANDS[command.type] : null;
    if (!handler) return;
    try {
      handler(command);
    } catch (err) {
      console.error('shell command failed', command.type, err);
    }
  }

  // ---------- startup ----------

  function tabMenu({ panel }) {
    const page = pages.get(panel.id);
    return [
      { label: 'New tab to the right', action: () => openTab({ group: panel.group, index: indexAfter(panel) }) },
      { label: 'Duplicate', action: () => openTab({ url: page && page.url, group: panel.group, index: indexAfter(panel) }) },
      { label: 'Reload', action: () => page && page.reload() },
      'separator',
      { label: 'Split right', action: () => split('right', panel) },
      { label: 'Split down', action: () => split('bottom', panel) },
      'separator',
      'close',
      'closeOthers',
      'closeRight',
    ];
  }

  // A press in a group header must keep receiving pointer moves while the cursor crosses
  // a webview; otherwise a quick flick onto a page never passes dockview's drag threshold
  // and the release is lost inside the guest. Dockview only shields webviews once a drag
  // has started, so shield them from the press itself.
  // Same for dockview's popovers (the tab menu and the overflow list): they close on Escape
  // or a click outside, both of which a focused or clicked webview would swallow.
  function shieldWebviews() {
    const body = document.body;
    const release = () => body.classList.remove('hf-pressing');
    window.addEventListener('pointerdown', e => {
      if (e.button === 0 && e.target.closest && e.target.closest('.dv-tabs-and-actions-container')) {
        body.classList.add('hf-pressing');
      }
    }, true);
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    window.addEventListener('blur', release);

    for (const anchor of document.querySelectorAll('.dv-popover-anchor')) {
      new MutationObserver(() => {
        const open = !!anchor.firstElementChild;
        body.classList.toggle('hf-popover-open', open);
        const focused = document.activeElement;
        if (open && focused && focused.tagName === 'WEBVIEW') focused.blur();
        if (!open && api.activePanel && !(focused && focused.closest('input, textarea, .hf-modal, .hf-menu'))) {
          focusPanel(api.activePanel.id);
        }
      }).observe(anchor, { childList: true });
    }
  }

  // Dropping a tab (or a whole group) on a header's own widgets (back/forward/reload, +,
  // zoom chip) should dock it into that group like the rest of the header does; dockview
  // highlights those spots but ignores the drop.
  function dropOnHeaderWidgets() {
    let dragged = null;
    api.onWillDragPanel(e => { dragged = { panel: e.panel }; });
    api.onWillDragGroup(e => { dragged = { group: e.group }; });
    window.addEventListener('pointerup', e => {
      const item = dragged;
      dragged = null;
      if (!item || locked || !e.target.closest) return;
      const widget = e.target.closest('.hf-nav, .hf-add, .hf-zoom');
      const target = widget && headerGroups.get(widget);
      if (!target) return;
      // After dockview has finished handling (and ignoring) the drop itself.
      setTimeout(() => {
        if (!api.getGroup(target.id)) return;
        if (item.panel && api.getPanel(item.panel.id) && item.panel.group !== target) {
          item.panel.api.moveTo({ group: target, position: 'center' });
        } else if (item.group && item.group !== target && api.getGroup(item.group.id)) {
          item.group.api.moveTo({ group: target, position: 'center' });
        }
      }, 0);
    }, true);
  }

  function createDock() {
    return createDockview(document.getElementById('dock'), {
      theme: {
        name: 'higgsfield',
        className: 'dockview-theme-dark hf-theme',
        colorScheme: 'dark',
        dndOverlayMounting: 'absolute',
        dndPanelOverlay: 'group',
        dndTabIndicator: 'line',
        dndOverlayBorder: '2px solid #D1FE17',
        tabGroupIndicator: 'none',
      },
      // Pointer drags stay routed to this page while the cursor crosses a webview;
      // native HTML5 drags depend on the guest letting the drag events through.
      dndStrategy: 'pointer',
      disableDnd: locked,
      defaultRenderer: 'always',
      disableFloatingGroups: true,
      defaultTabComponent: 'web',
      createComponent: ({ id }) => new Page(id),
      createTabComponent: () => new TabHeader(),
      createPrefixHeaderActionComponent: group => new NavBar(group),
      createLeftHeaderActionComponent: group => new AddButton(group),
      createRightHeaderActionComponent: group => new ZoomBadge(group),
      createWatermarkComponent: () => new EmptyState(),
      getTabContextMenuItems: tabMenu,
    });
  }

  async function start() {
    let state = {};
    try {
      state = (await hf.getInitialState()) || {};
    } catch (err) {
      console.error('shell: no initial state', err);
    }
    locked = !!state.locked;
    document.body.classList.toggle('hf-mac', IS_MAC);

    buildToolbar();
    setWorkspaces(state.workspaces);
    setGenerating(state.generating);
    setCsProjects(state.csProjects);
    setQuickSections(state.quickSections);
    api = createDock();
    setLocked(locked);
    shieldWebviews();
    dropOnHeaderWidgets();
    applyLayout(state.layout || null);

    api.onDidLayoutChange(() => {
      saveLayout();
      tabsChanged();
      refreshUi();
    });
    api.onDidActivePanelChange(e => {
      refreshUi();
      if (e.panel) focusPanel(e.panel.id);
    });
    window.addEventListener('beforeunload', saveNow);
    hf.onCommand(runCommand);
    refreshUi();
    tabsChanged();
    saveLayout();
  }

  start();
})();
