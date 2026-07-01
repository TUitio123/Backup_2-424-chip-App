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
  info?: string;
  issuedAt?: string;
}

export const CHIP_REGISTRY: ChipEntry[] = [
  {
    uid: '04C1685ABF1D90',
    label: '10.000 sats',
    info: '',
    issuedAt: '01.07.2026',
  },
  {
    uid: '04AC695ABF1D90',
    label: '10.000 sats',
    info: '',
    issuedAt: '01.07.2026',
  },
];

export function normalizeUID(uid: string): string {
  return uid.replace(/[:\s\-]/g, '').toUpperCase();
}

export function lookupChip(uid: string): ChipEntry | null {
  const needle = normalizeUID(uid);
  return CHIP_REGISTRY.find(e => normalizeUID(e.uid) === needle) ?? null;
}
