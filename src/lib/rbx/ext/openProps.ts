// Open Props (open-props.style, MIT) — the design tokens as typed data, and bits built on them.
//
// Every value is the exact string from `src/props.*.css` on main (whitespace collapsed), keyed by the exact
// token name without its `--`. Three liberties, each so a value works on its own outside Open Props'
// `:where(html)` block:
//   - var() aliases are resolved (`--ease-elastic-3` → its cubic-bezier, `--font-sans` → its stack);
//   - gradients drop the empty `var(--gradient-space)` interpolation hook (Open Props sets it to
//     `in oklab` where supported; the colours are unchanged);
//   - shadows come per mode with `--shadow-color` / `--shadow-strength` substituted
//     (light: 220 3% 15% at 1 %, dark: 220 40% 2% at 25 %, as the stylesheet's @media rule does).
// Animations carry the real keyframes renamed `rbx-op-<name>` with px lengths scaled by `--u`, and the
// duration / easing / iteration the `--animation-*` shorthands declare.
//
// Bits: one per animation (entrances at 0.1 s, exits on the `--exit` clock, loops from 0.3 s), thirty
// gradient backgrounds (the field drifts on a slow paused loop) and a shadow-scale demonstration.

import {
  CARD_PROPS, N, P_ACCENT, P_ROWS, P_SPEED, P_TEXT, S, accentStyle, bit, clampN, d, esc, px, rowsOf, speedOf, textOf,
  type Bit, type BitContext, type BitOutput, type BitProp, type BitProps,
} from '../core';
import { P_DURATION, P_MODE, libraryCopy, scalePx } from './animateCss';

export type OpenPropsHue = 'gray' | 'stone' | 'red' | 'pink' | 'purple' | 'violet' | 'indigo' | 'blue' | 'cyan' | 'teal' | 'green' | 'lime' | 'yellow' | 'orange' | 'choco' | 'brown' | 'sand' | 'camo' | 'jungle';
export const OPEN_PROPS_HUES: OpenPropsHue[] = ['gray', 'stone', 'red', 'pink', 'purple', 'violet', 'indigo', 'blue', 'cyan', 'teal', 'green', 'lime', 'yellow', 'orange', 'choco', 'brown', 'sand', 'camo', 'jungle'];

export const OPEN_PROPS_EASINGS: Record<string, string> = {
  'ease-1': 'cubic-bezier(.25, 0, .5, 1)',
  'ease-2': 'cubic-bezier(.25, 0, .4, 1)',
  'ease-3': 'cubic-bezier(.25, 0, .3, 1)',
  'ease-4': 'cubic-bezier(.25, 0, .2, 1)',
  'ease-5': 'cubic-bezier(.25, 0, .1, 1)',
  'ease-in-1': 'cubic-bezier(.25, 0, 1, 1)',
  'ease-in-2': 'cubic-bezier(.50, 0, 1, 1)',
  'ease-in-3': 'cubic-bezier(.70, 0, 1, 1)',
  'ease-in-4': 'cubic-bezier(.90, 0, 1, 1)',
  'ease-in-5': 'cubic-bezier(1, 0, 1, 1)',
  'ease-out-1': 'cubic-bezier(0, 0, .75, 1)',
  'ease-out-2': 'cubic-bezier(0, 0, .50, 1)',
  'ease-out-3': 'cubic-bezier(0, 0, .3, 1)',
  'ease-out-4': 'cubic-bezier(0, 0, .1, 1)',
  'ease-out-5': 'cubic-bezier(0, 0, 0, 1)',
  'ease-in-out-1': 'cubic-bezier(.1, 0, .9, 1)',
  'ease-in-out-2': 'cubic-bezier(.3, 0, .7, 1)',
  'ease-in-out-3': 'cubic-bezier(.5, 0, .5, 1)',
  'ease-in-out-4': 'cubic-bezier(.7, 0, .3, 1)',
  'ease-in-out-5': 'cubic-bezier(.9, 0, .1, 1)',
  'ease-elastic-out-1': 'cubic-bezier(.5, .75, .75, 1.25)',
  'ease-elastic-out-2': 'cubic-bezier(.5, 1, .75, 1.25)',
  'ease-elastic-out-3': 'cubic-bezier(.5, 1.25, .75, 1.25)',
  'ease-elastic-out-4': 'cubic-bezier(.5, 1.5, .75, 1.25)',
  'ease-elastic-out-5': 'cubic-bezier(.5, 1.75, .75, 1.25)',
  'ease-elastic-in-1': 'cubic-bezier(.5, -0.25, .75, 1)',
  'ease-elastic-in-2': 'cubic-bezier(.5, -0.50, .75, 1)',
  'ease-elastic-in-3': 'cubic-bezier(.5, -0.75, .75, 1)',
  'ease-elastic-in-4': 'cubic-bezier(.5, -1.00, .75, 1)',
  'ease-elastic-in-5': 'cubic-bezier(.5, -1.25, .75, 1)',
  'ease-elastic-in-out-1': 'cubic-bezier(.5, -.1, .1, 1.5)',
  'ease-elastic-in-out-2': 'cubic-bezier(.5, -.3, .1, 1.5)',
  'ease-elastic-in-out-3': 'cubic-bezier(.5, -.5, .1, 1.5)',
  'ease-elastic-in-out-4': 'cubic-bezier(.5, -.7, .1, 1.5)',
  'ease-elastic-in-out-5': 'cubic-bezier(.5, -.9, .1, 1.5)',
  'ease-step-1': 'steps(2)',
  'ease-step-2': 'steps(3)',
  'ease-step-3': 'steps(4)',
  'ease-step-4': 'steps(7)',
  'ease-step-5': 'steps(10)',
  'ease-elastic-1': 'cubic-bezier(.5, .75, .75, 1.25)',
  'ease-elastic-2': 'cubic-bezier(.5, 1, .75, 1.25)',
  'ease-elastic-3': 'cubic-bezier(.5, 1.25, .75, 1.25)',
  'ease-elastic-4': 'cubic-bezier(.5, 1.5, .75, 1.25)',
  'ease-elastic-5': 'cubic-bezier(.5, 1.75, .75, 1.25)',
  'ease-squish-1': 'cubic-bezier(.5, -.1, .1, 1.5)',
  'ease-squish-2': 'cubic-bezier(.5, -.3, .1, 1.5)',
  'ease-squish-3': 'cubic-bezier(.5, -.5, .1, 1.5)',
  'ease-squish-4': 'cubic-bezier(.5, -.7, .1, 1.5)',
  'ease-squish-5': 'cubic-bezier(.5, -.9, .1, 1.5)',
  'ease-spring-1': 'linear(0, 0.006, 0.025 2.8%, 0.101 6.1%, 0.539 18.9%, 0.721 25.3%, 0.849 31.5%, 0.937 38.1%, 0.968 41.8%, 0.991 45.7%, 1.006 50.1%, 1.015 55%, 1.017 63.9%, 1.001)',
  'ease-spring-2': 'linear(0, 0.007, 0.029 2.2%, 0.118 4.7%, 0.625 14.4%, 0.826 19%, 0.902, 0.962, 1.008 26.1%, 1.041 28.7%, 1.064 32.1%, 1.07 36%, 1.061 40.5%, 1.015 53.4%, 0.999 61.6%, 0.995 71.2%, 1)',
  'ease-spring-3': 'linear(0, 0.009, 0.035 2.1%, 0.141 4.4%, 0.723 12.9%, 0.938 16.7%, 1.017, 1.077, 1.121, 1.149 24.3%, 1.159, 1.163, 1.161, 1.154 29.9%, 1.129 32.8%, 1.051 39.6%, 1.017 43.1%, 0.991, 0.977 51%, 0.974 53.8%, 0.975 57.1%, 0.997 69.8%, 1.003 76.9%, 1)',
  'ease-spring-4': 'linear(0, 0.009, 0.037 1.7%, 0.153 3.6%, 0.776 10.3%, 1.001, 1.142 16%, 1.185, 1.209 19%, 1.215 19.9% 20.8%, 1.199, 1.165 25%, 1.056 30.3%, 1.008 33%, 0.973, 0.955 39.2%, 0.953 41.1%, 0.957 43.3%, 0.998 53.3%, 1.009 59.1% 63.7%, 0.998 78.9%, 1)',
  'ease-spring-5': 'linear(0, 0.01, 0.04 1.6%, 0.161 3.3%, 0.816 9.4%, 1.046, 1.189 14.4%, 1.231, 1.254 17%, 1.259, 1.257 18.6%, 1.236, 1.194 22.3%, 1.057 27%, 0.999 29.4%, 0.955 32.1%, 0.942, 0.935 34.9%, 0.933, 0.939 38.4%, 1 47.3%, 1.011, 1.017 52.6%, 1.016 56.4%, 1 65.2%, 0.996 70.2%, 1.001 87.2%, 1)',
  'ease-bounce-1': 'linear(0, 0.004, 0.016, 0.035, 0.063, 0.098, 0.141, 0.191, 0.25, 0.316, 0.391 36.8%, 0.563, 0.766, 1 58.8%, 0.946, 0.908 69.1%, 0.895, 0.885, 0.879, 0.878, 0.879, 0.885, 0.895, 0.908 89.7%, 0.946, 1)',
  'ease-bounce-2': 'linear(0, 0.004, 0.016, 0.035, 0.063, 0.098, 0.141 15.1%, 0.25, 0.391, 0.562, 0.765, 1, 0.892 45.2%, 0.849, 0.815, 0.788, 0.769, 0.757, 0.753, 0.757, 0.769, 0.788, 0.815, 0.85, 0.892 75.2%, 1 80.2%, 0.973, 0.954, 0.943, 0.939, 0.943, 0.954, 0.973, 1)',
  'ease-bounce-3': 'linear(0, 0.004, 0.016, 0.035, 0.062, 0.098, 0.141 11.4%, 0.25, 0.39, 0.562, 0.764, 1 30.3%, 0.847 34.8%, 0.787, 0.737, 0.699, 0.672, 0.655, 0.65, 0.656, 0.672, 0.699, 0.738, 0.787, 0.847 61.7%, 1 66.2%, 0.946, 0.908, 0.885 74.2%, 0.879, 0.878, 0.879, 0.885 79.5%, 0.908, 0.946, 1 87.4%, 0.981, 0.968, 0.96, 0.957, 0.96, 0.968, 0.981, 1)',
  'ease-bounce-4': 'linear(0, 0.004, 0.016 3%, 0.062, 0.141, 0.25, 0.391, 0.562 18.2%, 1 24.3%, 0.81, 0.676 32.3%, 0.629, 0.595, 0.575, 0.568, 0.575, 0.595, 0.629, 0.676 48.2%, 0.811, 1 56.2%, 0.918, 0.86, 0.825, 0.814, 0.825, 0.86, 0.918, 1 77.2%, 0.94 80.6%, 0.925, 0.92, 0.925, 0.94 87.5%, 1 90.9%, 0.974, 0.965, 0.974, 1)',
  'ease-bounce-5': 'linear(0, 0.004, 0.016 2.5%, 0.063, 0.141, 0.25 10.1%, 0.562, 1 20.2%, 0.783, 0.627, 0.534 30.9%, 0.511, 0.503, 0.511, 0.534 38%, 0.627, 0.782, 1 48.7%, 0.892, 0.815, 0.769 56.3%, 0.757, 0.753, 0.757, 0.769 61.3%, 0.815, 0.892, 1 68.8%, 0.908 72.4%, 0.885, 0.878, 0.885, 0.908 79.4%, 1 83%, 0.954 85.5%, 0.943, 0.939, 0.943, 0.954 90.5%, 1 93%, 0.977, 0.97, 0.977, 1)',
  'ease-circ-in': 'cubic-bezier(.6,.04,.98,.335)',
  'ease-circ-in-out': 'cubic-bezier(.785,.135,.15,.86)',
  'ease-circ-out': 'cubic-bezier(.075,.82,.165,1)',
  'ease-cubic-in': 'cubic-bezier(.55,.055,.675,.19)',
  'ease-cubic-in-out': 'cubic-bezier(.645,.045,.355,1)',
  'ease-cubic-out': 'cubic-bezier(.215,.61,.355,1)',
  'ease-expo-in': 'cubic-bezier(.95,.05,.795,.035)',
  'ease-expo-in-out': 'cubic-bezier(1,0,0,1)',
  'ease-expo-out': 'cubic-bezier(.19,1,.22,1)',
  'ease-quad-in': 'cubic-bezier(.55,.085,.68,.53)',
  'ease-quad-in-out': 'cubic-bezier(.455,.03,.515,.955)',
  'ease-quad-out': 'cubic-bezier(.25,.46,.45,.94)',
  'ease-quart-in': 'cubic-bezier(.895,.03,.685,.22)',
  'ease-quart-in-out': 'cubic-bezier(.77,0,.175,1)',
  'ease-quart-out': 'cubic-bezier(.165,.84,.44,1)',
  'ease-quint-in': 'cubic-bezier(.755,.05,.855,.06)',
  'ease-quint-in-out': 'cubic-bezier(.86,0,.07,1)',
  'ease-quint-out': 'cubic-bezier(.23,1,.32,1)',
  'ease-sine-in': 'cubic-bezier(.47,0,.745,.715)',
  'ease-sine-in-out': 'cubic-bezier(.445,.05,.55,.95)',
  'ease-sine-out': 'cubic-bezier(.39,.575,.565,1)',
};

export const OPEN_PROPS_GRADIENTS: Record<string, string> = {
  'gradient-1': 'linear-gradient(to bottom right, #1f005c, #5b0060, #870160, #ac255e, #ca485c, #e16b5c, #f39060, #ffb56b)',
  'gradient-2': 'linear-gradient(to bottom right, #48005c, #8300e2, #a269ff)',
  'gradient-3': 'radial-gradient(circle at top right, hsl(180 100% 50%), hsl(180 100% 50% / 0%)), radial-gradient(circle at bottom left, hsl(328 100% 54%), hsl(328 100% 54% / 0%))',
  'gradient-4': 'linear-gradient(to bottom right, #00F5A0, #00D9F5)',
  'gradient-5': 'conic-gradient(from -270deg at 75% 110%, fuchsia, floralwhite)',
  'gradient-6': 'conic-gradient(from -90deg at top left, black, white)',
  'gradient-7': 'linear-gradient(to bottom right, #72C6EF, #004E8F)',
  'gradient-8': 'conic-gradient(from 90deg at 50% 0%, #111, 50%, #222, #111)',
  'gradient-9': 'conic-gradient(from .5turn at bottom center, lightblue, white)',
  'gradient-10': 'conic-gradient(from 90deg at 40% -25%, #ffd700, #f79d03, #ee6907, #e6390a, #de0d0d, #d61039, #cf1261, #c71585, #cf1261, #d61039, #de0d0d, #ee6907, #f79d03, #ffd700, #ffd700, #ffd700)',
  'gradient-11': 'conic-gradient(at bottom left, deeppink, cyan)',
  'gradient-12': 'conic-gradient(from 90deg at 25% -10%, #ff4500, #d3f340, #7bee85, #afeeee, #7bee85)',
  'gradient-13': 'radial-gradient(circle at 50% 200%, #000142, #3b0083, #b300c3, #ff059f, #ff4661, #ffad86, #fff3c7)',
  'gradient-14': 'conic-gradient(at top right, lime, cyan)',
  'gradient-15': 'linear-gradient(to bottom right, #c7d2fe, #fecaca, #fef3c7)',
  'gradient-16': 'radial-gradient(circle at 50% -250%, #374151, #111827, #000)',
  'gradient-17': 'conic-gradient(from -90deg at 50% -25%, blue, blueviolet)',
  'gradient-18': 'linear-gradient(0deg, hsla(0 100% 50% / 80%), hsla(0 100% 50% / 0) 75%), linear-gradient(60deg, hsla(60 100% 50% / 80%), hsla(60 100% 50% / 0) 75%), linear-gradient(120deg, hsla(120 100% 50% / 80%), hsla(120 100% 50% / 0) 75%), linear-gradient(180deg, hsla(180 100% 50% / 80%), hsla(180 100% 50% / 0) 75%), linear-gradient(240deg, hsla(240 100% 50% / 80%), hsla(240 100% 50% / 0) 75%), linear-gradient(300deg, hsla(300 100% 50% / 80%), hsla(300 100% 50% / 0) 75%)',
  'gradient-19': 'linear-gradient(to bottom right, #ffe259, #ffa751)',
  'gradient-20': 'conic-gradient(from -135deg at -10% center, #ffa500, #ff7715, #ff522a, #ff3f47, #ff5482, #ff69b4)',
  'gradient-21': 'conic-gradient(from -90deg at 25% 115%, #ff0000, #ff0066, #ff00cc, #cc00ff, #6600ff, #0000ff, #0000ff, #0000ff, #0000ff)',
  'gradient-22': 'linear-gradient(to bottom right, #acb6e5, #86fde8)',
  'gradient-23': 'linear-gradient(to bottom right, #536976, #292E49)',
  'gradient-24': 'conic-gradient(from .5turn at 0% 0%, #00c476, 10%, #82b0ff, 90%, #00c476)',
  'gradient-25': 'conic-gradient(at 125% 50%, #b78cf7, #ff7c94, #ffcf0d, #ff7c94, #b78cf7)',
  'gradient-26': 'linear-gradient(to bottom right, #9796f0, #fbc7d4)',
  'gradient-27': 'conic-gradient(from .5turn at bottom left, deeppink, rebeccapurple)',
  'gradient-28': 'conic-gradient(from -90deg at 50% 105%, white, orchid)',
  'gradient-29': 'radial-gradient(circle at top right, hsl(250 100% 85%), hsl(250 100% 85% / 0%)), radial-gradient(circle at bottom left, hsl(220 90% 75%), hsl(220 90% 75% / 0%))',
  'gradient-30': 'radial-gradient(circle at top right, hsl(150 100% 50%), hsl(150 100% 50% / 0%)), radial-gradient(circle at bottom left, hsl(150 100% 84%), hsl(150 100% 84% / 0%))',
};

export const OPEN_PROPS_FONTS: Record<string, string> = {
  'font-system-ui': 'system-ui, sans-serif',
  'font-transitional': 'Charter, Bitstream Charter, Sitka Text, Cambria, serif',
  'font-old-style': 'Iowan Old Style, Palatino Linotype, URW Palladio L, P052, serif',
  'font-humanist': 'Seravek, Gill Sans Nova, Ubuntu, Calibri, DejaVu Sans, source-sans-pro, sans-serif',
  'font-geometric-humanist': 'Avenir, Montserrat, Corbel, URW Gothic, source-sans-pro, sans-serif',
  'font-classical-humanist': 'Optima, Candara, Noto Sans, source-sans-pro, sans-serif',
  'font-neo-grotesque': 'Inter, Roboto, Helvetica Neue, Arial Nova, Nimbus Sans, Arial, sans-serif',
  'font-monospace-slab-serif': 'Nimbus Mono PS, Courier New, monospace',
  'font-monospace-code': 'Dank Mono,Operator Mono, Inconsolata, Fira Mono, ui-monospace, SF Mono, Monaco, Droid Sans Mono, Source Code Pro, Cascadia Code, Menlo, Consolas, DejaVu Sans Mono, monospace',
  'font-industrial': 'Bahnschrift, DIN Alternate, Franklin Gothic Medium, Nimbus Sans Narrow, sans-serif-condensed, sans-serif',
  'font-rounded-sans': 'ui-rounded, Hiragino Maru Gothic ProN, Quicksand, Comfortaa, Manjari, Arial Rounded MT, Arial Rounded MT Bold, Calibri, source-sans-pro, sans-serif',
  'font-slab-serif': 'Rockwell, Rockwell Nova, Roboto Slab, DejaVu Serif, Sitka Small, serif',
  'font-antique': 'Superclarendon, Bookman Old Style, URW Bookman, URW Bookman L, Georgia Pro, Georgia, serif',
  'font-didone': 'Didot, Bodoni MT, Noto Serif Display, URW Palladio L, P052, Sylfaen, serif',
  'font-handwritten': 'Segoe Print, Bradley Hand, Chilanka, TSCu_Comic, casual, cursive',
  'font-sans': 'system-ui, sans-serif',
  'font-serif': 'ui-serif, serif',
  'font-mono': 'Dank Mono,Operator Mono, Inconsolata, Fira Mono, ui-monospace, SF Mono, Monaco, Droid Sans Mono, Source Code Pro, Cascadia Code, Menlo, Consolas, DejaVu Sans Mono, monospace',
  'font-weight-1': '100',
  'font-weight-2': '200',
  'font-weight-3': '300',
  'font-weight-4': '400',
  'font-weight-5': '500',
  'font-weight-6': '600',
  'font-weight-7': '700',
  'font-weight-8': '800',
  'font-weight-9': '900',
  'font-lineheight-00': '.95',
  'font-lineheight-0': '1.1',
  'font-lineheight-1': '1.25',
  'font-lineheight-2': '1.375',
  'font-lineheight-3': '1.5',
  'font-lineheight-4': '1.75',
  'font-lineheight-5': '2',
  'font-letterspacing-0': '-.05em',
  'font-letterspacing-1': '.025em',
  'font-letterspacing-2': '.050em',
  'font-letterspacing-3': '.075em',
  'font-letterspacing-4': '.150em',
  'font-letterspacing-5': '.500em',
  'font-letterspacing-6': '.750em',
  'font-letterspacing-7': '1em',
  'font-size-00': '.5rem',
  'font-size-0': '.75rem',
  'font-size-1': '1rem',
  'font-size-2': '1.1rem',
  'font-size-3': '1.25rem',
  'font-size-4': '1.5rem',
  'font-size-5': '2rem',
  'font-size-6': '2.5rem',
  'font-size-7': '3rem',
  'font-size-8': '3.5rem',
  'font-size-fluid-0': 'clamp(.75rem, 2vw, 1rem)',
  'font-size-fluid-1': 'clamp(1rem, 4vw, 1.5rem)',
  'font-size-fluid-2': 'clamp(1.5rem, 6vw, 2.5rem)',
  'font-size-fluid-3': 'clamp(2rem, 9vw, 3.5rem)',
};

export const OPEN_PROPS_SIZES: Record<string, string> = {
  'size-000': '-.5rem',
  'size-00': '-.25rem',
  'size-1': '.25rem',
  'size-2': '.5rem',
  'size-3': '1rem',
  'size-4': '1.25rem',
  'size-5': '1.5rem',
  'size-6': '1.75rem',
  'size-7': '2rem',
  'size-8': '3rem',
  'size-9': '4rem',
  'size-10': '5rem',
  'size-11': '7.5rem',
  'size-12': '10rem',
  'size-13': '15rem',
  'size-14': '20rem',
  'size-15': '30rem',
  'size-px-000': '-8px',
  'size-px-00': '-4px',
  'size-px-1': '4px',
  'size-px-2': '8px',
  'size-px-3': '16px',
  'size-px-4': '20px',
  'size-px-5': '24px',
  'size-px-6': '28px',
  'size-px-7': '32px',
  'size-px-8': '48px',
  'size-px-9': '64px',
  'size-px-10': '80px',
  'size-px-11': '120px',
  'size-px-12': '160px',
  'size-px-13': '240px',
  'size-px-14': '320px',
  'size-px-15': '480px',
  'size-fluid-1': 'clamp(.5rem, 1vw, 1rem)',
  'size-fluid-2': 'clamp(1rem, 2vw, 1.5rem)',
  'size-fluid-3': 'clamp(1.5rem, 3vw, 2rem)',
  'size-fluid-4': 'clamp(2rem, 4vw, 3rem)',
  'size-fluid-5': 'clamp(4rem, 5vw, 5rem)',
  'size-fluid-6': 'clamp(5rem, 7vw, 7.5rem)',
  'size-fluid-7': 'clamp(7.5rem, 10vw, 10rem)',
  'size-fluid-8': 'clamp(10rem, 20vw, 15rem)',
  'size-fluid-9': 'clamp(15rem, 30vw, 20rem)',
  'size-fluid-10': 'clamp(20rem, 40vw, 30rem)',
  'size-content-1': '20ch',
  'size-content-2': '45ch',
  'size-content-3': '60ch',
  'size-header-1': '20ch',
  'size-header-2': '25ch',
  'size-header-3': '35ch',
  'size-xxs': '240px',
  'size-xs': '360px',
  'size-sm': '480px',
  'size-md': '768px',
  'size-lg': '1024px',
  'size-xl': '1440px',
  'size-xxl': '1920px',
  'size-relative-000': '-.5ch',
  'size-relative-00': '-.25ch',
  'size-relative-1': '.25ch',
  'size-relative-2': '.5ch',
  'size-relative-3': '1ch',
  'size-relative-4': '1.25ch',
  'size-relative-5': '1.5ch',
  'size-relative-6': '1.75ch',
  'size-relative-7': '2ch',
  'size-relative-8': '3ch',
  'size-relative-9': '4ch',
  'size-relative-10': '5ch',
  'size-relative-11': '7.5ch',
  'size-relative-12': '10ch',
  'size-relative-13': '15ch',
  'size-relative-14': '20ch',
  'size-relative-15': '30ch',
};

export const OPEN_PROPS_BORDERS: Record<string, string> = {
  'border-size-1': '1px',
  'border-size-2': '2px',
  'border-size-3': '5px',
  'border-size-4': '10px',
  'border-size-5': '25px',
  'radius-1': '2px',
  'radius-2': '5px',
  'radius-3': '1rem',
  'radius-4': '2rem',
  'radius-5': '4rem',
  'radius-6': '8rem',
  'radius-drawn-1': '255px 15px 225px 15px / 15px 225px 15px 255px',
  'radius-drawn-2': '125px 10px 20px 185px / 25px 205px 205px 25px',
  'radius-drawn-3': '15px 255px 15px 225px / 225px 15px 255px 15px',
  'radius-drawn-4': '15px 25px 155px 25px / 225px 150px 25px 115px',
  'radius-drawn-5': '250px 25px 15px 20px / 15px 80px 105px 115px',
  'radius-drawn-6': '28px 100px 20px 15px / 150px 30px 205px 225px',
  'radius-round': '1e5px',
  'radius-blob-1': '30% 70% 70% 30% / 53% 30% 70% 47%',
  'radius-blob-2': '53% 47% 34% 66% / 63% 46% 54% 37%',
  'radius-blob-3': '37% 63% 56% 44% / 49% 56% 44% 51%',
  'radius-blob-4': '63% 37% 37% 63% / 43% 37% 63% 57%',
  'radius-blob-5': '49% 51% 48% 52% / 57% 44% 56% 43%',
  'radius-conditional-1': 'clamp(0px, calc(100vw - 100%) * 1e5, var(--radius-1))',
  'radius-conditional-2': 'clamp(0px, calc(100vw - 100%) * 1e5, var(--radius-2))',
  'radius-conditional-3': 'clamp(0px, calc(100vw - 100%) * 1e5, var(--radius-3))',
  'radius-conditional-4': 'clamp(0px, calc(100vw - 100%) * 1e5, var(--radius-4))',
  'radius-conditional-5': 'clamp(0px, calc(100vw - 100%) * 1e5, var(--radius-5))',
  'radius-conditional-6': 'clamp(0px, calc(100vw - 100%) * 1e5, var(--radius-6))',
};

export const OPEN_PROPS_ASPECTS: Record<string, string> = {
  'ratio-square': '1',
  'ratio-landscape': '4/3',
  'ratio-portrait': '3/4',
  'ratio-widescreen': '16/9',
  'ratio-ultrawide': '18/5',
  'ratio-golden': '1.6180/1',
};

export const OPEN_PROPS_ZINDEX: Record<string, string> = {
  'layer-1': '1',
  'layer-2': '2',
  'layer-3': '3',
  'layer-4': '4',
  'layer-5': '5',
  'layer-important': '2147483647',
};

export const OPEN_PROPS_COLORS: Record<OpenPropsHue, string[]> = {
  gray: ['#f8f9fa', '#f1f3f5', '#e9ecef', '#dee2e6', '#ced4da', '#adb5bd', '#868e96', '#495057', '#343a40', '#212529', '#16191d', '#0d0f12', '#030507'],
  stone: ['#f8fafb', '#f2f4f6', '#ebedef', '#e0e4e5', '#d1d6d8', '#b1b6b9', '#979b9d', '#7e8282', '#666968', '#50514f', '#3a3a37', '#252521', '#121210'],
  red: ['#fff5f5', '#ffe3e3', '#ffc9c9', '#ffa8a8', '#ff8787', '#ff6b6b', '#fa5252', '#f03e3e', '#e03131', '#c92a2a', '#b02525', '#962020', '#7d1a1a'],
  pink: ['#fff0f6', '#ffdeeb', '#fcc2d7', '#faa2c1', '#f783ac', '#f06595', '#e64980', '#d6336c', '#c2255c', '#a61e4d', '#8c1941', '#731536', '#59102a'],
  purple: ['#f8f0fc', '#f3d9fa', '#eebefa', '#e599f7', '#da77f2', '#cc5de8', '#be4bdb', '#ae3ec9', '#9c36b5', '#862e9c', '#702682', '#5a1e69', '#44174f'],
  violet: ['#f3f0ff', '#e5dbff', '#d0bfff', '#b197fc', '#9775fa', '#845ef7', '#7950f2', '#7048e8', '#6741d9', '#5f3dc4', '#5235ab', '#462d91', '#3a2578'],
  indigo: ['#edf2ff', '#dbe4ff', '#bac8ff', '#91a7ff', '#748ffc', '#5c7cfa', '#4c6ef5', '#4263eb', '#3b5bdb', '#364fc7', '#2f44ad', '#283a94', '#21307a'],
  blue: ['#e7f5ff', '#d0ebff', '#a5d8ff', '#74c0fc', '#4dabf7', '#339af0', '#228be6', '#1c7ed6', '#1971c2', '#1864ab', '#145591', '#114678', '#0d375e'],
  cyan: ['#e3fafc', '#c5f6fa', '#99e9f2', '#66d9e8', '#3bc9db', '#22b8cf', '#15aabf', '#1098ad', '#0c8599', '#0b7285', '#095c6b', '#074652', '#053038'],
  teal: ['#e6fcf5', '#c3fae8', '#96f2d7', '#63e6be', '#38d9a9', '#20c997', '#12b886', '#0ca678', '#099268', '#087f5b', '#066649', '#054d37', '#033325'],
  green: ['#ebfbee', '#d3f9d8', '#b2f2bb', '#8ce99a', '#69db7c', '#51cf66', '#40c057', '#37b24d', '#2f9e44', '#2b8a3e', '#237032', '#1b5727', '#133d1b'],
  lime: ['#f4fce3', '#e9fac8', '#d8f5a2', '#c0eb75', '#a9e34b', '#94d82d', '#82c91e', '#74b816', '#66a80f', '#5c940d', '#4c7a0b', '#3c6109', '#2c4706'],
  yellow: ['#fff9db', '#fff3bf', '#ffec99', '#ffe066', '#ffd43b', '#fcc419', '#fab005', '#f59f00', '#f08c00', '#e67700', '#b35c00', '#804200', '#663500'],
  orange: ['#fff4e6', '#ffe8cc', '#ffd8a8', '#ffc078', '#ffa94d', '#ff922b', '#fd7e14', '#f76707', '#e8590c', '#d9480f', '#bf400d', '#99330b', '#802b09'],
  choco: ['#fff8dc', '#fce1bc', '#f7ca9e', '#f1b280', '#e99b62', '#df8545', '#d46e25', '#bd5f1b', '#a45117', '#8a4513', '#703a13', '#572f12', '#3d210d'],
  brown: ['#faf4eb', '#ede0d1', '#e0cab7', '#d3b79e', '#c5a285', '#b78f6d', '#a87c56', '#956b47', '#825b3a', '#6f4b2d', '#5e3a21', '#4e2b15', '#422412'],
  sand: ['#f8fafb', '#e6e4dc', '#d5cfbd', '#c2b9a0', '#aea58c', '#9a9178', '#867c65', '#736a53', '#5f5746', '#4b4639', '#38352d', '#252521', '#121210'],
  camo: ['#f9fbe7', '#e8ed9c', '#d2df4e', '#c2ce34', '#b5bb2e', '#a7a827', '#999621', '#8c851c', '#7e7416', '#6d6414', '#5d5411', '#4d460e', '#36300a'],
  jungle: ['#ecfeb0', '#def39a', '#d0e884', '#c2dd6e', '#b5d15b', '#a8c648', '#9bbb36', '#8fb024', '#84a513', '#7a9908', '#658006', '#516605', '#3d4d04'],
};

// ── shadows ──────────────────────────────────────────────────────────────────

type ShadowSet = Record<string, string>;

/** The stylesheet's shadow stacks with `--shadow-color` and the `--shadow-strength-N` steps (+2 … +9 %) substituted. */
const shadowSet = (color: string, strength: number, highlight: string): ShadowSet => {
  const a = (plus: number) => `hsl(${color} / ${strength + plus}%)`;
  const t = (plus: number) => `hsl(${color} / ${25 + plus}%)`;
  return {
    'shadow-1': `0 1px 2px -1px ${a(9)}`,
    'shadow-2': `0 3px 5px -2px ${a(3)}, 0 7px 14px -5px ${a(5)}`,
    'shadow-3': `0 -1px 3px 0 ${a(2)}, 0 1px 2px -5px ${a(2)}, 0 2px 5px -5px ${a(4)}, 0 4px 12px -5px ${a(5)}, 0 12px 15px -5px ${a(7)}`,
    'shadow-4': `0 -2px 5px 0 ${a(2)}, 0 1px 1px -2px ${a(3)}, 0 2px 2px -2px ${a(3)}, 0 5px 5px -2px ${a(4)}, 0 9px 9px -2px ${a(5)}, 0 16px 16px -2px ${a(6)}`,
    'shadow-5': `0 -1px 2px 0 ${a(2)}, 0 2px 1px -2px ${a(3)}, 0 5px 5px -2px ${a(3)}, 0 10px 10px -2px ${a(4)}, 0 20px 20px -2px ${a(5)}, 0 40px 40px -2px ${a(7)}`,
    'shadow-6': `0 -1px 2px 0 ${a(2)}, 0 3px 2px -2px ${a(3)}, 0 7px 5px -2px ${a(3)}, 0 12px 10px -2px ${a(4)}, 0 22px 18px -2px ${a(5)}, 0 41px 33px -2px ${a(6)}, 0 100px 80px -2px ${a(7)}`,
    'inner-shadow-highlight': highlight,
    'inner-shadow-0': `inset 0 0 0 1px ${a(9)}`,
    'inner-shadow-1': `inset 0 1px 2px 0 ${a(9)}, ${highlight}`,
    'inner-shadow-2': `inset 0 1px 4px 0 ${a(9)}, ${highlight}`,
    'inner-shadow-3': `inset 0 2px 8px 0 ${a(9)}, ${highlight}`,
    'inner-shadow-4': `inset 0 2px 14px 0 ${a(9)}, ${highlight}`,
    'text-shadow-1': `0 0 1px ${t(5)}`,
    'text-shadow-2': `0 0 2px ${t(10)}`,
    'text-shadow-3': `0 0 3px ${t(15)}`,
    'text-shadow-4': `0 0 5px ${t(20)}`,
    'text-shadow-5': `0 0 7px ${t(25)}`,
    'text-shadow-6': `0 0 10px ${t(30)}`,
  };
};

/** shadow-1..6, inner-shadow-0..4 (+ highlight) and text-shadow-1..6 for a light surface and for a dark one. */
export const OPEN_PROPS_SHADOWS: { light: ShadowSet; dark: ShadowSet } = {
  light: shadowSet('220 3% 15%', 1, 'inset 0 -.5px 0 0 #fff, inset 0 .5px 0 0 #0001'),
  dark: shadowSet('220 40% 2%', 25, 'inset 0 -.5px 0 0 #fff1, inset 0 .5px 0 0 #0007'),
};

// ── animations ───────────────────────────────────────────────────────────────

export type OpenPropsAnimation = {
  /** `@keyframes rbx-op-<name>{…}` — the real frames, px scaled by --u. */
  keyframes: string;
  /** The `@media (prefers-color-scheme: dark)` variant, when the stylesheet has one. */
  dark?: string;
  /** Seconds, from the `--animation-<name>` shorthand. */
  duration: number;
  /** An OPEN_PROPS_EASINGS token name, or `linear`. */
  easing: string;
  infinite: boolean;
  /** The `--animation-<name>` value as written upstream. */
  shorthand: string;
};

const kf = (name: string, body: string): string => `@keyframes rbx-op-${name}{${scalePx(body)}}`;
const anim = (name: string, body: string, duration: number, easing: string, infinite = false, dark?: string): OpenPropsAnimation => ({
  keyframes: kf(name, body), ...(dark ? { dark: kf(name, dark) } : {}), duration, easing, infinite,
  shorthand: `${name} ${duration < 1 ? String(duration).replace(/^0/, '') : duration}s ${easing === 'linear' ? 'linear' : `var(--${easing})`}${infinite ? ' infinite' : ''}`,
});

export const OPEN_PROPS_ANIMATIONS: Record<string, OpenPropsAnimation> = {
  'fade-in': anim('fade-in', 'to{opacity:1}', 0.5, 'ease-3'),
  'fade-in-bloom': anim('fade-in-bloom', '0%{opacity:0;filter:brightness(1) blur(20px)}10%{opacity:1;filter:brightness(2) blur(10px)}100%{opacity:1;filter:brightness(1) blur(0)}', 2, 'ease-3', false,
    '0%{opacity:0;filter:brightness(1) blur(20px)}10%{opacity:1;filter:brightness(0.5) blur(10px)}100%{opacity:1;filter:brightness(1) blur(0)}'),
  'fade-out': anim('fade-out', 'to{opacity:0}', 0.5, 'ease-3'),
  'fade-out-bloom': anim('fade-out-bloom', '100%{opacity:0;filter:brightness(1) blur(20px)}10%{opacity:1;filter:brightness(2) blur(10px)}0%{opacity:1;filter:brightness(1) blur(0)}', 2, 'ease-3', false,
    '100%{opacity:0;filter:brightness(1) blur(20px)}10%{opacity:1;filter:brightness(0.5) blur(10px)}0%{opacity:1;filter:brightness(1) blur(0)}'),
  'scale-up': anim('scale-up', 'to{transform:scale(1.25)}', 0.5, 'ease-3'),
  'scale-down': anim('scale-down', 'to{transform:scale(.75)}', 0.5, 'ease-3'),
  'slide-out-up': anim('slide-out-up', 'to{transform:translateY(-100%)}', 0.5, 'ease-3'),
  'slide-out-down': anim('slide-out-down', 'to{transform:translateY(100%)}', 0.5, 'ease-3'),
  'slide-out-right': anim('slide-out-right', 'to{transform:translateX(100%)}', 0.5, 'ease-3'),
  'slide-out-left': anim('slide-out-left', 'to{transform:translateX(-100%)}', 0.5, 'ease-3'),
  'slide-in-up': anim('slide-in-up', 'from{transform:translateY(100%)}', 0.5, 'ease-3'),
  'slide-in-down': anim('slide-in-down', 'from{transform:translateY(-100%)}', 0.5, 'ease-3'),
  'slide-in-right': anim('slide-in-right', 'from{transform:translateX(-100%)}', 0.5, 'ease-3'),
  'slide-in-left': anim('slide-in-left', 'from{transform:translateX(100%)}', 0.5, 'ease-3'),
  'shake-x': anim('shake-x', '0%,100%{transform:translateX(0%)}20%{transform:translateX(-5%)}40%{transform:translateX(5%)}60%{transform:translateX(-5%)}80%{transform:translateX(5%)}', 0.75, 'ease-out-5'),
  'shake-y': anim('shake-y', '0%,100%{transform:translateY(0%)}20%{transform:translateY(-5%)}40%{transform:translateY(5%)}60%{transform:translateY(-5%)}80%{transform:translateY(5%)}', 0.75, 'ease-out-5'),
  'shake-z': anim('shake-z', '0%,100%{transform:rotate(0deg)}20%{transform:rotate(-2deg)}40%{transform:rotate(2deg)}60%{transform:rotate(-2deg)}80%{transform:rotate(2deg)}', 1, 'ease-in-out-3'),
  spin: anim('spin', 'to{transform:rotate(1turn)}', 2, 'linear', true),
  ping: anim('ping', '90%,100%{transform:scale(2);opacity:0}', 5, 'ease-out-3', true),
  blink: anim('blink', '0%,100%{opacity:1}50%{opacity:.5}', 1, 'ease-out-3', true),
  float: anim('float', '50%{transform:translateY(-25%)}', 3, 'ease-in-out-3', true),
  bounce: anim('bounce', '25%{transform:translateY(-20%)}40%{transform:translateY(-3%)}0%,60%,100%{transform:translateY(0)}', 2, 'ease-squish-2', true),
  pulse: anim('pulse', '50%{transform:scale(.9,.9)}', 2, 'ease-out-3', true),
};

export const OPEN_PROPS_ANIMATION_NAMES: string[] = Object.keys(OPEN_PROPS_ANIMATIONS);

// ── helpers ──────────────────────────────────────────────────────────────────

/** Every token as a CSS custom property, or only the named ones (`ease-3`, `--gradient-7`, `red-6` …), for a graphic root. */
export function openPropsVars(selection?: string[], mode: 'dark' | 'light' = 'dark'): Record<string, string> {
  const all: Record<string, string> = {
    ...OPEN_PROPS_EASINGS, ...OPEN_PROPS_GRADIENTS, ...OPEN_PROPS_SHADOWS[mode], ...OPEN_PROPS_FONTS, ...OPEN_PROPS_SIZES, ...OPEN_PROPS_BORDERS, ...OPEN_PROPS_ASPECTS, ...OPEN_PROPS_ZINDEX,
  };
  for (const hue of OPEN_PROPS_HUES) OPEN_PROPS_COLORS[hue].forEach((hex, i) => { all[`${hue}-${i}`] = hex; });
  const names = selection ? selection.map((n) => n.replace(/^--/, '')) : Object.keys(all);
  const out: Record<string, string> = {};
  for (const n of names) if (n in all) out[`--${n}`] = all[n];
  return out;
}

/** `openPropsVars` as an inline-style fragment: `--ease-3:…;--gradient-7:…`. */
export const openPropsStyle = (selection?: string[], mode: 'dark' | 'light' = 'dark'): string =>
  Object.entries(openPropsVars(selection, mode)).map(([k, v]) => `${k}:${v}`).join(';');

export const isOpenPropsHue = (hue: unknown): hue is OpenPropsHue => typeof hue === 'string' && (OPEN_PROPS_HUES as string[]).includes(hue);

/** The 13 steps (0 lightest … 12 darkest) of a hue; unknown hues give gray. */
export const openPropsHueScale = (hue: string): string[] => [...OPEN_PROPS_COLORS[isOpenPropsHue(hue) ? hue : 'gray']];

/** A brand kit's roles picked from one hue scale: dark mode sits on steps 12/11 with light text, light mode on 0/1 with dark text. */
export function openPropsBrandTokens(hue: string, mode: 'dark' | 'light'): { bg: string; surface: string; text: string; muted: string; primary: string; accent: string; accent2: string } {
  const s = openPropsHueScale(hue);
  return mode === 'light'
    ? { bg: s[0], surface: s[1], text: s[12], muted: s[9], primary: s[7], accent: s[6], accent2: s[9] }
    : { bg: s[12], surface: s[11], text: s[0], muted: s[3], primary: s[6], accent: s[5], accent2: s[3] };
}

const isTimingFunction = (e: string): boolean =>
  /^(linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end)$/.test(e) || /^(cubic-bezier|steps|linear)\([^;{}<>"]*\)$/.test(e);

/** An Open Props easing token (`ease-spring-3`, with or without `--`) or a raw CSS timing function, as a CSS value; anything else is `ease`. */
export const openPropsEasing = (token: string): string => {
  const e = token.trim().replace(/^--/, '');
  if (e in OPEN_PROPS_EASINGS) return OPEN_PROPS_EASINGS[e];
  return isTimingFunction(e) ? e : 'ease';
};

/** The `easing` prop resolved, falling back to the token the animation ships with. */
const easingOf = (p: BitProps, fallback: string): string => {
  const e = S(p, 'easing').trim().replace(/^--/, '');
  return e && (e in OPEN_PROPS_EASINGS || isTimingFunction(e)) ? openPropsEasing(e) : openPropsEasing(fallback);
};

// ── animation bits ───────────────────────────────────────────────────────────

type OpKind = 'entrance' | 'exit' | 'once' | 'loop';

const OP_KIND: Record<string, OpKind> = {
  'fade-in': 'entrance', 'fade-in-bloom': 'entrance', 'slide-in-up': 'entrance', 'slide-in-down': 'entrance', 'slide-in-right': 'entrance', 'slide-in-left': 'entrance',
  'fade-out': 'exit', 'fade-out-bloom': 'exit', 'slide-out-up': 'exit', 'slide-out-down': 'exit', 'slide-out-right': 'exit', 'slide-out-left': 'exit',
  'scale-up': 'once', 'scale-down': 'once', 'shake-x': 'once', 'shake-y': 'once', 'shake-z': 'once',
  spin: 'loop', ping: 'loop', blink: 'loop', float: 'loop', bounce: 'loop', pulse: 'loop',
};

export const OPEN_PROPS_EXITS: string[] = OPEN_PROPS_ANIMATION_NAMES.filter((n) => OP_KIND[n] === 'exit');

const OP_ABOUT: Record<string, string> = {
  'fade-in': 'Opacity to 1 over .5 s on ease-3 (the element starts transparent).',
  'fade-in-bloom': 'Resolves from a 20 px blur at double brightness to sharp and normal over 2 s — a bloom of light (half brightness in dark mode).',
  'fade-out': 'Opacity to 0 over .5 s on ease-3.',
  'fade-out-bloom': 'Flares to double brightness with a 10 px blur, then dissolves into a 20 px blur over 2 s.',
  'scale-up': 'Grows to 125% over .5 s and stays there.',
  'scale-down': 'Shrinks to 75% over .5 s and stays there.',
  'slide-out-up': 'Translates up by its own height over .5 s.',
  'slide-out-down': 'Translates down by its own height over .5 s.',
  'slide-out-right': 'Translates right by its own width over .5 s.',
  'slide-out-left': 'Translates left by its own width over .5 s.',
  'slide-in-up': 'Arrives from one height below over .5 s on ease-3.',
  'slide-in-down': 'Arrives from one height above over .5 s on ease-3.',
  'slide-in-right': 'Arrives travelling rightward from one width to the left over .5 s.',
  'slide-in-left': 'Arrives travelling leftward from one width to the right over .5 s.',
  'shake-x': 'Four horizontal jolts of ±5% over .75 s on ease-out-5.',
  'shake-y': 'Four vertical jolts of ±5% over .75 s on ease-out-5.',
  'shake-z': 'Four rotations of ±2° over 1 s on ease-in-out-3.',
  spin: 'One full turn every 2 s, linear, forever.',
  ping: 'Scales to 200% while fading to nothing, resting for the last 10% of a 5 s cycle — a sonar ping.',
  blink: 'Dims to 50% and back every second on ease-out-3.',
  float: 'Rises 25% of its height and settles every 3 s, ease-in-out-3.',
  bounce: 'Hops 20% then 3% and rests for the second half of each 2 s cycle on the squish easing.',
  pulse: 'Squeezes to 90% and back every 2 s on ease-out-3.',
};

const OP_USE: Record<OpKind, string> = {
  entrance: 'Understated, product-grade entrances for cards, captions and UI-flavoured graphics.',
  exit: 'Matching exits for the Open Props entrances; ends with the clip or the layer\'s `until`.',
  once: 'A single emphasis beat on a card already on screen: a wrong answer, a nudge, a zoom of attention.',
  loop: 'Ambient life on a card or badge: live indicators, loaders, "breathing" CTAs, floating stickers.',
};

const OP_VIDEO: Record<OpKind, (name: string, a: OpenPropsAnimation) => string> = {
  entrance: (name, a) => `The card or hero text plays the real ${name} keyframes as a paused entrance from 0.1 s over ${a.duration} s on ${a.easing}, then holds; \`exit\` adds an Open Props exit at the end.`,
  exit: (name, a) => `The copy fades on in 0.35 s and holds, then the real ${name} keyframes play over the final ${a.duration} s so the exit ends exactly with the clip.`,
  once: (name, a) => `The copy fades on, then ${name} plays once from 0.45 s over ${a.duration} s on ${a.easing} and holds its end state; optional Open Props exit.`,
  loop: (name, a) => `The copy fades on, then ${name} loops from 0.3 s with a ${a.duration} s period on ${a.easing}, scrubbed by --elapsed; optional Open Props exit.`,
};

const OP_CSS = '.rbx .opx{animation-fill-mode:both;animation-play-state:paused}.rbx .oppingwrap{position:relative}.rbx .opping{position:absolute;inset:0;border-radius:calc(24px * var(--u));border:calc(3px * var(--u)) solid var(--accent);opacity:.8;pointer-events:none}.rbx .opspinner{display:inline-block;width:calc(64px * var(--u));height:calc(64px * var(--u));border-radius:50%;border:calc(6px * var(--u)) solid var(--line);border-top-color:var(--accent)}';

const P_EASING: BitProp = { name: 'easing', type: 'string', about: 'An Open Props easing token (ease-3, ease-spring-3, ease-bounce-2, ease-elastic-out-4 …) or a raw CSS timing function. Defaults to the token the animation ships with.' };
const P_OP_EXIT: BitProp = { name: 'exit', type: 'enum', values: OPEN_PROPS_EXITS, about: 'An Open Props exit (fade-out, fade-out-bloom, slide-out-up …) played over the clip\'s last moments.' };

/** The keyframes a graphic needs for one animation, picking the dark variant when the theme is not light. */
const opKeyframes = (name: string, ctx: BitContext): string => {
  const a = OPEN_PROPS_ANIMATIONS[name];
  return a.dark && ctx.theme.name !== 'light' ? a.dark : a.keyframes;
};

/** Inline animation declarations for one Open Props animation on a `.a` or `.loop` element. */
const opStyle = (name: string, dur: number, easing: string): string => `animation-name:rbx-op-${name};animation-duration:${dur.toFixed(2)}s;animation-timing-function:${easing}`;

function opPlay(name: string, kind: OpKind, p: BitProps, ctx: BitContext): BitOutput {
  const a = OPEN_PROPS_ANIMATIONS[name];
  const dur = clampN(N(p, 'duration', a.duration), 0.2, 12);
  const easing = easingOf(p, a.easing);
  const inner = libraryCopy(p, ctx);
  const css: string[] = [OP_CSS, opKeyframes(name, ctx)];
  let body: string;
  if (kind === 'entrance') {
    body = `<div class="a" style="${d(0.1)};${opStyle(name, dur, easing)}${name === 'fade-in' ? ';opacity:0' : ''}">${inner}</div>`;
  } else if (kind === 'once') {
    body = `<div class="a fade" style="${d(0.05)};animation-duration:.3s"><div class="a" style="${d(0.45)};${opStyle(name, dur, easing)}">${inner}</div></div>`;
  } else if (kind === 'loop') {
    if (name === 'ping') body = `<div class="a fade oppingwrap" style="${d(0.05)};animation-duration:.3s"><i class="opping loop" style="${d(0.3)};${opStyle(name, dur, easing)}"></i>${inner}</div>`;
    else if (name === 'spin') body = `<div class="a fade col" style="align-items:center;gap:${px(28)};${d(0.05)};animation-duration:.3s"><i class="opspinner loop" style="${d(0.3)};${opStyle(name, dur, easing)}"></i>${inner}</div>`;
    else body = `<div class="a fade" style="${d(0.05)};animation-duration:.3s"><div class="loop" style="${d(0.3)};${opStyle(name, dur, easing)}">${inner}</div></div>`;
  } else {
    body = `<div class="a fade" style="${d(0.05)};animation-duration:.35s">${inner}</div>`;
  }
  const exitName = kind === 'exit' ? name : OPEN_PROPS_EXITS.includes(S(p, 'exit')) ? S(p, 'exit') : '';
  if (exitName) {
    const ea = OPEN_PROPS_ANIMATIONS[exitName];
    const ed = kind === 'exit' ? dur : ea.duration;
    const ee = kind === 'exit' ? easing : openPropsEasing(ea.easing);
    if (exitName !== name) css.push(opKeyframes(exitName, ctx));
    return { html: `<div class="opx" style="${accentStyle(p)}${opStyle(exitName, ed, ee)};animation-delay:calc(var(--exit) + .3s - ${ed.toFixed(2)}s)">${body}</div>`, css: css.join('') };
  }
  return { html: `<div class="x" style="${accentStyle(p)}">${body}</div>`, css: css.join('') };
}

const opTitle = (name: string): string => name.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

const animationBits: Bit[] = OPEN_PROPS_ANIMATION_NAMES.map((name) => {
  const kind = OP_KIND[name] ?? 'once';
  const a = OPEN_PROPS_ANIMATIONS[name];
  const pairedExit = kind === 'entrance' ? name.replace('-in', '-out') : '';
  return bit({
    id: `op-${name}`, name: opTitle(name), category: 'animation', level: kind === 'loop' || name.endsWith('bloom') ? 'intermediate' : 'basic', source: 'open-props',
    about: `Open Props --animation-${name}: ${OP_ABOUT[name] ?? a.shorthand}`,
    video: OP_VIDEO[kind](name, a),
    use: OP_USE[kind],
    props: [...CARD_PROPS, P_MODE, P_DURATION, P_EASING, ...(kind === 'exit' ? [] : [P_OP_EXIT])],
    example: { text: opTitle(name), kicker: 'OPEN PROPS', ...(pairedExit && OPEN_PROPS_EXITS.includes(pairedExit) ? { exit: pairedExit } : {}) },
    seconds: kind === 'loop' ? 4 : 3.5,
    tags: ['open-props', 'animation', kind, ...(kind === 'loop' ? ['loop'] : [])],
    build: (p, ctx) => opPlay(name, kind, p, ctx),
  });
});

// ── gradient backgrounds ─────────────────────────────────────────────────────

const GRADIENT_ABOUT: string[] = [
  'a sunset ramp from deep indigo through magenta and coral to peach (linear, to bottom right)',
  'deep purple to electric violet to lilac (linear)',
  'a cyan glow at the top-right over a hot-pink glow at the bottom-left (two radials)',
  'mint to aqua (linear)',
  'fuchsia to floral white (conic from the bottom-right)',
  'black to white (conic from the top-left)',
  'sky blue to deep navy (linear)',
  'near-black charcoal ridges, #111 to #222 (conic from the top)',
  'light blue to white (conic from the bottom centre)',
  'a gold, orange, red, magenta rainbow fan mirrored back to gold (conic from above)',
  'deep pink to cyan (conic from the bottom-left)',
  'orange-red, lime, mint and pale turquoise (conic from above)',
  'midnight blue through violet, magenta and coral to cream (radial from far below)',
  'lime to cyan (conic from the top-right)',
  'lavender, blush and cream pastels (linear)',
  'slate grey to near-black (radial from far above)',
  'blue to blue-violet (conic from above)',
  'six translucent hue beams at 0°–300° crossing into a prism (six linears)',
  'yellow to orange (linear)',
  'orange through red to hot pink (conic from the left)',
  'a red, magenta, violet, blue spectrum settling into blue (conic from the bottom-left)',
  'periwinkle to aquamarine (linear)',
  'steel blue to dark navy (linear)',
  'green and periwinkle sweeping back to green (conic from the top-left)',
  'lilac, salmon and gold mirrored (conic from the right)',
  'lavender to pink (linear)',
  'deep pink to rebecca purple (conic from the bottom-left)',
  'white to orchid (conic from below)',
  'a lilac glow at the top-right over a periwinkle glow at the bottom-left (two radials)',
  'a spring-green glow at the top-right over mint at the bottom-left (two radials)',
];

const DARK_GRADIENTS = new Set([8, 16, 23]);
const LIGHT_GRADIENTS = new Set([9, 15, 22, 26, 28, 29, 30]);

const gradientUse = (n: number): string =>
  DARK_GRADIENTS.has(n) ? 'Dark, quiet fields for copy-heavy cards, lower-thirds and end screens.'
    : LIGHT_GRADIENTS.has(n) ? 'Light, airy fields; pair with the light theme so text stays dark.'
      : 'Vivid colour fields for hooks, idents, section titles and chapter cards.';

const GRAD_CSS = '.rbx .opgrad{background-size:160% 160%;animation-name:rbx-opgrad;animation-timing-function:ease-in-out;animation-direction:alternate}@keyframes rbx-opgrad{from{background-position:0% 0%}to{background-position:100% 100%}}';

const P_DIM: BitProp = { name: 'dim', type: 'number', default: 0, about: '0–0.8: darken the field so copy on top stays readable.' };
const P_DRIFT: BitProp = { name: 'drift', type: 'number', default: 1, about: '0–2: how far the field wanders (0 holds still).' };

const gradientBits: Bit[] = Array.from({ length: 30 }, (_, i) => {
  const n = i + 1;
  const token = `gradient-${n}`;
  return bit({
    id: `op-${token}`, name: `Gradient ${n}`, category: 'background', level: 'basic', source: 'open-props',
    about: `Open Props --${token}: ${GRADIENT_ABOUT[i]}.`,
    video: 'The gradient fills the frame at 160% size and its position drifts diagonally on a slow paused loop (alternating), so the field breathes without a hue cycle; `dim` lays a dark veil over it for copy.',
    use: gradientUse(n),
    props: [P_SPEED, P_DIM, P_DRIFT, P_ACCENT], example: { dim: 0.15 }, seconds: 8, layout: 'fullscreen', tags: ['open-props', 'background', 'gradient', 'loop'],
    build: (p) => {
      const dim = clampN(N(p, 'dim', 0), 0, 0.8);
      const drift = clampN(N(p, 'drift', 1), 0, 2);
      const size = `${(100 + 60 * drift).toFixed(0)}%`;
      return {
        html: `<div class="fill" style="${accentStyle(p)}"><div class="fill loop opgrad" style="background:${OPEN_PROPS_GRADIENTS[token]};background-size:${size} ${size};animation-duration:${(24 / speedOf(p)).toFixed(1)}s"></div>${dim > 0 ? `<div class="fill" style="background:#000;opacity:${dim.toFixed(2)}"></div>` : ''}</div>`,
        css: GRAD_CSS,
        box: { x: 0, y: 0, width: 1, height: 1 },
      };
    },
  });
});

// ── shadow card ──────────────────────────────────────────────────────────────

const P_SURFACE: BitProp = { name: 'surface', type: 'enum', values: ['dark', 'light'], about: 'Which Open Props shadow set and surface to show. Defaults to light on the light theme, dark otherwise.' };
const P_HUE: BitProp = { name: 'hue', type: 'enum', values: OPEN_PROPS_HUES, default: 'gray', about: 'Open Props hue for the surface and cards (gray, stone, sand, blue …).' };

const shadowCard: Bit = bit({
  id: 'op-shadow-card', name: 'Shadow Card', category: 'component', level: 'basic', source: 'open-props',
  about: 'Open Props\' six elevation shadows (--shadow-1 … --shadow-6): layered stacks of soft hsl shadows that grow from a 2 px hairline to a 100 px plume, tuned separately for light and dark surfaces.',
  video: 'Six cards step up in elevation left to right on a surface panel, each rising in with a stagger and carrying its token name; the shadows are the exact Open Props stacks (per surface mode) with every length scaled by --u.',
  use: 'Design-system explainers, UI walkthroughs, "why depth matters" moments, product-card comparisons.',
  props: [P_TEXT, { ...P_ROWS, about: 'Labels for the six cards. Defaults to the token names.' }, P_SURFACE, P_HUE, P_ACCENT],
  example: { text: 'Six elevations', rows: ['Flat', 'Raised', 'Card', 'Floating', 'Modal', 'Hero'], surface: 'dark', hue: 'stone' }, seconds: 5, layout: 'fullscreen', tags: ['open-props', 'shadow', 'design-system', 'cards'],
  build: (p, ctx) => {
    const mode: 'dark' | 'light' = S(p, 'surface') === 'light' || (S(p, 'surface') !== 'dark' && ctx.theme.name === 'light') ? 'light' : 'dark';
    const scale = openPropsHueScale(S(p, 'hue', 'gray'));
    const panel = mode === 'light' ? scale[1] : scale[10];
    const face = mode === 'light' ? scale[0] : scale[8];
    const ink = mode === 'light' ? scale[9] : scale[1];
    const labels = rowsOf(p, ctx, []).slice(0, 6);
    const shadows = OPEN_PROPS_SHADOWS[mode];
    const cards = Array.from({ length: 6 }, (_, i) => {
      const token = `shadow-${i + 1}`;
      return `<div class="a rise opshcard" style="${d(0.25 + i * 0.12)};background:${face};color:${ink};box-shadow:${scalePx(shadows[token])}"><div class="body" style="font-weight:600">${esc(labels[i] ?? token)}</div><div class="small mono" style="margin-top:${px(8)};color:${ink};opacity:.7">--${token}</div></div>`;
    }).join('');
    return {
      html: `<div class="x fill center" style="${accentStyle(p)}"><div class="col a pop" style="${d(0.05)};align-items:center;gap:${px(36)};padding:${px(56)} ${px(64)};border-radius:${px(28)};background:${panel};color:${ink}"><div class="heading" style="color:${ink}">${esc(textOf(p, ctx, 'Six elevations'))}</div><div class="row" style="gap:${px(28)};align-items:flex-end">${cards}</div></div></div>`,
      css: `.rbx .opshcard{display:flex;flex-direction:column;justify-content:flex-end;width:${px(210)};height:${px(250)};padding:${px(22)};border-radius:${px(16)}}`,
      box: { x: 0.08, y: 0.18, width: 0.84, height: 0.64 },
    };
  },
});

/** 23 animations, 30 gradient backgrounds and the shadow scale. */
export const OPEN_PROPS_BITS: Bit[] = [...animationBits, ...gradientBits, shadowCard];
