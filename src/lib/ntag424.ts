/**
 * NTAG 424 DNA TagTamper — JavaScript Bridge
 *
 * Java-Plugin API (name = "Ntag424"):
 *   Methods:  startScan()  → resolves immediately, then fires events
 *             stopScan()   → stops scanning
 *   Events:   "tagRead"    → { uid: string, tamperStatus: string, debug: string }
 *
 * Tamper status values returned by the chip:
 *   "CC"            – wire intact, not tampered
 *   "OC"            – was damaged in past, now appears OK
 *   "OO"            – currently damaged / tampered
 *   "II"            – tamper feature not initialized
 *   "AUTH_REQUIRED" – chip needs authentication first
 *   "UNKNOWN"       – could not be determined
 */

import { registerPlugin } from '@capacitor/core';

// ─── Plugin interface ─────────────────────────────────────────────────────────

interface Ntag424Plugin {
  startScan(): Promise<void>;
  stopScan(): Promise<void>;
  addListener(
    event: 'tagRead',
    handler: (data: { uid: string; tamperStatus: string; debug: string }) => void
  ): Promise<{ remove: () => void }>;
  removeAllListeners(): Promise<void>;
}

const Ntag424 = registerPlugin<Ntag424Plugin>('Ntag424');

// ─── Public types ─────────────────────────────────────────────────────────────

export type TamperStatus = 'CC' | 'OC' | 'OO' | 'II' | 'AUTH_REQUIRED' | 'UNKNOWN';
export type ScanStatus = 'idle' | 'scanning' | 'success' | 'error' | 'unsupported';

export interface ScanResult {
  uid: string;
  tamperStatus: TamperStatus;
  timestamp: number;
  debug?: string;
}

// ─── Plugin availability ──────────────────────────────────────────────────────

export function isNativeAvailable(): boolean {
  return !!(
    (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor?.isNativePlatform?.()
  );
}

// ─── Scanner ──────────────────────────────────────────────────────────────────

let listenerHandle: { remove: () => void } | null = null;

export async function startNativeScan(
  onResult: (result: ScanResult) => void,
  onError: (message: string) => void
): Promise<void> {
  await stopNativeScan();

  try {
    listenerHandle = await Ntag424.addListener('tagRead', (data) => {
      onResult({
        uid: data.uid,
        tamperStatus: normalizeTamperStatus(data.tamperStatus),
        timestamp: Date.now(),
        debug: data.debug,
      });
    });

    await Ntag424.startScan();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onError(`NFC Fehler: ${msg}`);
  }
}

export async function stopNativeScan(): Promise<void> {
  if (listenerHandle) {
    listenerHandle.remove();
    listenerHandle = null;
  }
  try {
    await Ntag424.stopScan();
  } catch {
    // ignore — may not be scanning
  }
}

function normalizeTamperStatus(raw: string): TamperStatus {
  switch (raw) {
    case 'CC': return 'CC';
    case 'OC': return 'OC';
    case 'OO': return 'OO';
    case 'II': return 'II';
    case 'AUTH_REQUIRED': return 'AUTH_REQUIRED';
    default: return 'UNKNOWN';
  }
}

// ─── Display helpers ──────────────────────────────────────────────────────────

export interface StatusDisplay {
  label: string;
  description: string;
  color: 'green' | 'red' | 'yellow' | 'gray' | 'orange';
}

export function getStatusDisplay(status: TamperStatus): StatusDisplay {
  switch (status) {
    case 'CC': return {
      label: 'INTAKT',
      description: 'Tamper-Draht unbeschädigt – Produkt wurde nicht geöffnet.',
      color: 'green',
    };
    case 'OO': return {
      label: 'MANIPULIERT',
      description: 'Tamper-Draht beschädigt – Produkt wurde geöffnet oder manipuliert!',
      color: 'red',
    };
    case 'OC': return {
      label: 'EINMAL GEÖFFNET',
      description: 'Tamper-Draht war beschädigt und scheint jetzt wiederhergestellt.',
      color: 'yellow',
    };
    case 'II': return {
      label: 'NICHT AKTIVIERT',
      description: 'Tamper-Funktion auf diesem Chip nicht konfiguriert.',
      color: 'gray',
    };
    case 'AUTH_REQUIRED': return {
      label: 'AUTH ERFORDERLICH',
      description: 'Chip erfordert Authentifizierung für GetTTStatus.',
      color: 'orange',
    };
    default: return {
      label: 'UNBEKANNT',
      description: 'Status konnte nicht gelesen werden.',
      color: 'gray',
    };
  }
}
