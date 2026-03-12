import { useState, useEffect } from 'react';
import { Download, RefreshCw, Trash2, ChevronRight, ChevronDown } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

export function Store({ onInstalled, onLoadDb }: { onInstalled: () => void, onLoadDb: any }) {
  const [manifests, setManifests] = useState<any[]>([]);
  const [installedHymnes, setInstalledHymnes] = useState<string[]>([]);
  const [installedBibles, setInstalledBibles] = useState<string[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [expandedCats, setExpandedCats] = useState<string[]>(['hymnes', 'bible']);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStore = async () => {
    setLoading(true);
    setError(null);
    try {
      console.log("Fetching manifests...");
      const hymnsRes = await fetch("https://raw.githubusercontent.com/Brayan-Clark/adventools/data/hymnes/manifest.json").catch(e => { throw new Error("Erreur réseau: " + e.message); });
      const bibleRes = await fetch("https://raw.githubusercontent.com/Brayan-Clark/adventools/data/bible/manifest.json").catch(e => { throw new Error("Erreur réseau: " + e.message); });
      
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
      onInstalled();
    } catch (e) { alert("Erreur: " + e); } finally { setDownloading(null); }
  };

  const handleDelete = async (e: React.MouseEvent, m: any) => {
     e.stopPropagation();
     e.preventDefault();
     const confirmed = window.confirm(`Voulez-vous vraiment supprimer le module "${m.name}" ?`);
     if (!confirmed) return;
     
     try {
        await invoke("delete_db", { category: m.category, filename: m.file });
        await loadStore();
        onLoadDb(m.category, ""); // Trigger reload in sidebar
     } catch (e) { alert("Erreur: " + e); }
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
                              className="p-1.5 hover:bg-red-500/20 text-gray-500 hover:text-red-400 rounded transition opacity-0 group-hover:opacity-100" 
                              onClick={(e) => handleDelete(e, m)}
                              title="Supprimer"
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
                           {isDownloading ? "..." : "Installer"}
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
    <div className="flex-1 overflow-y-auto bg-[#2b2d31] p-4 text-gray-200">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-black text-xl text-[#5865f2] tracking-tighter">BIBLIOTHÈQUE</h2>
        <button onClick={() => onInstalled()} className="text-[10px] font-bold text-gray-400 hover:text-white uppercase">Fermer</button>
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
