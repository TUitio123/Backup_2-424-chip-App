# AGENTS.md — NTAG 424 TT Scanner App

Dieses Dokument richtet sich an KI-Assistenten (Claude, GPT, etc.) die an diesem Projekt arbeiten. Es erklärt alle kritischen Abhängigkeiten, den Build-Prozess, häufige Fallstricke und gibt präzise Anweisungen für häufige Aufgaben.

---

## Projektüberblick

Android-App (Capacitor + React) zum Verifizieren physischer Bitcoin-Scheine via NFC. Der Chip-Typ ist NXP NTAG 424 DNA TagTamper (ISO 14443-4). Die App kommuniziert über das Nostr-Protokoll mit einer öffentlichen Website.

**Stack:** React 19 + TypeScript + TailwindCSS 4 + Vite + Capacitor 8 + Java 21  
**Template:** MKStack (Shakespeare-Plattform)  
**Zugehörige Website:** https://backuphip.shakespeare.wtf

---

## Kritische Dateien — was was tut

### `chips.json` ← HIER Chips pflegen
```json
[{ "uid": "04C1685ABF1D90", "label": "11.000 sats", "info": "", "issuedAt": "04.07.2026" }]
```
**Einzige Quelldatei für Chip-Daten.** Alle anderen Stellen werden daraus generiert.

---

### `scripts/generate-registry.cjs` ← Build-Zeit-Generator
Liest `chips.json` → schreibt `src/lib/chipRegistry.ts` **komplett neu**.

Achtung: Das generierte Interface enthält ein `status`-Feld, das die App aber **nicht verwendet**.
Die App liest Status immer direkt vom Chip (via `scan.chipStatus`), nicht aus der Registry.

---

### `src/lib/chipRegistry.ts` ← AUTO-GENERIERT
**Nicht manuell bearbeiten.** Wird bei jedem Build durch `generate-registry.cjs` überschrieben. Änderungen in `chips.json` vornehmen.

Exportiert:
- `ChipEntry` Interface (ohne `status` Feld — App braucht das nicht)
- `CHIP_REGISTRY` Array
- `normalizeUID(uid)` — entfernt Doppelpunkte/Spaces/Bindestriche, uppercase
- `lookupChip(uid)` — sucht case-insensitiv in Registry
- `KIND_VERIFY_LOG = 6129`
- `KIND_RELOAD_REQUEST = 3491`
- `KIND_INVALIDATE_REQUEST = 3492`
- `KIND_PAYMENT_CONFIRMED = 3493`
- `APP_TAG = 'bitcoin-note-verifier'`

---

### `src/lib/ntag424.ts` ← Capacitor-Bridge
JavaScript-Seite der NFC-Brücke:

```typescript
isNativeAvailable(): boolean          // prüft ob Capacitor native läuft
startNativeScan(onResult, onError)    // registriert tagRead-Listener, startet Plugin
stopNativeScan()                      // entfernt Listener, stoppt Plugin
writeChipStatus(uid, status, keys)    // schreibt Status auf Chip (File 02)
readChipStatus(uid, keys)             // liest Status zurück vom Chip (Verifikation)
```

Events vom Java-Plugin `tagRead`:
```typescript
{
  uid:        string  // Chip-UID (hex, uppercase, keine Doppelpunkte)
  chipStatus: string  // Status aus File 02: "valid" / "invalid" / "entwertenbeantragt"
  chipSats:   number  // Sats aus File 03 (4-byte big-endian int, 0 wenn nicht geschrieben)
  debug:      string  // APDU Dump Log — alle Befehle + Antworten
}
```

**WICHTIG:** `chipStatus` und `chipSats` kommen direkt vom Chip, nicht aus lokaler DB.
Der Plugin-Name ist `"Ntag424"` — muss exakt so registriert sein in `MainActivity.java`.

---

### `src/components/NFCScanner.tsx` ← Haupt-UI
Enthält alle NFC-bezogenen Komponenten in einer Datei.

**State-Flow:**
```
idle → scanning → [Chip wird rangehalten]
               ↓
         ScanResult { uid, chipStatus, chipSats, debug }
               ↓
         ResultCard (zeigt status + sats vom Chip)
               ↓
         Aktionen:
         - Online verifizieren (Kind 6129)
         - Aufladen anfordern (Kind 3491) → InvoicePanel
         - Entwerten (nur wenn chipStatus === 'valid') → EntwertFlow
```

**Website-URL** (hardcoded in NFCScanner.tsx):
```typescript
const WEBSITE_BASE = 'https://backuphip.shakespeare.wtf';
function chipWebsiteUrl(uid: string) {
  return `${WEBSITE_BASE}?chip=${uid}`;  // öffnet NUR diesen Chip
}
```

**Entwerten-Flow (5 Schritte):**
1. `confirm` — Bestätigung durch User
2. `writing` — Chip ranhalten, `writeChipStatus(uid, 'invalid', DEFAULT_KEYS)` ausführen
3. `tap_verify` — Chip nochmal ranhalten
4. `verifying` — `readChipStatus()` prüft ob Status jetzt "invalid" ist
5. `invoice_input` — User gibt BOLT11 (lnbc...) oder Lightning-Adresse (user@domain) ein
   - BOLT11: Betrag wird decoded und muss = chipSats sein
   - Lightning-Adresse: wird akzeptiert, Betrag-Check entfällt (Website prüft)
6. `sending` — Kind 3492 mit `{ uid, label, sats, invoice, chipStatus: "invalid" }` an Nostr
7. `waiting_payment` — Website empfängt Kind 3492, zahlt aus, sendet Kind 3493

**APDU Dump Log:**
- Wird nach jedem Scan in `scan.debug` gespeichert
- Anzeigbar via `DumpLog`-Komponente (Eye/EyeOff Toggle)
- Enthält alle `SelectApp`, `ReadFile02`, `ReadFile03`, `WriteFile02` APDUs mit CMD + RSP

---

### `src/hooks/usePublishAnonymous.ts` ← Nostr ohne Login
Verwendet `nostr-tools` `finalizeEvent()` mit einem eingebetteten 32-Byte App-Key.

```typescript
const APP_SECRET_KEY = new Uint8Array([
  0x7a, 0x3f, 0x12, 0xc8, 0x4e, 0x91, 0xb5, 0x6d,
  0x2a, 0x80, 0xf4, 0x37, 0xcc, 0x59, 0x1e, 0x8b,
  0x6f, 0x25, 0xd7, 0x43, 0xa1, 0x9c, 0x70, 0xe6,
  0x58, 0x14, 0xb3, 0x2f, 0x91, 0x6a, 0x47, 0xd2,
]);
```

Publiziert auf 3 Relays via WebSocket parallel. Erfolgreich wenn ≥1 Relay mit `OK` antwortet.

**NICHT** `useNostrPublish` verwenden — der wirft „User is not logged in".

---

### `.github/workflows/build-apk.yml` ← APK-Build
Der gesamte Java-Code (MainActivity + Ntag424Plugin) wird **inline in den Workflow geschrieben** via `cat > file << 'JAVA' ... JAVA`. Das ist gewollt, weil Capacitor das Android-Verzeichnis erst zur Build-Zeit erzeugt.

**Java-Plugin `Ntag424Plugin.java` — Was es beim Scan macht:**
1. `SELECT APP` — selektiert die NTAG 424-Applikation via DF_NAME
2. `ReadFile02` — liest 32 Bytes (Status-String: "valid"/"invalid"/"entwertenbeantragt")
3. `ReadFile03` — liest 4 Bytes (Sats als big-endian int)
4. Sendet `tagRead`-Event: `{ uid, chipStatus, chipSats, debug }`

**Kritische Build-Anforderungen:**
- **Java 21** (nicht 17 — Capacitor-Android benötigt 21)
- **Android SDK 34**
- `@capacitor/android`, `@capacitor/core`, `@capacitor/cli` alle in `package.json`
- `capacitor.config.ts`: `appId: 'com.ntag424scanner.app'`, `webDir: 'dist'`

---

## Häufige Aufgaben

### Chip hinzufügen
```json
// chips.json — neuen Eintrag anhängen:
{ "uid": "NEUE_UID", "label": "20.000 sats", "info": "", "issuedAt": "TT.MM.JJJJ" }
```
Pushen → GitHub Actions baut neue APK.

**Gleichzeitig** Website-Repo (`Backup-424-chip-website`) updaten:
```typescript
// src/lib/chipRegistry.ts:
{ uid: 'NEUE_UID', label: '20.000 sats', sats: 20000, status: 'valid', issuedAt: 'TT.MM.JJJJ' },
```

### Website-URL ändern
In `src/components/NFCScanner.tsx`:
```typescript
const WEBSITE_BASE = 'https://NEUE-URL.example.com';
```

### Java-Plugin-Code ändern
In `.github/workflows/build-apk.yml` den Inline-Java-Block suchen (nach `Write Ntag424Plugin.java`). Änderungen dort vornehmen. **Die Referenz-Implementierung liegt AUCH in `android-src/Ntag424Plugin.java`** — beide synchron halten.

### APK in Website ersetzen
Nach erfolgreichem Build:
1. APK aus Actions herunterladen (Artifacts → `ntag424-scanner-debug`)
2. In Shakespeare-Projekt hochladen als `/tmp/app-debug.apk`
3. Im Website-Repo: `cp /tmp/app-debug.apk public/app-debug.apk`
4. Build + Commit + Push

---

## Build-Fehler und Lösungen

| Fehler | Ursache | Lösung |
|--------|---------|--------|
| `"KIND_VERIFY_LOG" is not exported` | `generate-registry.cjs` schreibt Konstanten nicht | Script updaten |
| `Build failed with exit code 1` (Gradle) | Java-Version falsch | `java-version: '21'` im Workflow prüfen |
| `Cannot find module '@/lib/chipRegistry'` | chipRegistry.ts nicht generiert | `node scripts/generate-registry.cjs` laufen lassen |
| `User is not logged in` (Toast) | `useNostrPublish` statt `usePublishAnonymous` | Hook ersetzen |
| APK installiert nicht | Debug-Signatur | „Unbekannte Quellen" in Android aktivieren |

---

## Was NICHT verändert werden sollte (ohne triftigen Grund)

| Datei | Warum |
|---|---|
| `src/lib/chipRegistry.ts` | Wird durch Build überschrieben — Änderungen in `chips.json` |
| `capacitor.config.ts` | App-ID und webDir sind kritisch für den Build |
| `src/App.tsx` | Provider-Stack — nie ohne Lesen anfassen |
| `APP_SECRET_KEY` in `usePublishAnonymous.ts` | Würde alle alten Events einem anderen Pubkey zuordnen |
| `APP_TAG = 'bitcoin-note-verifier'` | Website filtert danach — muss synchron bleiben |
| `KIND_VERIFY_LOG = 6129` | Website filtert danach — muss synchron bleiben |
| `KIND_RELOAD_REQUEST = 3491` | Website filtert danach — muss synchron bleiben |
| `KIND_INVALIDATE_REQUEST = 3492` | Website filtert danach — muss synchron bleiben |
| `KIND_PAYMENT_CONFIRMED = 3493` | App hört darauf — muss synchron bleiben |

---

## Nostr Event Flows

### Scan → Online verifizieren
```
App scannt Chip → liest chipStatus+chipSats → User drückt "Online verifizieren"
→ Kind 6129, content: { uid, label, sats, chipStatus, result }, t: bitcoin-note-verifier
```

### Aufladen
```
App → User drückt "Aufladen anfordern"
→ Kind 3491, content: { uid, label, sats }, t: bitcoin-note-verifier
Website empfängt 3491 → zeigt Invoice-Button
User zahlt Invoice → Website erkennt Zahlung
→ Kind 3493, content: { uid, paymentHash }, t: bitcoin-note-verifier
App hört auf 3493 (usePaymentConfirmed) → WriteValidFlow öffnet sich
App schreibt "valid" auf Chip → verifiziert
```

### Entwerten
```
App → Chip wird auf "invalid" gesetzt (writeChipStatus)
→ readChipStatus() bestätigt "invalid"
→ User gibt Lightning-Invoice ein
→ Kind 3492, content: { uid, label, sats, invoice, chipStatus: "invalid" }, t: bitcoin-note-verifier
Website empfängt 3492 → EntwertPanel zeigt Auszahlen-Button
Website prüft: BOLT11-Betrag == chip.sats
→ POST LNbits /api/v1/payments out:true bolt11: <invoice> (Admin-Key)
→ Kind 3493, content: { uid, paymentHash, sats, paidAt }
Website speichert uid in localStorage PAYOUT_DONE_KEY (dauerhaft invalid)
Erst nach erneutem Aufladen (Kind 3491 + bezahlt) darf Chip wieder valid werden
```

---

## Systemkontext

```
┌─────────────────────────┐
│   Physischer            │
│   Bitcoin-Schein        │
│   NTAG 424 TT NFC-Chip  │
│   File 02: Status       │
│   File 03: Sats         │
└──────────┬──────────────┘
           │ ISO-DEP APDU (IsoDep)
           │ SELECT APP + ReadFile02 + ReadFile03
           ▼
┌─────────────────────────┐
│   Ntag424Plugin.java    │
│   tagRead event:        │
│   { uid, chipStatus,    │
│     chipSats, debug }   │
└──────────┬──────────────┘
           │ Capacitor Bridge
           ▼
┌─────────────────────────┐
│   NFCScanner.tsx        │
│   - ResultCard          │
│   - EntwertFlow         │
│   - InvoicePanel        │
│   - DumpLog             │
└──────────┬──────────────┘
           │ Nostr WSS
           │ Kind 6129/3491/3492
           ▼
┌─────────────────────────┐
│  relay.ditto.pub        │
│  relay.primal.net       │
│  relay.damus.io         │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│  Website                │
│  backuphip.             │
│  shakespeare.wtf        │
│  - EntwertPanel         │
│  - LNbits Admin Payout  │
│  - Kind 3493 confirm    │
└─────────────────────────┘
```

---

## Commit-Konvention

```
feat: neues Feature
fix: Bugfix
chore: Wartung (Deps, Config, Chips)
docs: nur Dokumentation
```

Nach Änderungen: Push → Actions abwarten → APK herunterladen → in Website-Repo ersetzen.
