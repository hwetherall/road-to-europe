const STORAGE_KEY = 'keepwatch_kyle_active';

export function readKyleState(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function writeKyleState(active: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, String(active));
}
