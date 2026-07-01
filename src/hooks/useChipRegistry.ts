/**
 * useChipRegistry
 *
 * Loads chips.json from the GitHub repository (raw URL).
 * The file lives at the root of the repo and is fetched fresh on each app start.
 *
 * chips.json format:
 * [
 *   {
 *     "uid":      "04:C1:68:5A:BF:1D:90",  // colon-separated hex, uppercase
 *     "label":    "10.000 sats",             // shown large after scan
 *     "info":     "Ausgabe 2026-01",         // optional detail line
 *     "issuedAt": "01.07.2026"               // optional date string (DD.MM.YYYY)
 *   }
 * ]
 *
 * UID matching is case-insensitive and ignores colons/spaces so that
 * "04:C1:68:5A:BF:1D:90", "04C1685ABF1D90", "04 C1 68 5A BF 1D 90"
 * all match each other.
 */

import { useQuery } from '@tanstack/react-query';

const CHIPS_URL =
  'https://raw.githubusercontent.com/TUitio123/ntag424-tt-scanner-v2/main/chips.json';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChipEntry {
  uid: string;
  label: string;
  info?: string;
  issuedAt?: string;
}

// ── UID normalizer ────────────────────────────────────────────────────────────

export function normalizeUID(uid: string): string {
  return uid.replace(/[:\s\-]/g, '').toUpperCase();
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useChipRegistry() {
  return useQuery<ChipEntry[]>({
    queryKey: ['chip-registry'],
    queryFn: async () => {
      const res = await fetch(CHIPS_URL);
      if (!res.ok) throw new Error(`chips.json: HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('chips.json: expected array');
      return data as ChipEntry[];
    },
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
}

// ── Lookup helper ─────────────────────────────────────────────────────────────

export function lookupChip(
  uid: string,
  registry: ChipEntry[] | undefined
): ChipEntry | null {
  if (!registry) return null;
  const needle = normalizeUID(uid);
  return registry.find(e => normalizeUID(e.uid) === needle) ?? null;
}
