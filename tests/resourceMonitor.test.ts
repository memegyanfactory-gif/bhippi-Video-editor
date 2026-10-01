import { describe, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(null) }));
import React from 'react';
import { renderToString } from 'react-dom/server';
import { ResourceMonitor, formatGb, usageTone } from '../src/components/ResourceMonitor';
import type { Job } from '../src/lib/types';
import type { ToolRun } from '../src/chat/Activity';

const job = (overrides: Partial<Job>): Job => ({
  id: 'job',
  kind: 'generation',
  label: 'Generating video',
  status: 'running',
  progress: 0,
  message: '',
  result: null,
  cancellable: true,
  ...overrides,
});

const run = (overrides: Partial<ToolRun>): ToolRun => ({
  callId: 'call',
  name: 'generate_video',
  request: 'a fox in the snow',
  summary: '',
  status: 'running',
  at: Date.now() - 4000,
  ms: null,
  ...overrides,
});

describe('ResourceMonitor', () => {
  it('lists the running job with its progress and the running tool by a readable name', () => {
    const jobs = [job({ id: 'a', label: 'Rendering fox.mp4', progress: 0.42, message: 'Encoding frame 210' }), job({ id: 'b', label: 'Whisper model', status: 'done', progress: 1 })];
    const runs = [run({ callId: 'c1' }), run({ callId: 'c2', name: 'read_file', status: 'done', ms: 12 })];
    const html = renderToString(React.createElement(ResourceMonitor, { jobs, runs, defaultOpen: true }));
    expect(html).toContain('Background jobs');
    expect(html).toContain('Rendering fox.mp4');
    expect(html).toContain('42%');
    expect(html).toContain('Encoding frame 210');
    expect(html).not.toContain('Whisper model');
    expect(html).toContain('Running tools');
    expect(html).toContain('generate video');
    expect(html).not.toContain('read file');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('GPU');
  });

  it('keeps the popover closed by default and shows the RAM, DISK and GPU rings, empty until the first reading', () => {
    const html = renderToString(React.createElement(ResourceMonitor, { jobs: [], runs: [] }));
    expect(html).not.toContain('role="dialog"');
    expect(html.match(/class="rm-ring empty"/g)).toHaveLength(3);
    for (const label of ['RAM —', 'DISK —', 'GPU —']) expect(html).toContain(label);
    // The detail waits for hover, and says it is still reading.
    expect(html).toContain('RAM: reading…');
    expect(html).toContain('role="tooltip"');
  });

  it('says nothing is running, once per section, when the lists are empty', () => {
    const html = renderToString(React.createElement(ResourceMonitor, { jobs: [], runs: [], defaultOpen: true }));
    expect(html.match(/Nothing running/g)).toHaveLength(2);
  });

  it('renders Stop and Delete buttons and the emergency video generation banner when video generation is active', () => {
    const jobs = [job({ id: 'vid1', label: 'Generating video', progress: 0.55, message: 'Step 11/20' })];
    const html = renderToString(React.createElement(ResourceMonitor, { jobs, runs: [], defaultOpen: true }));
    expect(html).toContain('rm-urgent-card');
    expect(html).toContain('Stop Video Generation');
    expect(html).toContain('Delete Task');
    expect(html).toContain('rm-btn-stop');
    expect(html).toContain('rm-btn-delete');
    expect(html).toContain('Stop');
  });
});

describe('usageTone', () => {
  it('steps green, amber, red at 70 and 90 percent', () => {
    expect(usageTone(0)).toBe('ok');
    expect(usageTone(69.9)).toBe('ok');
    expect(usageTone(70)).toBe('warn');
    expect(usageTone(89.9)).toBe('warn');
    expect(usageTone(90)).toBe('high');
    expect(usageTone(100)).toBe('high');
    expect(usageTone(Number.NaN)).toBe('ok');
  });
});

describe('formatGb', () => {
  it('keeps one decimal under 100, whole numbers above, and terabytes from 1000', () => {
    expect(formatGb(54.7)).toBe('54.7 GB');
    expect(formatGb(10)).toBe('10 GB');
    expect(formatGb(0.919)).toBe('0.9 GB');
    expect(formatGb(823.4)).toBe('823 GB');
    expect(formatGb(930.5)).toBe('931 GB');
    expect(formatGb(3726)).toBe('3.7 TB');
    expect(formatGb(63.9, false)).toBe('63.9');
    expect(formatGb(Number.NaN)).toBe('—');
  });
});
