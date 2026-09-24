// Ready-made UI screens for create_ui_screen {kind, content}: the screens the SaaS reference films
// keep showing (search, chat, dashboard, table, form, lock-screen notifications, kanban, pricing),
// built as clean HTML with the part names documented, in light or dark, in the accent and font
// given (the brand kit's by default). The AI can also write its own HTML.
import type { UiScreenSpec } from './spec';

type Theme = { bg: string; surface: string; card: string; border: string; text: string; muted: string; accent: string; font: string; dark: boolean };
type Content = Record<string, unknown>;
export type UiKind = { id: string; label: string; use: string; content: string; parts: string; build: (c: Content, t: Theme) => Pick<UiScreenSpec, 'html' | 'css' | 'width' | 'height' | 'device'> };

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const list = <T = unknown>(c: Content, key: string, fallback: T[]): T[] => (Array.isArray(c[key]) && (c[key] as T[]).length ? (c[key] as T[]) : fallback);
const text = (c: Content, key: string, fallback: string) => (typeof c[key] === 'string' && c[key] ? (c[key] as string) : fallback);

export function uiTheme(options: { theme?: 'light' | 'dark'; accent?: string; font?: string }): Theme {
  const dark = options.theme === 'dark';
  return {
    dark,
    bg: dark ? '#0f1117' : '#ffffff',
    surface: dark ? '#151821' : '#f6f7fb',
    card: dark ? '#1a1e29' : '#ffffff',
    border: dark ? '#272b38' : '#e6e8ef',
    text: dark ? '#eef0f6' : '#111827',
    muted: dark ? '#8b92a3' : '#6b7280',
    accent: options.accent ?? '#5b5bf0',
    font: options.font ?? 'Inter',
  };
}

const base = (t: Theme) => `#ui-root{font-family:'${t.font}',Inter,system-ui,sans-serif;color:${t.text};background:${t.bg}}
.card{background:${t.card};border:1px solid ${t.border};border-radius:16px}
.muted{color:${t.muted}}
.btn{display:inline-flex;align-items:center;gap:8px;background:${t.accent};color:#fff;border-radius:12px;padding:13px 22px;font-weight:700;font-size:15px}
.field{height:56px;border-radius:14px;border:1px solid ${t.border};background:${t.card};display:flex;align-items:center;padding:0 20px;color:${t.muted};font-size:17px;box-shadow:0 4px 16px #1118270a}
.pill{display:inline-block;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700}`;

const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

export const UI_KINDS: UiKind[] = [
  {
    id: 'search',
    label: 'Search / AI prompt',
    use: 'A big search or prompt field with results under it: type a query, results assemble or sweep.',
    content: '{title?, placeholder?, results?: string[], button?}',
    parts: 'search (type into it), button, result-1…result-n',
    build: (c, t) => ({
      width: 1440, height: 900,
      css: base(t),
      html: `<div style="height:100%;display:flex;flex-direction:column;align-items:center;padding-top:190px;gap:30px">
  <div style="font-size:44px;font-weight:800;letter-spacing:-0.02em">${esc(text(c, 'title', 'What do you want to know?'))}</div>
  <div style="display:flex;gap:12px;width:820px"><div data-part="search" class="field" style="flex:1;height:64px;font-size:19px">${esc(text(c, 'placeholder', 'Ask anything…'))}</div><div data-part="button" class="btn" style="height:64px;padding:0 28px">${esc(text(c, 'button', 'Search'))}</div></div>
  <div style="width:820px;display:flex;flex-direction:column;gap:12px">${list<string>(c, 'results', ['Quarterly revenue report', 'Customer churn by segment', 'Top feature requests']).map((r, i) => `<div data-part="result-${i + 1}" class="card" style="padding:18px 22px;display:flex;gap:14px;align-items:center"><div style="width:34px;height:34px;border-radius:10px;background:${t.accent}1f"></div><div style="font-weight:600;font-size:17px">${esc(r)}</div></div>`).join('')}</div>
</div>`,
    }),
  },
  {
    id: 'chat',
    label: 'Chat / assistant',
    use: 'A chat thread with an assistant: messages assemble or pop, type into the composer, the reply appears.',
    content: '{title?, messages: [{from: "user"|"ai", text}], placeholder?}',
    parts: 'msg-1…msg-n, input (type into it), send',
    build: (c, t) => ({
      width: 1440, height: 900,
      css: `${base(t)}.bubble{max-width:62%;padding:16px 20px;border-radius:18px;font-size:17px;line-height:1.45}`,
      html: `<div style="height:100%;display:flex;flex-direction:column">
  <div style="height:72px;border-bottom:1px solid ${t.border};display:flex;align-items:center;padding:0 32px;font-weight:700;font-size:18px">${esc(text(c, 'title', 'Assistant'))}</div>
  <div style="flex:1;display:flex;flex-direction:column;gap:16px;padding:32px 120px">${list<{ from?: string; text?: string }>(c, 'messages', [{ from: 'user', text: 'Summarise the launch feedback' }, { from: 'ai', text: '82% positive. Most asked-for: dark mode and faster exports.' }]).map((m, i) => `<div data-part="msg-${i + 1}" class="bubble" style="${m.from === 'user' ? `align-self:flex-end;background:${t.accent};color:#fff` : `align-self:flex-start;background:${t.surface};border:1px solid ${t.border}`}">${esc(m.text)}</div>`).join('')}</div>
  <div style="padding:24px 120px 40px;display:flex;gap:12px"><div data-part="input" class="field" style="flex:1">${esc(text(c, 'placeholder', 'Message…'))}</div><div data-part="send" class="btn" style="height:56px">Send</div></div>
</div>`,
    }),
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    use: 'A SaaS dashboard: sidebar, search, stat cards that count up, a list to sweep, a call to action.',
    content: '{app?, nav?: string[], placeholder?, stats?: [{label, value}], rows?: [{title, status?}], cta?}',
    parts: 'sidebar, nav-1…n, search, stat-1…n (each with stat-1-value… to count), chart, row-1…n, cta',
    build: (c, t) => {
      const stats = list<{ label?: string; value?: string }>(c, 'stats', [{ label: 'Revenue', value: '$12,400' }, { label: 'Active users', value: '3,210' }, { label: 'Churn', value: '2.1%' }]);
      const rows = list<{ title?: string; status?: string }>(c, 'rows', [{ title: 'Design review', status: 'On track' }, { title: 'Ship onboarding v2', status: 'At risk' }, { title: 'Q4 roadmap', status: 'On track' }]);
      const bars = [38, 52, 44, 66, 58, 74, 88];
      return {
        width: 1440, height: 900,
        css: base(t),
        html: `<div style="display:flex;height:100%">
  <aside data-part="sidebar" style="width:240px;background:${t.surface};border-right:1px solid ${t.border};padding:26px 16px;display:flex;flex-direction:column;gap:6px">
    <div style="font-weight:800;font-size:21px;margin:0 10px 22px">${esc(text(c, 'app', 'Acme'))}</div>
    ${list<string>(c, 'nav', ['Home', 'Projects', 'Reports', 'Settings']).map((n, i) => `<div data-part="nav-${i + 1}" style="padding:10px 12px;border-radius:10px;font-weight:600;${i === 0 ? `background:${t.card};box-shadow:0 1px 3px #0000000f` : `color:${t.muted}`}">${esc(n)}</div>`).join('\n    ')}
  </aside>
  <main style="flex:1;padding:36px 44px;display:flex;flex-direction:column;gap:24px">
    <div data-part="search" class="field">${esc(text(c, 'placeholder', 'Search or ask…'))}</div>
    <div style="display:grid;grid-template-columns:repeat(${stats.length},1fr);gap:18px">${stats.map((s, i) => `<div data-part="stat-${i + 1}" class="card" style="padding:22px"><div class="muted" style="font-size:14px">${esc(s.label)}</div><div data-part="stat-${i + 1}-value" style="font-size:34px;font-weight:800;margin-top:6px">${esc(s.value)}</div></div>`).join('')}</div>
    <div style="display:grid;grid-template-columns:1.3fr 1fr;gap:18px">
      <div data-part="chart" class="card" style="padding:22px;display:flex;align-items:flex-end;gap:14px;height:230px">${bars.map((b) => `<div style="flex:1;height:${b}%;border-radius:8px 8px 4px 4px;background:linear-gradient(${t.accent},${t.accent}88)"></div>`).join('')}</div>
      <div style="display:flex;flex-direction:column;gap:10px">${rows.map((r, i) => `<div data-part="row-${i + 1}" class="card" style="border-radius:12px;padding:16px 18px;display:flex;justify-content:space-between;align-items:center"><span style="font-weight:600">${esc(r.title)}</span><span class="pill" style="background:${/risk|late|block/i.test(r.status ?? '') ? '#f59e0b22;color:#b45309' : '#16a34a1f;color:#15803d'}">${esc(r.status ?? 'On track')}</span></div>`).join('')}</div>
    </div>
    <div data-part="cta" class="btn" style="align-self:flex-start">${esc(text(c, 'cta', 'Create report'))}</div>
  </main>
</div>`,
      };
    },
  },
  {
    id: 'table',
    label: 'Table / list',
    use: 'A data table: sweep the rows, select one, highlight a cell.',
    content: '{title?, columns: string[], rows: string[][]}',
    parts: 'header, row-1…row-n (cells: row-1-c1…)',
    build: (c, t) => {
      const columns = list<string>(c, 'columns', ['Customer', 'Plan', 'MRR', 'Status']);
      const rows = list<string[]>(c, 'rows', [['Northwind', 'Pro', '$1,200', 'Active'], ['Globex', 'Team', '$640', 'Trial'], ['Initech', 'Pro', '$1,450', 'Active'], ['Umbrella', 'Starter', '$90', 'Churned']]);
      const grid = `display:grid;grid-template-columns:repeat(${columns.length},1fr);gap:12px;align-items:center`;
      return {
        width: 1440, height: 900,
        css: base(t),
        html: `<div style="padding:56px 72px;display:flex;flex-direction:column;gap:14px">
  <div style="font-size:30px;font-weight:800;margin-bottom:14px">${esc(text(c, 'title', 'Customers'))}</div>
  <div data-part="header" class="muted" style="${grid};padding:0 22px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em">${columns.map((h) => `<div>${esc(h)}</div>`).join('')}</div>
  ${rows.map((r, i) => `<div data-part="row-${i + 1}" class="card" style="${grid};border-radius:12px;padding:18px 22px;font-size:16px">${r.map((cell, j) => `<div data-part="row-${i + 1}-c${j + 1}" style="${j === 0 ? 'font-weight:700' : ''}">${esc(cell)}</div>`).join('')}</div>`).join('\n  ')}
</div>`,
      };
    },
  },
  {
    id: 'form',
    label: 'Form / sign-up',
    use: 'A form: type into each field in turn, then click submit (onboarding, checkout, sign-up).',
    content: '{title?, subtitle?, fields: [{label, placeholder?}], button?}',
    parts: 'field-1…field-n (type into them), submit',
    build: (c, t) => ({
      width: 1440, height: 900,
      css: base(t),
      html: `<div style="height:100%;display:flex;align-items:center;justify-content:center;background:${t.surface}">
  <div class="card" style="width:560px;padding:44px;display:flex;flex-direction:column;gap:18px;box-shadow:0 20px 60px #1118271a">
    <div style="font-size:30px;font-weight:800">${esc(text(c, 'title', 'Create your account'))}</div>
    <div class="muted" style="margin-top:-8px">${esc(text(c, 'subtitle', 'Start your free trial in seconds.'))}</div>
    ${list<{ label?: string; placeholder?: string }>(c, 'fields', [{ label: 'Work email', placeholder: 'you@company.com' }, { label: 'Password', placeholder: '••••••••' }]).map((f, i) => `<div><div style="font-size:14px;font-weight:600;margin-bottom:8px">${esc(f.label)}</div><div data-part="field-${i + 1}" class="field" style="height:52px;font-size:16px;box-shadow:none">${esc(f.placeholder ?? '')}</div></div>`).join('\n    ')}
    <div data-part="submit" class="btn" style="justify-content:center;height:54px;margin-top:6px">${esc(text(c, 'button', 'Get started'))}</div>
  </div>
</div>`,
    }),
  },
  {
    id: 'notifications',
    label: 'Phone lock screen',
    use: 'A phone lock screen where notifications stack in (use notify-style assemble, or pop each).',
    content: '{time?, date?, items: [{app, title, body?}]}',
    parts: 'clock, note-1…note-n',
    build: (c, t) => ({
      width: 390, height: 844, device: 'phone',
      css: base({ ...t, bg: '#1a1033' }),
      html: `<div style="height:100%;background:linear-gradient(160deg,#3b2a8f,#1a1033 55%,#0c0a1c);color:#fff;display:flex;flex-direction:column;align-items:center;padding-top:96px;gap:10px">
  <div class="" style="font-size:17px;font-weight:600;opacity:.85">${esc(text(c, 'date', 'Monday, 12 May'))}</div>
  <div data-part="clock" style="font-size:84px;font-weight:700;letter-spacing:-0.02em;line-height:1">${esc(text(c, 'time', '9:41'))}</div>
  <div style="margin-top:36px;width:356px;display:flex;flex-direction:column;gap:10px">${list<{ app?: string; title?: string; body?: string }>(c, 'items', [{ app: 'Acme', title: 'Invoice paid', body: 'Northwind paid $1,200' }, { app: 'Acme', title: 'New signup', body: 'Globex started a trial' }]).map((n, i) => `<div data-part="note-${i + 1}" style="background:#ffffff26;border-radius:22px;padding:14px 16px;display:flex;gap:12px;align-items:center"><div style="width:38px;height:38px;border-radius:10px;background:${t.accent};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px">${esc(initials(n.app ?? 'A'))}</div><div style="flex:1"><div style="font-weight:700;font-size:15px">${esc(n.title)}</div><div style="font-size:14px;opacity:.8">${esc(n.body ?? '')}</div></div></div>`).join('')}</div>
</div>`,
    }),
  },
  {
    id: 'kanban',
    label: 'Kanban board',
    use: 'A board of columns and cards: drag a card to another column, highlight blockers.',
    content: '{title?, columns: [{title, cards: string[]}]}',
    parts: 'col-1…col-n, card-1-1… (column-card), drop targets are the columns',
    build: (c, t) => {
      const columns = list<{ title?: string; cards?: string[] }>(c, 'columns', [{ title: 'To do', cards: ['Pricing page copy', 'Onboarding emails'] }, { title: 'In progress', cards: ['Dark mode', 'SSO'] }, { title: 'Done', cards: ['Export to PDF'] }]);
      return {
        width: 1440, height: 900,
        css: base(t),
        html: `<div style="padding:48px 56px;display:flex;flex-direction:column;gap:26px;height:100%">
  <div style="font-size:30px;font-weight:800">${esc(text(c, 'title', 'Sprint board'))}</div>
  <div style="display:grid;grid-template-columns:repeat(${columns.length},1fr);gap:20px;flex:1">${columns.map((col, i) => `<div data-part="col-${i + 1}" style="background:${t.surface};border-radius:18px;padding:16px;display:flex;flex-direction:column;gap:12px"><div style="font-weight:700;padding:4px 6px">${esc(col.title)}</div>${(col.cards ?? []).map((card, j) => `<div data-part="card-${i + 1}-${j + 1}" class="card" style="border-radius:12px;padding:16px;font-weight:600;box-shadow:0 1px 3px #0000000d">${esc(card)}</div>`).join('')}</div>`).join('')}</div>
</div>`,
      };
    },
  },
  {
    id: 'pricing',
    label: 'Pricing',
    use: 'Pricing plans: hover-lift the recommended plan, click its button, count the price.',
    content: '{title?, plans: [{name, price, period?, features: string[], highlight?: boolean, cta?}]}',
    parts: 'plan-1…plan-n, plan-1-price… (count), plan-1-cta…',
    build: (c, t) => {
      const plans = list<{ name?: string; price?: string; period?: string; features?: string[]; highlight?: boolean; cta?: string }>(c, 'plans', [
        { name: 'Starter', price: '$0', features: ['1 project', 'Community support'] },
        { name: 'Pro', price: '$29', features: ['Unlimited projects', 'Priority support', 'Analytics'], highlight: true },
        { name: 'Team', price: '$79', features: ['Everything in Pro', 'SSO', 'Audit log'] },
      ]);
      return {
        width: 1440, height: 900,
        css: base(t),
        html: `<div style="padding:70px 90px;display:flex;flex-direction:column;align-items:center;gap:40px">
  <div style="font-size:40px;font-weight:800;letter-spacing:-0.02em">${esc(text(c, 'title', 'Simple pricing'))}</div>
  <div style="display:grid;grid-template-columns:repeat(${plans.length},1fr);gap:22px;width:100%">${plans.map((p, i) => `<div data-part="plan-${i + 1}" class="card" style="padding:30px;display:flex;flex-direction:column;gap:16px;${p.highlight ? `border:2px solid ${t.accent};box-shadow:0 20px 50px ${t.accent}26` : ''}"><div style="font-weight:700;font-size:18px">${esc(p.name)}</div><div style="display:flex;align-items:baseline;gap:6px"><div data-part="plan-${i + 1}-price" style="font-size:44px;font-weight:800">${esc(p.price)}</div><div class="muted">${esc(p.period ?? '/month')}</div></div><div style="display:flex;flex-direction:column;gap:10px">${(p.features ?? []).map((f) => `<div style="display:flex;gap:10px;align-items:center"><span style="color:${t.accent};font-weight:800">✓</span>${esc(f)}</div>`).join('')}</div><div data-part="plan-${i + 1}-cta" class="btn" style="justify-content:center;margin-top:auto;${p.highlight ? '' : `background:${t.surface};color:${t.text}`}">${esc(p.cta ?? 'Choose plan')}</div></div>`).join('')}</div>
</div>`,
      };
    },
  },
];

export const findUiKind = (id: string) => UI_KINDS.find((kind) => kind.id === id);
