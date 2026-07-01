/**
 * useChipRegistry
 *
 * Lädt chips.json direkt aus dem Build-Bundle (statischer Import).
 * Kein Netzwerkaufruf nötig – funktioniert auch ohne Internet und in privaten Repos.
 *
 * Um Chips hinzuzufügen/entfernen: chips.json im Root bearbeiten, dann neu bauen.
 *
 * chips.json format:
 * [
 *   {
 *     "uid":      "04C1685ABF1D90",    // hex, ohne Doppelpunkte
 *     "label":    "10.000 sats",        // wird groß angezeigt
 *     "info":     "",                   // optional
 *     "issuedAt": "01.07.2026"          // optional (DD.MM.YYYY)
 *   }
 * ]
 *
 * UID-Matching ist case-insensitiv, Doppelpunkte/Leerzeichen werden ignoriert.
 */

import { useQuery } from '@tanstack/react-query';
import chipsData from '../../chips.json';

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
      return chipsData as ChipEntry[];
    },
    staleTime: Infinity,
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
