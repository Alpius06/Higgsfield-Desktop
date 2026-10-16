// Cinema Studio project details, read from Higgsfield's own API responses in each
// tab (Higgsfield calls projects folders). Opening a project fetches it by address
// (/fnf/generate/<user>/<slug>), which gives its id, real name and owner; the project
// lists Cinema Studio loads (/fnf/folders/accessible, /fnf/folders/pinned) and
// single-folder fetches keep the projects already in the app up to date.
const cdp = require('./cdp');
const projects = require('./projects');

const API = 'https://fnf-api-gw.higgsfield.ai/fnf/';
const OPENED = /^generate\/[^/?]+\/[^/?]+(\?|$)/;
const LIST = /^folders\/(accessible|pinned)(\?|$)/;
const ONE = /^folders\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\?|$)/i;

function classify(method, url) {
  if (method !== 'GET' || !url.startsWith(API)) return null;
  const rest = url.slice(API.length);
  if (OPENED.test(rest)) return 'opened';
  if (LIST.test(rest)) return 'list';
  if (ONE.test(rest)) return 'one';
  return null;
}

function apply(kind, body) {
  if (kind === 'list') {
    const items = Array.isArray(body) ? body : body && Array.isArray(body.items) ? body.items : [];
    projects.fromHiggsfieldList(items);
  } else {
    projects.fromHiggsfield(body, { add: kind === 'opened' });
  }
}

// Called for every tab's webContents, after notify.watch has enabled the Network domain.
function watch(contents) {
  let dbg;
  try {
    dbg = cdp.attach(contents);
  } catch {
    return; // notify.js already reported it
  }
  const requests = new Map(); // CDP requestId -> kind
  dbg.on('message', (_event, method, params) => {
    if (method === 'Network.requestWillBeSent') {
      const kind = classify(params.request.method, params.request.url);
      if (kind) requests.set(params.requestId, kind);
    } else if (method === 'Network.loadingFinished' && requests.has(params.requestId)) {
      const kind = requests.get(params.requestId);
      requests.delete(params.requestId);
      dbg.sendCommand('Network.getResponseBody', { requestId: params.requestId }).then(result => {
        const text = result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf8') : result.body;
        let body;
        try { body = JSON.parse(text); } catch { return; }
        apply(kind, body);
      }).catch(() => {});
    } else if (method === 'Network.loadingFailed') {
      requests.delete(params.requestId);
    }
  });
  contents.once('destroyed', () => requests.clear());
}

module.exports = { watch };
