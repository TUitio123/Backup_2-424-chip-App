/**
 * Chip-Registry – direkt in der App eingebettet.
 *
 * Um Chips hinzuzufügen oder zu entfernen: dieses Array bearbeiten,
 * dann neu bauen und die APK neu installieren.
 *
 * UID-Matching ist case-insensitiv, Doppelpunkte/Leerzeichen werden ignoriert.
 */

export interface ChipEntry {
  uid: string;
  label: string;
  sats: number;
  info?: string;
  issuedAt?: string;
}

export const CHIP_REGISTRY: ChipEntry[] = [
  { uid: '04C1685ABF1D90', label: '11.000 sats', sats: 11000, issuedAt: '04.07.2026' },
  { uid: '04AC695ABF1D90', label: '11.500 sats', sats: 11500, issuedAt: '04.07.2026' },
  { uid: '04C6695ABF1D90', label: '12.000 sats', sats: 12000, issuedAt: '04.07.2026' },
  { uid: '04BD695ABF1D90', label: '12.500 sats', sats: 12500, issuedAt: '04.07.2026' },
  { uid: '04AE695ABF1D90', label: '13.000 sats', sats: 13000, issuedAt: '04.07.2026' },
  { uid: '04AD695ABF1D90', label: '13.500 sats', sats: 13500, issuedAt: '04.07.2026' },
  { uid: '04BC695ABF1D90', label: '14.000 sats', sats: 14000, issuedAt: '04.07.2026' },
  { uid: '0493695ABF1D90', label: '15.000 sats', sats: 15000, issuedAt: '04.07.2026' },
];

export function normalizeUID(uid: string): string {
  return uid.replace(/[:\s\-]/g, '').toUpperCase();
}

export function lookupChip(uid: string): ChipEntry | null {
  const needle = normalizeUID(uid);
  return CHIP_REGISTRY.find(e => normalizeUID(e.uid) === needle) ?? null;
}

/** Kind 6129 – Online Verify Log */
export const KIND_VERIFY_LOG = 6129;

/** Kind 3491 – Aufladen-Anfrage */
export const KIND_RELOAD_REQUEST = 3491;

/** Shared app-tag for relay filtering */
export const APP_TAG = 'bitcoin-note-verifier';
