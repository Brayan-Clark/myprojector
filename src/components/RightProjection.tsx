import { useState, useEffect, useRef } from 'react';
import { Star, AlertCircle, Presentation, MonitorOff, Headphones, Youtube, Globe, FileText } from 'lucide-react';

export function RightProjection({ 
  activeSong, projectedSong, projectedVerseIdx, bgImage, textSettings, 
  isLiveActive, activeVerseIdx, setActiveVerseIdx, onProject, isBaseScreenProjected, 
  setIsBaseScreenProjected, ticker, clock, isContentHidden, isCameraActive, selectedCamera, currentTime,
  overlayColor
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
        
        // ← FIN DE PRÉSENTATION: si on est au dernier verset et on appuie sur Bas → retour à l'écran de base
        if (e.key === 'ArrowDown' && activeVerseIdx === verses.length - 1 && !isBaseScreenProjected) {
          setIsBaseScreenProjected(true);
          return;
        }

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

  const previewStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const startCam = async () => {
      // Stop logic
      if (previewStreamRef.current) {
        previewStreamRef.current.getTracks().forEach(t => t.stop());
        previewStreamRef.current = null;
      }

      if (!isCameraActive) {
        if (previewVideoRef.current) previewVideoRef.current.srcObject = null;
        return;
      }

      // LINUX SPECIFIC: If Live window is open, we MUST release the camera in preview
      // because Linux (V4L2) doesn't allow shared camera access between webviews easily.
      const isLinux = navigator.userAgent.toLowerCase().includes('linux');
      if (isLinux && isLiveActive) {
        console.log("RightProjection: Linux detected and Live active. Stopping preview to free camera.");
        if (previewVideoRef.current) previewVideoRef.current.srcObject = null;
        return;
      }

      const constraints: MediaStreamConstraints[] = [];
      if (selectedCamera && selectedCamera.trim() !== "" && selectedCamera !== "default") {
        constraints.push({ video: { deviceId: { ideal: selectedCamera } } });
      }
      constraints.push({ video: true }); 

      for (const constraint of constraints) {
        try {
          console.log("RightProjection: Attempting camera start:", JSON.stringify(constraint));
          const stream = await navigator.mediaDevices.getUserMedia(constraint);
          previewStreamRef.current = stream;
          if (previewVideoRef.current) {
            previewVideoRef.current.srcObject = stream;
            try {
               await previewVideoRef.current.play();
            } catch (pErr) {}
          }
          return;
        } catch (e: any) {
          console.warn(`RightProjection: Camera failed:`, e.name);
        }
      }
    };

    startCam();
    return () => {
      if (previewStreamRef.current) {
        previewStreamRef.current.getTracks().forEach(t => t.stop());
        previewStreamRef.current = null;
      }
    };
  }, [isCameraActive, selectedCamera, isLiveActive]);

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

      {/* ==== MINI PREVIEW — Exact mirror of LiveView ==== */}
      <div className="aspect-video bg-[#18191c] border-t-2 border-[#5865f2] relative overflow-hidden group/monitor">
         {/* Label */}
         <div className="absolute top-1 left-2 z-30 text-[8px] font-black text-white/40 tracking-widest uppercase pointer-events-none">Ecran de Presentation</div>

         {/* Background — always visible (same as LiveView) */}
         <div className="absolute inset-0 z-0">
            {bgImage?.match(/\.(mp4|webm|ogg|mov|mkv|avi|m4v)(\?.*)?$/i) ? (
               <video key={bgImage} src={cleanUrl(bgImage)} autoPlay loop muted playsInline className="w-full h-full object-cover" style={{ display: 'block' }} />
            ) : bgImage ? (
               <img src={cleanUrl(bgImage)} className="w-full h-full object-cover" alt="Background" />
            ) : (
               <div className="w-full h-full bg-black" />
            )}
         </div>

         {/* Camera Feed - Z-INDEX 5 (consistent with LiveView) */}
         {isCameraActive && (
            <video ref={previewVideoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover z-[5] bg-black" style={{ display: 'block' }} />
         )}

         {/* Content overlay — only when projecting */}
         {!isBaseScreenProjected && projectedSong && (
            <div className="absolute inset-0 flex items-center justify-center flex-col p-4 z-20">
               {['image', 'video', 'document', 'audio', 'youtube', 'link'].includes(projectedSong.type) ? (
                  <div className="w-full h-full flex items-center justify-center z-20 absolute inset-0 bg-black">
                     {projectedSong.type === 'image' && <img src={cleanUrl(projectedSong.lyrics)} className="w-full h-full object-contain" alt="Media" />}
                     {projectedSong.type === 'video' && <video key={projectedSong.lyrics} src={cleanUrl(projectedSong.lyrics)} className="w-full h-full object-contain" autoPlay muted playsInline preload="auto" style={{ display: 'block' }} />}
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
                     {projectedSong.type === 'document' && (
                        <div className="w-full h-full bg-white flex flex-col items-center justify-center gap-1">
                           <FileText size={16} className="text-gray-400" />
                           <span className="text-[5px] text-gray-500 uppercase font-bold">Document</span>
                           <span className="text-[4px] text-gray-400 truncate max-w-[80%]">{projectedSong.title}</span>
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

         {/* BASE screen: show only background label */}
         {isBaseScreenProjected && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10 pointer-events-none">
               <span className="text-[8px] text-white/30 font-bold uppercase tracking-widest bg-black/40 px-2 py-1 rounded">Écran de Base</span>
               {navigator.userAgent.toLowerCase().includes('linux') && isLiveActive && isCameraActive && (
                 <span className="text-[6px] text-orange-400 bg-black/60 px-1 rounded">Aperçu coupé (Priorité Live sur Linux)</span>
               )}
            </div>
         )}

         {/* ===== OVERLAYS SYNCHRONISÉS AVEC LIVEVIEW ===== */}

         {/* Overlay Contenu Masqué */}
         {isContentHidden && (
            <div className="absolute inset-0 z-[45] bg-black/90 flex items-center justify-center">
               <span className="text-[8px] font-bold text-red-400 uppercase tracking-widest">Contenu Masqué</span>
            </div>
         )}

         {/* Overlay Noir / Blanc (écran noir ou blanc) */}
         {overlayColor && (
            <div className={`absolute inset-0 z-[48] ${overlayColor === 'black' ? 'bg-black' : 'bg-white'} flex items-center justify-center`}>
               <span className={`text-[8px] font-bold uppercase tracking-widest ${overlayColor === 'black' ? 'text-white/40' : 'text-black/40'}`}>
                  {overlayColor === 'black' ? 'ÉCRAN NOIR' : 'ÉCRAN BLANC'}
               </span>
            </div>
         )}

         {/* Clock preview */}
         {clock?.enabled && (
            <div className="absolute top-1 right-1 z-40 bg-black/60 text-white px-1 rounded text-[6px] font-mono border border-white/20">
               {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
         )}

         {/* Ticker preview */}
         {ticker?.enabled && ticker?.message && (
            <div className={`absolute ${ticker.position === 'top' ? 'top-0' : 'bottom-0'} left-0 right-0 z-30 bg-black/60 flex items-center overflow-hidden border-y border-white/10 py-0.5`}>
               <span className="whitespace-nowrap text-[5px] text-yellow-300 font-bold px-2 animate-pulse">{ticker.message}</span>
            </div>
         )}

         {/* LIVE indicator */}
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
