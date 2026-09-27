// The `bhippi` object every plugin page gets, as source text: composePage puts it in the page
// ahead of the plugin's own scripts. It speaks postMessage to the plugin bridge in the editor
// (src/plugins/bridge.ts) — the only way out of the sandbox — and forwards the plugin's console
// and errors there, so the Plugin Maker (and the AI building the plugin) can see them.
//
// Kept as plain ES2019 in a string: it runs inside the plugin's document, not in the app bundle.

export const SDK_SOURCE = String.raw`
(function () {
  'use strict';
  if (window.bhippi) return;
  var TAG = 'bhippi-plugin';
  var seq = 0;
  var pending = {};
  var listeners = {};
  var actions = {};
  var storage = {};
  var projectStore = {};
  var session = null;
  var info = null;
  /** True inside the Plugin Maker's test run (plugin_test). */
  var testing = false;
  /** Cancel handlers of this page's running jobs, by job id. */
  var jobCancels = {};
  /** Handlers of this page's menu entries, by entry id. */
  var menuHandlers = {};
  var readyResolve;
  var ready = new Promise(function (resolve) { readyResolve = resolve; });
  /** Acceptance checks (bhippi.test): run only when the Plugin Maker tests the plugin. */
  var checks = [];
  /** Decoded assets by name: { bytes, mime, url }. */
  var assetCache = {};
  var domReady = new Promise(function (resolve) {
    if (document.readyState !== 'loading') resolve();
    else document.addEventListener('DOMContentLoaded', function () { resolve(); });
  });

  /** The page's assets: blocks plugin_save wrote at the end of the page (src/plugins/assets.ts). */
  function assetNodes() {
    return Array.prototype.slice.call(document.querySelectorAll('script[data-bhippi-asset]'));
  }
  function assetEntry(name) {
    return domReady.then(function () {
      name = String(name);
      if (assetCache[name]) return assetCache[name];
      var node = assetNodes().filter(function (item) { return item.getAttribute('data-bhippi-asset') === name; })[0];
      if (!node) throw new Error('This plugin has no asset "' + name + '" (bhippi.assets() lists them)');
      var binary = atob((node.textContent || '').replace(/\s+/g, ''));
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      assetCache[name] = { bytes: bytes, mime: node.getAttribute('data-mime') || 'application/octet-stream', url: null };
      return assetCache[name];
    });
  }
  function assetUrl(name) {
    return assetEntry(name).then(function (entry) {
      if (!entry.url) entry.url = URL.createObjectURL(new Blob([entry.bytes], { type: entry.mime }));
      return entry.url;
    });
  }
  // <img data-bhippi-src="logo.png">, <video>, <audio>, <source>: pointed at their asset once the page has loaded.
  domReady.then(function () {
    Array.prototype.forEach.call(document.querySelectorAll('[data-bhippi-src]'), function (element) {
      assetUrl(element.getAttribute('data-bhippi-src')).then(function (url) { element.setAttribute('src', url); }, function (error) { console.error(error.message); });
    });
  });

  var MEDIA_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' };
  /** Blob, ArrayBuffer, typed array, canvas or data: URL → { bytes: ArrayBuffer, type }. */
  function mediaBytes(data) {
    if (data instanceof ArrayBuffer) return Promise.resolve({ bytes: data, type: '' });
    if (ArrayBuffer.isView(data)) return Promise.resolve({ bytes: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), type: '' });
    if (typeof Blob !== 'undefined' && data instanceof Blob) return data.arrayBuffer().then(function (bytes) { return { bytes: bytes, type: data.type }; });
    if (data && typeof data.toBlob === 'function') {
      return new Promise(function (resolve, reject) {
        data.toBlob(function (blob) { blob ? resolve(mediaBytes(blob)) : reject(new Error('The canvas could not be read (is it tainted?)')); }, 'image/png');
      });
    }
    if (typeof data === 'string' && /^data:/.test(data)) return fetch(data).then(function (response) { return response.blob(); }).then(mediaBytes);
    return Promise.reject(new Error('importMedia takes a Blob, ArrayBuffer, typed array, canvas or data: URL'));
  }

  function withTimeout(promise, ms, what) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error(what + ' took longer than ' + ms / 1000 + ' s')); }, ms);
      promise.then(function (value) { clearTimeout(timer); resolve(value); }, function (error) { clearTimeout(timer); reject(error); });
    });
  }

  /** Runs every acceptance check in order, each on its own clock. */
  function runChecks() {
    var results = [];
    return checks.reduce(function (chain, check) {
      return chain.then(function () {
        var started = Date.now();
        return withTimeout(Promise.resolve().then(check.fn), 8000, check.name)
          .then(function () { results.push({ name: check.name, ok: true, ms: Date.now() - started }); })
          .catch(function (error) { results.push({ name: check.name, ok: false, error: text(error).slice(0, 600), ms: Date.now() - started }); });
      });
    }, ready).then(function () { return results; });
  }

  /**
   * A picture of the page as it is now, drawn inside the sandbox: a copy of the document with
   * every element's computed style frozen onto it, rendered through an SVG foreignObject.
   */
  function snapshot() {
    var root = document.documentElement;
    var width = Math.max(1, root.clientWidth);
    var height = Math.max(1, Math.min(2400, Math.max(root.scrollHeight, document.body ? document.body.scrollHeight : 0)));
    var clone = root.cloneNode(true);
    var live = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*'), 0, 4000));
    var copy = [clone].concat(Array.prototype.slice.call(clone.querySelectorAll('*'), 0, 4000));
    for (var i = 0; i < live.length && i < copy.length; i++) {
      var style = getComputedStyle(live[i]);
      var frozen = '';
      for (var j = 0; j < style.length; j++) frozen += style[j] + ':' + style.getPropertyValue(style[j]) + ';';
      copy[i].setAttribute('style', frozen);
      if (live[i].tagName === 'CANVAS') {
        try {
          var picture = document.createElement('img');
          picture.setAttribute('src', live[i].toDataURL());
          picture.setAttribute('style', frozen);
          copy[i].parentNode.replaceChild(picture, copy[i]);
        } catch (e) { /* a tainted canvas stays blank */ }
      } else if (live[i].tagName === 'INPUT' || live[i].tagName === 'TEXTAREA') {
        copy[i].setAttribute('value', live[i].value);
        if (live[i].tagName === 'TEXTAREA') copy[i].textContent = live[i].value;
      }
    }
    Array.prototype.forEach.call(clone.querySelectorAll('script'), function (node) { node.remove(); });
    clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    var markup = new XMLSerializer().serializeToString(clone);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"><foreignObject x="0" y="0" width="100%" height="100%">' + markup + '</foreignObject></svg>';
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          var context = canvas.getContext('2d');
          context.fillStyle = getComputedStyle(document.body || root).backgroundColor || '#232323';
          context.fillRect(0, 0, width, height);
          context.drawImage(image, 0, 0);
          resolve({ image: canvas.toDataURL('image/jpeg', 0.85), width: width, height: height });
        } catch (error) { reject(error); }
      };
      image.onerror = function () { reject(new Error('the page could not be drawn')); };
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  function post(message) {
    message.tag = TAG;
    try { parent.postMessage(message, '*'); } catch (e) { /* the editor is gone */ }
  }
  function call(method, params) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      pending[id] = { resolve: resolve, reject: reject };
      post({ type: 'call', id: id, method: method, params: params || {} });
    });
  }
  function text(value) {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack || value.message;
    try { return JSON.stringify(value); } catch (e) { return String(value); }
  }
  function applyTheme(tokens) {
    if (!tokens) return;
    var root = document.documentElement;
    Object.keys(tokens).forEach(function (name) { root.style.setProperty('--' + name, tokens[name]); });
  }
  function emit(event, data) {
    (listeners[event] || []).slice().forEach(function (fn) {
      try { fn(data); } catch (error) { console.error('bhippi.on("' + event + '") handler failed:', error); }
    });
  }

  ['log', 'info', 'warn', 'error'].forEach(function (level) {
    var original = console[level] ? console[level].bind(console) : function () {};
    console[level] = function () {
      var parts = Array.prototype.slice.call(arguments).map(text);
      post({ type: 'log', level: level, text: parts.join(' ').slice(0, 4000) });
      original.apply(null, arguments);
    };
  });
  window.addEventListener('error', function (event) {
    post({ type: 'log', level: 'error', text: (event.message || 'Error') + (event.lineno ? ' (line ' + event.lineno + ')' : '') });
  });
  window.addEventListener('unhandledrejection', function (event) {
    post({ type: 'log', level: 'error', text: 'Unhandled rejection: ' + text(event.reason) });
  });

  window.addEventListener('message', function (event) {
    if (event.source !== parent) return;
    var m = event.data;
    if (!m || m.tag !== TAG) return;
    if (m.type === 'reply') {
      var waiting = pending[m.id];
      if (!waiting) return;
      delete pending[m.id];
      if (m.ok) waiting.resolve(m.result); else waiting.reject(new Error(m.error || 'Bhippi refused the call'));
    } else if (m.type === 'init') {
      info = m.plugin;
      storage = m.storage || {};
      session = m.session || null;
      projectStore = m.projectStorage || {};
      testing = !!m.testing;
      applyTheme(m.theme);
      readyResolve(info);
    } else if (m.type === 'event') {
      if (m.event === 'theme') applyTheme(m.data);
      if (m.event === 'menu') {
        var entry = menuHandlers[m.data && m.data.id];
        if (entry) {
          Promise.resolve().then(function () { return entry(m.data); }).catch(function (error) { console.error('menu entry "' + m.data.id + '" failed:', error); });
        }
        return;
      }
      if (m.event === 'jobCancel') {
        var id = m.data && m.data.id;
        (jobCancels[id] || []).slice().forEach(function (fn) {
          try { fn(); } catch (error) { console.error('job.onCancel handler failed:', error); }
        });
        delete jobCancels[id];
        return;
      }
      if (m.event === 'session') {
        var data = m.data || {};
        projectStore = data.projectStorage || {};
        session = { key: data.key == null ? null : data.key, name: data.name || '', saved: !!data.saved };
        emit('session', session);
        return;
      }
      emit(m.event, m.data);
    } else if (m.type === 'runChecks' || m.type === 'snapshot') {
      // Only the Plugin Maker's test run asks for these (src/plugins/testRunner.ts).
      var work = m.type === 'runChecks' ? runChecks().then(function (results) { return { results: results }; }) : snapshot();
      work
        .then(function (result) { result.type = m.type + 'Result'; result.id = m.id; result.ok = true; post(result); })
        .catch(function (error) { post({ type: m.type + 'Result', id: m.id, ok: false, error: text(error) }); });
    } else if (m.type === 'action') {
      var handler = actions[m.name];
      Promise.resolve()
        .then(function () {
          if (!handler) throw new Error('This plugin has no action "' + m.name + '"');
          return handler.run(m.args || {});
        })
        .then(function (result) { post({ type: 'actionResult', id: m.id, ok: true, result: result === undefined ? null : result }); })
        .catch(function (error) { post({ type: 'actionResult', id: m.id, ok: false, error: text(error) }); });
    }
  });

  var bhippi = {
    /** Resolves with { id, name } once the editor has connected. */
    ready: ready,
    get plugin() { return info; },
    /**
     * The open project: { key, name, saved }. key is stable for one project file (null until the
     * project is first saved) — use it to tell projects apart. bhippi.on('session') fires when it changes.
     */
    get session() { return session; },
    /** The project overview Bhippi AI sees: comps, media, selection, playhead. */
    project: function () { return call('project'); },
    /** One comp in full: tracks, clips, transitions, markers. Omit id for the active comp. */
    comp: function (id) { return call('comp', { id: id }); },
    /** Runs a Bhippi tool, exactly as Bhippi AI would call it. Resolves with its result; rejects when refused or failed. */
    tool: function (name, args) { return call('tool', { name: name, args: args || {} }); },
    /** Every Bhippi tool with its description and input schema. */
    tools: function () { return call('tools'); },
    selection: {
      get: function () { return call('selection.get'); },
      set: function (ids) { return call('selection.set', { ids: ids }); }
    },
    playhead: {
      get: function () { return call('playhead.get'); },
      seek: function (seconds) { return call('playhead.seek', { time: seconds }); }
    },
    /** This plugin's own saved data. get/keys are instant; set and remove save to disk. */
    storage: {
      get: function (key, fallback) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : fallback; },
      keys: function () { return Object.keys(storage); },
      set: function (key, value) { storage[key] = value; return call('storage.set', { data: storage }); },
      remove: function (key) { delete storage[key]; return call('storage.set', { data: storage }); }
    },
    /**
     * Like storage, but kept per project: each project the user opens has its own. It switches by
     * itself when another project opens (listen with bhippi.on('session') to redraw). An unsaved
     * project's data is kept in memory and saved with the project the first time it is saved.
     */
    projectStorage: {
      get: function (key, fallback) { return Object.prototype.hasOwnProperty.call(projectStore, key) ? projectStore[key] : fallback; },
      keys: function () { return Object.keys(projectStore); },
      set: function (key, value) { projectStore[key] = value; return call('projectStorage.set', { data: projectStore }); },
      remove: function (key) { delete projectStore[key]; return call('projectStorage.set', { data: projectStore }); }
    },
    /** A notification in the editor. tone: 'info' | 'success' | 'error'. */
    toast: function (message, tone) { return call('toast', { message: String(message), tone: tone || 'info' }); },
    /**
     * The plugin's own assets (pictures, models, fonts, sounds, clips, wasm, data files in its draft).
     * asset(name) → a blob URL for <img>/<video>/CSS/loaders; assetBytes → an ArrayBuffer (glTF,
     * WebAssembly); assetText → the text of a json/svg/txt/gltf file; assets() → every name.
     */
    asset: assetUrl,
    assetBytes: function (name) { return assetEntry(name).then(function (entry) { return entry.bytes.slice().buffer; }); },
    assetText: function (name) { return assetEntry(name).then(function (entry) { return new TextDecoder().decode(entry.bytes); }); },
    assets: function () { return domReady.then(function () { return assetNodes().map(function (node) { return node.getAttribute('data-bhippi-asset'); }); }); },
    /**
     * Hands a still, clip or sound the plugin made to the project: saved under Generated/Plugins and
     * imported with import_media (which must be in the plugin's permissions). data is a Blob,
     * ArrayBuffer, typed array, canvas or data: URL; options.name its file name (png, jpg, webp,
     * gif, mp4, webm, mov, wav, mp3, ogg, m4a, flac). Resolves with import_media's result.
     */
    importMedia: function (data, options) {
      var wanted = String((options && options.name) || 'Plugin media').replace(/[^A-Za-z0-9 _.-]+/g, ' ').trim().slice(0, 80) || 'Plugin media';
      return mediaBytes(data).then(function (media) {
        var name = /\.[A-Za-z0-9]{2,5}$/.test(wanted) ? wanted : wanted + '.' + (MEDIA_TYPES[media.type] || 'png');
        return call('importMedia', { name: name, bytes: media.bytes });
      });
    },
    /** Offers the user a message for the Bhippi AI chat; it is sent only when they click Send (needs the chat permission). */
    chat: function (message) { return call('chat', { message: String(message) }); },
    /** A project media file (or a file in the project folder) → URL an <img>/<video> in the plugin can show. */
    fileUrl: function (path) { return call('fileUrl', { path: path }); },
    /** True inside the Plugin Maker's test run: AI questions and new transcriptions do not run there. */
    get testing() { return testing; },
    /**
     * What is said, in timeline time. comp(compId?, { transcribe }) → the whole edit's words and
     * lines; get(clipId | { clipId } | { assetId }, { transcribe }) → one clip's or file's words.
     * { transcribe: true } makes missing transcripts first (the transcribe service).
     */
    transcript: {
      get: function (target, options) {
        var which = typeof target === 'string' ? { clipId: target } : (target || {});
        return call('transcript.get', { clipId: which.clipId, assetId: which.assetId, transcribe: !!(options && options.transcribe) });
      },
      comp: function (compId, options) {
        if (compId && typeof compId === 'object') { options = compId; compId = undefined; }
        return call('transcript.comp', { compId: compId, transcribe: !!(options && options.transcribe) });
      }
    },
    /** The user's AI model, one question at a time (the ai service). options: { system, json, maxTokens }. */
    ai: {
      ask: function (prompt, options) {
        options = options || {};
        return call('ai.ask', { prompt: String(prompt), system: options.system ? String(options.system) : '', json: options.json || false, maxTokens: options.maxTokens });
      }
    },
    /** The Program monitor's transport. bhippi.on('playback', fn) hears { playing, rate, time }. */
    playback: {
      state: function () { return call('playback.state'); },
      play: function (options) { return call('playback.play', options || {}); },
      pause: function () { return call('playback.pause'); },
      toggle: function () { return call('playback.toggle'); }
    },
    /** A media file's sound as numbers: peaks(assetId, { from, to }) and loudness(assetId, { from, to }). */
    audio: {
      peaks: function (assetId, range) { range = range || {}; return call('audio.peaks', { assetId: assetId, from: range.from, to: range.to }); },
      loudness: function (assetId, range) { range = range || {}; return call('audio.loudness', { assetId: assetId, from: range.from, to: range.to }); }
    },
    /**
     * Pictures: frame({ time, compId, size }) is the edit as exported at that time; frame({ assetId,
     * time, size }) is one file's own picture. Resolves with { image: a PNG data: URL, time, compId }.
     */
    video: {
      frame: function (options) { return call('video.frame', options || {}); }
    },
    /** A project media file's bytes: read(assetId) → { name, kind, bytes: ArrayBuffer }. */
    media: {
      read: function (assetId) { return call('media.read', { assetId: assetId }); }
    },
    /**
     * An entry in Bhippi's right-click menus while this plugin runs (under Plugins).
     * add({ id, label, where: 'clip' | 'timeline' | 'media' or a list }, fn): fn gets { id, where,
     * clipIds, compId, time, trackId, ids } — what was right-clicked. remove(id) takes it away.
     */
    menu: {
      add: function (entry, fn) {
        entry = entry || {};
        if (typeof fn === 'function') menuHandlers[entry.id] = fn;
        return call('menu.add', { id: entry.id, label: entry.label, where: entry.where });
      },
      remove: function (id) { delete menuHandlers[id]; return call('menu.remove', { id: id }); }
    },
    /** Runs [{ tool, args }, …] as one undo step. */
    batch: function (steps, options) { return call('batch', { steps: steps, label: options && options.label }); },
    /** Long work with a progress bar in Bhippi's job list. */
    jobs: {
      start: function (label, options) {
        return call('jobs.start', { label: String(label), cancellable: !!(options && options.cancellable) }).then(function (id) {
          var cancels = [];
          jobCancels[id] = cancels;
          function update(patch) { return call('jobs.update', Object.assign({ id: id }, patch)); }
          return {
            id: id,
            progress: function (value, message) { return update({ progress: Number(value), message: message == null ? undefined : String(message) }); },
            done: function (message) { delete jobCancels[id]; return update({ status: 'done', message: message == null ? undefined : String(message) }); },
            fail: function (error) { delete jobCancels[id]; return update({ status: 'error', message: text(error) }); },
            onCancel: function (fn) { if (typeof fn === 'function') cancels.push(fn); }
          };
        });
      }
    },
    /**
     * Listens for 'project' (the project changed), 'playback' ({ playing, rate, time } when playback
     * starts, stops or changes speed), 'session' (another project was opened, a new one
     * started, or it was saved under a new file — projectStorage has already switched), 'selection',
     * 'playhead' (a few times a second while it moves), 'theme', 'export' ({ status: 'started' | 'done'
     * | 'error' | 'cancelled', file: the output's file name or null }). Returns a function that stops listening.
     */
    on: function (event, fn) {
      (listeners[event] = listeners[event] || []).push(fn);
      call('subscribe', { event: event }).catch(function () {});
      return function () { listeners[event] = (listeners[event] || []).filter(function (f) { return f !== fn; }); };
    },
    /**
     * Offers Bhippi AI an action it can call (call_plugin_action) while this plugin is running.
     * spec: { description, params } — params is a JSON schema of the args. run(args) may be async.
     */
    expose: function (name, spec, run) {
      if (typeof spec === 'function') { run = spec; spec = {}; }
      actions[name] = { run: run };
      return call('expose', { name: name, description: (spec && spec.description) || '', params: (spec && spec.params) || null });
    },
    /**
     * An acceptance check: fn throws (or rejects) when the plugin does not do what its spec says.
     * Checks never run for the user — only when the Plugin Maker tests the plugin, against a scratch
     * copy of the project, so a check may make real edits.
     */
    test: function (name, fn) {
      if (typeof fn === 'function') checks.push({ name: String(name), fn: fn });
    }
  };
  window.bhippi = bhippi;
  post({ type: 'hello' });
})();
`;
