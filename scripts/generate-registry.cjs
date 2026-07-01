#!/usr/bin/env node
// Generates src/lib/chipRegistry.ts from chips.json
// Run: node scripts/generate-registry.js

const fs = require('fs');
const path = require('path');

const chipsPath = path.join(__dirname, '..', 'chips.json');
const outPath   = path.join(__dirname, '..', 'src', 'lib', 'chipRegistry.ts');

const chips = JSON.parse(fs.readFileSync(chipsPath, 'utf8'));

const entries = chips.map(c => {
  const uid      = (c.uid      || '').replace(/'/g, "\\'");
  const label    = (c.label    || '').replace(/'/g, "\\'");
  const info     = (c.info     || '').replace(/'/g, "\\'");
  const issuedAt = (c.issuedAt || '').replace(/'/g, "\\'");
  return `  {\n    uid: '${uid}',\n    label: '${label}',\n    info: '${info}',\n    issuedAt: '${issuedAt}',\n  }`;
}).join(',\n');

const ts = `// AUTO-GENERATED from chips.json — do not edit manually
// Run: node scripts/generate-registry.js

export interface ChipEntry {
  uid: string;
  label: string;
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
`;

fs.writeFileSync(outPath, ts, 'utf8');
console.log(`chipRegistry.ts generated with ${chips.length} chip(s):`);
chips.forEach(c => console.log(`  - ${c.uid}  →  ${c.label}`));
