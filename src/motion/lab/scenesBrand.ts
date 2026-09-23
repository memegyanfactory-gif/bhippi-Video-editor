// Lab scenes for brand kits (dev-only harness): every brand-* template in two very different kits,
// and a house template before and after it is put in a brand.
import { newBrandKit } from '../../lib/brandKit/build';
import { motionBrandFromKit } from '../../lib/brandKit/motionBrand';
import { findTemplate } from '../kit';
import { buildInBrand } from '../kit/brandify';
import type { MotionScene } from '../types';

const land = { width: 1280, height: 720 };
const port = { width: 1080, height: 1920 };

const saas = motionBrandFromKit(newBrandKit({ style: 'tech-gradient', brandName: 'Flowbase', tagline: 'Automations for every team', primary: '#2563eb', accent: '#22d3ee', background: '#0b1020', text: '#f8fafc', displayFont: 'Inter', bodyFont: 'Segoe UI' }));
const paper = motionBrandFromKit(newBrandKit({ style: 'minimal-mono', brandName: 'Paper', tagline: 'Write less, say more', primary: '#111827', accent: '#16a34a', background: '#f7f7f5', text: '#111111', displayFont: 'Georgia', bodyFont: 'Segoe UI' }));

const build = (id: string, ctx: { width: number; height: number }, params: Record<string, unknown>, brand: typeof saas | null) => () => {
  const spec = findTemplate(id);
  if (!spec) throw new Error(`no template ${id}`);
  return buildInBrand(spec, ctx, params, brand);
};

const copy = {
  title: { title: 'Ship faster with Flowbase', kicker: 'INTRODUCING', subtitle: 'Automations for every team', accentWord: 'faster' },
  lower: { name: 'Ada Lovelace', role: 'Founder, Flowbase' },
  stat: { value: 87, suffix: '%', label: 'less busywork every week' },
  panel: { title: 'Why teams switch', points: ['No code, no waiting', 'Works with 400 apps', 'Audit trail built in'] },
  sting: {},
  end: { headline: 'Start free today', cta: 'flowbase.io', accentWord: 'free' },
  wipe: {},
};

export const BRAND_LAB_SCENES: Record<string, () => MotionScene> = {
  'brand-title-saas': build('brand-title', land, copy.title, saas),
  'brand-lower-saas': build('brand-lower-third', land, copy.lower, saas),
  'brand-stat-saas': build('brand-stat', land, copy.stat, saas),
  'brand-panel-saas': build('brand-panel', land, copy.panel, saas),
  'brand-sting-saas': build('brand-logo-sting', land, copy.sting, saas),
  'brand-end-saas': build('brand-end-card', land, copy.end, saas),
  'brand-wipe-saas': build('brand-transition', land, copy.wipe, saas),
  'brand-title-paper': build('brand-title', land, { ...copy.title, title: 'Write less, say more', accentWord: 'more' }, paper),
  'brand-stat-paper': build('brand-stat', land, copy.stat, paper),
  'brand-end-paper': build('brand-end-card', land, copy.end, paper),
  'brand-title-saas-tall': build('brand-title', port, copy.title, saas),
  'brand-lower-saas-tall': build('brand-lower-third', port, copy.lower, saas),
  'house-ribbon': build('ribbon-title', land, { title: 'Ship faster' }, null),
  'house-ribbon-saas': build('ribbon-title', land, { title: 'Ship faster' }, saas),
  'house-ribbon-paper': build('ribbon-title', land, { title: 'Ship faster' }, paper),
  'house-lanes-saas': build('numbered-lanes', land, {}, saas),
};
