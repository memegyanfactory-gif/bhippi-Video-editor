// One running plugin: its page in a sandboxed frame, connected to the plugin bridge.
//
// `sandbox` without allow-same-origin gives the page an opaque origin — it cannot reach the
// editor's DOM, storage or IPC — and its own content security policy (rules.ts) limits its
// network to the hosts it was given. The only way out is postMessage to the bridge.

import { useEffect, useRef } from 'react';
import { connectPluginFrame } from './bridge';
import { usePlugins } from './store';

export function PluginFrame({ pluginId, hidden = false, className }: { pluginId: string; hidden?: boolean; className?: string }) {
  const { pages, plugins } = usePlugins();
  const plugin = plugins.find((item) => item.id === pluginId);
  const url = plugin?.enabled ? pages[pluginId] : undefined;
  const ref = useRef<HTMLIFrameElement>(null);

  // A new page URL (a save, a reload) is a new document: connect to it afresh.
  useEffect(() => {
    const frame = ref.current;
    const target = frame?.contentWindow;
    if (!frame || !target || !url) return;
    return connectPluginFrame(pluginId, target);
  }, [pluginId, url]);

  if (!plugin) return <div className="plugin-frame-empty">This plugin is no longer installed.</div>;
  if (!plugin.enabled) return <div className="plugin-frame-empty">“{plugin.name}” is turned off.</div>;
  if (!url) return <div className="plugin-frame-empty">Loading “{plugin.name}”…</div>;
  return (
    <iframe
      ref={ref}
      key={url}
      className={className ?? 'plugin-frame'}
      title={plugin.name}
      src={url}
      sandbox="allow-scripts allow-forms allow-modals allow-downloads"
      referrerPolicy="no-referrer"
      style={hidden ? { display: 'none' } : undefined}
    />
  );
}
