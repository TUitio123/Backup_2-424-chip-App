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

---

# Project Overview

This project is a Nostr client application built with React 19.x, TailwindCSS 4.x, Vite, shadcn/ui, and Nostrify.

## Technology Stack

- **React 19.x**: hooks, concurrent rendering, ref-as-prop
- **TailwindCSS 4.x**: utility-first styling
- **Vite**: dev server and production bundler
- **shadcn/ui**: unstyled accessible components on Radix UI + Tailwind (48+ components in `@/components/ui`)
- **Nostrify** (`@nostrify/react`): Nostr protocol framework
- **React Router**: client-side routing with `BrowserRouter` and automatic scroll-to-top
- **TanStack Query**: data fetching, caching, state
- **TypeScript**: type-safe JS. **Never use the `any` type.**

## Project Structure

- `/src/components/` — UI components. `ui/` holds shadcn/ui primitives; `auth/` holds login components (`LoginArea`, `AuthDialog`, `AccountSwitcher`).
- `/src/hooks/` — custom hooks. Discover the full set with `ls src/hooks/`. Key ones: `useNostr`, `useAuthor`, `useCurrentUser`, `useNostrPublish`, `useUploadFile`, `useAppContext`, `useTheme`, `useToast`, `useLoggedInAccounts`, `useLoginActions`, `useIsMobile`.
- `/src/pages/` — page components wired into React Router (`Index`, `NotFound`, `NIP19Page`).
- `/src/lib/` — utility functions and shared logic.
- `/src/contexts/` — React context providers (`AppContext`).
- `/src/test/` — testing utilities including the `TestApp` wrapper.
- `/public/` — static assets.
- `App.tsx` — **already configured** with `QueryClientProvider`, `NostrProvider`, `UnheadProvider`, `AppProvider`, `NostrLoginProvider`. **Read before editing**; changes are rarely needed.
- `AppRouter.tsx` — React Router configuration. The catch-all `/:nip19` route handles all NIP-19 identifiers (see the `nip19-routing` skill).

**Always read an existing file before modifying it.** Never write over `App.tsx`, `AppRouter.tsx`, or `NostrProvider` without first reading their contents.

## UI Components

Components in `@/components/ui` are unstyled, accessible primitives styled with Tailwind. They follow a consistent React 19 pattern: plain function components that type props via `React.ComponentProps<...>` and forward `ref` as a normal prop (no `React.forwardRef`), tag their root with a `data-slot` attribute, merge classes with the `cn()` utility, and define variants with `class-variance-authority`. Components built on Radix import from the unified `radix-ui` package (e.g. `import { Dialog as DialogPrimitive } from "radix-ui"`), not individual `@radix-ui/react-*` packages. When you need a specific component, list the directory (`ls src/components/ui/`) or import from `@/components/ui/<name>` — all common primitives are present (buttons, inputs, dialogs, dropdowns, forms, tables, etc.).

## System Prompt Management

The assistant's behavior is defined by this file (`AGENTS.md`). Edit it directly to change guidelines — updates take effect the next session. Specialized workflows live in `/.agents/skills/` as loadable skills, discoverable through the `skill` tool.

## Nostr Protocol Integration

### When to reuse an existing NIP vs. create a new kind

1. **Always review existing NIPs first.** Use the NIP index tool, then read candidate NIPs in detail. The goal is to find the closest existing solution.
2. **Prefer extending existing NIPs** over creating custom kinds, even if it requires minor schema compromises. Custom kinds fragment the ecosystem.
3. **When existing NIPs are close but not perfect**, use the existing kind as the base and add domain-specific tags. Document extensions in `NIP.md`.
4. **Only generate a new kind** when no existing NIP covers the core functionality, the data structure is fundamentally different, or the use case needs different storage characteristics (regular/replaceable/addressable).
5. **If a tool to generate a new kind number is available, you MUST use it** — don't pick an arbitrary number.
6. **Custom kinds MUST include a NIP-31 `alt` tag** with a human-readable description.

### Kind Ranges

- **Regular** (1000 ≤ kind < 10000): stored permanently by relays. Notes, articles, etc.
- **Replaceable** (10000 ≤ kind < 20000): only the latest event per `pubkey+kind` is stored. Profile metadata, contact lists.
- **Addressable** (30000 ≤ kind < 40000): identified by `pubkey+kind+d-tag`; only the latest per combo is stored. Articles, long-form content.

Kinds below 1000 are "legacy"; their storage behavior is per-kind (e.g. kind 1 is regular, kind 3 is replaceable).

### Tag Design Principles

- **Kind = schema, tags = semantics.** Don't create new kinds just to represent a different category of the same data.
- **Relays only index single-letter tags.** Use `t` for categories so filters like `'#t': ['electronics']` work at the relay level. Multi-letter tags (`product_type`, etc.) force inefficient client-side filtering.
- **Filter at the relay.** Pass tag filters in the query rather than fetching everything and filtering in JS.
- **For community/niche apps**, tag events with a `t` and query by it: `createEvent({ kind: 1, content, tags: [['t', 'farming']] })`, then `nostr.query([{ kinds: [1], '#t': ['farming'] }])`. Don't do this for generic platforms.

### Content Field Design

- **Use `content` for** large freeform text or existing industry-standard JSON formats (GeoJSON, FHIR, Tiled). Kind 0 is the one exception where structured JSON goes in `content`.
- **Use tags for** queryable metadata and structured data — anything you might filter on.
- **Empty content is fine.** `content: ""` is idiomatic for tag-only events.
- If you need to filter by a field, it **must** be a tag — relays don't index content.

### NIP.md

`NIP.md` documents any custom kinds/schemas this project defines. If the file doesn't exist, this project has no custom kinds. **Whenever you generate a new kind or change a custom schema, create or update `NIP.md`.**

### Nostr Security Model

**CRITICAL:** Nostr private keys (`nsec`) are stored **in plaintext in `localStorage`**. Any JavaScript running on the origin can steal them. A single XSS = permanent, unrecoverable key theft across every Nostr client the user ever touches. **Treat XSS mitigation as the top-priority security concern.**

- **Never** use `dangerouslySetInnerHTML`, `innerHTML`, or `document.write` with event data, URL params, or other untrusted strings.
- **CSP is defense-in-depth**, not primary defense. `index.html` ships a restrictive CSP (`script-src 'self'`, `default-src 'none'`). Never relax it with `'unsafe-eval'`, `'unsafe-inline'` on `script-src`, or wildcard sources.
- **Sanitize every event-sourced URL** (`sanitizeUrl()` — https-only allowlist) before using it as `href`, `src`, iframe `src`, or CSS `url()`.
- **Sanitize every event-sourced string interpolated into CSS**. A malicious `font-family` or `url()` value can break out of the CSS context and inject rules.

Beyond XSS, Nostr is permissionless — signatures prove authorship, not trustworthiness. Filter by `authors` whenever trust is implied:

- **Admin/moderator/owner queries** — filter by trusted pubkeys.
- **Addressable events (kinds 30000–39999)** and **user-owned replaceable events** — filter by `authors`; the `d` tag alone is not a trust boundary.
- **Routes for addressable/replaceable events** — include the author in the URL (e.g. `/article/:npub/:slug`) so the filter can constrain on author.
- **Public UGC** (kind 1 notes, reactions, public feeds, discovery) — author filtering NOT required.

```ts
// ❌ Anyone can spoof this event
nostr.query([{ kinds: [30078], '#d': ['app-organizers'], limit: 1 }]);
// ✅ Only trust admin authors
nostr.query([{ kinds: [30078], authors: ADMIN_PUBKEYS, '#d': ['app-organizers'], limit: 1 }]);
```

For the full threat model — CSP walkthrough, `sanitizeUrl` / `sanitizeCssString` implementations, NIP-72 community moderation, and the pre-merge checklist — load the **`nostr-security`** skill.

### The `useNostr` Hook

```ts
import { useNostr } from '@nostrify/react';

function useCustomHook() {
  const { nostr } = useNostr();
  // nostr.query(filters) / nostr.event(event) / nostr.req(filters)
}
```

By default `nostr` uses the app's connection pool (reads from one relay, publishes to all configured). For targeted single-relay or relay-group calls, load the **`nostr-relay-pools`** skill.

### Querying with TanStack Query

Combine `useNostr` with `useQuery` in custom hooks:

```ts
function usePosts() {
  const { nostr } = useNostr();
  return useQuery({
    queryKey: ['posts'],
    queryFn: async (c) => nostr.query([{ kinds: [1], limit: 15 }], { signal: c.signal }),
  });
}
```

**Efficient query design** — minimize round-trips:

- **Combine kinds** in one filter: `{ kinds: [1, 6, 16], '#e': [eventId] }` and split by kind in JS. Don't run three parallel queries for repost variants.
- **Use multiple filter objects** in one query when different tag filters are needed.
- **Raise `limit`** when combining so you still get enough of each kind.
- Each query costs relay capacity and may count against rate limits.

**Event validation** — for kinds with required tags or strict schemas, filter query results through a validator:

```ts
function isValidCalendarEvent(event: NostrEvent): boolean {
  if (![31922, 31923].includes(event.kind)) return false;
  const d = event.tags.find(([n]) => n === 'd')?.[1];
  const title = event.tags.find(([n]) => n === 'title')?.[1];
  const start = event.tags.find(([n]) => n === 'start')?.[1];
  return Boolean(d && title && start);
}

const events = (await nostr.query([{ kinds: [31922, 31923], limit: 15 }]))
  .filter(isValidCalendarEvent);
```

Validation is optional for loose kinds (kind 1), but strongly recommended for custom kinds and kinds with required tags.

### The `useAuthor` Hook

Fetch profile metadata (kind 0) for a pubkey:

```tsx
import type { NostrEvent, NostrMetadata } from '@nostrify/nostrify';
import { useAuthor } from '@/hooks/useAuthor';

function Post({ event }: { event: NostrEvent }) {
  const author = useAuthor(event.pubkey);
  const metadata: NostrMetadata | undefined = author.data?.metadata;

  const displayName = metadata?.name ?? 'Anonymous';
  const profileImage = metadata?.picture;
  // ...
}
```

The `NostrMetadata` type (from `@nostrify/nostrify`) covers the standard kind-0 fields: `name`, `display_name`, `about`, `picture`, `banner`, `website`, `nip05`, `lud06`, `lud16`, `bot`. Read the type definition from the package if you need the exact field list.

### The `useNostrPublish` Hook

Publishes events (auto-adds a `client` tag). Always guard with `useCurrentUser`:

```tsx
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';

export function MyComponent() {
  const { user } = useCurrentUser();
  const { mutate: createEvent } = useNostrPublish();

  if (!user) return <span>You must be logged in.</span>;

  return (
    <button onClick={() => createEvent({ kind: 1, content: 'hello' })}>
      Publish
    </button>
  );
}
```

### Nostr Login

Use the `LoginArea` component (already in the project). It renders a single "Join" button when logged out (opens an `AuthDialog` supporting signup, extension, nsec, and remote signer) and becomes an account switcher when logged in. **Do not wrap it in conditional logic.**

```tsx
import { LoginArea } from '@/components/auth/LoginArea';

<LoginArea className="max-w-60" />
```

`LoginArea` is inline-flex by default. Pass `flex` or `w-full` to expand it; otherwise set a sensible `max-w-*`.

**Social apps should include a profile/account menu in the main navigation** for access to settings, profile editing, and logout — don't only show `LoginArea` in logged-out states.

### NIP-19 Identifiers

Nostr uses bech32-encoded identifiers (`npub1`, `nprofile1`, `note1`, `nevent1`, `naddr1`, `nsec1`). **All NIP-19 identifiers are routed at the URL root (`/:nip19`)**, handled by `src/pages/NIP19Page.tsx` — never nest them under `/note/`, `/profile/`, etc.

**Filters only accept hex.** Always decode before querying:

```ts
import { nip19 } from 'nostr-tools';

const decoded = nip19.decode(value);
if (decoded.type !== 'naddr') throw new Error('Unsupported identifier');
const { kind, pubkey, identifier } = decoded.data;

nostr.query([{
  kinds: [kind],
  authors: [pubkey],        // critical for addressable events
  '#d': [identifier],
}]);
```

Never treat `nsec1` or unknown prefixes as anything but a 404.

**For full details** (identifier-type comparison, populating `NIP19Page`, building NIP-19 links, security patterns), load the **`nip19-routing`** skill.

### File Uploads, Encryption, Multi-Relay

These are specialized workflows — load the matching skill when needed:

- **`file-uploads`** — `useUploadFile` + Blossom + NIP-94 `imeta` tags.
- **`nostr-encryption`** — NIP-44 / NIP-04 via the user's signer (DMs, gift wraps, private content).
- **`nostr-relay-pools`** — `nostr.relay(url)` / `nostr.group([urls])` for targeted queries.

## App Configuration

The `AppProvider` manages global state (theme + NIP-65 relay list), persisted to local storage.

```ts
const defaultConfig: AppConfig = {
  theme: 'light',
  relayMetadata: {
    relays: [
      { url: 'wss://relay.ditto.pub', read: true, write: true },
      { url: 'wss://relay.primal.net', read: true, write: true },
      { url: 'wss://relay.damus.io', read: true, write: true },
    ],
    updatedAt: 0,
  },
};
```

### Relay Management

- **`NostrSync`** auto-loads the user's NIP-65 relay list on login and writes it into `AppContext`.
- **Automatic publishing** — updating the relay config publishes a new kind 10002 event when the user is logged in.
- A drop-in settings UI (`RelayListManager`) is available as the **`relay-management`** skill.

## Routing

Routes live in `AppRouter.tsx`. To add one:

1. Create the page component in `src/pages/`.
2. Import it in `AppRouter.tsx`.
3. Add the route **above** the catch-all `*` route:

```tsx
<Route path="/your-path" element={<YourComponent />} />
```

The router provides automatic scroll-to-top on navigation and a 404 `NotFound` page. The `/:nip19` route is already wired (see the `nip19-routing` skill).

## Design Standards

Designs should be polished and production-ready. Concrete rules:

- **Responsive** down to ~360px; test mobile, tablet, desktop.
- **WCAG 2.1 AA**: ≥ 4.5:1 contrast for body text, ≥ 3:1 for large text and UI elements. Full keyboard nav, ARIA labels, visible `focus-visible` rings.
- **8px grid** for spacing (Tailwind's 4-based scale). Don't sprinkle `p-[13px]`-style one-offs.
- **Typography hierarchy**: ≥ 18px body, ≥ 40px primary headlines. Prefer a modern sans (e.g. Inter) for UI and pair a display/serif for headings when personality is needed.
- **Depth**: soft shadows, gentle gradients, rounded corners (`rounded-lg` / `rounded-xl`). Avoid heavy drop shadows.
- **Motion**: lightweight, purposeful (hover, scroll reveals, transitions). Respect `prefers-reduced-motion` with Tailwind's `motion-safe:` / `motion-reduce:` variants.
- **Reusable components**: consistent variants and feedback states (`hover`, `focus-visible`, `active`, `disabled`, `aria-invalid`). Use `cn()` for conditional classes and `class-variance-authority` for variants (copy an existing `ui/` component as a template).
- **Custom over generic**: avoid template-looking headers — combine layered visuals, subtle motion, and brand colors. Generate custom images with available tools before reaching for stock.

### Loading and Empty States

**Use skeletons** for structured content (feeds, profiles, forms). **Use spinners** only for buttons or short operations.

```tsx
<Card>
  <CardHeader>
    <div className="flex items-center space-x-3">
      <Skeleton className="h-10 w-10 rounded-full" />
      <div className="space-y-1">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  </CardHeader>
  <CardContent>
    <div className="space-y-2">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-4/5" />
    </div>
  </CardContent>
</Card>
```

For empty results, show a minimalist empty state in a `border-dashed` card:

```tsx
<Card className="border-dashed">
  <CardContent className="py-12 px-8 text-center">
    <p className="text-muted-foreground max-w-sm mx-auto">
      No results found. Try checking your relay connections or wait a moment for content to load.
    </p>
  </CardContent>
</Card>
```

For font installation, color-scheme changes, light/dark theming, or the `isolate` + negative-z-index gotcha, load the **`theming`** skill.

## Writing Tests vs. Running Tests

**Running the existing test script — always do it.** After any code change, run the project's test/validation script. **Your task is not complete until it passes.** The script typically covers TypeScript compilation, ESLint, and existing tests.

**Writing new test files — don't, unless the user asks.** If the user explicitly requests tests, describes a bug to diagnose with a test, or reports that a problem persists after a fix, load the **`testing`** skill for the project's Vitest + `TestApp` setup and policy.

## Validating Your Changes

**Your task is not finished until the code type-checks and builds without errors.** In priority order:

1. **Type check** (required)
2. **Build/compile** (required)
3. **Lint** (recommended; fix anything critical)
4. **Run tests** (if available)
5. **Git commit** (required)

### Using Git

Use `git status` / `git diff` to review changes and `git log` to learn project conventions. If you make a mistake, `git checkout` restores files.

**Always commit when you are finished.** Non-negotiable — every completed task ends with a commit. Don't wait for the user to ask.
