import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { StoryboardViewer, type StoryboardScene } from '../src/chat/StoryboardViewer';

describe('StoryboardViewer component', () => {
  const sampleScenes: StoryboardScene[] = [
    {
      start: 0,
      end: 4.5,
      intent: 'Opening hook with presenter introduction',
      visual: 'Close up talking head with soft depth blur',
      audio: 'Speech begins, subtle ambient drone bed',
      evidence: 'Transcript: "Welcome back everyone"',
    },
    {
      start: 4.5,
      end: 10.0,
      intent: 'Demonstrate key feature breakdown',
      visual: 'Screen capture split screen with animated callout',
      audio: 'Voiceover clear, riser transition sfx at 9.8s',
      evidence: 'Video frames inspected: UI interface visible',
    },
  ];

  it('renders nothing when scenes array is empty', () => {
    const html = renderToString(React.createElement(StoryboardViewer, { scenes: [] }));
    expect(html).toBe('');
  });

  it('renders compact small bar with scene count and time range by default', () => {
    const html = renderToString(
      React.createElement(StoryboardViewer, {
        scenes: sampleScenes,
        fps: 30,
        compName: 'Main Edit',
      }),
    );

    expect(html).toContain('storyboard-widget small');
    expect(html).toContain('Storyboard');
    expect(html).toContain('2 scenes');
    expect(html).toContain('00:00:00:00');
    expect(html).toContain('00:00:10:00');
    expect(html).toContain('Opening hook with presenter introduc');
    expect(html).toContain('Expand');
  });

  it('formats scene duration and timecodes accurately', () => {
    const singleScene: StoryboardScene[] = [
      {
        start: 2.0,
        end: 7.0,
        intent: 'Action sequence',
        visual: 'Fast cut',
        audio: 'Heavy beat',
        evidence: 'Clip 1 audio track',
      },
    ];

    const html = renderToString(
      React.createElement(StoryboardViewer, {
        scenes: singleScene,
        fps: 30,
      }),
    );

    expect(html).toContain('1 scene');
    expect(html).toContain('00:00:00:00');
    expect(html).toContain('00:00:07:00');
  });
});
