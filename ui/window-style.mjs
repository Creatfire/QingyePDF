// Interface style (0.9.2): "windows" (native caption buttons on the right, the 0.8 look) or
// "macos" (traffic lights at the top-left, larger radii, translucent "glass" surfaces; see macos.css).
// The main process decides the window frame at creation, so the style in effect for this window
// comes from api.windowStyle (read synchronously by preload.cjs); a new choice applies after a restart.

export function windowStyleInfo(api) {
  const info = api && typeof api.windowStyle === 'object' && api.windowStyle ? api.windowStyle : {};
  const style = info.style === 'macos' ? 'macos' : 'windows';
  const saved = info.saved && typeof info.saved === 'object' ? info.saved : { style, vibrancy: !!info.vibrancy };
  return {
    style, vibrancy: !!info.vibrancy, relaunched: !!info.relaunched, acrylicSupported: !!info.acrylicSupported,
    drawnCaption: info.drawnCaption ?? (style === 'macos' && api?.platform !== 'darwin'),
    saved: { style: saved.style === 'macos' ? 'macos' : 'windows', vibrancy: !!saved.vibrancy },
  };
}

export function applyWindowStyle(api) {
  const info = windowStyleInfo(api), body = document.body;
  body.classList.add('style-' + info.style);
  body.classList.toggle('vibrancy', info.vibrancy);
  if (!info.drawnCaption) return { info, maximized() {}, focused() {} };

  // Traffic lights: close, minimize, zoom (maximize / restore). Glyphs appear while the group is hovered.
  const group = document.createElement('div');
  group.className = 'trafficLights'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', '窗口控制');
  const make = (action, label) => {
    const b = document.createElement('button');
    b.className = 'trafficLight ' + action; b.type = 'button'; b.title = label; b.setAttribute('aria-label', label);
    b.onclick = event => { event.stopPropagation(); api.windowControl?.(action).catch(() => {}); };
    b.addEventListener('dblclick', event => event.stopPropagation());
    return b;
  };
  const zoom = make('maximize', '最大化');
  group.append(make('close', '关闭'), make('minimize', '最小化'), zoom);
  document.getElementById('titlebar')?.prepend(group);

  let stateEvents = 0;
  function maximized(value) {
    stateEvents++;
    body.classList.toggle('windowMaximized', !!value);
    const label = value ? '还原' : '最大化';
    zoom.title = label; zoom.setAttribute('aria-label', label);
  }
  // Inactive windows show grey lights, as on macOS. Focus inside a PDF iframe still counts as focused.
  function focused(value) { stateEvents++; body.classList.toggle('windowInactive', !value); }
  // BrowserWindow focus includes PDF iframes; DOM blur while moving into an iframe does not mean
  // the native window became inactive. A late initial IPC reply must not override a newer event.
  const initialEvents = stateEvents;
  api.windowState?.().then(state => { if (stateEvents !== initialEvents) return; maximized(state?.maximized); if (state && 'focused' in state) focused(state.focused); }).catch(() => {});
  return { info, maximized, focused };
}
