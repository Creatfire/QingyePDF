// Window style. Until 0.21 there were two interface styles ("Windows" and "MacOS", 0.9.2) with drawn
// traffic lights and translucent surfaces. Since 0.22 there is one interface on every platform and
// each platform keeps its native window buttons, so nothing is drawn here any more. The object keeps
// its shape because the window commands (window-maximized / window-focus) still call into it.

export function windowStyleInfo(api) {
  const info = api && typeof api.windowStyle === 'object' && api.windowStyle ? api.windowStyle : {};
  return { style: 'unified', vibrancy: false, relaunched: !!info.relaunched, acrylicSupported: false, drawnCaption: false, saved: { style: 'unified', vibrancy: false } };
}

export function applyWindowStyle(api) {
  const info = windowStyleInfo(api), body = document.body;
  return {
    info,
    maximized(value) { body.classList.toggle('windowMaximized', !!value); },
    focused(value) { body.classList.toggle('windowInactive', !value); },
  };
}
