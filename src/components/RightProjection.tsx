import { useState, useEffect } from 'react';
import { Star, AlertCircle, Presentation, MonitorOff } from 'lucide-react';

export function RightProjection({ 
  activeSong, projectedSong, projectedVerseIdx, bgImage, textSettings, 
  previewSettings, previewBg, isLiveActive, isBibleView, 
  activeVerseIdx, setActiveVerseIdx, onProject, isBaseScreenProjected, 
  setIsBaseScreenProjected, activeCategory 
}: any) {
  const [projectedLines, setProjectedLines] = useState<string[]>([]);
  const verses = activeSong?.lyrics?.split(/\n\s*\n/) || [];
  
  const cleanUrl = (url: string) => {
    if (!url) return "";
    try {
      return decodeURIComponent(url);
    } catch(e) {
      return url;
    }
  };

  useEffect(() => {
    if (activeSong) {
      let startIdx = 0;
      if (activeSong.startVerse) {
        const foundIdx = verses.findIndex((v: string) => v.trim().startsWith(activeSong.startVerse));
        if (foundIdx !== -1) startIdx = foundIdx;
      }
      setActiveVerseIdx(startIdx);
      
      // Initial scroll
      setTimeout(() => {
        document.getElementById(`verse-${startIdx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [activeSong]);
  
  useEffect(() => {
    if (projectedSong) {
      const pVerses = projectedSong.lyrics?.split(/\n\s*\n/) || [];
      const lines = pVerses[projectedVerseIdx]?.split('\n') || [];
      setProjectedLines(lines);
    } else {
      setProjectedLines([]);
    }
  }, [projectedSong, projectedVerseIdx]);

  // Auto-scroll the list to keep the selection visible
  useEffect(() => {
    if (activeVerseIdx !== -1) {
      const el = document.getElementById(`verse-${activeVerseIdx}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [activeVerseIdx]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!verses || verses.length === 0) return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        let newIdx = activeVerseIdx;
        if (e.key === 'ArrowUp' && activeVerseIdx > 0) newIdx--;
        if (e.key === 'ArrowDown' && activeVerseIdx < verses.length - 1) newIdx++;
        
        if (newIdx !== activeVerseIdx) {
          setActiveVerseIdx(newIdx);
          // Auto-project if we are already in live mode on THIS song
          if (!isBaseScreenProjected && activeSong?.id === projectedSong?.id) {
            onProject(activeSong, newIdx);
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeVerseIdx, verses, activeSong, projectedSong, isBaseScreenProjected]);

  useEffect(() => {
    const handleProjectKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'Enter') {
        e.preventDefault();
        onProject(activeSong, activeVerseIdx);
      }
    };
    window.addEventListener('keydown', handleProjectKey);
    return () => window.removeEventListener('keydown', handleProjectKey);
  }, [activeSong, activeVerseIdx]);

  return (
    <div className="w-96 bg-[#202225] h-full flex flex-col border-l border-[#18191c]">
      <div className="flex-1 overflow-y-auto flex flex-col">
        <div className="bg-[#5865f2] p-2 flex items-center gap-2 shadow-md">
           <Presentation size={16} className="text-white" />
           <span className="text-white font-bold text-sm truncate">{activeSong ? activeSong.title : "Aperçu"}</span>
        </div>

        <div className="flex-1 p-2 space-y-1 bg-[#2f3136] overflow-y-auto">
          {!activeSong ? (
             <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-2">
                <AlertCircle size={32} />
                <p className="text-xs text-center">Sélectionnez un contenu pour le préparer</p>
             </div>
          ) : (activeSong.type === 'image' || activeSong.type === 'video' || activeSong.type === 'document') ? (
             <div className="group flex flex-col items-center justify-center bg-[#36393f] hover:bg-[#4752c4] text-gray-300 hover:text-white rounded cursor-pointer transition border border-transparent hover:border-[#5865f2] overflow-hidden p-6 gap-3" onClick={() => onProject(activeSong, 0)}>
                <div className="font-bold text-lg text-center">Projeter l'élément</div>
                <div className="text-xs opacity-70 text-center bg-black/20 p-2 rounded max-w-full truncate">{activeSong.title}</div>
             </div>
          ) : verses.map((verse: string, idx: number) => {
              const isRefrain = verse.toLowerCase().includes('refrain') || idx === 1;
              const label = isRefrain ? 'R' : `S${idx + 1}`;
              
              const isPreviewed = idx === activeVerseIdx;
              const isProjected = !isBaseScreenProjected && projectedSong?.id === activeSong?.id && idx === projectedVerseIdx;
              
              const bgClass = isProjected ? "bg-red-600/20 border-red-500" : isPreviewed ? "bg-[#4752c4] border-[#5865f2]" : "bg-[#36393f] border-transparent";
              
              return (
                <div key={idx} id={`verse-${idx}`} className={`group flex ${bgClass} hover:bg-[#4752c4] text-gray-300 hover:text-white rounded cursor-pointer transition border hover:border-[#5865f2] overflow-hidden`} onClick={() => { setActiveVerseIdx(idx); onProject(activeSong, idx); }}>
                  <div className={`w-8 flex flex-col items-center justify-center text-[10px] font-bold border-r border-[#2f3136] ${isProjected ? 'bg-red-600 text-white' : 'bg-[#202225]'}`}>
                    {isProjected ? <span className="text-[7px] leading-tight">LIVE</span> : isRefrain ? <Star size={10} className="text-yellow-500" /> : label}
                  </div>
                  <div className="flex-1 p-2"><p className="text-xs leading-snug line-clamp-3" dangerouslySetInnerHTML={{ __html: verse.replace(/<\/?[^>]+(>|$)/g, "") }} /></div>
                </div>
              )
          })}
        </div>
      </div>

      <div className="aspect-video bg-[#18191c] border-t-2 border-[#5865f2] relative overflow-hidden group/monitor">
         {/* Live Monitor View */}
         <div className="absolute top-1 left-2 z-30 text-[8px] font-black text-white/40 tracking-widest uppercase pointer-events-none">Ecran de Presentation</div>
         
         {!isBaseScreenProjected && projectedSong ? (
            <>
               {bgImage?.match(/\.(mp4|webm|ogg|mov|mkv|avi|m4v)(\?.*)?$/i) ? (
                  <video key={bgImage} src={cleanUrl(bgImage)} autoPlay loop muted playsInline className="absolute inset-0 w-full h-full object-cover" />
               ) : (
                  <img src={bgImage} className="absolute inset-0 w-full h-full object-cover" alt="Background" />
               )}
               
               <div className="absolute inset-0 flex items-center justify-center flex-col p-4 z-10">
                  {['image', 'video', 'document'].includes(projectedSong.type) ? (
                     <div className="w-full h-full flex items-center justify-center z-20 absolute inset-0 bg-black">
                        {projectedSong.type === 'image' && <img src={projectedSong.lyrics} className="w-full h-full object-contain" alt="Media" />}
                        {projectedSong.type === 'video' && <video key={projectedSong.lyrics} src={cleanUrl(projectedSong.lyrics)} className="w-full h-full object-contain" controls autoPlay playsInline preload="auto" />}
                     </div>
                  ) : (
                     <div 
                        className="flex flex-col w-full h-full" 
                        style={{ 
                           fontFamily: textSettings?.fontFamily, 
                           justifyContent: textSettings?.valign === 'middle' ? 'center' : textSettings?.valign === 'bottom' ? 'flex-end' : 'flex-start',
                           alignItems: textSettings?.align === 'center' ? 'center' : textSettings?.align === 'left' ? 'flex-start' : 'flex-end'
                        }}
                     >
                        {projectedLines.map((line: string, i: number) => (
                           <p 
                              key={i} 
                              className="text-white font-bold text-[8px] w-full drop-shadow-md" 
                              style={{ 
                                 textAlign: textSettings?.align as any,
                                 fontWeight: textSettings?.isBold ? 'bold' : 'normal',
                                 fontStyle: textSettings?.isItalic ? 'italic' : 'normal',
                                 textDecoration: textSettings?.isUnderline ? 'underline' : 'none'
                              }} 
                              dangerouslySetInnerHTML={{ __html: line.replace(/<\/?[^>]+(>|$)/g, "") }} 
                           />
                        ))}
                     </div>
                  )}
               </div>
            </>
         ) : (
            <div className="absolute inset-0 bg-black flex flex-col items-center justify-center gap-2">
               <MonitorOff size={24} className="text-gray-700" />
               <span className="text-[10px] text-gray-700 font-bold uppercase tracking-tighter">Écran d'Accueil</span>
            </div>
         )}
         
         {isLiveActive && <div className="absolute bottom-2 right-2 bg-red-600 text-white text-[8px] px-1 py-0.5 rounded font-bold animate-pulse z-40 shadow-xl border border-white/20">LIVE</div>}
         
         {/* Hover Overlay for Base Projection Toggle */}
         {!isBaseScreenProjected && (
            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/monitor:opacity-100 transition flex items-center justify-center z-50">
               <button 
                  className="bg-gray-800 hover:bg-gray-700 text-white text-[10px] font-bold py-2 px-4 rounded border border-gray-600 shadow-2xl flex items-center gap-2"
                  onClick={() => setIsBaseScreenProjected(true)}
               >
                  <MonitorOff size={14} /> COUPER LA PROJECTION
               </button>
            </div>
         )}
      </div>
    </div>
  );
}
