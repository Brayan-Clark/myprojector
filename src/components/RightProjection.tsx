import { useState, useEffect, useMemo, useRef } from 'react';
import { Star, AlertCircle, AlertTriangle, Presentation, MonitorOff, Headphones, Youtube, Globe, FileText, Camera, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Film, Gauge } from 'lucide-react';
import { cleanUrl } from '../lib/media';
import { PdfViewer } from './lazy';
import { MarkdownView } from './lazy';
import { getSlides } from '../lib/slides';
import { NEXT_KEYS, PREV_KEYS, isTypingTarget, focusSlideList, SLIDE_LIST_ID } from '../lib/keys';
import { BackgroundVideo } from './BackgroundVideo';
import { ProjectedVideo } from './ProjectedVideo';
import { ProjectionHeader } from './ProjectionHeader';
import { buildHeaderText, withHeaderDefaults } from '../lib/header';
import { bgMediaStyle, veilStyle, textShadowCss } from '../lib/bgStyle';
import { fontStack } from '../lib/fonts';
import { SlideTransition } from './SlideTransition';
import { keepsPreviousLayer } from '../lib/transitions';
import { fittingFontSize, useOverflow } from '../lib/overflow';

export function RightProjection({ 
  activeSong, projectedSong, projectedVerseIdx, bgImage, textSettings, 
  isLiveActive, activeVerseIdx, setActiveVerseIdx, onProject, isBaseScreenProjected,
  setIsBaseScreenProjected, ticker, clock, isContentHidden, isCameraActive, selectedCamera, currentTime,
  overlayColor,
  projectedPdfPage, commandProjectedPage, projectedNumPages, setProjectedNumPages,
  width, bgFilters, header, transition, parallels, parallelStyle, onShrinkText, slideSplit, onPlaySlideVideo
}: any) {
  const isProjectedPdf = projectedSong?.type === 'document' && /\.pdf(\?.*)?$/i.test(projectedSong?.lyrics || "");

  const changeProjectedPage = (next: number) => {
    const total = projectedNumPages || 1;
    commandProjectedPage?.(Math.min(Math.max(1, next), total));
  };
  const [projectedLines, setProjectedLines] = useState<string[]>([]);

  // La vignette est en 16/9 : sa hauteur découle de la largeur de la colonne.
  // C'est l'échelle qui permet de reproduire fidèlement des tailles exprimées
  // en pourcentage de la hauteur d'écran.
  const previewHeight = Math.round((width ?? 384) * 9 / 16);

  // Débordement : l'aperçu reproduit les proportions de l'écran, on peut donc
  // savoir AVANT de projeter qu'une diapo ne tiendra pas.
  const [overflowRef, overflow] = useOverflow([
    projectedLines, parallels, previewHeight,
    textSettings?.fontSize, textSettings?.lineHeight, textSettings?.contentWidth,
    textSettings?.fontFamily, parallelStyle?.sizeFactor,
  ]);

  // Mémorisé pour la même raison que dans LiveView : `BackgroundVideo` est un
  // composant `memo`, un objet de style neuf à chaque rendu l'annule.
  const bgFilterStyle = useMemo(() => bgMediaStyle(bgFilters), [bgFilters]);
  const bgVeilStyle = useMemo(() => veilStyle(bgFilters), [bgFilters]);

  // Entête telle qu'elle partira à l'écran. Jusqu'ici l'aperçu ne l'affichait
  // pas : on ne découvrait un chevauchement avec l'horloge qu'en projetant.
  // L'aperçu suit le contenu PROJETÉ, pas l'onglet ouvert : sinon, préparer un
  // cantique pendant qu'un verset est à l'écran changeait l'aperçu du verset.
  const projectedIsBible = projectedSong?.type === 'bible';
  const headerConf = withHeaderDefaults(header);
  const headerText = (!isBaseScreenProjected && projectedSong && headerConf.enabled)
    ? buildHeaderText(
        headerConf,
        projectedSong,
        projectedIsBible,
        projectedLines[0]?.match(/^(\d+)/)?.[1]
      )
    : '';
  /**
   * Lignes réellement projetées.
   *
   * Quand la référence part dans l'entête, la fenêtre de projection retire le
   * numéro de verset du corps du texte (il serait affiché deux fois). L'aperçu
   * ne le faisait pas : il montrait un « 2 » que l'assemblée ne verrait jamais.
   * On applique ici la même règle, à partir des lignes BRUTES — dont on a
   * encore besoin plus haut pour construire la référence.
   */
  const displayLines = useMemo(() => {
    if (projectedIsBible && headerText && projectedLines.length > 1
        && /^\d+$/.test(projectedLines[0].trim())) {
      return projectedLines.slice(1);
    }
    return projectedLines;
  }, [projectedLines, projectedIsBible, headerText]);

  // Prochaine diapo : réglage d'affichage, retenu d'une séance à l'autre.
  const [showNext, setShowNext] = useState(
    () => localStorage.getItem('showNextSlide') === '1'
  );
  useEffect(() => {
    localStorage.setItem('showNextSlide', showNext ? '1' : '0');
  }, [showNext]);

  // Vidéo rattachée à la page actuellement projetée, s'il y en a une.
  // Le numéro de diapo du .pptx correspond au numéro de page du PDF converti.
  const slideVideoHere = useMemo(() => {
    const list = projectedSong?.slideVideos;
    if (!Array.isArray(list) || list.length === 0) return null;
    return list.find((v: any) => v.slide === (projectedPdfPage || 1)) || null;
  }, [projectedSong?.slideVideos, projectedPdfPage]);

  const previewVideoRef = useRef<HTMLVideoElement>(null);
  // Mémoïsé : `getSlides` renvoyait un TABLEAU NEUF à chaque rendu, et ce
  // tableau sert de dépendance à l'écouteur clavier plus bas. L'écouteur
  // global était donc retiré puis réinstallé à chaque rendu du composant.
  const verses = useMemo(
    () => (activeSong ? getSlides(activeSong, slideSplit) : []),
    [activeSong, slideSplit]
  );

  // Ce qui arrivera au prochain appui sur la flèche. Vide sur la dernière
  // diapo : la flèche ramène alors à l'écran d'accueil.
  const nextSlideText = activeVerseIdx >= 0 && activeVerseIdx < verses.length - 1
    ? verses[activeVerseIdx + 1]
    : '';

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
      const pVerses = getSlides(projectedSong, slideSplit);
      const lines = pVerses[projectedVerseIdx]?.split('\n') || [];
      setProjectedLines(lines);
    } else {
      setProjectedLines([]);
    }
  }, [projectedSong, projectedVerseIdx, slideSplit]);

  // Auto-scroll the list to keep the selection visible
  useEffect(() => {
    if (activeVerseIdx !== -1) {
      const el = document.getElementById(`verse-${activeVerseIdx}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [activeVerseIdx]);

  /**
   * Saut direct : on tape le numéro de la diapo, Entrée valide.
   *
   * Pendant un culte, « strophe 4 » arrive sans prévenir. Avant, il fallait
   * appuyer trois fois sur la flèche ou viser à la souris dans la liste.
   * Les chiffres ne servaient à rien d'autre hors champ de saisie : c'est la
   * frappe qui ouvre la saisie, sans bouton à chercher.
   */
  const [jumpInput, setJumpInput] = useState<string | null>(null);
  const jumpTimer = useRef<number | undefined>(undefined);

  const armJumpReset = () => {
    window.clearTimeout(jumpTimer.current);
    // Sans oubli automatique, un chiffre tapé par mégarde resterait affiché.
    jumpTimer.current = window.setTimeout(() => setJumpInput(null), 2500);
  };

  const applyJump = (value: string) => {
    const n = parseInt(value, 10);
    window.clearTimeout(jumpTimer.current);
    setJumpInput(null);
    if (!Number.isFinite(n) || n < 1 || n > verses.length) return;
    const idx = n - 1;
    setActiveVerseIdx(idx);
    if (!isBaseScreenProjected && activeSong?.id === projectedSong?.id) {
      onProject(activeSong, idx);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!verses || verses.length === 0) return;
      // On ignore la frappe si l'utilisateur écrit dans un champ.
      if (isTypingTarget(e.target)) return;

      if (/^[0-9]$/.test(e.key) && !e.altKey && !e.ctrlKey) {
        e.preventDefault();
        setJumpInput((prev) => (prev || '') + e.key);
        armJumpReset();
        return;
      }
      if (jumpInput !== null) {
        if (e.key === 'Enter') { e.preventDefault(); applyJump(jumpInput); return; }
        if (e.key === 'Backspace') {
          e.preventDefault();
          setJumpInput((prev) => (prev && prev.length > 1 ? prev.slice(0, -1) : null));
          armJumpReset();
          return;
        }
        if (e.key === 'Escape') { e.preventDefault(); setJumpInput(null); return; }
      }

      const isNext = NEXT_KEYS.includes(e.key);
      const isPrev = PREV_KEYS.includes(e.key);
      if (isNext || isPrev) {
        e.preventDefault();
        let newIdx = activeVerseIdx;
        if (isPrev && activeVerseIdx > 0) newIdx--;
        if (isNext && activeVerseIdx < verses.length - 1) newIdx++;

        // ← FIN DE PRÉSENTATION: si on est au dernier verset et on avance → retour à l'écran de base
        if (isNext && activeVerseIdx === verses.length - 1 && !isBaseScreenProjected) {
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
  }, [activeVerseIdx, verses, activeSong, projectedSong, isBaseScreenProjected, jumpInput]);

  const previewStreamRef = useRef<MediaStream | null>(null);

  /**
   * APERCU ALLEGE — pourquoi ce réglage existe.
   *
   * Le petit moniteur n'est pas une capture de la fenêtre de projection : il
   * refait le même rendu de son côté. Pour du texte c'est gratuit, mais pour
   * une vidéo cela veut dire DEUX décodages simultanés de la même vidéo, à
   * pleine résolution (WebKit décode la source, pas la taille d'affichage).
   * Rien dans Tauri/WebKitGTK ne permet de miroiter une fenêtre à moindre coût.
   *
   * On applique donc ici la règle déjà retenue pour la caméra : tant que le
   * direct est ouvert, l'aperçu ne décode pas une seconde fois — l'opérateur
   * voit l'image en grand sur l'écran de projection. Le bouton permet de
   * revenir à l'aperçu complet si on préfère la fidélité au confort.
   */
  const [lightPreview, setLightPreview] = useState(
    () => localStorage.getItem("previewLightMode") !== "0"
  );
  useEffect(() => {
    localStorage.setItem("previewLightMode", lightPreview ? "1" : "0");
  }, [lightPreview]);
  const spareDecoder = isLiveActive && lightPreview;

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

      // When the Live window is open, the camera is already rendered there.
      // Opening a SECOND getUserMedia stream just for the small preview doubles
      // CPU/GPU usage and, on Linux (V4L2), most webcams can't be shared between
      // two webviews at all. So we release the preview stream and show a light
      // placeholder instead — the operator still sees the live feed full-size.
      if (isLiveActive) {
        console.log("RightProjection: Live active — preview camera released to save resources.");
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
        // On vient de projeter : la frappe suivante est une navigation, pas
        // une recherche. Sans ceci le focus restait dans le champ de recherche
        // et les flèches haut/bas ne faisaient plus rien.
        focusSlideList();
      }
    };
    window.addEventListener('keydown', handleProjectKey);
    return () => window.removeEventListener('keydown', handleProjectKey);
  }, [activeSong, activeVerseIdx]);

  return (
    <div
      className="bg-[#202225] h-full flex flex-col shrink-0 min-w-0"
      style={{ width: width ?? 384 }}
    >
      <div className="flex-1 overflow-y-auto flex flex-col">
        <div className="bg-[#5865f2] p-2 flex items-center gap-2 shadow-md">
           <Presentation size={16} className="text-white" />
           <span className="text-white font-bold text-sm truncate">{activeSong ? activeSong.title : "Aperçu"}</span>
        </div>

        {/* `tabIndex` : rend la liste focusable pour que `focusSlideList()`
            puisse lui donner le clavier en sortant du champ de recherche.
            L'anneau de focus confirme à l'opérateur que les flèches naviguent. */}
        <div
          id={SLIDE_LIST_ID}
          tabIndex={-1}
          className="flex-1 p-2 space-y-1 bg-[#2f3136] overflow-y-auto outline-none focus:ring-1 focus:ring-inset focus:ring-[#5865f2]/50"
        >
          {!activeSong ? (
             <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-2">
                <AlertCircle size={32} />
                <p className="text-xs text-center">Sélectionnez un contenu pour le préparer</p>
             </div>
          ) : (activeSong.type === 'image' || activeSong.type === 'video' || activeSong.type === 'document' || activeSong.type === 'audio' || activeSong.type === 'youtube' || activeSong.type === 'link') ? (
             <div className="group flex flex-col items-center justify-center bg-[#36393f] hover:bg-[#4752c4] text-gray-300 hover:text-white rounded cursor-pointer transition border border-transparent hover:border-[#5865f2] overflow-hidden p-6 gap-3" onClick={() => { onProject(activeSong, 0); focusSlideList(); }}>
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
                <div key={idx} id={`verse-${idx}`} className={`group flex ${bgClass} hover:bg-[#4752c4] text-gray-300 hover:text-white rounded cursor-pointer transition border hover:border-[#5865f2] overflow-hidden`} onClick={() => { setActiveVerseIdx(idx); onProject(activeSong, idx); focusSlideList(); }}>
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

         {/* Bascule aperçu allégé / fidèle — visible seulement pendant le direct,
             puisque c'est le seul moment où le double décodage a lieu. */}
         {isLiveActive && (
            <button
               onClick={() => setLightPreview((v: boolean) => !v)}
               title={lightPreview
                  ? "Aperçu allégé : les vidéos ne sont décodées que sur l'écran de projection. Cliquer pour un aperçu fidèle."
                  : "Aperçu fidèle : les vidéos sont décodées deux fois. Cliquer pour alléger."}
               className={`absolute top-1 right-1 z-30 flex items-center gap-1 rounded px-1.5 py-0.5 text-[7px] font-black uppercase tracking-widest transition ${
                  lightPreview
                     ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
                     : "bg-white/10 text-white/50 hover:bg-white/20"
               }`}
            >
               <Gauge size={9} /> {lightPreview ? "Allégé" : "Fidèle"}
            </button>
         )}

         {/* Background — always visible (same as LiveView).
             Le traitement du fond (luminosité, flou, voile) est appliqué ici
             AUSSI : c'est précisément le genre de réglage qu'on doit pouvoir
             juger sans ouvrir la fenêtre de projection. */}
         <div className="absolute inset-0 z-0 overflow-hidden">
            {bgImage?.match(/\.(mp4|webm|ogg|mov|mkv|avi|m4v)(\?.*)?$/i) ? (
               spareDecoder ? (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-black">
                     <Film size={16} className="text-[#5865f2]" />
                     <span className="text-[6px] font-bold uppercase tracking-widest text-[#8891f2]">Fond vidéo en direct</span>
                  </div>
               ) : (
                  <BackgroundVideo src={cleanUrl(bgImage)!} label="Fond aperçu" style={bgFilterStyle} />
               )
            ) : bgImage ? (
               <img src={cleanUrl(bgImage)} className="w-full h-full object-cover" style={bgFilterStyle} alt="Background" />
            ) : (
               <div className="w-full h-full bg-black" />
            )}
            {bgVeilStyle && <div className="absolute inset-0" style={bgVeilStyle} />}
         </div>

         {/* Camera Feed - Z-INDEX 5 (consistent with LiveView).
             While Live is open we don't open a 2nd stream (see effect above): we
             show a lightweight badge instead so the camera is decoded only once. */}
         {isCameraActive && (
            isLiveActive ? (
               <div className="absolute inset-0 z-[5] bg-black flex flex-col items-center justify-center gap-1">
                  <Camera size={16} className="text-orange-400 animate-pulse" />
                  <span className="text-[6px] text-orange-400 font-bold uppercase tracking-widest">Caméra affichée en direct</span>
               </div>
            ) : (
               <video ref={previewVideoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover z-[5] bg-black" style={{ display: 'block' }} />
            )
         )}

         {/* Content overlay — only when projecting */}
         {!isBaseScreenProjected && projectedSong && (
            /* La transition est rejouée ici aussi : l'opérateur doit pouvoir
               juger l'effet sans ouvrir la fenêtre de projection. */
            <SlideTransition
               contentKey={`${projectedSong.id}:${projectedVerseIdx}:${projectedPdfPage || 1}`}
               settings={transition}
               keepPrevious={keepsPreviousLayer(
                  ['image', 'video', 'document', 'audio', 'youtube', 'link'].includes(projectedSong.type)
                     ? projectedSong.type : null
               )}
               className="absolute inset-0 flex items-center justify-center flex-col p-4 z-20"
            >
               {projectedSong.type === 'markdown' ? (
                  /* Aperçu fidèle : même voile et mêmes réglages de texte que
                     la fenêtre de projection, pour que le fond reste visible. */
                  <div className="absolute inset-0 z-20 overflow-hidden bg-black/35 p-3">
                     <div
                        className="flex h-full flex-col overflow-y-auto"
                        style={{
                           justifyContent: textSettings?.valign === 'middle' ? 'center'
                              : textSettings?.valign === 'bottom' ? 'flex-end' : 'flex-start',
                           alignItems: textSettings?.align === 'center' ? 'center'
                              : textSettings?.align === 'right' ? 'flex-end' : 'flex-start',
                        }}
                     >
                        <MarkdownView
                           content={getSlides(projectedSong, slideSplit)[projectedVerseIdx] || ''}
                           variant="preview"
                           style={{
                              fontFamily: fontStack(textSettings?.fontFamily),
                              color: textSettings?.color || '#ffffff',
                              textAlign: textSettings?.align || 'left',
                              width: `${textSettings?.contentWidth || 100}%`,
                              textShadow: textShadowCss(textSettings?.textShadow, textSettings?.color),
                           }}
                        />
                     </div>
                  </div>
               ) : ['image', 'video', 'document', 'audio', 'youtube', 'link'].includes(projectedSong.type) ? (
                  <div className="w-full h-full flex items-center justify-center z-20 absolute inset-0 bg-black">
                     {projectedSong.type === 'image' && <img src={cleanUrl(projectedSong.lyrics)} className="w-full h-full object-contain" alt="Media" />}
                     {projectedSong.type === 'video' && (
                        spareDecoder ? (
                           <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-black">
                              <Film size={16} className="text-[#5865f2] animate-pulse" />
                              <span className="text-[6px] font-bold uppercase tracking-widest text-[#8891f2]">Vidéo lue en direct</span>
                           </div>
                        ) : (
                           <ProjectedVideo src={cleanUrl(projectedSong.lyrics)!} controls={false} muted label="Aperçu vidéo" />
                        )
                     )}
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
                        isProjectedPdf ? (
                           <PdfViewer
                              mode="single"
                              url={cleanUrl(projectedSong.lyrics)}
                              page={projectedPdfPage || 1}
                              onLoaded={setProjectedNumPages}
                              style={{ background: 'white' }}
                           />
                        ) : (
                           <div className="w-full h-full bg-white flex flex-col items-center justify-center gap-1">
                              <FileText size={16} className="text-gray-400" />
                              <span className="text-[5px] text-gray-500 uppercase font-bold">Document</span>
                              <span className="text-[4px] text-gray-400 truncate max-w-[80%]">{projectedSong.title}</span>
                           </div>
                        )
                     )}
                  </div>
               ) : (
                  /* Aperçu du texte à l'ÉCHELLE de la projection : la taille est
                     calculée en proportion de la vignette, comme les `vh` de la
                     fenêtre de projection. Avec une taille fixe (`text-[8px]`),
                     l'aperçu ne montrait jamais qu'un texte débordait de l'écran. */
                  <div
                     ref={overflowRef}
                     className="flex flex-col w-full h-full overflow-hidden"
                     style={{
                        fontFamily: fontStack(textSettings?.fontFamily),
                        justifyContent: textSettings?.valign === 'middle' ? 'center' : textSettings?.valign === 'bottom' ? 'flex-end' : 'flex-start',
                        alignItems: textSettings?.align === 'center' ? 'center' : textSettings?.align === 'left' ? 'flex-start' : 'flex-end'
                     }}
                  >
                     <div
                        className="flex flex-col"
                        style={{
                           width: `${textSettings?.contentWidth || 100}%`,
                           alignItems: textSettings?.align === 'center' ? 'center' : textSettings?.align === 'left' ? 'flex-start' : 'flex-end',
                        }}
                     >
                        {displayLines.map((line: string, i: number) => (
                           <p
                              key={i}
                              className="w-full"
                              style={{
                                 color: textSettings?.color || '#ffffff',
                                 textAlign: textSettings?.align as any,
                                 fontWeight: textSettings?.isBold ? 'bold' : 'normal',
                                 fontStyle: textSettings?.isItalic ? 'italic' : 'normal',
                                 textDecoration: textSettings?.isUnderline ? 'underline' : 'none',
                                 fontSize: `${((textSettings?.fontSize || 100) / 100) * 0.07 * previewHeight}px`,
                                 lineHeight: textSettings?.lineHeight || 1.4,
                                 textShadow: textShadowCss(textSettings?.textShadow, textSettings?.color),
                              }}
                              dangerouslySetInnerHTML={{ __html: line.replace(/<\/?[^>]+(>|$)/g, "") }}
                           />
                        ))}
                        {/* Versions supplémentaires, à la même échelle que la
                            projection : c'est ici qu'on juge si trois versions
                            tiennent encore sur la diapo. */}
                        {(parallels || []).map((p: any, i: number) => (
                           <p
                              key={`${p.version}-${i}`}
                              className="mt-[0.4em] w-full border-t border-current/20 pt-[0.3em]"
                              style={{
                                 color: textSettings?.color || '#ffffff',
                                 opacity: 0.86,
                                 textAlign: textSettings?.align as any,
                                 fontWeight: textSettings?.isBold ? 'bold' : 'normal',
                                 fontSize: `${((textSettings?.fontSize || 100) / 100) * 0.07 * previewHeight * ((parallelStyle?.sizeFactor || 70) / 100)}px`,
                                 lineHeight: textSettings?.lineHeight || 1.4,
                                 textShadow: textShadowCss(textSettings?.textShadow, textSettings?.color),
                              }}
                           >
                              {parallelStyle?.showBookName && (
                                 <span style={{ opacity: 0.7 }}>{p.book} {p.chapter}:{p.verse} — </span>
                              )}
                              {p.text}
                           </p>
                        ))}
                     </div>
                  </div>
               )}
            </SlideTransition>
         )}

         {/* Entête — même composant que la projection, à l'échelle de la vignette */}
         <ProjectionHeader
            text={headerText}
            settings={headerConf}
            clock={clock}
            ticker={ticker}
            boxHeight={previewHeight}
            zIndex={30}
         />

         {/* BASE screen: show only background label */}
         {isBaseScreenProjected && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10 pointer-events-none">
               <span className="text-[8px] text-white/30 font-bold uppercase tracking-widest bg-black/40 px-2 py-1 rounded">Écran de Base</span>
               {isLiveActive && isCameraActive && (
                 <span className="text-[6px] text-orange-400 bg-black/60 px-1 rounded">Aperçu caméra affiché sur l'écran Live</span>
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

         {/* Débordement : l'alerte vit DANS le moniteur, à l'endroit où l'on
             regarde déjà, et propose la correction au lieu de seulement
             constater le problème. */}
         {overflow.overflowing && !isBaseScreenProjected && (
            <div className="absolute left-2 top-5 z-[70] flex items-center gap-1.5 rounded border border-amber-500/50 bg-amber-950/90 px-1.5 py-1 shadow-lg">
               <AlertTriangle size={11} className="shrink-0 text-amber-400" />
               <span className="text-[8px] font-bold uppercase tracking-wide text-amber-200">
                  Texte trop grand
               </span>
               {onShrinkText && (
                  <button
                     className="rounded bg-amber-500 px-1.5 py-0.5 text-[8px] font-black text-amber-950 transition hover:bg-amber-400"
                     title={`Réduire la taille du texte à environ ${fittingFontSize(textSettings?.fontSize || 100, overflow.excess)} % (appliqué à la portée sélectionnée dans la barre d'outils)`}
                     onClick={() => onShrinkText(fittingFontSize(textSettings?.fontSize || 100, overflow.excess))}
                  >
                     AJUSTER
                  </button>
               )}
            </div>
         )}

         {/* Saisie du saut direct : visible le temps de taper, puis oubliée. */}
         {jumpInput !== null && (
            <div className="absolute left-1/2 top-1/2 z-[90] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[#5865f2] bg-black/85 px-4 py-2 text-center shadow-2xl">
               <div className="font-mono text-2xl font-black tabular-nums text-white">{jumpInput}</div>
               <div className="text-[8px] uppercase tracking-widest text-gray-400">
                  Entrée pour aller à cette diapo
               </div>
            </div>
         )}

         {/* Vidéo intégrée à la diapo affichée (présentation PowerPoint).
             Le PDF ne peut pas la jouer : on la propose à l'opérateur, qui la
             lance quand il arrive dessus. Le bouton est de SON côté — on ne
             déclenche jamais une vidéo tout seul devant l'assemblée. */}
         {!isBaseScreenProjected && slideVideoHere && (
            <button
               className="absolute bottom-2 left-2 z-[70] flex items-center gap-1.5 rounded border border-[#5865f2] bg-[#5865f2]/90 px-2 py-1 text-[9px] font-black text-white shadow-lg transition hover:bg-[#5865f2]"
               title={`Projeter la vidéo intégrée à cette diapo (${slideVideoHere.name})`}
               onClick={() => onPlaySlideVideo?.(slideVideoHere)}
            >
               <Film size={11} /> LANCER LA VIDÉO
            </button>
         )}

         {/* LIVE indicator */}
         {isLiveActive && <div className="absolute bottom-2 right-2 bg-red-600 text-white text-[8px] px-1 py-0.5 rounded font-bold animate-pulse z-40 shadow-xl border border-white/20">LIVE</div>}

         {/* PDF page controls — drive the PROJECTED page (always visible, above hover overlay) */}
         {!isBaseScreenProjected && isProjectedPdf && projectedNumPages > 0 && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-1.5 bg-black/80 text-white rounded-full px-2 py-1 shadow-2xl border border-white/20">
               <button
                  className="p-1 rounded-full hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-transparent"
                  onClick={() => changeProjectedPage((projectedPdfPage || 1) - 1)}
                  disabled={(projectedPdfPage || 1) <= 1}
                  title="Page précédente (projetée)"
               ><ChevronLeft size={14} /></button>
               <span className="text-[10px] font-bold tabular-nums min-w-[42px] text-center">{projectedPdfPage || 1} / {projectedNumPages}</span>
               <button
                  className="p-1 rounded-full hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-transparent"
                  onClick={() => changeProjectedPage((projectedPdfPage || 1) + 1)}
                  disabled={(projectedPdfPage || 1) >= projectedNumPages}
                  title="Page suivante (projetée)"
               ><ChevronRight size={14} /></button>
            </div>
         )}

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

      {/* ==== PROCHAINE DIAPO ====
          Affichable ou non : certains opérateurs connaissent leur recueil et
          n'en veulent pas, d'autres ne projettent que deux fois par an. Le
          réglage est retenu, et la bande disparaît complètement quand elle est
          masquée — pas de place perdue. */}
      <div className="shrink-0 border-t border-[#18191c] bg-[#1e1f22]">
         <button
            className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[9px] font-bold uppercase tracking-widest text-gray-500 transition hover:text-gray-300"
            onClick={() => setShowNext((v: boolean) => !v)}
            title={showNext ? "Masquer la prochaine diapo" : "Afficher la prochaine diapo"}
         >
            {showNext ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
            Prochaine diapo
            {!showNext && nextSlideText && (
               <span className="ml-1 truncate font-normal normal-case tracking-normal text-gray-600">
                  · {nextSlideText.replace(/\s+/g, ' ').slice(0, 40)}
               </span>
            )}
         </button>
         {showNext && (
            <div className="px-2 pb-2">
               {nextSlideText ? (
                  <div className="rounded border border-[#36393f] bg-[#2b2d31] p-2">
                     <p className="line-clamp-3 text-[11px] leading-snug text-gray-300">
                        {nextSlideText.replace(/<\/?[^>]+(>|$)/g, '')}
                     </p>
                  </div>
               ) : (
                  <div className="rounded border border-dashed border-[#36393f] p-2 text-center text-[10px] text-gray-600">
                     {activeSong ? "Dernière diapo — la suivante ramène à l'accueil" : 'Aucun contenu sélectionné'}
                  </div>
               )}
            </div>
         )}
      </div>
    </div>
  );
}
