# NTAG 424 TT Scanner

Android-APK zum Scannen von NXP NTAG 424 DNA TagTamper NFC-Chips. Liest UID und Tamper-Status direkt vom Chip via ISO-DEP APDU. Gebaut mit React + Capacitor.

---

## Projektstruktur

```
ntag424-tt-scanner-v2/
├── src/
│   ├── components/
│   │   └── NFCScanner.tsx        ← Haupt-UI-Komponente
│   ├── lib/
│   │   ├── ntag424.ts            ← Capacitor-Bridge zum Java-Plugin
│   │   └── chipRegistry.ts       ← Chip-Datenbank (direkt eingebettet)
│   ├── hooks/
│   │   └── useChipRegistry.ts    ← React-Hook für chipRegistry
│   └── pages/
│       └── Index.tsx             ← Hauptseite
├── android-src/
│   ├── MainActivity.java         ← NFC Foreground Dispatch
│   └── Ntag424Plugin.java        ← Vollständiger Java-Plugin-Code (Referenz)
├── chips.json                    ← Chip-Liste (Referenz, wird NICHT von der App geladen)
├── capacitor.config.ts           ← Capacitor App-Konfiguration
└── .github/workflows/
    └── build-apk.yml             ← GitHub Actions APK-Build
```

---

## Chip-Datenbank verwalten

**WICHTIG:** Die App lädt die Chip-Liste **NICHT** aus `chips.json` zur Laufzeit. Die Daten sind direkt im TypeScript-Code eingebettet, damit die App offline und ohne Netzwerkzugriff funktioniert (das Repo ist privat, `raw.githubusercontent.com` unterstützt keine Tokens für private Repos).

### Chips hinzufügen oder entfernen

Datei bearbeiten: **`src/lib/chipRegistry.ts`**

```typescript
export const CHIP_REGISTRY: ChipEntry[] = [
  {
    uid: '04C1685ABF1D90',   // UID ohne Doppelpunkte, ohne Leerzeichen
    label: '10.000 sats',    // wird groß in der App angezeigt
    info: '',                // optionale Infozeile (kann leer bleiben)
    issuedAt: '01.07.2026',  // optionales Datum (deutsches Format DD.MM.YYYY)
  },
  // weitere Chips...
];
```

**UID-Format:** Ohne Doppelpunkte eintragen, z.B. `04C1685ABF1D90` — nicht `04:C1:68:5A:BF:1D:90`. Das Matching ist case-insensitiv und ignoriert Doppelpunkte/Leerzeichen.

Nach dem Bearbeiten: pushen → GitHub Actions baut automatisch eine neue APK.

Die `chips.json` im Root ist nur als menschenlesbare Referenz gedacht und hat keinen Einfluss auf die App.

---

## APK bauen

Der Build läuft vollautomatisch via GitHub Actions bei jedem Push auf `main`.

**Ablauf `.github/workflows/build-apk.yml`:**
1. Node.js 22 + npm install
2. `npx vite build` → erzeugt `dist/`
3. `cap add android` → Android-Projekt anlegen
4. `cap sync android` → Web-Assets in Android-Projekt kopieren
5. `MainActivity.java` + `Ntag424Plugin.java` werden **inline in den Workflow geschrieben** (nicht aus dem Repo gelesen — das war so im Original-Repo gelöst)
6. `AndroidManifest.xml` wird gepatch (NFC-Permission, Intent-Filter)
7. `nfc_tech_filter.xml` wird geschrieben
8. JDK **21** (nicht 17!) + Android SDK 34 einrichten
9. `./gradlew assembleDebug`
10. APK als Artifact hochladen (30 Tage aufbewahrt)

**APK herunterladen:** GitHub → Actions → letzter erfolgreicher Run → Artifacts → `ntag424-scanner-debug`

### Wichtige Erkenntnisse zum Build

- **Java 21 ist zwingend erforderlich** (nicht Java 17). Capacitor-Android benötigt Java 21. Das war ein zentraler Bug im ursprünglichen Projekt.
- `@capacitor/android`, `@capacitor/core` und `@capacitor/cli` müssen alle in `package.json` stehen.
- `capacitor.config.ts` muss `appId: 'com.ntag424scanner.app'` und `webDir: 'dist'` haben.
- Der Workflow schreibt MainActivity und Plugin-Code inline (via `cat > file << 'JAVA'`), weil Capacitor das Android-Projekt erst zur Build-Zeit anlegt.

---

## NFC / Chip-Kommunikation

### Chip-Typ

NXP **NTAG 424 DNA TagTamper** (auch NTAG 424 TT). ISO 14443-4 kompatibel (IsoDep). Kommunikation läuft über APDU-Kommandos.

### APDU-Sequenz

**1. SELECT APPLICATION**
```
CLA=00 INS=A4 P1=04 P2=0C Lc=07  AID: D2 76 00 00 85 01 01
```
Antwort: `90 00` = Erfolg

**2. GetTTStatus (CMD 0xF7)**
```
CLA=90 INS=F7 P1=00 P2=00 Lc=00 Le=00
```
Antwort-Interpretation:
| SW1 | SW2 | Bedeutung |
|-----|-----|-----------|
| `91` | `00` | Erfolg → Byte 0+1 enthalten den Tamper-Status (ASCII) |
| `91` | `AD` | AUTH_REQUIRED → TTStatusKey ist gesetzt, Authentifizierung nötig |
| `91` | `1C` | II → Tamper-Feature nicht initialisiert |

**3. Tamper-Status-Bytes**
Die ersten 2 Bytes der Antwort bei `91 00`:
| Wert (hex) | ASCII | Bedeutung |
|------------|-------|-----------|
| `43 43` | `CC` | Tamper-Draht intakt – Chip wurde nicht geöffnet ✅ |
| `4F 4F` | `OO` | Tamper-Draht gebrochen – Chip wurde geöffnet/manipuliert ❌ |
| `4F 43` | `OC` | War einmal beschädigt, jetzt wieder OK ⚠️ |
| `49 49` | `II` | Tamper-Feature nicht aktiviert |

### UID-Format

Die UID kommt vom Java-Plugin als Hex-String **ohne** Doppelpunkte, z.B. `04C1685ABF1D90`. Das `formatUID()`-Hilfsmethod in der voll ausgebauten `Ntag424Plugin.java` (in `android-src/`) gibt Doppelpunkte aus — **daher beim Registry-Eintrag ohne Doppelpunkte arbeiten**, der `normalizeUID()`-Normalizer in `chipRegistry.ts` entfernt sie ohnehin.

---

## Architektur der App

### JavaScript-Seite (`src/lib/ntag424.ts`)

Capacitor-Bridge zum Java-Plugin:
- `isNativeAvailable()` → prüft ob Capacitor native Platform läuft
- `startNativeScan(onResult, onError)` → registriert `tagRead`-Listener, startet Plugin
- `stopNativeScan()` → entfernt Listener, stoppt Plugin

### Java-Plugin-Schnittstelle

Plugin-Name: `"Ntag424"` (so registriert in `MainActivity.java` via `registerPlugin(Ntag424Plugin.class)`)

Methoden:
- `startScan()` → Promise, resolves sofort, dann kommen Events
- `stopScan()` → Promise

Events:
- `tagRead` → `{ uid: string, tamperStatus: string, debug: string }`

### Scan-Flow (React)

```
[Scan-Button drücken]
       ↓
startNativeScan() aufrufen
       ↓
Status = 'scanning' (blau pulsierend, bleibt so bis manuell gestoppt)
       ↓
Tag ranhalten → tagRead-Event kommt
       ↓
handleResult() → setLastScan() + Status bleibt 'scanning'
       ↓
classify(scan) → lookupChip(uid) gegen CHIP_REGISTRY
       ↓
VerifyResult: 'verified' | 'tampered_known' | 'unknown'
       ↓
UI zeigt Ergebnis + Scanner läuft weiter für nächsten Tag
```

**Wichtig:** Nach einem Scan-Ergebnis bleibt `scanStatus` auf `'scanning'` (nicht `'success'`!). Der Java-Scanner läuft weiter und wartet auf den nächsten Tag. Nur wenn der Benutzer aktiv stoppt, geht der Status auf `'idle'`.

### Verification-Logik

```typescript
function classify(scan: ScanResult): VerifyResult {
  const chip = lookupChip(scan.uid);           // in CHIP_REGISTRY suchen
  if (!chip) return { kind: 'unknown' };        // UID nicht registriert
  const tamperOk = scan.tamperStatus === 'CC' || scan.tamperStatus === 'II';
  return tamperOk
    ? { kind: 'verified', chip }               // grün: bekannt + intakt
    : { kind: 'tampered_known', chip };         // gelb: bekannt + tampered
}
```

### UI-Zustände

| VerifyResult | Farbe | Icon | Bedeutung |
|---|---|---|---|
| `verified` | Grün | ✅ CheckCircle | Chip bekannt + Tamper intakt |
| `tampered_known` | Gelb/Amber | ✗ XCircle | Chip bekannt + Tamper beschädigt |
| `unknown` | Rot | ? HelpCircle | UID nicht in Registry |

Der **TamperPill** (kleines Badge mit Tamper-Status) wird bei **allen** drei Zuständen angezeigt — also auch wenn der Chip verified ist.

---

## Technologie-Stack

- **React 19** + TypeScript
- **TailwindCSS 4** (dark theme, slate-900 Hintergrund)
- **Capacitor 8.4** (Web→Native Bridge)
- **shadcn/ui** (Badge, Card, Button)
- **Vite 8** (Build)
- **GitHub Actions** (APK-Build, Java 21 + Android SDK 34)

---

## Bekannte Einschränkungen / Offene Punkte

1. **Kein Server-Endpunkt** — der "Rohdaten an Server senden"-Button existiert, die Server-URL ist noch nicht konfiguriert. Payload ist bereits vorbereitet als JSON mit `uid`, `tamperStatus`, `verifyResult`, `label`, `timestamp`.

2. **Nur Debug-APK** — der Workflow baut `assembleDebug`. Für Production-APK müsste ein Keystore eingerichtet werden.

3. **AUTH_REQUIRED** — Chips auf denen `TTStatusKey` gesetzt ist können den Tamper-Status nicht ohne Authentifizierung liefern. Momentan als eigener Status angezeigt, keine Authentifizierung implementiert.

4. **NDEF-Lesen** — der vollständige Plugin-Code in `android-src/Ntag424Plugin.java` enthält optionalen NDEF-URL-Leser (SUN-URL). Im vereinfachten Inline-Plugin im Workflow ist das weggelassen.

5. **Scan läuft endlos** — der Scanner stoppt nicht automatisch. Nutzer muss manuell stoppen.

---

## Repositories

- **Dieses Repo (v2):** `https://github.com/TUitio123/ntag424-tt-scanner-v2` (privat) — aktueller Stand
- **Altes Repo:** `https://github.com/TUitio123/ntag424-tt-scanner` (privat) — Ursprung, enthält vollständige `Ntag424Plugin.java` in `android-src/`

---

## Schnellstart für neue KI

1. **Chips hinzufügen:** `src/lib/chipRegistry.ts` bearbeiten, UID ohne Doppelpunkte
2. **APK neu bauen:** pushen → Actions abwarten → Artifact herunterladen
3. **UI ändern:** `src/components/NFCScanner.tsx` (alles in einer Datei)
4. **Java-Plugin ändern:** `.github/workflows/build-apk.yml` Schritte 8+9 (inline Java)
5. **Vollständiger Plugin-Code:** `android-src/Ntag424Plugin.java` als Referenz
