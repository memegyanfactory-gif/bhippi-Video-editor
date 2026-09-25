// After Effects Curves Color Grading Component for Bhippi
// Provides authentic AE-style channel selection (RGB, R, G, B, A), 4x4 coordinate grid,
// monotone cubic spline interpolation, draggable control points, presets (Linear, Invert, S-Curve),
// Smooth/Pencil modes, Auto, and Reset. Generates lookup table values for SVG feComponentTransfer.

import {
  Activity,
  Edit2,
  Maximize2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type CurvePoint = {
  x: number; // 0 to 1
  y: number; // 0 to 1
};

export type CurvesChannel = 'rgb' | 'r' | 'g' | 'b' | 'a';

export type CurvesData = {
  rgb: CurvePoint[];
  r: CurvePoint[];
  g: CurvePoint[];
  b: CurvePoint[];
  a: CurvePoint[];
};

export const DEFAULT_CURVE_POINTS: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

export const S_CURVE_POINTS: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 0.25, y: 0.15 },
  { x: 0.75, y: 0.85 },
  { x: 1, y: 1 },
];

export const INVERT_CURVE_POINTS: CurvePoint[] = [
  { x: 0, y: 1 },
  { x: 1, y: 0 },
];

export const AUTO_CURVE_POINTS: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 0.1, y: 0.04 },
  { x: 0.5, y: 0.52 },
  { x: 0.9, y: 0.96 },
  { x: 1, y: 1 },
];

export function getDefaultCurvesData(): CurvesData {
  return {
    rgb: [...DEFAULT_CURVE_POINTS],
    r: [...DEFAULT_CURVE_POINTS],
    g: [...DEFAULT_CURVE_POINTS],
    b: [...DEFAULT_CURVE_POINTS],
    a: [...DEFAULT_CURVE_POINTS],
  };
}

/**
 * Monotone cubic spline (Fritsch-Carlson) interpolation.
 * Prevents overshoots/undershoots and preserves monotonicity.
 */
export function evaluateSpline(points: CurvePoint[], x: number): number {
  if (points.length === 0) return x;
  if (points.length === 1) return points[0].y;

  // Clamp x to [0, 1]
  const clampedX = Math.max(0, Math.min(1, x));

  // Sort points by X
  const sorted = [...points].sort((a, b) => a.x - b.x);

  if (clampedX <= sorted[0].x) return sorted[0].y;
  if (clampedX >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y;

  const n = sorted.length;
  const deltas: number[] = [];
  const slopes: number[] = [];

  for (let i = 0; i < n - 1; i++) {
    const dx = sorted[i + 1].x - sorted[i].x;
    const dy = sorted[i + 1].y - sorted[i].y;
    deltas.push(dx === 0 ? 0 : dy / dx);
  }

  slopes.push(deltas[0]);
  for (let i = 1; i < n - 1; i++) {
    if (deltas[i - 1] * deltas[i] <= 0) {
      slopes.push(0);
    } else {
      slopes.push((deltas[i - 1] + deltas[i]) / 2);
    }
  }
  slopes.push(deltas[n - 2]);

  // Adjust slopes for monotonicity
  for (let i = 0; i < n - 1; i++) {
    if (deltas[i] === 0) {
      slopes[i] = 0;
      slopes[i + 1] = 0;
    } else {
      const alpha = slopes[i] / deltas[i];
      const beta = slopes[i + 1] / deltas[i];
      const dist = Math.hypot(alpha, beta);
      if (dist > 3) {
        const factor = 3 / dist;
        slopes[i] = alpha * factor * deltas[i];
        slopes[i + 1] = beta * factor * deltas[i];
      }
    }
  }

  // Find interval
  let seg = 0;
  for (let i = 0; i < n - 1; i++) {
    if (clampedX >= sorted[i].x && clampedX <= sorted[i + 1].x) {
      seg = i;
      break;
    }
  }

  const p0 = sorted[seg];
  const p1 = sorted[seg + 1];
  const h = p1.x - p0.x;
  if (h <= 0.00001) return p0.y;

  const t = (clampedX - p0.x) / h;
  const t2 = t * t;
  const t3 = t2 * t;

  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  const y = h00 * p0.y + h10 * h * slopes[seg] + h01 * p1.y + h11 * h * slopes[seg + 1];
  return Math.max(0, Math.min(1, y));
}

/**
 * Generate 32-sample lookup table string for SVG feFunc tableValues.
 */
export function generateTableValues(
  masterPoints: CurvePoint[],
  channelPoints: CurvePoint[],
  samples = 32
): string {
  const values: string[] = [];
  for (let i = 0; i < samples; i++) {
    const x = i / (samples - 1);
    const masterVal = evaluateSpline(masterPoints, x);
    const finalVal = evaluateSpline(channelPoints, masterVal);
    values.push(finalVal.toFixed(4));
  }
  return values.join(' ');
}

type Props = {
  allowAlpha?: boolean;
  params: Record<string, unknown>;
  onChange: (paramId: string, value: unknown, commit: boolean) => void;
  onCommit: () => void;
};

export function CurvesEditor({ params, onChange, onCommit, allowAlpha=true }: Props) {
  const [channel, setChannel] = useState<CurvesChannel>('rgb');
  const [drawMode, setDrawMode] = useState<'spline' | 'pencil'>('spline');
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [draggedPointIndex, setDraggedPointIndex] = useState<number | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parse curves data from params
  const curvesData: CurvesData = useMemo(() => {
    try {
      if (params.curvesData && typeof params.curvesData === 'object') {
        const raw = params.curvesData as CurvesData;
        return {
          rgb: Array.isArray(raw.rgb) && raw.rgb.length > 0 ? raw.rgb : [...DEFAULT_CURVE_POINTS],
          r: Array.isArray(raw.r) && raw.r.length > 0 ? raw.r : [...DEFAULT_CURVE_POINTS],
          g: Array.isArray(raw.g) && raw.g.length > 0 ? raw.g : [...DEFAULT_CURVE_POINTS],
          b: Array.isArray(raw.b) && raw.b.length > 0 ? raw.b : [...DEFAULT_CURVE_POINTS],
          a: Array.isArray(raw.a) && raw.a.length > 0 ? raw.a : [...DEFAULT_CURVE_POINTS],
        };
      }
      if (typeof params.curvesJson === 'string') {
        const parsed = JSON.parse(params.curvesJson);
        return {
          rgb: parsed.rgb || [...DEFAULT_CURVE_POINTS],
          r: parsed.r || [...DEFAULT_CURVE_POINTS],
          g: parsed.g || [...DEFAULT_CURVE_POINTS],
          b: parsed.b || [...DEFAULT_CURVE_POINTS],
          a: parsed.a || [...DEFAULT_CURVE_POINTS],
        };
      }
    } catch {
      // fallback
    }
    return getDefaultCurvesData();
  }, [params.curvesData, params.curvesJson]);

  const activePoints = curvesData[channel];

  const updateActivePoints = useCallback(
    (nextPoints: CurvePoint[], commit = false) => {
      const sorted = [...nextPoints].sort((a, b) => a.x - b.x);
      const nextData: CurvesData = {
        ...curvesData,
        [channel]: sorted,
      };

      // Also compute lookup table strings for feComponentTransfer
      const rTable = generateTableValues(nextData.rgb, nextData.r);
      const gTable = generateTableValues(nextData.rgb, nextData.g);
      const bTable = generateTableValues(nextData.rgb, nextData.b);
      const aTable = generateTableValues(nextData.rgb, nextData.a);

      onChange('curvesData', nextData, commit);
      onChange('curvesJson', JSON.stringify(nextData), commit);
      onChange('rTable', rTable, commit);
      onChange('gTable', gTable, commit);
      onChange('bTable', bTable, commit);
      onChange('aTable', aTable, commit);
    },
    [channel, curvesData, onChange]
  );

  // Colors based on active channel matching After Effects
  const channelColor = useMemo(() => {
    switch (channel) {
      case 'r':
        return '#ff4d4f';
      case 'g':
        return '#52c41a';
      case 'b':
        return '#1890ff';
      case 'a':
        return '#ffffff';
      case 'rgb':
      default:
        return '#dcd6c8'; // Cream / light beige like AE RGB curve
    }
  }, [channel]);

  // Coordinate transforms (SVG viewbox is 0 0 200 200)
  const toSvgCoords = (pt: CurvePoint) => ({
    x: pt.x * 200,
    y: (1 - pt.y) * 200,
  });

  const fromSvgCoords = (svgX: number, svgY: number): CurvePoint => ({
    x: Math.max(0, Math.min(1, svgX / 200)),
    y: Math.max(0, Math.min(1, 1 - svgY / 200)),
  });

  // Generate SVG path data for the spline curve
  const pathD = useMemo(() => {
    const samples = 100;
    const pathParts: string[] = [];
    for (let i = 0; i <= samples; i++) {
      const x = i / samples;
      const y = evaluateSpline(activePoints, x);
      const svgPt = toSvgCoords({ x, y });
      if (i === 0) {
        pathParts.push(`M ${svgPt.x.toFixed(1)} ${svgPt.y.toFixed(1)}`);
      } else {
        pathParts.push(`L ${svgPt.x.toFixed(1)} ${svgPt.y.toFixed(1)}`);
      }
    }
    return pathParts.join(' ');
  }, [activePoints]);

  // Handle pointer down on canvas
  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * 200;
    const svgY = ((e.clientY - rect.top) / rect.height) * 200;
    const pt = fromSvgCoords(svgX, svgY);

    // Check if clicked close to an existing point (within 10px in SVG space)
    const existingIdx = activePoints.findIndex((p) => {
      const sc = toSvgCoords(p);
      const dist = Math.hypot(sc.x - svgX, sc.y - svgY);
      return dist <= 10;
    });

    if (existingIdx !== -1) {
      setSelectedPointIndex(existingIdx);
      setDraggedPointIndex(existingIdx);
      (e.target as Element).setPointerCapture(e.pointerId);
    } else if (drawMode === 'spline') {
      // Add new point on curve
      const newPoints = [...activePoints, pt];
      const sorted = newPoints.sort((a, b) => a.x - b.x);
      const newIdx = sorted.findIndex((p) => p === pt);
      updateActivePoints(sorted, false);
      setSelectedPointIndex(newIdx);
      setDraggedPointIndex(newIdx);
      (e.target as Element).setPointerCapture(e.pointerId);
    }
  };

  // Handle pointer move during drag
  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (draggedPointIndex === null || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * 200;
    const svgY = ((e.clientY - rect.top) / rect.height) * 200;
    const pt = fromSvgCoords(svgX, svgY);

    const nextPoints = [...activePoints];
    const isEndpoint = draggedPointIndex === 0 || draggedPointIndex === activePoints.length - 1;

    if (isEndpoint) {
      // Endpoints only move vertically or lock to 0 and 1 horizontally
      const fixedX = draggedPointIndex === 0 ? 0 : 1;
      nextPoints[draggedPointIndex] = { x: fixedX, y: pt.y };
    } else {
      nextPoints[draggedPointIndex] = pt;
    }

    updateActivePoints(nextPoints, false);
  };

  // Handle pointer up
  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (draggedPointIndex !== null) {
      setDraggedPointIndex(null);
      try {
        (e.target as Element).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      onCommit();
    }
  };

  // Remove point on double click
  const handleDoubleClick = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (index === 0 || index === activePoints.length - 1) return; // cannot remove endpoints
    const nextPoints = activePoints.filter((_, i) => i !== index);
    updateActivePoints(nextPoints, true);
    setSelectedPointIndex(null);
  };

  // Keyboard shortcut to delete selected point
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (
          selectedPointIndex !== null &&
          selectedPointIndex > 0 &&
          selectedPointIndex < activePoints.length - 1
        ) {
          const nextPoints = activePoints.filter((_, i) => i !== selectedPointIndex);
          updateActivePoints(nextPoints, true);
          setSelectedPointIndex(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPointIndex, activePoints, updateActivePoints]);

  // Action Presets
  const applyPreset = (preset: CurvePoint[]) => {
    updateActivePoints([...preset], true);
  };

  const handleAuto = () => {
    applyPreset(AUTO_CURVE_POINTS);
  };

  const handleSmooth = () => {
    // Smooth intermediate points towards linear spline tangents
    if (activePoints.length <= 2) return;
    const smoothed = activePoints.map((pt, i) => {
      if (i === 0 || i === activePoints.length - 1) return pt;
      const prev = activePoints[i - 1];
      const next = activePoints[i + 1];
      const avgY = (prev.y + next.y) / 2;
      return { x: pt.x, y: (pt.y + avgY) / 2 };
    });
    updateActivePoints(smoothed, true);
  };

  const handleReset = () => {
    applyPreset(DEFAULT_CURVE_POINTS);
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(curvesData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bhippi-curves-${channel}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const parsed = JSON.parse(text) as CurvesData;
        if (parsed.rgb || parsed.r || parsed.g || parsed.b || parsed.a) {
          onChange('curvesData', parsed, true);
          onChange('curvesJson', text, true);
          onCommit();
        }
      } catch (err) {
        console.error('Failed to parse curves file', err);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="curves-editor">
      {/* ── Channel Selector Row ──────────────────────────────────────── */}
      <div className="curves-channel-row">
        <span className="curves-channel-label">Channel:</span>
        <select
          className="curves-channel-select"
          value={channel}
          onChange={(e) => {
            setChannel(e.target.value as CurvesChannel);
            setSelectedPointIndex(null);
          }}
        >
          <option value="rgb">RGB</option>
          <option value="r">Red</option>
          <option value="g">Green</option>
          <option value="b">Blue</option>
          {allowAlpha && <option value="a">Alpha</option>}
        </select>
      </div>

      {/* ── Preset & Tool Icons Row ──────────────────────────────────── */}
      <div className="curves-toolbar-row">
        {/* Presets: Linear, Invert, S-Curve */}
        <div className="curves-preset-group">
          <button
            type="button"
            className="curves-tool-btn"
            title="Linear / Reset Curve"
            onClick={() => applyPreset(DEFAULT_CURVE_POINTS)}
          >
            <Maximize2 size={13} />
          </button>
          <button
            type="button"
            className="curves-tool-btn"
            title="Invert / Negative"
            onClick={() => applyPreset(INVERT_CURVE_POINTS)}
          >
            <TrendingDown size={13} />
          </button>
          <button
            type="button"
            className="curves-tool-btn"
            title="S-Curve Contrast"
            onClick={() => applyPreset(S_CURVE_POINTS)}
          >
            <TrendingUp size={13} />
          </button>
        </div>

        {/* Tools: Smooth Spline vs Pencil */}
        <div className="curves-mode-group">
          <button
            type="button"
            className={`curves-tool-btn${drawMode === 'spline' ? ' active' : ''}`}
            title="Spline Curve Mode"
            onClick={() => setDrawMode('spline')}
          >
            <Activity size={13} />
          </button>
          <button
            type="button"
            className={`curves-tool-btn${drawMode === 'pencil' ? ' active' : ''}`}
            title="Pencil / Freehand Mode"
            onClick={() => setDrawMode('pencil')}
          >
            <Edit2 size={12} />
          </button>
        </div>
      </div>

      {/* ── 4x4 Coordinate Grid & Spline Display ─────────────────────── */}
      <div className="curves-canvas-wrapper">
        <svg
          ref={svgRef}
          viewBox="0 0 200 200"
          className="curves-svg-grid"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {/* Background */}
          <rect x="0" y="0" width="200" height="200" fill="#141416" />

          {/* 4x4 Dashed Grid lines (4 equal columns and 4 equal rows = 3 internal lines) */}
          <line x1="50" y1="0" x2="50" y2="200" stroke="#333842" strokeDasharray="3,3" strokeWidth="1" />
          <line x1="100" y1="0" x2="100" y2="200" stroke="#333842" strokeDasharray="3,3" strokeWidth="1" />
          <line x1="150" y1="0" x2="150" y2="200" stroke="#333842" strokeDasharray="3,3" strokeWidth="1" />

          <line x1="0" y1="50" x2="200" y2="50" stroke="#333842" strokeDasharray="3,3" strokeWidth="1" />
          <line x1="0" y1="100" x2="200" y2="100" stroke="#333842" strokeDasharray="3,3" strokeWidth="1" />
          <line x1="0" y1="150" x2="200" y2="150" stroke="#333842" strokeDasharray="3,3" strokeWidth="1" />

          {/* Diagonal reference guideline (identity) */}
          <line x1="0" y1="200" x2="200" y2="0" stroke="#262a33" strokeWidth="1" />

          {/* Active spline curve */}
          <path
            d={pathD}
            fill="none"
            stroke={channelColor}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Draggable Control Points */}
          {activePoints.map((pt, idx) => {
            const sc = toSvgCoords(pt);
            const isSelected = selectedPointIndex === idx;
            const isEndpoint = idx === 0 || idx === activePoints.length - 1;

            if (isEndpoint) {
              return (
                <rect
                  key={idx}
                  x={sc.x - 4}
                  y={sc.y - 4}
                  width="8"
                  height="8"
                  fill="#1b1e26"
                  stroke={isSelected ? '#ffffff' : channelColor}
                  strokeWidth={isSelected ? 2 : 1.5}
                  style={{ cursor: 'ns-resize' }}
                />
              );
            }

            return (
              <g key={idx} onDoubleClick={(e) => handleDoubleClick(idx, e)}>
                <circle
                  cx={sc.x}
                  cy={sc.y}
                  r="5"
                  fill="#1b1e26"
                  stroke={isSelected ? '#ffffff' : channelColor}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  style={{ cursor: 'grab' }}
                />
                {isSelected && (
                  <circle
                    cx={sc.x}
                    cy={sc.y}
                    r="8"
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="1"
                    strokeDasharray="2,2"
                  />
                )}
              </g>
            );
          })}

          {/* Outer Border */}
          <rect x="0.5" y="0.5" width="199" height="199" fill="none" stroke="#4b505c" strokeWidth="1" />
        </svg>
      </div>

      {/* ── Bottom Action Buttons (Open, Auto, Smooth, Save, Reset) ─── */}
      <div className="curves-actions-grid">
        <button
          type="button"
          className="curves-action-btn"
          onClick={() => fileInputRef.current?.click()}
          title="Open saved curves preset file"
        >
          Open...
        </button>
        <button
          type="button"
          className="curves-action-btn"
          onClick={handleAuto}
          title="Apply the gentle contrast preset; does not analyze image content"
        >
          Gentle contrast
        </button>
        <button
          type="button"
          className="curves-action-btn"
          onClick={handleSmooth}
          title="Smooth intermediate tangents"
        >
          Smooth
        </button>
        <button
          type="button"
          className="curves-action-btn"
          onClick={handleExport}
          title="Save current curves to JSON preset"
        >
          Save...
        </button>
        <button
          type="button"
          className="curves-action-btn reset"
          onClick={handleReset}
          title="Reset active channel curve"
        >
          Reset
        </button>
      </div>

      {/* Hidden file input for loading presets */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />
    </div>
  );
}
