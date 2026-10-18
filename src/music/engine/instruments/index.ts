// One player per InstrumentType. Each is `play(ctx, out, ev, channel, song, sample?) → { stopAt, end }`.
import type { InstrumentType } from '../../types';
import { play as bass808 } from './bass808';
import { play as drum } from './drum';
import { play as fm } from './fm';
import { play as keys } from './keys';
import { play as noise } from './noise';
import { play as organ } from './organ';
import { play as pad } from './pad';
import { play as pluck } from './pluck';
import { play as sampler } from './sampler';
import { play as synth } from './synth';
import type { PlayFn } from './types';

export const INSTRUMENTS: Record<InstrumentType, PlayFn> = { synth, fm, drum, bass808, sampler, pluck, pad, organ, keys, noise };

export type { PlayFn, VoiceEvent, VoiceHandle } from './types';
