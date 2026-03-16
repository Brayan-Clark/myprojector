import { useEffect, useState, memo, useRef, useCallback } from "react";
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

// Ticker avec animation JS pour compatibilité maximale AppImage/WebKit
const RenderTicker = memo(({ ticker }: { ticker: any }) => {
  const textRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const posX = useRef(0);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    if (!ticker.enabled || !ticker.message || !textRef.current || !containerRef.current) return;

    const containerWidth = window.innerWidth;
    const textWidth = textRef.current.offsetWidth || ticker.message.length * (ticker.fontSize || 28) * 0.6;
    const speed = 1.5; // px per frame
    posX.current = containerWidth;

    const animate = () => {
      posX.current -= speed;
      if (posX.current < -textWidth) {
        posX.current = containerWidth;
      }
      if (textRef.current) {
        textRef.current.style.transform = `translateX(${posX.current}px)`;
      }
      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [ticker.enabled, ticker.message, ticker.fontSize]);

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

  return (
    <div
      ref={containerRef}
      className={`fixed left-0 right-0 ${ticker.position === 'top' ? 'top-0' : 'bottom-0'} z-[70] overflow-hidden w-full py-4 border-y border-white/10`}
      style={{ backgroundColor: bgColor, color: ticker.color || 'yellow', pointerEvents: 'none' }}
    >
      <div
        ref={textRef}
        className="whitespace-nowrap inline-block"
        style={{
          fontSize: `${ticker.fontSize || 28}px`,
          fontFamily: ticker.fontFamily || 'Inter',
          fontWeight: 'bold',
          textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
          willChange: 'transform',
          transform: 'translateX(100vw)',
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
  const [isCameraActive, setIsCameraActive] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('live_camera_active') || 'false'); } catch { return false; }
  });
  const [cameraDeviceId, setCameraDeviceId] = useState<string | null>(() => localStorage.getItem('live_camera_id'));
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  // New features
  const [clock, setClock] = useState<any>({ enabled: false, type: 'digital', position: 'top-right', style: 'modern' });
  const [ticker, setTicker] = useState<any>({ enabled: false, message: '', position: 'bottom' });
  const [pdfSize, setPdfSize] = useState({ width: 100, height: 100 });
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

  const cleanUrl = useCallback((url: string) => {
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
  }, []);


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
        
        // Load initial camera state from storage since we won't get the event if it was sent before window opened
        const storedCamActive = localStorage.getItem('live_camera_active');
        if (storedCamActive !== null) setIsCameraActive(JSON.parse(storedCamActive));
        const storedCamId = localStorage.getItem('live_camera_id');
        if (storedCamId) setCameraDeviceId(storedCamId);

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
      }),
      listen<{width: number, height: number}>("update_pdf_size", (event) => setPdfSize(event.payload))
    ];

    return () => {
      unlistens.forEach(u => u.then(f => f()));
    };
  }, []);

  // Camera management with proper cleanup
  useEffect(() => {
    let active = true;
    const startCam = async () => {
      // 0. Delay for window stability on Linux
      await new Promise(r => setTimeout(r, 500));
      if (!active) return;

      // 1. Cleanup
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach(t => t.stop());
        cameraStreamRef.current = null;
      }

      if (!isCameraActive) {
        if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null;
        return;
      }

      // 2. Try constraints - SIMPLIFIED for WebKitGTK stability
      const attempts = [
        { video: { deviceId: cameraDeviceId ? { exact: cameraDeviceId } : undefined } },
        { video: { deviceId: cameraDeviceId ? { ideal: cameraDeviceId } : undefined } },
        { video: true }
      ];

      console.log(`LiveView: Starting camera logic. UI state active: ${isCameraActive}, Device: ${cameraDeviceId}`);

      for (const constraint of attempts) {
        try {
          // Si on a pas de deviceId, on saute les deux premières tentatives spécifiques
          if (!cameraDeviceId && constraint.video !== true && (constraint.video as any).deviceId) continue;

          console.log("LiveView: Attempting with:", JSON.stringify(constraint));
          const stream = await navigator.mediaDevices.getUserMedia(constraint);
          cameraStreamRef.current = stream;

          if (cameraVideoRef.current) {
            cameraVideoRef.current.srcObject = stream;
            try {
              await cameraVideoRef.current.play();
              console.log("LiveView: Stream playing:", stream.getVideoTracks()[0]?.label);
            } catch (playErr) {
              console.warn("LiveView: Play failed but stream obtained:", playErr);
            }
          }
          return; // Success!
        } catch (e: any) {
          console.warn(`LiveView: Stream attempt failed:`, e.name, e.message);
        }
      }
      console.error("LiveView: All camera attempts failed.");
    };

    startCam();

    return () => {
      active = false;
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach(t => t.stop());
        cameraStreamRef.current = null;
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
              // Revoke previous blob URL
              if (pdfUrl) URL.revokeObjectURL(pdfUrl);
              const blobUrl = URL.createObjectURL(blob);
              setPdfUrl(blobUrl);
            })
            .catch(e => {
              console.error("PDF Blob error:", e);
              setPdfUrl(null);
            });
        }
      } else { setTextContent(null); setPdfUrl(null); }
    } else { setTextContent(null); setPdfUrl(null); }
  }, [mediaOverlay]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, []);


  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black flex items-center justify-center text-white select-none">

      {/* Background Video or Image - Z-INDEX 0 */}
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
              style={{ width: '100vw', height: '100vh', objectFit: 'cover', display: 'block' }}
              onError={(e) => console.error("Background Video Error:", e)}
            />
          ) : (
            <img src={cleanUrl(bgImage)} className="w-full h-full object-cover" alt="BG" />
          )}
        </div>
      )}

      {/* Camera Feed - Z-INDEX 5 pour être devant le fond mais derrière le contenu */}
      {isCameraActive && (
        <video
          ref={cameraVideoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover z-[5] bg-black"
          style={{ display: 'block' }}
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
            {mediaOverlay.type === 'video' && <video key={mediaOverlay.url} src={cleanUrl(mediaOverlay.url)} className="w-full h-full object-contain" autoPlay controls playsInline preload="auto" style={{ display: 'block' }} />}
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
              <div style={{ position: 'fixed', inset: 0, backgroundColor: 'white', display: 'grid', gridTemplateColumns: '1fr', gridTemplateRows: '1fr', zIndex: 90 }}>
                {textContent ? (
                   <div style={{ gridArea: '1 / 1', overflow: 'auto', padding: '2.5rem', fontFamily: 'monospace', fontSize: '1.125rem', color: '#111', whiteSpace: 'pre-wrap' }}>{textContent}</div>
                ) : mediaOverlay.url.match(/\.pdf(\?.*)?$/i) ? (
                   <div style={{ gridArea: '1 / 1', width: '100%', height: '100%', overflow: 'auto' }}>
                      <iframe
                        key={pdfUrl || cleanUrl(mediaOverlay.url)}
                        src={pdfUrl ? `${pdfUrl}#toolbar=1&view=FitH&pagemode=none` : `${cleanUrl(mediaOverlay.url)}#toolbar=1&view=FitH&pagemode=none`}
                        style={{
                          width: `${pdfSize.width}vw`,
                          height: `${pdfSize.height}vh`,
                          minWidth: '100vw',
                          minHeight: '100vh',
                          border: 'none',
                        }}
                      />
                   </div>
                ) : (
                   <div style={{ gridArea: '1 / 1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', padding: '2.5rem', color: '#111' }}>
                      <div className="w-16 h-16 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center">
                         <FileText size={32} />
                      </div>
                      <p style={{ fontWeight: 'bold', color: '#1f2937' }}>Ce type de document est projeté.</p>
                      <p style={{ fontSize: '0.75rem', color: '#6b7280', maxWidth: '28rem', textAlign: 'center' }}>Si le contenu ne s'affiche pas ici, il est recommandé d'utiliser un format PDF ou de capturer une image du document.</p>
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
    </div>
  );
}
