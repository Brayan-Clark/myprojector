import { useState, useEffect } from 'react';
import { FileText, Plus, Save, Edit3, Eye } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

export function MiddleEditor({ activeSong, onSave }: { activeSong: any, onSave: (s:any) => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const [localTitle, setLocalTitle] = useState("");
  const [localContent, setLocalContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (activeSong) {
      setLocalTitle(activeSong.title || "");
      setLocalContent(activeSong.lyrics || "");
      // By default when switching songs, we go to View mode so it isn't confusing
      setIsEditing(false);
    }
  }, [activeSong]);

  const handleSave = async () => {
    if (!activeSong) return;
    setIsSaving(true);
    try {
      // Assuming db_name mapped back to original db, or activeSong.book
      // But book is pure book name for bible.
      // Hymnes are from adventools_data... 
      // For hymnes, activeSong.book contains the dbName without .db. So book + ".db".
      const isBible = activeSong.number === "Chap" || isNaN(Number(activeSong.number));
      const dbName = isBible ? `${activeSong.book}.SQLite3` : `${activeSong.book}.db`;
      
      await invoke("update_song", {
        dbName,
        isBible,
        id: activeSong.id,
        title: localTitle,
        content: localContent
      });
      
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
      <div className="flex-1 p-4 overflow-y-auto">
         {isEditing ? (
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
