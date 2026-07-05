import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Wifi, WifiOff, CheckCircle, XCircle,
  RefreshCw, Copy, ChevronDown, ChevronUp, Zap,
  ShieldAlert, HelpCircle, Globe, Upload, Loader2, Trash2,
  Check, ShieldCheck, ShieldX, AlertTriangle, ExternalLink,
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
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { usePublishAnonymous } from '@/hooks/usePublishAnonymous';
import { LNBITS_CONFIG } from '@/lib/lnbitsConfig';

// ─── QR Code (canvas) ─────────────────────────────────────────────────────────
import { QRCodeCanvas } from '@/components/ui/qrcode';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WEBSITE_BASE = 'https://Testtest123.shakespeare.wtf';

function chipWebsiteUrl(uid: string) {
  // Opens website directly on the detail page for this chip
  return `${WEBSITE_BASE}?chip=${uid}`;
}

function formatTimeLeft(seconds: number): string {
  if (seconds <= 0) return 'Abgelaufen';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ─── Chip-Status Badge ────────────────────────────────────────────────────────

function ChipStatusBadge({ status }: { status: ChipStatus }) {
  if (status === 'valid')
    return (
      <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full"
        style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: '#34d399' }}>
        <ShieldCheck className="w-4 h-4" />
        <span className="font-bold text-sm">VALID — aufgeladen</span>
      </div>
    );
  if (status === 'entwertenbeantragt')
    return (
      <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full"
        style={{ background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.3)', color: '#fb923c' }}>
        <AlertTriangle className="w-4 h-4" />
        <span className="font-bold text-sm">Entwertung beantragt</span>
      </div>
    );
  return (
    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full"
      style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
      <ShieldX className="w-4 h-4" />
      <span className="font-bold text-sm">INVALID — entwertet</span>
    </div>
  );
}

// ─── Result card ──────────────────────────────────────────────────────────────

function ResultCard({ verify, scan }: { verify: VerifyResult; scan: ScanResult }) {
  const chip       = verify.kind !== 'unknown' ? verify.chip : null;
  const chipStatus = chip?.status ?? null;
  const isKnown    = verify.kind !== 'unknown';

  const borderColor = isKnown ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.25)';
  const bgColor     = isKnown ? 'rgba(16,185,129,0.05)' : 'rgba(239,68,68,0.05)';
  const Icon        = isKnown ? (chipStatus === 'invalid' ? ShieldX : ShieldCheck) : HelpCircle;
  const iconColor   = isKnown ? (chipStatus === 'invalid' ? '#f87171' : '#34d399') : '#f87171';

  return (
    <div className="rounded-2xl p-5 space-y-3" style={{ background: bgColor, border: `1px solid ${borderColor}` }}>
      <div className="flex items-center gap-4">
        {/* Icon */}
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{ background: isKnown ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)', border: `1px solid ${borderColor}` }}>
          <Icon className="w-8 h-8" style={{ color: iconColor }} />
        </div>
        {/* Info */}
        <div className="flex-1 min-w-0">
          {chip ? (
            <>
              <div className="text-2xl font-black" style={{ color: '#f7931a' }}>{chip.label}</div>
              {chip.issuedAt && <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>Ausgegeben: {chip.issuedAt}</div>}
            </>
          ) : (
            <div className="text-lg font-bold text-red-300">Chip nicht registriert</div>
          )}
          <div className="font-mono text-[11px] mt-1 break-all" style={{ color: 'rgba(255,255,255,0.4)' }}>{scan.uid}</div>
        </div>
      </div>
      {/* DB Status */}
      {chipStatus && <div className="flex justify-start"><ChipStatusBadge status={chipStatus} /></div>}
    </div>
  );
}

// ─── Verification result type ─────────────────────────────────────────────────

type VerifyResult =
  | { kind: 'verified'; chip: ChipEntry }
  | { kind: 'warn';     chip: ChipEntry }
  | { kind: 'unknown' };

function classify(scan: ScanResult): VerifyResult {
  const chip = lookupChip(scan.uid);
  if (!chip) return { kind: 'unknown' };
  // Status aus DB ist primary; tamper nur noch als debug-info
  return chip.status === 'valid'
    ? { kind: 'verified', chip }
    : { kind: 'warn', chip };
}

// ─── UID copy row ─────────────────────────────────────────────────────────────

function UIDRow({ uid }: { uid: string }) {
  const { toast } = useToast();
  return (
    <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-slate-500 text-[10px] uppercase tracking-wider mb-0.5">Chip UID</div>
        <div className="font-mono text-white text-xs tracking-widest truncate">{uid}</div>
      </div>
      <button onClick={() => navigator.clipboard.writeText(uid).then(() => toast({ title: 'UID kopiert' })).catch(() => {})}
        className="text-slate-500 hover:text-slate-300 transition-colors p-2 flex-shrink-0">
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
    <button onClick={scanning ? onStop : onScan} disabled={status === 'unsupported'}
      className={cn(
        'relative w-40 h-40 rounded-full flex flex-col items-center justify-center gap-2 border-4 transition-all duration-300 select-none',
        'focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500',
        status === 'idle'        && 'bg-blue-600/20 border-blue-500/50 hover:bg-blue-600/30 hover:border-blue-400 active:scale-95 cursor-pointer',
        scanning                 && 'bg-blue-600/30 border-blue-400 animate-pulse cursor-pointer',
        status === 'error'       && 'bg-red-600/20 border-red-500/50 hover:bg-red-600/30 cursor-pointer',
        status === 'unsupported' && 'bg-slate-800/50 border-slate-700 cursor-not-allowed opacity-50',
      )}>
      {scanning && (
        <>
          <span className="absolute inset-0 rounded-full border-4 border-blue-400 animate-ping opacity-20" />
          <span className="absolute -inset-3 rounded-full border-2 border-blue-400/15 animate-ping" style={{ animationDelay: '0.4s' }} />
        </>
      )}
      <div className="relative z-10">
        {status === 'error'       && <XCircle className="w-10 h-10 text-red-400" />}
        {status === 'unsupported' && <WifiOff className="w-10 h-10 text-slate-500" />}
        {(status === 'idle' || scanning) && <Wifi className={cn('w-10 h-10', scanning ? 'text-blue-300' : 'text-blue-400')} />}
      </div>
      <span className={cn('relative z-10 text-xs font-bold tracking-widest uppercase',
        status === 'idle' && 'text-blue-300', scanning && 'text-blue-200',
        status === 'error' && 'text-red-300', status === 'unsupported' && 'text-slate-500',
      )}>
        {status === 'idle' && 'Scannen'}
        {scanning && !hasResult && 'Warte…'}
        {scanning && hasResult  && 'Scannt…'}
        {status === 'error'     && 'Retry'}
        {status === 'unsupported' && 'N/A'}
      </span>
    </button>
  );
}

// ─── Invoice Panel (in-app) ───────────────────────────────────────────────────

type InvoicePhase = 'idle' | 'loading' | 'open' | 'paid' | 'error';

interface InvoicePanelProps {
  chip: ChipEntry;
  onPaid: (paymentHash: string) => void;
}

const DEFAULT_KEYS = {
  appMasterKey: '00000000000000000000000000000000',
  fileReadKey:  '00000000000000000000000000000000',
  fileWriteKey: '00000000000000000000000000000000',
};

function InvoicePanel({ chip, onPaid }: InvoicePanelProps) {
  const [phase,     setPhase]     = useState<InvoicePhase>('idle');
  const [bolt11,    setBolt11]    = useState('');
  const [hash,      setHash]      = useState('');
  const [expiresAt, setExpiresAt] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [copied,    setCopied]    = useState(false);
  const [errMsg,    setErrMsg]    = useState('');
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { toast } = useToast();

  useEffect(() => () => {
    if (pollRef.current)  clearInterval(pollRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const generate = async () => {
    setPhase('loading');
    try {
      const amount = chip.sats + LNBITS_CONFIG.reloadFee;
      const res = await fetch(`${LNBITS_CONFIG.nodeUrl}/api/v1/payments`, {
        method: 'POST',
        headers: { 'X-Api-Key': LNBITS_CONFIG.invoiceReadKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ out: false, amount, memo: `Aufladen: ${chip.uid} (${chip.label})`, expiry: LNBITS_CONFIG.invoiceExpiry, unit: 'sat' }),
      });
      if (!res.ok) throw new Error(`LNbits ${res.status}`);
      const data = await res.json() as { payment_hash: string; payment_request: string };
      setBolt11(data.payment_request);
      setHash(data.payment_hash);
      const exp = Math.floor(Date.now() / 1000) + LNBITS_CONFIG.invoiceExpiry;
      setExpiresAt(exp);
      setRemaining(LNBITS_CONFIG.invoiceExpiry);
      setPhase('open');

      // Countdown timer
      timerRef.current = setInterval(() => {
        setRemaining(r => Math.max(0, r - 1));
      }, 1000);

      // Payment polling
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
            toast({ title: '💰 Zahlung eingegangen!', description: 'Chip jetzt ranhalten zum Schreiben.' });
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

  const amount = chip.sats + LNBITS_CONFIG.reloadFee;
  const expired = remaining <= 0 && phase === 'open';
  const urgent  = remaining > 0 && remaining < 120;

  if (phase === 'idle') return (
    <button onClick={generate}
      className="w-full h-12 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98]"
      style={{ background: 'linear-gradient(135deg, rgba(247,147,26,0.2) 0%, rgba(247,147,26,0.1) 100%)', border: '1px solid rgba(247,147,26,0.4)', color: '#f7931a' }}>
      <Zap className="w-4 h-4" />
      Invoice erstellen — {amount.toLocaleString('de-DE')} sats
    </button>
  );

  if (phase === 'loading') return (
    <div className="w-full h-12 rounded-xl flex items-center justify-center gap-2"
      style={{ background: 'rgba(247,147,26,0.08)', border: '1px solid rgba(247,147,26,0.2)' }}>
      <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#f7931a' }} />
      <span className="text-sm" style={{ color: 'rgba(247,147,26,0.7)' }}>Generiere Invoice…</span>
    </div>
  );

  if (phase === 'error') return (
    <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
      <p className="text-red-300 text-xs">{errMsg}</p>
      <button onClick={() => setPhase('idle')} className="text-xs px-3 py-1 rounded-lg"
        style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}>Nochmal</button>
    </div>
  );

  if (phase === 'paid') return (
    <div className="rounded-xl p-4 text-center space-y-1"
      style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)' }}>
      <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto" />
      <p className="text-emerald-300 font-bold">Bezahlt! Chip jetzt ranhalten.</p>
    </div>
  );

  // open
  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(247,147,26,0.25)' }}>
      {/* Amount + Timer header */}
      <div className="px-4 pt-4 pb-3 flex items-center justify-between"
        style={{ background: 'rgba(247,147,26,0.06)' }}>
        <div>
          <div className="text-2xl font-black" style={{ color: '#f7931a' }}>
            {amount.toLocaleString('de-DE')} <span className="text-base font-bold">sats</span>
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
            ({chip.sats.toLocaleString('de-DE')} + {LNBITS_CONFIG.reloadFee} Gebühr)
          </div>
        </div>
        {/* Countdown */}
        <div className={cn('text-right', expired ? 'text-red-400' : urgent ? 'text-orange-400' : 'text-slate-400')}>
          <div className="text-xs font-mono font-bold">{expired ? 'ABGELAUFEN' : formatTimeLeft(remaining)}</div>
          <div className="text-[10px] opacity-60">verbleibend</div>
        </div>
      </div>

      {/* QR Code */}
      {!expired && (
        <div className="flex justify-center py-4 px-4" style={{ background: 'white' }}>
          <QRCodeCanvas value={bolt11.toUpperCase()} size={200} level="M" />
        </div>
      )}
      {expired && (
        <div className="py-6 text-center">
          <p className="text-red-300 text-sm font-semibold">Invoice abgelaufen</p>
          <button onClick={generate} className="mt-2 text-xs px-3 py-1.5 rounded-lg"
            style={{ background: 'rgba(247,147,26,0.12)', border: '1px solid rgba(247,147,26,0.3)', color: '#f7931a' }}>
            Neu generieren
          </button>
        </div>
      )}

      {/* Actions */}
      {!expired && (
        <div className="px-4 pb-4 pt-3 space-y-2" style={{ background: 'rgba(0,0,0,0.15)' }}>
          <button onClick={copy}
            className="w-full h-10 rounded-xl flex items-center justify-center gap-2 text-sm font-bold transition-all"
            style={copied
              ? { background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.35)', color: '#34d399' }
              : { background: 'rgba(247,147,26,0.1)',  border: '1px solid rgba(247,147,26,0.25)', color: '#f7931a' }}>
            {copied ? <><Check className="w-4 h-4" /> Kopiert!</> : <><Copy className="w-4 h-4" /> Invoice kopieren</>}
          </button>
          <button onClick={cancel} className="w-full text-center text-xs py-1" style={{ color: 'rgba(255,255,255,0.2)' }}>
            Abbrechen
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Write Flow ───────────────────────────────────────────────────────────────

type WriteFlowStep = 'tap_to_write' | 'holding' | 'writing' | 'tap_to_verify' | 'verifying' | 'done_ok' | 'done_error';

function WriteFlow({ scan, chip, onClose }: { scan: ScanResult; chip: ChipEntry; onClose: () => void }) {
  const [step,            setStep]            = useState<WriteFlowStep>('tap_to_write');
  const [holdSeconds,     setHoldSeconds]     = useState(0);
  const [errorMsg,        setErrorMsg]        = useState('');
  const [verifiedStatus,  setVerifiedStatus]  = useState<ChipStatus | null>(null);
  const holdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { toast } = useToast();

  useEffect(() => () => { if (holdRef.current) clearInterval(holdRef.current); }, []);

  const startHolding = useCallback(() => {
    setStep('holding');
    setHoldSeconds(0);
    holdRef.current = setInterval(() => {
      setHoldSeconds(s => {
        if (s >= 9) {
          clearInterval(holdRef.current!);
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
    if (!result.success) { setErrorMsg(result.error ?? 'Fehler'); setStep('done_error'); return; }
    toast({ title: '✅ Geschrieben', description: 'Nochmal ranhalten zur Verifikation.' });
    setStep('tap_to_verify');
  }, [scan.uid, toast]);

  const doVerify = useCallback(async () => {
    setStep('verifying');
    const result = await readChipStatus(scan.uid, DEFAULT_KEYS);
    if (!result.success) { setErrorMsg(result.error ?? 'Fehler'); setStep('done_error'); return; }
    setVerifiedStatus(result.status ?? null);
    setStep('done_ok');
    toast({ title: result.status === 'valid' ? '✅ Verifiziert' : '⚠️ Achtung', description: `Chip: ${result.status}` });
  }, [scan.uid, toast]);

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-amber-300 font-bold text-sm">⚡ Schreib-Flow</span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xs">✕</button>
        </div>

        {step === 'tap_to_write' && (
          <div className="text-center space-y-3 py-2">
            <div className="w-14 h-14 rounded-full bg-amber-500/20 border-2 border-amber-500/50 flex items-center justify-center mx-auto animate-pulse">
              <Wifi className="w-7 h-7 text-amber-400" />
            </div>
            <p className="text-amber-300 font-bold">Chip jetzt ranhalten!</p>
            <p className="text-slate-400 text-xs">10 Sekunden stabil halten zum Schreiben.</p>
            <Button onClick={startHolding} variant="outline"
              className="bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30">
              Chip ist dran — Starten
            </Button>
          </div>
        )}

        {step === 'holding' && (
          <div className="text-center space-y-3 py-2">
            <div className="relative w-16 h-16 mx-auto">
              <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(245,158,11,0.2)" strokeWidth="5" />
                <circle cx="32" cy="32" r="26" fill="none" stroke="#f59e0b" strokeWidth="5"
                  strokeDasharray={`${2 * Math.PI * 26}`}
                  strokeDashoffset={`${2 * Math.PI * 26 * (1 - holdSeconds / 10)}`}
                  className="transition-all duration-1000" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-lg font-black text-amber-400">{10 - holdSeconds}</span>
            </div>
            <p className="text-amber-300 font-bold text-sm">Festhalten…</p>
          </div>
        )}

        {step === 'writing'    && <div className="text-center py-4"><Loader2 className="w-8 h-8 text-emerald-400 animate-spin mx-auto" /><p className="text-emerald-300 font-bold mt-2 text-sm">Schreibe…</p></div>}
        {step === 'tap_to_verify' && (
          <div className="text-center space-y-3 py-2">
            <div className="w-14 h-14 rounded-full bg-blue-500/20 border-2 border-blue-500/50 flex items-center justify-center mx-auto animate-pulse">
              <Wifi className="w-7 h-7 text-blue-400" />
            </div>
            <p className="text-blue-300 font-bold text-sm">Nochmal ranhalten zur Verifikation</p>
            <Button onClick={doVerify} variant="outline" className="bg-blue-500/15 border-blue-500/35 text-blue-300">Jetzt verifizieren</Button>
          </div>
        )}
        {step === 'verifying'  && <div className="text-center py-4"><Loader2 className="w-8 h-8 text-blue-400 animate-spin mx-auto" /><p className="text-blue-300 font-bold mt-2 text-sm">Verifiziere…</p></div>}
        {step === 'done_ok'    && (
          <div className="text-center space-y-2 py-2">
            <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto" />
            <p className="text-emerald-300 font-bold">Fertig!</p>
            {verifiedStatus && <ChipStatusBadge status={verifiedStatus} />}
            <Button onClick={onClose} variant="outline" className="bg-emerald-500/15 border-emerald-500/30 text-emerald-300">Schließen</Button>
          </div>
        )}
        {step === 'done_error' && (
          <div className="text-center space-y-2 py-2">
            <XCircle className="w-10 h-10 text-red-400 mx-auto" />
            <p className="text-red-300 text-xs">{errorMsg}</p>
            <Button onClick={() => setStep('tap_to_write')} variant="outline" className="bg-red-500/15 border-red-500/30 text-red-300">Retry</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── History item ─────────────────────────────────────────────────────────────

function HistoryItem({ scan, verify }: { scan: ScanResult; verify: VerifyResult }) {
  const [open, setOpen] = useState(false);
  const chip  = verify.kind !== 'unknown' ? verify.chip : null;
  const label = chip?.label ?? 'Unbekannt';
  const dot   = chip?.status === 'valid' ? 'bg-emerald-400' : chip?.status === 'invalid' ? 'bg-red-400' : chip?.status === 'entwertenbeantragt' ? 'bg-orange-400' : 'bg-slate-500';
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 p-3 hover:bg-white/5 transition-colors text-left">
        <div className={cn('w-2 h-2 rounded-full flex-shrink-0', dot)} />
        <div className="flex-1 min-w-0">
          <div className="text-white text-sm font-medium truncate">{label}</div>
          <div className="text-slate-500 text-xs font-mono truncate">{scan.uid}</div>
        </div>
        <span className="text-slate-600 text-xs flex-shrink-0">
          {new Date(scan.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
        </span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
      </button>
      {open && (
        <div className="border-t border-white/10 px-3 pb-3 pt-2">
          <div className="text-slate-500 text-xs font-mono break-all">{scan.uid}</div>
        </div>
      )}
    </div>
  );
}

// ─── Online actions ───────────────────────────────────────────────────────────

type ActionState = 'idle' | 'loading' | 'done' | 'error';

function OnlineActions({ scan, verify, onStartInvoice, showingInvoice }: {
  scan: ScanResult;
  verify: VerifyResult;
  onStartInvoice: () => void;
  showingInvoice: boolean;
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
        content: JSON.stringify({ uid: scan.uid, label: chip?.label ?? '', sats: chip?.sats ?? 0, result: verify.kind }),
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
      toast({ title: '📤 Anfrage gesendet', description: 'Invoice wird jetzt angezeigt.' });
      onStartInvoice();
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

  return (
    <div className="space-y-2">
      {/* Verify */}
      <Button onClick={handleVerify} disabled={verifyState === 'loading' || verifyState === 'done'} variant="outline"
        className={cn('w-full h-11 text-sm font-bold rounded-xl border transition-all',
          verifyState === 'done'  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' :
          verifyState === 'error' ? 'bg-red-500/15 border-red-500/35 text-red-300' :
          'bg-blue-500/15 border-blue-500/35 text-blue-300 hover:bg-blue-500/25')}>
        {verifyState === 'loading' ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> :
         verifyState === 'done'    ? <CheckCircle className="w-4 h-4 mr-2" /> :
         <Globe className="w-4 h-4 mr-2" />}
        {verifyState === 'done' ? 'Eingetragen!' : verifyState === 'error' ? 'Retry' : 'Online verifizieren'}
      </Button>

      {/* Aufladen — nur wenn noch kein Invoice offen */}
      {!showingInvoice && (
        <Button onClick={handleReload} disabled={reloadState === 'loading' || reloadState === 'done'} variant="outline"
          className={cn('w-full h-11 text-sm font-bold rounded-xl border transition-all',
            reloadState === 'done'  ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' :
            reloadState === 'error' ? 'bg-red-500/15 border-red-500/35 text-red-300' :
            'bg-amber-500/10 border-amber-500/25 text-amber-300 hover:bg-amber-500/20')}>
          {reloadState === 'loading' ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> :
           reloadState === 'done'    ? <CheckCircle className="w-4 h-4 mr-2" /> :
           <Upload className="w-4 h-4 mr-2" />}
          {reloadState === 'done' ? 'Angefordert!' : reloadState === 'error' ? 'Retry' : 'Aufladen anfordern'}
        </Button>
      )}

      {/* Website anschauen — direkt zum Chip */}
      {chip && (
        <a href={chipWebsiteUrl(chip.uid)} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full h-11 rounded-xl border text-sm font-bold transition-all bg-white/5 border-white/15 text-slate-300 hover:bg-white/10">
          <ExternalLink className="w-4 h-4 text-slate-400" />
          Schein auf Website ansehen
        </a>
      )}

      {/* Entwerten */}
      {chip && (
        <div className="pt-1 border-t border-white/10">
          {!showConfirm && invalidateState !== 'done' && (
            <button onClick={() => setShowConfirm(true)} disabled={invalidateState === 'loading'}
              className="w-full flex items-center justify-center gap-2 h-9 rounded-xl border text-xs font-bold transition-all bg-red-500/8 border-red-500/20 text-red-400/70 hover:bg-red-500/12 hover:text-red-400">
              {invalidateState === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
              Entwertung beantragen
            </button>
          )}
          {showConfirm && (
            <div className="rounded-xl border border-red-500/25 bg-red-500/8 p-3 space-y-2">
              <p className="text-red-300 text-xs text-center font-semibold">Schein wirklich entwerten?</p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={handleInvalidate}
                  className="h-8 rounded-lg border border-red-500/30 bg-red-500/15 text-red-300 text-xs font-bold">
                  <Check className="w-3 h-3 inline mr-1" /> Ja
                </button>
                <button onClick={() => setShowConfirm(false)}
                  className="h-8 rounded-lg border border-white/15 bg-white/5 text-slate-400 text-xs font-bold">
                  Abbrechen
                </button>
              </div>
            </div>
          )}
          {invalidateState === 'done' && (
            <div className="flex items-center justify-center gap-2 h-9 rounded-xl border border-red-500/20 bg-red-500/8">
              <CheckCircle className="w-3.5 h-3.5 text-red-400" />
              <span className="text-red-400 text-xs font-bold">Entwertung beantragt</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function NFCScanner() {
  const [scanStatus,    setScanStatus]    = useState<ScanStatus>('idle');
  const [lastScan,      setLastScan]      = useState<ScanResult | null>(null);
  const [history,       setHistory]       = useState<Array<{ scan: ScanResult; verify: VerifyResult }>>([]);
  const [errorMsg,      setErrorMsg]      = useState<string | null>(null);
  const [showInvoice,   setShowInvoice]   = useState(false);
  const [showWriteFlow, setShowWriteFlow] = useState(false);
  const [paidHash,      setPaidHash]      = useState<string | null>(null);
  const { toast } = useToast();
  const native = isNativeAvailable();

  useEffect(() => () => { stopNativeScan(); }, []);

  const handleResult = useCallback((result: ScanResult) => {
    setLastScan(result);
    setScanStatus('scanning');
    setErrorMsg(null);
    setShowInvoice(false);
    setShowWriteFlow(false);
    setPaidHash(null);
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

  // Hört auf Kind 3493 (Zahlung bestätigt von Website)
  const currentChip = lastScan ? (classify(lastScan).kind !== 'unknown' ? (classify(lastScan) as { kind: 'verified' | 'warn'; chip: ChipEntry }).chip : null) : null;
  const { data: paymentEvent } = usePaymentConfirmed(lastScan?.uid ?? null);

  useEffect(() => {
    if (paymentEvent && showInvoice && !showWriteFlow) {
      setShowWriteFlow(true);
      setShowInvoice(false);
    }
  }, [paymentEvent, showInvoice, showWriteFlow]);

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

  return (
    <div className="w-full max-w-md mx-auto space-y-4">

      {/* Scan button */}
      <div className="flex justify-center pt-2">
        <ScanButton status={scanStatus} hasResult={lastScan !== null} onScan={startScan} onStop={stopScan} />
      </div>

      {/* Hints */}
      {scanStatus === 'idle' && !lastScan && (
        <p className="text-center text-slate-500 text-sm">NTAG 424 Tag an die Rückseite halten</p>
      )}
      {scanStatus === 'scanning' && !lastScan && (
        <p className="text-center text-blue-300 text-sm animate-pulse">Halte den Tag an dein Gerät…</p>
      )}
      {scanStatus === 'scanning' && lastScan && (
        <p className="text-center text-blue-400/70 text-xs">Bereit für nächsten Tag · Stopp zum Beenden</p>
      )}

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
          {/* Result card — kein Tamper mehr */}
          <ResultCard verify={currentVerify} scan={lastScan} />

          {/* UID */}
          <UIDRow uid={lastScan.uid} />

          {/* Write Flow */}
          {showWriteFlow && currentChip && (
            <WriteFlow scan={lastScan} chip={currentChip} onClose={() => setShowWriteFlow(false)} />
          )}

          {/* Invoice Panel */}
          {showInvoice && currentChip && !showWriteFlow && (
            <InvoicePanel
              chip={currentChip}
              onPaid={(hash) => {
                setPaidHash(hash);
                setShowWriteFlow(true);
                setShowInvoice(false);
              }}
            />
          )}

          {/* Actions — nur wenn kein Invoice/WriteFlow aktiv */}
          {!showWriteFlow && (
            <div className="pt-1">
              <p className="text-slate-500 text-xs text-center mb-2">
                {showInvoice ? 'Invoice offen — bezahle um fortzufahren:' : 'Aktionen:'}
              </p>
              {!showInvoice && (
                <OnlineActions
                  scan={lastScan}
                  verify={currentVerify}
                  onStartInvoice={() => setShowInvoice(true)}
                  showingInvoice={showInvoice}
                />
              )}
            </div>
          )}

          <p className="text-center text-slate-600 text-xs">Nächsten Tag einfach ranhalten</p>
        </div>
      )}

      {/* Not native */}
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
        <div className="space-y-2 pt-2">
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
