import { useState, useEffect } from 'react';
import { Download, Check, RefreshCw } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

export function Store({ onInstalled }: { onInstalled: () => void }) {
  const [manifests, setManifests] = useState<any[]>([]);
  const [installedHymnes, setInstalledHymnes] = useState<string[]>([]);
  const [installedBibles, setInstalledBibles] = useState<string[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);

  const loadStore = async () => {
    try {
      // 1. Fetch remote manifests directly from github
      const hymnsRes = await fetch("https://raw.githubusercontent.com/Brayan-Clark/adventools/data/hymnes/manifest.json");
      const bibleRes = await fetch("https://raw.githubusercontent.com/Brayan-Clark/adventools/data/bible/manifest.json");
      const hData = await hymnsRes.json();
      const bData = await bibleRes.json();
      
      const all = [
        ...hData.versions.map((v:any) => ({ ...v, category: "hymnes" })),
        ...bData.versions.map((v:any) => ({ ...v, category: "bible" }))
      ];
      setManifests(all);

      // 2. Fetch locally installed DBs
      const instH = await invoke<string[]>("list_dbs", { category: "hymnes" });
      const instB = await invoke<string[]>("list_dbs", { category: "bible" });
      setInstalledHymnes(instH);
      setInstalledBibles(instB);

    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadStore();
  }, []);

  const handleDownload = async (item: any) => {
    setDownloading(item.id);
    try {
      await invoke("download_db", { 
        url: item.url, 
        category: item.category, 
        filename: item.file 
      });
      await loadStore(); // refresh status
      onInstalled();
    } catch (e) {
      alert("Erreur: " + e);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#2b2d31] p-4 text-gray-200">
      <h2 className="font-bold text-lg mb-4 text-[#5865f2]">Bibliothèque de Modules</h2>
      <div className="space-y-4">
        {manifests.map((m) => {
          const isInstalled = m.category === "hymnes" ? installedHymnes.includes(m.file) : installedBibles.includes(m.file);
          const isDownloading = downloading === m.id;

          return (
            <div key={m.id} className="bg-[#1e1f22] p-3 rounded flex items-center justify-between border border-[#36393f] shadow">
               <div>
                  <h3 className="font-semibold text-sm text-gray-100">{m.name} <span className="text-[10px] bg-gray-600 px-1 rounded ml-1 uppercase">{m.language}</span></h3>
                  <p className="text-xs text-gray-400 mt-1">{m.category === "hymnes" ? "Cantiques" : "Bible"} • {m.size}</p>
               </div>
               <div>
                  {isInstalled ? (
                    <button className="flex items-center gap-1.5 px-3 py-1 bg-green-500/10 text-green-500 border border-green-500/20 rounded text-xs font-semibold cursor-default">
                       <Check size={14} /> Installé
                    </button>
                  ) : (
                    <button 
                      className="flex items-center gap-1.5 px-3 py-1 bg-[#5865f2] hover:bg-[#4752c4] text-white rounded text-xs font-semibold shadow transition"
                      onClick={() => handleDownload(m)}
                      disabled={isDownloading}
                    >
                       {isDownloading ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />} 
                       {isDownloading ? "Téléchargement..." : "Télécharger"}
                    </button>
                  )}
               </div>
            </div>
          )
        })}
      </div>
    </div>
  );
}
