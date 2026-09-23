// The brand kits the app has loaded, for code that has no settings handle (the Motion panel and
// inspector, template placement by hand). App.tsx keeps it in step with Settings.brandKits.
import { resolveActiveKit } from './build';
import { motionBrandFromKit, type MotionBrand } from './motionBrand';
import type { BrandKit, BrandKitDoc } from './types';
import type { Project } from '../types';

let doc: BrandKitDoc | null = null;

export function setBrandKitDoc(next: BrandKitDoc | null | undefined) {
  doc = next ?? null;
}

/** The kit a project uses: its own pick, else the default kit, else none. */
export function currentBrandKit(project: Pick<Project, 'activeBrandKitId'> | null): BrandKit | null {
  return resolveActiveKit(doc, project);
}

export function currentMotionBrand(project: Pick<Project, 'activeBrandKitId'> | null): MotionBrand | null {
  const kit = currentBrandKit(project);
  return kit ? motionBrandFromKit(kit) : null;
}

/** A kit by id (a branded scene rebuilds with the kit it was made in when that kit still exists). */
export function brandKitById(id: string | null | undefined): BrandKit | null {
  return (id && doc?.kits.find((k) => k.id === id)) || null;
}
