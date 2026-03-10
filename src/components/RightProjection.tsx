import { useState, useEffect } from 'react';
import { Check, Star, AlertCircle, Cast } from 'lucide-react';

export function RightProjection({ activeSong, bgImage, textSettings, isLiveActive, isBibleView, activeVerseIdx, setActiveVerseIdx, getComputedSettingsForVerse, isBaseScreenProjected, setIsBaseScreenProjected }: any) {

  const verses = activeSong?.lyrics?.split('\n\n') || [];
  const [currentLines, setCurrentLines] = useState<string[]>([]);
  
  // Reset and auto-jump when song changes
  useEffect(() => {
    let initialLines = verses.length > 0 ? verses[0].split('\n') : [];
    let initialIdx = 0;

    if (activeSong?.startVerse) {
      const targetIdx = verses.findIndex((v: string) => {
        const match = v.match(/^(\d+)/);
        return match && parseInt(match[1]) === parseInt(activeSong.startVerse);
      });
      if (targetIdx !== -1) {
        initialIdx = targetIdx;
        initialLines = verses[targetIdx].split('\n');
        setTimeout(() => {
          document.getElementById(`verse-${targetIdx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
      }
    }

    setCurrentLines(initialLines);
    setActiveVerseIdx(initialIdx);
    
    // Auto emit if requested by search
    if (activeSong?.startVerse && isLiveActive) {
      const isBible = isBibleView;
      const refMatch = initialLines.length > 0 ? initialLines[0].match(/^(\d+)/) : null;
      let reference = "";
      if (isBible && refMatch) {
         reference = `${activeSong.title}:${refMatch[1]}`;
      } else if (!isBible && activeSong?.title) {
         reference = `(${activeSong.title})`;
      }
      localStorage.setItem('live_lyrics', JSON.stringify({ lines: initialLines, reference, isBible }));
      import('@tauri-apps/api/event').then(({ emit }) => {
        emit('update_live_lyrics', { lines: initialLines, reference, isBible }).catch(console.error);
        
        const styleConfig = getComputedSettingsForVerse(activeSong, initialIdx);
        localStorage.setItem('live_style', JSON.stringify(styleConfig.textSettings));
        localStorage.setItem('live_bg', styleConfig.bgImage);
        emit('update_live_style', styleConfig.textSettings).catch(console.error);
        emit('update_live_bg', styleConfig.bgImage).catch(console.error);
      });
    }
  }, [activeSong]);
  
  // Raccourcis clavier (Haut / Bas) pour changer de strophe
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (!verses || verses.length === 0) return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        let newIdx = activeVerseIdx;
        if (e.key === 'ArrowUp' && activeVerseIdx > 0) newIdx--;
        if (e.key === 'ArrowDown') {
           if (activeVerseIdx < verses.length - 1) {
              newIdx++;
           } else {
              setIsBaseScreenProjected(true);
              localStorage.setItem('live_lyrics', JSON.stringify({ lines: [] }));
              localStorage.removeItem('live_media');
              import('@tauri-apps/api/event').then(async ({ emit }) => {
                 await emit('update_live_lyrics', { lines: [] });
                 await emit('update_live_media', null);
              });
              return;
           }
        }
        
        if (newIdx !== activeVerseIdx) {
          setActiveVerseIdx(newIdx);
          const lines = verses[newIdx].split('\n');
          setCurrentLines(lines);
          const isBible = isBibleView;
          const refMatch = lines.length > 0 ? lines[0].match(/^(\d+)/) : null;
          let reference = "";
          if (isBible && refMatch) {
             reference = `${activeSong.title}:${refMatch[1]}`;
          } else if (!isBible && activeSong?.title) {
             reference = `(${activeSong.title})`;
          }
          localStorage.setItem('live_lyrics', JSON.stringify({ lines, reference, isBible }));
          const { emit } = await import('@tauri-apps/api/event');
          await emit('update_live_lyrics', { lines, reference, isBible });

          const styleConfig = getComputedSettingsForVerse(activeSong, newIdx);
          localStorage.setItem('live_style', JSON.stringify(styleConfig.textSettings));
          localStorage.setItem('live_bg', styleConfig.bgImage);
          await emit('update_live_style', styleConfig.textSettings);
          await emit('update_live_bg', styleConfig.bgImage);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeVerseIdx, verses]);

  return (
    <div className="w-96 bg-[#202225] h-full flex flex-col border-l border-[#18191c]">
      
      {/* Liste des Diapositives (Strophes, Refrains) */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        {/* Titre du chant affiché a droite */}
        <div className="bg-[#5865f2] p-2 flex items-center gap-2 shadow-md">
           <Cast className="text-white" size={16} />
           <span className="text-white font-bold text-sm truncate">{activeSong ? activeSong.title : "Aucun chant sélectionné"}</span>
        </div>

        {/* Liste détaillée des strophes projetables */}
        <div className="flex-1 p-2 space-y-1 bg-[#2f3136] overflow-y-auto">
          {!activeSong ? (
             <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-2">
                <AlertCircle size={32} />
                <p className="text-xs text-center">Sélectionnez un chant pour projeter ses couplets</p>
             </div>
          ) : (activeSong.type === 'image' || activeSong.type === 'video' || activeSong.type === 'document') ? (
             <div 
               className="group flex flex-col items-center justify-center bg-[#36393f] hover:bg-[#4752c4] text-gray-300 hover:text-white rounded cursor-pointer transition border border-transparent hover:border-[#5865f2] overflow-hidden p-6 gap-3"
               onClick={async () => {
                 try {
                   setIsBaseScreenProjected(false);
                   const { emit } = await import('@tauri-apps/api/event');
                   const payload = { type: activeSong.type, url: activeSong.lyrics };
                   localStorage.setItem('live_media', JSON.stringify(payload));
                   localStorage.removeItem('live_lyrics');
                   await emit('update_live_media', payload);
                 } catch (e) { console.error(e) }
               }}
             >
                <div className="font-bold text-lg text-center">
                   Projeter {activeSong.type === 'image' ? "l'Image" : activeSong.type === 'video' ? "la Vidéo" : "le Document"}
                </div>
                <div className="text-xs opacity-70 text-center bg-black/20 p-2 rounded max-w-full truncate">
                  {activeSong.title}
                </div>
             </div>
          ) : verses.map((verse: string, idx: number) => {
             // Détection rudimentaire Refrain/Strophe basée sur le contenu
             const isRefrain = verse.toLowerCase().includes('refrain') || idx === 1;
             const label = isRefrain ? 'R' : `S${idx + 1}`;
              const verseNumberMatch = verse.match(/^(\d+)/);
              const verseNum = verseNumberMatch ? parseInt(verseNumberMatch[1]) : idx + 1;
              
              const isHighlightRange = activeSong?.startVerse && 
                                       verseNum >= parseInt(activeSong.startVerse) && 
                                       (!activeSong.endVerse || verseNum <= parseInt(activeSong.endVerse));
                                       
              const isActive = idx === activeVerseIdx || isHighlightRange;
              const bgClass = isActive ? "bg-[#4752c4] border-[#5865f2]" : "bg-[#36393f] border-transparent";
             
             // Strip HTML tags if any (e.g. <i>, <b>)
             const displayVerse = verse.replace(/<\/?[^>]+(>|$)/g, "");
             return (
              <div 
                id={`verse-${idx}`}
                key={idx} 
                className={`group flex ${bgClass} hover:bg-[#4752c4] text-gray-300 hover:text-white rounded cursor-pointer transition border hover:border-[#5865f2] overflow-hidden`}
                onClick={async () => {
                  try {
                    setIsBaseScreenProjected(false);
                    const { emit } = await import('@tauri-apps/api/event');
                    const lines = verse.split('\n');
                    setCurrentLines(lines);
                    setActiveVerseIdx(idx);
                    
                    const isBible = isBibleView;
                    const refMatch = lines.length > 0 ? lines[0].match(/^(\d+)/) : null;
                    let reference = "";
                    if (isBible && refMatch) {
                       reference = `${activeSong.title}:${refMatch[1]}`;
                    } else if (!isBible && activeSong?.title) {
                       reference = `(${activeSong.title})`;
                    }

                    localStorage.setItem('live_lyrics', JSON.stringify({ lines, reference, isBible }));
                    await emit('update_live_lyrics', { lines, reference, isBible });

                    const styleConfig = getComputedSettingsForVerse(activeSong, idx);
                    localStorage.setItem('live_style', JSON.stringify(styleConfig.textSettings));
                    localStorage.setItem('live_bg', styleConfig.bgImage);
                    await emit('update_live_style', styleConfig.textSettings);
                    await emit('update_live_bg', styleConfig.bgImage);
                  } catch (e) {
                    console.error("Failed to emit", e);
                  }
                }}
              >
                {/* Icône de type (S1, R) */}
                <div className="w-8 flex items-center justify-center bg-[#202225] group-hover:bg-[#3a439c] text-[10px] font-bold border-r border-[#2f3136] group-hover:border-[#3a439c]">
                   {isRefrain ? <Star size={10} className="text-yellow-500" /> : label}
                </div>
                {/* Contenu de la diapo */}
                <div className="flex-1 p-2">
                   <p className="text-xs leading-snug font-medium line-clamp-3 whitespace-pre-line group-hover:font-semibold" dangerouslySetInnerHTML={{ __html: displayVerse }} />
                </div>
                {/* Indicateur Projection Directe */}
                <div className="w-8 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                    <Check size={14} className="text-green-400" />
                </div>
              </div>
             )
          })}
        </div>
      </div>

      {/* Rendu LIVE PREVIEW (Moniteur) */}
      <div className="aspect-video bg-[#18191c] border-t-2 border-[#5865f2] relative group overflow-hidden">
         {bgImage?.match(/\.(mp4|webm|ogg|mov|mkv|avi|m4v)(\?.*)?$/i) ? (
            <video key={bgImage} src={bgImage} autoPlay loop muted playsInline className="absolute inset-0 w-full h-full object-cover opacity-80" />
         ) : (
            <img src={bgImage} className="absolute inset-0 w-full h-full object-cover opacity-80" alt="Background" />
         )}
         
         {/* Live Text Mockup */}
         <div className="absolute inset-0 flex items-center justify-center flex-col p-4 z-10 w-full h-full relative">
            {isBaseScreenProjected ? (
               <div className="flex-1"></div>
            ) : activeSong && ['image', 'video', 'document'].includes(activeSong.type) ? (
               <div className="w-full h-full flex items-center justify-center z-20 absolute inset-0 bg-black">
                 {activeSong.type === 'image' && <img src={activeSong.lyrics} className="w-full h-full object-contain" alt="Media" />}
                 {activeSong.type === 'video' && <video src={activeSong.lyrics} className="w-full h-full object-contain" controls autoPlay muted playsInline />}
                 {activeSong.type === 'document' && <iframe src={activeSong.lyrics} className="w-full h-full border-none bg-white" title="Document" />}
               </div>
            ) : activeSong ? (() => {
               const isBible = isBibleView;
               let displayLines = currentLines;
               let reference = "";
               
               if (isBible && displayLines.length > 0) {
                 const refMatch = displayLines[0].match(/^(\d+)/);
                 if (refMatch) {
                   reference = `${activeSong.title}:${refMatch[1]}`;
                   displayLines = displayLines.slice(1);
                 }
               } else if (!isBible && activeSong?.title) {
                 reference = `(${activeSong.title})`;
               }

               return (
                <div 
                   className="flex flex-col justify-center space-y-1 w-full relative h-full"
                   style={{ 
                     fontFamily: textSettings?.fontFamily,
                     textAlign: textSettings?.align as any,
                   }}
                >
                   {isBible && reference && (
                      <div className="absolute top-0 right-0 text-white/80 font-bold text-[10px] md:text-sm drop-shadow-md">
                        {reference}
                      </div>
                   )}
                   <div className="flex-1 flex flex-col justify-center">
                     {displayLines.map((line, i) => (
                       <p 
                         key={i} 
                         className={`text-white font-bold drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)] ${textSettings?.isItalic ? 'italic' : ''} ${textSettings?.isUnderline ? 'underline' : ''}`}
                         style={{ 
                           fontWeight: textSettings?.isBold ? 'bold' : 'normal',
                           fontSize: `${(textSettings?.fontSize || 100) / 100}em`,
                         }}
                         dangerouslySetInnerHTML={{ __html: line.replace(/<\/?[^>]+(>|$)/g, "") }}
                       />
                     ))}
                   </div>
                   {!isBible && reference && (
                      <div className="absolute bottom-0 pb-1 left-0 right-0 text-center text-white/50 font-medium text-[8px] md:text-[10px] drop-shadow-md">
                        {reference}
                      </div>
                   )}
                </div>
               );
            })() : (
               <p className="text-white/50 text-xs flex-1 flex items-center justify-center">Aperçu du direct</p>
            )}
         </div>

         {isLiveActive && (
           <div className="absolute top-2 left-2 bg-red-600 text-white text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider animate-pulse flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-white rounded-full"></span> Live
           </div>
         )}
      </div>
    </div>
  );
}
