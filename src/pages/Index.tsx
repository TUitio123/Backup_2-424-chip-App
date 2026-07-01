import { useSeoMeta } from '@unhead/react';
import { NFCScanner } from '@/components/NFCScanner';
import { Shield, Wifi } from 'lucide-react';

const Index = () => {
  useSeoMeta({
    title: 'NTAG 424 TT Scanner – NFC Tamper Detector',
    description: 'Scan NXP NTAG 424 DNA TagTamper chips and read tamper status and UID directly from the chip.',
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex flex-col">
      {/* Header */}
      <header className="px-4 py-5 flex items-center justify-between border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
            <Wifi className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-white font-bold text-lg leading-tight">NTAG 424 TT</h1>
            <p className="text-slate-400 text-xs">Tamper Scanner</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <Shield className="w-3.5 h-3.5" />
          <span>NXP Secure</span>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center justify-start px-4 py-6 gap-6">
        <NFCScanner />
      </main>

      {/* Footer */}
      <footer className="text-center py-4 text-slate-600 text-xs">
        <a href="https://shakespeare.diy" target="_blank" rel="noopener noreferrer" className="hover:text-slate-400 transition-colors">
          Vibed with Shakespeare
        </a>
      </footer>
    </div>
  );
};

export default Index;
