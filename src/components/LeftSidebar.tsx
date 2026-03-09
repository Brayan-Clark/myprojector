import { useState, useEffect } from 'react';
import { Search, Save, FolderOpen, X, BookOpen, Music, Search as SearchIcon, List, Download } from 'lucide-react';
import { Store } from './Store';
import Fuse from 'fuse.js';
import { invoke } from '@tauri-apps/api/core';

export function LeftSidebar({ songs, playlist, setPlaylist, onSelectSong, isLoading, onLoadDb, activeSong }: any) {
  const [searchTerm, setSearchTerm] = useState('');
  const [view, setView] = useState('chant'); // 'chant' | 'bible' | 'store'
  const [dbs, setDbs] = useState<string[]>([]);
  const [activeDb, setActiveDb] = useState("");
  // Bible specific state
  const [selectedBook, setSelectedBook] = useState("");
  const [selectedChapter, setSelectedChapter] = useState("");

  useEffect(() => {
    async function fetchDbs() {
      if (view === 'store') return;
      try {
        const category = view === 'chant' ? 'hymnes' : 'bible';
        const result = await invoke<string[]>("list_dbs", { category });
        setDbs(result);
        if (result.length > 0 && !result.includes(activeDb)) {
          setActiveDb(result[0]);
          onLoadDb(category, result[0]);
        } else if (result.length === 0) {
          // No DB installed for this view
          setActiveDb("");
          onLoadDb(category, "");
        }
      } catch (e) { console.error(e); }
    }
    fetchDbs();
  }, [view]);

  const fuse = new Fuse(songs, {
    keys: ['title', 'number', 'book'],
    threshold: 0.3
  });

  const searchResults = searchTerm 
      ? fuse.search(searchTerm).map(result => result.item)
      : songs;

  // DB name mapping
  const getDbDisplayName = (db: string) => {
    const base = db.replace('.db', '').replace('.SQLite3', '');
    const map: Record<string, string> = {
      "MG65": "Malagasy (MG65)",
      "DIEM": "Malagasy (DIEM)",
      "Louis_Segond": "Français (Louis Segond)",
      "KJV": "English (KJV)",
    };
    return map[base] || base;
  };

  // Derive books and chapters for Bible mode
  const bibleBooks = view === 'bible' ? Array.from(new Set(songs.map((s:any) => s.book))) : [];
  const bibleChapters = view === 'bible' && selectedBook ? songs.filter((s:any) => s.book === selectedBook) : [];

  // Bible search direct jump
  useEffect(() => {
    if (view === 'bible' && searchTerm.trim()) {
      // Matches "Gen.2:23", "Gen 2:23", "gen 2:23-27"
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

  // Reset bible selection when active DB changes or view changes
  useEffect(() => {
    setSelectedBook("");
    setSelectedChapter("");
  }, [activeDb, view]);

  return (
    <div className="w-80 bg-[#202225] h-full flex flex-col border-r border-[#18191c]">
      
      {/* AGENDA / PLAYLIST ZONE */}
      <div className="flex-1 flex flex-col min-h-0 border-b border-[#18191c]">
        <div className="p-2 bg-[#2b2d31] flex items-center justify-between border-b border-[#18191c]">
           <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-2 text-gray-300">
             <List size={14} /> Agenda
           </span>
           <div className="flex items-center gap-1">
             <button className="p-1 hover:bg-[#3f4147] rounded text-gray-400 hover:text-white transition"><FolderOpen size={14} /></button>
             <button className="p-1 hover:bg-[#3f4147] rounded text-gray-400 hover:text-white transition"><Save size={14} /></button>
             <button className="p-1 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400 transition" onClick={() => setPlaylist([])}><X size={14} /></button>
           </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {playlist.length === 0 ? (
            <div className="text-xs text-gray-500 text-center mt-4">L'agenda est vide</div>
          ) : (
            playlist.map((item: any, idx: number) => (
              <div 
                key={idx} 
                className="px-2 py-1.5 rounded hover:bg-[#36393f] cursor-pointer flex items-center gap-2 group transition text-sm"
                onClick={() => onSelectSong(item)}
              >
                <Music size={12} className="text-[#5865f2]" />
                <span className="text-gray-400 w-8">{item.number}</span>
                <span className="text-gray-200 truncate flex-1">{item.title}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* LIBRARY & SEARCH ZONE */}
      <div className="flex-1 flex flex-col min-h-0 bg-[#2f3136]">
        <div className="flex bg-[#202225] text-xs">
          <button 
             className={`flex-1 py-2 flex items-center justify-center gap-1.5 font-bold border-b-2 text-white transition ${view === 'chant' ? 'border-[#5865f2]' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
             onClick={() => setView('chant')}
          >
             <Music size={14} /> Recueils
          </button>
          <button 
             className={`flex-1 py-2 flex items-center justify-center gap-1.5 font-bold border-b-2 text-white transition ${view === 'bible' ? 'border-[#5865f2]' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
             onClick={() => setView('bible')}
          >
             <BookOpen size={14} /> Bibles
          </button>
        </div>
        
        {view === 'store' ? (
           <Store onInstalled={() => setView('chant')} />
        ) : (
           <>
               <div className="p-2 border-b border-[#202225] flex flex-col gap-2">
                 <div className="flex gap-2">
                   <select 
                     className="flex-1 bg-[#1e1f22] text-xs text-gray-200 border border-[#36393f] rounded py-1.5 px-2 outline-none focus:ring-1 focus:ring-[#5865f2] transition appearance-none cursor-pointer"
                     style={{ backgroundImage: `url('data:image/svg+xml;utf8,<svg fill="currentColor" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z" fill="%239CA3AF"/></svg>')`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 4px center', backgroundSize: '16px' }}
                     value={activeDb}
                     onChange={(e) => {
                       setActiveDb(e.target.value);
                       onLoadDb(view === 'chant' ? 'hymnes' : 'bible', e.target.value);
                     }}
                   >
                     {dbs.length === 0 && <option value="">Aucun module installé</option>}
                     {dbs.map(db => (
                       <option key={db} value={db} className="bg-[#2b2d31] text-gray-200">{getDbDisplayName(db)}</option>
                     ))}
                   </select>
                   <button className="bg-[#5865f2] hover:bg-[#4752c4] transition text-white p-1.5 rounded" title="Télécharger d'autres modules" onClick={() => setView('store')}>
                      <Download size={14} />
                   </button>
                 </div>
                 
                 <div className="relative">
                   <SearchIcon className="absolute left-2 top-2 text-gray-400" size={14} />
                   <input
                     type="text"
                     placeholder={view === 'bible' ? "Livre.chap:vers (ex: Gen.1:1)" : "Mots ou n° à chercher..."}
                     className="w-full bg-[#1e1f22] text-xs text-gray-200 border border-[#36393f] rounded py-1.5 pl-7 pr-2 outline-none focus:ring-1 focus:ring-[#5865f2] transition"
                     value={searchTerm}
                     onChange={(e) => setSearchTerm(e.target.value)}
                   />
                 </div>
              </div>

              {view === 'chant' && (
                <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                  {isLoading ? (
                    <div className="text-xs text-gray-400 text-center mt-4">Chargement de la base de données...</div>
                  ) : searchResults.map((song: any) => (
                    <div 
                      key={song.id} 
                      className="px-2 py-1 rounded hover:bg-[#3f4147] cursor-pointer flex items-center gap-2 group transition text-xs"
                      onDoubleClick={() => {
                        if (!playlist.find((s:any) => s.id === song.id)) {
                          setPlaylist([...playlist, song]);
                        }
                      }}
                      onClick={() => onSelectSong(song)}
                    >
                      <Music size={10} className="text-gray-500 group-hover:text-[#5865f2]" />
                      <span className="text-gray-400 w-6 font-mono">{song.number}</span>
                      <span className="text-gray-300 truncate">{song.title}</span>
                    </div>
                  ))}
                </div>
              )}

              {view === 'bible' && (
                <div className="flex-1 overflow-y-auto p-2">
                  {!selectedBook ? (
                    <div className="grid grid-cols-2 gap-1.5">
                      {(bibleBooks as string[]).map(book => (
                        <button 
                          key={book}
                          className="bg-[#1e1f22] hover:bg-[#5865f2] text-xs text-center text-gray-300 hover:text-white border border-[#36393f] hover:border-transparent rounded py-2 px-1 transition truncate"
                          onClick={() => setSelectedBook(book)}
                          title={book}
                        >
                          {book}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <button 
                        className="text-xs text-left text-gray-400 hover:text-white mb-1 transition flex items-center gap-1"
                        onClick={() => { setSelectedBook(""); setSelectedChapter(""); }}
                      >
                         ← Retour aux livres
                      </button>
                      <div className="text-xs font-bold text-[#5865f2] mb-1">{selectedBook}</div>
                      <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5">
                        {bibleChapters.map((s:any) => (
                          <button 
                            key={s.id}
                            className={`text-xs text-center py-2 rounded transition border ${selectedChapter === s.number ? 'bg-[#5865f2] border-transparent text-white' : 'bg-[#1e1f22] border-[#36393f] text-gray-300 hover:border-[#5865f2] hover:bg-[#36393f]'}`}
                            onClick={() => {
                              setSelectedChapter(s.number);
                              onSelectSong(s);
                            }}
                          >
                            {s.number}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
           </>
        )}
      </div>
    </div>
  );
}
