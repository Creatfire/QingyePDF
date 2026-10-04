# Offline diagram libraries

`SOURCES.json` records each shipped file's version, official source URL and SHA-256. Full upstream licenses are in `LICENSES/`. Matching npm/GitHub source archives are included in the dependency source ZIP.

- flowchart.js 1.18.0, Raphaël 2.3.0, eve-raphael 0.5.0 and underscore 1.13.8: MIT.
- bramp/js-sequence-diagrams 2.0.1, commit `a6c252b2ed0d1e6b1d16be066f582afd2895e6c9`: BSD-2-Clause. The similarly named npm package is a security placeholder, so it is not used.

Rebuild with `scripts/build-diagrams-vendor.mjs` and its pinned build dependencies. This build step downloads the official sequence release; the application never downloads a diagram engine.

The sequence engine uses `raphaelSimple` with Windows/system fonts. It does not load WebFont or external fonts. The upstream Raphaël distribution also contains its unused hand-drawn font registration.

The application keeps its existing CSP (`script-src 'self' 'wasm-unsafe-eval'`). No `unsafe-eval` is added. Underscore includes an unused template compiler using `new Function`; js-sequence-diagrams does not call it. Underscore's global-object fallback also contains `Function`, but the browser's `self` branch resolves first. The rendering paths were exercised under Electron's enforced CSP.

Generated SVGs are passed through DOMPurify, have external images/links removed, retain their natural viewBox, and receive local, unique marker definitions for independent export. Renderer failures fall back to the existing Mermaid conversion.
