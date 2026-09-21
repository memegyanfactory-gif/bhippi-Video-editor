import { describe, expect, it } from 'vitest';
import { compDetail } from '../src/lib/aiTools';
import { newProject } from '../src/lib/timeline';

describe('working range', () => {
  it('names the In→Out span as the job when marked', () => {
    const project = newProject('Range');
    const comp = { ...project.comps[0], inPoint: 12, outPoint: 24.5 };
    const detail = compDetail({ ...project, comps: [comp] }, new Map(), comp);
    expect(detail.workingRange).toContain('12');
    expect(detail.workingRange).toContain('24.5');
    expect(detail.workingRange).toContain('inside this span only');
  });

  it('stays silent without a valid marked range', () => {
    const project = newProject('Full');
    const comp = project.comps[0];
    expect(compDetail(project, new Map(), comp).workingRange).toBeNull();
    const inverted = { ...comp, inPoint: 30, outPoint: 10 };
    expect(compDetail({ ...project, comps: [inverted] }, new Map(), inverted).workingRange).toBeNull();
  });
});
