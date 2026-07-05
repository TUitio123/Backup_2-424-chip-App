# AGENTS.md — NTAG 424 TT Scanner App

Dieses Dokument richtet sich an KI-Assistenten (Claude, GPT, etc.) die an diesem Projekt arbeiten. Es erklaert alle kritischen Abhaengigkeiten, den Build-Prozess, haeufige Fallstricke und gibt praezise Anweisungen fuer haeufige Aufgaben.

---

## Sync-Protokoll (05.07.2026)

### Letzter Sync durchgefuehrt von: KI-Bot (Claude Opus 4.6, Shakespeare, Projekt backup-424-sync)

| Was | Status |
|---|---|
| `chips.json` | 11 Chips, 10%-Werte (1.100–3.100 sats) — KORREKT |
| `chipRegistry.ts` | **AKTUALISIERT** — war noch 8 Chips mit alten Betraegen (11.000–15.000), jetzt 11 Chips synchron mit chips.json |
| `generate-registry.cjs` | OK — generiert korrekt aus chips.json |
| Key-Files in `/keys/` | 10 JSON-Dateien vorhanden — OK |
| Kind-Nummern | 6129, 3491, 3492, 3493 — synchron mit Website |
| `APP_TAG` | `bitcoin-note-verifier` — synchron mit Website |
| `APP_SECRET_KEY` | Unveraendert — gleicher Pubkey wie vorher |
| Entwert-Flow | App schreibt "invalid" auf Chip → sendet Kind-3492 mit Invoice → Website zahlt aus |
| Website-URL in NFCScanner | `backuphip.shakespeare.wtf` |

### Was noch fehlt / offen ist

- Die APK wird beim naechsten Push automatisch via GitHub Actions neu gebaut
- Die `chipRegistry.ts` wird ebenfalls via `generate-registry.cjs` ueberschrieben (jetzt identisch)
- Key-Files fuer die 3 neuen Chips (`0492695ABF1D90`, `04A4695ABF1D90`, `0495695ABF1D90`) sind vorhanden

---

## Projektuebersicht

Android-App (Capacitor + React) zum Verifizieren physischer Bitcoin-Scheine via NFC. Der Chip-Typ ist NXP NTAG 424 DNA TagTamper (ISO 14443-4). Die App kommuniziert ueber das Nostr-Protokoll mit einer oeffentlichen Website.

**Stack:** React 19 + TypeScript + TailwindCSS 4 + Vite + Capacitor 8 + Java 21  
**Template:** MKStack (Shakespeare-Plattform)  
**Zugehoerige Website:** https://backuphip.shakespeare.wtf

---

## Kritische Dateien — was was tut

### `chips.json` ← HIER Chips pflegen
```json
[{ "uid": "04C1685ABF1D90", "label": "1.100 sats", "sats": 1100, "status": "valid", "info": "", "issuedAt": "04.07.2026" }]
```
**Einzige Quelldatei fuer Chip-Daten.** Alle anderen Stellen werden daraus generiert.

Aktuell 11 Chips:

| # | UID | Betrag | Ausgegeben |
|---|-----|--------|-----------|
| 1 | `04C1685ABF1D90` | 1.100 sats | 04.07.2026 |
| 2 | `04AC695ABF1D90` | 1.150 sats | 04.07.2026 |
| 3 | `04C6695ABF1D90` | 1.200 sats | 04.07.2026 |
| 4 | `04BD695ABF1D90` | 1.250 sats | 04.07.2026 |
| 5 | `04AE695ABF1D90` | 1.300 sats | 04.07.2026 |
| 6 | `04AD695ABF1D90` | 1.350 sats | 04.07.2026 |
| 7 | `04BC695ABF1D90` | 1.400 sats | 04.07.2026 |
| 8 | `0493695ABF1D90` | 1.500 sats | 04.07.2026 |
| 9 | `0492695ABF1D90` | 1.100 sats | 05.07.2026 |
| 10 | `04A4695ABF1D90` | 2.100 sats | 05.07.2026 |
| 11 | `0495695ABF1D90` | 3.100 sats | 05.07.2026 |

---

### `scripts/generate-registry.cjs` ← Build-Zeit-Generator
Liest `chips.json` → schreibt `src/lib/chipRegistry.ts` **komplett neu**.

Achtung: Das generierte Interface enthaelt ein `status`-Feld (ChipStatus), das die App fuer den Entwert-Flow verwendet.

---

### `src/lib/chipRegistry.ts` ← AUTO-GENERIERT
**Nicht manuell bearbeiten.** Wird bei jedem Build durch `generate-registry.cjs` ueberschrieben. Aenderungen in `chips.json` vornehmen.

Exportiert:
- `ChipStatus` Type: `'valid' | 'invalid' | 'entwertenbeantragt'`
- `ChipEntry` Interface (mit `status: ChipStatus`)
- `CHIP_REGISTRY` Array (11 Chips)
- `normalizeUID(uid)` — entfernt Doppelpunkte/Spaces/Bindestriche, uppercase
- `lookupChip(uid)` — sucht case-insensitiv in Registry
- `KIND_VERIFY_LOG = 6129`
- `KIND_RELOAD_REQUEST = 3491`
- `KIND_INVALIDATE_REQUEST = 3492`
- `KIND_PAYMENT_CONFIRMED = 3493`
- `APP_TAG = 'bitcoin-note-verifier'`

---

### `src/lib/ntag424.ts` ← Capacitor-Bridge
JavaScript-Seite der NFC-Bruecke:

```typescript
isNativeAvailable(): boolean
startNativeScan(onResult, onError)
stopNativeScan()
writeChipStatus(uid, status, keys)
readChipStatus(uid, keys)
```

Events vom Java-Plugin `tagRead`:
```typescript
{ uid: string, chipStatus: string, chipSats: number, debug: string }
```

---

### `src/components/NFCScanner.tsx` ← Haupt-UI

**Entwerten-Flow (7 Schritte):**
1. `confirm` — Bestaetigung durch User
2. `writing` — Chip ranhalten, `writeChipStatus(uid, 'invalid', DEFAULT_KEYS)` ausfuehren
3. `tap_verify` — Chip nochmal ranhalten
4. `verifying` — `readChipStatus()` prueft ob Status jetzt "invalid" ist
5. `invoice_input` — User gibt BOLT11 (lnbc...) oder Lightning-Adresse ein
6. `sending` — Kind 3492 mit `{ uid, label, sats, invoice, chipStatus: "invalid" }` an Nostr
7. `waiting_payment` — Website empfaengt Kind 3492, zahlt aus, sendet Kind 3493

---

### `src/hooks/usePublishAnonymous.ts` ← Nostr ohne Login
Verwendet `nostr-tools` `finalizeEvent()` mit eingebettetem 32-Byte App-Key.
Publiziert auf 3 Relays via WebSocket. **NICHT** `useNostrPublish` verwenden.

---

## Nostr Event Flows

### Scan → Online verifizieren
```
App scannt Chip → Kind 6129: { uid, label, sats, chipStatus, result }
Tag: ['t', 'bitcoin-note-verifier']
```

### Aufladen anfordern
```
App → Kind 3491: { uid, label, sats }
Tag: ['t', 'bitcoin-note-verifier']
Website empfaengt → zeigt Invoice → User zahlt → Website sendet Kind 3493
```

### Entwerten
```
App schreibt "invalid" auf Chip → verifiziert
→ Kind 3492: { uid, label, sats, invoice, chipStatus: "invalid" }
Tag: ['t', 'bitcoin-note-verifier']
Website empfaengt → EntwertPanel → prueft chipStatus + Betrag
→ POST LNbits Admin-Key /api/v1/payments out:true bolt11:<invoice>
→ Kind 3493: { uid, paymentHash, sats, paidAt }
→ Chip dauerhaft als "invalid" gespeichert
```

---

## Build-Prozess (GitHub Actions)

`.github/workflows/build-apk.yml` — automatisch bei jedem Push auf `main`:
1. `node scripts/generate-registry.cjs` → chipRegistry.ts aus chips.json
2. `npx vite build` → `dist/`
3. `cap add android` + `cap sync android`
4. Java-Plugin-Code (MainActivity + Ntag424Plugin) inline geschrieben
5. JDK 21 + Android SDK 34
6. `./gradlew assembleDebug`
7. APK als Artifact hochgeladen

**Kritisch:** Java 21, nicht 17.

---

## Was NICHT veraendert werden sollte

| Datei | Warum |
|---|---|
| `APP_SECRET_KEY` in usePublishAnonymous.ts | Aendert den Pubkey aller Events |
| `APP_TAG = 'bitcoin-note-verifier'` | Website filtert danach |
| Kind-Nummern (6129, 3491, 3492, 3493) | Website + App muessen synchron sein |
| `capacitor.config.ts` | App-ID und webDir kritisch fuer Build |
| `src/App.tsx` | Provider-Stack — nie ohne Lesen anfassen |

---

## Zugehoerige Repositories

| Repository | Inhalt | URL |
|---|---|---|
| `Backup-424-chip-App` | App (dieses Repo) | `github.com/TUitio123/Backup-424-chip-App` |
| `Backup-424-chip-website` | Website | `github.com/TUitio123/Backup-424-chip-website` |
| `ntag424-tt-scanner-v2` | App (Primaer) | `github.com/TUitio123/ntag424-tt-scanner-v2` (privat) |
| `bitcoin-note-verifier` | Website (Primaer) | `github.com/TUitio123/bitcoin-note-verifier` (privat) |
| `backup-424-sync` | Shakespeare Sync-Projekt | (lokal in Shakespeare) |

---

## Commit-Konvention

```
feat: neues Feature
fix: Bugfix
chore: Wartung (Deps, Config, Chips)
docs: nur Dokumentation
sync: Repository-Synchronisation
```
