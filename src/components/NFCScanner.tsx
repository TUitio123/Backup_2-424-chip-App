import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Wifi, WifiOff, CheckCircle, XCircle, AlertTriangle,
  RefreshCw, Copy, ChevronDown, ChevronUp, Zap,
  ShieldAlert, HelpCircle, Globe, Upload, Loader2, Trash2,
  Check, ShieldCheck, ShieldX, Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ScanResult, ScanStatus, TamperStatus,
  isNativeAvailable, startNativeScan, stopNativeScan,
  writeChipStatus, readChipStatus, ChipStatus,
} from '@/lib/ntag424';
import {
  lookupChip, ChipEntry,
  KIND_VERIFY_LOG, KIND_RELOAD_REQUEST, KIND_INVALIDATE_REQUEST, APP_TAG,
} from '@/lib/chipRegistry';
import { useToast } from '@/hooks/useToast';
import { usePaymentConfirmed } from '@/hooks/usePaymentConfirmed';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { usePublishAnonymous } from '@/hooks/usePublishAnonymous';

// ─── Chip-Status Badge ────────────────────────────────────────────────────────

function ChipStatusBadge({ status }: { status: ChipStatus }) {
  if (status === 'valid')
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border"
        style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: '#34d399' }}>
        <ShieldCheck className="w-4 h-4" />
        <span className="font-bold text-sm">VALID — Schein aufgeladen</span>
      </div>
    );
  if (status === 'entwertenbeantragt')
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border"
        style={{ background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.3)', color: '#fb923c' }}>
        <AlertTriangle className="w-4 h-4" />
        <span className="font-bold text-sm">Entwertung beantragt</span>
      </div>
    );
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border"
      style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
      <ShieldX className="w-4 h-4" />
      <span className="font-bold text-sm">INVALID — Schein entwertet</span>
    </div>
  );
}

// ─── Verification result ──────────────────────────────────────────────────────

type VerifyResult =
  | { kind: 'verified'; chip: ChipEntry }
  | { kind: 'warn';     chip: ChipEntry }
  | { kind: 'unknown' };

function classify(scan: ScanResult): VerifyResult {
  const chip = lookupChip(scan.uid);
  if (!chip) return { kind: 'unknown' };
  return scan.tamperStatus === 'CC' ? { kind: 'verified', chip } : { kind: 'warn', chip };
}

// ─── Tamper pill ──────────────────────────────────────────────────────────────

function TamperPill({ tamperStatus, verifyKind }: { tamperStatus: TamperStatus; verifyKind: VerifyResult['kind'] }) {
  const isGreen = tamperStatus === 'CC';
  const color =
    verifyKind === 'verified' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25' :
    verifyKind === 'warn'     ? 'bg-orange-500/15 text-orange-300 border-orange-500/25'    :
                                'bg-slate-700/60 text-slate-400 border-slate-600';
  return (
    <div className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-mono', color)}>
      <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', isGreen ? 'bg-emerald-400' : 'bg-orange-400')} />
      <span>Tamper: <span className="font-bold">{tamperStatus}</span></span>
      {!isGreen && <AlertTriangle className="w-3 h-3 opacity-80" />}
    </div>
  );
}

// ─── Verify badge ─────────────────────────────────────────────────────────────

function VerifyBadge({ verify, scan }: { verify: VerifyResult; scan: ScanResult }) {
  const chip = verify.kind !== 'unknown' ? verify.chip : null;
  const chipStatus = chip?.status ?? null;

  const borderColor =
    verify.kind === 'verified' ? 'border-emerald-500/50' :
    verify.kind === 'warn'     ? 'border-orange-500/50'  : 'border-red-500/40';
  const bgColor =
    verify.kind === 'verified' ? 'bg-emerald-500/15' :
    verify.kind === 'warn'     ? 'bg-orange-500/15'  : 'bg-red-500/15';
  const Icon =
    verify.kind === 'verified' ? CheckCircle :
    verify.kind === 'warn'     ? AlertTriangle : HelpCircle;
  const iconColor =
    verify.kind === 'verified' ? 'text-emerald-400' :
    verify.kind === 'warn'     ? 'text-orange-400'  : 'text-red-400';
  const label =
    verify.kind === 'verified' ? 'Verified' :
    verify.kind === 'warn'     ? 'Achtung'  : 'Unbekannt';
  const labelColor =
    verify.kind === 'verified' ? 'text-emerald-400' :
    verify.kind === 'warn'     ? 'text-orange-400'  : 'text-red-400';

  return (
    <div className="flex flex-col items-center gap-3 py-6">
      <div className={cn('w-28 h-28 rounded-full border-4 flex items-center justify-center', bgColor, borderColor)}
        style={{ boxShadow: verify.kind === 'verified' ? '0 0 40px rgba(16,185,129,0.25)' : undefined }}>
        <Icon className={cn('w-16 h-16', iconColor)} />
      </div>
      <div className="text-center space-y-1">
        <div className={cn('font-bold text-sm uppercase tracking-widest', labelColor)}>{label}</div>
        {chip && <div className="text-white font-extrabold text-4xl tracking-tight">{chip.label}</div>}
        {chip?.info && <div className="text-slate-400 text-sm">{chip.info}</div>}
        {chip?.issuedAt && <div className="text-slate-600 text-xs">Ausgegeben: {chip.issuedAt}</div>}
      </div>
      <TamperPill tamperStatus={scan.tamperStatus} verifyKind={verify.kind} />
      {/* DB-Status des Chips */}
      {chipStatus && (
        <ChipStatusBadge status={chipStatus} />
      )}
    </div>
  );
}

// ─── Raw data panel ───────────────────────────────────────────────────────────

function RawDataPanel({ scan, verify }: { scan: ScanResult; verify: VerifyResult }) {
  const [open, setOpen] = useState(false);
  const payload = JSON.stringify({
    uid: scan.uid,
    tamperStatus: scan.tamperStatus,
    verifyResult: verify.kind,
    chipStatus: verify.kind !== 'unknown' ? verify.chip.status : null,
    label: verify.kind !== 'unknown' ? verify.chip.label : null,
    timestamp: new Date(scan.timestamp).toISOString(),
    debug: scan.debug ?? null,
  }, null, 2);
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors">
        <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Rohdaten</span>
        {open ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
      </button>
      {open && (
        <div className="border-t border-white/10 p-3">
          <pre className="text-xs text-slate-300 font-mono bg-black/30 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
            {payload}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── UID row ──────────────────────────────────────────────────────────────────

function UIDRow({ uid }: { uid: string }) {
  const { toast } = useToast();
  return (
    <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl px-4 py-3">
      <div>
        <div className="text-slate-500 text-xs mb-0.5 uppercase tracking-wider">Chip UID</div>
        <div className="font-mono text-white text-sm tracking-widest">{uid}</div>
      </div>
      <button
        onClick={() => navigator.clipboard.writeText(uid).then(() => toast({ title: 'UID kopiert' })).catch(() => {})}
        className="text-slate-500 hover:text-slate-300 transition-colors p-2">
        <Copy className="w-4 h-4" />
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
    <button onClick={scanning ? onStop : onScan} disabled={status === 'unsupported'}
      className={cn(
        'relative w-44 h-44 rounded-full flex flex-col items-center justify-center gap-3 border-4 transition-all duration-300 select-none',
        'focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500',
        status === 'idle'        && 'bg-blue-600/20 border-blue-500/50 hover:bg-blue-600/30 hover:border-blue-400 active:scale-95 cursor-pointer',
        scanning                 && 'bg-blue-600/30 border-blue-400 animate-pulse cursor-pointer',
        status === 'error'       && 'bg-red-600/20 border-red-500/50 hover:bg-red-600/30 cursor-pointer',
        status === 'unsupported' && 'bg-slate-800/50 border-slate-700 cursor-not-allowed opacity-50',
      )}>
      {scanning && (
        <>
          <span className="absolute inset-0 rounded-full border-4 border-blue-400 animate-ping opacity-25" />
          <span className="absolute -inset-3 rounded-full border-2 border-blue-400/20 animate-ping opacity-15" style={{ animationDelay: '0.4s' }} />
        </>
      )}
      <div className="relative z-10">
        {status === 'error'       && <XCircle className="w-12 h-12 text-red-400" />}
        {status === 'unsupported' && <WifiOff className="w-12 h-12 text-slate-500" />}
        {(status === 'idle' || scanning) && <Wifi className={cn('w-12 h-12', scanning ? 'text-blue-300' : 'text-blue-400')} />}
      </div>
      <span className={cn('relative z-10 text-xs font-bold tracking-widest uppercase',
        status === 'idle' && 'text-blue-300', scanning && 'text-blue-200',
        status === 'error' && 'text-red-300', status === 'unsupported' && 'text-slate-500',
      )}>
        {status === 'idle' && 'Scannen'}
        {scanning && !hasResult && 'Warte…'}
        {scanning && hasResult  && 'Scannt…'}
        {status === 'error' && 'Retry'}
        {status === 'unsupported' && 'N/A'}
      </span>
    </button>
  );
}

// ─── Schreib-Flow nach Zahlung ────────────────────────────────────────────────

type WriteFlowStep =
  | 'waiting_payment'   // wartet auf Kind 3493 von Website
  | 'tap_to_write'      // Nutzer soll Chip ranhalten zum Schreiben
  | 'holding'           // Chip rangehalten, 10s stabil halten
  | 'writing'           // schreibt gerade
  | 'tap_to_verify'     // Nutzer soll nochmal ranhalten zur Verifikation
  | 'verifying'         // liest zurück
  | 'done_ok'           // alles gut
  | 'done_error';       // Fehler

interface WriteFlowProps {
  scan: ScanResult;
  chip: ChipEntry;
  onClose: () => void;
}

// Keys aus chips.json / App-Bundle — für jetzt 32 Nullen
// In Produktion: aus dem keys/<UID>.json file laden
const DEFAULT_KEYS = {
  appMasterKey: '00000000000000000000000000000000',
  fileReadKey:  '00000000000000000000000000000000',
  fileWriteKey: '00000000000000000000000000000000',
};

function WriteFlow({ scan, chip, onClose }: WriteFlowProps) {
  const [step, setStep] = useState<WriteFlowStep>('waiting_payment');
  const [holdSeconds, setHoldSeconds] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [verifiedStatus, setVerifiedStatus] = useState<ChipStatus | null>(null);
  const holdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tapListenerRef = useRef<(() => void) | null>(null);
  const { toast } = useToast();

  // Hört auf Kind 3493 Payment-Confirmed
  const { data: paymentEvent } = usePaymentConfirmed(scan.uid);

  useEffect(() => {
    if (paymentEvent && step === 'waiting_payment') {
      setStep('tap_to_write');
      toast({ title: '💰 Zahlung bestätigt!', description: 'Jetzt Chip ranhalten zum Schreiben.' });
    }
  }, [paymentEvent, step, toast]);

  // Cleanup
  useEffect(() => () => {
    if (holdRef.current) clearInterval(holdRef.current);
  }, []);

  const startHolding = useCallback(async () => {
    setStep('holding');
    setHoldSeconds(0);
    // 10 Sekunden zählen
    holdRef.current = setInterval(() => {
      setHoldSeconds(s => {
        if (s >= 9) {
          clearInterval(holdRef.current!);
          // Schreiben starten
          setStep('writing');
          doWrite();
          return 10;
        }
        return s + 1;
      });
    }, 1000);
  }, []); // eslint-disable-line

  const doWrite = useCallback(async () => {
    const result = await writeChipStatus(scan.uid, 'valid', DEFAULT_KEYS);
    if (!result.success) {
      setErrorMsg(result.error ?? 'Schreiben fehlgeschlagen');
      setStep('done_error');
      return;
    }
    toast({ title: '✅ Status geschrieben', description: 'Chip nochmal ranhalten zur Verifikation.' });
    setStep('tap_to_verify');
  }, [scan.uid, toast]);

  const doVerify = useCallback(async () => {
    setStep('verifying');
    const result = await readChipStatus(scan.uid, DEFAULT_KEYS);
    if (!result.success) {
      setErrorMsg(result.error ?? 'Lesen fehlgeschlagen');
      setStep('done_error');
      return;
    }
    setVerifiedStatus(result.status ?? null);
    setStep('done_ok');
    if (result.status === 'valid') {
      toast({ title: '✅ Verifikation erfolgreich', description: 'Chip zeigt: valid' });
    } else {
      toast({ title: '⚠️ Verifikation', description: `Chip zeigt: ${result.status}`, variant: 'destructive' });
    }
  }, [scan.uid, toast]);

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardContent className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-amber-300 font-bold text-sm">⚡ Aufladen-Schreib-Flow</span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xs">✕ Schließen</button>
        </div>

        {/* Chip Info */}
        <div className="bg-white/5 rounded-lg px-3 py-2 text-xs font-mono" style={{ color: 'rgba(255,255,255,0.5)' }}>
          {chip.uid} · {chip.label}
        </div>

        {/* Steps */}
        {step === 'waiting_payment' && (
          <div className="text-center space-y-3 py-4">
            <Loader2 className="w-10 h-10 text-amber-400 animate-spin mx-auto" />
            <p className="text-amber-300 font-semibold">Warte auf Zahlungsbestätigung…</p>
            <p className="text-slate-500 text-xs">
              Sobald die Lightning-Invoice auf der Website bezahlt wurde,<br />
              erscheint hier die Aufforderung zum Schreiben.
            </p>
          </div>
        )}

        {step === 'tap_to_write' && (
          <div className="text-center space-y-3 py-2">
            <div className="w-16 h-16 rounded-full bg-amber-500/20 border-2 border-amber-500/50 flex items-center justify-center mx-auto animate-pulse">
              <Wifi className="w-8 h-8 text-amber-400" />
            </div>
            <p className="text-amber-300 font-bold">Chip jetzt ranhalten!</p>
            <p className="text-slate-400 text-xs">Halte den NFC-Chip für 10 Sekunden an die Rückseite des Geräts.</p>
            <Button
              onClick={startHolding}
              className="bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30"
              variant="outline"
            >
              Chip ist dran — Schreiben starten
            </Button>
          </div>
        )}

        {step === 'holding' && (
          <div className="text-center space-y-3 py-2">
            <div className="relative w-20 h-20 mx-auto">
              <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(245,158,11,0.2)" strokeWidth="6" />
                <circle cx="40" cy="40" r="34" fill="none" stroke="#f59e0b" strokeWidth="6"
                  strokeDasharray={`${2 * Math.PI * 34}`}
                  strokeDashoffset={`${2 * Math.PI * 34 * (1 - holdSeconds / 10)}`}
                  className="transition-all duration-1000" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-xl font-black text-amber-400">
                {10 - holdSeconds}
              </span>
            </div>
            <p className="text-amber-300 font-bold">Chip festhalten!</p>
            <p className="text-slate-400 text-xs">Noch {10 - holdSeconds} Sekunden stabil halten…</p>
          </div>
        )}

        {step === 'writing' && (
          <div className="text-center space-y-3 py-4">
            <Loader2 className="w-10 h-10 text-emerald-400 animate-spin mx-auto" />
            <p className="text-emerald-300 font-bold">Schreibe Status auf Chip…</p>
          </div>
        )}

        {step === 'tap_to_verify' && (
          <div className="text-center space-y-3 py-2">
            <div className="w-16 h-16 rounded-full bg-blue-500/20 border-2 border-blue-500/50 flex items-center justify-center mx-auto animate-pulse">
              <Wifi className="w-8 h-8 text-blue-400" />
            </div>
            <p className="text-blue-300 font-bold">Nochmal ranhalten zur Verifikation</p>
            <p className="text-slate-400 text-xs">Halte den Chip nochmal an das Gerät um zu bestätigen.</p>
            <Button onClick={doVerify} variant="outline"
              className="bg-blue-500/15 border-blue-500/35 text-blue-300 hover:bg-blue-500/25">
              Jetzt verifizieren
            </Button>
          </div>
        )}

        {step === 'verifying' && (
          <div className="text-center space-y-3 py-4">
            <Loader2 className="w-10 h-10 text-blue-400 animate-spin mx-auto" />
            <p className="text-blue-300 font-bold">Lese Status zurück…</p>
          </div>
        )}

        {step === 'done_ok' && (
          <div className="text-center space-y-3 py-2">
            <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto" />
            <p className="text-emerald-300 font-bold text-lg">Fertig!</p>
            {verifiedStatus && (
              <ChipStatusBadge status={verifiedStatus} />
            )}
            <p className="text-slate-400 text-xs">Chip wurde erfolgreich auf <strong>valid</strong> gesetzt.</p>
            <Button onClick={onClose} variant="outline"
              className="bg-emerald-500/15 border-emerald-500/30 text-emerald-300">
              Schließen
            </Button>
          </div>
        )}

        {step === 'done_error' && (
          <div className="text-center space-y-3 py-2">
            <XCircle className="w-12 h-12 text-red-400 mx-auto" />
            <p className="text-red-300 font-bold">Fehler</p>
            <p className="text-red-400/70 text-xs">{errorMsg}</p>
            <Button onClick={() => setStep('tap_to_write')} variant="outline"
              className="bg-red-500/15 border-red-500/30 text-red-300">
              Nochmal versuchen
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── History item ─────────────────────────────────────────────────────────────

function HistoryItem({ scan, verify }: { scan: ScanResult; verify: VerifyResult }) {
  const [open, setOpen] = useState(false);
  const dot   = verify.kind === 'verified' ? 'bg-emerald-400' : verify.kind === 'warn' ? 'bg-orange-400' : 'bg-red-400';
  const label = verify.kind !== 'unknown' ? verify.chip.label : 'Unbekannt';
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 p-3 hover:bg-white/5 transition-colors text-left">
        <div className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', dot)} />
        <div className="flex-1 min-w-0">
          <div className="text-white text-sm font-medium truncate">{label}</div>
          <div className="text-slate-500 text-xs font-mono truncate">{scan.uid}</div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Badge variant="outline" className="font-mono text-xs">{scan.tamperStatus}</Badge>
          <span className="text-slate-600 text-xs">
            {new Date(scan.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
          </span>
          {open ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
        </div>
      </button>
      {open && (
        <div className="border-t border-white/10 px-3 pb-3 pt-2 space-y-1.5">
          <div className="text-slate-500 text-xs font-mono break-all">{scan.uid}</div>
          {scan.debug && <div className="text-slate-600 text-xs font-mono break-all">{scan.debug}</div>}
        </div>
      )}
    </div>
  );
}

// ─── Online actions ───────────────────────────────────────────────────────────

const WEBSITE_URL = 'https://Testtest123.shakespeare.wtf';

type ActionState = 'idle' | 'loading' | 'done' | 'error';

function OnlineActions({ scan, verify, onStartWriteFlow }: {
  scan: ScanResult;
  verify: VerifyResult;
  onStartWriteFlow: () => void;
}) {
  const { mutateAsync: publishEvent } = usePublishAnonymous();
  const { toast } = useToast();
  const [verifyState,     setVerifyState]     = useState<ActionState>('idle');
  const [reloadState,     setReloadState]     = useState<ActionState>('idle');
  const [invalidateState, setInvalidateState] = useState<ActionState>('idle');
  const [showConfirm,     setShowConfirm]     = useState(false);

  const chip = verify.kind !== 'unknown' ? verify.chip : null;

  useEffect(() => {
    setVerifyState('idle');
    setReloadState('idle');
    setInvalidateState('idle');
    setShowConfirm(false);
  }, [scan.uid, scan.timestamp]);

  const handleVerify = async () => {
    setVerifyState('loading');
    try {
      await publishEvent({
        kind: KIND_VERIFY_LOG,
        content: JSON.stringify({ uid: scan.uid, label: chip?.label ?? '', sats: chip?.sats ?? 0, tamperStatus: scan.tamperStatus, result: verify.kind }),
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
        content: JSON.stringify({ uid: scan.uid, label: chip?.label ?? '', sats: chip?.sats ?? 0 }),
        tags: [['t', APP_TAG], ['alt', 'Bitcoin Note reload request']],
      });
      setReloadState('done');
      toast({ title: '📤 Aufladen angefordert', description: 'Invoice auf der Website öffnen. Danach startet der Schreib-Flow hier.' });
      onStartWriteFlow();
    } catch (e) {
      setReloadState('error');
      toast({ title: 'Fehler', description: String(e), variant: 'destructive' });
    }
  };

  const handleInvalidate = async () => {
    setShowConfirm(false);
    setInvalidateState('loading');
    try {
      await publishEvent({
        kind: KIND_INVALIDATE_REQUEST,
        content: JSON.stringify({ uid: scan.uid, label: chip?.label ?? '', sats: chip?.sats ?? 0 }),
        tags: [['t', APP_TAG], ['alt', 'Bitcoin Note invalidation request']],
      });
      setInvalidateState('done');
      toast({ title: '🗑️ Entwertung beantragt' });
    } catch (e) {
      setInvalidateState('error');
      toast({ title: 'Fehler', description: String(e), variant: 'destructive' });
    }
  };

  const anyDone = verifyState === 'done' || reloadState === 'done';

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3">
        {/* Online verifizieren */}
        <Button onClick={handleVerify} disabled={verifyState === 'loading' || verifyState === 'done'} variant="outline"
          className={cn('h-12 text-sm font-bold rounded-xl border transition-all',
            verifyState === 'done'  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' :
            verifyState === 'error' ? 'bg-red-500/15 border-red-500/35 text-red-300' :
            'bg-blue-500/15 border-blue-500/35 text-blue-300 hover:bg-blue-500/25')}>
          {verifyState === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> :
           verifyState === 'done'    ? <CheckCircle className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
          <span className="ml-2">{verifyState === 'done' ? 'Eingetragen!' : verifyState === 'error' ? 'Retry' : 'Online verifizieren'}</span>
        </Button>

        {/* Aufladen anfordern */}
        <Button onClick={handleReload} disabled={reloadState === 'loading' || reloadState === 'done'} variant="outline"
          className={cn('h-12 text-sm font-bold rounded-xl border transition-all',
            reloadState === 'done'  ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' :
            reloadState === 'error' ? 'bg-red-500/15 border-red-500/35 text-red-300' :
            'bg-amber-500/10 border-amber-500/25 text-amber-300 hover:bg-amber-500/20')}>
          {reloadState === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> :
           reloadState === 'done'    ? <CheckCircle className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
          <span className="ml-2">{reloadState === 'done' ? 'Angefordert!' : reloadState === 'error' ? 'Retry' : 'Aufladen'}</span>
        </Button>
      </div>

      {/* Entwerten */}
      {chip && (
        <div className="pt-1 border-t border-white/10">
          {!showConfirm && invalidateState !== 'done' && (
            <button onClick={() => setShowConfirm(true)} disabled={invalidateState === 'loading'}
              className={cn('w-full flex items-center justify-center gap-2 h-10 rounded-xl border text-xs font-bold transition-all',
                invalidateState === 'error'
                  ? 'bg-red-500/15 border-red-500/30 text-red-300'
                  : 'bg-red-500/8 border-red-500/20 text-red-400/70 hover:bg-red-500/12 hover:text-red-400')}>
              {invalidateState === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              {invalidateState === 'error' ? 'Fehler – Retry' : 'Entwertung beantragen'}
            </button>
          )}
          {showConfirm && (
            <div className="rounded-xl border border-red-500/25 bg-red-500/8 p-3 space-y-2">
              <p className="text-red-300 text-xs text-center font-semibold">Schein wirklich entwerten?</p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={handleInvalidate}
                  className="h-9 rounded-lg border border-red-500/30 bg-red-500/15 text-red-300 text-xs font-bold hover:bg-red-500/25">
                  <Check className="w-3.5 h-3.5 inline mr-1" /> Ja
                </button>
                <button onClick={() => setShowConfirm(false)}
                  className="h-9 rounded-lg border border-white/15 bg-white/5 text-slate-400 text-xs font-bold hover:bg-white/10">
                  Abbrechen
                </button>
              </div>
            </div>
          )}
          {invalidateState === 'done' && (
            <div className="flex items-center justify-center gap-2 h-10 rounded-xl border border-red-500/20 bg-red-500/8">
              <CheckCircle className="w-3.5 h-3.5 text-red-400" />
              <span className="text-red-400 text-xs font-bold">Entwertung beantragt</span>
            </div>
          )}
        </div>
      )}

      {anyDone && (
        <a href={WEBSITE_URL} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full h-11 rounded-xl border text-sm font-bold transition-all bg-white/5 border-white/15 text-slate-300 hover:bg-white/10">
          <Globe className="w-4 h-4 text-slate-400" /> Website anschauen
        </a>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function NFCScanner() {
  const [scanStatus, setScanStatus] = useState<ScanStatus>('idle');
  const [lastScan,   setLastScan]   = useState<ScanResult | null>(null);
  const [history,    setHistory]    = useState<Array<{ scan: ScanResult; verify: VerifyResult }>>([]);
  const [errorMsg,   setErrorMsg]   = useState<string | null>(null);
  const [showWriteFlow, setShowWriteFlow] = useState(false);
  const { toast } = useToast();
  const native = isNativeAvailable();

  useEffect(() => () => { stopNativeScan(); }, []);

  const handleResult = useCallback((result: ScanResult) => {
    setLastScan(result);
    setScanStatus('scanning');
    setErrorMsg(null);
    setShowWriteFlow(false);
  }, []);

  const handleError = useCallback((msg: string) => {
    setErrorMsg(msg);
    setScanStatus('error');
    toast({ title: 'NFC Fehler', description: msg, variant: 'destructive' });
  }, [toast]);

  useEffect(() => {
    if (lastScan) {
      const verify = classify(lastScan);
      setHistory(h => [{ scan: lastScan, verify }, ...h].slice(0, 20));
    }
  }, [lastScan]);

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

  const currentVerify = lastScan ? classify(lastScan) : null;
  const currentChip   = currentVerify?.kind !== 'unknown' ? currentVerify?.chip : null;

  return (
    <div className="w-full max-w-md mx-auto space-y-5">
      {/* Mode badge */}
      <div className="flex justify-center">
        {native
          ? <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30 text-xs"><Zap className="w-3 h-3 mr-1" />Native IsoDep · GetTTStatus 0xF7</Badge>
          : <Badge className="bg-slate-700/60 text-slate-400 border-slate-600 text-xs"><WifiOff className="w-3 h-3 mr-1" />Nur in nativer APK</Badge>
        }
      </div>

      {/* Scan button */}
      <div className="flex justify-center py-2">
        <ScanButton status={scanStatus} hasResult={lastScan !== null} onScan={startScan} onStop={stopScan} />
      </div>

      {/* Hints */}
      {scanStatus === 'idle' && !lastScan && <p className="text-center text-slate-500 text-sm">NTAG 424 TT Tag an die Rückseite halten</p>}
      {scanStatus === 'scanning' && !lastScan && <p className="text-center text-blue-300 text-sm animate-pulse">Halte den Tag an dein Gerät…</p>}
      {scanStatus === 'scanning' && lastScan  && <p className="text-center text-blue-400/70 text-xs">Bereit für nächsten Tag · Stopp zum Beenden</p>}

      {/* Error */}
      {errorMsg && (
        <Card className="border-red-500/30 bg-red-500/10">
          <CardContent className="py-3 px-4 flex items-start gap-2">
            <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-red-300 text-sm">{errorMsg}</p>
          </CardContent>
        </Card>
      )}

      {/* Result */}
      {lastScan && currentVerify && (
        <div className="space-y-3">
          <Card className={cn('border overflow-hidden',
            currentVerify.kind === 'verified' && 'border-emerald-500/30 bg-emerald-500/5',
            currentVerify.kind === 'warn'     && 'border-orange-500/30 bg-orange-500/5',
            currentVerify.kind === 'unknown'  && 'border-red-500/20 bg-red-500/5',
          )}>
            <CardContent className="p-0">
              <VerifyBadge verify={currentVerify} scan={lastScan} />
            </CardContent>
          </Card>

          <UIDRow uid={lastScan.uid} />

          {(currentVerify.kind === 'warn' || currentVerify.kind === 'unknown') && (
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5">
                <div className="text-slate-500 text-xs mb-0.5">Tamper-Status</div>
                <div className="font-mono text-white text-sm font-bold">{lastScan.tamperStatus}</div>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5">
                <div className="text-slate-500 text-xs mb-0.5">Zeitstempel</div>
                <div className="text-white text-sm font-mono">{new Date(lastScan.timestamp).toLocaleTimeString('de-DE')}</div>
              </div>
            </div>
          )}

          {/* Schreib-Flow wenn aktiv */}
          {showWriteFlow && currentChip && (
            <WriteFlow scan={lastScan} chip={currentChip} onClose={() => setShowWriteFlow(false)} />
          )}

          {/* Online Actions */}
          {!showWriteFlow && (
            <div className="pt-1">
              <p className="text-slate-500 text-xs text-center mb-3">Ergebnis eintragen, Aufladen anfordern oder Entwerten:</p>
              <OnlineActions
                scan={lastScan}
                verify={currentVerify}
                onStartWriteFlow={() => setShowWriteFlow(true)}
              />
            </div>
          )}

          {currentVerify.kind !== 'verified' && <RawDataPanel scan={lastScan} verify={currentVerify} />}
          <p className="text-center text-slate-600 text-xs">Nächsten Tag einfach ranhalten</p>
        </div>
      )}

      {!native && (
        <Card className="border-slate-700 bg-slate-800/40">
          <CardContent className="py-4 px-4 text-center space-y-2">
            <ShieldAlert className="w-8 h-8 text-slate-500 mx-auto" />
            <p className="text-slate-300 text-sm font-medium">APK erforderlich</p>
            <p className="text-slate-500 text-xs">Installiere die APK auf deinem Android-Gerät.</p>
          </CardContent>
        </Card>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-slate-500 text-xs font-medium uppercase tracking-wider">Verlauf ({history.length})</h3>
            <button onClick={() => { setHistory([]); setLastScan(null); setScanStatus('idle'); }}
              className="text-slate-600 hover:text-slate-400 text-xs flex items-center gap-1">
              <RefreshCw className="w-3 h-3" /> Löschen
            </button>
          </div>
          {history.map(({ scan, verify }) => (
            <HistoryItem key={scan.timestamp} scan={scan} verify={verify} />
          ))}
        </div>
      )}
    </div>
  );
}
