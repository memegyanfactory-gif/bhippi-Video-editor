import { gradeTables } from './colorGrade';
// Engine for generating effect schemas, SVG filter pipelines, and CSS transforms
// Supports distortion (Turbulent Displace, Wave Warp, Bulge, Twirl, Ripple, CC Slant, etc.),
// Blur & Sharpen, Color Correction, and Stylize effects on clips and adjustment layers.

import type { ReactNode } from 'react';
import type { EffectDefinition } from './effectsCatalog';
import type { AppliedEffect } from './types';

export type EffectParamDef = {
  id: string;
  name: string;
  type: 'number' | 'boolean' | 'select' | 'color';
  defaultValue: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { label: string; value: string }[];
};

export type EffectSchema = {
  params: EffectParamDef[];
};

/** Schema definitions for specific effect types, especially Distortion */
export const EFFECT_SCHEMAS: Record<string, EffectSchema> = {
  'displacement-map': {
    params: [
      {
        id: 'displaceLayer',
        name: 'Displacement Map Layer',
        type: 'select',
        defaultValue: 'procedural-noise',
        options: [
          { label: 'Procedural Noise / Grain', value: 'procedural-noise' },
          { label: 'Linear Gradient Map', value: 'gradient' },
          { label: 'Radial Wave Map', value: 'radial' },
          { label: 'Current Layer / Self', value: 'self' },
        ],
      },
      {
        id: 'xChannel',
        name: 'Use For Horizontal Displace',
        type: 'select',
        defaultValue: 'R',
        options: [
          { label: 'Red', value: 'R' },
          { label: 'Green', value: 'G' },
          { label: 'Blue', value: 'B' },
          { label: 'Alpha', value: 'A' },
          { label: 'Luminance', value: 'L' },
        ],
      },
      {
        id: 'maxHorizontal',
        name: 'Max Horizontal Displacement',
        type: 'number',
        defaultValue: 15,
        min: -150,
        max: 150,
        step: 0.5,
        unit: 'px',
      },
      {
        id: 'yChannel',
        name: 'Use For Vertical Displace',
        type: 'select',
        defaultValue: 'G',
        options: [
          { label: 'Red', value: 'R' },
          { label: 'Green', value: 'G' },
          { label: 'Blue', value: 'B' },
          { label: 'Alpha', value: 'A' },
          { label: 'Luminance', value: 'L' },
        ],
      },
      {
        id: 'maxVertical',
        name: 'Max Vertical Displacement',
        type: 'number',
        defaultValue: 15,
        min: -150,
        max: 150,
        step: 0.5,
        unit: 'px',
      },
      {
        id: 'mapBehavior',
        name: 'Displacement Map Behavior',
        type: 'select',
        defaultValue: 'center',
        options: [
          { label: 'Center Map', value: 'center' },
          { label: 'Stretch to Fit', value: 'stretch' },
          { label: 'Tile Map', value: 'tile' },
        ],
      },
      {
        id: 'wrapPixels',
        name: 'Wrap Pixels Around',
        type: 'boolean',
        defaultValue: false,
      },
      {
        id: 'expandOutput',
        name: 'Expand Output',
        type: 'boolean',
        defaultValue: true,
      },
    ],
  },
  'turbulent-displace': {
    params: [
      { id: 'amount', name: 'Amount', type: 'number', defaultValue: 35, min: -100, max: 100, step: 1 },
      { id: 'size', name: 'Size', type: 'number', defaultValue: 25, min: 2, max: 100, step: 1 },
      { id: 'complexity', name: 'Complexity', type: 'number', defaultValue: 2, min: 1, max: 5, step: 1 },
      { id: 'evolution', name: 'Evolution', type: 'number', defaultValue: 0, min: 0, max: 360, step: 1, unit: '°' },
      {
        id: 'displaceType',
        name: 'Displacement',
        type: 'select',
        defaultValue: 'fractalNoise',
        options: [
          { label: 'Turbulence', value: 'turbulence' },
          { label: 'Fractal Noise', value: 'fractalNoise' },
        ],
      },
    ],
  },
  'wave-warp': {
    params: [
      { id: 'waveHeight', name: 'Wave Height', type: 'number', defaultValue: 20, min: 0, max: 100, step: 1, unit: 'px' },
      { id: 'waveWidth', name: 'Wave Width', type: 'number', defaultValue: 40, min: 5, max: 200, step: 1, unit: 'px' },
      { id: 'direction', name: 'Direction', type: 'number', defaultValue: 0, min: -180, max: 180, step: 1, unit: '°' },
      {
        id: 'waveType',
        name: 'Wave Type',
        type: 'select',
        defaultValue: 'sine',
        options: [
          { label: 'Sine', value: 'sine' },
          { label: 'Square', value: 'square' },
          { label: 'Triangle', value: 'triangle' },
        ],
      },
    ],
  },
  bulge: {
    params: [
      { id: 'radius', name: 'Horizontal Radius', type: 'number', defaultValue: 80, min: 10, max: 300, step: 1, unit: 'px' },
      { id: 'amount', name: 'Bulge Height', type: 'number', defaultValue: 50, min: -100, max: 100, step: 1 },
      { id: 'centerX', name: 'Center X', type: 'number', defaultValue: 50, min: 0, max: 100, step: 1, unit: '%' },
      { id: 'centerY', name: 'Center Y', type: 'number', defaultValue: 50, min: 0, max: 100, step: 1, unit: '%' },
    ],
  },
  spherize: {
    params: [
      { id: 'radius', name: 'Radius', type: 'number', defaultValue: 80, min: 10, max: 300, step: 1, unit: 'px' },
      { id: 'amount', name: 'Amount', type: 'number', defaultValue: 60, min: -100, max: 100, step: 1 },
    ],
  },
  'cc-lens': {
    params: [
      { id: 'size', name: 'Size', type: 'number', defaultValue: 75, min: 5, max: 200, step: 1 },
      { id: 'distortion', name: 'Distortion', type: 'number', defaultValue: 60, min: -100, max: 100, step: 1 },
    ],
  },
  twirl: {
    params: [
      { id: 'angle', name: 'Twirl Angle', type: 'number', defaultValue: 90, min: -360, max: 360, step: 1, unit: '°' },
      { id: 'radius', name: 'Twirl Radius', type: 'number', defaultValue: 80, min: 10, max: 300, step: 1, unit: 'px' },
    ],
  },
  ripple: {
    params: [
      { id: 'waveWidth', name: 'Wave Width', type: 'number', defaultValue: 30, min: 5, max: 100, step: 1, unit: 'px' },
      { id: 'intensity', name: 'Intensity', type: 'number', defaultValue: 25, min: 1, max: 100, step: 1 },
    ],
  },
  'cc-slant': {
    params: [
      { id: 'slant', name: 'Slant', type: 'number', defaultValue: 15, min: -60, max: 60, step: 1, unit: '°' },
      {
        id: 'axis',
        name: 'Axis',
        type: 'select',
        defaultValue: 'horizontal',
        options: [
          { label: 'Horizontal', value: 'horizontal' },
          { label: 'Vertical', value: 'vertical' },
        ],
      },
    ],
  },
  mirror: {
    params: [
      { id: 'reflectionAngle', name: 'Reflection Angle', type: 'number', defaultValue: 0, min: 0, max: 360, step: 1, unit: '°' },
      { id: 'flipHorizontal', name: 'Flip Horizontal', type: 'boolean', defaultValue: true },
    ],
  },
  'gaussian-blur': {
    params: [
      { id: 'blurriness', name: 'Blurriness', type: 'number', defaultValue: 15, min: 0, max: 200, step: 0.5, unit: 'px' },
    ],
  },
  'directional-blur': {
    params: [
      { id: 'direction', name: 'Direction', type: 'number', defaultValue: 0, min: -180, max: 180, step: 1, unit: '°' },
      { id: 'length', name: 'Blur Length', type: 'number', defaultValue: 15, min: 0, max: 100, step: 1, unit: 'px' },
    ],
  },
  glow: {
    params: [
      { id: 'glowRadius', name: 'Glow Radius', type: 'number', defaultValue: 15, min: 1, max: 100, step: 1, unit: 'px' },
      { id: 'glowIntensity', name: 'Glow Intensity', type: 'number', defaultValue: 60, min: 0, max: 100, step: 1, unit: '%' },
      { id: 'glowColor', name: 'Glow Color', type: 'color', defaultValue: '#00e5ff' },
    ],
  },
  tint: {
    params: [
      { id: 'mapBlackTo', name: 'Map Black to', type: 'color', defaultValue: '#000000' },
      { id: 'mapWhiteTo', name: 'Map White to', type: 'color', defaultValue: '#ffffff' },
      { id: 'amount', name: 'Amount to Tint', type: 'number', defaultValue: 100, min: 0, max: 100, step: 1, unit: '%' },
    ],
  },
  invert: {
    params: [
      { id: 'amount', name: 'Invert', type: 'number', defaultValue: 100, min: 0, max: 100, step: 1, unit: '%' },
    ],
  },
  'black-white': {
    params: [
      { id: 'amount', name: 'Amount', type: 'number', defaultValue: 100, min: 0, max: 100, step: 1, unit: '%' },
    ],
  },
  mosaic: {
    params: [
      { id: 'horizontalBlocks', name: 'Horizontal Blocks', type: 'number', defaultValue: 20, min: 2, max: 100, step: 1 },
      { id: 'verticalBlocks', name: 'Vertical Blocks', type: 'number', defaultValue: 20, min: 2, max: 100, step: 1 },
    ],
  },
  curves: {
    params: [],
  },
  levels: {
    params: [
      { id: 'inputBlack', name: 'Input Black', type: 'number', defaultValue: 0, min: 0, max: 255, step: 1 },
      { id: 'inputWhite', name: 'Input White', type: 'number', defaultValue: 255, min: 0, max: 255, step: 1 },
      { id: 'gamma', name: 'Gamma', type: 'number', defaultValue: 1.0, min: 0.1, max: 5.0, step: 0.05 },
      { id: 'outputBlack', name: 'Output Black', type: 'number', defaultValue: 0, min: 0, max: 255, step: 1 },
      { id: 'outputWhite', name: 'Output White', type: 'number', defaultValue: 255, min: 0, max: 255, step: 1 },
    ],
  },
  'brightness-contrast': {
    params: [
      { id: 'brightness', name: 'Brightness', type: 'number', defaultValue: 0, min: -100, max: 100, step: 1 },
      { id: 'contrast', name: 'Contrast', type: 'number', defaultValue: 0, min: -100, max: 100, step: 1 },
    ],
  },
  'hue-saturation': {
    params: [
      { id: 'masterHue', name: 'Master Hue', type: 'number', defaultValue: 0, min: -180, max: 180, step: 1, unit: '°' },
      { id: 'masterSaturation', name: 'Master Saturation', type: 'number', defaultValue: 0, min: -100, max: 100, step: 1, unit: '%' },
      { id: 'masterLightness', name: 'Master Lightness', type: 'number', defaultValue: 0, min: -100, max: 100, step: 1, unit: '%' },
    ],
  },
  'lumetri-color': {
    params: [
      { id: 'temperature', name: 'Temperature', type: 'number', defaultValue: 0, min: -100, max: 100, step: 1 },
      { id: 'tint', name: 'Tint', type: 'number', defaultValue: 0, min: -100, max: 100, step: 1 },
      { id: 'exposure', name: 'Exposure', type: 'number', defaultValue: 0, min: -5, max: 5, step: 0.1 },
      { id: 'contrast', name: 'Contrast', type: 'number', defaultValue: 0, min: -100, max: 100, step: 1 },
      { id: 'highlights', name: 'Highlights', type: 'number', defaultValue: 0, min: -100, max: 100, step: 1 },
      { id: 'shadows', name: 'Shadows', type: 'number', defaultValue: 0, min: -100, max: 100, step: 1 },
      { id: 'whites', name: 'Whites', type: 'number', defaultValue: 0, min: -100, max: 100, step: 1 },
      { id: 'blacks', name: 'Blacks', type: 'number', defaultValue: 0, min: -100, max: 100, step: 1 },
      { id: 'saturation', name: 'Saturation', type: 'number', defaultValue: 100, min: 0, max: 200, step: 1, unit: '%' },
    ],
  },
  'color-balance-hls': { params: [
    {id:'masterHue',name:'Hue',type:'number',defaultValue:0,min:-180,max:180,step:1,unit:'°'},
    {id:'masterLightness',name:'Lightness',type:'number',defaultValue:0,min:-100,max:100,step:1},
    {id:'masterSaturation',name:'Saturation',type:'number',defaultValue:0,min:-100,max:100,step:1},
  ]},
  '4-color-gradient': { params: [
    {id:'topLeft',name:'Top left',type:'color',defaultValue:'#ff4040'},
    {id:'topRight',name:'Top right',type:'color',defaultValue:'#ffff40'},
    {id:'bottomLeft',name:'Bottom left',type:'color',defaultValue:'#4040ff'},
    {id:'bottomRight',name:'Bottom right',type:'color',defaultValue:'#40ffff'},
    {id:'mix',name:'Mix with gradient',type:'number',defaultValue:100,min:0,max:100,step:1,unit:'%'},
  ]},
  'keylight': { params: [
    { id: 'screenColor', name: 'Screen Color', type: 'color', defaultValue: '#00ff00' },
    { id: 'screenGain', name: 'Screen Gain / Tolerance', type: 'number', defaultValue: 30, min: 1, max: 100, step: 1, unit: '%' },
    { id: 'screenBalance', name: 'Edge Softness', type: 'number', defaultValue: 10, min: 0, max: 100, step: 1, unit: '%' },
    { id: 'despill', name: 'Spill Suppression', type: 'number', defaultValue: 50, min: 0, max: 100, step: 1, unit: '%' },
  ]},
  'linear-color-key': { params: [
    { id: 'keyColor', name: 'Key Color', type: 'color', defaultValue: '#00ff00' },
    { id: 'tolerance', name: 'Tolerance', type: 'number', defaultValue: 30, min: 1, max: 100, step: 1, unit: '%' },
    { id: 'softness', name: 'Softness', type: 'number', defaultValue: 10, min: 0, max: 100, step: 1, unit: '%' },
  ]},
  'extract': { params: [
    { id: 'blackPoint', name: 'Black Point', type: 'number', defaultValue: 25, min: 0, max: 255, step: 1 },
    { id: 'whitePoint', name: 'White Point', type: 'number', defaultValue: 240, min: 0, max: 255, step: 1 },
    { id: 'softness', name: 'Softness', type: 'number', defaultValue: 15, min: 0, max: 100, step: 1 },
    { id: 'invert', name: 'Invert Key', type: 'boolean', defaultValue: false },
  ]},
};

for (const band of ['shadow','midtone','highlight']) {
  for (const [suffix,label,min,max] of [['Hue','Hue',0,360],['Amount','Amount',0,100],['Luma','Luminance',-100,100]] as const) {
    EFFECT_SCHEMAS['lumetri-color'].params.push({id:band+suffix,name:band+' '+label,type:'number',defaultValue:0,min,max,step:1});
  }
}

export function generateIdentityTable(samples = 32): string {
  const arr: string[] = [];
  for (let i = 0; i < samples; i++) {
    arr.push((i / (samples - 1)).toFixed(4));
  }
  return arr.join(' ');
}

/** Get the schema for an effect or generate a fallback schema */
export function getEffectSchema(effectId: string, group?: string): EffectSchema {
  if (EFFECT_SCHEMAS[effectId]) return EFFECT_SCHEMAS[effectId];

  // Category-based sensible fallback
  if (group === 'Distort') {
    return {
      params: [
        { id: 'amount', name: 'Distortion Amount', type: 'number', defaultValue: 30, min: -100, max: 100, step: 1 },
        { id: 'size', name: 'Size', type: 'number', defaultValue: 30, min: 2, max: 100, step: 1 },
      ],
    };
  }
  if (group === 'Blur & Sharpen') {
    return {
      params: [
        { id: 'blurriness', name: 'Amount', type: 'number', defaultValue: 12, min: 0, max: 150, step: 0.5, unit: 'px' },
      ],
    };
  }
  if (group === 'Color Correction') {
    return {
      params: [
        { id: 'intensity', name: 'Intensity', type: 'number', defaultValue: 50, min: 0, max: 100, step: 1, unit: '%' },
      ],
    };
  }

  return {
    params: [
      { id: 'intensity', name: 'Intensity', type: 'number', defaultValue: 100, min: 0, max: 100, step: 1, unit: '%' },
      { id: 'mix', name: 'Mix', type: 'number', defaultValue: 100, min: 0, max: 100, step: 1, unit: '%' },
    ],
  };
}

/** Create a new AppliedEffect with initial default parameters */
export function createAppliedEffect(effect: EffectDefinition): AppliedEffect {
  const schema = getEffectSchema(effect.id, effect.group);
  const initialParams: Record<string, number | boolean | string> = {};

  for (const p of schema.params) {
    initialParams[p.id] = p.defaultValue;
  }

  for (const param of schema.params) {
    const value = effect.apply?.[param.id];
    if (value !== undefined) initialParams[param.id] = value;
  }

  return {
    id: `fx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    stackOnly: true,
    effectId: effect.id,
    name: effect.label,
    category: effect.group,
    enabled: true,
    params: initialParams,
  };
}

export type ComputedEffectVisuals = {
  cssFilters: string[];
  transforms: string[];
  svgDefs: ReactNode[];
};

/** Compute SVG filters and CSS properties for an applied effect stack */
export function computeAppliedEffects(
  clipId: string,
  appliedEffects?: AppliedEffect[],
  stageH = 1080
): ComputedEffectVisuals {
  const result: ComputedEffectVisuals = {
    cssFilters: [],
    transforms: [],
    svgDefs: [],
  };

  if (!appliedEffects || appliedEffects.length === 0) {
    return result;
  }

  const hScale = stageH / 1080;

  for (const fx of appliedEffects) {
    if (!fx.enabled) continue;

    const filterId = `helios-fx-${clipId}-${fx.id}`;
    const p = fx.params;

    switch (fx.effectId) {
      case 'displacement-map': {
        const maxH = Number(p.maxHorizontal ?? p.amount ?? 15);
        const maxV = Number(p.maxVertical ?? p.amount ?? 15);
        const xChan = (p.xChannel as string) || 'R';
        const yChan = (p.yChannel as string) || 'G';
        const mapType = (p.displaceLayer as string) || 'procedural-noise';
        const expand = p.expandOutput !== false;

        const effH = maxH * hScale;
        const effV = maxV * hScale;
        const maxScale = Math.max(Math.abs(effH), Math.abs(effV), 0.001);
        const scaleH = effH / maxScale;
        const scaleV = effV / maxScale;

        const xSelector = xChan === 'L' ? 'R' : xChan;
        const ySelector = yChan === 'L' ? 'G' : yChan;

        const rOffset = 0.5 * (1 - scaleH);
        const gOffset = 0.5 * (1 - scaleV);
        const matrixValues = [
          scaleH.toFixed(4), '0', '0', '0', rOffset.toFixed(4),
          '0', scaleV.toFixed(4), '0', '0', gOffset.toFixed(4),
          '0', '0', '1', '0', '0',
          '0', '0', '0', '1', '0',
        ].join(' ');

        const filterBounds = expand
          ? { x: '-30%', y: '-30%', width: '160%', height: '160%' }
          : { x: '0%', y: '0%', width: '100%', height: '100%' };

        let mapGeneratorNode: ReactNode;
        if (mapType === 'gradient') {
          mapGeneratorNode = (
            <feTurbulence
              type="turbulence"
              baseFrequency="0.004 0.002"
              numOctaves={1}
              result="rawMap"
            />
          );
        } else if (mapType === 'radial') {
          mapGeneratorNode = (
            <feTurbulence
              type="turbulence"
              baseFrequency="0.02 0.02"
              numOctaves={2}
              result="rawMap"
            />
          );
        } else if (mapType === 'self') {
          mapGeneratorNode = (
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 1 0"
              result="rawMap"
            />
          );
        } else {
          // procedural-noise (default, rich multi-octave displacement)
          mapGeneratorNode = (
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.012 0.012"
              numOctaves={3}
              seed={2}
              result="rawMap"
            />
          );
        }

        result.svgDefs.push(
          <filter
            key={filterId}
            id={filterId}
            {...filterBounds}
            colorInterpolationFilters="sRGB"
          >
            {mapGeneratorNode}
            <feColorMatrix
              in="rawMap"
              type="matrix"
              values={matrixValues}
              result="adjustedMap"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="adjustedMap"
              scale={maxScale}
              xChannelSelector={xSelector}
              yChannelSelector={ySelector}
            />
          </filter>
        );
        result.cssFilters.push(`url(#${filterId})`);
        break;
      }

      case 'turbulent-displace': {
        const amount = Number(p.amount ?? 35) * hScale;
        const size = Math.max(2, Number(p.size ?? 25));
        const freq = (0.02 * (25 / size)).toFixed(4);
        const complexity = Math.max(1, Math.min(5, Number(p.complexity ?? 2)));
        const type = (p.displaceType as string) || 'fractalNoise';
        const seed = Math.round(Number(p.evolution ?? 0));

        result.svgDefs.push(
          <filter
            key={filterId}
            id={filterId}
            x="-25%"
            y="-25%"
            width="150%"
            height="150%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence
              type={type}
              baseFrequency={`${freq} ${freq}`}
              numOctaves={complexity}
              seed={seed}
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale={amount}
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        );
        result.cssFilters.push(`url(#${filterId})`);
        break;
      }

      case 'wave-warp': {
        const height = Number(p.waveHeight ?? 20) * hScale;
        const width = Math.max(5, Number(p.waveWidth ?? 40));
        const freqX = (1 / width).toFixed(4);
        const dir = Number(p.direction ?? 0);

        result.svgDefs.push(
          <filter
            key={filterId}
            id={filterId}
            x="-25%"
            y="-25%"
            width="150%"
            height="150%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence
              type="turbulence"
              baseFrequency={`${freqX} 0.002`}
              numOctaves={1}
              result="wave"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="wave"
              scale={height}
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        );
        result.cssFilters.push(`url(#${filterId})`);
        if (dir !== 0) {
          result.transforms.push(`rotate(${dir}deg)`);
        }
        break;
      }

      case 'bulge':
      case 'spherize':
      case 'cc-lens': {
        const amount = Number(p.amount ?? p.distortion ?? 50) * hScale;
        const radius = Number(p.radius ?? p.size ?? 80);
        const freq = (1 / (radius * 2)).toFixed(4);

        result.svgDefs.push(
          <filter key={filterId} id={filterId} x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency={`${freq} ${freq}`}
              numOctaves={1}
              result="lens"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="lens"
              scale={amount}
              xChannelSelector="R"
              yChannelSelector="B"
            />
          </filter>
        );
        result.cssFilters.push(`url(#${filterId})`);
        break;
      }

      case 'twirl': {
        const angle = Number(p.angle ?? 90);
        const scale = (angle / 10) * hScale;
        result.svgDefs.push(
          <filter key={filterId} id={filterId} x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="turbulence" baseFrequency="0.01 0.01" numOctaves={2} result="twirlMap" />
            <feDisplacementMap in="SourceGraphic" in2="twirlMap" scale={scale} xChannelSelector="G" yChannelSelector="R" />
          </filter>
        );
        result.cssFilters.push(`url(#${filterId})`);
        break;
      }

      case 'ripple': {
        const waveWidth = Math.max(5, Number(p.waveWidth ?? 30));
        const intensity = Number(p.intensity ?? 25) * hScale;
        const freq = (1 / waveWidth).toFixed(4);

        result.svgDefs.push(
          <filter key={filterId} id={filterId} x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="turbulence" baseFrequency={`${freq} ${freq}`} numOctaves={2} result="rip" />
            <feDisplacementMap in="SourceGraphic" in2="rip" scale={intensity} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        );
        result.cssFilters.push(`url(#${filterId})`);
        break;
      }

      case 'cc-slant': {
        const slant = Number(p.slant ?? 15);
        const axis = (p.axis as string) || 'horizontal';
        if (axis === 'horizontal') {
          result.transforms.push(`skewX(${slant}deg)`);
        } else {
          result.transforms.push(`skewY(${slant}deg)`);
        }
        break;
      }

      case 'mirror': {
        if (p.flipHorizontal) {
          result.transforms.push('scaleX(-1)');
        }
        break;
      }

      case 'gaussian-blur': {
        const blur = Number(p.blurriness ?? 15) * hScale;
        if (blur > 0) result.cssFilters.push(`blur(${blur}px)`);
        break;
      }

      case 'directional-blur': {
        const len = Number(p.length ?? 15) * hScale;
        const dir = Number(p.direction ?? 0);
        if (len > 0) {
          result.cssFilters.push(`blur(${len * 0.7}px)`);
          if (dir !== 0) {
            result.transforms.push(`rotate(${dir}deg)`);
          }
        }
        break;
      }

      case 'glow': {
        const rad = Number(p.glowRadius ?? 15) * hScale;
        const col = (p.glowColor as string) || '#00e5ff';
        result.cssFilters.push(`drop-shadow(0 0 ${rad}px ${col})`);
        break;
      }

      case 'curves': {
        const identity = generateIdentityTable(32);
        const rTable = (p.rTable as string) || (p.tableValues as string) || identity;
        const gTable = (p.gTable as string) || (p.tableValues as string) || identity;
        const bTable = (p.bTable as string) || (p.tableValues as string) || identity;
        const aTable = (p.aTable as string) || identity;

        result.svgDefs.push(
          <filter
            key={filterId}
            id={filterId}
            x="0%"
            y="0%"
            width="100%"
            height="100%"
            colorInterpolationFilters="sRGB"
          >
            <feComponentTransfer in="SourceGraphic">
              <feFuncR type="table" tableValues={rTable} />
              <feFuncG type="table" tableValues={gTable} />
              <feFuncB type="table" tableValues={bTable} />
              <feFuncA type="table" tableValues={aTable} />
            </feComponentTransfer>
          </filter>
        );
        result.cssFilters.push(`url(#${filterId})`);
        break;
      }

      case 'levels': {
        const inB = Math.max(0, Math.min(254, Number(p.inputBlack ?? 0))) / 255;
        const inW = Math.max(inB + 1 / 255, Math.min(255, Number(p.inputWhite ?? 255)) / 255);
        const gamma = Math.max(0.1, Number(p.gamma ?? 1.0));
        const outB = Math.max(0, Math.min(255, Number(p.outputBlack ?? 0))) / 255;
        const outW = Math.max(0, Math.min(255, Number(p.outputWhite ?? 255))) / 255;

        const tableVals: string[] = [];
        const samples = 256;
        for (let i = 0; i < samples; i++) {
          const x = i / (samples - 1);
          const u = Math.max(0, Math.min(1, (x - inB) / (inW - inB)));
          const v = Math.pow(u, 1 / gamma);
          const y = outB + v * (outW - outB);
          tableVals.push(Math.max(0, Math.min(1, y)).toFixed(4));
        }
        const tableStr = tableVals.join(' ');

        result.svgDefs.push(
          <filter
            key={filterId}
            id={filterId}
            x="0%"
            y="0%"
            width="100%"
            height="100%"
            colorInterpolationFilters="sRGB"
          >
            <feComponentTransfer in="SourceGraphic">
              <feFuncR type="table" tableValues={tableStr} />
              <feFuncG type="table" tableValues={tableStr} />
              <feFuncB type="table" tableValues={tableStr} />
            </feComponentTransfer>
          </filter>
        );
        result.cssFilters.push(`url(#${filterId})`);
        break;
      }

      case 'brightness-contrast': {
        const b = Number(p.brightness ?? 0) / 100;
        const c = Number(p.contrast ?? 0) / 100;
        const slope = Math.max(0, 1 + c);
        const intercept = 0.5 * (1 - slope) + b;

        result.svgDefs.push(
          <filter
            key={filterId}
            id={filterId}
            x="0%"
            y="0%"
            width="100%"
            height="100%"
            colorInterpolationFilters="sRGB"
          >
            <feComponentTransfer in="SourceGraphic">
              <feFuncR type="linear" slope={slope.toFixed(4)} intercept={intercept.toFixed(4)} />
              <feFuncG type="linear" slope={slope.toFixed(4)} intercept={intercept.toFixed(4)} />
              <feFuncB type="linear" slope={slope.toFixed(4)} intercept={intercept.toFixed(4)} />
            </feComponentTransfer>
          </filter>
        );
        result.cssFilters.push(`url(#${filterId})`);
        break;
      }

      case 'color-balance-hls':
      case 'hue-saturation': {
        const hue = Number(p.masterHue ?? 0);
        const sat = Math.max(0, (100 + Number(p.masterSaturation ?? 0)) / 100);
        const lightness = Number(p.masterLightness ?? 0);

        if (sat !== 1) {
          result.cssFilters.push(`saturate(${sat.toFixed(3)})`);
        }
        if (hue !== 0) {
          result.cssFilters.push(`hue-rotate(${hue}deg)`);
        }
        if (lightness !== 0) {
          result.cssFilters.push(`brightness(${(1 + lightness / 100).toFixed(3)})`);
        }
        break;
      }

      case 'lumetri-color': {
        const tables = gradeTables(p);
        result.svgDefs.push(<filter key={filterId} id={filterId} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feComponentTransfer><feFuncR type="table" tableValues={tables[0]} /><feFuncG type="table" tableValues={tables[1]} /><feFuncB type="table" tableValues={tables[2]} /></feComponentTransfer>
          <feColorMatrix type="saturate" values={String(Math.max(0,Number(p.saturation ?? 100))/100)} />
        </filter>);
        result.cssFilters.push('url(#'+filterId+')');
        break;
      }
      case '4-color-gradient': {
        const color = (key: string, fallback: string) => /^#[0-9a-f]{6}$/i.test(String(p[key])) ? String(p[key]) : fallback;
        // A bilinear four-corner field, with the source alpha preserved.
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><defs><linearGradient id="top"><stop stop-color="'+color('topLeft','#ff4040')+'"/><stop offset="1" stop-color="'+color('topRight','#ffff40')+'"/></linearGradient><linearGradient id="bottom"><stop stop-color="'+color('bottomLeft','#4040ff')+'"/><stop offset="1" stop-color="'+color('bottomRight','#40ffff')+'"/></linearGradient><linearGradient id="fade" x2="0" y2="1"><stop stop-color="white" stop-opacity="0"/><stop offset="1" stop-color="white"/></linearGradient><mask id="mask"><rect width="256" height="256" fill="url(#fade)"/></mask></defs><rect width="256" height="256" fill="url(#top)"/><rect width="256" height="256" fill="url(#bottom)" mask="url(#mask)"/></svg>';
        const mix = Math.max(0,Math.min(1,Number(p.mix ?? 100)/100));
        result.svgDefs.push(<filter key={filterId} id={filterId} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feImage href={'data:image/svg+xml,'+encodeURIComponent(svg)} preserveAspectRatio="none" result="gradient" />
          <feComposite in="gradient" in2="SourceGraphic" operator="in" result="masked" />
          <feComposite in="masked" in2="SourceGraphic" operator="arithmetic" k1={0} k2={mix} k3={1-mix} k4={0} />
        </filter>);
        result.cssFilters.push('url(#'+filterId+')'); break;
      }

      case 'tint': {
        const amt = Number(p.amount ?? 100) / 100;
        const bHex = (p.mapBlackTo as string) || '#000000';
        const wHex = (p.mapWhiteTo as string) || '#ffffff';

        const parseHex = (hex: string) => {
          const h = hex.replace('#', '');
          return {
            r: parseInt(h.substring(0, 2), 16) / 255 || 0,
            g: parseInt(h.substring(2, 4), 16) / 255 || 0,
            b: parseInt(h.substring(4, 6), 16) / 255 || 0,
          };
        };

        const black = parseHex(bHex);
        const white = parseHex(wHex);

        const slopeR = (white.r - black.r).toFixed(4);
        const interceptR = black.r.toFixed(4);
        const slopeG = (white.g - black.g).toFixed(4);
        const interceptG = black.g.toFixed(4);
        const slopeB = (white.b - black.b).toFixed(4);
        const interceptB = black.b.toFixed(4);

        result.svgDefs.push(
          <filter
            key={filterId}
            id={filterId}
            x="0%"
            y="0%"
            width="100%"
            height="100%"
            colorInterpolationFilters="sRGB"
          >
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0"
              result="lum"
            />
            <feComponentTransfer in="lum" result="tinted">
              <feFuncR type="linear" slope={slopeR} intercept={interceptR} />
              <feFuncG type="linear" slope={slopeG} intercept={interceptG} />
              <feFuncB type="linear" slope={slopeB} intercept={interceptB} />
            </feComponentTransfer>
            {amt < 1 ? (
              <feComposite in="tinted" in2="SourceGraphic" operator="arithmetic" k1={0} k2={amt} k3={1 - amt} k4={0} />
            ) : null}
          </filter>
        );
        result.cssFilters.push(`url(#${filterId})`);
        break;
      }

      case 'invert': {
        const amt = Number(p.amount ?? 100);
        result.cssFilters.push(`invert(${amt / 100})`);
        break;
      }

      case 'black-white': {
        const amt = Number(p.amount ?? 100);
        result.cssFilters.push(`grayscale(${amt / 100})`);
        break;
      }

      case 'mosaic': {
        const hb = Math.max(2, Number(p.horizontalBlocks ?? 20));
        const vb = Math.max(2, Number(p.verticalBlocks ?? 20));
        result.svgDefs.push(
          <filter key={filterId} id={filterId}>
            <feMorphology operator="dilate" radius={`${Math.max(1, 1920 / hb / 4)} ${Math.max(1, 1080 / vb / 4)}`} />
          </filter>
        );
        result.cssFilters.push(`url(#${filterId})`);
        break;
      }

      case 'keylight':
      case 'linear-color-key': {
        const hex = String(p.screenColor ?? p.keyColor ?? '#00ff00').replace('#', '');
        const kr = parseInt(hex.substring(0, 2), 16) / 255 || 0;
        const kg = parseInt(hex.substring(2, 4), 16) / 255 || 0;
        const kb = parseInt(hex.substring(4, 6), 16) / 255 || 0;
        const gain = Math.max(1, Number(p.screenGain ?? p.tolerance ?? 30)) / 30;
        const balance = Math.max(0, Number(p.screenBalance ?? p.softness ?? 10)) / 100;
        const despill = Math.max(0, Math.min(100, Number(p.despill ?? 50))) / 100;
        const isBlue = kb > kg && kb > kr;

        // Despilled image retains original alpha
        const despillMatrix = isBlue
          ? [
              '1', '0', '0', '0', '0',
              '0', '1', '0', '0', '0',
              `${(0.5 * despill).toFixed(3)}`, `${(0.5 * despill).toFixed(3)}`, `${(1 - despill).toFixed(3)}`, '0', '0',
              '0', '0', '0', '1', '0'
            ].join(' ')
          : [
              '1', '0', '0', '0', '0',
              `${(0.5 * despill).toFixed(3)}`, `${(1 - despill).toFixed(3)}`, `${(0.5 * despill).toFixed(3)}`, '0', '0',
              '0', '0', '1', '0', '0',
              '0', '0', '0', '1', '0'
            ].join(' ');

        // Matte matrix: computes alpha difference so screen color becomes transparent
        const matteMatrix = isBlue
          ? [
              '0', '0', '0', '0', '0',
              '0', '0', '0', '0', '0',
              '0', '0', '0', '0', '0',
              `${(1.5 * gain).toFixed(3)}`, `${(1.5 * gain).toFixed(3)}`, `${(-3.0 * gain).toFixed(3)}`, '0', `${(1.0 + balance).toFixed(3)}`
            ].join(' ')
          : [
              '0', '0', '0', '0', '0',
              '0', '0', '0', '0', '0',
              '0', '0', '0', '0', '0',
              `${(1.5 * gain).toFixed(3)}`, `${(-3.0 * gain).toFixed(3)}`, `${(1.5 * gain).toFixed(3)}`, '0', `${(1.0 + balance).toFixed(3)}`
            ].join(' ');

        result.svgDefs.push(
          <filter key={filterId} id={filterId} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
            <feColorMatrix in="SourceGraphic" type="matrix" values={despillMatrix} result="despilled" />
            <feColorMatrix in="SourceGraphic" type="matrix" values={matteMatrix} result="matte" />
            <feComposite in="despilled" in2="matte" operator="in" />
          </filter>
        );
        result.cssFilters.push(`url(#${filterId})`);
        break;
      }

      case 'extract': {
        const bp = Math.max(0, Math.min(255, Number(p.blackPoint ?? 25))) / 255;
        const soft = Math.max(0.01, Number(p.softness ?? 15) / 100);
        const invert = Boolean(p.invert);

        const slope = (1 / soft).toFixed(3);
        const intercept = (-bp / soft).toFixed(3);

        result.svgDefs.push(
          <filter key={filterId} id={filterId} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0"
              result="lum"
            />
            <feComponentTransfer in="lum" result="alphaMatte">
              <feFuncA type="linear" slope={invert ? `-${slope}` : slope} intercept={invert ? (1 + bp / soft).toFixed(3) : intercept} />
            </feComponentTransfer>
            <feComposite in="SourceGraphic" in2="alphaMatte" operator="in" />
          </filter>
        );
        result.cssFilters.push(`url(#${filterId})`);
        break;
      }

      default: {
        if (p.brightness && Number(p.brightness) !== 0) {
          result.cssFilters.push(`brightness(${1 + Number(p.brightness) / 100})`);
        }
        if (p.contrast && Number(p.contrast) !== 0) {
          result.cssFilters.push(`contrast(${1 + Number(p.contrast) / 100})`);
        }
        if (p.blur && Number(p.blur) > 0) {
          result.cssFilters.push(`blur(${Number(p.blur) * hScale}px)`);
        }
        if (p.saturation && Number(p.saturation) !== 100) {
          result.cssFilters.push(`saturate(${Number(p.saturation) / 100})`);
        }
        if (p.hue && Number(p.hue) !== 0) {
          result.cssFilters.push(`hue-rotate(${p.hue}deg)`);
        }
        break;
      }
    }
  }

  return result;
}
