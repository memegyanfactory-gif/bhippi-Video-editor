// The Music Studio entry point: owns one MusicEngine per mount and hands it to the studio shell.
// The engine is created after mount and released on unmount, so a StrictMode double mount never
// reuses a closed AudioContext.
import { useEffect, useRef, useState } from 'react';
import { fileSrc } from '../../lib/ipc';
import { MusicEngine, assetSampleLoader } from '../engine';
import type { MusicEngineApi } from '../engine/api';
import type { StudioProps } from './ctx';
import { StudioShell } from './StudioShell';

export type { StudioProps };

export function MusicStudio(props: StudioProps) {
  const [engine, setEngine] = useState<MusicEngineApi | null>(null);
  const assetsRef = useRef(props.assets);
  assetsRef.current = props.assets;
  useEffect(() => {
    const e = new MusicEngine({ loadSample: assetSampleLoader((id) => assetsRef.current.get(id)?.path ?? null, fileSrc) });
    setEngine(e);
    return () => { e.stop(); e.dispose(); setEngine(null); };
  }, []);
  if (!engine) return <div className="ms-root" aria-busy="true" />;
  return <StudioShell engine={engine} props={props} />;
}
