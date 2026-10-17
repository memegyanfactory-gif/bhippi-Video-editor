import { useEffect, useRef, useState } from 'react';
import type { BrainGraph, BrainNodeKind } from '../lib/ipc';
import { BrainMap2D } from './BrainMap2D';
import { BrainScene, type SceneProps } from './brain3d/BrainScene';
import { KIND_COLORS, KIND_LABELS, KIND_LOBES } from './brain3d/kinds';
import '../styles/brain3d.css';

export { KIND_COLORS, KIND_LABELS, KIND_LOBES };

type Props = {
  graph: BrainGraph;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Only these kinds are drawn at full strength; the rest fade. */
  visible: Set<BrainNodeKind>;
  search: string;
  /** A dream (consolidation) is running: slow waves sweep the brain. */
  dreaming?: boolean;
};

const webglAvailable = () => {
  try {
    const probe = document.createElement('canvas');
    return !!probe.getContext('webgl2');
  } catch {
    return false;
  }
};

/**
 * The live brain: everything Bhippi has learned as a real-time 3D brain, each kind of knowledge in its own lobe.
 * Drag to orbit, wheel or pinch to zoom, right-drag to pan, click a neuron to inspect it, double-click to reset.
 * Without WebGL it falls back to the flat map.
 */
export function BrainMap({ graph, selected, onSelect, visible, search, dreaming = false }: Props) {
  const [flat, setFlat] = useState(() => !webglAvailable());
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<BrainScene | null>(null);
  const latest = useRef<SceneProps & { onSelect: (id: string | null) => void }>({ graph, selected, visible, search, dreaming, onSelect });
  latest.current = { graph, selected, visible, search, dreaming, onSelect };

  useEffect(() => {
    const host = hostRef.current;
    const labels = labelsRef.current;
    if (flat || !host || !labels) return undefined;
    // A fresh canvas per mount: a disposed scene gives its GL context back, so a remount (StrictMode, tab switch) never inherits a lost one.
    const canvas = document.createElement('canvas');
    canvas.className = 'brain-map-canvas';
    canvas.setAttribute('aria-label', 'Brain map: what Bhippi has learned, laid out by lobe');
    host.appendChild(canvas);
    let scene: BrainScene;
    try {
      scene = new BrainScene(canvas, labels, (id) => latest.current.onSelect(id), latest.current);
    } catch {
      canvas.remove();
      setFlat(true);
      return undefined;
    }
    sceneRef.current = scene;
    const lost = () => setFlat(true);
    canvas.addEventListener('webglcontextlost', lost);
    return () => {
      canvas.removeEventListener('webglcontextlost', lost);
      scene.dispose();
      sceneRef.current = null;
      canvas.remove();
    };
  }, [flat]);

  useEffect(() => {
    sceneRef.current?.setProps({ graph, selected, visible, search, dreaming });
  }, [graph, selected, visible, search, dreaming]);

  if (flat) return <BrainMap2D graph={graph} selected={selected} onSelect={onSelect} visible={visible} search={search} dreaming={dreaming} />;
  return (
    <>
      <div ref={hostRef} className="brain-map-host" />
      <div ref={labelsRef} className="brain-labels" aria-hidden="true" />
    </>
  );
}
