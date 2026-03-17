import { useState, useEffect } from 'react';
import { Download, RefreshCw, Trash2, ChevronRight, ChevronDown, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

export function Store({ onInstalled, onLoadDb }: { onInstalled: () => void, onLoadDb: any }) {
  const [manifests, setManifests] = useState<any[]>([]);
  const [installedHymnes, setInstalledHymnes] = useState<string[]>([]);
  const [installedBibles, setInstalledBibles] = useState<string[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [expandedCats, setExpandedCats] = useState<string[]>(['hymnes', 'bible']);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);

  const loadStore = async () => {
    setLoading(true);
    setError(null);
    try {
      console.log("Fetching manifests with cache buster...");
      const timestamp = Date.now();
      const hymnsRes = await fetch(`https://raw.githubusercontent.com/Brayan-Clark/adventools/data/hymnes/manifest.json?c=${timestamp}`).catch(e => { throw new Error("Erreur réseau: " + e.message); });
      const bibleRes = await fetch(`https://raw.githubusercontent.com/Brayan-Clark/adventools/data/bible/manifest.json?c=${timestamp}`).catch(e => { throw new Error("Erreur réseau: " + e.message); });
      
      if (!hymnsRes.ok || !bibleRes.ok) {
        throw new Error(`Erreur HTTP: ${hymnsRes.status} / ${bibleRes.status}`);
      }

      const hData = await hymnsRes.json();
      const bData = await bibleRes.json();
      
      const all = [
        ...hData.versions.map((v:any) => ({ ...v, category: "hymnes" })),
        ...bData.versions.map((v:any) => ({ ...v, category: "bible" }))
      ];
      setManifests(all);

      const instH = await invoke<string[]>("list_dbs", { category: "hymnes" });
      const instB = await invoke<string[]>("list_dbs", { category: "bible" });
      setInstalledHymnes(instH);
      setInstalledBibles(instB);
    } catch (e: any) { 
      console.error("Store load error:", e); 
      setError(e.message || "Erreur de chargement inconnue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStore(); }, []);

  const handleDownload = async (item: any) => {
    setDownloading(item.id);
    try {
      await invoke("download_db", { url: item.url, category: item.category, filename: item.file });
      await loadStore();
      
      // CRITICAL: Immediately force the app to reload the data for this DB
      // to reflect the changes downloaded from GitHub
      await onLoadDb(item.category, item.file);
      
      // Show success feedback
      alert(`Mise à jour réussie : ${item.name}`);
      
      // Optionnel: close store after update? Not necessarily, user might want to update others
    } catch (e) { alert("Erreur: " + e); } finally { setDownloading(null); }
  };

  const handleDelete = async (e: any, m: any) => {
     e.stopPropagation();
     if (e.nativeEvent) e.nativeEvent.stopImmediatePropagation();
     e.preventDefault();
     
     setConfirmDialog({
       message: `Voulez-vous vraiment supprimer définitivement le module "${m.name}" du disque ?`,
       onConfirm: async () => {
         setConfirmDialog(null);
         try {
            await invoke("delete_db", { category: m.category, filename: m.file });
            await loadStore();
            onLoadDb(m.category, ""); // Trigger reload in sidebar
         } catch (e) { alert("Erreur: " + e); }
       }
     });
  };

  const toggleCat = (cat: string) => {
     setExpandedCats(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);
  };

  const renderCategory = (cat: string, label: string) => {
     const items = manifests.filter(m => m.category === cat);
     const isExpanded = expandedCats.includes(cat);

     return (
        <div key={cat} className="space-y-2">
           <button 
              className="w-full flex items-center justify-between text-xs font-bold text-gray-400 uppercase tracking-widest hover:text-white transition py-2 px-1 border-b border-[#36393f] mb-2"
              onClick={() => toggleCat(cat)}
           >
              <span>{label} ({items.length})</span>
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
           </button>
           
           {isExpanded && items.map((m) => {
              const isInstalled = m.category === "hymnes" ? installedHymnes.includes(m.file) : installedBibles.includes(m.file);
              const isDownloading = downloading === m.id;

              return (
                <div key={m.id} className="bg-[#1e1f22] p-3 rounded flex items-center justify-between border border-[#36393f] hover:border-[#4f545c] transition group">
                   <div>
                      <h3 className="font-semibold text-sm text-gray-100">{m.name} <span className="text-[10px] bg-gray-600 px-1 rounded ml-1 uppercase">{m.language}</span></h3>
                      <p className="text-xs text-gray-400 mt-1">{m.size}</p>
                   </div>
                   <div className="flex items-center gap-2">
                      {isInstalled ? (
                        <>
                           <span className="text-[10px] font-bold text-green-500 bg-green-500/10 px-2 py-0.5 rounded border border-green-500/20">INSTALLÉ</span>
                           <button 
                              className="p-1.5 hover:bg-[#5865f2]/20 text-gray-500 hover:text-[#5865f2] rounded transition opacity-0 group-hover:opacity-100" 
                              onClick={() => handleDownload(m)}
                              disabled={isDownloading}
                              title="Mettre à jour depuis GitHub"
                           >
                              <RefreshCw size={14} className={isDownloading ? "animate-spin" : ""} />
                           </button>
                           <button 
                              className="p-1.5 hover:bg-red-500/20 text-gray-500 hover:text-red-400 rounded transition opacity-0 group-hover:opacity-100" 
                              onClick={(e) => handleDelete(e, m)}
                              title="Supprimer du disque"
                           >
                              <Trash2 size={14} />
                           </button>
                        </>
                      ) : (
                        <button 
                          className="flex items-center gap-1.5 px-3 py-1 bg-[#5865f2] hover:bg-[#4752c4] text-white rounded text-xs font-semibold transition"
                          onClick={() => handleDownload(m)}
                          disabled={isDownloading}
                        >
                           {isDownloading ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />} 
                           {isDownloading ? "Téléchargement..." : "Installer"}
                        </button>
                      )}
                   </div>
                </div>
              )
           })}
        </div>
     );
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#2b2d31] p-4 text-gray-200 relative">
      {confirmDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#1e1f22] border border-[#36393f] rounded-lg shadow-2xl p-6 max-w-sm w-full animate-in fade-in zoom-in duration-200">
            <div className="flex items-start gap-3 mb-5">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
                <Trash2 size={20} className="text-red-400" />
              </div>
              <div>
                <p className="text-white font-bold text-sm mb-1">Confirmer la suppression</p>
                <p className="text-gray-400 text-xs leading-relaxed">{confirmDialog.message}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                className="px-4 py-2 text-xs font-bold text-gray-300 hover:text-white bg-[#36393f] hover:bg-[#4f545c] rounded transition"
                onClick={() => setConfirmDialog(null)}
              >
                Annuler
              </button>
              <button
                className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded transition shadow-lg shadow-red-900/20"
                onClick={confirmDialog.onConfirm}
              >
                Désinstaller
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-8 pb-2 border-b border-[#36393f]">
        <h2 className="font-black text-xl text-[#5865f2] tracking-tighter">BIBLIOTHÈQUE</h2>
        <div className="flex items-center gap-2">
          <button 
            onClick={loadStore} 
            className="p-2 hover:bg-[#36393f] text-gray-400 hover:text-white rounded-full transition"
            title="Rafraîchir la liste"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          <button 
            onClick={() => onInstalled()} 
            className="p-2 hover:bg-[#36393f] text-gray-400 hover:text-red-400 rounded-full transition"
            title="Fermer"
          >
            <X size={18} />
          </button>
        </div>
      </div>
      
      <div className="space-y-8">
         {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4 opacity-50">
               <RefreshCw size={32} className="animate-spin text-[#5865f2]" />
               <p className="text-sm font-bold tracking-widest uppercase">Chargement de la bibliothèque...</p>
            </div>
         ) : error ? (
            <div className="bg-red-500/10 border border-red-500/20 p-6 rounded-lg text-center space-y-4">
               <p className="text-red-400 font-bold">{error}</p>
               <button onClick={loadStore} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-md text-xs font-bold transition">Réessayer</button>
               <p className="text-[10px] text-gray-500">Vérifiez votre connexion internet et les paramètres de sécurité.</p>
            </div>
         ) : manifests.length === 0 ? (
            <div className="text-center py-20 text-gray-500">
               <p>Aucun module disponible pour le moment.</p>
            </div>
         ) : (
            <>
               {renderCategory("hymnes", "Recueils (Chants)")}
               {renderCategory("bible", "Bibles")}
            </>
         )}
      </div>
    </div>
  );
}
