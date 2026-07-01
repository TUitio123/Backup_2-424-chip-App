import { useState, useEffect, useCallback } from 'react';
import {
  Wifi, WifiOff, CheckCircle, XCircle, AlertTriangle,
  RefreshCw, Copy, ChevronDown, ChevronUp, Zap,
  Send, ShieldAlert, HelpCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ScanResult, ScanStatus, TamperStatus,
  isNativeAvailable, startNativeScan, stopNativeScan,
} from '@/lib/ntag424';
import { lookupChip, ChipEntry } from '@/lib/chipRegistry';
import { useToast } from '@/hooks/useToast';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

// ─── Verification result type ─────────────────────────────────────────────────

type VerifyResult =
  | { kind: 'verified';       chip: ChipEntry }
  | { kind: 'tampered_known'; chip: ChipEntry }
  | { kind: 'unknown' };

function classify(
  scan: ScanResult,
): VerifyResult {
  const chip = lookupChip(scan.uid);
  if (!chip) return { kind: 'unknown' };
  const tamperOk = scan.tamperStatus === 'CC' || scan.tamperStatus === 'II';
  return tamperOk
    ? { kind: 'verified', chip }
    : { kind: 'tampered_known', chip };
}

// ─── Tamper pill – immer klein angezeigt ──────────────────────────────────────

function TamperPill({ tamperStatus, verifyKind }: {
  tamperStatus: TamperStatus;
  verifyKind: VerifyResult['kind'];
}) {
  const isOk      = tamperStatus === 'CC' || tamperStatus === 'II';
  const isBroken  = !isOk;

  const color =
    verifyKind === 'verified'       ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25' :
    verifyKind === 'tampered_known' ? 'bg-amber-500/15 text-amber-300 border-amber-500/25'       :
                                      'bg-slate-700/60 text-slate-400 border-slate-600';

  return (
    <div className={cn(
      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-mono',
      color,
    )}>
      <span className={cn(
        'w-1.5 h-1.5 rounded-full flex-shrink-0',
        isOk ? 'bg-emerald-400' : 'bg-amber-400',
      )} />
      <span>Tamper: <span className="font-bold">{tamperStatus}</span></span>
      {isBroken && <AlertTriangle className="w-3 h-3 opacity-80" />}
    </div>
  );
}

// ─── Big verification badge ───────────────────────────────────────────────────

function VerifyBadge({ verify, scan }: {
  verify: VerifyResult;
  scan: ScanResult;
}) {
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
          {verify.chip.info && (
            <div className="text-slate-400 text-sm mt-1">{verify.chip.info}</div>
          )}
          {verify.chip.issuedAt && (
            <div className="text-slate-600 text-xs mt-0.5">Ausgegeben: {verify.chip.issuedAt}</div>
          )}
        </div>
        {/* Tamper pill – immer anzeigen, auch bei verified */}
        <TamperPill tamperStatus={scan.tamperStatus} verifyKind="verified" />
      </div>
    );
  }

  if (verify.kind === 'tampered_known') {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <div className="w-28 h-28 rounded-full bg-amber-500/15 border-4 border-amber-500/50 flex items-center justify-center shadow-[0_0_40px_rgba(245,158,11,0.2)]">
          <XCircle className="w-16 h-16 text-amber-400" />
        </div>
        <div className="text-center">
          <div className="text-amber-400 font-bold text-sm uppercase tracking-widest mb-1">Chip bekannt</div>
          <div className="text-white font-extrabold text-4xl tracking-tight">{verify.chip.label}</div>
          {verify.chip.info && (
            <div className="text-slate-400 text-sm mt-1">{verify.chip.info}</div>
          )}
        </div>
        {/* Tamper pill */}
        <TamperPill tamperStatus={scan.tamperStatus} verifyKind="tampered_known" />
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-center max-w-xs">
          <AlertTriangle className="w-5 h-5 text-amber-400 mx-auto mb-1" />
          <p className="text-amber-300 font-semibold text-sm">Chip kann schon entwertet sein</p>
          <p className="text-amber-400/70 text-xs mt-0.5">
            Tamper-Draht beschädigt ({scan.tamperStatus}). Chip wurde möglicherweise bereits verwendet.
          </p>
        </div>
      </div>
    );
  }

  // unknown
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
      {/* Tamper pill auch bei unknown */}
      <TamperPill tamperStatus={scan.tamperStatus} verifyKind="unknown" />
    </div>
  );
}

// ─── Raw data panel ───────────────────────────────────────────────────────────

function RawDataPanel({ scan, verify, onSend }: {
  scan: ScanResult;
  verify: VerifyResult;
  onSend: (payload: string) => void;
}) {
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
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
      >
        <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">
          Rohdaten
        </span>
        {open
          ? <ChevronUp className="w-4 h-4 text-slate-500" />
          : <ChevronDown className="w-4 h-4 text-slate-500" />}
      </button>

      {open && (
        <div className="border-t border-white/10 p-3 space-y-3">
          <pre className="text-xs text-slate-300 font-mono bg-black/30 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
            {payload}
          </pre>
          <Button
            variant="outline"
            size="sm"
            className="w-full border-blue-500/40 text-blue-300 hover:bg-blue-500/10 hover:border-blue-400"
            onClick={() => onSend(payload)}
          >
            <Send className="w-3.5 h-3.5 mr-2" />
            Rohdaten an Server senden
          </Button>
          <p className="text-slate-600 text-xs text-center">
            Server-URL wird später konfiguriert
          </p>
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
        onClick={() =>
          navigator.clipboard.writeText(uid)
            .then(() => toast({ title: 'UID kopiert' }))
            .catch(() => {})}
        className="text-slate-500 hover:text-slate-300 transition-colors p-2"
      >
        <Copy className="w-4 h-4" />
      </button>
    </div>
  );
}

// ─── Scan button ──────────────────────────────────────────────────────────────

function ScanButton({ status, onScan, onStop }: {
  status: ScanStatus;
  onScan: () => void;
  onStop: () => void;
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
        status === 'success'     && 'bg-emerald-600/20 border-emerald-500/50 hover:bg-emerald-600/30 cursor-pointer',
        status === 'error'       && 'bg-red-600/20 border-red-500/50 hover:bg-red-600/30 cursor-pointer',
        status === 'unsupported' && 'bg-slate-800/50 border-slate-700 cursor-not-allowed opacity-50',
      )}
    >
      {scanning && (
        <>
          <span className="absolute inset-0 rounded-full border-4 border-blue-400 animate-ping opacity-25" />
          <span className="absolute -inset-3 rounded-full border-2 border-blue-400/20 animate-ping opacity-15" style={{ animationDelay: '0.4s' }} />
        </>
      )}
      <div className="relative z-10">
        {status === 'success'     && <CheckCircle className="w-12 h-12 text-emerald-400" />}
        {status === 'error'       && <XCircle     className="w-12 h-12 text-red-400" />}
        {status === 'unsupported' && <WifiOff     className="w-12 h-12 text-slate-500" />}
        {(status === 'idle' || scanning) && (
          <Wifi className={cn('w-12 h-12', scanning ? 'text-blue-300' : 'text-blue-400')} />
        )}
      </div>
      <span className={cn('relative z-10 text-xs font-bold tracking-widest uppercase',
        status === 'idle'        && 'text-blue-300',
        scanning                 && 'text-blue-200',
        status === 'success'     && 'text-emerald-300',
        status === 'error'       && 'text-red-300',
        status === 'unsupported' && 'text-slate-500',
      )}>
        {status === 'idle'        && 'Scannen'}
        {scanning                 && 'Warte…'}
        {status === 'success'     && 'Erneut'}
        {status === 'error'       && 'Retry'}
        {status === 'unsupported' && 'N/A'}
      </span>
    </button>
  );
}

// ─── History item ─────────────────────────────────────────────────────────────

function HistoryItem({ scan, verify }: {
  scan: ScanResult;
  verify: VerifyResult;
}) {
  const [open, setOpen] = useState(false);
  const dot =
    verify.kind === 'verified'       ? 'bg-emerald-400' :
    verify.kind === 'tampered_known' ? 'bg-amber-400'   : 'bg-red-400';
  const label =
    verify.kind !== 'unknown' ? verify.chip.label : 'Unbekannt';

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 p-3 hover:bg-white/5 transition-colors text-left"
      >
        <div className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', dot)} />
        <div className="flex-1 min-w-0">
          <div className="text-white text-sm font-medium truncate">{label}</div>
          <div className="text-slate-500 text-xs font-mono truncate">{scan.uid}</div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Tamper immer klein im Verlauf */}
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
          {scan.debug && (
            <div className="text-slate-600 text-xs font-mono break-all">{scan.debug}</div>
          )}
        </div>
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
    setScanStatus('success');
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

  const handleSend = (payload: string) => {
    toast({
      title: 'Server-URL noch nicht konfiguriert',
      description: 'Die Ziel-URL wird später eingerichtet.',
    });
    console.log('[NFCScanner] send payload:', payload);
  };

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
        <ScanButton status={scanStatus} onScan={startScan} onStop={stopScan} />
      </div>

      {/* Hint */}
      {scanStatus === 'idle' && !lastScan && (
        <p className="text-center text-slate-500 text-sm">
          NTAG 424 TT Tag an die Rückseite halten
        </p>
      )}
      {scanStatus === 'scanning' && (
        <p className="text-center text-blue-300 text-sm animate-pulse">
          Halte den Tag an dein Gerät…
        </p>
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
            currentVerify.kind === 'verified'       && 'border-emerald-500/30 bg-emerald-500/5',
            currentVerify.kind === 'tampered_known' && 'border-amber-500/30 bg-amber-500/5',
            currentVerify.kind === 'unknown'        && 'border-red-500/20 bg-red-500/5',
          )}>
            <CardContent className="p-0">
              <VerifyBadge verify={currentVerify} scan={lastScan} />
            </CardContent>
          </Card>

          {/* UID row */}
          <UIDRow uid={lastScan.uid} />

          {/* Tamper detail – nur bei tampered/unknown als extra Grid */}
          {(currentVerify.kind === 'tampered_known' || currentVerify.kind === 'unknown') && (
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

          {/* Raw data panel */}
          {currentVerify.kind !== 'verified' && (
            <RawDataPanel scan={lastScan} verify={currentVerify} onSend={handleSend} />
          )}

          <p className="text-center text-slate-600 text-xs">
            Neuen Tag scannen → Scan-Button drücken
          </p>
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
            <h3 className="text-slate-500 text-xs font-medium uppercase tracking-wider">
              Verlauf ({history.length})
            </h3>
            <button
              onClick={() => { setHistory([]); setLastScan(null); setScanStatus('idle'); }}
              className="text-slate-600 hover:text-slate-400 text-xs flex items-center gap-1 transition-colors"
            >
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
