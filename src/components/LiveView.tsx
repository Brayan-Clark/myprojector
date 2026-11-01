import { useEffect, useState, memo, useMemo, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FileText, ChevronLeft, ChevronRight } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { cleanUrl } from "../lib/media";
import { PdfViewer, type PdfViewerHandle } from "./lazy";
import { BackgroundVideo } from "./BackgroundVideo";
import { ProjectedVideo } from "./ProjectedVideo";
import { MarkdownView } from "./lazy";
import {
  bgMediaStyle, veilStyle, withBgDefaults, textShadowCss,
  DEFAULT_BG_FILTERS, type BgFilters,
} from "../lib/bgStyle";
import { fontStack } from "../lib/fonts";
import { ProjectionHeader } from "./ProjectionHeader";
import { DEFAULT_HEADER, withHeaderDefaults, type HeaderSettings } from "../lib/header";
import { SlideTransition } from "./SlideTransition";
import {
  DEFAULT_TRANSITION, keepsPreviousLayer, withTransitionDefaults, type TransitionSettings,
} from "../lib/transitions";

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
  // Versions bibliques supplémentaires, calculées par la fenêtre de contrôle.
  const [parallels, setParallels] = useState<any[]>([]);
  const [parallelStyle, setParallelStyle] = useState<{ sizeFactor: number; showBookName: boolean }>(
    { sizeFactor: 70, showBookName: false }
  );
  /* Vrai pour un texte biblique : la première ligne porte alors le numéro du
     verset, qui part dans l'entête au lieu d'être projetée. (Le placement de
     l'entête, lui, ne dépend plus du type de contenu — voir lib/header.ts.) */
  const [bgImage, setBgImage] = useState<string>(() => localStorage.getItem('live_bg') || "/backgrounds/sunset.jpg");
  // Traitement du fond (luminosité, flou, voile). Lu depuis localStorage à
  // l'ouverture : la fenêtre doit s'afficher déjà correcte, avant le premier
  // évènement du contrôleur.
  const [bgFilters, setBgFilters] = useState<BgFilters>(() => {
    try { return withBgDefaults(JSON.parse(localStorage.getItem('live_bg_filters') || 'null')); }
    catch { return { ...DEFAULT_BG_FILTERS }; }
  });
  const [mediaOverlay, setMediaOverlay] = useState<{
    type: string;
    url: string;
    /** Lien web : le site accepte-t-il d'être affiché en cadre ? */
    embeddable?: boolean;
    title?: string;
  } | null>(() => {
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
  const [transition, setTransition] = useState<TransitionSettings>(() => {
    try { return withTransitionDefaults(JSON.parse(localStorage.getItem('live_transition') || 'null')); }
    catch { return { ...DEFAULT_TRANSITION }; }
  });
  const [header, setHeader] = useState<HeaderSettings>(() => {
    try { return withHeaderDefaults(JSON.parse(localStorage.getItem('live_header') || 'null')); }
    catch { return { ...DEFAULT_HEADER }; }
  });
  const [pdfSize, setPdfSize] = useState({ width: 100, height: 100 });
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfNumPages, setPdfNumPages] = useState(0);
  const [showPdfControls, setShowPdfControls] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Styles du fond mémorisés.
  // `BackgroundVideo` est un composant `memo` : lui passer un objet de style
  // reconstruit à chaque rendu le faisait re-rendre à chaque seconde d'horloge
  // ou à chaque changement de diapo, pour rien.
  const bgFilterStyle = useMemo(() => bgMediaStyle(bgFilters), [bgFilters]);
  const bgVideoStyle = useMemo(
    () => ({ width: '100vw', height: '100vh', objectFit: 'cover' as const, ...bgFilterStyle }),
    [bgFilterStyle]
  );
  const bgVeilStyle = useMemo(() => veilStyle(bgFilters), [bgFilters]);

  // Identité de la diapo affichée : c'est ce qui déclenche une transition.
  // Le FOND n'y figure pas — il vit derrière le contenu et ne doit surtout pas
  // être réanimé (ni, pour une vidéo, redémarré) à chaque verset.
  const slideKey = useMemo(
    () => (mediaOverlay?.url
      ? `media:${mediaOverlay.type}:${mediaOverlay.url}`
      : `text:${reference}|${lines.join("\n")}`),
    [mediaOverlay?.type, mediaOverlay?.url, reference, lines]
  );

  const pdfViewerRef = useRef<PdfViewerHandle>(null);
  const lastEmittedPageRef = useRef(0);
  const pendingPageRef = useRef(1); // page commanded by the operator, applied once loaded

  // Apply the operator-commanded page once the document has finished loading.
  const handleLivePdfLoaded = (n: number) => {
    setPdfNumPages(n);
    const target = pendingPageRef.current;
    if (target > 1) requestAnimationFrame(() => pdfViewerRef.current?.goToPage(target));
  };

  const isPdfDoc = !!mediaOverlay && mediaOverlay.type === 'document' && /\.pdf(\?.*)?$/i.test(mediaOverlay.url);

  // Jump to a page by smooth-scrolling the continuous view. The resulting
  // visible-page change (onVisiblePageChange) syncs state + notifies the
  // controller — so wheel scrolling and button/keyboard jumps share one path.
  const goLivePage = (next: number) => {
    pdfViewerRef.current?.goToPage(next);
  };

  // Called whenever the page centred in the scroll view changes (wheel or jump).
  const handleLiveVisiblePage = (p: number) => {
    setPdfPage(p);
    if (lastEmittedPageRef.current !== p) {
      lastEmittedPageRef.current = p;
      import('@tauri-apps/api/event').then(({ emit }) => emit('live_pdf_page_changed', p));
    }
  };

  // Keyboard navigation on the presentation window itself (arrows / page / space).
  useEffect(() => {
    if (!isPdfDoc) return;
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) {
        e.preventDefault();
        goLivePage(pdfPage + 1);
      } else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) {
        e.preventDefault();
        goLivePage(pdfPage - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPdfDoc, pdfPage, pdfNumPages]);

  // Show the on-screen controls only while the mouse moves, then auto-hide them
  // so the audience isn't disturbed by a persistent toolbar.
  useEffect(() => {
    if (!isPdfDoc) {
      setShowPdfControls(false);
      return;
    }
    let timer: any;
    const onMove = () => {
      setShowPdfControls(true);
      clearTimeout(timer);
      timer = setTimeout(() => setShowPdfControls(false), 2500);
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      clearTimeout(timer);
    };
  }, [isPdfDoc]);

  useEffect(() => {
    // L'horloge n'est affichée que si elle est activée : sans ce garde, ce timer
    // forçait un re-render COMPLET de la vue projetée chaque seconde (PDF,
    // vidéo, bandeau inclus) même quand aucune horloge n'était visible.
    if (!clock?.enabled) return;
    setCurrentTime(new Date());
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, [clock?.enabled]);

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
        const { lyrics, media, transition } = event.payload;
        console.log("Atomic Content Update:", event.payload);

        // 0. Transition : posée avant le contenu, dans le même lot de mises à
        // jour React, pour que la diapo entrante soit animée avec SON réglage.
        if (transition) setTransition(withTransitionDefaults(transition));

        // 1. Update Media
        setMediaOverlay(media);

        // 2. Update Lyrics
        if (media) {
          setLines([]);
          setReference("");
          setParallels([]);
        } else {
          const payloadLines = lyrics.lines || [];
          const ref = lyrics.reference || "";
          const isBib = !!lyrics.isBible;

          setReference(ref);

          // Le numéro du verset n'est retiré du texte que s'il part dans
          // l'entête (`ref` non vide). Entête masquée, il reste visible dans
          // la diapo : l'assemblée doit pouvoir situer le passage.
          let finalLines = payloadLines;
          if (isBib && ref && finalLines.length > 1) {
            if (/^\d+$/.test(finalLines[0].trim())) {
              finalLines = finalLines.slice(1);
            }
          }
          setLines(finalLines);
          setParallels(lyrics.parallels || []);
          setParallelStyle(lyrics.parallelStyle || { sizeFactor: 70, showBookName: false });
        }
      }),
      listen<string>("update_live_bg", (event) => setBgImage(event.payload)),
      listen<Partial<BgFilters>>("update_live_bg_filters", (event) =>
        setBgFilters(withBgDefaults(event.payload))
      ),
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
      listen<Partial<HeaderSettings>>("update_live_header", (event) =>
        setHeader(withHeaderDefaults(event.payload))
      ),
      listen<{width: number, height: number}>("update_pdf_size", (event) => setPdfSize(event.payload)),
      listen<number>("command_pdf_page", (event) => {
        // Operator asked to project a specific page → scroll the live view to it
        // (and remember it, in case the document is still loading).
        pendingPageRef.current = event.payload;
        pdfViewerRef.current?.goToPage(event.payload);
      })
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
              const blobUrl = URL.createObjectURL(blob);
              // setState fonctionnel : `pdfUrl` capturé dans la closure pouvait
              // être périmé et on fuyait alors le blob précédent (mémoire).
              setPdfUrl((prev: string | null) => {
                if (prev) URL.revokeObjectURL(prev);
                return blobUrl;
              });
            })
            .catch(e => {
              console.error("PDF Blob error:", e);
              setPdfUrl(null);
            });
        }
      } else { setTextContent(null); setPdfUrl(null); }
    } else { setTextContent(null); setPdfUrl(null); }
    // On dépend des VALEURS, pas de l'objet : `sync()` ré-émet un objet neuf à
    // chaque changement (verset, horloge, bandeau...). Avec [mediaOverlay] le
    // PDF projeté était retéléchargé en entier à chaque fois -> gel de plusieurs
    // secondes en pleine présentation.
  }, [mediaOverlay?.type, mediaOverlay?.url]);

  // Cleanup blob URL on unmount.
  // Les deps sont vides (on ne veut nettoyer qu'au démontage) : il faut donc
  // lire la valeur via une ref, sinon `pdfUrl` reste figé à null et le blob
  // du PDF (plusieurs Mo) n'est jamais libéré.
  const pdfUrlRef = useRef<string | null>(null);
  useEffect(() => { pdfUrlRef.current = pdfUrl; }, [pdfUrl]);
  useEffect(() => {
    return () => {
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    };
  }, []);


  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black flex items-center justify-center text-white select-none">

      {/* Background Video or Image - Z-INDEX 0.
          `overflow-hidden` est indispensable : un fond flouté est agrandi (voir
          bgMediaStyle) et déborderait sinon du cadre de l'écran. */}
      {bgImage && cleanUrl(bgImage) && (
        <div className="absolute inset-0 z-0 overflow-hidden bg-black">
          {bgImage.match(/\.(mp4|webm|ogg|mov|mkv|avi|m4v)(\?.*)?$/i) ? (
            <BackgroundVideo
              src={cleanUrl(bgImage)!}
              label="Fond LiveView"
              className=""
              style={bgVideoStyle}
            />
          ) : (
            <img
              src={cleanUrl(bgImage)}
              className="w-full h-full object-cover"
              style={bgFilterStyle}
              alt="BG"
            />
          )}
          {/* Voile uni : il se pose SUR le fond mais SOUS le contenu, pour
              détacher le texte sans le ternir lui aussi. */}
          {bgVeilStyle && <div className="absolute inset-0" style={bgVeilStyle} />}
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

      {/* PDF page controls ON the presentation screen — keyboard works always,
          these buttons appear on mouse move and auto-hide after 2.5s. */}
      {isPdfDoc && pdfNumPages > 0 && (
        <div
          className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[120] flex items-center gap-4 bg-black/80 text-white rounded-full px-5 py-3 border border-white/20 shadow-2xl transition-opacity duration-300 ${showPdfControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        >
          <button
            className="p-2 rounded-full hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-transparent"
            onClick={() => goLivePage(pdfPage - 1)}
            disabled={pdfPage <= 1}
            title="Page précédente (← / Page préc.)"
          ><ChevronLeft size={28} /></button>
          <span className="text-lg font-bold tabular-nums min-w-[80px] text-center">{pdfPage} / {pdfNumPages}</span>
          <button
            className="p-2 rounded-full hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-transparent"
            onClick={() => goLivePage(pdfPage + 1)}
            disabled={pdfPage >= pdfNumPages}
            title="Page suivante (→ / Espace / Page suiv.)"
          ><ChevronRight size={28} /></button>
        </div>
      )}

      <div className={`absolute inset-0 w-full h-full transition-opacity duration-300 z-20 ${isContentHidden ? 'opacity-0' : 'opacity-100'}`}>
       <SlideTransition
         contentKey={slideKey}
         settings={transition}
         keepPrevious={keepsPreviousLayer(mediaOverlay?.type)}
         className="absolute inset-0"
       >
        {mediaOverlay && mediaOverlay.url && (
          /* Le fond noir opaque convient à une image, une vidéo ou un PDF, qui
             occupent tout l'écran. Une diapo Markdown, elle, est du CONTENU :
             elle doit se poser sur le fond d'écran de la présentation comme
             n'importe quelle autre diapo. On ne garde qu'un voile pour la
             lisibilité au-dessus d'un fond clair ou chargé. */
          <div className={`absolute inset-0 z-40 flex items-center justify-center ${
            mediaOverlay.type === 'markdown' ? 'bg-black/35' : 'bg-black'
          }`}>
            {mediaOverlay.type === 'markdown' && (
              /* Diapo Markdown : rendu complet (titres, tableaux, maths, médias),
                 avec la police, la couleur, l'alignement et la taille choisis
                 dans la barre d'outils — les mêmes réglages que le texte. */
              <div
                className="flex h-full w-full flex-col overflow-y-auto px-[6vw] py-[4vh]"
                style={{
                  justifyContent: textSettings?.valign === 'middle' ? 'center'
                    : textSettings?.valign === 'bottom' ? 'flex-end' : 'flex-start',
                  alignItems: textSettings?.align === 'center' ? 'center'
                    : textSettings?.align === 'right' ? 'flex-end' : 'flex-start',
                }}
              >
                <MarkdownView
                  content={mediaOverlay.url}
                  variant="projection"
                  style={{
                    textShadow: textShadowCss(textSettings?.textShadow, textSettings?.color),
                    fontFamily: fontStack(textSettings?.fontFamily),
                    color: textSettings?.color || '#ffffff',
                    textAlign: textSettings?.align || 'left',
                    width: `${textSettings?.contentWidth || 100}%`,
                    // Le texte simple projette à 7vh ; ici c'est la taille de
                    // BASE, que les titres multiplient (h1 = 1.9em ≈ 6.6vh).
                    fontSize: `${(textSettings?.fontSize || 100) / 100 * 3.5}vh`,
                    lineHeight: textSettings?.lineHeight || 1.4,
                  }}
                />
              </div>
            )}
            {mediaOverlay.type === 'image' && <img src={cleanUrl(mediaOverlay.url)} className="w-full h-full object-contain" alt="Media" />}
            {mediaOverlay.type === 'video' && (
              <ProjectedVideo src={cleanUrl(mediaOverlay.url)!} label="Vidéo projetée" />
            )}
            {mediaOverlay.type === 'audio' && (
              <div className="flex flex-col items-center gap-4">
                <div className="w-32 h-32 bg-[#5865f2] rounded-full flex items-center justify-center animate-pulse">
                  <svg className="w-16 h-16 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                  </svg>
                </div>
                <audio key={mediaOverlay.url} src={cleanUrl(mediaOverlay.url)} autoPlay controls className="opacity-90 hover:opacity-100 transition w-72 max-w-full" />
              </div>
            )}
            {mediaOverlay.type === 'youtube' && (
              <iframe
                width="100%" height="100%"
                /* `playsinline` évite le passage en plein écran natif sur
                   certaines plateformes, `rel=0` supprime les vidéos suggérées
                   d'autres chaînes à la fin — on ne veut pas de recommandations
                   YouTube devant l'assemblée. */
                src={`https://www.youtube.com/embed/${mediaOverlay.url}?autoplay=1&mute=0&playsinline=1&rel=0&modestbranding=1`}
                title="YouTube Video" frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              ></iframe>
            )}
            {mediaOverlay.type === 'link' && (
              mediaOverlay.embeddable === false ? (
                /* Le site refuse d'être affiché dans un cadre (vérifié à
                   l'ajout). Plutôt qu'une page blanche devant l'assemblée, on
                   affiche l'adresse en grand : elle reste utile, on peut la
                   noter ou la saisir. */
                <div className="flex h-full w-full flex-col items-center justify-center gap-6 bg-black px-12 text-center">
                  <span className="text-[2.2vh] font-bold uppercase tracking-[0.3em] text-gray-500">
                    À consulter
                  </span>
                  <span className="break-all text-[5vh] font-black leading-tight text-white">
                    {mediaOverlay.url.replace(/^https?:\/\//, '')}
                  </span>
                </div>
              ) : (
                <iframe src={mediaOverlay.url} className="w-full h-full border-none bg-white" title="Web Link" />
              )
            )}
            {mediaOverlay.type === 'document' && (
              <div style={{ position: 'fixed', inset: 0, backgroundColor: 'white', display: 'grid', gridTemplateColumns: '1fr', gridTemplateRows: '1fr', zIndex: 90 }}>
                {textContent ? (
                   <div style={{ gridArea: '1 / 1', overflow: 'auto', padding: '2.5rem', fontFamily: 'monospace', fontSize: '1.125rem', color: '#111', whiteSpace: 'pre-wrap' }}>{textContent}</div>
                ) : mediaOverlay.url.match(/\.pdf(\?.*)?$/i) ? (
                   // Absolute (not a grid item) so it stays bounded to the viewport
                   // and the inner scroll container can actually overflow/scroll.
                   <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
                      <PdfViewer
                        ref={pdfViewerRef}
                        mode="scroll"
                        url={pdfUrl || cleanUrl(mediaOverlay.url)}
                        zoom={(pdfSize.width || 100) / 100}
                        onLoaded={handleLivePdfLoaded}
                        onVisiblePageChange={handleLiveVisiblePage}
                        style={{ background: 'white' }}
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

        {/* Entête : position, taille, police et couleur viennent des réglages,
            et elle s'écarte d'elle-même de l'horloge et du bandeau. */}
        <ProjectionHeader text={reference} settings={header} clock={clock} ticker={ticker} />

        <div
          className="absolute inset-0 flex flex-col p-12 z-10 w-full h-full"
          style={{
            fontFamily: fontStack(textSettings?.fontFamily),
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
                /* La couleur et l'ombre viennent des réglages : `text-white` et
                   une ombre en dur ignoraient la couleur choisie, et noircir un
                   texte sombre sur fond clair le rendait illisible. */
                className={`w-full ${textSettings?.isItalic ? 'italic' : ''} ${textSettings?.isUnderline ? 'underline' : ''}`}
                style={{
                  color: textSettings?.color || '#ffffff',
                  fontWeight: textSettings?.isBold ? 'bold' : 'normal',
                  fontSize: `${(textSettings?.fontSize || 100) / 100 * 7}vh`,
                  lineHeight: textSettings?.lineHeight || 1.4,
                  textShadow: textShadowCss(textSettings?.textShadow, textSettings?.color),
                }}
                dangerouslySetInnerHTML={{ __html: line.replace(/<\/?[^>]+(>|$)/g, "") }}
              />
            ))}

            {/* Versions supplémentaires : séparées par un filet discret, en
                plus petit. Elles accompagnent le texte principal, elles ne le
                concurrencent pas. */}
            {parallels.map((p: any, i: number) => (
              <p
                key={`${p.version}-${i}`}
                className="mt-[0.4em] w-full border-t border-current/20 pt-[0.3em]"
                style={{
                  color: textSettings?.color || '#ffffff',
                  opacity: 0.86,
                  fontWeight: textSettings?.isBold ? 'bold' : 'normal',
                  fontSize: `${((textSettings?.fontSize || 100) / 100) * 7 * ((parallelStyle.sizeFactor || 70) / 100)}vh`,
                  lineHeight: textSettings?.lineHeight || 1.4,
                  textShadow: textShadowCss(textSettings?.textShadow, textSettings?.color),
                }}
              >
                {parallelStyle.showBookName && (
                  <span style={{ opacity: 0.7 }}>{p.book} {p.chapter}:{p.verse} — </span>
                )}
                {p.text}
              </p>
            ))}
          </div>
        </div>
       </SlideTransition>
      </div>
    </div>
  );
}
