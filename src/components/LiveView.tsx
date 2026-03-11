import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

export function LiveView() {
  const [lines, setLines] = useState<string[]>([]);
  const [reference, setReference] = useState<string>("");
  const [isBible, setIsBible] = useState<boolean>(true);
  const [bgImage, setBgImage] = useState<string>(() => localStorage.getItem('live_bg') || "/backgrounds/sunset.jpg");
  const [mediaOverlay, setMediaOverlay] = useState<{type: string, url: string} | null>(() => {
    const saved = localStorage.getItem('live_media');
    return saved ? JSON.parse(saved) : null;
  });
  const [isContentHidden, setIsContentHidden] = useState<boolean>(false);
  const [overlayColor, setOverlayColor] = useState<'black' | 'white' | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraDeviceId, setCameraDeviceId] = useState<string>("");

  const [textSettings, setTextSettings] = useState<any>(() => {
    const saved = localStorage.getItem('live_style');
    const defaults = {
      fontFamily: 'Inter',
      fontSize: 100,
      isBold: true, align: 'center', valign: 'middle', color: '#ffffff',
      lineHeight: 1.4,
      contentWidth: 100
    };
    if (!saved) return defaults;
    try {
      const parsed = JSON.parse(saved);
      return Object.keys(parsed).length === 0 ? defaults : parsed;
    } catch(e) { return defaults; }
  });

  const cleanUrl = (url: string) => {
    if (!url) return "";
    try {
      return decodeURIComponent(url);
    } catch(e) {
      return url;
    }
  };

  useEffect(() => {
    const initWindow = async () => {
      try {
        const win = getCurrentWindow();
        await win.setFullscreen(true);
      } catch (e) { console.error(e); }
      
      try {
         const savedLyrics = localStorage.getItem('live_lyrics');
         if (savedLyrics) {
            const data = JSON.parse(savedLyrics);
            setLines(data.lines || []);
            setReference(data.reference || "");
            setIsBible(data.isBible || false);
         }
      } catch (e) { console.error(e); }

      // Signal that we are ready to receive data
      import('@tauri-apps/api/event').then(({ emit }) => {
        emit('live_ready');
      });
    };
    initWindow();

    const unlistens = [
      listen<any>("update_live_content", (event) => {
        const { lyrics, media } = event.payload;
        console.log("Atomic Content Update:", event.payload);
        
        // 1. Update Media
        setMediaOverlay(media);
        
        // 2. Update Lyrics
        if (media) {
           setLines([]);
           setReference("");
           setIsBible(false);
        } else {
           const payloadLines = lyrics.lines || [];
           const ref = lyrics.reference || "";
           const isBib = !!lyrics.isBible;
           
           setReference(ref);
           setIsBible(isBib);
           
           let finalLines = payloadLines;
           if (isBib && ref && finalLines.length > 1) {
              if (/^\d+$/.test(finalLines[0].trim())) {
                 finalLines = finalLines.slice(1);
              }
           }
           setLines(finalLines);
        }
      }),
      listen<string>("update_live_bg", (event) => setBgImage(event.payload)),
      listen<any>("update_live_style", (event) => {
        console.log("Received style:", event.payload);
        setTextSettings(event.payload);
      }),
      listen<boolean>("update_live_hide_content", (event) => setIsContentHidden(event.payload)),
      listen<'black'|'white'|null>("update_live_overlay", (event) => setOverlayColor(event.payload)),
      listen<boolean>("toggle_live_camera", (event) => setIsCameraActive(event.payload)),
      listen<string>("set_camera_id", (event) => setCameraDeviceId(event.payload))
    ];

    return () => {
      unlistens.forEach(u => u.then(f => f()));
    };
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    const startCam = async () => {
       if (isCameraActive) {
          try {
             const constraints = { 
               video: cameraDeviceId ? { deviceId: { exact: cameraDeviceId }, width: 1920, height: 1080 } : { width: 1920, height: 1080 } 
             };
             stream = await navigator.mediaDevices.getUserMedia(constraints);
             const vid = document.getElementById('live-camera-feed') as HTMLVideoElement;
             if (vid) vid.srcObject = stream;
          } catch (e) { 
             console.error(e); 
             // Fallback if ID fails
             if (cameraDeviceId) {
                try {
                  stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1920, height: 1080 } });
                  const vid = document.getElementById('live-camera-feed') as HTMLVideoElement;
                  if (vid) vid.srcObject = stream;
                } catch(e2) { setIsCameraActive(false); }
             } else { setIsCameraActive(false); }
          }
       }
    };
    startCam();
    return () => {
       if (stream) {
          stream.getTracks().forEach(t => t.stop());
       }
    };
  }, [isCameraActive, cameraDeviceId]);

  useEffect(() => {
    if (mediaOverlay && mediaOverlay.type === 'document') {
      const isText = mediaOverlay.url.match(/\.(txt|md)(\?.*)?$/i);
      if (isText) {
        fetch(mediaOverlay.url).then(r => r.text()).then(setTextContent).catch(() => setTextContent(null));
      } else { setTextContent(null); }
    } else { setTextContent(null); }
  }, [mediaOverlay]);

  return (
    <div className="w-screen h-screen bg-black overflow-hidden relative">
      {isCameraActive ? (
        <video id="live-camera-feed" autoPlay playsInline className="absolute inset-0 w-full h-full object-cover z-0"></video>
      ) : bgImage?.match(/\.(mp4|webm|ogg|mov|mkv|avi|m4v)(\?.*)?$/i) ? (
        <video key={bgImage} src={cleanUrl(bgImage)} autoPlay loop muted playsInline preload="auto" className="absolute inset-0 w-full h-full object-cover"></video>
      ) : (
        <img src={bgImage} className="absolute inset-0 w-full h-full object-cover" alt="bg" />
      )}

      {overlayColor && <div className={`absolute inset-0 z-50 ${overlayColor === 'black' ? 'bg-black' : 'bg-white'}`}></div>}

      <div className={`absolute inset-0 w-full h-full transition-opacity duration-300 ${isContentHidden ? 'opacity-0' : 'opacity-100'}`}>
          {mediaOverlay && (
             <div className="absolute inset-0 z-30 bg-black flex items-center justify-center">
                {mediaOverlay.type === 'image' && <img src={mediaOverlay.url} className="w-full h-full object-contain" alt="Media" />}
                {mediaOverlay.type === 'video' && <video key={mediaOverlay.url} src={cleanUrl(mediaOverlay.url)} className="w-full h-full object-contain" autoPlay playsInline preload="auto" />}
                {mediaOverlay.type === 'document' && (
                  <div className="w-full h-full bg-white text-black overflow-hidden flex items-center justify-center">
                    {textContent ? <div className="p-10 whitespace-pre-wrap font-mono text-lg text-left w-full h-full overflow-y-auto">{textContent}</div> : <iframe src={cleanUrl(mediaOverlay.url)} className="w-full h-full border-none" title="Doc" />}
                  </div>
                )}
             </div>
          )}

          {reference && (
             <div className={`absolute z-20 text-white font-bold drop-shadow-lg ${isBible ? 'top-8 right-12 text-4xl' : 'bottom-4 left-0 right-0 text-center text-xl text-white/60'}`}>
                {reference}
             </div>
          )}

          <div 
            className="absolute inset-0 flex flex-col p-12 z-10 w-full h-full"
            style={{ 
              fontFamily: textSettings?.fontFamily,
              justifyContent: textSettings?.valign === 'middle' ? 'center' : textSettings?.valign === 'bottom' ? 'flex-end' : 'flex-start',
              alignItems: textSettings?.align === 'center' ? 'center' : textSettings?.align === 'left' ? 'flex-start' : 'flex-end',
            }}
          >
            <div 
              className="flex flex-col"
              style={{
                width: `${textSettings?.contentWidth || 100}%`,
                textAlign: textSettings?.align as any,
                alignItems: textSettings?.align === 'center' ? 'center' : textSettings?.align === 'left' ? 'flex-start' : 'flex-end',
              }}
            >
              {lines.map((line, i) => (
                <p 
                   key={i} 
                   className={`text-white font-bold w-full drop-shadow-[0_8px_8px_rgba(0,0,0,1)] ${textSettings?.isItalic ? 'italic' : ''} ${textSettings?.isUnderline ? 'underline' : ''}`} 
                   style={{ 
                     fontWeight: textSettings?.isBold ? 'bold' : 'normal',
                     fontSize: `${(textSettings?.fontSize || 100) / 100 * 7}vh`,
                     lineHeight: textSettings?.lineHeight || 1.4
                   }}
                   dangerouslySetInnerHTML={{ __html: line.replace(/<\/?[^>]+(>|$)/g, "") }}
                />
              ))}
            </div>
          </div>
      </div>
    </div>
  );
}
