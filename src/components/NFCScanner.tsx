/**
 * NFCScanner.tsx
 *
 * Haupt-UI für die NTAG 424 Scanner-App.
 *
 * Features:
 * - Scan → liest UID + Status + Sats direkt vom Chip (Java-Plugin)
 * - Link zeigt nur diesen einen Chip: backuphip.shakespeare.wtf?chip=UID
 * - Status und Betrag kommen direkt vom Chip, nicht aus lokaler DB
 * - Entwerten-Flow:
 *     1. App schreibt "invalid" auf Chip
 *     2. App verifiziert: liest Chip zurück → Status muss "invalid" sein
 *     3. Benutzer gibt Lightning-Invoice (BOLT11) oder Adresse (LNURL) ein
 *     4. Betrag im Invoice muss = chipSats entsprechen
 *     5. Website zahlt aus (via Admin-Key), speichert dauerhaft
 *     6. Erst nach Bestätigung (Kind 3493) + neuer Aufladung darf wieder "valid" gesetzt werden
 * - APDU Dump-Log (alles was vom Chip kommt, sichtbar per Toggle)
 * - Seriöses, klares Design
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Wifi, WifiOff, CheckCircle, XCircle,
  RefreshCw, Copy, Zap,
  ShieldAlert, Globe, Upload, Loader2,
  Check, ShieldCheck, ShieldX, AlertTriangle, ExternalLink,
  Terminal, Eye, EyeOff, Send,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ScanResult, ScanStatus,
  isNativeAvailable, startNativeScan, stopNativeScan,
  writeChipStatus, readChipStatus, ChipStatus,
} from '@/lib/ntag424';
import {
  lookupChip, ChipEntry,
  KIND_VERIFY_LOG, KIND_RELOAD_REQUEST, KIND_INVALIDATE_REQUEST, APP_TAG,
} from '@/lib/chipRegistry';
import { useToast } from '@/hooks/useToast';
import { usePaymentConfirmed } from '@/hooks/usePaymentConfirmed';
import { usePublishAnonymous } from '@/hooks/usePublishAnonymous';
import { LNBITS_CONFIG, calcReloadFee } from '@/lib/lnbitsConfig';

// ─── Constants ────────────────────────────────────────────────────────────────

const WEBSITE_BASE = 'https://backuphip.shakespeare.wtf';

function chipWebsiteUrl(uid: string) {
  return `${WEBSITE_BASE}/${uid}`;
}

const DEFAULT_KEYS = {
  appMasterKey: '00000000000000000000000000000000',
  fileReadKey:  '00000000000000000000000000000000',
  fileWriteKey: '00000000000000000000000000000000',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSats(n: number): string {
  return n.toLocaleString('de-DE') + ' sats';
}

// ─── Chip-Status Badge ────────────────────────────────────────────────────────

function ChipStatusBadge({ status }: { status: ChipStatus }) {
  if (status === 'valid')
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold"
        style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: '#34d399' }}>
        <ShieldCheck className="w-4 h-4" />
        VALID — aufgeladen
      </span>
    );
  if (status === 'entwertenbeantragt')
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold"
        style={{ background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.3)', color: '#fb923c' }}>
        <AlertTriangle className="w-4 h-4" />
        Entwertung beantragt
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold"
      style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
      <ShieldX className="w-4 h-4" />
      INVALID — entwertet
    </span>
  );
}

// ─── APDU Dump Log ────────────────────────────────────────────────────────────

function DumpLog({ dump }: { dump: string }) {
  const [open, setOpen] = useState(false);
  if (!dump) return null;
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-white/5 transition-colors"
        style={{ background: 'rgba(255,255,255,0.03)' }}>
        <span className="flex items-center gap-2 text-xs font-mono font-bold"
          style={{ color: 'rgba(255,255,255,0.4)' }}>
          <Terminal className="w-3.5 h-3.5" style={{ color: '#f7931a' }} />
          APDU Dump Log
        </span>
        {open
          ? <EyeOff className="w-3.5 h-3.5" style={{ color: 'rgba(255,255,255,0.25)' }} />
          : <Eye className="w-3.5 h-3.5" style={{ color: 'rgba(255,255,255,0.25)' }} />}
      </button>
      {open && (
        <div className="px-3 py-3 font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-all"
          style={{
            background: 'rgba(0,0,0,0.4)',
            color: '#4ade80',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            maxHeight: '260px',
            overflowY: 'auto',
          }}>
          {dump}
        </div>
      )}
    </div>
  );
}

// ─── Result card ──────────────────────────────────────────────────────────────

function ResultCard({ scan, chip }: { scan: ScanResult; chip: ChipEntry | null }) {
  const isKnown = chip !== null;
  const borderColor = isKnown ? 'rgba(247,147,26,0.2)' : 'rgba(239,68,68,0.2)';
  const bgColor     = isKnown ? 'rgba(247,147,26,0.03)' : 'rgba(239,68,68,0.04)';

  return (
    <div className="rounded-2xl p-5 space-y-4" style={{ background: bgColor, border: `1px solid ${borderColor}` }}>
      {/* Header row */}
      <div className="flex items-start gap-4">
        {/* Bitcoin icon */}
        <div className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(247,147,26,0.1)', border: '1px solid rgba(247,147,26,0.2)' }}>
          <span className="text-2xl">₿</span>
        </div>
        <div className="flex-1 min-w-0">
          {chip ? (
            <>
              <div className="text-2xl font-black tracking-tight" style={{ color: '#f7931a' }}>
                {/* Bevorzuge chipSats vom Chip wenn > 0, sonst Fallback aus Registry */}
                {formatSats(scan.chipSats > 0 ? scan.chipSats : chip.sats)}
              </div>
              {scan.chipSats > 0 && scan.chipSats !== chip.sats && (
                <div className="text-[10px] mt-0.5" style={{ color: 'rgba(255,165,0,0.6)' }}>
                  Chip: {formatSats(scan.chipSats)} · Registry: {formatSats(chip.sats)}
                </div>
              )}
              {chip.issuedAt && (
                <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  Ausgegeben: {chip.issuedAt}
                </div>
              )}
            </>
          ) : (
            <div className="text-lg font-bold" style={{ color: '#f87171' }}>
              Chip nicht registriert
            </div>
          )}
          <div className="font-mono text-[10px] mt-1.5 break-all" style={{ color: 'rgba(255,255,255,0.3)' }}>
            {scan.uid}
          </div>
        </div>
      </div>

      {/* Status from chip */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color: 'rgba(255,255,255,0.25)' }}>
          Chip-Status:
        </span>
        <ChipStatusBadge status={scan.chipStatus} />
      </div>

      {/* Raw NDEF text */}
      {scan.ndefText && (
        <div className="rounded-lg px-2.5 py-1.5"
          style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <span className="text-[9px] uppercase tracking-wider font-bold mr-2"
            style={{ color: 'rgba(255,255,255,0.2)' }}>NDEF:</span>
          <span className="font-mono text-[10px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
            {scan.ndefText}
          </span>
        </div>
      )}

      {/* Website link — zeigt die volle URL mit Chip-ID */}
      {chip && (
        <a
          href={chipWebsiteUrl(chip.uid)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between w-full px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all hover:scale-[1.01] active:scale-[0.99]"
          style={{ background: 'rgba(247,147,26,0.1)', border: '1px solid rgba(247,147,26,0.25)', color: '#f7931a' }}>
          <span className="flex items-center gap-2 min-w-0">
            <Globe className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">backuphip.shakespeare.wtf/{chip.uid}</span>
          </span>
          <ExternalLink className="w-3.5 h-3.5 flex-shrink-0 ml-2" />
        </a>
      )}
    </div>
  );
}

// ─── UID copy row ─────────────────────────────────────────────────────────────

function UIDRow({ uid }: { uid: string }) {
  const { toast } = useToast();
  return (
    <div className="flex items-center justify-between rounded-xl px-3 py-2.5"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider mb-0.5 font-bold" style={{ color: 'rgba(255,255,255,0.2)' }}>
          Chip UID
        </div>
        <div className="font-mono text-xs tracking-widest truncate" style={{ color: 'rgba(255,255,255,0.7)' }}>
          {uid}
        </div>
      </div>
      <button
        onClick={() => navigator.clipboard.writeText(uid).then(() => toast({ title: 'UID kopiert' })).catch(() => {})}
        className="p-2 rounded-lg transition-colors hover:bg-white/5 flex-shrink-0"
        style={{ color: 'rgba(255,255,255,0.3)' }}>
        <Copy className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── Scan button ──────────────────────────────────────────────────────────────

function ScanButton({ status, hasResult, onScan, onStop }: {
  status: ScanStatus; hasResult: boolean; onScan: () => void; onStop: () => void;
}) {
  const scanning = status === 'scanning';
  return (
    <button
      onClick={scanning ? onStop : onScan}
      disabled={status === 'unsupported'}
      className={cn(
        'relative w-36 h-36 rounded-full flex flex-col items-center justify-center gap-2',
        'border-2 transition-all duration-300 select-none focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-500',
        status === 'idle'        && 'border-amber-500/40 hover:border-amber-400/70 active:scale-95 cursor-pointer',
        scanning                 && 'border-amber-400/60 animate-pulse cursor-pointer',
        status === 'error'       && 'border-red-500/40 hover:border-red-400/60 cursor-pointer',
        status === 'unsupported' && 'border-slate-700 cursor-not-allowed opacity-40',
      )}
      style={{
        background: scanning
          ? 'radial-gradient(circle, rgba(247,147,26,0.12) 0%, rgba(247,147,26,0.04) 100%)'
          : status === 'error'
            ? 'radial-gradient(circle, rgba(239,68,68,0.1) 0%, rgba(239,68,68,0.03) 100%)'
            : 'radial-gradient(circle, rgba(247,147,26,0.08) 0%, rgba(247,147,26,0.02) 100%)',
      }}>
      {scanning && (
        <>
          <span className="absolute inset-0 rounded-full border-2 border-amber-400/20 animate-ping" />
          <span className="absolute -inset-2 rounded-full border border-amber-400/10 animate-ping" style={{ animationDelay: '0.5s' }} />
        </>
      )}
      <div className="relative z-10">
        {status === 'error'       && <XCircle className="w-9 h-9" style={{ color: '#f87171' }} />}
        {status === 'unsupported' && <WifiOff className="w-9 h-9 text-slate-500" />}
        {(status === 'idle' || scanning) && (
          <Wifi className="w-9 h-9" style={{ color: scanning ? '#fbbf24' : '#f7931a' }} />
        )}
      </div>
      <span className={cn(
        'relative z-10 text-[11px] font-bold tracking-widest uppercase',
        status === 'idle'        && 'text-amber-500/70',
        scanning                 && 'text-amber-300/80',
        status === 'error'       && 'text-red-400',
        status === 'unsupported' && 'text-slate-500',
      )}>
        {status === 'idle'          && 'Scannen'}
        {scanning && !hasResult     && 'Warte…'}
        {scanning && hasResult      && 'Scannt…'}
        {status === 'error'         && 'Retry'}
        {status === 'unsupported'   && 'N/A'}
      </span>
    </button>
  );
}

// ─── Entwerten Flow ───────────────────────────────────────────────────────────
// Flow:
// 1. Confirm → write "invalid" to chip
// 2. Verify: tap chip again → must read back "invalid"
// 3. Input Lightning invoice (BOLT11 lnbc... or Lightning address user@domain)
// 4. Amount check: invoice amount must match chipSats
// 5. Send invoice to website via Nostr Kind-3492 + invoice
// 6. Website pays via adminKey, confirms via Kind-3493
// 7. Only after Kind-3493 confirmed → show "Entwertet ✅"

type EntwertStep =
  | 'confirm'
  | 'writing'
  | 'tap_verify'
  | 'verifying'
  | 'invoice_input'
  | 'sending'
  | 'waiting_payment'
  | 'done'
  | 'error';

interface EntwertFlowProps {
  scan: ScanResult;
  chip: ChipEntry;
  onClose: () => void;
  onDone: () => void;
}

function EntwertFlow({ scan, chip, onClose, onDone }: EntwertFlowProps) {
  const [step,        setStep]        = useState<EntwertStep>('confirm');
  const [errorMsg,    setErrorMsg]    = useState('');
  const [invoice,     setInvoice]     = useState('');
  const [invoiceErr,  setInvoiceErr]  = useState('');
  const [dumpLog,     setDumpLog]     = useState('');
  const { mutateAsync: publishEvent } = usePublishAnonymous();
  const { toast } = useToast();

  // chipSats: from chip if available, else from registry
  const sats = scan.chipSats > 0 ? scan.chipSats : chip.sats;

  // ── Step 1: Write invalid to chip ────────────────────────────────────────
  const doWrite = useCallback(async () => {
    setStep('writing');
    const result = await writeChipStatus(scan.uid, 'invalid', DEFAULT_KEYS);
    if (result.dump) setDumpLog(prev => prev + '\n--- WRITE ---\n' + result.dump);
    if (!result.success) {
      setErrorMsg(result.error ?? 'Schreiben fehlgeschlagen');
      setStep('error');
      return;
    }
    toast({ title: '✅ "invalid" auf Chip geschrieben', description: 'Jetzt Chip nochmal ranhalten zum Verifizieren.' });
    setStep('tap_verify');
  }, [scan.uid, toast]);

  // ── Step 2: Verify: read back status ─────────────────────────────────────
  const doVerify = useCallback(async () => {
    setStep('verifying');
    const result = await readChipStatus(scan.uid, DEFAULT_KEYS);
    if (result.dump) setDumpLog(prev => prev + '\n--- VERIFY ---\n' + result.dump);
    if (!result.success) {
      setErrorMsg(result.error ?? 'Lesen fehlgeschlagen');
      setStep('error');
      return;
    }
    if (result.status !== 'invalid') {
      setErrorMsg(`Chip zeigt "${result.status}" statt "invalid" — Schreiben fehlgeschlagen!`);
      setStep('error');
      return;
    }
    toast({ title: '✅ Verifiziert: Chip ist invalid', description: 'Gib jetzt deine Lightning-Invoice ein.' });
    setStep('invoice_input');
  }, [scan.uid, toast]);

  // ── Step 3: Validate + send invoice ──────────────────────────────────────
  const validateAndSend = useCallback(async () => {
    const raw = invoice.trim();
    if (!raw) { setInvoiceErr('Bitte Invoice eingeben'); return; }

    // Simple BOLT11 check: starts with lnbc
    const isBolt11 = raw.toLowerCase().startsWith('lnbc');
    // LNURL / Lightning address
    const isLightningAddr = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw);
    const isLnurl = raw.toLowerCase().startsWith('lnurl') || raw.toLowerCase().startsWith('lightning:');

    if (!isBolt11 && !isLightningAddr && !isLnurl) {
      setInvoiceErr('Ungültig — BOLT11 (lnbc...) oder Lightning-Adresse (user@domain.de) eingeben');
      return;
    }

    // If BOLT11: decode amount and compare
    if (isBolt11) {
      const decoded = decodeBolt11Amount(raw);
      if (decoded !== null && decoded !== sats) {
        setInvoiceErr(
          `Betrag stimmt nicht: Invoice hat ${formatSats(decoded)}, erwartet werden ${formatSats(sats)}`
        );
        return;
      }
    }

    setInvoiceErr('');
    setStep('sending');

    try {
      await publishEvent({
        kind: KIND_INVALIDATE_REQUEST,
        content: JSON.stringify({
          uid: scan.uid,
          label: chip.label,
          sats,
          invoice: raw,
          chipStatus: 'invalid',  // confirmed by verify step
        }),
        tags: [['t', APP_TAG], ['alt', 'Bitcoin Note invalidation + payout request']],
      });
      toast({ title: '📤 Anfrage gesendet', description: 'Website prüft und zahlt aus…' });
      setStep('waiting_payment');
    } catch (e) {
      setErrorMsg(String(e));
      setStep('error');
    }
  }, [invoice, sats, scan.uid, chip, publishEvent, toast]);

  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(239,68,68,0.25)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3"
        style={{ background: 'rgba(239,68,68,0.06)', borderBottom: '1px solid rgba(239,68,68,0.12)' }}>
        <span className="font-bold text-sm flex items-center gap-2" style={{ color: '#f87171' }}>
          <ShieldX className="w-4 h-4" />
          Entwerten
        </span>
        <button onClick={onClose} className="text-xs px-2 py-1 rounded-lg transition-colors hover:bg-white/5"
          style={{ color: 'rgba(255,255,255,0.3)' }}>
          ✕
        </button>
      </div>

      <div className="p-4 space-y-4">

        {/* Progress indicator */}
        <div className="flex items-center gap-1">
          {(['confirm','writing/tap_verify/verifying','invoice_input/sending','waiting_payment','done'] as const).map((_, i) => {
            const stepNum = ['confirm','writing','tap_verify','verifying','invoice_input','sending'].indexOf(step);
            const done = i < Math.floor(stepNum / 1.5);
            return (
              <div key={i} className="flex-1 h-1 rounded-full transition-all"
                style={{ background: done ? '#f87171' : 'rgba(255,255,255,0.08)' }} />
            );
          })}
        </div>

        {step === 'confirm' && (
          <div className="space-y-3 text-center">
            <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <ShieldX className="w-6 h-6" style={{ color: '#f87171' }} />
            </div>
            <div>
              <p className="font-bold text-sm" style={{ color: '#f87171' }}>Schein wirklich entwerten?</p>
              <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.35)' }}>
                {formatSats(sats)} · {scan.uid}
              </p>
              <p className="text-xs mt-2" style={{ color: 'rgba(255,255,255,0.4)' }}>
                Der Chip wird auf "invalid" gesetzt. Danach gibst du deine Lightning-Invoice ein und die Website zahlt die Sats aus.
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={onClose}
                className="flex-1 h-9 rounded-xl text-xs font-bold transition-all"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)' }}>
                Abbrechen
              </button>
              <button onClick={doWrite}
                className="flex-1 h-9 rounded-xl text-xs font-bold transition-all"
                style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
                Chip jetzt ranhalten →
              </button>
            </div>
          </div>
        )}

        {step === 'writing' && (
          <div className="text-center py-4 space-y-2">
            <Loader2 className="w-8 h-8 animate-spin mx-auto" style={{ color: '#f87171' }} />
            <p className="text-sm font-bold" style={{ color: '#f87171' }}>Schreibe "invalid" auf Chip…</p>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>Chip festhalten</p>
          </div>
        )}

        {step === 'tap_verify' && (
          <div className="text-center space-y-3 py-2">
            <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center animate-pulse"
              style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)' }}>
              <Wifi className="w-6 h-6" style={{ color: '#60a5fa' }} />
            </div>
            <p className="font-bold text-sm" style={{ color: '#60a5fa' }}>Chip nochmal ranhalten zur Verifikation</p>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>App prüft ob "invalid" korrekt geschrieben wurde</p>
            <button onClick={doVerify}
              className="w-full h-9 rounded-xl text-xs font-bold"
              style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)', color: '#60a5fa' }}>
              Chip ist dran — Jetzt verifizieren
            </button>
          </div>
        )}

        {step === 'verifying' && (
          <div className="text-center py-4 space-y-2">
            <Loader2 className="w-8 h-8 animate-spin mx-auto" style={{ color: '#60a5fa' }} />
            <p className="text-sm font-bold" style={{ color: '#60a5fa' }}>Verifiziere Chip-Status…</p>
          </div>
        )}

        {step === 'invoice_input' && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 p-3 rounded-xl"
              style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
              <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#34d399' }} />
              <div>
                <p className="text-xs font-bold" style={{ color: '#34d399' }}>Chip ist invalid ✅</p>
                <p className="text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
                  Betrag: {formatSats(sats)}
                </p>
              </div>
            </div>
            <div>
              <label className="text-xs font-bold block mb-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                Lightning-Invoice eingeben ({formatSats(sats)})
              </label>
              <textarea
                value={invoice}
                onChange={e => { setInvoice(e.target.value); setInvoiceErr(''); }}
                placeholder="lnbc... oder user@wallet.de"
                rows={3}
                className="w-full rounded-xl px-3 py-2.5 text-xs font-mono resize-none focus:outline-none"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: `1px solid ${invoiceErr ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.12)'}`,
                  color: 'rgba(255,255,255,0.8)',
                }}
              />
              {invoiceErr && (
                <p className="text-[10px] mt-1" style={{ color: '#f87171' }}>{invoiceErr}</p>
              )}
              <p className="text-[10px] mt-1.5" style={{ color: 'rgba(255,255,255,0.25)' }}>
                BOLT11-Invoice (lnbc...) oder Lightning-Adresse (name@wallet.de).
                Der Betrag muss exakt {formatSats(sats)} sein.
              </p>
            </div>
            <button onClick={validateAndSend}
              className="w-full h-10 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all"
              style={{ background: 'rgba(247,147,26,0.15)', border: '1px solid rgba(247,147,26,0.35)', color: '#f7931a' }}>
              <Send className="w-4 h-4" />
              Auszahlung anfordern
            </button>
          </div>
        )}

        {step === 'sending' && (
          <div className="text-center py-4 space-y-2">
            <Loader2 className="w-8 h-8 animate-spin mx-auto" style={{ color: '#f7931a' }} />
            <p className="text-sm font-bold" style={{ color: '#f7931a' }}>Sende Anfrage an Website…</p>
          </div>
        )}

        {step === 'waiting_payment' && (
          <div className="text-center space-y-3 py-2">
            <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center animate-pulse"
              style={{ background: 'rgba(247,147,26,0.1)', border: '1px solid rgba(247,147,26,0.25)' }}>
              <Zap className="w-6 h-6" style={{ color: '#f7931a' }} />
            </div>
            <p className="font-bold text-sm" style={{ color: '#f7931a' }}>Warte auf Bestätigung der Website…</p>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Die Website prüft den Chip-Status und zahlt die {formatSats(sats)} aus.
              Dies kann einige Sekunden dauern.
            </p>
            <button onClick={onDone}
              className="text-xs px-3 py-1 rounded-lg"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.3)' }}>
              Im Hintergrund warten
            </button>
          </div>
        )}

        {step === 'done' && (
          <div className="text-center space-y-3 py-2">
            <CheckCircle className="w-10 h-10 mx-auto" style={{ color: '#34d399' }} />
            <p className="font-bold text-sm" style={{ color: '#34d399' }}>Entwertet & ausgezahlt ✅</p>
            <button onClick={onDone}
              className="w-full h-9 rounded-xl text-xs font-bold"
              style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', color: '#34d399' }}>
              Schließen
            </button>
          </div>
        )}

        {step === 'error' && (
          <div className="space-y-3">
            <div className="rounded-xl p-3 space-y-1"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <p className="text-xs font-bold" style={{ color: '#f87171' }}>Fehler</p>
              <p className="text-[11px] font-mono break-all" style={{ color: 'rgba(239,68,68,0.7)' }}>{errorMsg}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setStep('confirm')}
                className="flex-1 h-9 rounded-xl text-xs font-bold"
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}>
                Nochmal
              </button>
              <button onClick={onClose}
                className="flex-1 h-9 rounded-xl text-xs font-bold"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)' }}>
                Schließen
              </button>
            </div>
          </div>
        )}

        {/* Always show dump log at bottom if available */}
        {dumpLog && (
          <DumpLog dump={dumpLog} />
        )}
      </div>
    </div>
  );
}

// ─── Decode BOLT11 amount (simple) ────────────────────────────────────────────

/**
 * Extracts the amount in satoshis from a BOLT11 invoice string.
 * Format: lnbc<amount><multiplier>...
 * Returns null if no amount is encoded (amount-less invoice).
 */
function decodeBolt11Amount(bolt11: string): number | null {
  try {
    const lower = bolt11.toLowerCase();
    // lnbc10n = 10 nanobitcoin = 1 sat
    // lnbc1u = 1 microbitcoin = 100 sat
    // lnbc1m = 1 millibitcoin = 100000 sat
    const match = lower.match(/^lnbc(\d+)([munp])?1/);
    if (!match) return null;
    const amount = parseInt(match[1], 10);
    if (isNaN(amount)) return null;
    const mult = match[2] ?? '';
    // Convert to satoshis
    // 1 BTC = 100,000,000 sats
    // m = milli  = 1e-3 BTC = 100,000 sats per unit
    // u = micro  = 1e-6 BTC = 100 sats per unit
    // n = nano   = 1e-9 BTC = 0.1 sats per unit
    // p = pico   = 1e-12 BTC = 0.0001 sats per unit
    let sats: number;
    switch (mult) {
      case 'm': sats = Math.round(amount * 100000);   break; // millibitcoin
      case 'u': sats = Math.round(amount * 100);      break; // microbitcoin
      case 'n': sats = Math.round(amount * 0.1);      break; // nanobitcoin
      case 'p': sats = Math.round(amount * 0.0001);   break; // picobitcoin
      default:  sats = amount * 100000000;              break; // full bitcoin
    }
    return sats;
  } catch {
    return null;
  }
}

// ─── Reload InvoicePanel (in-app) ─────────────────────────────────────────────

type InvoicePhase = 'idle' | 'loading' | 'open' | 'paid' | 'error';

interface InvoicePanelProps {
  chip: ChipEntry;
  chipSats: number; // from scan, authoritative
  onPaid: (paymentHash: string) => void;
}

function InvoicePanel({ chip, chipSats, onPaid }: InvoicePanelProps) {
  const [phase,     setPhase]     = useState<InvoicePhase>('idle');
  const [bolt11,    setBolt11]    = useState('');
  const [hash,      setHash]      = useState('');
  const [remaining, setRemaining] = useState(0);
  const [copied,    setCopied]    = useState(false);
  const [errMsg,    setErrMsg]    = useState('');
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { toast } = useToast();
  const sats = chipSats > 0 ? chipSats : chip.sats;
  const fee = calcReloadFee(sats);
  const amount = sats + fee;

  useEffect(() => () => {
    if (pollRef.current)  clearInterval(pollRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const generate = async () => {
    setPhase('loading');
    try {
      const res = await fetch(`${LNBITS_CONFIG.nodeUrl}/api/v1/payments`, {
        method: 'POST',
        headers: { 'X-Api-Key': LNBITS_CONFIG.invoiceReadKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          out: false,
          amount,
          memo: `Aufladen: ${chip.uid} (${sats.toLocaleString('de-DE')} sats)`,
          expiry: LNBITS_CONFIG.invoiceExpiry,
          unit: 'sat',
        }),
      });
      if (!res.ok) throw new Error(`LNbits ${res.status}`);
      const data = await res.json() as { payment_hash: string; payment_request: string };
      setBolt11(data.payment_request);
      setHash(data.payment_hash);
      setRemaining(LNBITS_CONFIG.invoiceExpiry);
      setPhase('open');

      timerRef.current = setInterval(() => setRemaining(r => Math.max(0, r - 1)), 1000);

      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`${LNBITS_CONFIG.nodeUrl}/api/v1/payments/${data.payment_hash}`,
            { headers: { 'X-Api-Key': LNBITS_CONFIG.invoiceReadKey } });
          if (!r.ok) return;
          const d = await r.json() as { paid: boolean };
          if (d.paid) {
            clearInterval(pollRef.current!);
            clearInterval(timerRef.current!);
            setPhase('paid');
            toast({ title: '💰 Zahlung eingegangen!', description: 'Chip ranhalten zum Schreiben.' });
            onPaid(data.payment_hash);
          }
        } catch { /* ignore */ }
      }, 3000);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  };

  const cancel = () => {
    if (pollRef.current)  clearInterval(pollRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    setPhase('idle');
  };

  const copy = async () => {
    await navigator.clipboard.writeText(bolt11);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const expired = remaining <= 0 && phase === 'open';
  const urgent  = remaining > 0 && remaining < 120;

  if (phase === 'idle') return (
    <button onClick={generate}
      className="w-full h-11 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-[0.99]"
      style={{ background: 'rgba(247,147,26,0.1)', border: '1px solid rgba(247,147,26,0.3)', color: '#f7931a' }}>
      <Zap className="w-4 h-4" />
      Invoice erstellen — {amount.toLocaleString('de-DE')} sats
    </button>
  );

  if (phase === 'loading') return (
    <div className="w-full h-11 rounded-xl flex items-center justify-center gap-2"
      style={{ background: 'rgba(247,147,26,0.06)', border: '1px solid rgba(247,147,26,0.15)' }}>
      <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#f7931a' }} />
      <span className="text-sm" style={{ color: 'rgba(247,147,26,0.6)' }}>Generiere Invoice…</span>
    </div>
  );

  if (phase === 'error') return (
    <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
      <p className="text-red-300 text-xs">{errMsg}</p>
      <button onClick={() => setPhase('idle')} className="text-xs px-3 py-1 rounded-lg"
        style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
        Nochmal
      </button>
    </div>
  );

  if (phase === 'paid') return (
    <div className="rounded-xl p-4 text-center space-y-2"
      style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
      <CheckCircle className="w-8 h-8 mx-auto" style={{ color: '#34d399' }} />
      <p className="font-bold text-sm" style={{ color: '#34d399' }}>Bezahlt! Chip ranhalten zum Schreiben.</p>
    </div>
  );

  // open
  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(247,147,26,0.2)' }}>
      <div className="px-4 pt-4 pb-3 flex items-center justify-between"
        style={{ background: 'rgba(247,147,26,0.05)' }}>
        <div>
          <div className="text-xl font-black" style={{ color: '#f7931a' }}>
            {amount.toLocaleString('de-DE')} <span className="text-sm font-bold">sats</span>
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,0.25)' }}>
            {sats.toLocaleString('de-DE')} + {fee} Gebühr (1%)
          </div>
        </div>
        <div className={cn('text-right text-xs font-mono font-bold',
          expired ? 'text-red-400' : urgent ? 'text-orange-400' : 'text-slate-400')}>
          {expired ? 'ABGELAUFEN' : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`}
        </div>
      </div>
      {!expired && (
        <div className="flex justify-center py-4 bg-white">
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(bolt11.toUpperCase())}&size=200x200&ecc=M`}
            alt="Lightning Invoice QR"
            width={200} height={200}
          />
        </div>
      )}
      {expired && (
        <div className="py-6 text-center space-y-2">
          <p className="text-red-300 text-sm font-semibold">Invoice abgelaufen</p>
          <button onClick={generate} className="text-xs px-3 py-1.5 rounded-lg"
            style={{ background: 'rgba(247,147,26,0.1)', border: '1px solid rgba(247,147,26,0.25)', color: '#f7931a' }}>
            Neu generieren
          </button>
        </div>
      )}
      {!expired && (
        <div className="px-4 pb-4 pt-3 space-y-2" style={{ background: 'rgba(0,0,0,0.12)' }}>
          <button onClick={copy}
            className="w-full h-9 rounded-xl flex items-center justify-center gap-2 text-xs font-bold transition-all"
            style={copied
              ? { background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#34d399' }
              : { background: 'rgba(247,147,26,0.08)', border: '1px solid rgba(247,147,26,0.2)', color: '#f7931a' }}>
            {copied ? <><Check className="w-3.5 h-3.5" /> Kopiert!</> : <><Copy className="w-3.5 h-3.5" /> Invoice kopieren</>}
          </button>
          <button onClick={cancel} className="w-full text-center text-xs py-1"
            style={{ color: 'rgba(255,255,255,0.2)' }}>
            Abbrechen
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Write-Valid Flow (after payment confirmed) ───────────────────────────────

type WriteValidStep = 'tap' | 'writing' | 'tap_verify' | 'verifying' | 'done_ok' | 'done_error';

function WriteValidFlow({ scan, onClose }: { scan: ScanResult; onClose: () => void }) {
  const [step,           setStep]           = useState<WriteValidStep>('tap');
  const [errorMsg,       setErrorMsg]       = useState('');
  const [verifiedStatus, setVerifiedStatus] = useState<ChipStatus | null>(null);
  const [dumpLog,        setDumpLog]        = useState('');
  const { toast } = useToast();

  const doWrite = useCallback(async () => {
    setStep('writing');
    const result = await writeChipStatus(scan.uid, 'valid', DEFAULT_KEYS);
    if (result.dump) setDumpLog(prev => prev + result.dump);
    if (!result.success) { setErrorMsg(result.error ?? 'Fehler'); setStep('done_error'); return; }
    toast({ title: '✅ "valid" geschrieben', description: 'Nochmal ranhalten zur Verifikation.' });
    setStep('tap_verify');
  }, [scan.uid, toast]);

  const doVerify = useCallback(async () => {
    setStep('verifying');
    const result = await readChipStatus(scan.uid, DEFAULT_KEYS);
    if (result.dump) setDumpLog(prev => prev + result.dump);
    if (!result.success) { setErrorMsg(result.error ?? 'Fehler'); setStep('done_error'); return; }
    setVerifiedStatus(result.status ?? null);
    setStep('done_ok');
  }, [scan.uid]);

  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(16,185,129,0.25)' }}>
      <div className="flex items-center justify-between px-4 py-3"
        style={{ background: 'rgba(16,185,129,0.06)', borderBottom: '1px solid rgba(16,185,129,0.12)' }}>
        <span className="font-bold text-sm flex items-center gap-2" style={{ color: '#34d399' }}>
          <ShieldCheck className="w-4 h-4" />
          Auf "valid" setzen
        </span>
        <button onClick={onClose} className="text-xs px-2 py-1 rounded-lg hover:bg-white/5"
          style={{ color: 'rgba(255,255,255,0.3)' }}>✕</button>
      </div>
      <div className="p-4 space-y-3">
        {step === 'tap' && (
          <div className="text-center space-y-3 py-2">
            <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center animate-pulse"
              style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)' }}>
              <Wifi className="w-6 h-6" style={{ color: '#34d399' }} />
            </div>
            <p className="font-bold text-sm" style={{ color: '#34d399' }}>Chip ranhalten!</p>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Zahlung bestätigt. Chip wird auf "valid" zurückgesetzt.
            </p>
            <button onClick={doWrite}
              className="w-full h-9 rounded-xl text-xs font-bold"
              style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', color: '#34d399' }}>
              Chip ist dran — Schreiben
            </button>
          </div>
        )}
        {step === 'writing' && (
          <div className="text-center py-4 space-y-2">
            <Loader2 className="w-8 h-8 animate-spin mx-auto" style={{ color: '#34d399' }} />
            <p className="text-sm font-bold" style={{ color: '#34d399' }}>Schreibe "valid"…</p>
          </div>
        )}
        {step === 'tap_verify' && (
          <div className="text-center space-y-3 py-2">
            <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center animate-pulse"
              style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)' }}>
              <Wifi className="w-6 h-6" style={{ color: '#60a5fa' }} />
            </div>
            <p className="font-bold text-sm" style={{ color: '#60a5fa' }}>Nochmal ranhalten zur Verifikation</p>
            <button onClick={doVerify}
              className="w-full h-9 rounded-xl text-xs font-bold"
              style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', color: '#60a5fa' }}>
              Jetzt verifizieren
            </button>
          </div>
        )}
        {step === 'verifying' && (
          <div className="text-center py-4 space-y-2">
            <Loader2 className="w-8 h-8 animate-spin mx-auto" style={{ color: '#60a5fa' }} />
            <p className="text-sm font-bold" style={{ color: '#60a5fa' }}>Verifiziere…</p>
          </div>
        )}
        {step === 'done_ok' && (
          <div className="text-center space-y-3 py-2">
            <CheckCircle className="w-10 h-10 mx-auto" style={{ color: '#34d399' }} />
            <p className="font-bold text-sm" style={{ color: '#34d399' }}>Fertig!</p>
            {verifiedStatus && <ChipStatusBadge status={verifiedStatus} />}
            <button onClick={onClose}
              className="w-full h-9 rounded-xl text-xs font-bold"
              style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', color: '#34d399' }}>
              Schließen
            </button>
          </div>
        )}
        {step === 'done_error' && (
          <div className="text-center space-y-3 py-2">
            <XCircle className="w-10 h-10 mx-auto" style={{ color: '#f87171' }} />
            <p className="text-red-300 text-xs font-mono">{errorMsg}</p>
            <button onClick={() => setStep('tap')}
              className="w-full h-9 rounded-xl text-xs font-bold"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
              Retry
            </button>
          </div>
        )}
        {dumpLog && <DumpLog dump={dumpLog} />}
      </div>
    </div>
  );
}

// ─── Action buttons (Online verifizieren, Aufladen anfordern) ─────────────────

type ActionState = 'idle' | 'loading' | 'done' | 'error';

function OnlineActions({ scan, chip, onStartInvoice, showingInvoice }: {
  scan: ScanResult;
  chip: ChipEntry | null;
  onStartInvoice: () => void;
  showingInvoice: boolean;
}) {
  const { mutateAsync: publishEvent } = usePublishAnonymous();
  const { toast } = useToast();
  const [verifyState,  setVerifyState]  = useState<ActionState>('idle');
  const [reloadState,  setReloadState]  = useState<ActionState>('idle');

  useEffect(() => {
    setVerifyState('idle');
    setReloadState('idle');
  }, [scan.uid, scan.timestamp]);

  const sats = scan.chipSats > 0 ? scan.chipSats : (chip?.sats ?? 0);

  const handleVerify = async () => {
    setVerifyState('loading');
    try {
      await publishEvent({
        kind: KIND_VERIFY_LOG,
        content: JSON.stringify({
          uid: scan.uid,
          label: chip?.label ?? '',
          sats,
          chipStatus: scan.chipStatus,
          result: chip ? (scan.chipStatus === 'valid' ? 'verified' : 'warn') : 'unknown',
        }),
        tags: [['t', APP_TAG], ['alt', 'Bitcoin Note online verification log']],
      });
      setVerifyState('done');
      toast({ title: '✅ Online verifiziert' });
    } catch (e) {
      setVerifyState('error');
      toast({ title: 'Fehler', description: String(e), variant: 'destructive' });
    }
  };

  const handleReload = async () => {
    setReloadState('loading');
    try {
      await publishEvent({
        kind: KIND_RELOAD_REQUEST,
        content: JSON.stringify({ uid: scan.uid, label: chip?.label ?? '', sats }),
        tags: [['t', APP_TAG], ['alt', 'Bitcoin Note reload request']],
      });
      setReloadState('done');
      toast({ title: '📤 Anfrage gesendet' });
      onStartInvoice();
    } catch (e) {
      setReloadState('error');
      toast({ title: 'Fehler', description: String(e), variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-2">
      {/* Online verifizieren */}
      <button
        onClick={handleVerify}
        disabled={verifyState === 'loading' || verifyState === 'done'}
        className="w-full h-10 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
        style={verifyState === 'done'
          ? { background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', color: '#34d399' }
          : { background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', color: '#60a5fa' }}>
        {verifyState === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
         verifyState === 'done'    ? <CheckCircle className="w-3.5 h-3.5" /> :
         <Globe className="w-3.5 h-3.5" />}
        {verifyState === 'done' ? 'Eingetragen!' : verifyState === 'error' ? 'Retry' : 'Online verifizieren'}
      </button>

      {/* Aufladen */}
      {!showingInvoice && (
        <button
          onClick={handleReload}
          disabled={reloadState === 'loading' || reloadState === 'done'}
          className="w-full h-10 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
          style={reloadState === 'done'
            ? { background: 'rgba(247,147,26,0.1)', border: '1px solid rgba(247,147,26,0.25)', color: '#f7931a' }
            : { background: 'rgba(247,147,26,0.06)', border: '1px solid rgba(247,147,26,0.15)', color: 'rgba(247,147,26,0.7)' }}>
          {reloadState === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
           reloadState === 'done'    ? <CheckCircle className="w-3.5 h-3.5" /> :
           <Upload className="w-3.5 h-3.5" />}
          {reloadState === 'done' ? 'Angefordert!' : reloadState === 'error' ? 'Retry' : 'Aufladen anfordern'}
        </button>
      )}

      {/* Website-Link — immer sichtbar nach Aktionen */}
      {chip && (verifyState === 'done' || reloadState === 'done') && (
        <a
          href={chipWebsiteUrl(chip.uid)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between w-full px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all hover:scale-[1.01] active:scale-[0.99]"
          style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', color: '#34d399' }}>
          <span className="flex items-center gap-2 min-w-0">
            <ExternalLink className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">Auf Website anschauen</span>
          </span>
          <span className="text-[9px] font-mono flex-shrink-0 ml-2" style={{ color: 'rgba(255,255,255,0.3)' }}>
            /{chip.uid.slice(0, 6)}…
          </span>
        </a>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function NFCScanner() {
  const [scanStatus,     setScanStatus]     = useState<ScanStatus>('idle');
  const [lastScan,       setLastScan]       = useState<ScanResult | null>(null);
  const [history,        setHistory]        = useState<Array<ScanResult>>([]);
  const [errorMsg,       setErrorMsg]       = useState<string | null>(null);
  const [showInvoice,    setShowInvoice]    = useState(false);
  const [showWriteValid, setShowWriteValid] = useState(false);
  const [showEntwerten,  setShowEntwerten]  = useState(false);
  const { toast } = useToast();
  const native = isNativeAvailable();

  useEffect(() => () => { stopNativeScan(); }, []);

  const handleResult = useCallback((result: ScanResult) => {
    setLastScan(result);
    setScanStatus('scanning');
    setErrorMsg(null);
    setShowInvoice(false);
    setShowWriteValid(false);
    setShowEntwerten(false);
    setHistory(h => [result, ...h].slice(0, 20));
  }, []);

  const handleError = useCallback((msg: string) => {
    setErrorMsg(msg);
    setScanStatus('error');
    toast({ title: 'NFC Fehler', description: msg, variant: 'destructive' });
  }, [toast]);

  const startScan = useCallback(async () => {
    setScanStatus('scanning');
    setErrorMsg(null);
    setLastScan(null);
    if (!native) { setScanStatus('unsupported'); setErrorMsg('Nur in nativer APK verfügbar.'); return; }
    await startNativeScan(handleResult, handleError);
  }, [native, handleResult, handleError]);

  const stopScan = useCallback(async () => {
    await stopNativeScan();
    setScanStatus('idle');
  }, []);

  const chip = lastScan ? lookupChip(lastScan.uid) : null;

  // Payment confirmed hook
  const { data: paymentEvent } = usePaymentConfirmed(lastScan?.uid ?? null);

  useEffect(() => {
    if (paymentEvent && showInvoice && !showWriteValid) {
      setShowWriteValid(true);
      setShowInvoice(false);
      toast({ title: '💰 Zahlung bestätigt!', description: 'Chip wird auf valid gesetzt.' });
    }
  }, [paymentEvent, showInvoice, showWriteValid, toast]);

  return (
    <div className="w-full max-w-md mx-auto space-y-4 px-1">

      {/* ── Header ── */}
      <div className="text-center pt-2">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full"
          style={{ background: 'rgba(247,147,26,0.06)', border: '1px solid rgba(247,147,26,0.12)' }}>
          <span className="text-base">₿</span>
          <span className="text-sm font-black tracking-widest uppercase" style={{ color: 'rgba(247,147,26,0.8)' }}>
            Backup Chip Scanner
          </span>
        </div>
      </div>

      {/* ── Scan button ── */}
      <div className="flex justify-center py-2">
        <ScanButton status={scanStatus} hasResult={lastScan !== null} onScan={startScan} onStop={stopScan} />
      </div>

      {/* ── Hints ── */}
      {scanStatus === 'idle' && !lastScan && (
        <p className="text-center text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
          NTAG 424 Tag an die Rückseite halten
        </p>
      )}
      {scanStatus === 'scanning' && !lastScan && (
        <p className="text-center text-sm font-medium animate-pulse" style={{ color: 'rgba(247,147,26,0.7)' }}>
          Halte den Chip an dein Gerät…
        </p>
      )}
      {scanStatus === 'scanning' && lastScan && (
        <p className="text-center text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>
          Bereit für nächsten Tag
        </p>
      )}

      {/* ── Error ── */}
      {errorMsg && (
        <div className="rounded-xl px-4 py-3 flex items-start gap-2"
          style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#f87171' }} />
          <p className="text-sm text-red-300">{errorMsg}</p>
        </div>
      )}

      {/* ── Result ── */}
      {lastScan && (
        <div className="space-y-3">
          <ResultCard scan={lastScan} chip={chip} />
          <UIDRow uid={lastScan.uid} />

          {/* APDU Dump Log from scan */}
          {lastScan.debug && <DumpLog dump={lastScan.debug} />}

          {/* ── Entwerten Flow ── */}
          {showEntwerten && chip && (
            <EntwertFlow
              scan={lastScan}
              chip={chip}
              onClose={() => setShowEntwerten(false)}
              onDone={() => setShowEntwerten(false)}
            />
          )}

          {/* ── Write Valid Flow (after payment) ── */}
          {showWriteValid && !showEntwerten && (
            <WriteValidFlow scan={lastScan} onClose={() => setShowWriteValid(false)} />
          )}

          {/* ── Invoice Panel ── */}
          {showInvoice && chip && !showWriteValid && !showEntwerten && (
            <InvoicePanel
              chip={chip}
              chipSats={lastScan.chipSats}
              onPaid={() => {
                setShowWriteValid(true);
                setShowInvoice(false);
              }}
            />
          )}

          {/* ── Actions ── */}
          {!showEntwerten && !showWriteValid && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
                <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color: 'rgba(255,255,255,0.2)' }}>
                  Aktionen
                </span>
                <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
              </div>

              <OnlineActions
                scan={lastScan}
                chip={chip}
                onStartInvoice={() => setShowInvoice(true)}
                showingInvoice={showInvoice}
              />

              {/* Entwerten button — nur wenn valid */}
              {chip && lastScan.chipStatus === 'valid' && !showEntwerten && (
                <button
                  onClick={() => setShowEntwerten(true)}
                  className="w-full h-10 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all hover:opacity-80"
                  style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)', color: 'rgba(239,68,68,0.6)' }}>
                  <ShieldX className="w-3.5 h-3.5" />
                  Entwerten
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Not native ── */}
      {!native && !lastScan && (
        <div className="rounded-xl px-4 py-6 text-center space-y-2"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <ShieldAlert className="w-8 h-8 mx-auto" style={{ color: 'rgba(255,255,255,0.2)' }} />
          <p className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.4)' }}>
            APK erforderlich
          </p>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>
            Installiere die APK auf deinem Android-Gerät.
          </p>
        </div>
      )}

      {/* ── History ── */}
      {history.length > 0 && (
        <div className="space-y-2 pt-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.2)' }}>
              Verlauf ({history.length})
            </h3>
            <button
              onClick={() => { setHistory([]); setLastScan(null); setScanStatus('idle'); }}
              className="text-[10px] flex items-center gap-1 hover:opacity-70"
              style={{ color: 'rgba(255,255,255,0.2)' }}>
              <RefreshCw className="w-3 h-3" /> Löschen
            </button>
          </div>
          {history.map((scan) => {
            const c = lookupChip(scan.uid);
            const dot =
              scan.chipStatus === 'valid' ? '#34d399' :
              scan.chipStatus === 'invalid' ? '#f87171' :
              '#fb923c';
            return (
              <div key={scan.timestamp}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: dot }} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold truncate" style={{ color: 'rgba(255,255,255,0.7)' }}>
                    {c?.label ?? 'Unbekannt'} · {scan.chipStatus}
                  </div>
                  <div className="font-mono text-[10px] truncate" style={{ color: 'rgba(255,255,255,0.25)' }}>
                    {scan.uid}
                  </div>
                </div>
                <span className="text-[10px] flex-shrink-0" style={{ color: 'rgba(255,255,255,0.2)' }}>
                  {new Date(scan.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
