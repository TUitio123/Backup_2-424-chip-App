/**
 * useChipRegistry
 *
 * Lädt die Chip-Liste aus chips.txt (primär) bzw. chips.json (Fallback).
 *
 * ── chips.txt Format ──────────────────────────────────────────────────────────
 *
 *   # Kommentare beginnen mit #
 *
 *   UID:      04:A3:5F:12:8B:2C:91
 *   LABEL:    10.000 sats
 *   INFO:     Ausgabe 2026-01 · Charge A     (optional)
 *   ISSUED:   2026-01-10                     (optional)
 *
 *   UID:      04:B7:9D:44:2E:F1:63
 *   LABEL:    5.000 sats
 *
 * Leerzeilen trennen Einträge, sind aber nicht zwingend notwendig.
 * UID-Matching ist case-insensitiv; Doppelpunkte/Leerzeichen werden ignoriert.
 *
 * ── chips.json Format (Fallback) ─────────────────────────────────────────────
 *
 *   [{ "uid": "04:A3:5F:...", "label": "10.000 sats", "info": "...", "issuedAt": "..." }]
 */

import { useQuery } from '@tanstack/react-query';

// ── URLs ──────────────────────────────────────────────────────────────────────

const BASE_URL = 'https://raw.githubusercontent.com/TUitio123/ntag424-tt-scanner/main';
const CHIPS_TXT_URL  = `${BASE_URL}/chips.txt`;
const CHIPS_JSON_URL = `${BASE_URL}/chips.json`;

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

// ── chips.txt parser ──────────────────────────────────────────────────────────

export function parseChipsTxt(text: string): ChipEntry[] {
  const entries: ChipEntry[] = [];
  let current: Partial<ChipEntry> = {};

  const flush = () => {
    if (current.uid && current.label) {
      entries.push({
        uid:      current.uid,
        label:    current.label,
        info:     current.info,
        issuedAt: current.issuedAt,
      });
    }
    current = {};
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();

    // Skip comments and empty lines (empty line = separator between entries)
    if (!line || line.startsWith('#')) {
      // An empty line can signal the end of a block — flush if we have a uid
      if (!line && current.uid) flush();
      continue;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key   = line.slice(0, colonIdx).trim().toUpperCase();
    const value = line.slice(colonIdx + 1).trim();

    switch (key) {
      case 'UID':    current.uid      = value; break;
      case 'LABEL':  current.label    = value; break;
      case 'INFO':   current.info     = value; break;
      case 'ISSUED': current.issuedAt = value; break;
    }
  }

  // Flush last entry (file might not end with an empty line)
  flush();

  return entries;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useChipRegistry() {
  return useQuery<ChipEntry[]>({
    queryKey: ['chip-registry'],
    queryFn: async () => {
      // 1) Try chips.txt first
      try {
        const res = await fetch(CHIPS_TXT_URL);
        if (res.ok) {
          const text = await res.text();
          const entries = parseChipsTxt(text);
          if (entries.length > 0) return entries;
        }
      } catch {
        // fall through to JSON fallback
      }

      // 2) Fallback: chips.json
      const res = await fetch(CHIPS_JSON_URL);
      if (!res.ok) throw new Error(`chips.json: HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('chips.json: expected array');
      return data as ChipEntry[];
    },
    staleTime: 5 * 60 * 1000, // re-fetch after 5 minutes
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
