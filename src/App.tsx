import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Toolbar } from "./components/Toolbar";
import { LeftSidebar } from "./components/LeftSidebar";
import { MiddleEditor } from "./components/MiddleEditor";
import { RightProjection } from "./components/RightProjection";
import { LiveView } from "./components/LiveView";
import "./App.css";

function App() {
  const [activeSong, setActiveSong] = useState<any>(null);
  const [activeVerseIdx, setActiveVerseIdx] = useState<number>(-1);
  const [playlist, setPlaylist] = useState<any[]>(() => {
    const saved = localStorage.getItem('appAgenda');
    if (saved) return JSON.parse(saved);
    return [];
  });

  useEffect(() => {
    localStorage.setItem('appAgenda', JSON.stringify(playlist));
  }, [playlist]);
  
  const [songs, setSongs] = useState<any[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("chant");
  const [isLoading, setIsLoading] = useState(true);
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [isContentHidden, setIsContentHidden] = useState(false);
  const [isBaseScreenProjected, setIsBaseScreenProjected] = useState(true);

  const defaultTextSettings = {
    fontFamily: 'Inter',
    fontSize: 100,
    isBold: true,
    isItalic: false,
    isUnderline: false,
    align: 'center',
    color: '#ffffff'
  };

  const defaultStyles: any = {
    chant: { textSettings: { ...defaultTextSettings }, bgImage: "http://localhost:1420/backgrounds/pexels-m-venter-79250-1659437.jpg" },
    hymnes: { textSettings: { ...defaultTextSettings }, bgImage: "http://localhost:1420/backgrounds/pexels-m-venter-79250-1659437.jpg" },
    bible: { textSettings: { ...defaultTextSettings, align: 'left' }, bgImage: "http://localhost:1420/backgrounds/pexels-m-venter-79250-1659437.jpg" },
    agenda: { textSettings: { ...defaultTextSettings }, bgImage: "http://localhost:1420/backgrounds/pexels-m-venter-79250-1659437.jpg" },
  };

  const [settingsByCategory, setSettingsByCategory] = useState(() => {
    const saved = localStorage.getItem('appSettings');
    if (saved) return JSON.parse(saved);
    return defaultStyles;
  });

  const [specificSettings, setSpecificSettings] = useState(() => {
    const saved = localStorage.getItem('appSpecificSettings');
    if (saved) return JSON.parse(saved);
    return { books: {}, songs: {}, verses: {}, base: {} };
  });

  useEffect(() => {
    localStorage.setItem('appSpecificSettings', JSON.stringify(specificSettings));
  }, [specificSettings]);

  const [editingScope, setEditingScope] = useState<'category'|'book'|'song'|'verse'|'base'>('category');

  const getComputedSettingsForVerse = (song: any, verseIdx: number, forceBase: boolean = false) => {
     if (!song || forceBase) {
        return {
           textSettings: { ...defaultStyles.chant?.textSettings, ...(specificSettings.base?.textSettings || {}) },
           bgImage: specificSettings.base?.bgImage || defaultStyles.chant?.bgImage
        };
     }
     
     let txt = { ...defaultStyles.chant?.textSettings, ...(settingsByCategory[activeCategory]?.textSettings || {}) };
     let bg = settingsByCategory[activeCategory]?.bgImage || defaultStyles.chant?.bgImage;

     if (song?.book && specificSettings.books[song.book]) {
        txt = { ...txt, ...specificSettings.books[song.book].textSettings };
        if (specificSettings.books[song.book].bgImage) bg = specificSettings.books[song.book].bgImage;
     }
     if (song?.id && specificSettings.songs[song.id]) {
        txt = { ...txt, ...specificSettings.songs[song.id].textSettings };
        if (specificSettings.songs[song.id].bgImage) bg = specificSettings.songs[song.id].bgImage;
     }
     if (song?.id && verseIdx !== -1 && specificSettings.verses[`${song.id}_${verseIdx}`]) {
        txt = { ...txt, ...specificSettings.verses[`${song.id}_${verseIdx}`].textSettings };
        if (specificSettings.verses[`${song.id}_${verseIdx}`].bgImage) bg = specificSettings.verses[`${song.id}_${verseIdx}`].bgImage;
     }
     return { textSettings: txt, bgImage: bg };
  };

  const computedLiveSettings = getComputedSettingsForVerse(activeSong, activeVerseIdx, isBaseScreenProjected);

  const getEditingSettings = () => {
    if (editingScope === 'base') {
      return specificSettings.base || {};
    }
    if (editingScope === 'verse' && activeSong && activeVerseIdx !== -1) {
      return specificSettings.verses[`${activeSong.id}_${activeVerseIdx}`] || {};
    }
    if (editingScope === 'song' && activeSong) {
      return specificSettings.songs[activeSong.id] || {};
    }
    if (editingScope === 'book' && activeSong?.book) {
      return specificSettings.books[activeSong.book] || {};
    }
    return settingsByCategory[activeCategory] || defaultStyles.chant;
  };
  
  const editingTarget = getEditingSettings();
  const tbTextSettings = { ...computedLiveSettings.textSettings, ...editingTarget.textSettings };
  const tbBgImage = editingTarget.bgImage || computedLiveSettings.bgImage;

  const handleUpdateTextSettings = (newText: any) => {
    const nextStyle = typeof newText === 'function' ? newText(tbTextSettings) : newText;
    
    if (editingScope === 'category') {
       setSettingsByCategory((prev: any) => {
         const updated = {
           ...prev,
           [activeCategory]: { ...(prev[activeCategory] || defaultStyles.chant), textSettings: nextStyle }
         };
         localStorage.setItem('appSettings', JSON.stringify(updated));
         return updated;
       });
    } else {
       setSpecificSettings((prev: any) => {
         let updated = { ...prev };
         if (editingScope === 'base') {
            updated.base = { ...(updated.base || {}), textSettings: nextStyle };
         } else if (editingScope === 'verse' && activeSong && activeVerseIdx !== -1) {
            const key = `${activeSong.id}_${activeVerseIdx}`;
            updated.verses[key] = { ...(updated.verses[key] || {}), textSettings: nextStyle };
         } else if (editingScope === 'song' && activeSong) {
            updated.songs[activeSong.id] = { ...(updated.songs[activeSong.id] || {}), textSettings: nextStyle };
         } else if (editingScope === 'book' && activeSong?.book) {
            updated.books[activeSong.book] = { ...(updated.books[activeSong.book] || {}), textSettings: nextStyle };
         }
         return updated;
       });
    }
  };

  const handleUpdateBgImage = (newBg: any) => {
    const nextBg = typeof newBg === 'function' ? newBg(tbBgImage) : newBg;
    if (editingScope === 'category') {
       setSettingsByCategory((prev: any) => {
         const updated = {
           ...prev,
           [activeCategory]: { ...(prev[activeCategory] || defaultStyles.chant), bgImage: nextBg }
         };
         localStorage.setItem('appSettings', JSON.stringify(updated));
         return updated;
       });
    } else {
       setSpecificSettings((prev: any) => {
         let updated = { ...prev };
         if (editingScope === 'base') {
            updated.base = { ...(updated.base || {}), bgImage: nextBg };
         } else if (editingScope === 'verse' && activeSong && activeVerseIdx !== -1) {
            const key = `${activeSong.id}_${activeVerseIdx}`;
            updated.verses[key] = { ...(updated.verses[key] || {}), bgImage: nextBg };
         } else if (editingScope === 'song' && activeSong) {
            updated.songs[activeSong.id] = { ...(updated.songs[activeSong.id] || {}), bgImage: nextBg };
         } else if (editingScope === 'book' && activeSong?.book) {
            updated.books[activeSong.book] = { ...(updated.books[activeSong.book] || {}), bgImage: nextBg };
         }
         return updated;
       });
    }
  };

  const clearSpecificSettings = () => {
       if (editingScope === 'category') return;
       setSpecificSettings((prev: any) => {
         let updated = { ...JSON.parse(JSON.stringify(prev)) };
         if (editingScope === 'base') {
            delete updated.base;
         } else if (editingScope === 'verse' && activeSong && activeVerseIdx !== -1) {
            const key = `${activeSong.id}_${activeVerseIdx}`;
            delete updated.verses[key];
         } else if (editingScope === 'song' && activeSong) {
            delete updated.songs[activeSong.id];
         } else if (editingScope === 'book' && activeSong?.book) {
            delete updated.books[activeSong.book];
         }
         return updated;
       });
  };

  useEffect(() => {
    localStorage.setItem('live_style', JSON.stringify(computedLiveSettings.textSettings));
    localStorage.setItem('live_bg', computedLiveSettings.bgImage);
    import('@tauri-apps/api/event').then(({ emit }) => {
      emit('update_live_style', computedLiveSettings.textSettings).catch(()=>null);
      emit('update_live_bg', computedLiveSettings.bgImage).catch(()=>null);
    });
  }, [computedLiveSettings.textSettings, computedLiveSettings.bgImage]);

  // Si on est dans la fenêtre du projecteur (paramètre live=true)
  if (new URLSearchParams(window.location.search).get("live")) {
    return <LiveView />;
  }

  const loadDbData = async (category: string, dbName: string) => {
    setIsLoading(true);
    setActiveCategory(category);
    try {
      if (category === "hymnes") {
        const result: any[] = await invoke("fetch_hymns", { dbName });
        setSongs(result);
        if (result.length > 0) setActiveSong(result[0]);
      } else if (category === "bible") {
        const result: any[] = await invoke("fetch_bible", { dbName });
        setSongs(result);
        if (result.length > 0) setActiveSong(result[0]);
      }
    } catch (e) {
      console.error("Failed to load DB", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // on first load, we don't know the installed DBs yet, LeftSidebar will call loadDbData
    setIsLoading(false);
  }, []);

  return (
    <div className="flex flex-col h-screen w-full bg-[#18191c] overflow-hidden font-sans text-gray-200">
      
      {/* 1. TOP BAR - Ribbon / Toolbar */}
      <Toolbar 
         setBgImage={handleUpdateBgImage} 
         textSettings={tbTextSettings} 
         setTextSettings={handleUpdateTextSettings} 
         isLiveActive={isLiveActive}
         setIsLiveActive={setIsLiveActive}
         editingScope={editingScope}
         setEditingScope={setEditingScope}
         activeSong={activeSong}
         activeVerseIdx={activeVerseIdx}
         activeCategory={activeCategory}
         clearSpecificSettings={clearSpecificSettings}
         isContentHidden={isContentHidden}
         setIsContentHidden={setIsContentHidden}
         isBaseScreenProjected={isBaseScreenProjected}
         setIsBaseScreenProjected={setIsBaseScreenProjected}
      />

      {/* MAIN CONTENT SPLIT */}
      <div className="flex-1 flex min-h-0">
         
         {/* 2. LEFT - Playlist & Library */}
         <LeftSidebar 
            songs={songs} 
            playlist={playlist} 
            setPlaylist={setPlaylist} 
            onSelectSong={setActiveSong} 
            isLoading={isLoading}
            onLoadDb={loadDbData}
            activeSong={activeSong}
         />

         {/* 3. MIDDLE - Song Editor */}
         <MiddleEditor 
            activeSong={activeSong} 
            onSave={(updatedSong: any) => {
               setActiveSong(updatedSong);
               setPlaylist((prev: any[]) => prev.map(item => item.id === updatedSong.id ? updatedSong : item));
            }} 
         />

         {/* 4. RIGHT - Slides list & Live Preview */}
         <RightProjection 
            activeSong={activeSong} 
            bgImage={computedLiveSettings.bgImage} 
            textSettings={computedLiveSettings.textSettings} 
            isLiveActive={isLiveActive} 
            isBibleView={activeCategory === 'bible'}
            activeVerseIdx={activeVerseIdx}
            setActiveVerseIdx={setActiveVerseIdx}
            getComputedSettingsForVerse={getComputedSettingsForVerse}
            isBaseScreenProjected={isBaseScreenProjected}
            setIsBaseScreenProjected={setIsBaseScreenProjected}
         />

      </div>
    </div>
  );
}

export default App;
