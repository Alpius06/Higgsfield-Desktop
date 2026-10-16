// Cinema Studio projects, picked up automatically. Higgsfield keeps projects
// on its side (it calls them folders); when a tab is inside one, files
// downloaded from that tab are saved in a folder named after the project.
// A project is listed from its address the moment a tab opens it; its real
// name, id and owner follow from Higgsfield's own API responses (folders.js).
// Stored in userData/projects.json. Call load() after app 'ready'.
// Emits 'change' (list) when a project is added, renamed, pinned, moved or forgotten.
const { app } = require('electron');
const { EventEmitter } = require('events');
const path = require('path');
const { readJson, writeJson, cleanName } = require('./store');
const { HOME, isSite } = require('../shared/actions');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Higgsfield rewrites /generate?projectId=<id> to /generate/@user/<slug>;
// a slug page seen this soon after an id page in the same tab is the same project.
const CANONICAL_REDIRECT_MS = 15000;

// The Cinema Studio project a URL is in, or null.
function detect(url) {
  if (!isSite(url)) return null;
  const u = new URL(url);
  const slug = u.pathname.match(/^\/generate\/(@[^/]+\/[^/]+)/);
  if (slug) {
    const s = decodeURIComponent(slug[1]);
    return { key: 'slug:' + s, slug: s, id: null, url: `${HOME}generate/${slug[1]}` };
  }
  if (!/^\/generate\/?$/.test(u.pathname)) return null;
  const id = u.searchParams.get('projectId') || u.searchParams.get('cinematic-project-id');
  if (!id || !UUID.test(id)) return null;
  return { key: 'id:' + id.toLowerCase(), slug: null, id: id.toLowerCase(), url: `${HOME}generate?projectId=${id}` };
}

// "@wolf/nike-spot-2" -> "Nike spot 2"
function nameFromSlug(slug) {
  const words = slug.split('/').pop().replace(/[-_]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Cinema Studio project';
}

// A project name as a Windows folder name.
function folderName(name) {
  const safe = String(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim();
  return safe || 'Project';
}

// From Higgsfield, or else from the project's address (slug:@user/project).
function ownerOf(project) {
  if (project.owner) return project.owner;
  const m = project.key.match(/^slug:@([^/]+)\//);
  return m ? m[1] : null;
}

function sameKey(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}

class Projects extends EventEmitter {
  constructor() {
    super();
    this.items = [];
    this.getRoot = null;
    this.aliases = new Map(); // old key -> key, for projects merged or re-keyed this session
  }

  get file() {
    return path.join(app.getPath('userData'), 'projects.json');
  }

  // getRoot(): the download folder from Settings.
  load({ getRoot }) {
    this.getRoot = getRoot;
    const data = readJson(this.file);
    if (data && Array.isArray(data.items)) this.items = data.items.filter(p => p && p.key && p.name);
  }

  save() {
    writeJson(this.file, { items: this.items });
  }

  changed() {
    this.save();
    this.emit('change', this.list());
  }

  get(key) {
    while (this.aliases.has(key)) key = this.aliases.get(key);
    return this.items.find(p => p.key === key) || null;
  }

  folderFor(project) {
    return project.downloadFolder || path.join(this.getRoot(), folderName(project.name));
  }

  // Most recently used first.
  list() {
    // Projects Higgsfield has not described yet are someone else's when their address
    // names a user other than the ones whose own projects have been seen.
    const mine = new Set(this.items.filter(p => p.role === 'owner' && p.owner).map(p => p.owner.toLowerCase()));
    const shared = p => {
      if (p.role) return p.role !== 'owner';
      const owner = ownerOf(p);
      return !!owner && mine.size > 0 && !mine.has(owner.toLowerCase());
    };
    return [...this.items]
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
      .map(p => ({
        key: p.key,
        name: p.name,
        url: p.url,
        downloadFolder: this.folderFor(p),
        customFolder: !!p.downloadFolder,
        lastSeen: p.lastSeen || 0,
        owner: ownerOf(p),
        shared: shared(p), // someone else's project you were invited to
        color: p.color || null,
        pinned: p.pinned || 0, // when it was pinned to the toolbar; 0 = not pinned
      }));
  }

  // A tab navigated to `url`. previous: { key, at } of that tab's last project.
  // Returns the project the tab is now in, or null.
  seen(url, previous) {
    const found = detect(url);
    if (!found) return null;
    // Opened by id, a project already known under its address is still the same project.
    let project = this.get(found.key) || (found.id && this.items.find(p => p.id === found.id)) || null;
    let isNew = false;

    if (!project && found.slug && previous && previous.key.startsWith('id:')
        && Date.now() - previous.at < CANONICAL_REDIRECT_MS) {
      // The same project, now under its canonical address.
      project = this.get(previous.key);
      if (project) {
        project.key = found.key;
        project.url = found.url;
        if (!project.customName) project.name = nameFromSlug(found.slug);
        isNew = true;
      }
    }
    if (!project) {
      project = {
        key: found.key,
        id: found.id,
        url: found.url,
        name: found.slug ? nameFromSlug(found.slug) : 'Cinema Studio project',
        customName: false,
        downloadFolder: null,
      };
      this.items.push(project);
      isNew = true;
    }
    const stale = Date.now() - (project.lastSeen || 0) > 60 * 1000;
    project.lastSeen = Date.now();
    if (isNew) this.changed();
    else if (stale) this.save();
    return project;
  }

  // A project as Higgsfield describes it (a folder object from its API).
  // add: a tab is opening it, so it is listed if new; otherwise only projects
  // already in the app are updated. Returns true if anything changed.
  applyFolder(folder, add) {
    if (!folder || typeof folder !== 'object' || !UUID.test(folder.id || '') || folder.is_root === false) return false;
    if (typeof folder.slug !== 'string' || typeof folder.owner_username !== 'string' || !folder.slug || !folder.owner_username) return false;
    const id = folder.id.toLowerCase();
    const key = `slug:@${folder.owner_username}/${folder.slug}`;
    const matches = this.items.filter(p => p.id === id || p.key === 'id:' + id || sameKey(p.key, key));
    if (!matches.length && !add) return false;

    let project = matches.find(p => p.key.startsWith('slug:')) || matches[0];
    const before = JSON.stringify(project || null);
    if (!project) {
      project = { key, customName: false, downloadFolder: null, lastSeen: Date.now() };
      this.items.push(project);
    }
    // The same project seen under its id and its address: keep one, with the user's choices.
    for (const other of matches) {
      if (other === project) continue;
      if (other.customName && !project.customName) Object.assign(project, { name: other.name, customName: true });
      project.downloadFolder = project.downloadFolder || other.downloadFolder || null;
      project.pinned = project.pinned || other.pinned || 0;
      project.lastSeen = Math.max(project.lastSeen || 0, other.lastSeen || 0);
      this.aliases.set(other.key, project.key);
      this.items = this.items.filter(p => p !== other);
    }
    if (project.key !== key) {
      this.aliases.set(project.key, key);
      project.key = key;
    }
    project.id = id;
    project.url = `${HOME}generate/@${encodeURIComponent(folder.owner_username)}/${encodeURIComponent(folder.slug)}`;
    project.owner = folder.owner_username;
    if (typeof folder.role === 'string') project.role = folder.role;
    if (typeof folder.color === 'string') project.color = folder.color;
    const name = cleanName(folder.name);
    if (name && !project.customName) project.name = name;
    if (!project.name) project.name = nameFromSlug(key.slice(5));
    return matches.length !== 1 || JSON.stringify(project) !== before;
  }

  // From a tab opening a project, or a single project the site fetched.
  fromHiggsfield(folder, { add = false } = {}) {
    if (this.applyFolder(folder, add)) this.changed();
  }

  // From a project list the site loaded: refreshes the projects already listed, adds none.
  fromHiggsfieldList(folders) {
    let changed = false;
    for (const folder of folders) changed = this.applyFolder(folder, false) || changed;
    if (changed) this.changed();
  }

  // A rename made on Higgsfield, from its live event stream.
  renamedOnHiggsfield(id, name) {
    const clean = cleanName(name);
    const project = this.items.find(p => p.id && p.id === String(id).toLowerCase());
    if (!project || project.customName || !clean || project.name === clean) return;
    project.name = clean;
    this.changed();
  }

  // The operations below return { ok: true } or { ok: false, error }.

  rename(key, name) {
    const project = this.get(key);
    if (!project) return { ok: false, error: 'That project is no longer in the list.' };
    const clean = cleanName(name);
    if (!clean) return { ok: false, error: 'Give the project a name.' };
    project.name = clean;
    project.customName = true;
    this.changed();
    return { ok: true };
  }

  // Pinned projects get their own toolbar button, in the order they were pinned.
  setPinned(key, pinned) {
    const project = this.get(key);
    if (!project) return { ok: false, error: 'That project is no longer in the list.' };
    if (!!project.pinned === !!pinned) return { ok: true };
    const last = Math.max(0, ...this.items.map(p => p.pinned || 0));
    project.pinned = pinned ? Math.max(Date.now(), last + 1) : 0;
    this.changed();
    return { ok: true };
  }

  // Swaps a pinned project with its neighbour on the toolbar; by -1 = left, 1 = right.
  movePinned(key, by) {
    const project = this.get(key);
    if (!project || !project.pinned) return { ok: false, error: 'That project is not pinned.' };
    const row = this.items.filter(p => p.pinned).sort((a, b) => a.pinned - b.pinned);
    const from = row.indexOf(project);
    const to = from + (by < 0 ? -1 : 1);
    if (to < 0 || to >= row.length) return { ok: true };
    const base = row[0].pinned;
    [row[from], row[to]] = [row[to], row[from]];
    row.forEach((p, i) => { p.pinned = base + i; });
    this.changed();
    return { ok: true };
  }

  // folder null = back to "<download folder>\<project name>".
  setFolder(key, folder) {
    const project = this.get(key);
    if (!project) return { ok: false, error: 'That project is no longer in the list.' };
    if (folder && !path.isAbsolute(folder)) return { ok: false, error: 'Choose a full folder path.' };
    project.downloadFolder = folder || null;
    this.changed();
    return { ok: true };
  }

  // Forgets it in the app only; nothing is deleted on Higgsfield or on disk.
  forget(key) {
    const project = this.get(key);
    if (!project) return { ok: false, error: 'That project is no longer in the list.' };
    this.items = this.items.filter(p => p !== project);
    this.changed();
    return { ok: true };
  }
}

module.exports = new Projects();
