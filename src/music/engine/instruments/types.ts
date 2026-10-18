import type { Channel, MusicProject } from '../../types';
import type { VoiceEvent, VoiceHandle } from '../voice';

/** Plays one note on `out` (the channel strip), scheduling everything at `ev.time`. */
export type PlayFn = (ctx: BaseAudioContext, out: AudioNode, ev: VoiceEvent, channel: Channel, song: MusicProject, sample?: AudioBuffer) => VoiceHandle;

export type { VoiceEvent, VoiceHandle };
