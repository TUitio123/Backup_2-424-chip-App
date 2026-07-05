/**
 * NTAG 424 DNA TagTamper — JavaScript Bridge
 *
 * Java-Plugin API (name = "Ntag424"):
 *   Methods:  startScan()                    → resolves immediately, fires "tagRead" events
 *             stopScan()                     → stops scanning
 *             writeStatus(uid, status, keys) → writes status string to NDEF file 2 on chip
 *             readStatus(uid)                → reads status string back from chip (verify)
 *   Events:   "tagRead" → { uid, chipStatus, chipSats, debug }
 *
 * Status values stored on chip (File 02, max 32 bytes plain text):
 *   "valid"               – Schein aufgeladen, einsatzbereit
 *   "invalid"             – Schein entwertet / ausgegeben
 *   "entwertenbeantragt"  – Entwertung beantragt, noch nicht vollzogen
 *
 * Sats stored on chip (File 03, 4-byte big-endian int):
 *   The satoshi amount as registered on the chip at issuance time.
 */

import { registerPlugin } from '@capacitor/core';

// ─── Plugin interface ─────────────────────────────────────────────────────────

interface WriteStatusResult {
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  dump?: string;
}

interface ReadStatusResult {
  success: boolean;
  status?: string;
  errorCode?: string;
  errorMessage?: string;
  dump?: string;
}

interface Ntag424Plugin {
  startScan(): Promise<void>;
  stopScan(): Promise<void>;
  writeStatus(options: { uid: string; status: string; appMasterKey: string; fileWriteKey: string }): Promise<WriteStatusResult>;
  readStatus(options: { uid: string; appMasterKey: string; fileReadKey: string }): Promise<ReadStatusResult>;
  addListener(
    event: 'tagRead',
    handler: (data: { uid: string; chipStatus: string; chipSats: number; debug: string }) => void
  ): Promise<{ remove: () => void }>;
  removeAllListeners(): Promise<void>;
}

const Ntag424 = registerPlugin<Ntag424Plugin>('Ntag424');

// ─── Public types ─────────────────────────────────────────────────────────────

export type ScanStatus = 'idle' | 'scanning' | 'success' | 'error' | 'unsupported';
export type ChipStatus = 'valid' | 'invalid' | 'entwertenbeantragt';

export interface ScanResult {
  uid: string;
  /** Status direkt vom Chip gelesen (File 02) */
  chipStatus: ChipStatus;
  /** Sats direkt vom Chip gelesen (File 03), 0 wenn nicht geschrieben */
  chipSats: number;
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
      const rawStatus = (data.chipStatus ?? '').trim().toLowerCase();
      const chipStatus: ChipStatus =
        rawStatus === 'invalid' ? 'invalid' :
        rawStatus === 'entwertenbeantragt' ? 'entwertenbeantragt' :
        'valid';

      onResult({
        uid: data.uid,
        chipStatus,
        chipSats: typeof data.chipSats === 'number' ? data.chipSats : 0,
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
 * Schreibt den Status-String auf den Chip (File 02).
 */
export async function writeChipStatus(
  uid: string,
  status: ChipStatus,
  keys: { appMasterKey: string; fileWriteKey: string },
): Promise<{ success: boolean; error?: string; dump?: string }> {
  try {
    const result = await Ntag424.writeStatus({
      uid,
      status,
      appMasterKey: keys.appMasterKey,
      fileWriteKey: keys.fileWriteKey,
    });
    if (!result.success) {
      return { success: false, error: result.errorMessage ?? result.errorCode ?? 'Unbekannter Fehler', dump: result.dump };
    }
    return { success: true, dump: result.dump };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Liest den Status-String zurück vom Chip (Verifikation nach Schreiben).
 */
export async function readChipStatus(
  uid: string,
  keys: { appMasterKey: string; fileReadKey: string },
): Promise<{ success: boolean; status?: ChipStatus; error?: string; dump?: string }> {
  try {
    const result = await Ntag424.readStatus({
      uid,
      appMasterKey: keys.appMasterKey,
      fileReadKey: keys.fileReadKey,
    });
    if (!result.success || !result.status) {
      return { success: false, error: result.errorMessage ?? result.errorCode ?? 'Lesen fehlgeschlagen', dump: result.dump };
    }
    const s = result.status.trim().toLowerCase();
    const status: ChipStatus =
      s === 'invalid' ? 'invalid' :
      s === 'entwertenbeantragt' ? 'entwertenbeantragt' :
      'valid';
    return { success: true, status, dump: result.dump };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
