// About › Profile: Free & Open Source information.
import { ExternalLink, Sparkles } from 'lucide-react';
import { api } from '../lib/ipc';

export function ProfileSection() {
  return (
    <div className="profile-card">
      <div className="profile-head">
        <span className="account-avatar account-avatar-letter" style={{ width: 44, height: 44, background: '#2563eb', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%' }}>
          <Sparkles size={20} />
        </span>
        <div className="profile-copy">
          <strong>Community Edition</strong>
          <span className="muted">Free &amp; Open Source Software (MIT License)</span>
        </div>
        <span className="profile-pill kind-paid">Unlocked</span>
      </div>

      <div className="profile-row" style={{ marginTop: 12 }}>
        <span className="profile-label">Status</span>
        <span>100% Free · No login or license key required</span>
      </div>

      <div className="profile-row">
        <span className="profile-label">Features</span>
        <span>All NLE features, AI tools, local generators, and 4K export are fully unlocked.</span>
      </div>

      <div className="profile-row">
        <span className="profile-label">Privacy</span>
        <span>All footage and projects stay directly on this machine.</span>
      </div>

      <div className="profile-actions" style={{ marginTop: 16 }}>
        <button type="button" className="btn btn-small" onClick={() => void api.openUrl('https://github.com/memegyanfactory-gif/bhippi-Video-editor')}>
          <ExternalLink size={12} /> GitHub Repository
        </button>
        <button type="button" className="btn btn-small btn-ghost" onClick={() => void api.openUrl('https://bhippi.com')}>
          <ExternalLink size={12} /> Website
        </button>
      </div>
    </div>
  );
}
