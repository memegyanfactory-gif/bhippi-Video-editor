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
  var readyResolve;
  var ready = new Promise(function (resolve) { readyResolve = resolve; });
  /** Acceptance checks (bhippi.test): run only when the Plugin Maker tests the plugin. */
  var checks = [];

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
      applyTheme(m.theme);
      readyResolve(info);
    } else if (m.type === 'event') {
      if (m.event === 'theme') applyTheme(m.data);
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
    /** Offers the user a message for the Bhippi AI chat; it is sent only when they click Send (needs the chat permission). */
    chat: function (message) { return call('chat', { message: String(message) }); },
    /** A project media file (or a file in the project folder) → URL an <img>/<video> in the plugin can show. */
    fileUrl: function (path) { return call('fileUrl', { path: path }); },
    /**
     * Listens for 'project' (the project changed), 'session' (another project was opened, a new one
     * started, or it was saved under a new file — projectStorage has already switched), 'selection',
     * 'playhead' (a few times a second while it moves), 'theme'. Returns a function that stops listening.
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
