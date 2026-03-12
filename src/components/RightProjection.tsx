import { useState, useEffect, useRef } from 'react';
import { Star, AlertCircle, Presentation, MonitorOff, Headphones, Youtube, Globe } from 'lucide-react';

export function RightProjection({ 
  activeSong, projectedSong, projectedVerseIdx, bgImage, textSettings, 
  isLiveActive, activeVerseIdx, setActiveVerseIdx, onProject, isBaseScreenProjected, 
  setIsBaseScreenProjected, ticker, clock, isContentHidden, isCameraActive, selectedCamera, currentTime, mediaOverlay 
}: any) {
  const [projectedLines, setProjectedLines] = useState<string[]>([]);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const verses = activeSong?.lyrics?.split(/\n\s*\n/) || [];
  
  const cleanUrl = (url: string) => {
    if (!url || url === '' || url === 'null') return undefined;
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('asset:') || url.startsWith('http') || url.startsWith('tauri:')) {
      return url;
    }
    
    const appDataPath = localStorage.getItem('appDataPath');
    let relativePath = url;
    
    if (appDataPath && url.startsWith(appDataPath)) {
      relativePath = url.replace(appDataPath, '');
    }
    
    const stripped = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
    return `http://127.0.0.1:11223/fs/${encodeURIComponent(stripped).replace(/%2F/g, '/')}`;
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
    let stream: MediaStream | null = null;
    const startCam = async () => {
      if (isCameraActive && previewVideoRef.current) {
        try {
          // Simplified constraints for better compatibility
          const constraints = selectedCamera 
            ? { video: { deviceId: { exact: selectedCamera } } }
            : { video: true };
            
          console.log("RightProjection: Starting camera with constraints:", constraints);
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (previewVideoRef.current) {
            previewVideoRef.current.srcObject = stream;
            previewVideoRef.current.play().catch(e => console.warn("Video play failed:", e));
          }
        } catch (e: any) {
          console.error("Preview Camera Error:", e.name, e.message);
          // Fallback to absolute minimum
          try {
             console.log("RightProjection: Fallback to basic video:true");
             stream = await navigator.mediaDevices.getUserMedia({ video: true });
             if (previewVideoRef.current) {
               previewVideoRef.current.srcObject = stream;
               previewVideoRef.current.play().catch(() => {});
             }
          } catch (e2) {
             console.error("Absolute camera failure:", e2);
          }
        }
      } else if (!isCameraActive && previewVideoRef.current) {
        previewVideoRef.current.srcObject = null;
      }
    };
    startCam();
    return () => {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
    };
  }, [isCameraActive, selectedCamera]);

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
          ) : (activeSong.type === 'image' || activeSong.type === 'video' || activeSong.type === 'document' || activeSong.type === 'audio' || activeSong.type === 'youtube' || activeSong.type === 'link') ? (
             <div className="group flex flex-col items-center justify-center bg-[#36393f] hover:bg-[#4752c4] text-gray-300 hover:text-white rounded cursor-pointer transition border border-transparent hover:border-[#5865f2] overflow-hidden p-6 gap-3" onClick={() => onProject(activeSong, 0)}>
                <div className="flex items-center gap-2">
                   {activeSong.type === 'audio' && <Headphones size={24} className="animate-bounce" />}
                   {activeSong.type === 'youtube' && <Youtube size={24} className="text-red-500" />}
                   {activeSong.type === 'link' && <Globe size={24} className="text-blue-400" />}
                   <div className="font-bold text-lg text-center">Projeter l'élément</div>
                </div>
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

      <div className={`aspect-video bg-[#18191c] border-t-2 border-[#5865f2] relative overflow-hidden group/monitor ${isContentHidden ? 'opacity-50' : ''}`}>
         {/* Live Monitor View */}
         <div className="absolute top-1 left-2 z-30 text-[8px] font-black text-white/40 tracking-widest uppercase pointer-events-none">Ecran de Presentation</div>
         {isContentHidden && <div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center text-[8px] font-bold text-red-500 uppercase tracking-widest">Contenu Masqué</div>}
         
         {/* Background — always visible */}
         <div className="absolute inset-0 z-0">
            {bgImage?.match(/\.(mp4|webm|ogg|mov|mkv|avi|m4v)(\?.*)?$/i) ? (
               <video key={bgImage} src={cleanUrl(bgImage)} autoPlay loop muted playsInline className="w-full h-full object-cover" />
            ) : bgImage ? (
               <img src={cleanUrl(bgImage)} className="w-full h-full object-cover" alt="Background" />
            ) : (
               <div className="w-full h-full bg-black" />
            )}
         </div>
 
        {/* Camera Feed */}
        {isCameraActive && (
           <video ref={previewVideoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover z-10 bg-black" />
        )}

        {/* Clock & Ticker Previews */}
        <div className="absolute inset-0 z-40 pointer-events-none transform scale-[0.3] origin-top-right">
           {clock?.enabled && (
              <div className="absolute top-4 right-4 bg-black/60 text-white p-2 rounded text-2xl font-mono border-4 border-white/40">
                 {currentTime.toLocaleTimeString()}
              </div>
           )}
        </div>

        {ticker?.enabled && (
          <div className="absolute bottom-0 left-0 right-0 z-30 bg-black/40 h-4 flex items-center overflow-hidden border-t border-white/10">
             <div className="whitespace-nowrap text-[6px] text-white animate-pulse px-2">{ticker.text}</div>
          </div>
        )}

         {/* Content overlay — only when projecting */}
         {!isBaseScreenProjected && projectedSong && (
            <div className="absolute inset-0 flex items-center justify-center flex-col p-4 z-20">
               {['image', 'video', 'document', 'audio', 'youtube', 'link'].includes(projectedSong.type) ? (
                  <div className="w-full h-full flex items-center justify-center z-20 absolute inset-0 bg-black">
                     {projectedSong.type === 'image' && <img src={cleanUrl(projectedSong.lyrics)} className="w-full h-full object-contain" alt="Media" />}
                     {projectedSong.type === 'video' && <video key={projectedSong.lyrics} src={cleanUrl(projectedSong.lyrics)} className="w-full h-full object-contain" autoPlay muted playsInline preload="auto" />}
                     {projectedSong.type === 'audio' && (
                       <div className="flex flex-col items-center gap-1">
                          <Headphones size={16} className="text-green-400 animate-pulse" />
                          <span className="text-[6px] text-gray-500">Projecté en Audio...</span>
                       </div>
                     )}
                     {projectedSong.type === 'youtube' && (
                        <div className="w-full h-full bg-black flex flex-col items-center justify-center gap-1">
                           <Youtube size={16} className="text-red-500" />
                           <span className="text-[6px] text-white">Prêt pour YouTube</span>
                        </div>
                     )}
                     {projectedSong.type === 'link' && (
                        <div className="w-full h-full bg-white flex flex-col items-center justify-center gap-1">
                           <Globe size={16} className="text-blue-500" />
                           <span className="text-[6px] text-gray-800">Lien Web</span>
                        </div>
                     )}
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
         )}

         {/* Media Overlay Mirror (Images/Vidéos globales) */}
         {!isBaseScreenProjected && mediaOverlay && mediaOverlay.url && (
            <div className="absolute inset-0 z-30 bg-black flex items-center justify-center">
               {mediaOverlay.type === 'image' && <img src={cleanUrl(mediaOverlay.url)} className="w-full h-full object-contain" alt="Overlay" />}
               {mediaOverlay.type === 'video' && <video key={mediaOverlay.url} src={cleanUrl(mediaOverlay.url)} className="w-full h-full object-contain" autoPlay muted loop />}
            </div>
         )}

         {/* Base screen label when not projecting */}
         {isBaseScreenProjected && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10 pointer-events-none">
               <span className="text-[8px] text-white/30 font-bold uppercase tracking-widest bg-black/40 px-2 py-1 rounded">Écran de Base</span>
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
