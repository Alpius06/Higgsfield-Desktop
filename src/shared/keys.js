// Keyboard shortcut helpers shared by the main process (require) and
// renderer pages (<script src>, exposed as window.HFKeys).
//
// Canonical accelerator form: modifiers in the order Ctrl, Alt, Shift, Super,
// then one key, joined with "+", e.g. "Ctrl+Shift+T". Keys come from
// KeyboardEvent.code so shortcuts do not change with the keyboard layout.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HFKeys = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const IS_MAC = typeof process !== 'undefined' && process.platform
    ? process.platform === 'darwin'
    : typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

  // Also the order macOS lists modifiers in: Control, Option, Shift, Command.
  const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Super'];

  const MODIFIER_ALIASES = {
    ctrl: 'Ctrl', control: 'Ctrl', cmdorctrl: 'Ctrl', commandorcontrol: 'Ctrl',
    alt: 'Alt', option: 'Alt', altgr: 'Alt',
    shift: 'Shift',
    super: 'Super', meta: 'Super', cmd: 'Super', command: 'Super', win: 'Super',
  };

  const KEY_ALIASES = { escape: 'Esc', return: 'Enter', plus: '=', del: 'Delete', ins: 'Insert' };

  const CODE_TO_KEY = {
    ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
    Escape: 'Esc', Enter: 'Enter', NumpadEnter: 'Enter', Space: 'Space', Tab: 'Tab',
    Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
    NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult',
    NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
  };

  const KEY_LABELS = {
    Super: 'Win', Left: '←', Right: '→', Up: '↑', Down: '↓',
    numadd: 'Num +', numsub: 'Num −', nummult: 'Num *', numdiv: 'Num /', numdec: 'Num .',
  };
  if (IS_MAC) {
    Object.assign(KEY_LABELS, {
      Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Super: '⌘',
      Enter: '↩', Backspace: '⌫', Delete: '⌦', Esc: '⎋', Tab: '⇥', PageUp: '⇞', PageDown: '⇟', Home: '↖', End: '↘',
    });
  }

  // Modifiers that make a key a command rather than typing, as named in messages.
  const COMMAND_MODIFIERS = IS_MAC ? '⌘, ⌃ or ⌥' : 'Ctrl, Alt or Win';

  // Shortcuts that would break copy, paste and undo inside the site, and on macOS
  // the ones every app leaves to the system (Quit, Hide, Minimise, switch windows).
  const RESERVED = IS_MAC
    ? ['Super+A', 'Super+C', 'Super+V', 'Super+X', 'Super+Z', 'Shift+Super+Z', 'Alt+Shift+Super+V',
      'Super+Q', 'Super+H', 'Alt+Super+H', 'Super+M', 'Super+`', 'Super+Tab', 'Super+Space']
    : ['Ctrl+A', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Y', 'Ctrl+Z', 'Ctrl+Shift+Z', 'Ctrl+Shift+V'];

  // KeyboardEvent.code -> accelerator key, or null for modifier-only and unknown keys.
  function keyFromCode(code) {
    if (!code) return null;
    let m;
    if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
    if ((m = /^Digit(\d)$/.exec(code))) return m[1];
    if ((m = /^Numpad(\d)$/.exec(code))) return 'num' + m[1];
    if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
    return CODE_TO_KEY[code] || null;
  }

  function build(mods, key) {
    if (!key) return null;
    const parts = [];
    if (mods.ctrl) parts.push('Ctrl');
    if (mods.alt) parts.push('Alt');
    if (mods.shift) parts.push('Shift');
    if (mods.meta) parts.push('Super');
    parts.push(key);
    return parts.join('+');
  }

  // From Electron's before-input-event `input`.
  function fromInput(input) {
    return build({ ctrl: input.control, alt: input.alt, shift: input.shift, meta: input.meta },
      keyFromCode(input.code));
  }

  // From a DOM KeyboardEvent.
  function fromKeyboardEvent(e) {
    return build({ ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey },
      keyFromCode(e.code));
  }

  function normalizeKey(key) {
    if (!key) return null;
    const lower = key.toLowerCase();
    if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
    if (/^[a-z]$/.test(lower)) return lower.toUpperCase();
    if (/^f([1-9]|1\d|2[0-4])$/.test(lower)) return lower.toUpperCase();
    if (/^num(\d|add|sub|mult|div|dec)$/.test(lower)) return lower;
    const named = Object.values(CODE_TO_KEY).find(k => k.toLowerCase() === lower);
    return named || key;
  }

  // Any accelerator string -> canonical form, or '' when empty or unparseable.
  function normalize(accel) {
    if (!accel || typeof accel !== 'string') return '';
    // "Ctrl++" style: a trailing empty part means the key itself was "+".
    const parts = accel.split('+').map(s => s.trim());
    if (parts[parts.length - 1] === '' && parts.length > 1) { parts.pop(); parts[parts.length - 1] = '='; }
    const mods = new Set();
    let key = null;
    for (const part of parts) {
      const mod = MODIFIER_ALIASES[part.toLowerCase()];
      if (mod) mods.add(mod);
      else if (key === null) key = normalizeKey(part);
      else return '';
    }
    if (!key) return '';
    return [...MODIFIERS.filter(m => mods.has(m)), key].join('+');
  }

  // "Ctrl+Shift+Left" -> ["Ctrl", "Shift", "←"]
  function parts(accel) {
    const canonical = normalize(accel);
    return canonical ? canonical.split('+').map(p => KEY_LABELS[p] || p) : [];
  }

  // "Ctrl+Shift+Left" -> "Ctrl + Shift + ←", and on macOS "Shift+Super+Left" -> "⇧⌘←"
  function display(accel) {
    return parts(accel).join(IS_MAC ? '' : ' + ');
  }

  // Returns an error message, or null when the shortcut is usable.
  function validate(accel, opts) {
    const global = !!(opts && opts.global);
    const canonical = normalize(accel);
    if (!canonical) return 'Not a valid shortcut.';
    const parts = canonical.split('+');
    const key = parts[parts.length - 1];
    const mods = parts.slice(0, -1);
    const hasCommandModifier = mods.some(m => m === 'Ctrl' || m === 'Alt' || m === 'Super');
    const isFunctionKey = /^F\d+$/.test(key);
    if (RESERVED.includes(canonical)) {
      return IS_MAC ? 'Reserved for editing or by macOS.' : 'Reserved for copy, paste and undo.';
    }
    if (global && !hasCommandModifier) return `App-wide shortcuts need ${COMMAND_MODIFIERS}.`;
    if (!global && !hasCommandModifier && !isFunctionKey) {
      return `Add ${COMMAND_MODIFIERS} so the shortcut does not interfere with typing.`;
    }
    // On macOS Option with a character key types a special character (⌥T is †).
    if (IS_MAC && !global && key.length === 1 && !mods.some(m => m === 'Ctrl' || m === 'Super')) {
      return 'Add ⌘ or ⌃: with only ⌥ the key types a special character.';
    }
    return null;
  }

  return { IS_MAC, fromInput, fromKeyboardEvent, normalize, parts, display, validate };
});
