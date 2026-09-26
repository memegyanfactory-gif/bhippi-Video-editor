// The legal documents Settings › Privacy & legal shows: privacy policy, terms, refunds and the
// open-source notices. Kept in the app so they read offline and always match this build. When the
// data Bhippi sends changes (src-tauri/src/license.rs, updater.rs), these pages change with it.

export const LEGAL = {
  owner: 'Aayush Datta',
  product: 'Bhippi Video Editor',
  email: 'support@bhippi.com',
  website: 'bhippi.com',
  country: 'India',
  /** Postal address for notices. Empty until published; the documents then point to the email. */
  address: '',
  effective: '26 September 2026',
};

export type LegalBlock = { h?: string; p?: string; list?: string[] };
export type LegalDoc = { id: string; title: string; summary: string; blocks: LegalBlock[] };

const contact = LEGAL.address ? `${LEGAL.email}, or by post to ${LEGAL.address}` : `${LEGAL.email}`;

const PRIVACY: LegalDoc = {
  id: 'privacy',
  title: 'Privacy Policy',
  summary: 'What Bhippi collects, why, who else sees it, how long it is kept and your rights.',
  blocks: [
    { p: `This policy explains how ${LEGAL.owner} ("we", "us"), the maker of ${LEGAL.product} ("Bhippi"), handles personal data. Bhippi is a desktop app: your projects, footage and edits stay on your computer. We only collect what we need to sell you a license and keep it working.` },
    { h: 'What we collect' },
    { list: [
      'Your Google account: email address, name and profile picture, when you sign in with Google. We ask Google for nothing else — no contacts, no Drive, no YouTube.',
      'Your license: the key, its type, when it was activated and whether it is active.',
      'Your PCs: for each PC using a license slot — a device ID (a one-way hash of the operating system\'s machine ID, which cannot be turned back into it), the computer\'s name, the Windows version, the Bhippi version and when it last checked in. This is how a key works on two PCs and no more.',
      'Your IP address: our server sees it with every request (sign-in, license check, update check). We use it to keep the service secure and to stop abuse.',
      'Purchase records: what you bought, when, and the amount. Card and bank details go to our payment partner and never reach us.',
      'Messages you send us: if you email support, we keep that conversation.',
      'Crash reports and feedback, only when you press Send: what you wrote, your rating, the errors Bhippi caught, the newest part of its logs (with your home-folder paths and anything shaped like a key or token masked), the size and settings of the open project (not its names or files), your graphics card and, if you leave it ticked, a compressed screenshot of the Bhippi window. We use them only to fix problems and improve Bhippi.',
    ] },
    { h: 'What we do not collect' },
    { list: [
      'Your videos, audio, images, projects, captions, transcripts or exports.',
      'Your chats with Bhippi AI, its memory, or your brand kits.',
      'Your AI provider keys — they stay in your computer\'s credential store.',
      'Analytics, usage tracking or advertising IDs. Bhippi has none of these, and never sends a crash report or feedback on its own.',
    ] },
    { h: 'Why we use it (legal basis)' },
    { list: [
      'To provide the license you bought: sign-in, activation, PC slots, updates (performance of a contract).',
      'To prevent fraud, key sharing and attacks on our service (legitimate interests).',
      'To keep purchase records required by tax and accounting law (legal obligation).',
      'To answer you when you write to us (your consent, by contacting us).',
      'To fix the problems in crash reports and act on feedback you send (your consent, by pressing Send).',
    ] },
    { p: 'We do not sell or rent personal data, do not use it for advertising and do not use it to train AI models.' },
    { h: 'What happens on your computer' },
    { p: 'Bhippi talks to other services directly from your PC only when you use a feature that needs them. We never receive this traffic:' },
    { list: [
      'AI providers you connect (for example Anthropic, OpenAI, Google, Groq, OpenRouter, ElevenLabs or a CLI you installed): when you message Bhippi AI or use a cloud voice or transcription feature, your message and the context it needs — a summary of the timeline, relevant text such as transcripts, and sometimes still frames — go straight to that provider under your own account and their privacy policy. Use offline models if you want nothing to leave the PC.',
      'Online media search (memes, sound effects, stock footage, GIFs): search terms go to those sites, which see your IP address.',
      'Brand kit from a website: Bhippi fetches the web page you give it.',
      'Model downloads: speech and AI model files are downloaded from their hosts, such as GitHub and Hugging Face.',
    ] },
    { h: 'Who else processes your data' },
    { list: [
      'Google — sign-in (Google\'s privacy policy applies to your Google account).',
      'Cloudflare — hosts bhippi.com and its license service.',
      'Our payment partner — processes payments and may act as merchant of record.',
    ] },
    { p: 'Bhippi\'s use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.' },
    { h: 'Where it is stored' },
    { p: `Our service providers may store data outside ${LEGAL.country}, including in the United States and the European Union. Where the law requires it, transfers are covered by the providers' standard contractual clauses or equivalent safeguards.` },
    { h: 'How long we keep it' },
    { list: [
      'Account, license and PC records: while your account exists. Freeing a PC slot removes that PC.',
      'Server request logs with IP addresses: up to 90 days.',
      'Purchase records: as long as tax law requires (up to 8 years).',
      'Everything else is deleted within 30 days of an account deletion request.',
    ] },
    { h: 'Your rights' },
    { p: `Wherever you live, you can ask us to show you, correct, export or delete your data, to withdraw consent, or to stop a use you object to. Write to ${contact} from the email on your account and we answer within 30 days. Deleting your account ends your license. Under India's Digital Personal Data Protection Act you may also nominate someone to exercise these rights for you, and escalate to the Data Protection Board of India. In the EU, UK or elsewhere you can complain to your local data protection authority. California residents: we do not sell or share personal information.` },
    { h: 'Security' },
    { p: 'Traffic to bhippi.com is encrypted (HTTPS). On your PC, sign-in tokens and keys are kept in the operating system\'s credential store, and offline license certificates are signed so they cannot be forged.' },
    { h: 'Children' },
    { p: 'Bhippi is for people aged 18 or over. Anyone younger may only use it with the consent and supervision of a parent or guardian, who buys the license. We do not knowingly collect data from children without that consent.' },
    { h: 'Grievance officer and contact' },
    { p: `${LEGAL.owner}, ${contact}. We acknowledge complaints within 24 hours and resolve them within 15 days.` },
    { h: 'Changes' },
    { p: 'We will show material changes in the app and on our website before they take effect. Effective date: ' + LEGAL.effective + '.' },
  ],
};

const TERMS: LegalDoc = {
  id: 'terms',
  title: 'Terms of Service and License',
  summary: 'The rules for using Bhippi: your license, what you may do, AI features and liability.',
  blocks: [
    { p: `These terms are an agreement between you and ${LEGAL.owner} for ${LEGAL.product}. By signing in or activating Bhippi you accept them. If you use Bhippi for a company, you accept them for that company.` },
    { h: 'Your license' },
    { list: [
      'Buying Bhippi gives you a personal, non-exclusive, non-transferable license to install and use it on up to two PCs at a time, linked to one account.',
      'Bhippi checks the license online at least every 14 days. It works offline in between.',
      'You may not share, resell or publish your key, get around the license check, or reverse engineer the app except where the law allows it.',
      'We may turn off a key that is shared, bought fraudulently, charged back or used to break these terms. We will tell you why.',
    ] },
    { h: 'Your content' },
    { p: 'Everything you make with Bhippi is yours. We claim no rights to your projects or exports, and we never receive them.' },
    { p: 'You are responsible for having the rights to the footage, music, images, memes and other material you import, find through Bhippi\'s online search, or publish. Material found online belongs to its owners and keeps its own license; Bhippi shows the source where it can, but it cannot clear rights for you. Only download media you are allowed to.' },
    { h: 'AI features' },
    { list: [
      'Cloud AI runs on providers you choose, under your own account with them and their terms. You pay them directly.',
      'AI output can be wrong, offensive or similar to other people\'s work. Review it before you publish.',
      'Do not use Bhippi to make illegal content, deceptive deepfakes of real people, or content that infringes others\' rights.',
    ] },
    { h: 'Third-party software' },
    { p: 'Bhippi includes open-source components under their own licenses; see Open-source notices. Nothing in these terms limits your rights under those licenses.' },
    { h: 'Updates' },
    { p: 'Updates are included while your license is active. We may change or remove features, but will not take away the core editor from a license you paid for.' },
    { h: 'Warranty and liability' },
    { p: 'Bhippi is provided "as is". We work hard on it, but we do not promise it is free of bugs; keep backups of important work. To the extent the law allows, our total liability for any claim is limited to the amount you paid for Bhippi in the 12 months before the claim, and we are not liable for lost profits, data or indirect damages. Nothing here limits rights you have as a consumer that cannot be waived.' },
    { h: 'Ending the agreement' },
    { p: 'You can stop using Bhippi and delete your account at any time. If we end your license for breaking these terms, you must stop using Bhippi.' },
    { h: 'Law and disputes' },
    { p: `These terms are governed by the laws of ${LEGAL.country}. Please contact us first at ${LEGAL.email} — most problems are solved that way. Consumers keep the protection of the laws where they live.` },
    { p: 'Effective date: ' + LEGAL.effective + '.' },
  ],
};

const REFUNDS: LegalDoc = {
  id: 'refunds',
  title: 'Refund and Cancellation Policy',
  summary: 'When you can get your money back and how.',
  blocks: [
    { list: [
      'You can ask for a full refund within 14 days of buying, for any reason.',
      'After 14 days we refund when Bhippi does not work on your PC and we could not fix it together.',
      `To ask, email ${LEGAL.email} from the address you bought with, with your order number.`,
      'Refunds go back to the original payment method within 5–10 working days of approval. Your key is turned off when the refund is issued.',
      'Subscriptions, if you have one, can be cancelled at any time from your account page and stay active until the end of the paid period.',
      'Where your local consumer law gives you more rights, those rights apply.',
    ] },
    { p: 'Effective date: ' + LEGAL.effective + '.' },
  ],
};

const OPEN_SOURCE: LegalDoc = {
  id: 'open-source',
  title: 'Open-source notices',
  summary: 'The open-source software Bhippi ships with and the licenses it is used under.',
  blocks: [
    { p: 'These programs are separate works shipped alongside Bhippi. Each is used under its own license, and nothing in Bhippi\'s terms restricts your rights under them. For the source code of any GPL or LGPL component, email ' + LEGAL.email + ' — we will send it, or a link to the exact version, for up to three years from when we shipped it.' },
    { list: [
      'FFmpeg — GPL-3.0 build by BtbN (github.com/BtbN/FFmpeg-Builds). Source: ffmpeg.org.',
      'Robust Video Matting models — GPL-3.0, by Peter Lin et al. (github.com/PeterL1n/RobustVideoMatting).',
      'whisper.cpp — MIT, by Georgi Gerganov and contributors.',
      'Kokoro-82M voices — Apache-2.0, by hexgrad; run through sherpa-onnx (Apache-2.0, k2-fsa) and ONNX Runtime (MIT, Microsoft).',
      'yt-dlp — The Unlicense (public domain).',
      'Tauri, React, and the Rust and JavaScript libraries the app is built from — MIT, Apache-2.0 and similar permissive licenses.',
      'Fonts (Inter, Manrope, Archivo, Fraunces, Montserrat, Outfit, Caveat and others) — SIL Open Font License 1.1.',
      'Lucide icons — ISC.',
    ] },
  ],
};

export const LEGAL_DOCS: LegalDoc[] = [PRIVACY, TERMS, REFUNDS, OPEN_SOURCE];
