# NTAG 424 TT Scanner — Android-App

Android-App zum Scannen von physischen Bitcoin-Scheinen. Liest NXP NTAG 424 DNA TagTamper NFC-Chips via ISO-DEP APDU, prüft den Tamper-Status und kann Verifikationsergebnisse über das Nostr-Protokoll öffentlich protokollieren.

**Primäres Repository:** https://github.com/TUitio123/ntag424-tt-scanner-v2 (privat)  
**Dieses Repository:** Backup-Kopie, identischer Stand, nichts verändert.  
**Zugehörige Website:** https://Testtest123.shakespeare.wtf

---

## Was die App macht

1. **NFC-Chip scannen** — Nutzer hält das Android-Gerät an einen physischen Bitcoin-Schein. Die App liest via IsoDep (ISO 14443-4) die UID und den Tamper-Status des eingebetteten NTAG 424 TT Chips.

2. **Chip verifizieren** — Die UID wird gegen die eingebettete Chip-Registry (`chipRegistry.ts`) geprüft. Bekannte Chips zeigen Satoshi-Betrag und Tamper-Zustand. Unbekannte Chips werden als rot markiert.

3. **Online verifizieren** — Sendet ein Nostr-Event (Kind 6129) mit UID, Betrag, Tamper-Status und Ergebnis an öffentliche Relays. Erscheint sofort auf der Website im Verifikations-Protokoll.

4. **Aufladen** — Sendet ein Nostr-Event (Kind 3491) als Signal, dass der Schein aufgeladen werden soll. Erscheint auf der Website als offene Anfrage.

5. **Website anschauen** — Nach jedem erfolgreichen Online-Vorgang erscheint ein Button der direkt zur Verifikations-Website führt.

---

## APK herunterladen

Die aktuelle APK wird automatisch bei jedem Push auf `main` via GitHub Actions gebaut.

**Download:** GitHub → Actions → neuester erfolgreicher Run → Artifacts → `ntag424-scanner-debug`

**Alternativ:** Die fertige APK liegt auf der Website unter https://Testtest123.shakespeare.wtf (direkter Download-Button).

---

## Registrierte Chips

Diese Chips sind in der aktuellen App-Version eingebettet:

| # | UID | Betrag |
|---|-----|--------|
| 1 | `04C1685ABF1D90` | 11.000 sats |
| 2 | `04AC695ABF1D90` | 11.500 sats |
| 3 | `04C6695ABF1D90` | 12.000 sats |
| 4 | `04BD695ABF1D90` | 12.500 sats |
| 5 | `04AE695ABF1D90` | 13.000 sats |
| 6 | `04AD695ABF1D90` | 13.500 sats |
| 7 | `04BC695ABF1D90` | 14.000 sats |
| 8 | `0493695ABF1D90` | 15.000 sats |

Die Chip-Daten sind in zwei Stellen definiert (müssen synchron bleiben):
- `chips.json` — menschenlesbare Quelldatei
- `src/lib/chipRegistry.ts` — wird zur Build-Zeit aus `chips.json` generiert

---

## Technologie-Stack

| Technologie | Version | Zweck |
|---|---|---|
| React | 19.x | UI-Framework |
| TypeScript | 5.x | Typsicherheit |
| TailwindCSS | 4.x | Styling (dark theme, slate-900) |
| Vite | 8.x | Web-Build-Tool |
| Capacitor | 8.4.x | Web→Native-Bridge (Android) |
| shadcn/ui | — | UI-Komponenten |
| Nostrify | 0.6.x | Nostr-Provider/Hooks |
| nostr-tools | 2.x | Event-Signierung (finalizeEvent) |
| TanStack Query | 5.x | State/Mutations |
| Java | 21 | Android-Plugin (NFC APDU) |
| Android SDK | 34 | Build-Target |

---

## Projektstruktur

```
ntag424-tt-scanner-v2/
│
├── chips.json                         ← Chip-Liste (Quelldatei, manuell pflegen)
├── capacitor.config.ts                ← App-ID: com.ntag424scanner.app, webDir: dist
│
├── scripts/
│   └── generate-registry.cjs         ← Node-Script: chips.json → chipRegistry.ts
│
├── src/
│   ├── pages/
│   │   └── Index.tsx                  ← Haupt-Seite (Header + NFCScanner + Footer)
│   │
│   ├── components/
│   │   └── NFCScanner.tsx             ← HAUPT-KOMPONENTE — alles NFC-bezogene
│   │
│   ├── lib/
│   │   ├── chipRegistry.ts            ← AUTO-GENERIERT aus chips.json (nicht manuell editieren)
│   │   ├── ntag424.ts                 ← Capacitor-Bridge zum Java-Plugin
│   │   ├── appRelays.ts               ← Nostr-Standard-Relays
│   │   └── utils.ts                   ← cn() helper
│   │
│   └── hooks/
│       ├── usePublishAnonymous.ts     ← Nostr-Events ohne Login publizieren
│       ├── useNostrPublish.ts         ← Standard-Hook (erfordert Login — NICHT für NFC verwendet)
│       └── useCurrentUser.ts          ← Nostr-Login-Status
│
├── android-src/                       ← Referenz-Implementierung (NICHT direkt gebaut)
│   ├── MainActivity.java              ← NFC Foreground Dispatch
│   └── Ntag424Plugin.java             ← Vollständiger Java-Plugin-Code
│
└── .github/workflows/
    └── build-apk.yml                  ← GitHub Actions APK-Build (vollständig dokumentiert)
```

---

## Build-Prozess (GitHub Actions)

Der Build läuft automatisch bei jedem Push auf `main`. Die Datei `.github/workflows/build-apk.yml` führt folgende Schritte aus:

| Schritt | Was passiert |
|---|---|
| 1. Checkout | Repository klonen |
| 2. Node.js 22 | Node-Version einrichten |
| 3. Capacitor CLI | `npm install -g @capacitor/cli` |
| 4. npm install | Projektabhängigkeiten installieren |
| 5. Registry generieren | `node scripts/generate-registry.cjs` — liest `chips.json`, schreibt `src/lib/chipRegistry.ts` |
| 6. Web build | `npx vite build` → `dist/` |
| 7. Android hinzufügen | `cap add android` — Android-Projektverzeichnis anlegen |
| 8. Sync | `cap sync android` — Web-Assets ins Android-Projekt kopieren |
| 9. MainActivity.java | Inline in Workflow geschrieben (NFC Foreground Dispatch) |
| 10. Ntag424Plugin.java | Inline in Workflow geschrieben (APDU-Logik) |
| 11. AndroidManifest patchen | NFC-Permission + Intent-Filter hinzufügen |
| 12. nfc_tech_filter.xml | NFC-Tech-Filter-Datei schreiben |
| 13. JDK 21 | Java 21 einrichten (NICHT 17 — Capacitor-Android-Anforderung) |
| 14. Android SDK 34 | `android-actions/setup-android@v3` |
| 15. Gradle build | `./gradlew assembleDebug` |
| 16. Artifact hochladen | APK als `ntag424-scanner-debug` (30 Tage verfügbar) |

**Wichtig:** Java 21 ist zwingend. Mit Java 17 schlägt der Gradle-Build fehl.

**Wichtig:** `MainActivity.java` und `Ntag424Plugin.java` werden inline im Workflow geschrieben, weil Capacitor das Android-Verzeichnis erst zur Build-Zeit anlegt. Diese Dateien existieren nicht im Repo (nur als Referenz in `android-src/`).

---

## NFC-Kommunikation im Detail

### Chip-Typ
**NXP NTAG 424 DNA TagTamper (NTAG 424 TT)**  
ISO 14443-4 kompatibel → kommuniziert über IsoDep (APDU-Kommandos)

### APDU-Sequenz

**Schritt 1: SELECT APPLICATION**
```
CLA=00 INS=A4 P1=04 P2=0C Lc=07
Data: D2 76 00 00 85 01 01   ← NTAG 424 Application Identifier
```
Erwartete Antwort: `90 00` (Erfolg)

**Schritt 2: GetTTStatus (Proprietary Command 0xF7)**
```
CLA=90 INS=F7 P1=00 P2=00 Lc=00 Le=00
```

Antwort-Codes:
| SW1 | SW2 | Bedeutung |
|-----|-----|-----------|
| `91` | `00` | Erfolg — Tamper-Bytes folgen |
| `91` | `AD` | AUTH_REQUIRED — TTStatusKey gesetzt |
| `91` | `1C` | ILLEGAL_COMMAND_CODE — Feature nicht initialisiert |

**Schritt 3: Tamper-Status auslesen**
Bei Antwort `91 00`: erste 2 Bytes sind der Tamper-Status als ASCII:

| Hex | ASCII | Status | Bedeutung |
|-----|-------|--------|-----------|
| `43 43` | `CC` | ✅ Intakt | Tamper-Draht geschlossen, Chip nicht manipuliert |
| `4F 4F` | `OO` | ❌ Gebrochen | Draht gebrochen — Chip wurde geöffnet |
| `4F 43` | `OC` | ⚠️ War gebrochen | Einmal geöffnet, Draht scheint wieder geschlossen |
| `49 49` | `II` | ℹ️ Nicht aktiviert | Tamper-Feature nicht konfiguriert |

### UID-Format
UID kommt als Hex-String **ohne** Doppelpunkte aus dem Java-Plugin: `04C1685ABF1D90`  
Lookup in Registry: `normalizeUID()` entfernt Doppelpunkte/Leerzeichen/Bindestriche und macht uppercase — matching ist case-insensitiv.

---

## NFCScanner.tsx — Komponentenaufbau

Die zentrale Komponente (`src/components/NFCScanner.tsx`) enthält alle NFC-bezogenen Unterkomponenten:

| Unterkomponente | Beschreibung |
|---|---|
| `ScanButton` | Großer runder Scan-Button (144×144px), pulsiert während Scan |
| `VerifyBadge` | Großes Ergebnis-Badge (grün/orange/rot je nach Ergebnis) |
| `TamperPill` | Kleines Badge mit Tamper-Status (immer sichtbar) |
| `UIDRow` | Zeigt UID mit Copy-Button |
| `OnlineActions` | Zwei Buttons: „Online verifizieren" + „Aufladen" + optionaler „Website anschauen"-Link |
| `RawDataPanel` | Aufklappbarer Bereich mit JSON-Rohdaten |
| `HistoryItem` | Eintrag im Scan-Verlauf |
| `NFCScanner` | Haupt-Export, verwaltet den gesamten State |

### State-Maschine

```
idle
  ↓ (Scan-Button drücken)
scanning  ←──────────────────────────────────┐
  ↓ (Tag ranhalten → tagRead-Event)           │
scanning (mit lastScan gesetzt)  ─────────────┘ (nächster Tag)
  ↓ (Stopp-Button)
idle

scanning → error (bei NFC-Fehler) → idle (bei Retry)
```

**Wichtig:** Der Status bleibt auf `scanning` auch nach einem Scan-Ergebnis. Der Scanner wartet auf den nächsten Tag. `lastScan` wird bei jedem neuen Tag überschrieben. Die `OnlineActions`-Buttons resetten sich via `useEffect` auf `scan.uid + scan.timestamp`.

---

## Nostr-Integration

### usePublishAnonymous (KEIN Login nötig)

Events werden mit einem **fest eingebetteten App-Keypair** signiert:

```typescript
// src/hooks/usePublishAnonymous.ts
const APP_SECRET_KEY = new Uint8Array([
  0x7a, 0x3f, 0x12, 0xc8, 0x4e, 0x91, 0xb5, 0x6d,
  // ... 32 Bytes total
]);
```

Der Key ist deterministisch und hat keinen Identitätswert. Events werden direkt via WebSocket an 3 Relays gesendet:
- `wss://relay.ditto.pub`
- `wss://relay.primal.net`
- `wss://relay.damus.io`

Mindestens 1 Relay muss antworten, sonst Error-Toast.

### Event-Struktur

**Online verifizieren (Kind 6129):**
```json
{
  "kind": 6129,
  "content": "{\"uid\":\"04C1685ABF1D90\",\"label\":\"11.000 sats\",\"sats\":11000,\"tamperStatus\":\"CC\",\"result\":\"verified\"}",
  "tags": [["t", "bitcoin-note-verifier"], ["alt", "Bitcoin Note online verification log"]]
}
```

**Aufladen (Kind 3491):**
```json
{
  "kind": 3491,
  "content": "{\"uid\":\"04C1685ABF1D90\",\"label\":\"11.000 sats\",\"sats\":11000}",
  "tags": [["t", "bitcoin-note-verifier"], ["alt", "Bitcoin Note reload request"]]
}
```

---

## Chips verwalten

### Chip hinzufügen

**Datei: `chips.json`** (Quelldatei)
```json
[
  { "uid": "04C1685ABF1D90", "label": "11.000 sats", "info": "", "issuedAt": "04.07.2026" },
  { "uid": "NEUE_UID_HIER",  "label": "20.000 sats", "info": "", "issuedAt": "TT.MM.JJJJ" }
]
```

Das `generate-registry.cjs` Script liest `chips.json` und:
- Parst `sats` automatisch aus dem `label`-Feld (`"11.000 sats"` → `11000`)
- Schreibt `src/lib/chipRegistry.ts` neu mit allen Exporten inkl. `KIND_VERIFY_LOG`, `KIND_RELOAD_REQUEST`, `APP_TAG`

Nach Änderung: pushen → GitHub Actions baut neue APK.

**Gleichzeitig** muss die Website-Registry aktualisiert werden (`src/lib/chipRegistry.ts` im Website-Repo), sonst zeigt die Website den neuen Chip nicht.

### generate-registry.cjs — wichtige Details

Das Script (`scripts/generate-registry.cjs`) **überschreibt** `src/lib/chipRegistry.ts` vollständig. Es generiert:
- `ChipEntry` Interface (mit `sats`-Feld)
- `CHIP_REGISTRY` Array
- `normalizeUID()` Funktion
- `lookupChip()` Funktion
- `KIND_VERIFY_LOG = 6129`
- `KIND_RELOAD_REQUEST = 3491`
- `APP_TAG = 'bitcoin-note-verifier'`

**Vorsicht:** Wenn man `src/lib/chipRegistry.ts` direkt bearbeitet, wird es beim nächsten Build durch das Script überschrieben. Änderungen immer in `chips.json` und `generate-registry.cjs` vornehmen.

---

## Verification-Logik

```typescript
function classify(scan: ScanResult): VerifyResult {
  const chip = lookupChip(scan.uid);
  if (!chip) return { kind: 'unknown' };
  // Nur CC (Draht intakt) = vollständig verifiziert
  return scan.tamperStatus === 'CC'
    ? { kind: 'verified', chip }
    : { kind: 'warn', chip };  // alle anderen Status → Warnung
}
```

| VerifyResult | Anzeige | Icon |
|---|---|---|
| `verified` | Grün, „Verified" | CheckCircle |
| `warn` | Orange, „Achtung" | AlertTriangle + Erklärungstext |
| `unknown` | Rot, „Unbekannt" | HelpCircle |

---

## Bekannte Einschränkungen

| Problem | Status |
|---|---|
| Nur Debug-APK | Kein Keystore eingerichtet. Android zeigt Sicherheitswarnung bei Installation. |
| AUTH_REQUIRED | Chips mit gesetztem TTStatusKey können Tamper-Status nicht ohne Auth liefern. Nicht implementiert. |
| Endloser Scan | Scanner stoppt nicht automatisch. Nutzer muss manuell stoppen. |
| Keine NDEF-Lese-Unterstützung | Der vollständige Plugin-Code in `android-src/` enthält NDEF-Lesen, das vereinfachte Build-Plugin nicht. |
| Website-URL hardcoded | `WEBSITE_URL = 'https://Testtest123.shakespeare.wtf'` in `NFCScanner.tsx` — bei Domain-Wechsel anpassen. |

---

## Zugehörige Repositories

| Repository | Inhalt | Sichtbarkeit |
|---|---|---|
| `TUitio123/ntag424-tt-scanner-v2` | App (Primär) | 🔒 Privat |
| `TUitio123/bitcoin-note-verifier` | Website (Primär) | 🔒 Privat |
| `TUitio123/Backup-424-chip-App` | App-Backup (dieses Repo) | 🔒 Privat |
| `TUitio123/Backup-424-chip-website` | Website-Backup | 🔒 Privat |
