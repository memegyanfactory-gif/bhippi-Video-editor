// Types the Model Library's pages share, so the shell in ModelLibrary.tsx stays small.
import type { HardwareInfo } from '../../lib/ipc';
import type { Settings } from '../../lib/types';
import type { CapabilityChoice, ComfyStatus, LibraryKind, LibraryStorage, LibraryView, LlmRuntimeStatus } from '../../lib/modelLibrary';

export type Run = (work: () => Promise<unknown>, failure: string) => Promise<boolean>;

export type LibraryPage = 'inuse' | 'downloaded' | 'engines' | LibraryKind;

export type LibraryContext = {
  views: LibraryView[];
  hw: HardwareInfo | null;
  storage: LibraryStorage | null;
  comfy: ComfyStatus | null;
  comfyError: string;
  llm: LlmRuntimeStatus | null;
  defaults: CapabilityChoice[];
  /** The defaults came from the library list because the backend call failed. */
  defaultsGuessed: boolean;
  /** model id -> the capability labels it is in use for. */
  inUse: Map<string, string[]>;
  settings: Settings;
  onSettings: (settings: Settings) => void;
  run: Run;
  refresh: () => void;
  open: (id: string) => void;
  goto: (page: LibraryPage) => void;
};
