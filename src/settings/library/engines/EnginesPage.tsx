// "Engines": the programs Bhippi runs local models on. Each is one row with its status and the few
// things you do to it (Install, Start, Stop, Change). Models themselves live in the categories; this
// page is only where the machinery behind them is set up.
import { Box, Cpu, KeyRound, Mic, Sparkles, Workflow } from 'lucide-react';
import { useLiveJobs } from '../../../lib/jobsStore';
import { ComfyEngine } from '../../ModelEngine';
import type { LibraryContext } from '../shared';
import { BlenderEngine } from './BlenderEngine';
import { EngineSection } from './EngineRow';
import { GpuRuntime } from './GpuRuntime';
import { LlmEngine } from './LlmEngine';
import { SpeechRuntimes } from './SpeechRuntimes';
import { HfAccountRow } from '../HfSignIn';
import { useSpeechCenter } from '../speech/useSpeechCenter';

export function EnginesPage({ ctx }: { ctx: LibraryContext }) {
  const jobs = useLiveJobs();
  const speech = useSpeechCenter(ctx.settings, ctx.onSettings);
  const installJob = (pattern: RegExp) => jobs.find((row) => row.kind === 'install' && row.status === 'running' && pattern.test(row.label));
  return (
    <div className="ml-engines">
      <EngineSection icon={Cpu} title="GPU runtime" blurb="Python and PyTorch for local image, video and music models, the cutout and depth tools, and the eraser.">
        <GpuRuntime settings={ctx.settings} onSettings={ctx.onSettings} run={ctx.run} />
      </EngineSection>
      <EngineSection icon={Workflow} title="ComfyUI" blurb="Runs MiniMax H3 and the other models built as ComfyUI graphs. Bhippi can install its own, or use yours.">
        <ComfyEngine status={ctx.comfy} error={ctx.comfyError} job={installJob(/comfy/i)} run={ctx.run} />
      </EngineSection>
      <EngineSection icon={Sparkles} title="llama.cpp" blurb="Runs local language models that chat for Bhippi. Pick and start one under Language models.">
        <LlmEngine status={ctx.llm} job={installJob(/llama|llm/i)} run={ctx.run} onChanged={ctx.refresh} onBrowse={() => ctx.goto('llm')} />
      </EngineSection>
      <EngineSection icon={Mic} title="Speech" blurb="whisper.cpp turns speech into captions. Kokoro reads a script out loud. Both run offline.">
        <SpeechRuntimes center={speech} />
      </EngineSection>
      <EngineSection icon={KeyRound} title="Accounts" blurb="Some models ask you to sign in and accept their terms before you can download them. Sign in once and Bhippi does the rest.">
        <HfAccountRow />
      </EngineSection>
      <EngineSection icon={Box} title="Blender" blurb="The AI renders real 3D (glass, metal, extruded logos, devices) in your own Blender, headless in the background. Free from blender.org; 4.2 or newer.">
        <BlenderEngine settings={ctx.settings} onSettings={ctx.onSettings} run={ctx.run} />
      </EngineSection>
    </div>
  );
}
