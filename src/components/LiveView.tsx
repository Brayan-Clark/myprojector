import { useEffect, useState, memo, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FileText } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

const RenderClock = memo(({ clock, currentTime }: { clock: any, currentTime: Date }) => {
  if (!clock.enabled) return null;
  const timeStr = currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const posClasses: any = {
    'top-left': 'top-4 left-4',
    'top-right': 'top-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'bottom-right': 'bottom-4 right-4',
    'center': 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'
  };

  if (clock.type === 'analog') {
    const seconds = currentTime.getSeconds();
    const minutes = currentTime.getMinutes();
    const hours = currentTime.getHours();
    const baseSize = clock.size || 60;

    const renderTicks = () => {
      if (clock.style === 'minimal') return null;
      return [...Array(12)].map((_, i) => (
        <div key={i} className="absolute top-1/2 left-1/2 w-0.5 h-1"
          style={{
            height: clock.style === 'sport' ? '8px' : '4px',
            backgroundColor: clock.color || 'white',
            transformOrigin: 'center bottom',
            transform: `translate(-50%, -100%) rotate(${i * 30}deg) translateY(-${baseSize - 5}px)`
          }}></div>
      ));
    };

    const renderNumbers = () => {
      if (clock.style !== 'numbers') return null;
      return [12, 3, 6, 9].map((num, i) => (
        <div key={num} className="absolute font-bold text-[12px]"
          style={{
            color: clock.color || 'white',
            top: '50%',
            left: '50%',
            transform: `translate(-50%, -50%) rotate(${i * 90}deg) translateY(-${baseSize - 18}px) rotate(-${i * 90}deg)`
          }}>{num}</div>
      ));
    };

    return (
      <div className={`absolute ${posClasses[clock.position] || 'top-4 right-4'} z-50 flex items-center justify-center`}>
        <div className={`rounded-full border-${clock.style === 'sport' ? '4' : '2'} relative`}
          style={{
            width: baseSize * 2, height: baseSize * 2,
            borderColor: clock.color || 'white',
            backgroundColor: 'rgba(0,0,0,0.3)',
            boxShadow: clock.style === 'sport' ? '0 0 20px rgba(0,0,0,0.5)' : 'none'
          }}>
          {renderTicks()}
          {renderNumbers()}
          {/* Hour hand */}
          <div className="absolute rounded-full"
            style={{
              bottom: '50%',
              left: '50%',
              width: '4px',
              height: baseSize * 0.55,
              backgroundColor: clock.color || 'white',
              transformOrigin: 'bottom center',
              transform: `translateX(-50%) rotate(${hours * 30 + minutes * 0.5}deg)`
            }}></div>
          {/* Minute hand */}
          <div className="absolute rounded-full"
            style={{
              bottom: '50%',
              left: '50%',
              width: '3px',
              height: baseSize * 0.8,
              backgroundColor: clock.color || 'white',
              transformOrigin: 'bottom center',
              transform: `translateX(-50%) rotate(${minutes * 6}deg)`
            }}></div>
          {/* Second hand */}
          <div className="absolute bg-red-500"
            style={{
              bottom: '50%',
              left: '50%',
              width: '1.5px',
              height: baseSize * 0.9,
              transformOrigin: 'bottom center',
              transform: `translateX(-50%) rotate(${seconds * 6}deg)`
            }}></div>
          <div className="absolute top-1/2 left-1/2 w-2 h-2 rounded-full bg-white -translate-x-1/2 -translate-y-1/2" style={{ backgroundColor: clock.color || 'white' }}></div>
        </div>
      </div>
    );
  }

  const clockStyle = {
    color: clock.color || 'white',
    fontSize: `${clock.size || 60}px`,
    fontFamily: clock.style === 'classic' ? 'serif' : clock.style === 'neon' ? 'system-ui' : 'monospace',
    textShadow: clock.style === 'neon' ? `0 0 10px ${clock.color || 'white'}, 0 0 20px ${clock.color || 'white'}` : '0 2px 10px rgba(0,0,0,0.8)',
    background: clock.style === 'modern' ? 'rgba(0,0,0,0.3)' : 'transparent',
    backdropFilter: clock.style === 'modern' ? 'blur(5px)' : 'none',
    padding: clock.style === 'modern' ? '0.5rem 1rem' : '0',
    borderRadius: '0.5rem'
  };

  return (
    <div className={`absolute ${posClasses[clock.position] || 'top-4 right-4'} z-50`} style={clockStyle}>
      {timeStr}
    </div>
  );
});

const RenderTicker = memo(({ ticker }: { ticker: any }) => {
  if (!ticker.enabled || !ticker.message) return null;

  const hexToRgba = (hex: string, opacity: number) => {
    let r = 0, g = 0, b = 0;
    const h = hex.replace('#', '');
    if (h.length === 6) {
      r = parseInt(h.slice(0, 2), 16);
      g = parseInt(h.slice(2, 4), 16);
      b = parseInt(h.slice(4, 6), 16);
    }
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  };

  const bgColor = hexToRgba(ticker.bgColor || '#000000', ticker.bgOpacity ?? 0.7);

  const calculateDuration = () => {
    const msg = ticker.message || "";
    const fontSize = ticker.fontSize || 28;
    // Estimate message width (approx 0.6em per char) + screen width
    const estimatedMsgWidth = msg.length * fontSize * 0.6;
    const screenWidth = window.innerWidth;
    const totalDistance = screenWidth + estimatedMsgWidth;
    // 100 pixels per second for a very smooth and readable scroll
    return totalDistance / 100;
  };

  return (
    <div
      className={`fixed left-0 right-0 ${ticker.position === 'top' ? 'top-0' : 'bottom-0'} z-[70] overflow-hidden w-full py-4 border-y border-white/10`}
      style={{ backgroundColor: bgColor, color: ticker.color || 'yellow', pointerEvents: 'none' }}
    >
      <div
        key={ticker.message}
        className="animate-marquee whitespace-nowrap inline-block"
        style={{
          animationDuration: `${calculateDuration()}s`,
          fontSize: `${ticker.fontSize || 28}px`,
          fontFamily: ticker.fontFamily || 'Inter',
          fontWeight: 'bold',
          textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
        }}
      >
        {ticker.message}
      </div>
    </div>
  );
});

export function LiveView() {
  const [lines, setLines] = useState<string[]>([]);
  const [reference, setReference] = useState<string>("");
  const [isBible, setIsBible] = useState<boolean>(true);
  const [bgImage, setBgImage] = useState<string>(() => localStorage.getItem('live_bg') || "/backgrounds/sunset.jpg");
  const [mediaOverlay, setMediaOverlay] = useState<{ type: string, url: string } | null>(() => {
    const saved = localStorage.getItem('live_media');
    return saved ? JSON.parse(saved) : null;
  });
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isContentHidden, setIsContentHidden] = useState<boolean>(false);
  const [overlayColor, setOverlayColor] = useState<'black' | 'white' | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraDeviceId, setCameraDeviceId] = useState<string | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);

  // New features
  const [clock, setClock] = useState<any>({ enabled: false, type: 'digital', position: 'top-right', style: 'modern' });
  const [ticker, setTicker] = useState<any>({ enabled: false, message: '', position: 'bottom' });
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

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
    } catch (e) { return defaults; }
  });

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
      listen<'black' | 'white' | null>("update_live_overlay", (event) => setOverlayColor(event.payload)),
      listen<boolean>("toggle_live_camera", (event) => setIsCameraActive(event.payload)),
      listen<string>("set_camera_id", (event) => setCameraDeviceId(event.payload)),
      listen<any>("update_live_clock", (event) => {
        setClock((prev: any) => {
          if (JSON.stringify(prev) === JSON.stringify(event.payload)) return prev;
          return event.payload;
        });
      }),
      listen<any>("update_live_ticker", (event) => {
        setTicker((prev: any) => {
          if (JSON.stringify(prev) === JSON.stringify(event.payload)) return prev;
          return event.payload;
        });
      })
    ];

    return () => {
      unlistens.forEach(u => u.then(f => f()));
    };
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    const startCam = async () => {
      if (isCameraActive && cameraVideoRef.current) {
        try {
          const constraints = cameraDeviceId 
            ? { video: { deviceId: { exact: cameraDeviceId } } }
            : { video: true };
            
          console.log("LiveView: Starting camera with:", constraints);
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (cameraVideoRef.current) {
            cameraVideoRef.current.srcObject = stream;
            cameraVideoRef.current.play().catch(e => console.warn("Video play failed:", e));
          }
        } catch (e: any) {
          console.error("Live Camera Error:", e.name, e.message);
          // Fallback to simple video:true
          try {
             console.log("LiveView: Fallback to basic video:true");
             stream = await navigator.mediaDevices.getUserMedia({ video: true });
             if (cameraVideoRef.current) {
               cameraVideoRef.current.srcObject = stream;
               cameraVideoRef.current.play().catch(() => {});
             }
          } catch (e2) {
             console.error("Live Camera critical failure:", e2);
             setIsCameraActive(false);
          }
        }
      } else if (!isCameraActive && cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = null;
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
      const isPdf = mediaOverlay.url.match(/\.pdf(\?.*)?$/i);

      if (isText) {
        const fileUrl = mediaOverlay.url;
        const appDataPath = localStorage.getItem('appDataPath');
        let fullPath = fileUrl;
        if (appDataPath && (fileUrl.startsWith('media/') || fileUrl.startsWith('/media/'))) {
           const stripped = fileUrl.startsWith('/') ? fileUrl.slice(1) : fileUrl;
           fullPath = `${appDataPath}/${stripped}`;
        }
        invoke("read_text_file", { path: fullPath })
          .then((content: any) => setTextContent(content))
          .catch(() => setTextContent(null));
      } else if (isPdf) {
        // For PDF: Load as blob to bypass "Blocked Plugin" error on Linux AppImage
        const urlToFetch = cleanUrl(mediaOverlay.url);
        if (urlToFetch) {
           fetch(urlToFetch)
            .then(r => r.blob())
            .then(blob => {
              const bolbUrl = URL.createObjectURL(blob);
              setPdfUrl(bolbUrl);
            })
            .catch(e => {
              console.error("PDF Blob error:", e);
              setPdfUrl(null);
            });
        }
      } else { setTextContent(null); setPdfUrl(null); }
    } else { setTextContent(null); setPdfUrl(null); }
    
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [mediaOverlay]);




  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black flex items-center justify-center text-white select-none">

      {/* Background Video or Image */}
      {bgImage && cleanUrl(bgImage) && (
        <div className="absolute inset-0 z-0 bg-black">
          {bgImage.match(/\.(mp4|webm|ogg|mov|mkv|avi|m4v)(\?.*)?$/i) ? (
            <video
              key={bgImage}
              src={cleanUrl(bgImage)}
              autoPlay
              loop
              muted
              playsInline
              style={{ width: '100vw', height: '100vh', objectFit: 'cover' }}
              onError={(e) => console.error("Background Video Error:", e)}
            />
          ) : (
            <img src={cleanUrl(bgImage)} className="w-full h-full object-cover" alt="BG" />
          )}
        </div>
      )}

      {/* Camera Feed */}
      {isCameraActive && (
        <video
          ref={cameraVideoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover z-10 bg-black"
        />
      )}

      {/* Live Overlay (Black/White fade) */}
      {overlayColor && <div className={`absolute inset-0 z-[100] ${overlayColor === 'black' ? 'bg-black' : 'bg-white'}`} />}

      {/* Clock & Ticker */}
      <RenderClock clock={clock} currentTime={currentTime} />
      <RenderTicker ticker={ticker} />

      <div className={`absolute inset-0 w-full h-full transition-opacity duration-300 z-20 ${isContentHidden ? 'opacity-0' : 'opacity-100'}`}>
        {mediaOverlay && mediaOverlay.url && (
          <div className="absolute inset-0 z-40 bg-black flex items-center justify-center">
            {mediaOverlay.type === 'image' && <img src={cleanUrl(mediaOverlay.url)} className="w-full h-full object-contain" alt="Media" />}
            {mediaOverlay.type === 'video' && <video key={mediaOverlay.url} src={cleanUrl(mediaOverlay.url)} className="w-full h-full object-contain" autoPlay controls playsInline preload="auto" />}
            {mediaOverlay.type === 'audio' && (
              <div className="flex flex-col items-center gap-4">
                <div className="w-32 h-32 bg-[#5865f2] rounded-full flex items-center justify-center animate-pulse">
                  <svg className="w-16 h-16 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                  </svg>
                </div>
                <audio key={mediaOverlay.url} src={cleanUrl(mediaOverlay.url)} autoPlay controls className="opacity-50 hover:opacity-100 transition" />
              </div>
            )}
            {mediaOverlay.type === 'youtube' && (
              <iframe 
                width="100%" height="100%" 
                src={`https://www.youtube.com/embed/${mediaOverlay.url}?autoplay=1&mute=0`} 
                title="YouTube Video" frameBorder="0" 
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                allowFullScreen
              ></iframe>
            )}
            {mediaOverlay.type === 'link' && <iframe src={mediaOverlay.url} className="w-full h-full border-none bg-white" title="Web Link" />}
            {mediaOverlay.type === 'document' && (
              <div className={`w-full h-full bg-white text-black overflow-hidden flex flex-col ${textContent ? 'items-center justify-center p-10' : ''}`}>
                {textContent ? (
                   <div className="p-10 whitespace-pre-wrap font-mono text-lg text-left w-full h-full overflow-y-auto">{textContent}</div>
                ) : mediaOverlay.url.match(/\.pdf(\?.*)?$/i) ? (
                   <iframe 
                     src={`${pdfUrl || cleanUrl(mediaOverlay.url)}#view=FitH`} 
                     width="100%"
                     height="100%"
                     className="absolute inset-0 border-none bg-white"
                     style={{ width: '100%', height: '100%' }}
                   />
                ) : (
                   <div className="flex flex-col items-center gap-4 p-10 text-center">
                      <div className="w-16 h-16 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center">
                         <FileText size={32} />
                      </div>
                      <p className="font-bold text-gray-800">Ce type de document est projeté.</p>
                      <p className="text-xs text-gray-500 max-w-md">Si le contenu ne s'affiche pas ici, il est recommandé d'utiliser un format PDF ou de capturer une image du document.</p>
                      <iframe 
                        src={`${cleanUrl(mediaOverlay.url)}#view=FitH`} 
                        width="100%"
                        height="100%"
                        className="w-full h-64 border border-gray-200 rounded mt-4" 
                        style={{ width: '100%', height: '100%' }}
                        title="Doc fallback" 
                      />
                   </div>
                )}
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
      <style>{`
        @keyframes marquee {
          0% { transform: translateX(100vw); }
          100% { transform: translateX(-100%); }
        }
        .animate-marquee {
          animation: marquee linear infinite;
          will-change: transform;
        }
      `}</style>
    </div>
  );
}
