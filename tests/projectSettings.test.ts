import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { normalizeProjectSettings, ProjectSettingsDialog } from '../src/settings/Dialogs';
import { newProject } from '../src/lib/timeline';

// The modal shell portals into document.body, which does not exist in this
// suite — stand in with a plain wrapper so the dialog body still renders.
vi.mock('../src/components/ui', () => ({
  Modal: ({ title, children, footer }: { title: React.ReactNode; children: React.ReactNode; footer: React.ReactNode }) =>
    React.createElement('div', null, title, children, footer),
  ColorSwatches: () => null,
  Toggle: () => null,
  useToast: () => () => undefined,
}));

describe('ProjectSettingsDialog', () => {
  it('shows the current project identity and the active comp frame setup', () => {
    const project = newProject();
    project.name = 'Launch Cut';
    const comp = project.comps[0];
    const html = renderToString(
      React.createElement(ProjectSettingsDialog, {
        project,
        comp,
        filePath: 'D:\\videos\\launch.bhippi',
        onClose: () => undefined,
        onSubmit: () => undefined,
      }),
    );
    expect(html).toContain('Project Settings');
    expect(html).toContain('Launch Cut');
    expect(html).toContain('launch.bhippi');
    expect(html).toContain(`${comp.width}`);
    expect(html).toContain('Comp 1');
    expect(html).toContain('Frame rate');
    expect(html).toContain('Caption style');
  });
  it('normalizes the submitted name and frame setup', () => {
    const project = newProject();
    project.name = 'Launch Cut';
    expect(normalizeProjectSettings(project, { name: '  ', activeCompId: null, width: 99999, height: 0, fps: 30, captionStyle: null }))
      .toMatchObject({ name: 'Launch Cut', width: 8192, height: 16 });
    expect(normalizeProjectSettings(project, { name: ' Final ', activeCompId: 'c1', width: 1920.6, height: 1080, fps: 60, captionStyle: 'bold' }))
      .toMatchObject({ name: 'Final', activeCompId: 'c1', width: 1921, fps: 60, captionStyle: 'bold' });
  });
});
