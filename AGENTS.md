# AGENTS.md — NTAG 424 TT Scanner App

Dieses Dokument richtet sich an KI-Assistenten (Claude, GPT, etc.) die an diesem Projekt arbeiten. Es erklärt alle kritischen Abhängigkeiten, den Build-Prozess, häufige Fallstricke und gibt präzise Anweisungen für häufige Aufgaben.

---

## Projektüberblick

Android-App (Capacitor + React) zum Verifizieren physischer Bitcoin-Scheine via NFC. Der Chip-Typ ist NXP NTAG 424 DNA TagTamper (ISO 14443-4). Die App kommuniziert über das Nostr-Protokoll mit einer öffentlichen Website.

**Stack:** React 19 + TypeScript + TailwindCSS 4 + Vite + Capacitor 8 + Java 21  
**Template:** MKStack (Shakespeare-Plattform)  
**Zugehörige Website:** https://Testtest123.shakespeare.wtf

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

Wichtig: Das Script parsiert `sats` automatisch aus dem Label (`"11.000 sats"` → `11000`). Es exportiert auch `KIND_VERIFY_LOG`, `KIND_RELOAD_REQUEST`, `APP_TAG`. **Wenn diese Konstanten fehlen würden, schlägt der Vite-Build fehl** (war ein echter Bug).

```javascript
// Sats aus Label parsen:
function parseSats(label) {
  const match = label.replace(/\./g, '').match(/(\d+)\s*sats/i);
  return match ? parseInt(match[1], 10) : 0;
}
```

---

### `src/lib/chipRegistry.ts` ← AUTO-GENERIERT
**Nicht manuell bearbeiten.** Wird bei jedem Build durch `generate-registry.cjs` überschrieben. Änderungen in `chips.json` vornehmen.

Exportiert:
- `ChipEntry` Interface
- `CHIP_REGISTRY` Array
- `normalizeUID(uid)` — entfernt Doppelpunkte/Spaces/Bindestriche, uppercase
- `lookupChip(uid)` — sucht case-insensitiv in Registry
- `KIND_VERIFY_LOG = 6129`
- `KIND_RELOAD_REQUEST = 3491`
- `APP_TAG = 'bitcoin-note-verifier'`

---

### `src/lib/ntag424.ts` ← Capacitor-Bridge
JavaScript-Seite der NFC-Brücke:

```typescript
isNativeAvailable(): boolean          // prüft ob Capacitor native läuft
startNativeScan(onResult, onError)    // registriert tagRead-Listener, startet Plugin
stopNativeScan()                      // entfernt Listener, stoppt Plugin
```

Events vom Java-Plugin: `{ uid: string, tamperStatus: string, debug: string }`

Der Plugin-Name ist `"Ntag424"` — muss exakt so registriert sein in `MainActivity.java`.

---

### `src/components/NFCScanner.tsx` ← Haupt-UI
Enthält alle NFC-bezogenen Komponenten in einer Datei. Änderungen an der Scan-UI, Buttons, Ergebnis-Anzeige — alles hier.

**State-Flow:**
```
idle → scanning → scanning+lastScan → idle
                                    ↓ (OnlineActions)
                               Nostr-Event via usePublishAnonymous
```

**Button-Reset bei neuem Scan:**
```typescript
useEffect(() => {
  setVerifyState('idle');
  setReloadState('idle');
}, [scan.uid, scan.timestamp]);
```
Wenn `scan.uid` oder `scan.timestamp` sich ändern (neuer Chip) → Buttons resetten.

**Website-URL** (hardcoded in NFCScanner.tsx):
```typescript
const WEBSITE_URL = 'https://Testtest123.shakespeare.wtf';
```

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

Publiziert auf 3 Relays via WebSocket parallel. Erfolgreich wenn ≥1 Relay mit `OK` antwortet. Timeout: 8 Sekunden pro Relay.

**NICHT** `useNostrPublish` verwenden für NFC-Aktionen — der wirft „User is not logged in" weil kein Nostr-Login.

---

### `.github/workflows/build-apk.yml` ← APK-Build
Der gesamte Java-Code (MainActivity + Ntag424Plugin) wird **inline in den Workflow geschrieben** via `cat > file << 'JAVA' ... JAVA`. Das ist gewollt, weil Capacitor das Android-Verzeichnis erst zur Build-Zeit erzeugt.

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

**Gleichzeitig** Website-Repo (`bitcoin-note-verifier`) updaten:
```typescript
// src/lib/chipRegistry.ts:
{ uid: 'NEUE_UID', label: '20.000 sats', sats: 20000 },
```

### Satoshi-Betrag eines Chips ändern
In `chips.json` das `label`-Feld anpassen. `sats` wird automatisch geparst. Dann auch Website-Registry anpassen.

### Website-URL ändern
In `src/components/NFCScanner.tsx`:
```typescript
const WEBSITE_URL = 'https://NEUE-URL.example.com';
```

### Neues Nostr-Event-Kind hinzufügen
1. Neue Konstante in `scripts/generate-registry.cjs` zum generierten Output hinzufügen
2. Hook in `src/hooks/usePublishAnonymous.ts` oder neuer Hook
3. `NIP.md` dokumentieren
4. Website-Hooks updaten

### Java-Plugin-Code ändern
In `.github/workflows/build-apk.yml` den Inline-Java-Block suchen (nach `Write Ntag424Plugin.java`). Änderungen dort vornehmen. Referenz-Implementierung in `android-src/Ntag424Plugin.java`.

### APK in Website ersetzen
Nach erfolgreichem Build:
1. APK aus Actions herunterladen (Artifacts → `ntag424-scanner-debug`)
2. In Shakespeare-Projekt hochladen als `/tmp/app-debug.apk`
3. `cp /tmp/app-debug.apk public/app-debug.apk` im Website-Repo
4. Build + Commit + Push

---

## Build-Fehler und Lösungen

| Fehler | Ursache | Lösung |
|--------|---------|--------|
| `"KIND_VERIFY_LOG" is not exported` | `generate-registry.cjs` schreibt Konstanten nicht | Script updaten — die 3 `export const` am Ende einfügen |
| `Build failed with exit code 1` (Gradle) | Java-Version falsch | `java-version: '21'` im Workflow prüfen |
| `Cannot find module '@/lib/chipRegistry'` | chipRegistry.ts nicht generiert | `node scripts/generate-registry.cjs` manuell laufen lassen |
| `User is not logged in` (Toast) | `useNostrPublish` statt `usePublishAnonymous` | In `NFCScanner.tsx` Hook ersetzen |
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

---

## Systemkontext

```
┌─────────────────────────┐
│   Physischer            │
│   Bitcoin-Schein        │
│   NTAG 424 TT NFC-Chip  │
└──────────┬──────────────┘
           │ ISO-DEP APDU (IsoDep)
           │ SELECT APP + GetTTStatus 0xF7
           ▼
┌─────────────────────────┐
│   Ntag424Plugin.java    │
│   (Capacitor-Plugin)    │
│   - UID lesen           │
│   - TT-Status lesen     │
│   → tagRead-Event       │
└──────────┬──────────────┘
           │ Capacitor Bridge
           ▼
┌─────────────────────────┐      Nostr Events (WSS)      ┌─────────────────────┐
│   NFCScanner.tsx        │  ──────────────────────────► │  relay.ditto.pub    │
│   - classify()          │   Kind 6129 / Kind 3491       │  relay.primal.net   │
│   - OnlineActions       │   t=bitcoin-note-verifier     │  relay.damus.io     │
│   - VerifyBadge         │                               └──────────┬──────────┘
│   - Scan-Button         │                                          │
└─────────────────────────┘                                          │ Query
                                                                     ▼
                                                         ┌─────────────────────┐
                                                         │  Website            │
                                                         │  (bitcoin-note-     │
                                                         │   verifier)         │
                                                         │  Testtest123.       │
                                                         │  shakespeare.wtf    │
                                                         └─────────────────────┘
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
