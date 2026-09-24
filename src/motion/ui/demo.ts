// A SaaS dashboard used by the Motion Lab and the tests: typing into search, a counting stat,
// a row sweep, a click with a tooltip, and a push into a card.
import type { UiScreenSpec } from './spec';

const rows = ['Design review', 'Ship onboarding v2', 'Q4 roadmap'];

export const DEMO_UI: UiScreenSpec = {
  url: 'app.workly.com',
  html: `
<div style="display:flex;height:100%">
  <aside data-part="sidebar" style="width:240px;background:#f6f7fb;border-right:1px solid #e6e8ef;padding:24px 16px;display:flex;flex-direction:column;gap:8px">
    <div style="font:800 20px Inter;color:#111827;margin-bottom:18px">Workly</div>
    <div data-part="nav-home" style="padding:10px 12px;border-radius:10px;background:#fff;box-shadow:0 1px 2px #0001;font-weight:600">Home</div>
    <div data-part="nav-inbox" style="padding:10px 12px;border-radius:10px;color:#5d6472">Inbox</div>
    <div data-part="nav-reports" style="padding:10px 12px;border-radius:10px;color:#5d6472">Reports</div>
  </aside>
  <main style="flex:1;padding:40px 48px;display:flex;flex-direction:column;gap:28px">
    <div data-part="search" style="height:56px;border-radius:14px;border:1px solid #e1e4ec;background:#fff;display:flex;align-items:center;padding:0 20px;box-shadow:0 4px 16px #1118270a;color:#9aa1ad;font-size:17px">Ask Workly anything…</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px">
      <div data-part="card-1" style="background:#fff;border:1px solid #e6e8ef;border-radius:16px;padding:22px"><div style="color:#6b7280;font-size:14px">Revenue</div><div data-part="revenue" style="font:800 34px Inter;color:#111827;margin-top:6px">$12,400</div></div>
      <div data-part="card-2" style="background:#fff;border:1px solid #e6e8ef;border-radius:16px;padding:22px"><div style="color:#6b7280;font-size:14px">Tasks done</div><div style="font:800 34px Inter;color:#111827;margin-top:6px">342</div></div>
      <div data-part="card-3" style="background:#fff;border:1px solid #e6e8ef;border-radius:16px;padding:22px"><div style="color:#6b7280;font-size:14px">Team</div><div style="font:800 34px Inter;color:#111827;margin-top:6px">18</div></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${rows.map((t, i) => `<div data-part="row-${i + 1}" style="background:#fff;border:1px solid #e6e8ef;border-radius:12px;padding:16px 18px;display:flex;justify-content:space-between"><span style="font-weight:600">${t}</span><span style="color:#16a34a;font-weight:600">On track</span></div>`).join('\n      ')}
    </div>
    <button data-part="cta" style="align-self:flex-start;background:#5b5bf0;color:#fff;border:0;border-radius:12px;padding:14px 22px;font:700 15px Inter">Create report</button>
  </main>
</div>`,
  actions: [
    { t: 0.8, type: 'type', target: 'search', text: 'Summarise this week' },
    { t: 2.2, type: 'count', target: 'revenue', to: 48250, duration: 1.2 },
    { t: 2.6, type: 'sweep', targets: ['row-1', 'row-2', 'row-3'], every: 0.35 },
    { t: 3.9, type: 'click', target: 'cta' },
    { t: 4.1, type: 'tooltip', target: 'cta', text: 'Report ready' },
    { t: 4.6, type: 'zoom', target: 'card-1', zoom: 2 },
    { t: 5.8, type: 'zoom' },
  ],
};
