import { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Toolbar } from './components/Toolbar';
import { LeftSidebar } from './components/LeftSidebar';
import { MiddleEditor } from './components/MiddleEditor';
import { RightProjection } from './components/RightProjection';
import { LiveView } from './components/LiveView';

function App() {
  const [songs, setSongs] = useState<any[]>([]);
  const [playlist, setPlaylist] = useState<any[]>([]);
  const [activeSong, setActiveSong] = useState<any>(null);
  const [activeVerseIdx, setActiveVerseIdx] = useState<number>(-1);
  const [projectedSong, setProjectedSong] = useState<any>(null);
  const [projectedVerseIdx, setProjectedVerseIdx] = useState<number>(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>("hymnes");
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [isContentHidden, setIsContentHidden] = useState(false);
  const [isBaseScreenProjected, setIsBaseScreenProjected] = useState(true);
  const [liveCategory, setLiveCategory] = useState<string>("hymnes");
  const [searchFocusTrigger, setSearchFocusTrigger] = useState(0);
  const [favoriteDbs, setFavoriteDbs] = useState(() => {
    const saved = localStorage.getItem('favoriteDbs');
    return saved ? JSON.parse(saved) : { hymnes: "", bible: "" };
  });
  const [cameraList, setCameraList] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>("");
  const [isCameraActive, setIsCameraActive] = useState(false);

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then(devices => {
      const cams = devices.filter(d => d.kind === 'videoinput');
      setCameraList(cams);
      if (cams.length > 0) setSelectedCamera(cams[0].deviceId);
    });
  }, []);

  useEffect(() => {
    localStorage.setItem('favoriteDbs', JSON.stringify(favoriteDbs));
  }, [favoriteDbs]);

  const isLiveMode = useMemo(() => new URLSearchParams(window.location.search).get('live') === 'true', []);

  if (isLiveMode) {
    return <LiveView />;
  }

  // Global Shortcuts
  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setIsBaseScreenProjected(prev => {
          const next = !prev;
          if (next) {
            import('@tauri-apps/api/event').then(({ emit }) => {
              emit('update_live_lyrics', { lines: [], reference: "" });
              emit('update_live_media', null);
            });
          }
          return next;
        });
      }
      if (e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        if (playlist.length > 0) {
          setActiveSong(playlist[0]);
          setActiveVerseIdx(0);
          setIsBaseScreenProjected(false);
          setLiveCategory(playlist[0].type === 'bible' ? 'bible' : 'hymnes');
        }
      }
      if (e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        setSearchFocusTrigger(prev => prev + 1);
      }
      if (e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        handleLiveToggle();
      }
      if (e.altKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setIsContentHidden(prev => !prev);
        import('@tauri-apps/api/event').then(({ emit }) => {
          emit('update_live_hide_content', !isContentHidden);
        });
      }
    };
    window.addEventListener('keydown', handleGlobalShortcuts);
    return () => window.removeEventListener('keydown', handleGlobalShortcuts);
  }, [playlist, isLiveActive, isContentHidden]);

  const handleLiveToggle = async () => {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    let existing = await WebviewWindow.getByLabel('live');

    if (existing) {
      try {
        await existing.close();
      } catch (e) {
        console.error("Failed to close window", e);
        // Force state reset if close fails (e.g. window already gone but handle still exists)
        setIsLiveActive(false);
      }
      return;
    }

    try {
      const { availableMonitors } = await import('@tauri-apps/api/window');
      const monitors = await availableMonitors();
      let opts: any = {
        url: '/?live=true',
        title: 'Live',
        fullscreen: true,
        decorations: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        focus: false
      };

      if (monitors.length > 1) {
        const m = monitors[monitors.length - 1];
        opts.x = m.position.x;
        opts.y = m.position.y;
      }

      const w = new WebviewWindow('live', opts);

      setIsLiveActive(true);

      // Listen to window destruction to reset state instantly
      w.once('tauri://destroyed', () => {
        setIsLiveActive(false);
      });

      w.once('tauri://error', () => {
        setIsLiveActive(false);
      });

    } catch (e) {
      console.error("Window failed", e);
      setIsLiveActive(false);
    }
  };

  const defaultTextSettings = {
    fontFamily: 'Inter',
    fontSize: 100,
    isBold: true,
    isItalic: false,
    isUnderline: false,
    align: 'center',
    valign: 'middle',
    color: '#ffffff',
    lineHeight: 1.4,
    contentWidth: 100
  };

  const defaultStyles: any = {
    chant: { textSettings: { ...defaultTextSettings }, bgImage: "http://localhost:1420/backgrounds/sunset.jpg" },
    hymnes: { textSettings: { ...defaultTextSettings }, bgImage: "http://localhost:1420/backgrounds/sunset.jpg" },
    bible: { textSettings: { ...defaultTextSettings, align: 'left' }, bgImage: "http://localhost:1420/backgrounds/tree.png" },
    agenda: { textSettings: { ...defaultTextSettings }, bgImage: "http://localhost:1420/backgrounds/sunset.jpg" },
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

  const [editingScope, setEditingScope] = useState<'category' | 'book' | 'song' | 'verse' | 'base'>('category');

  const getComputedSettingsForVerse = (song: any, verseIdx: number, forceBase: boolean = false, categoryOverride?: string) => {
    if (!song || forceBase) {
      return {
        textSettings: { ...defaultStyles.chant?.textSettings, ...(specificSettings.base?.textSettings || {}) },
        bgImage: specificSettings.base?.bgImage || defaultStyles.chant?.bgImage
      };
    }
    const category = categoryOverride || (song?.type === 'bible' ? 'bible' : 'hymnes');
    const baseCategoryStyle = defaultStyles[category] || defaultStyles.chant;
    let txt = { ...baseCategoryStyle.textSettings, ...(settingsByCategory[category]?.textSettings || {}) };
    let bg = settingsByCategory[category]?.bgImage || baseCategoryStyle.bgImage;

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

  // LIVE FEATURES: Clock and Ticker
  const [clockSettings, setClockSettings] = useState<any>(() => {
    const saved = localStorage.getItem('clockSettings');
    return saved ? JSON.parse(saved) : {
      enabled: false,
      type: 'digital',
      style: 'modern',
      color: '#ffffff',
      size: 60,
      position: 'top-right'
    };
  });

  const [tickerSettings, setTickerSettings] = useState<any>(() => {
    const saved = localStorage.getItem('tickerSettings');
    const defaultTicker = {
      enabled: false,
      message: "Bienvenue à tous !",
      color: '#ffff00',
      bgColor: '#000000',
      bgOpacity: 0.7,
      position: 'bottom',
      fontSize: 28,
      fontFamily: 'Inter'
    };
    if (!saved) return defaultTicker;
    const parsed = JSON.parse(saved);
    return { ...parsed, message: defaultTicker.message }; // Keep default message as per user request
  });

  useEffect(() => {
    localStorage.setItem('clockSettings', JSON.stringify(clockSettings));
  }, [clockSettings]);

  useEffect(() => {
    localStorage.setItem('tickerSettings', JSON.stringify(tickerSettings));
  }, [tickerSettings]);

  const computedLiveSettings = useMemo(() =>
    getComputedSettingsForVerse(projectedSong, projectedVerseIdx, isBaseScreenProjected, liveCategory),
    [projectedSong, projectedVerseIdx, isBaseScreenProjected, liveCategory, settingsByCategory, specificSettings]
  );

  const previewSettings = useMemo(() =>
    getComputedSettingsForVerse(activeSong, activeVerseIdx, false, activeCategory),
    [activeSong, activeVerseIdx, activeCategory, settingsByCategory, specificSettings]
  );

  // ROBUST SYNC: Ensures LiveView always matches the Controller
  const sync = async () => {
    localStorage.setItem('live_style', JSON.stringify(computedLiveSettings.textSettings));
    localStorage.setItem('live_bg', computedLiveSettings.bgImage);

    if (!isLiveActive) return;

    const { emit } = await import('@tauri-apps/api/event');

    // 1. Send Style & Background
    emit('update_live_style', computedLiveSettings.textSettings).catch(() => null);
    emit('update_live_bg', computedLiveSettings.bgImage).catch(() => null);

    // 2. Compute Content
    let lyricsObj: any = { lines: [], reference: "", isBible: false };
    let mediaObj: any = null;

    if (!isBaseScreenProjected && projectedSong) {
      if (['image', 'video', 'document', 'audio', 'youtube', 'link'].includes(projectedSong.type)) {
        mediaObj = { type: projectedSong.type, url: projectedSong.lyrics };
      } else {
        const verses = projectedSong.lyrics.split(/\n\s*\n/);
        const safeIdx = Math.max(0, Math.min(projectedVerseIdx, verses.length - 1));
        const currentVerse = verses[safeIdx] || "";
        const lines = currentVerse.split('\n');
        const isBible = (liveCategory === 'bible' || projectedSong.type === 'bible');

        const refMatch = lines.length > 0 ? lines[0].match(/^(\d+)/) : null;
        let reference = "";
        if (isBible && refMatch) {
          reference = `${projectedSong.title}:${refMatch[1]}`;
        } else if (!isBible && projectedSong?.title) {
          reference = `(${projectedSong.title})`;
        }
        lyricsObj = { lines, reference, isBible };
      }
    }

    // 3. Emit atomic updates
    emit('update_live_content', { lyrics: lyricsObj, media: mediaObj }).catch(() => null);
    emit('update_live_hide_content', isContentHidden).catch(() => null);
    emit('update_live_clock', clockSettings).catch(() => null);
    emit('update_live_ticker', tickerSettings).catch(() => null);

    localStorage.setItem('live_lyrics', JSON.stringify(lyricsObj));
    localStorage.setItem('live_media', JSON.stringify(mediaObj));
  };

  useEffect(() => {
    sync();
  }, [isLiveActive, computedLiveSettings, projectedSong, projectedVerseIdx, isBaseScreenProjected, isContentHidden, liveCategory, clockSettings, tickerSettings]);

  useEffect(() => {
    let unlisten: any;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('live_ready', () => {
        sync();
      }).then(u => unlisten = u);
    });
    return () => { if (unlisten) unlisten(); };
  }, [projectedSong, projectedVerseIdx, isBaseScreenProjected, isLiveActive]);

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

  const getEditingContext = () => {
    // Determine the base style to start from for the toolbar
    const category = (editingScope === 'category') ? activeCategory : (activeSong?.type === 'bible' ? 'bible' : 'hymnes');
    const baseStyle = settingsByCategory[category] || defaultStyles.chant;

    let txt = { ...baseStyle.textSettings };
    let bg = baseStyle.bgImage;

    const target = getEditingSettings();
    txt = { ...txt, ...target.textSettings };
    if (target.bgImage) bg = target.bgImage;

    return { textSettings: txt, bgImage: bg };
  };

  const tbContext = getEditingContext();
  const tbTextSettings = tbContext.textSettings;
  const tbBgImage = tbContext.bgImage;

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



  const loadDbData = async (category: string, dbName: string) => {
    setIsLoading(true);
    setActiveCategory(category);
    try {
      if (category === "hymnes") {
        const result: any[] = await invoke("fetch_hymns", { dbName });
        setSongs(result);
      } else if (category === "bible") {
        const result: any[] = await invoke("fetch_bible", { dbName });
        setSongs(result);
      }
    } catch (e) {
      console.error("Failed to load DB", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setIsLoading(false);
  }, []);

  return (
    <div className="flex flex-col h-screen w-full bg-[#18191c] overflow-hidden font-sans text-gray-200">
      <Toolbar
        setBgImage={handleUpdateBgImage}
        textSettings={tbTextSettings}
        setTextSettings={handleUpdateTextSettings}
        isLiveActive={isLiveActive}
        handleLiveToggle={handleLiveToggle}
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
        cameraList={cameraList}
        selectedCamera={selectedCamera}
        setSelectedCamera={setSelectedCamera}
        isCameraActive={isCameraActive}
        setIsCameraActive={setIsCameraActive}
        clockSettings={clockSettings}
        setClockSettings={setClockSettings}
        tickerSettings={tickerSettings}
        setTickerSettings={setTickerSettings}
      />

      <div className="flex-1 flex min-h-0">
        <LeftSidebar
          songs={songs}
          playlist={playlist}
          setPlaylist={setPlaylist}
          onSelectSong={(song: any, category: string) => {
            setActiveSong(song);
            let startIdx = 0;
            if (song.startVerse) {
              const verses = song.lyrics?.split(/\n\s*\n/) || [];
              const foundIdx = verses.findIndex((v: string) => v.trim().startsWith(song.startVerse));
              if (foundIdx !== -1) startIdx = foundIdx;
            }
            setActiveVerseIdx(startIdx);
            if (category) setActiveCategory(category);
            setIsBaseScreenProjected(false);
          }}
          isLoading={isLoading}
          onLoadDb={loadDbData}
          activeSong={activeSong}
          searchFocusTrigger={searchFocusTrigger}
          favoriteDbs={favoriteDbs}
          toggleFavoriteDb={(category: string, db: string) => {
            setFavoriteDbs((prev: any) => ({ ...prev, [category]: prev[category] === db ? "" : db }));
          }}
        />

        <MiddleEditor
          activeSong={activeSong}
          onSave={(updatedSong: any) => {
            setActiveSong(updatedSong);
            setPlaylist((prev: any[]) => prev.map(item => item.id === updatedSong.id ? updatedSong : item));
          }}
        />

        <RightProjection
          activeSong={activeSong}
          projectedSong={projectedSong}
          projectedVerseIdx={projectedVerseIdx}
          bgImage={computedLiveSettings.bgImage}
          textSettings={computedLiveSettings.textSettings}
          previewSettings={previewSettings.textSettings}
          previewBg={previewSettings.bgImage}
          isLiveActive={isLiveActive}
          isBibleView={activeCategory === 'bible'}
          activeVerseIdx={activeVerseIdx}
          setActiveVerseIdx={setActiveVerseIdx}
          onProject={(song: any, idx: number) => {
            setProjectedSong(song);
            setProjectedVerseIdx(idx);
            setIsBaseScreenProjected(false);
            setLiveCategory(activeCategory);
          }}
          isBaseScreenProjected={isBaseScreenProjected}
          setIsBaseScreenProjected={setIsBaseScreenProjected}
          activeCategory={activeCategory}
        />
      </div>
    </div>
  );
}

export default App;
