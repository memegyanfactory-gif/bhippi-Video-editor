// Subtitle Panel Tab for Bhippi: Project scanning, subtitle layer generation,
// and the caption style library browser.
import {
  Languages,
  Layers,
  Loader2,
  Play,
  Search,
  Sparkles,
  Subtitles as SubtitlesIcon,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../components/ui';
import { StyledCaptionText } from '../editor/StyledCaption';
import { CAPTION_STYLES, categoryBrief, STYLE_CATEGORIES, type CaptionStyle } from '../lib/captionStyles';
import { timecode } from '../lib/editor';
import {
  applyStyleToAllCaptions,
  assetsToTranscribe,
  buildWatchfiwnCues,
  generateProjectSubtitles,
  subtitleLangLabel,
  wordsOnTimeline,
  POPULAR_SUBTITLE_LANGS,
  SUBTITLE_LANGUAGES,
} from '../lib/subtitlesEngine';
import type { Asset, Comp, Project } from '../lib/types';
import type { History } from '../lib/history';
import { api, type TranscriptWord } from '../lib/ipc';

type Props = {
  project: Project;
  comp?: Comp;
  assets: Asset[];
  history: History;
  clipSelection: string[];
  playheadTime?: number;
  onCaptionStyle: (style: CaptionStyle) => void;
  onImportCaptions: (file: File) => void;
  onSeek?: (seconds: number) => void;
};

export function SubtitleTab({
  project,
  comp,
  assets,
  history,
  clipSelection,
  playheadTime = 0,
  onCaptionStyle,
  onImportCaptions,
  onSeek,
}: Props) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [language, setLanguage] = useState<string>('en');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [generating, setGenerating] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [activeTabSection, setActiveTabSection] = useState<'styles' | 'cues'>('styles');

  const assetMap = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);

  // Existing caption clips in the active composition
  const captionClips = useMemo(() => {
    if (!comp) return [];
    return comp.clips
      .filter((clip) => clip.source.type === 'text' && clip.source.preset === 'caption')
      .sort((a, b) => a.start - b.start);
  }, [comp]);

  // Selected caption clip (if any)
  const selectedCaption = useMemo(() => {
    if (!comp) return undefined;
    return comp.clips.find(
      (c) => clipSelection.includes(c.id) && c.source.type === 'text' && c.source.preset === 'caption',
    );
  }, [comp, clipSelection]);

  const currentStyleId = selectedCaption?.source.type === 'text'
    ? (selectedCaption.source.style ?? project.captionStyle)
    : project.captionStyle;

  const activeStyleObj = useMemo(
    () => CAPTION_STYLES.find((s) => s.id === currentStyleId) ?? CAPTION_STYLES[0],
    [currentStyleId],
  );

  // Filtered caption styles
  const filteredStyles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return CAPTION_STYLES.filter((style) => {
      const matchCat = selectedCategory === 'All' || style.category === selectedCategory;
      const matchSearch =
        !q ||
        style.label.toLowerCase().includes(q) ||
        style.category.toLowerCase().includes(q) ||
        style.tags.some((t) => t.toLowerCase().includes(q));
      return matchCat && matchSearch;
    });
  }, [selectedCategory, searchQuery]);

  // Whether any key on this machine can transcribe, so the panel can say so before it is clicked.
  const [engines, setEngines] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    void api.transcribeEngines().then((list) => alive && setEngines(list)).catch(() => alive && setEngines([]));
    return () => {
      alive = false;
    };
  }, []);

  // Whether a TypeSafe key is on this machine; without one the Suggest button stays away.
  const [canJudge, setCanJudge] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<{ id: string; confidence: number } | null>(null);
  useEffect(() => {
    let alive = true;
    void api.typesafeReady().then((ready) => alive && setCanJudge(ready)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Picks a caption style for this video with a TypeSafe judgment.
   *
   * A hundred-plus options in one question is too many to answer well, so it asks twice: which family
   * suits the footage, then which style within it. Code gathers the state and owns the shortlist;
   * the model only chooses. A no-match option is in both lists, because a project with nothing to
   * go on should not force a confident answer.
   */
  const suggestStyle = async () => {
    if (!comp) return;
    setSuggesting(true);
    setSuggestion(null);
    try {
      const names = comp.clips
        .map((clip) => (clip.source.type === 'media' ? assetMap.get(clip.source.assetId)?.name : clip.source.type === 'text' ? clip.source.text : null))
        .filter(Boolean)
        .slice(0, 12);
      const vertical = comp.height > comp.width;
      const state = JSON.stringify({
        sequence: comp.name,
        frame: `${comp.width}x${comp.height}${vertical ? ' (vertical, for Reels or Shorts)' : ' (landscape)'}`,
        seconds: Math.round(comp.clips.reduce((longest, clip) => Math.max(longest, clip.start + clip.duration), 0)),
        clips: comp.clips.length,
        captionsAlready: captionClips.length,
        media: names,
        language: subtitleLangLabel(language),
      });

      const family = await api.typesafeChoose(
        state,
        'Which family of caption styles suits this video best?',
        [
          ...STYLE_CATEGORIES.map((category) => ({ id: category, description: categoryBrief(category) })),
          { id: 'no-preference', description: 'Nothing about this video points to one family over another' },
        ],
      );
      const pool = (family.id === 'no-preference' ? CAPTION_STYLES : CAPTION_STYLES.filter((style) => style.category === family.id)).slice(0, 24);
      if (pool.length < 2) {
        toast({ tone: 'info', title: 'No suggestion', body: 'That family has too few styles to choose between.' });
        return;
      }
      const pick = await api.typesafeChoose(
        state,
        `Which of these caption styles suits this video best? The ${family.id} family was chosen for it.`,
        [
          ...pool.map((style) => ({ id: style.id, description: `${style.label}: ${style.tags.join(', ') || style.category}` })),
          { id: 'no-preference', description: 'None of these fits this video' },
        ],
      );
      if (pick.id === 'no-preference') {
        toast({ tone: 'info', title: 'No clear match', body: `Nothing in ${family.id} stood out for this video.` });
        return;
      }
      const chosen = CAPTION_STYLES.find((style) => style.id === pick.id);
      if (!chosen) return;
      setSuggestion({ id: chosen.id, confidence: pick.confidence });
      setSelectedCategory(chosen.category);
      onCaptionStyle(chosen);
      toast({
        tone: 'success',
        title: `${chosen.label} suits this video`,
        body: `${chosen.category} · ${Math.round(pick.confidence * 100)}% of the answer settled on it.`,
        timeout: 5000,
      });
    } catch (error) {
      toast({ tone: 'error', title: 'Could not judge the footage', body: error instanceof Error ? error.message : String(error) });
    } finally {
      setSuggesting(false);
    }
  };

  // Handle Generate Subtitles button click
  const handleGenerateSubtitles = async () => {
    if (!comp) {
      toast({ tone: 'info', title: 'No active sequence', body: 'Please open or create a composition first.' });
      return;
    }

    const sources = assetsToTranscribe(comp, assetMap);
    if (sources.length === 0) {
      toast({ tone: 'info', title: 'Nothing to transcribe', body: 'This sequence has no unmuted clip with sound. Add footage, or import an .SRT.' });
      return;
    }

    setGenerating(true);
    try {
      // Each distinct file is transcribed once and cached, so re-generating after an edit is
      // instant and a file cut into many clips is only ever sent up once.
      const transcripts = new Map<string, TranscriptWord[]>();
      let engine = '';
      for (const [index, asset] of sources.entries()) {
        setStatusMessage(`Transcribing ${asset.name}${sources.length > 1 ? ` (${index + 1} of ${sources.length})` : ''}…`);
        const transcript = await api.transcribeAsset(asset.id, language);
        transcripts.set(asset.id, transcript.words);
        engine = transcript.provider;
      }

      setStatusMessage('Timing the captions…');
      const words = wordsOnTimeline(comp, assetMap, transcripts);
      const cues = buildWatchfiwnCues(words);
      if (cues.length === 0) {
        toast({ tone: 'info', title: 'No speech found', body: `${engine || 'The transcriber'} heard nothing to caption in this sequence.` });
        return;
      }

      const result = generateProjectSubtitles(comp, {
        styleId: currentStyleId ?? activeStyleObj.id,
        customCues: cues,
      });

      history.commit(
        (current) => ({
          ...current,
          comps: current.comps.map((c) => (c.id === comp.id ? result.comp : c)),
        }),
        'Generate Subtitles',
      );

      toast({
        tone: 'success',
        title: `Generated ${result.count} subtitle cues`,
        body: `On "${result.track.name}" in the ${activeStyleObj.label} style, from ${subtitleLangLabel(language)} speech.`,
        timeout: 4000,
      });

      setActiveTabSection('styles');
    } catch (err) {
      toast({
        tone: 'error',
        title: 'Subtitle generation failed',
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setGenerating(false);
      setStatusMessage('');
    }
  };

  // Handle applying chosen style to all captions in sequence
  const handleApplyToAllCaptions = (style: CaptionStyle) => {
    if (!comp || captionClips.length === 0) return;
    const updated = applyStyleToAllCaptions(comp, style.id);
    history.commit(
      (current) => ({
        ...current,
        captionStyle: style.id,
        comps: current.comps.map((c) => (c.id === comp.id ? updated : c)),
      }),
      'Apply Caption Style to All',
    );
    toast({
      tone: 'success',
      title: `${style.label} applied`,
      body: `Updated ${captionClips.length} subtitle cues across the project.`,
      timeout: 2500,
    });
  };

  // Delete a specific caption cue
  const handleDeleteCue = (clipId: string) => {
    if (!comp) return;
    history.commit(
      (current) => ({
        ...current,
        comps: current.comps.map((c) =>
          c.id === comp.id ? { ...c, clips: c.clips.filter((clip) => clip.id !== clipId) } : c,
        ),
      }),
      'Delete Subtitle Cue',
    );
  };

  // Update a caption cue's text
  const handleUpdateCueText = (clipId: string, newText: string) => {
    if (!comp) return;
    history.commit(
      (current) => ({
        ...current,
        comps: current.comps.map((c) =>
          c.id === comp.id
            ? {
                ...c,
                clips: c.clips.map((clip) =>
                  clip.id === clipId && clip.source.type === 'text'
                    ? { ...clip, source: { ...clip.source, text: newText } }
                    : clip,
                ),
              }
            : c,
        ),
      }),
      'Edit Subtitle Text',
    );
  };

  return (
    <div className="panel-body sub-tab-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', padding: '10px 12px', gap: 10 }}>
      {/* Generate and the language it listens for. Nothing can transcribe without an engine,
          so the button stays off until one is set up. */}
      <div className="sub-generate">
        <button
          type="button"
          className="btn btn-small btn-primary sub-generate-btn"
          disabled={generating || !comp || !engines?.length}
          onClick={handleGenerateSubtitles}
          title={engines === null
            ? 'Checking for a transcription engine…'
            : engines.length === 0
              ? 'Add a transcription API key in Settings › AI providers to generate subtitles'
              : `Transcribes with ${engines[0]}`}
        >
          {generating ? <Loader2 size={12} className="spin" /> : <Sparkles size={12} />}
          <span>{generating ? 'Generating…' : 'Generate'}</span>
        </button>

        <label className="sub-lang-group">
          <Languages size={13} className="sub-lang-mark" />
          <select
            className="prop-select sub-lang"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            aria-label="Spoken language"
            title="The language spoken in this sequence"
          >
            <optgroup label="Popular Languages">
              {POPULAR_SUBTITLE_LANGS.map((code) => {
                const entry = SUBTITLE_LANGUAGES.find(([c]) => c === code);
                return entry ? <option key={entry[0]} value={entry[0]}>{entry[1]}</option> : null;
              })}
            </optgroup>
            <optgroup label="All Supported Languages">
              {SUBTITLE_LANGUAGES.map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </optgroup>
          </select>
        </label>
      </div>

      {generating && <div className="sub-status">{statusMessage || 'Transcribing this sequence…'}</div>}
      {engines?.length === 0 && (
        <div className="sub-note">
          No transcription engine yet. Add an API key in Settings › AI providers, or set up offline speech in Settings › Speech &amp; voice.
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept=".srt,.vtt"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImportCaptions(f);
          e.target.value = '';
        }}
      />

      <div className="sub-tabs">
        <div className="sub-tabs-group">
          <button
            type="button"
            className={`sub-tab${activeTabSection === 'styles' ? ' active' : ''}`}
            onClick={() => setActiveTabSection('styles')}
          >
            Styles <span className="sub-tab-count">{CAPTION_STYLES.length}</span>
          </button>
          <button
            type="button"
            className={`sub-tab${activeTabSection === 'cues' ? ' active' : ''}`}
            onClick={() => setActiveTabSection('cues')}
          >
            Cues <span className="sub-tab-count">{captionClips.length}</span>
          </button>
        </div>

        {activeTabSection === 'styles' && (
          <div className="sub-search">
            <Search size={11} className="sub-search-mark" />
            <input
              type="text"
              placeholder="Search styles…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="prop-input"
            />
          </div>
        )}

        {activeTabSection === 'styles' && canJudge && (
          <button
            type="button"
            className="icon-btn small"
            disabled={suggesting || !comp}
            onClick={() => void suggestStyle()}
            title="Suggest a style for this video"
          >
            {suggesting ? <Loader2 size={13} className="spin" /> : <Wand2 size={13} />}
          </button>
        )}
        {captionClips.length > 0 && (
          <button
            type="button"
            className="icon-btn small"
            onClick={() => handleApplyToAllCaptions(activeStyleObj)}
            title={`Put ${activeStyleObj.label} on all ${captionClips.length} cues`}
          >
            <Layers size={13} />
          </button>
        )}
        <button
          type="button"
          className="icon-btn small"
          onClick={() => fileInput.current?.click()}
          title="Import an .SRT or .VTT file"
        >
          <Upload size={13} />
        </button>
      </div>

      {/* ── Tab Content: Styles Browser ──────────────────────────────────────── */}
      {activeTabSection === 'styles' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 8 }}>
          {/* Category Filter Chips */}
          <div
            className="style-category-chips"
            style={{
              display: 'flex',
              gap: 4,
              overflowX: 'auto',
              paddingBottom: 4,
              flexShrink: 0,
              scrollbarWidth: 'none',
            }}
          >
            {['All', ...STYLE_CATEGORIES].map((cat) => (
              <button
                key={cat}
                type="button"
                className={`filter-chip ${selectedCategory === cat ? 'active' : ''}`}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Style Cards Grid */}
          <div className="style-grid">
            {filteredStyles.map((style) => {
              const isSelected = currentStyleId === style.id;
              return (
                <button
                  key={style.id}
                  type="button"
                  className={`style-card ${isSelected ? 'active' : ''}${suggestion?.id === style.id ? ' suggested' : ''}`}
                  onClick={() => onCaptionStyle(style)}
                  title={`${style.label} · ${style.category}${style.tags.length ? ` · ${style.tags.join(', ')}` : ''}`}
                >
                  {/* Visual Preview Swatch */}
                  <div className="style-sample">
                    <StyledCaptionText
                      style={style}
                      elapsed={null}
                      words={['Make', 'it', 'pop'].map((text, index) => ({
                        text: style.uppercase ? text.toUpperCase() : text,
                        index,
                        active: index === 1,
                        lit: !!style.highlight && (style.progressive ? index <= 1 : index === 1),
                      }))}
                    />
                  </div>

                  {/* Label & Details */}
                  <div className="style-meta">
                    <div className="style-name">{style.label}</div>
                    {suggestion?.id === style.id && <div className="style-cat">Suggested · {Math.round(suggestion.confidence * 100)}%</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Tab Content: Sequence Cues Manager ─────────────────────────────── */}
      {activeTabSection === 'cues' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 8 }}>
          {captionClips.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-faint)',
                gap: 8,
                textAlign: 'center',
                padding: 20,
              }}
            >
              <SubtitlesIcon size={32} style={{ opacity: 0.4 }} />
              <div style={{ fontSize: 12 }}>No subtitle cues in this sequence yet.</div>
              <button
                type="button"
                className="btn btn-primary btn-small"
                disabled={generating || !engines?.length}
                onClick={handleGenerateSubtitles}
              >
                <Sparkles size={13} /> Generate Subtitles
              </button>
            </div>
          ) : (
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                paddingRight: 2,
              }}
            >
              {captionClips.map((clip, index) => {
                const text = clip.source.type === 'text' ? clip.source.text : '';
                const startSec = clip.start;
                const endSec = clip.start + clip.duration;
                const isCurrent = playheadTime >= startSec && playheadTime <= endSec;

                return (
                  <div
                    key={clip.id}
                    style={{
                      background: isCurrent ? 'var(--panel-3)' : 'var(--panel-2)',
                      border: isCurrent ? '1px solid var(--blue)' : '1px solid var(--line-strong)',
                      borderRadius: 'var(--radius)',
                      padding: '6px 8px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: 'var(--text-dim)',
                            background: 'var(--panel-4)',
                            padding: '1px 5px',
                            borderRadius: 2,
                          }}
                        >
                          #{index + 1}
                        </span>
                        <span style={{ fontSize: 10.5, color: 'var(--blue-hi)', fontFamily: 'var(--mono)' }}>
                          {timecode(startSec, comp?.fps ?? 30)} → {timecode(endSec, comp?.fps ?? 30)}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {onSeek && (
                          <button
                            type="button"
                            className="icon-btn small"
                            onClick={() => onSeek(startSec)}
                            title="Jump playhead to this cue"
                          >
                            <Play size={11} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="icon-btn small"
                          onClick={() => handleDeleteCue(clip.id)}
                          title="Delete this cue"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>

                    <input
                      type="text"
                      value={text}
                      onChange={(e) => handleUpdateCueText(clip.id, e.target.value)}
                      className="prop-input"
                      style={{
                        width: '100%',
                        fontSize: 11.5,
                        padding: '3px 6px',
                        height: 24,
                      }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
