import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

export function LiveView() {
  const [lines, setLines] = useState<string[]>([]);
  const [reference, setReference] = useState<string>("");
  const [isBible, setIsBible] = useState<boolean>(true);
  const [bgImage, setBgImage] = useState<string>(() => localStorage.getItem('live_bg') || "http://localhost:1420/backgrounds/pexels-m-venter-79250-1659437.jpg");
  const [textSettings, setTextSettings] = useState<any>(() => JSON.parse(localStorage.getItem('live_style') || '{}') || {
    fontFamily: 'Inter',
    fontSize: 100,
    isBold: true,
    isItalic: false,
    isUnderline: false,
    align: 'center',
    color: '#ffffff'
  });

  useEffect(() => {
    // Rend cette fenêtre toujours au-dessus et en plein écran au démarrage (optionnel mais utile pour un projecteur)
    const initWindow = async () => {
      try {
        const win = getCurrentWindow();
        await win.setFullscreen(true);
      } catch (e) {
        console.error("Erreur de fenetre", e);
      }
      
      try {
         // Restore lyrics from localstorage if present
         const savedLyrics = localStorage.getItem('live_lyrics');
         if (savedLyrics) {
            const data = JSON.parse(savedLyrics);
            setLines(data.lines || []);
            setReference(data.reference || "");
            setIsBible(data.isBible || false);
         }
      } catch (e) {
         console.error(e);
      }
    };
    initWindow();

    // On écoute les événements provenant de la fenêtre principale
    const unlistenLyrics = listen<any>("update_live_lyrics", (event) => {
      const payloadLines = event.payload.lines || [];
      const ref = event.payload.reference || "";
      const isBib = event.payload.isBible || false;
      setReference(ref);
      setIsBible(isBib);
      
      // If there's a reference and the first line is just a number, strip it
      if (isBib && ref && payloadLines.length > 0 && /^\d+$/.test(payloadLines[0].trim())) {
        setLines(payloadLines.slice(1));
      } else {
        setLines(payloadLines);
      }
    });

    const unlistenBg = listen<string>("update_live_bg", (event) => {
      setBgImage(event.payload);
    });

    const unlistenStyle = listen<any>("update_live_style", (event) => {
      setTextSettings(event.payload);
    });

    return () => {
      unlistenLyrics.then(f => f());
      unlistenBg.then(f => f());
      unlistenStyle.then(f => f());
    };
  }, []);

  return (
    <div className="w-screen h-screen bg-black overflow-hidden relative">
      {bgImage?.match(/\.(mp4|webm|ogg|mov|mkv|avi|m4v)(\?.*)?$/i) ? (
        <video key={bgImage} src={bgImage} autoPlay loop muted playsInline preload="auto" className="absolute inset-0 w-full h-full object-cover">
        </video>
      ) : (
        <img src={bgImage} className="absolute inset-0 w-full h-full object-cover" alt="fond d'écran" />
      )}
      {isBible && reference && (
         <div className="absolute top-8 right-12 z-20 text-white/80 font-bold text-3xl drop-shadow-md">
            {reference}
         </div>
      )}
      {!isBible && reference && (
         <div className="absolute bottom-0 pb-1 left-0 right-0 z-20 text-center text-white/50 font-medium text-xl drop-shadow-md pb-2">
            {reference}
         </div>
      )}

      {/* Texte projeté */}
      <div 
        className="absolute inset-0 flex items-center justify-center flex-col p-12 z-10 w-full h-full relative"
        style={{ 
          fontFamily: textSettings?.fontFamily,
          textAlign: textSettings?.align as any,
          alignItems: textSettings?.align === 'center' ? 'center' : textSettings?.align === 'left' ? 'flex-start' : 'flex-end',
        }}
      >
        <div className="flex-1 flex flex-col justify-center w-full">
          {lines.map((line, i) => (
            <p 
               key={i} 
               className={`text-white font-bold w-full drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)] ${textSettings?.isItalic ? 'italic' : ''} ${textSettings?.isUnderline ? 'underline' : ''}`} 
               style={{ 
                 fontWeight: textSettings?.isBold ? 'bold' : 'normal',
                 fontSize: `${(textSettings?.fontSize || 100) / 100 * 6}vh`,
                 lineHeight: '1.4'
               }}
               dangerouslySetInnerHTML={{ __html: line.replace(/<\/?[^>]+(>|$)/g, "") }}
            />
          ))}
        </div>
      </div>

      {lines.length === 0 && (
         <div className="absolute inset-0 bg-black/60 z-20 transition-opacity duration-1000"></div>
      )}
    </div>
  );
}
