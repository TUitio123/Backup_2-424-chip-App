/**
 * NTAG 424 DNA TagTamper — JavaScript Bridge
 *
 * Java-Plugin API (name = "Ntag424"):
 *   Methods:  startScan()                    → resolves immediately, fires "tagRead" events
 *             stopScan()                     → stops scanning
 *             writeStatus(uid, status, keys) → writes status string to NDEF file 2 on chip
 *             readStatus(uid)                → reads status string back from chip (verify)
 *   Events:   "tagRead" → { uid, tamperStatus, debug }
 *
 * Status values stored on chip (NDEF file 2, max 32 bytes plain text):
 *   "valid"               – Schein aufgeladen, einsatzbereit
 *   "invalid"             – Schein entwertet / ausgegeben
 *   "entwertenbeantragt"  – Entwertung beantragt, noch nicht vollzogen
 */

import { registerPlugin } from '@capacitor/core';

// ─── Plugin interface ─────────────────────────────────────────────────────────

interface WriteStatusResult {
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
}

interface ReadStatusResult {
  success: boolean;
  status?: string;
  errorCode?: string;
  errorMessage?: string;
}

interface Ntag424Plugin {
  startScan(): Promise<void>;
  stopScan(): Promise<void>;
  writeStatus(options: { uid: string; status: string; appMasterKey: string; fileWriteKey: string }): Promise<WriteStatusResult>;
  readStatus(options: { uid: string; appMasterKey: string; fileReadKey: string }): Promise<ReadStatusResult>;
  addListener(
    event: 'tagRead',
    handler: (data: { uid: string; tamperStatus: string; debug: string }) => void
  ): Promise<{ remove: () => void }>;
  removeAllListeners(): Promise<void>;
}

const Ntag424 = registerPlugin<Ntag424Plugin>('Ntag424');

// ─── Public types ─────────────────────────────────────────────────────────────

export type TamperStatus = 'CC' | 'OC' | 'OO' | 'II' | 'AUTH_REQUIRED' | 'UNKNOWN';
export type ScanStatus   = 'idle' | 'scanning' | 'success' | 'error' | 'unsupported';
export type ChipStatus   = 'valid' | 'invalid' | 'entwertenbeantragt';

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
  onError: (message: string) => void,
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
    onError(`NFC Fehler: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function stopNativeScan(): Promise<void> {
  if (listenerHandle) {
    listenerHandle.remove();
    listenerHandle = null;
  }
  try { await Ntag424.stopScan(); } catch { /* ignore */ }
}

// ─── Status schreiben / lesen ─────────────────────────────────────────────────

/**
 * Schreibt den Status-String auf den Chip (NDEF File 2).
 * Keys werden aus dem keys/<UID>.json file geladen (32 Nullen = default).
 */
export async function writeChipStatus(
  uid: string,
  status: ChipStatus,
  keys: { appMasterKey: string; fileWriteKey: string },
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await Ntag424.writeStatus({
      uid,
      status,
      appMasterKey: keys.appMasterKey,
      fileWriteKey: keys.fileWriteKey,
    });
    if (!result.success) {
      return { success: false, error: result.errorMessage ?? result.errorCode ?? 'Unbekannter Fehler' };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Liest den Status-String zurück vom Chip (Verifikation).
 */
export async function readChipStatus(
  uid: string,
  keys: { appMasterKey: string; fileReadKey: string },
): Promise<{ success: boolean; status?: ChipStatus; error?: string }> {
  try {
    const result = await Ntag424.readStatus({
      uid,
      appMasterKey: keys.appMasterKey,
      fileReadKey: keys.fileReadKey,
    });
    if (!result.success || !result.status) {
      return { success: false, error: result.errorMessage ?? result.errorCode ?? 'Lesen fehlgeschlagen' };
    }
    const s = result.status.trim().toLowerCase();
    const status: ChipStatus =
      s === 'invalid' ? 'invalid' :
      s === 'entwertenbeantragt' ? 'entwertenbeantragt' :
      'valid';
    return { success: true, status };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeTamperStatus(raw: string): TamperStatus {
  switch (raw) {
    case 'CC':             return 'CC';
    case 'OC':             return 'OC';
    case 'OO':             return 'OO';
    case 'II':             return 'II';
    case 'AUTH_REQUIRED':  return 'AUTH_REQUIRED';
    default:               return 'UNKNOWN';
  }
}

export interface StatusDisplay {
  label: string;
  description: string;
  color: 'green' | 'red' | 'yellow' | 'gray' | 'orange';
}

export function getStatusDisplay(status: TamperStatus): StatusDisplay {
  switch (status) {
    case 'CC': return { label: 'INTAKT',           description: 'Tamper-Draht unbeschädigt.',         color: 'green'  };
    case 'OO': return { label: 'MANIPULIERT',      description: 'Tamper-Draht beschädigt!',            color: 'red'    };
    case 'OC': return { label: 'EINMAL GEÖFFNET',  description: 'War beschädigt, jetzt wieder OK.',    color: 'yellow' };
    case 'II': return { label: 'NICHT AKTIVIERT',  description: 'Tamper-Feature nicht konfiguriert.',  color: 'gray'   };
    case 'AUTH_REQUIRED': return { label: 'AUTH ERFORDERLICH', description: 'Auth nötig.',             color: 'orange' };
    default:   return { label: 'UNBEKANNT',        description: 'Status unbekannt.',                   color: 'gray'   };
  }
}
