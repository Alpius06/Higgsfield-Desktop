// A project's lettered badge: its initials and colour, shared by the toolbar and Settings
// (<script src>, exposed as window.HFBadge).
//
// Higgsfield gives a project a colour as a CSS colour name ("lime", "cyan"…). Named colours
// are drawn in the softer shades of clrs.cc, a nicer palette for the web's defaults; other
// CSS colours are used as they are. A project without one gets a colour from its id, so it
// keeps the same colour every time.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HFBadge = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SHADES = {
    navy: '#3d6fb6', blue: '#0074d9', aqua: '#7fdbff', cyan: '#7fdbff', teal: '#39cccc',
    olive: '#3d9970', green: '#2ecc40', lime: '#d1fe17', yellow: '#ffdc00', orange: '#ff851b',
    red: '#ff4136', maroon: '#c0306a', fuchsia: '#f012be', magenta: '#f012be', purple: '#b10dc9',
    pink: '#ff7eb6', brown: '#a9714b', gray: '#aaaaaa', grey: '#aaaaaa', silver: '#dddddd',
    white: '#ffffff', black: '#3b4249',
  };
  // For projects without a colour: the brighter ones, lime left to the app's own accent.
  const FALLBACK = ['blue', 'aqua', 'teal', 'green', 'yellow', 'orange', 'red', 'fuchsia', 'purple', 'pink'];

  let probe = null;
  // Any CSS colour as #rrggbb, or null if it is not one.
  function toHex(color) {
    if (typeof color !== 'string' || !color.trim() || typeof document === 'undefined') return null;
    if (!probe) probe = document.createElement('canvas').getContext('2d');
    probe.fillStyle = '#010203';
    probe.fillStyle = color.trim();
    const value = probe.fillStyle;
    if (value === '#010203' && color.trim().toLowerCase() !== '#010203') return null;
    return /^#[0-9a-f]{6}$/i.test(value) ? value : null;
  }

  function hash(text) {
    let h = 2166136261;
    for (const ch of String(text)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
    return h >>> 0;
  }

  function background(project) {
    const named = typeof project.color === 'string' && SHADES[project.color.trim().toLowerCase()];
    if (named) return named;
    const parsed = toHex(project.color);
    if (parsed) return parsed;
    return SHADES[FALLBACK[hash(project.id || project.key || project.name) % FALLBACK.length]];
  }

  // Dark text on light colours, light text on dark ones.
  function foreground(hex) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.25 ? '#0f1113' : '#ffffff';
  }

  // "Kikimora" → K, "New project 3" → N3.
  function initials(name) {
    const text = String(name || '').trim();
    const first = (text.match(/[\p{L}\p{N}]/u) || ['#'])[0].toUpperCase();
    const number = text.match(/\s(\d{1,2})$/);
    return number && first !== number[1] ? first + number[1] : first;
  }

  function badge(project) {
    const bg = background(project || {});
    return { text: initials(project && project.name), bg, fg: foreground(bg) };
  }

  return { badge };
});
