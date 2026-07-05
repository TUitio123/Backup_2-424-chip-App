#!/usr/bin/env node
// Generates src/lib/chipRegistry.ts from chips.json
// Run: node scripts/generate-registry.cjs

const fs   = require('fs');
const path = require('path');

const chipsPath = path.join(__dirname, '..', 'chips.json');
const outPath   = path.join(__dirname, '..', 'src', 'lib', 'chipRegistry.ts');
const keysDir   = path.join(__dirname, '..', 'keys');

const chips = JSON.parse(fs.readFileSync(chipsPath, 'utf8'));

// Parse sats from label like "11.000 sats" → 11000
function parseSats(label) {
  const match = label.replace(/\./g, '').match(/(\d+)\s*sats/i);
  return match ? parseInt(match[1], 10) : 0;
}

// Valid status values
const VALID_STATUSES = ['valid', 'invalid', 'entwertenbeantragt'];

const entries = chips.map(c => {
  const uid      = (c.uid      || '').replace(/'/g, "\\'");
  const label    = (c.label    || '').replace(/'/g, "\\'");
  const sats     = c.sats !== undefined ? c.sats : parseSats(c.label || '');
  const status   = VALID_STATUSES.includes(c.status) ? c.status : 'valid';
  const info     = (c.info     || '').replace(/'/g, "\\'");
  const issuedAt = (c.issuedAt || '').replace(/'/g, "\\'");
  return `  {\n    uid: '${uid}',\n    label: '${label}',\n    sats: ${sats},\n    status: '${status}',\n    info: '${info}',\n    issuedAt: '${issuedAt}',\n  }`;
}).join(',\n');

const ts = `// AUTO-GENERATED from chips.json — do not edit manually
// Run: node scripts/generate-registry.cjs

export type ChipStatus = 'valid' | 'invalid' | 'entwertenbeantragt';

export interface ChipEntry {
  uid: string;
  label: string;
  sats: number;
  status: ChipStatus;
  info?: string;
  issuedAt?: string;
}

export const CHIP_REGISTRY: ChipEntry[] = [
${entries}
];

export function normalizeUID(uid: string): string {
  return uid.replace(/[:\\s\\-]/g, '').toUpperCase();
}

export function lookupChip(uid: string): ChipEntry | null {
  const needle = normalizeUID(uid);
  return CHIP_REGISTRY.find(e => normalizeUID(e.uid) === needle) ?? null;
}

/** Kind 6129 – Online Verify Log (published by app on "Online verifizieren") */
export const KIND_VERIFY_LOG = 6129;

/** Kind 3491 – Aufladen-Anfrage (published by app on "Aufladen") */
export const KIND_RELOAD_REQUEST = 3491;

/** Kind 3492 – Entwertungs-Anfrage (published by app on "Entwertung beantragen") */
export const KIND_INVALIDATE_REQUEST = 3492;

/** Kind 3493 – Zahlung bestätigt (published by website after LN invoice paid) */
export const KIND_PAYMENT_CONFIRMED = 3493;

/** Shared app-tag for relay-level filtering */
export const APP_TAG = 'bitcoin-note-verifier';
`;

fs.writeFileSync(outPath, ts, 'utf8');
console.log(`chipRegistry.ts generated with ${chips.length} chip(s):`);
chips.forEach(c => console.log(`  - ${c.uid}  →  ${c.label}  [${c.status || 'valid'}]`));
