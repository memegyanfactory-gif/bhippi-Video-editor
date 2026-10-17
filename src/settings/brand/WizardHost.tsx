// Hosts the new-brand wizard (wizard/BrandWizard.tsx) over the studio. Esc cancels it.

import { useEffect } from 'react';
import type { BrandKit } from '../../lib/brandKit';
import { BrandWizard } from './wizard/BrandWizard';

export function WizardHost({ onClose, onCreate }: { onClose: () => void; onCreate: (kit: BrandKit) => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  return <div className="bs-wizard"><BrandWizard onCancel={onClose} onCreate={onCreate} /></div>;
}
