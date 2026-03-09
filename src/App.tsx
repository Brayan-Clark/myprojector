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
  const [playlist, setPlaylist] = useState<any[]>([]);
  const [songs, setSongs] = useState<any[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("chant");
  const [isLoading, setIsLoading] = useState(true);
  const [bgImage, setBgImage] = useState<string>("http://localhost:1420/backgrounds/pexels-m-venter-79250-1659437.jpg");
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [textSettings, setTextSettings] = useState({
    fontFamily: 'Inter',
    fontSize: 100,
    isBold: true,
    isItalic: false,
    isUnderline: false,
    align: 'center',
    color: '#ffffff'
  });

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
         setBgImage={setBgImage} 
         textSettings={textSettings} 
         setTextSettings={setTextSettings} 
         isLiveActive={isLiveActive}
         setIsLiveActive={setIsLiveActive}
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
         <MiddleEditor activeSong={activeSong} onSave={setActiveSong} textSettings={textSettings} />

         {/* 4. RIGHT - Slides list & Live Preview */}
         <RightProjection 
            activeSong={activeSong} 
            bgImage={bgImage} 
            textSettings={textSettings} 
            isLiveActive={isLiveActive} 
            isBibleView={activeCategory === 'bible'}
         />

      </div>
    </div>
  );
}

export default App;
