// Small standard-library additions that PDF.js 6 and the shared UI rely on but that an Android
// System WebView which has not been updated for a while may lack. Loaded as a classic script in
// the app page, the PDF viewer frame and the PDF.js worker.
(function () {
  var def = function (target, name, value) { if (target && typeof target[name] !== 'function') Object.defineProperty(target, name, { value: value, writable: true, configurable: true }); };
  [typeof Map === 'function' && Map.prototype, typeof WeakMap === 'function' && WeakMap.prototype].forEach(function (proto) {
    def(proto, 'getOrInsert', function (key, value) { if (this.has(key)) return this.get(key); this.set(key, value); return value; });
    def(proto, 'getOrInsertComputed', function (key, compute) { if (this.has(key)) return this.get(key); var value = compute(key); this.set(key, value); return value; });
  });
  def(Promise, 'withResolvers', function () { var out = {}; out.promise = new this(function (resolve, reject) { out.resolve = resolve; out.reject = reject; }); return out; });
  def(Promise, 'try', function (fn) { var args = Array.prototype.slice.call(arguments, 1); return new this(function (resolve) { resolve(fn.apply(undefined, args)); }); });
  if (typeof URL === 'function') {
    def(URL, 'canParse', function (url, base) { try { new URL(url, base); return true; } catch (e) { return false; } });
    def(URL, 'parse', function (url, base) { try { return new URL(url, base); } catch (e) { return null; } });
  }
  def(RegExp, 'escape', function (text) { return String(text).replace(/[\\^$.*+?()[\]{}|\/]/g, '\\$&').replace(/^[0-9a-zA-Z]/, function (c) { return '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0'); }).replace(/[,\-=<>#&!%:;@~'`"\s]/g, function (c) { var code = c.charCodeAt(0); return code < 256 ? '\\x' + code.toString(16).padStart(2, '0') : '\\u' + code.toString(16).padStart(4, '0'); }); });
  def(Array, 'fromAsync', async function (items, map, self) { var out = [], i = 0; if (items && typeof items[Symbol.asyncIterator] === 'function') { for await (var a of items) out.push(map ? await map.call(self, a, i++) : a); } else { for (var b of items) { var v = await b; out.push(map ? await map.call(self, v, i++) : v); } } return out; });
  def(Object, 'groupBy', function (items, key) { var out = Object.create(null), i = 0; for (var item of items) { var k = key(item, i++); (out[k] || (out[k] = [])).push(item); } return out; });
  def(Map, 'groupBy', function (items, key) { var out = new Map(), i = 0; for (var item of items) { var k = key(item, i++); if (out.has(k)) out.get(k).push(item); else out.set(k, [item]); } return out; });
  def(Math, 'sumPrecise', function (items) { var sum = 0, c = 0; for (var x of items) { var y = Number(x) - c, t = sum + y; c = (t - sum) - y; sum = t; } return sum; });
  def(Array.prototype, 'at', function (i) { i = Math.trunc(i) || 0; if (i < 0) i += this.length; return this[i]; });
  def(Array.prototype, 'findLast', function (fn, self) { for (var i = this.length - 1; i >= 0; i--) if (fn.call(self, this[i], i, this)) return this[i]; });
  def(Array.prototype, 'findLastIndex', function (fn, self) { for (var i = this.length - 1; i >= 0; i--) if (fn.call(self, this[i], i, this)) return i; return -1; });
  def(Array.prototype, 'toSorted', function (fn) { return this.slice().sort(fn); });
  def(Array.prototype, 'toReversed', function () { return this.slice().reverse(); });
  def(Array.prototype, 'toSpliced', function () { var copy = this.slice(); copy.splice.apply(copy, arguments); return copy; });
  def(Array.prototype, 'with', function (i, value) { var copy = this.slice(); copy[i < 0 ? copy.length + i : i] = value; return copy; });
  if (typeof Set === 'function') {
    var P = Set.prototype, keys = function (other) { return typeof other.keys === 'function' ? Array.from(other.keys()) : Array.from(other); };
    def(P, 'union', function (o) { var out = new Set(this); keys(o).forEach(function (v) { out.add(v); }); return out; });
    def(P, 'intersection', function (o) { var out = new Set(), self = this; keys(o).forEach(function (v) { if (self.has(v)) out.add(v); }); return out; });
    def(P, 'difference', function (o) { var out = new Set(this); keys(o).forEach(function (v) { out.delete(v); }); return out; });
    def(P, 'symmetricDifference', function (o) { var out = new Set(this); keys(o).forEach(function (v) { if (out.has(v)) out.delete(v); else out.add(v); }); return out; });
    def(P, 'isSubsetOf', function (o) { for (var v of this) if (!o.has(v)) return false; return true; });
    def(P, 'isSupersetOf', function (o) { var self = this; return keys(o).every(function (v) { return self.has(v); }); });
    def(P, 'isDisjointFrom', function (o) { for (var v of this) if (o.has(v)) return false; return true; });
  }
  if (typeof Uint8Array === 'function') {
    def(Uint8Array.prototype, 'toHex', function () { var out = ''; for (var i = 0; i < this.length; i++) out += this[i].toString(16).padStart(2, '0'); return out; });
    def(Uint8Array, 'fromHex', function (text) { var out = new Uint8Array(text.length >> 1); for (var i = 0; i < out.length; i++) out[i] = parseInt(text.substr(i * 2, 2), 16); return out; });
    def(Uint8Array.prototype, 'toBase64', function (options) { var s = ''; for (var i = 0; i < this.length; i += 0x8000) s += String.fromCharCode.apply(null, this.subarray(i, i + 0x8000)); s = btoa(s); if (options && options.alphabet === 'base64url') s = s.replace(/\+/g, '-').replace(/\//g, '_'); if (options && options.omitPadding) s = s.replace(/=+$/, ''); return s; });
    def(Uint8Array, 'fromBase64', function (text, options) { var s = String(text).replace(/\s+/g, ''); if (options && options.alphabet === 'base64url') s = s.replace(/-/g, '+').replace(/_/g, '/'); var bin = atob(s), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; });
  }
  if (typeof AbortSignal === 'function') {
    def(AbortSignal, 'timeout', function (ms) { var c = new AbortController(); setTimeout(function () { c.abort(new DOMException('The operation timed out.', 'TimeoutError')); }, ms); return c.signal; });
    def(AbortSignal, 'any', function (signals) { var c = new AbortController(); signals.forEach(function (s) { if (s.aborted) c.abort(s.reason); else s.addEventListener('abort', function () { c.abort(s.reason); }, { once: true }); }); return c.signal; });
  }
  if (typeof structuredClone !== 'function') globalThis.structuredClone = function (value) { return JSON.parse(JSON.stringify(value)); };
})();
