// Icons for the studio's instruments, so the rack, browser and mixer name a sound the same way.
import { AudioWaveform, Church, Cloud, Drum, FileAudio, Guitar, Piano, Speaker, Waves, Wind, type LucideIcon } from 'lucide-react';
import type { InstrumentType } from '../types';

export const INSTRUMENT_ICONS: Record<InstrumentType, LucideIcon> = {
  synth: Waves, fm: AudioWaveform, drum: Drum, bass808: Speaker, sampler: FileAudio, pluck: Guitar, pad: Cloud, organ: Church, keys: Piano, noise: Wind,
};

export const instrumentIcon = (type: InstrumentType): LucideIcon => INSTRUMENT_ICONS[type] ?? Waves;
