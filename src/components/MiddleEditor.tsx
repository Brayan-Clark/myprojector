import { useState, useEffect } from 'react';
import { FileText, Plus, Save, Edit3, Eye } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
export function MiddleEditor({ activeSong, onSave }: { activeSong: any, onSave: (s:any) => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const [localTitle, setLocalTitle] = useState("");
  const [localContent, setLocalContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);

  useEffect(() => {
    if (activeSong) {
      setLocalTitle(activeSong.title || "");
      setLocalContent(activeSong.lyrics || "");
      setIsEditing(false);
      setTextContent(null);
      
      const fileUrl = activeSong.lyrics || "";

      // Load PDF as blob
      if (activeSong.type === 'document' && fileUrl.toLowerCase().endsWith('.pdf')) {
        const urlToFetch = cleanUrl(fileUrl);
        if (urlToFetch) {
          fetch(urlToFetch)
            .then(r => r.blob())
            .then(blob => setPdfBlobUrl(URL.createObjectURL(blob)))
            .catch(e => { console.error("PDF Preview Load Error:", e); setPdfBlobUrl(null); });
        }
      } else {
        setPdfBlobUrl(null);
      }

      // Load .txt content via Rust
      if (activeSong.type === 'document' && fileUrl.toLowerCase().endsWith('.txt')) {
        const appDataPath = localStorage.getItem('appDataPath');
        let fullPath = fileUrl;
        if (appDataPath && (fileUrl.startsWith('media/') || fileUrl.startsWith('/media/'))) {
           const stripped = fileUrl.startsWith('/') ? fileUrl.slice(1) : fileUrl;
           fullPath = `${appDataPath}/${stripped}`;
        }
        invoke("read_text_file", { path: fullPath })
          .then((content: any) => setTextContent(content))
          .catch(e => setTextContent("Impossible de lire le fichier: " + e));
      }
    }
    return () => { if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl); };
  }, [activeSong?.id, activeSong?.lyrics]);

  const handleSave = async () => {
    if (!activeSong) return;
    setIsSaving(true);
    try {
      // Assuming db_name mapped back to original db, or activeSong.book
      // But book is pure book name for bible.
      // Hymnes are from adventools_data... 
      // For hymnes, activeSong.book contains the dbName without .db. So book + ".db".
      if (!activeSong.type || !['custom', 'image', 'video', 'document'].includes(activeSong.type)) {
        const isBible = activeSong.number === "Chap" || isNaN(Number(activeSong.number));
        const dbName = isBible ? `${activeSong.book}.SQLite3` : `${activeSong.book}.db`;
        
        await invoke("update_song", {
          dbName,
          isBible,
          id: typeof activeSong.id === 'string' ? parseInt(activeSong.id) : activeSong.id,
          title: localTitle,
          content: localContent
        });
      }
      
      onSave({ ...activeSong, title: localTitle, lyrics: localContent });
      setIsEditing(false);
    } catch (e) {
      alert("Erreur lors de la sauvegarde: " + e);
    } finally {
      setIsSaving(false);
    }
  };
  if (!activeSong) {
    return (
      <div className="flex-1 bg-[#36393f] flex items-center justify-center text-gray-500">
         Sélectionnez un chant pour l'éditer.
      </div>
    );
  }

  const cleanUrl = (url: string) => {
    if (!url || url === '' || url === 'null') return undefined;
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('asset:') || url.startsWith('http') || url.startsWith('tauri:')) {
      return url;
    }
    
    const appDataPath = localStorage.getItem('appDataPath');
    let relativePath = url;
    
    // Si c'est un chemin absolu qui contient appDataPath, on extrait la fin
    if (appDataPath && url.startsWith(appDataPath)) {
      relativePath = url.replace(appDataPath, '');
    }
    
    const stripped = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
    return `http://127.0.0.1:11223/fs/${encodeURIComponent(stripped).replace(/%2F/g, '/')}`;
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[#36393f]">
      {/* En-tête Editeur */}
      <div className="h-10 bg-[#2f3136] flex items-center px-4 border-b border-[#202225] gap-4">
        <div className="flex items-center gap-2 text-[#5865f2] font-semibold text-sm">
           <FileText size={16} /> Paroles
        </div>
        <div className="flex bg-[#202225] rounded p-0.5">
           <button 
             className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition ${!isEditing ? 'bg-[#36393f] text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
             onClick={() => setIsEditing(false)}
           >
              <Eye size={12} /> Vue
           </button>
           <button 
             className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition ${isEditing ? 'bg-[#36393f] text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
             onClick={() => setIsEditing(true)}
           >
              <Edit3 size={12} /> Éditer
           </button>
        </div>
        <div className="ml-auto flex gap-2">
           <button className="text-gray-400 hover:text-white transition" title="Ajouter un chant"><Plus size={16} /></button>
           {isEditing && (
              <button 
                 className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-bold text-white transition ${isSaving ? 'bg-gray-500' : 'bg-green-600 hover:bg-green-500'}`}
                 title="Sauvegarder les modifications"
                 onClick={handleSave}
                 disabled={isSaving}
              >
                 <Save size={14} /> {isSaving ? "Doc..." : "Sauver"}
              </button>
           )}
        </div>
      </div>

      {/* Meta data du chant */}
      <div className="p-4 flex gap-4 bg-[#2b2d31] border-b border-[#202225] flex-shrink-0">
         <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400 font-bold">Numéro:</label>
            <input type="text" value={activeSong?.number} readOnly className="w-16 bg-[#1e1f22] text-gray-400 text-xs py-1 px-2 rounded outline-none cursor-default" />
         </div>
         <div className="flex items-center gap-2 flex-1">
            <label className="text-xs text-gray-400 font-bold">Titre:</label>
            <input 
               type="text" 
               value={localTitle} 
               onChange={(e) => setLocalTitle(e.target.value)}
               readOnly={!isEditing}
               className={`w-full text-sm py-1 px-2 rounded outline-none font-semibold transition ${isEditing ? 'bg-[#18191c] text-white ring-1 ring-[#5865f2]' : 'bg-[#1e1f22] text-gray-200'}`} 
            />
         </div>
      </div>

      {/* Editeur Texte */}
      <div className="flex-1 p-4 overflow-y-auto relative">
         {(activeSong?.type === 'image' || activeSong?.type === 'video' || activeSong?.type === 'audio' || activeSong?.type === 'document') ? (
            <div className={`w-full h-full flex flex-col rounded border border-[#202225] overflow-hidden relative ${activeSong?.type === 'document' ? '' : 'items-center justify-center gap-4 p-4 bg-black/20'}`}>
             <div className="absolute top-2 right-2 bg-black/80 text-white px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider z-10">
               {activeSong.type}
             </div>
             {activeSong.type === 'image' && <img src={cleanUrl(localContent)} className="max-w-full max-h-full object-contain" alt="Aperçu image" />}
             {activeSong.type === 'video' && <video src={cleanUrl(localContent)} className="max-w-full max-h-full object-contain" controls playsInline preload="auto" />}
             {activeSong.type === 'audio' && (
               <div className="flex flex-col items-center gap-4 w-full">
                 <div className="w-20 h-20 bg-[#5865f2] rounded-full flex items-center justify-center shadow-lg shadow-[#5865f2]/30">
                   <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                   </svg>
                 </div>
                 <p className="text-xs text-gray-400 truncate max-w-full text-center">{activeSong.title}</p>
                 <audio key={localContent} src={cleanUrl(localContent)} controls className="w-full max-w-sm" />
                 <p className="text-[10px] text-gray-600 italic text-center">Lecture locale uniquement — non projeté sur l'écran de présentation</p>
               </div>
             )}
              {activeSong.type === 'document' && (
                pdfBlobUrl ? (
                  <iframe 
                    src={`${pdfBlobUrl}#view=FitH`} 
                    width="100%"
                    height="100%"
                    className="absolute inset-0 border-none bg-white"
                    style={{ width: '100%', height: '100%' }}
                    title="Aperçu PDF"
                  />
                ) : textContent ? (
                  <div className="w-full h-full bg-[#18191c] p-4 text-gray-200 overflow-y-auto font-mono text-sm whitespace-pre-wrap">
                    {textContent}
                  </div>
                ) : (
                  <iframe 
                    src={`${cleanUrl(localContent)}#view=FitH`} 
                    width="100%"
                    height="100%"
                    className="w-full h-full border-none bg-white" 
                    style={{ width: '100%', height: '100%' }}
                    title="Aperçu document" 
                  />
                )
              )}
           </div>
         ) : isEditing ? (
           <textarea 
              className="w-full h-full bg-[#18191c] p-3 rounded text-gray-200 resize-none outline-none leading-relaxed text-sm font-medium ring-1 ring-[#5865f2]"
              value={localContent}
              onChange={(e) => setLocalContent(e.target.value)}
           />
         ) : (
           <div className="w-full h-full text-gray-200 whitespace-pre-line leading-relaxed text-sm font-medium">
             {localContent}
           </div>
         )}
      </div>

      {/* Footer Meta */}
      <div className="p-2 border-t border-[#202225] bg-[#2f3136] flex gap-4 text-xs">
         <div className="flex items-center gap-2">
            <label className="text-gray-500">Référence:</label>
            <input type="text" className="bg-[#1e1f22] text-gray-300 px-1 rounded" />
         </div>
         <div className="flex items-center gap-2">
            <label className="text-gray-500">Auteur:</label>
            <input type="text" className="bg-[#1e1f22] text-gray-300 px-1 rounded" />
         </div>
      </div>
    </div>
  );
}
