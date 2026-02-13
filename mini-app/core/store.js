let _state = null;
const _subs = new Set();

export function initStore(initialState) {
  _state = initialState || {};
  return _state;
}

export function getState() {
  return _state;
}

export function setState(patch, meta) {
  if (!_state) _state = {};
  if (patch && typeof patch === "object") {
    Object.assign(_state, patch);
  }
  for (const fn of _subs) {
    try {
      fn(_state, meta);
    } catch {
      // ignore
    }
  }
}

export function subscribe(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

