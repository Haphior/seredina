import { useEffect, useState } from 'react';
import { apiGet } from './api';

export interface RegistrationInfo {
  /** False on a self-hosted instance that already has its one organization. */
  open: boolean;
  /** That organization's slug, so sign-in doesn't have to ask for it. */
  tenantSlug: string | null;
}

let cached: Promise<RegistrationInfo> | null = null;

/** GET /auth/registration, once per page load. Null until it answers (or if it fails: nothing is hidden then). */
export function useRegistrationInfo(): RegistrationInfo | null {
  const [info, setInfo] = useState<RegistrationInfo | null>(null);
  useEffect(() => {
    cached ??= apiGet<RegistrationInfo>('/auth/registration').catch(() => ({ open: true, tenantSlug: null }));
    let alive = true;
    cached.then((value) => alive && setInfo(value));
    return () => {
      alive = false;
    };
  }, []);
  return info;
}
