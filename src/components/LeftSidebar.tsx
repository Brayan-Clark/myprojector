import { useState, useEffect, useRef } from 'react';
import { Save, FolderOpen, X, BookOpen, Music, Search as SearchIcon, List, Download, Plus, Trash2, ChevronUp, ChevronDown, FileText, Image as ImageIcon, Video, Type, Settings, Heart } from 'lucide-react';
import { Store } from './Store';
import Fuse from 'fuse.js';
import { invoke } from '@tauri-apps/api/core';

export function LeftSidebar({ songs, playlist, setPlaylist, onSelectSong, isLoading, onLoadDb, activeSong, searchFocusTrigger, favoriteDbs, toggleFavoriteDb }: any) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [view, setView] = useState('chant'); // 'chant' | 'bible' | 'store' | 'settings'
  const [dbs, setDbs] = useState<string[]>([]);
  const [activeDb, setActiveDb] = useState("");
  // Bible specific state
  const [selectedBook, setSelectedBook] = useState("");
  const [selectedChapter, setSelectedChapter] = useState("");
  const [showAddMenu, setShowAddMenu] = useState(false);

  useEffect(() => {
    if (searchFocusTrigger > 0) {
      if (view === 'settings' || view === 'store') setView('chant');
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [searchFocusTrigger]);

  // Keyboard Shortcuts to switch views
  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
       if (e.altKey && e.key === '1') { e.preventDefault(); setView('chant'); }
       if (e.altKey && e.key === '2') { e.preventDefault(); setView('bible'); }
       if (e.altKey && e.key === '3') { e.preventDefault(); setView('settings'); }
    };
    window.addEventListener('keydown', handleGlobalKeys);
    return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, []);

  useEffect(() => {
    async function fetchDbs() {
      if (view === 'store' || view === 'settings') return;
      try {
        const category = view === 'chant' ? 'hymnes' : 'bible';
        const result = await invoke<string[]>("list_dbs", { category });
        setDbs(result);
        
        // Use favorite if available and current active is invalid or empty
        const favorite = favoriteDbs[category];
        if (favorite && result.includes(favorite)) {
           if (activeDb !== favorite) {
              setActiveDb(favorite);
              onLoadDb(category, favorite);
           }
        } else if (result.length > 0 && !result.includes(activeDb)) {
          setActiveDb(result[0]);
          onLoadDb(category, result[0]);
        } else if (result.length === 0) {
          setActiveDb("");
          onLoadDb(category, "");
        }
      } catch (e) { console.error(e); }
    }
    fetchDbs();
  }, [view, favoriteDbs]);

  const fuse = new Fuse(songs, {
    keys: ['title', 'number', 'book'],
    threshold: 0.3
  });

  const searchResults = searchTerm 
      ? fuse.search(searchTerm).map(result => result.item)
      : songs;

  const getDbDisplayName = (db: string) => {
    const base = db.replace('.db', '').replace('.SQLite3', '');
    const map: Record<string, string> = {
      "MG65": "Malagasy (MG1965)",
      "DIEM": "Malagasy (DIEM)",
      "Louis_Segond": "Français (Louis Segond)",
      "KJV": "English (KJV)",
      "Ostervald": "Français (Ostervald)",
      "BDS": "Français (Semeur)",
      "S21": "Français (Segond 21)",
      "NVI": "English (NVI)",
    };
    if (map[base]) return map[base];
    return base.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
  };



  const bibleBooks = view === 'bible' ? Array.from(new Set(songs.map((s:any) => s.book))) : [];
  const bibleChapters = view === 'bible' && selectedBook ? songs.filter((s:any) => s.book === selectedBook) : [];

  useEffect(() => {
    if (view === 'bible' && searchTerm.trim()) {
      const match = searchTerm.match(/^([a-zA-Z0-9éèêâîôû]+)\.?\s*(\d+)[:\.\s]*(\d+)?(?:-?(\d+))?/i);
      if (match) {
        const [, bookAlias, chapter, vStart, vEnd] = match;
        const bookNameStr = bibleBooks.find((b:any) => b.toLowerCase().startsWith(bookAlias.toLowerCase()));
        if (bookNameStr) {
          if (selectedBook !== bookNameStr) setSelectedBook(bookNameStr as string);
          if (selectedChapter !== chapter) setSelectedChapter(chapter);
          
          const chapterSong = songs.find((s:any) => s.book === bookNameStr && s.number === chapter);
          if (chapterSong && (activeSong?.id !== chapterSong.id || activeSong?.startVerse !== vStart)) {
            onSelectSong({ ...chapterSong, startVerse: vStart, endVerse: vEnd });
          }
        }
      }
    }
  }, [searchTerm, view, bibleBooks, songs]);

  useEffect(() => {
    setSelectedBook("");
    setSelectedChapter("");
  }, [activeDb, view]);

  const handleSaveAgenda = async () => {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');
      const filePath = await save({ filters: [{ name: 'Agenda JSON', extensions: ['json'] }] });
      if (filePath) await writeTextFile(filePath, JSON.stringify(playlist, null, 2));
    } catch (e) { console.error(e); }
  };

  const handleLoadAgenda = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const filePath = await open({ filters: [{ name: 'Agenda JSON', extensions: ['json'] }], multiple: false });
      if (filePath && typeof filePath === 'string') {
        const contents = await readTextFile(filePath);
        const data = JSON.parse(contents);
        if (Array.isArray(data)) setPlaylist(data);
      }
    } catch (e) { console.error(e); }
  };

  const addToAgenda = () => {
    if (activeSong && !playlist.some((s:any) => s.id === activeSong.id)) {
      setPlaylist([...playlist, activeSong]);
    }
  };

  const addCustomItem = () => {
    const newItem = { id: Date.now().toString(), title: "Programme Libre", number: "📝", lyrics: "Entrez votre texte ici...", type: "custom" };
    setPlaylist([...playlist, newItem]);
    onSelectSong(newItem, 'agenda');
  };

  const addMediaItem = async (type: 'image' | 'video') => {
    try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const { convertFileSrc } = await import('@tauri-apps/api/core');
        const file = await open({
          multiple: false,
          filters: type === 'image' ? [{ name: 'Images', extensions: ['png', 'jpeg', 'jpg', 'webp', 'gif'] }] : [{ name: 'Videos', extensions: ['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi', 'm4v'] }]
        });
        if (file && typeof file === 'string') {
          const assetUrl = convertFileSrc(file);
          const filename = file.split(/[/\\]/).pop() || 'Media';
          const newItem = { id: Date.now().toString(), title: filename, number: type === 'image' ? '🖼️' : '🎬', lyrics: assetUrl, type: type };
          setPlaylist([...playlist, newItem]);
        }
    } catch(e) { console.error(e) }
  };

  const addFileItem = async () => {
    try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const { convertFileSrc } = await import('@tauri-apps/api/core');
        const file = await open({
          multiple: false,
          filters: [{ name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt', 'md'] }]
        });
        if (file && typeof file === 'string') {
          const assetUrl = convertFileSrc(file);
          const filename = file.split(/[/\\]/).pop() || 'Document';
          const newItem = { id: Date.now().toString(), title: filename, number: '📄', lyrics: assetUrl, type: 'document' };
          setPlaylist([...playlist, newItem]);
        }
    } catch(e) { console.error(e) }
  };

  const moveAgendaItem = (e: any, index: number, dir: 'up'|'down') => {
    e.stopPropagation();
    const newList = [...playlist];
    if (dir === 'up' && index > 0) [newList[index-1], newList[index]] = [newList[index], newList[index-1]];
    else if (dir === 'down' && index < newList.length - 1) [newList[index+1], newList[index]] = [newList[index], newList[index+1]];
    setPlaylist(newList);
  };

  const removeAgendaItem = (e: any, index: number) => {
    e.stopPropagation();
    const newList = [...playlist];
    newList.splice(index, 1);
    setPlaylist(newList);
  };

  return (
    <div className="w-80 bg-[#202225] h-full flex flex-col border-r border-[#18191c]">
      <div className="flex-1 flex flex-col min-h-0 border-b border-[#18191c]">
        <div className="p-2 bg-[#2b2d31] flex items-center justify-between border-b border-[#18191c]">
           <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-2 text-gray-300">
             <List size={14} /> Agenda
           </span>
           <div className="flex items-center gap-1 relative">
             <button className="p-1 hover:bg-[#3f4147] rounded text-gray-400 hover:text-white transition" onClick={() => setShowAddMenu(!showAddMenu)}><Plus size={14} /></button>
             {showAddMenu && (
               <div className="absolute top-full right-0 mt-1 w-48 bg-[#2b2d31] border border-[#36393f] rounded shadow-xl z-50 py-1">
                 <button className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-[#5865f2] hover:text-white transition flex items-center gap-2" onClick={() => { addToAgenda(); setShowAddMenu(false); }}><Music size={12} /> Sélection</button>
                 <button className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-[#5865f2] hover:text-white transition flex items-center gap-2" onClick={() => { addCustomItem(); setShowAddMenu(false); }}><Type size={12} /> Libre</button>
                 <button className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-[#5865f2] hover:text-white transition flex items-center gap-2" onClick={() => { addMediaItem('image'); setShowAddMenu(false); }}><ImageIcon size={12} /> Image</button>
                 <button className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-[#5865f2] hover:text-white transition flex items-center gap-2" onClick={() => { addMediaItem('video'); setShowAddMenu(false); }}><Video size={12} /> Vidéo</button>
                 <button className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-[#5865f2] hover:text-white transition flex items-center gap-2" onClick={() => { addFileItem(); setShowAddMenu(false); }}><FileText size={12} /> Fichier</button>
               </div>
             )}
             <button className="p-1 hover:bg-[#3f4147] rounded text-gray-400 hover:text-white transition" onClick={handleLoadAgenda}><FolderOpen size={14} /></button>
             <button className="p-1 hover:bg-[#3f4147] rounded text-gray-400 hover:text-white transition" onClick={handleSaveAgenda}><Save size={14} /></button>
             <button className="p-1 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400 transition" onClick={() => setPlaylist([])}><X size={14} /></button>
           </div>
        </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
        {playlist.length === 0 ? <div className="text-xs text-gray-500 text-center mt-4">Agenda vide</div> : playlist.map((item: any, idx: number) => (
          <div 
            key={idx} 
            className={`px-2 py-1.5 rounded hover:bg-[#36393f] cursor-pointer flex items-center gap-2 group transition text-sm ${activeSong?.id === item.id ? 'bg-[#36393f] border-l-2 border-[#5865f2]' : 'border-l-2 border-transparent'}`}
            onClick={() => onSelectSong(item, item.type === 'bible' ? 'bible' : 'hymnes')}
          >
            <Music size={12} className="text-[#5865f2] shrink-0" />
            <span className="text-gray-400 w-8 shrink-0">{item.number}</span>
            <span className="text-gray-200 truncate flex-1">{item.title}</span>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
              <button 
                className="p-1 hover:bg-[#2b2d31] rounded text-gray-400 hover:text-white"
                onClick={(e) => moveAgendaItem(e, idx, 'up')}
              ><ChevronUp size={12} /></button>
              <button 
                className="p-1 hover:bg-[#2b2d31] rounded text-gray-400 hover:text-white"
                onClick={(e) => moveAgendaItem(e, idx, 'down')}
              ><ChevronDown size={12} /></button>
              <button 
                className="p-1 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400"
                onClick={(e) => removeAgendaItem(e, idx)}
              ><Trash2 size={12} /></button>
            </div>
          </div>
        ))}
      </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 bg-[#2f3136]">
        <div className="flex bg-[#202225] text-xs">
          <button className={`flex-1 py-2 font-bold border-b-2 transition flex items-center justify-center gap-1.5 ${view === 'chant' ? 'border-[#5865f2] text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`} onClick={() => setView('chant')}>
             <Music size={14} /> Recueils
          </button>
          <button className={`flex-1 py-2 font-bold border-b-2 transition flex items-center justify-center gap-1.5 ${view === 'bible' ? 'border-[#5865f2] text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`} onClick={() => setView('bible')}>
             <BookOpen size={14} /> Bibles
          </button>
          <button className={`flex-1 py-2 font-bold border-b-2 transition flex items-center justify-center gap-1.5 ${view === 'settings' ? 'border-[#5865f2] text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`} onClick={() => setView('settings')}>
             <Settings size={14} /> Params
          </button>
        </div>
        
        {view === 'store' && <Store onInstalled={() => setView('chant')} onLoadDb={onLoadDb} />}
        
        {view === 'settings' && (
          <div className="flex-1 overflow-y-auto p-4 text-xs text-gray-300 space-y-4">
             <h2 className="text-white text-sm font-bold border-b border-[#36393f] pb-2">Paramètres</h2>
             <div>
                <h3 className="font-bold text-[#5865f2] mb-1">Raccourcis</h3>
                   <ul className="list-disc pl-4 opacity-80">
                      <li>Alt+1/2/3 : Changer de Vue</li>
                      <li>Alt+S : Rechercher un Chant</li>
                      <li>Alt+B : Écran de Base (Accueil)</li>
                      <li>Alt+P : Lancer 1er Agenda</li>
                      <li>Alt+L : Activer/Off LIVE</li>
                      <li>Alt+H : Cacher le Contenu</li>
                      <li>Alt+Enter : PROJETER sélection</li>
                      <li>Haut/Bas : Changer Diapo</li>
                   </ul>
             </div>
             <div>
                <h3 className="font-bold text-[#5865f2] mb-1">Support</h3>
                <ul className="list-disc pl-4 opacity-80">
                   <li>Docs: PDF, TXT, MD</li>
                   <li>Office: Convertir en PDF</li>
                </ul>
             </div>
          </div>
        )}

        {(view !== 'store' && view !== 'settings') && (
           <>
              <div className="p-2 border-b border-[#202225] flex flex-col gap-2">
                <div className="flex gap-1.5 items-center">
                  <select 
                    className="flex-1 bg-[#1e1f22] text-xs text-gray-200 border border-[#36393f] rounded py-1.5 px-2 outline-none appearance-none cursor-pointer focus:ring-1 focus:ring-[#5865f2]" 
                    style={{ backgroundImage: `url('data:image/svg+xml;utf8,<svg fill="currentColor" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z" fill="%239CA3AF"/></svg>')`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 4px center', backgroundSize: '16px' }}
                    value={activeDb} 
                    onChange={(e) => { setActiveDb(e.target.value); onLoadDb(view === 'chant' ? 'hymnes' : 'bible', e.target.value); }}
                  >
                    {dbs.length === 0 && <option value="">Aucun module</option>}
                    {dbs.map(db => <option key={db} value={db} className="bg-[#2b2d31]">{getDbDisplayName(db)}</option>)}
                  </select>
                  {activeDb && (
                    <button 
                      className={`p-1.5 transition rounded ${favoriteDbs[view === 'chant' ? 'hymnes' : 'bible'] === activeDb ? 'text-red-500 hover:text-red-400' : 'text-gray-500 hover:text-gray-300'}`} 
                      title="Définir comme module par défaut" 
                      onClick={() => toggleFavoriteDb(view === 'chant' ? 'hymnes' : 'bible', activeDb)}
                    >
                      <Heart size={14} fill={favoriteDbs[view === 'chant' ? 'hymnes' : 'bible'] === activeDb ? "currentColor" : "none"} />
                    </button>
                  )}
                  <button className="bg-[#5865f2] p-1.5 rounded hover:bg-[#4752c4] transition" title="Télécharger des modules" onClick={() => setView('store')}><Download size={14} /></button>
                </div>
                <div className="relative">
                  <SearchIcon className="absolute left-2 top-2 text-gray-400" size={14} />
                  <input ref={searchRef} type="text" placeholder={view === 'chant' ? "Rechercher un chant, un numéro..." : "Un livre, un chapitre (ex: Jean 3:16)..."} className="w-full bg-[#1e1f22] text-xs text-gray-200 border border-[#36393f] rounded py-1.5 pl-7 pr-2 outline-none" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                {view === 'chant' ? (
                  isLoading ? <div className="text-xs text-gray-400 text-center mt-4">Chargement...</div> : searchResults.map((song: any) => (
                    <div key={song.id} className="px-2 py-1 rounded hover:bg-[#3f4147] cursor-pointer flex items-center gap-2 text-xs" onClick={() => onSelectSong(song, 'hymnes')}>
                      <Music size={10} className="text-gray-500" />
                      <span className="text-gray-400 w-6 font-mono">{song.number}</span>
                      <span className="text-gray-300 truncate">{song.title}</span>
                    </div>
                  ))
                ) : (
                  !selectedBook ? (
                    <div className="grid grid-cols-2 gap-1.5">
                      {bibleBooks.map((book: any) => <button key={book} className="bg-[#1e1f22] hover:bg-[#5865f2] text-xs rounded py-2 truncate" onClick={() => setSelectedBook(book)}>{book}</button>)}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 mb-1">
                        <button className="text-[10px] text-gray-400 hover:text-white bg-[#1e1f22] px-2 py-0.5 rounded border border-[#36393f] transition-colors hover:bg-[#2b2d31]" onClick={() => { setSelectedBook(""); setSelectedChapter(""); }}>← Retour</button>
                        <span className="text-xs font-bold text-[#5865f2] truncate uppercase tracking-tighter">{selectedBook}</span>
                      </div>
                      <div className="grid grid-cols-5 gap-1.5">
                        {bibleChapters.map((s:any) => (
                           <button 
                             key={s.id} 
                             className={`text-xs py-2 rounded font-bold transition ${selectedChapter === s.number ? 'bg-[#5865f2] text-white shadow-md' : 'bg-[#1e1f22] text-gray-400 hover:bg-[#3f4147]'}`} 
                             onClick={() => { setSelectedChapter(s.number); onSelectSong(s, 'bible'); }}
                           >
                             {s.number}
                           </button>
                        ))}
                      </div>
                    </div>
                  )
                )}
              </div>
           </>
        )}
      </div>
    </div>
  );
}
