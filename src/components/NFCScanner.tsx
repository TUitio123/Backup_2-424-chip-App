import { useState, useEffect, useCallback } from 'react';
import {
  Wifi, WifiOff, CheckCircle, XCircle, AlertTriangle,
  RefreshCw, Copy, ChevronDown, ChevronUp, Zap,
  ShieldAlert, HelpCircle, Globe, Upload, Loader2, Trash2, Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ScanResult, ScanStatus, TamperStatus,
  isNativeAvailable, startNativeScan, stopNativeScan,
} from '@/lib/ntag424';
import {
  lookupChip, ChipEntry, KIND_VERIFY_LOG, KIND_RELOAD_REQUEST,
  KIND_INVALIDATE_REQUEST, APP_TAG,
} from '@/lib/chipRegistry';
import { useToast } from '@/hooks/useToast';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { usePublishAnonymous } from '@/hooks/usePublishAnonymous';

// ─── Verification result type ─────────────────────────────────────────────────

type VerifyResult =
  | { kind: 'verified'; chip: ChipEntry }
  | { kind: 'warn';     chip: ChipEntry }
  | { kind: 'unknown' };

function classify(scan: ScanResult): VerifyResult {
  const chip = lookupChip(scan.uid);
  if (!chip) return { kind: 'unknown' };
  return scan.tamperStatus === 'CC'
    ? { kind: 'verified', chip }
    : { kind: 'warn', chip };
}

// ─── Tamper pill ──────────────────────────────────────────────────────────────

function TamperPill({ tamperStatus, verifyKind }: {
  tamperStatus: TamperStatus;
  verifyKind: VerifyResult['kind'];
}) {
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

// ─── Big verification badge ───────────────────────────────────────────────────

function VerifyBadge({ verify, scan }: { verify: VerifyResult; scan: ScanResult }) {
  if (verify.kind === 'verified') {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <div className="relative">
          <div className="w-28 h-28 rounded-full bg-emerald-500/15 border-4 border-emerald-500/50 flex items-center justify-center shadow-[0_0_40px_rgba(16,185,129,0.25)]">
            <CheckCircle className="w-16 h-16 text-emerald-400" />
          </div>
          <span className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-emerald-500 border-2 border-slate-900 flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" />
          </span>
        </div>
        <div className="text-center">
          <div className="text-emerald-400 font-bold text-sm uppercase tracking-widest mb-1">Verified</div>
          <div className="text-white font-extrabold text-4xl tracking-tight">{verify.chip.label}</div>
          {verify.chip.info && <div className="text-slate-400 text-sm mt-1">{verify.chip.info}</div>}
          {verify.chip.issuedAt && <div className="text-slate-600 text-xs mt-0.5">Ausgegeben: {verify.chip.issuedAt}</div>}
        </div>
        <TamperPill tamperStatus={scan.tamperStatus} verifyKind="verified" />
      </div>
    );
  }

  if (verify.kind === 'warn') {
    const warnText =
      scan.tamperStatus === 'OO' ? 'Tamper-Draht gebrochen – Chip wurde geöffnet.' :
      scan.tamperStatus === 'OC' ? 'Chip war geöffnet, Draht scheint jetzt wieder geschlossen.' :
      scan.tamperStatus === 'II' ? 'Tamper-Feature nicht aktiviert – kein Draht konfiguriert.' :
      scan.tamperStatus === 'AUTH_REQUIRED' ? 'Tamper-Status konnte nicht gelesen werden (Auth erforderlich).' :
      `Tamper-Status unklar (${scan.tamperStatus}).`;
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <div className="w-28 h-28 rounded-full bg-orange-500/15 border-4 border-orange-500/50 flex items-center justify-center shadow-[0_0_40px_rgba(249,115,22,0.2)]">
          <AlertTriangle className="w-16 h-16 text-orange-400" />
        </div>
        <div className="text-center">
          <div className="text-orange-400 font-bold text-sm uppercase tracking-widest mb-1">Achtung</div>
          <div className="text-white font-extrabold text-4xl tracking-tight">{verify.chip.label}</div>
          {verify.chip.info && <div className="text-slate-400 text-sm mt-1">{verify.chip.info}</div>}
          {verify.chip.issuedAt && <div className="text-slate-600 text-xs mt-0.5">Ausgegeben: {verify.chip.issuedAt}</div>}
        </div>
        <TamperPill tamperStatus={scan.tamperStatus} verifyKind="warn" />
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-3 text-center max-w-xs">
          <AlertTriangle className="w-5 h-5 text-orange-400 mx-auto mb-1" />
          <p className="text-orange-300 font-semibold text-sm">Chip eventuell entwertet!</p>
          <p className="text-orange-400/70 text-xs mt-0.5">{warnText}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-6">
      <div className="w-28 h-28 rounded-full bg-red-500/15 border-4 border-red-500/40 flex items-center justify-center">
        <HelpCircle className="w-16 h-16 text-red-400" />
      </div>
      <div className="text-center">
        <div className="text-red-400 font-bold text-sm uppercase tracking-widest mb-1">Unbekannt</div>
        <div className="text-slate-300 text-lg font-semibold">Chip nicht registriert</div>
        <p className="text-slate-500 text-xs mt-1 max-w-xs">
          Diese UID ist nicht in der Registry. Chip gehört nicht zu diesem System.
        </p>
      </div>
      <TamperPill tamperStatus={scan.tamperStatus} verifyKind="unknown" />
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

// ─── UID display ──────────────────────────────────────────────────────────────

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
    <button
      onClick={scanning ? onStop : onScan}
      disabled={status === 'unsupported'}
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
        {(status === 'idle' || scanning) && (
          <Wifi className={cn('w-12 h-12', scanning ? 'text-blue-300' : 'text-blue-400')} />
        )}
      </div>
      <span className={cn('relative z-10 text-xs font-bold tracking-widest uppercase',
        status === 'idle'        && 'text-blue-300',
        scanning                 && 'text-blue-200',
        status === 'error'       && 'text-red-300',
        status === 'unsupported' && 'text-slate-500',
      )}>
        {status === 'idle'              && 'Scannen'}
        {scanning && !hasResult         && 'Warte…'}
        {scanning && hasResult          && 'Scannt…'}
        {status === 'error'             && 'Retry'}
        {status === 'unsupported'       && 'N/A'}
      </span>
    </button>
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

// ─── Online action buttons ────────────────────────────────────────────────────

const WEBSITE_URL = 'https://Testtest123.shakespeare.wtf';

type ActionState = 'idle' | 'loading' | 'done' | 'error';

function OnlineActions({ scan, verify }: { scan: ScanResult; verify: VerifyResult }) {
  const { mutateAsync: publishEvent } = usePublishAnonymous();
  const { toast } = useToast();
  const [verifyState, setVerifyState] = useState<ActionState>('idle');
  const [reloadState, setReloadState] = useState<ActionState>('idle');
  const [invalidateState, setInvalidateState] = useState<ActionState>('idle');
  const [showInvalidateConfirm, setShowInvalidateConfirm] = useState(false);

  const chip = verify.kind !== 'unknown' ? verify.chip : null;

  // Reset button states whenever the scanned chip changes
  useEffect(() => {
    setVerifyState('idle');
    setReloadState('idle');
    setInvalidateState('idle');
    setShowInvalidateConfirm(false);
  }, [scan.uid, scan.timestamp]);

  const handleVerify = async () => {
    setVerifyState('loading');
    try {
      await publishEvent({
        kind: KIND_VERIFY_LOG,
        content: JSON.stringify({
          uid: scan.uid,
          label: chip?.label ?? '',
          sats: chip?.sats ?? 0,
          tamperStatus: scan.tamperStatus,
          result: verify.kind,
        }),
        tags: [
          ['t', APP_TAG],
          ['alt', 'Bitcoin Note online verification log'],
        ],
      });
      setVerifyState('done');
      toast({ title: '✅ Online verifiziert', description: 'Eintrag auf der Website eingetragen.' });
    } catch (e) {
      setVerifyState('error');
      toast({ title: 'Fehler', description: String(e), variant: 'destructive' });
    }
  };

  /**
   * Aufladen: Sendet Kind 3491 Nostr-Event als Anfrage.
   * Der Aufladen-Button auf der Website wird erst danach klickbar.
   */
  const handleReload = async () => {
    setReloadState('loading');
    try {
      await publishEvent({
        kind: KIND_RELOAD_REQUEST,
        content: JSON.stringify({
          uid: scan.uid,
          label: chip?.label ?? '',
          sats: chip?.sats ?? 0,
        }),
        tags: [
          ['t', APP_TAG],
          ['alt', 'Bitcoin Note reload request'],
        ],
      });
      setReloadState('done');
      toast({
        title: '📤 Aufladen angefordert',
        description: 'Anfrage gesendet. Invoice auf der Website öffnen.',
      });
    } catch (e) {
      setReloadState('error');
      toast({ title: 'Fehler', description: String(e), variant: 'destructive' });
    }
  };

  /**
   * Entwerten: Sendet Kind 3492 Nostr-Event als Entwertungs-Anfrage.
   */
  const handleInvalidate = async () => {
    setShowInvalidateConfirm(false);
    setInvalidateState('loading');
    try {
      await publishEvent({
        kind: KIND_INVALIDATE_REQUEST,
        content: JSON.stringify({
          uid: scan.uid,
          label: chip?.label ?? '',
          sats: chip?.sats ?? 0,
        }),
        tags: [
          ['t', APP_TAG],
          ['alt', 'Bitcoin Note invalidation request'],
        ],
      });
      setInvalidateState('done');
      toast({
        title: '🗑️ Entwertung beantragt',
        description: 'Anfrage gesendet. Status auf der Website aktualisiert.',
      });
    } catch (e) {
      setInvalidateState('error');
      toast({ title: 'Fehler', description: String(e), variant: 'destructive' });
    }
  };

  const anyDone = verifyState === 'done' || reloadState === 'done';

  return (
    <div className="space-y-2">
      {/* Verify + Reload row */}
      <div className="grid grid-cols-2 gap-3">
        {/* Online verifizieren */}
        <Button
          onClick={handleVerify}
          disabled={verifyState === 'loading' || verifyState === 'done'}
          className={cn(
            'flex items-center gap-2 h-12 text-sm font-bold rounded-xl border transition-all',
            verifyState === 'done'
              ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
              : verifyState === 'error'
              ? 'bg-red-500/15 border-red-500/35 text-red-300 hover:bg-red-500/25'
              : 'bg-blue-500/15 border-blue-500/35 text-blue-300 hover:bg-blue-500/25',
          )}
          variant="outline"
        >
          {verifyState === 'loading' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : verifyState === 'done' ? (
            <CheckCircle className="w-4 h-4" />
          ) : (
            <Globe className="w-4 h-4" />
          )}
          {verifyState === 'done' ? 'Eingetragen!' : verifyState === 'error' ? 'Fehler – Retry' : 'Online verifizieren'}
        </Button>

        {/* Aufladen anfordern */}
        <Button
          onClick={handleReload}
          disabled={reloadState === 'loading' || reloadState === 'done'}
          className={cn(
            'flex items-center gap-2 h-12 text-sm font-bold rounded-xl border transition-all',
            reloadState === 'done'
              ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
              : reloadState === 'error'
              ? 'bg-red-500/15 border-red-500/35 text-red-300 hover:bg-red-500/25'
              : 'bg-amber-500/10 border-amber-500/25 text-amber-300 hover:bg-amber-500/20',
          )}
          variant="outline"
        >
          {reloadState === 'loading' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : reloadState === 'done' ? (
            <CheckCircle className="w-4 h-4" />
          ) : (
            <Upload className="w-4 h-4" />
          )}
          {reloadState === 'done' ? 'Angefordert!' : reloadState === 'error' ? 'Fehler – Retry' : 'Aufladen'}
        </Button>
      </div>

      {/* Hinweis wenn Aufladen angefordert */}
      {reloadState === 'done' && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-center">
          <p className="text-amber-300/80 text-xs">
            Invoice jetzt auf der Website verfügbar → Button dort klicken
          </p>
        </div>
      )}

      {/* Entwerten-Bereich */}
      {chip !== null && (
        <div className="pt-1 border-t border-white/10">
          {!showInvalidateConfirm && invalidateState !== 'done' && (
            <button
              onClick={() => setShowInvalidateConfirm(true)}
              disabled={invalidateState === 'loading'}
              className={cn(
                'w-full flex items-center justify-center gap-2 h-10 rounded-xl border text-xs font-bold transition-all',
                invalidateState === 'error'
                  ? 'bg-red-500/15 border-red-500/30 text-red-300 hover:bg-red-500/20'
                  : 'bg-red-500/8 border-red-500/20 text-red-400/70 hover:bg-red-500/12 hover:text-red-400',
              )}
            >
              {invalidateState === 'loading' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              {invalidateState === 'error' ? 'Fehler – Retry' : 'Entwertung beantragen'}
            </button>
          )}
          {showInvalidateConfirm && (
            <div className="rounded-xl border border-red-500/25 bg-red-500/8 p-3 space-y-2">
              <p className="text-red-300 text-xs text-center font-semibold">
                Schein wirklich entwerten?
              </p>
              <p className="text-red-400/60 text-[10px] text-center">
                Dies sendet eine Entwertungs-Anfrage via Nostr.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleInvalidate}
                  className="h-9 rounded-lg border border-red-500/30 bg-red-500/15 text-red-300 text-xs font-bold hover:bg-red-500/25 transition-colors"
                >
                  <Check className="w-3.5 h-3.5 inline mr-1" />
                  Ja, entwerten
                </button>
                <button
                  onClick={() => setShowInvalidateConfirm(false)}
                  className="h-9 rounded-lg border border-white/15 bg-white/5 text-slate-400 text-xs font-bold hover:bg-white/10 transition-colors"
                >
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

      {/* "Website anschauen" — erscheint nach jedem erfolgreichen Klick */}
      {anyDone && (
        <a
          href={WEBSITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'flex items-center justify-center gap-2 w-full h-11 rounded-xl border text-sm font-bold transition-all',
            'bg-white/5 border-white/15 text-slate-300 hover:bg-white/10 hover:border-white/25',
          )}
        >
          <Globe className="w-4 h-4 text-slate-400" />
          Website anschauen
        </a>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function NFCScanner() {
  const [scanStatus, setScanStatus] = useState<ScanStatus>('idle');
  const [lastScan, setLastScan] = useState<ScanResult | null>(null);
  const [history, setHistory] = useState<Array<{ scan: ScanResult; verify: VerifyResult }>>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { toast } = useToast();
  const native = isNativeAvailable();

  useEffect(() => () => { stopNativeScan(); }, []);

  const handleResult = useCallback((result: ScanResult) => {
    setLastScan(result);
    setScanStatus('scanning');
    setErrorMsg(null);
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
    if (!native) {
      setScanStatus('unsupported');
      setErrorMsg('Diese Funktion ist nur in der nativen APK verfügbar.');
      return;
    }
    await startNativeScan(handleResult, handleError);
  }, [native, handleResult, handleError]);

  const stopScan = useCallback(async () => {
    await stopNativeScan();
    setScanStatus('idle');
  }, []);

  const currentVerify = lastScan ? classify(lastScan) : null;

  return (
    <div className="w-full max-w-md mx-auto space-y-5">

      {/* Mode badge */}
      <div className="flex justify-center">
        {native ? (
          <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30 text-xs">
            <Zap className="w-3 h-3 mr-1" />
            Native IsoDep · GetTTStatus 0xF7
          </Badge>
        ) : (
          <Badge className="bg-slate-700/60 text-slate-400 border-slate-600 text-xs">
            <WifiOff className="w-3 h-3 mr-1" />
            Nur in nativer APK verfügbar
          </Badge>
        )}
      </div>

      {/* Scan button */}
      <div className="flex justify-center py-2">
        <ScanButton status={scanStatus} hasResult={lastScan !== null} onScan={startScan} onStop={stopScan} />
      </div>

      {/* Hints */}
      {scanStatus === 'idle' && !lastScan && (
        <p className="text-center text-slate-500 text-sm">NTAG 424 TT Tag an die Rückseite halten</p>
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

      {/* ── RESULT ── */}
      {lastScan && currentVerify && (
        <div className="space-y-3">

          {/* Big verify badge */}
          <Card className={cn('border overflow-hidden',
            currentVerify.kind === 'verified' && 'border-emerald-500/30 bg-emerald-500/5',
            currentVerify.kind === 'warn'     && 'border-orange-500/30 bg-orange-500/5',
            currentVerify.kind === 'unknown'  && 'border-red-500/20 bg-red-500/5',
          )}>
            <CardContent className="p-0">
              <VerifyBadge verify={currentVerify} scan={lastScan} />
            </CardContent>
          </Card>

          {/* UID row */}
          <UIDRow uid={lastScan.uid} />

          {/* Tamper detail grid */}
          {(currentVerify.kind === 'warn' || currentVerify.kind === 'unknown') && (
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5">
                <div className="text-slate-500 text-xs mb-0.5">Tamper-Status</div>
                <div className="font-mono text-white text-sm font-bold">{lastScan.tamperStatus}</div>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5">
                <div className="text-slate-500 text-xs mb-0.5">Zeitstempel</div>
                <div className="text-white text-sm font-mono">
                  {new Date(lastScan.timestamp).toLocaleTimeString('de-DE')}
                </div>
              </div>
            </div>
          )}

          {/* ── ONLINE ACTION BUTTONS ── */}
          <div className="pt-1">
            <p className="text-slate-500 text-xs text-center mb-3">
              Ergebnis online eintragen, Aufladen anfordern oder Entwerten:
            </p>
            <OnlineActions scan={lastScan} verify={currentVerify} />
          </div>

          {/* Raw data panel */}
          {currentVerify.kind !== 'verified' && (
            <RawDataPanel scan={lastScan} verify={currentVerify} />
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
            <p className="text-slate-500 text-xs">
              Lade die APK von GitHub Actions herunter und installiere sie auf deinem Android-Gerät.
            </p>
          </CardContent>
        </Card>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-slate-500 text-xs font-medium uppercase tracking-wider">Verlauf ({history.length})</h3>
            <button
              onClick={() => { setHistory([]); setLastScan(null); setScanStatus('idle'); }}
              className="text-slate-600 hover:text-slate-400 text-xs flex items-center gap-1 transition-colors">
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
