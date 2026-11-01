import { useState, useEffect, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Toolbar } from './components/Toolbar';
import { LeftSidebar } from './components/LeftSidebar';
import { getSlides, DEFAULT_SPLIT, withSplitDefaults } from './lib/slides';
import { isTypingTarget, focusSlideList } from './lib/keys';
import { MiddleEditor } from './components/MiddleEditor';
import { RightProjection } from './components/RightProjection';
import { LiveView } from './components/LiveView';
import { StageView } from './components/StageView';
import { UpdateBanner } from './components/UpdateBanner';
import { AlertCircle, X } from 'lucide-react';
import { ResizeHandle } from './components/ResizeHandle';
import { PANES, usePaneSize } from './lib/panes';
import { DEFAULT_BG_FILTERS } from './lib/bgStyle';
import { DEFAULT_TRANSITION } from './lib/transitions';
import { DEFAULT_PARALLEL, withParallelDefaults } from './lib/parallel';
import { DEFAULT_HEADER, buildHeaderText } from './lib/header';
import { DEFAULT_ANNOUNCEMENTS, announcementSlides, withAnnouncementDefaults } from './lib/announcements';
import { DEFAULT_STAGE, withStageDefaults } from './lib/stage';
import { isBibleChapter, type PlaylistItem, type SongItem } from './lib/items';
import { preloadHeavyViews } from './components/lazy';
import {
  clearResumePoint, describeAge, readResumePoint, saveResumePoint, type ResumePoint,
} from './lib/resume';

/**
 * Catégorie de réglages d'un élément, déduite de L'ÉLÉMENT — jamais de
 * l'onglet affiché.
 *
 * C'est la correction d'un comportement déroutant : on projetait un verset,
 * on basculait sur l'onglet Cantiques pour préparer la suite, et la
 * projection en cours se mettait à être traitée comme un chant (entête,
 * numéro de verset, réglages hérités). Ce qui est à l'écran ne doit dépendre
 * que de ce qui a été projeté.
 *
 * Les éléments d'agenda restent rangés avec les chants, comme avant : les
 * déplacer dans leur propre catégorie changerait l'apparence déjà réglée
 * chez les utilisateurs.
 */
const categoryOf = (item: any): string => (isBibleChapter(item) ? 'bible' : 'hymnes');

/**
 * Agenda de la séance précédente.
 *
 * ⚠ Le contenu de `localStorage` n'est PAS digne de confiance : il survit aux
 * mises à jour, et une version antérieure a pu y ranger une autre forme. Un
 * JSON illisible faisait lever l'initialiseur de `useState`, donc l'application
 * entière ne démarrait plus — et l'opérateur n'avait aucun moyen de s'en
 * sortir sans vider le stockage à la main. On repart d'un agenda vide, ce qui
 * est désagréable mais réparable.
 */
function readSavedPlaylist(): PlaylistItem[] {
  try {
    const saved = localStorage.getItem('currentPlaylist');
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    // On ne garde que ce qui a de quoi être projeté : un élément sans
    // identifiant casserait les clés React, un élément sans `lyrics` donnerait
    // une diapo vide sans qu'on sache pourquoi.
    return parsed.filter(
      (i) => i && typeof i.id === 'string' && typeof i.lyrics === 'string'
    ) as PlaylistItem[];
  } catch (e) {
    console.warn("Agenda précédent illisible, on repart à vide", e);
    return [];
  }
}

function App() {
  const [songs, setSongs] = useState<SongItem[]>([]);
  const [playlist, setPlaylist] = useState<PlaylistItem[]>(() => readSavedPlaylist());
  const [activeSong, setActiveSong] = useState<any>(null);
  const [activeVerseIdx, setActiveVerseIdx] = useState<number>(-1);
  const [projectedSong, setProjectedSong] = useState<any>(null);
  const [projectedVerseIdx, setProjectedVerseIdx] = useState<number>(-1);
  const [projectedPdfPage, setProjectedPdfPage] = useState<number>(1);
  const [projectedNumPages, setProjectedNumPages] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>("hymnes");
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [isContentHidden, setIsContentHidden] = useState(false);
  const [isBaseScreenProjected, setIsBaseScreenProjected] = useState(true);
  const [liveCategory, setLiveCategory] = useState<string>("hymnes");
  const [searchFocusTrigger, setSearchFocusTrigger] = useState(0);
  const [favoriteDbs, setFavoriteDbs] = useState(() => {
    const saved = localStorage.getItem('favoriteDbs');
    return saved ? JSON.parse(saved) : { hymnes: "", bible: "" };
  });
  const [cameraList, setCameraList] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>("");
  const [pdfWidth, setPdfWidth] = useState(100);
  const [pdfHeight, setPdfHeight] = useState(100);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [overlayColor, setOverlayColor] = useState<'black' | 'white' | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const refreshCameras = async (forcePermission = false) => {
    try {
      setCameraError(null);
      // Step 1: Enumerate and check for labels
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasLabels = devices.some(d => d.kind === 'videoinput' && d.label);
      
      if (forcePermission || !hasLabels) {
        console.log("Requesting camera permission to unlock labels...");
        try {
          // Attempt a very basic request to trigger the system prompt
          console.log("Triggering system permission prompt...");
          const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: { ideal: 640 }, height: { ideal: 480 } } 
          });
          
          await new Promise(r => setTimeout(r, 300)); 
          stream.getTracks().forEach(t => t.stop());
        } catch (permErr: any) {
          console.warn("Camera permission error:", permErr.name);
          if (permErr.name === 'NotReadableError') {
            setCameraError("Caméra occupée (déjà utilisée).");
          } else if (permErr.name === 'NotAllowedError') {
            const isLinux = navigator.userAgent.toLowerCase().includes('linux');
            setCameraError(isLinux 
              ? "Accès refusé. (Astuce Linux: lancez avec GDK_BACKEND=x11 ou vérifiez vos permissions)"
              : "Accès caméra refusé par le système.");
          } else if (permErr.name === 'NotFoundError') {
            setCameraError("Aucune caméra physique détectée.");
          } else {
            setCameraError(`Erreur: ${permErr.name}`);
          }
        }
      }

      // Step 2: Enumerate all devices again
      const freshDevices = await navigator.mediaDevices.enumerateDevices();
      let cams = freshDevices.filter(d => d.kind === 'videoinput');
      
      console.log(`Found ${cams.length} camera(s):`, cams.map(c => c.label || `ID:${c.deviceId.slice(0, 4)}`));
      setCameraList(cams);
      
      if (cams.length > 0) {
        const stillExists = cams.find(c => c.deviceId === selectedCamera);
        if (!selectedCamera || !stillExists) {
          const newId = cams[0].deviceId;
          setSelectedCamera(newId);
          import('@tauri-apps/api/event').then(({ emit }) => emit('set_camera_id', newId));
        }
      }
    } catch (e) {
      console.warn("Failed to enumerate cameras:", e);
    }
  };

  useEffect(() => {
    refreshCameras();
    
    // Refresh periodically if camera is active
    const interval = setInterval(() => {
      const hasLabels = cameraList.some(c => c.label);
      if (isCameraActive && !hasLabels) {
        refreshCameras();
      }
    }, 10000);

    const handleDeviceChange = () => {
      console.log("Devices changed, refreshing...");
      refreshCameras();
    };

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      clearInterval(interval);
    };
  }, [isCameraActive]);

  // Store app data path in localStorage so LiveView and other windows can use it
  useEffect(() => {
    invoke<string>('get_app_data_path').then(path => {
      localStorage.setItem('appDataPath', path);
    }).catch(console.error);
    // Port réellement retenu par le serveur média : il peut différer de 11223
    // si ce dernier était occupé. Sans cette lecture, tous les médias locaux
    // pointeraient vers un port mort.
    invoke<number>('media_server_port').then(port => {
      localStorage.setItem('mediaPort', String(port));
    }).catch(console.error);

    // Les visionneuses Markdown et PDF sont chargées maintenant, pendant que
    // l'opérateur prépare sa séance — et non au moment de projeter, où une
    // attente serait visible par l'assemblée. Voir `components/lazy.tsx`.
    preloadHeavyViews();
  }, []);

  useEffect(() => {
    localStorage.setItem('favoriteDbs', JSON.stringify(favoriteDbs));
  }, [favoriteDbs]);

  useEffect(() => {
    localStorage.setItem('currentPlaylist', JSON.stringify(playlist));
  }, [playlist]);

  /**
   * Position de projection, conservée en continu.
   *
   * L'agenda était déjà enregistré, mais pas l'endroit où on en était : après
   * un plantage ou une coupure de courant en plein culte, l'opérateur
   * retrouvait sa liste et devait recompter les strophes devant l'assemblée.
   *
   * On n'enregistre que ce qui est RÉELLEMENT projeté — pas la sélection en
   * cours dans la barre latérale, qui change à chaque flèche du clavier et ne
   * dit rien de ce que la salle voit. L'écran de base efface la position : on
   * ne proposera pas de reprendre un chant qu'on avait justement fini de
   * projeter.
   */
  useEffect(() => {
    if (isBaseScreenProjected || !projectedSong?.id || projectedVerseIdx < 0) {
      clearResumePoint();
      return;
    }
    saveResumePoint({
      itemId: String(projectedSong.id),
      title: String(projectedSong.title || ''),
      slideIndex: projectedVerseIdx,
      pdfPage: projectedPdfPage,
    });
  }, [projectedSong?.id, projectedSong?.title, projectedVerseIdx, projectedPdfPage, isBaseScreenProjected]);

  /**
   * Proposition de reprise, calculée une seule fois au démarrage.
   *
   * ⚠ On ne reprojette pas tout seul : rétablir l'affichage enverrait du
   * contenu sur l'écran de la salle sans que personne ne l'ait demandé.
   */
  const [resumePoint, setResumePoint] = useState<ResumePoint | null>(null);
  useEffect(() => {
    setResumePoint(readResumePoint(playlist.map((i) => i.id)));
    // Volontairement sans dépendances : la proposition porte sur l'état
    // retrouvé au lancement. La recalculer à chaque modification de l'agenda
    // la ferait réapparaître en pleine préparation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyResume = () => {
    if (!resumePoint) return;
    const item = playlist.find((i) => i.id === resumePoint.itemId);
    setResumePoint(null);
    if (!item) return;
    // On rouvre l'élément et on se place à la bonne diapo, SANS projeter :
    // l'opérateur garde la main sur ce qui part à l'écran.
    setActiveSong(item);
    setActiveCategory(categoryOf(item));
    setActiveVerseIdx(resumePoint.slideIndex);
  };

  const isLiveMode = useMemo(() => new URLSearchParams(window.location.search).get('live') === 'true', []);
  const isStageMode = useMemo(() => new URLSearchParams(window.location.search).get('stage') === 'true', []);

  /**
   * Confirme au backend que le rendu fonctionne.
   *
   * ⚠ On compte de vraies IMAGES, pas le montage de React.
   *
   * Sur une fenêtre noire (chemin DMA-BUF en échec), le JavaScript s'exécute
   * normalement : confirmer au montage viderait le filet de sécurité de tout
   * son sens. En revanche `requestAnimationFrame` est cadencé par le
   * compositeur — si rien n'est composé, les rappels ne viennent pas, on ne
   * confirme pas, et le démarrage suivant redescend d'un cran
   * (voir `resolve_render_mode` dans src-tauri/src/lib.rs).
   *
   * Dix images, soit environ un sixième de seconde à 60 Hz : assez pour que
   * l'usage normal confirme toujours, assez court pour qu'une fermeture
   * immédiate ne déclenche pas de faux repli.
   *
   * Déclaré AVANT les retours anticipés `isLiveMode` / `isStageMode` — l'ordre
   * des hooks doit rester stable — mais ne fait rien dans ces fenêtres : c'est
   * celle de contrôle qui porte le réglage.
   */
  useEffect(() => {
    if (isLiveMode || isStageMode) return;
    let frames = 0;
    let handle = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (++frames >= 10) {
        invoke('confirm_render_ok').catch((e) =>
          console.warn('Confirmation du rendu impossible', e)
        );
        return;
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => { cancelled = true; cancelAnimationFrame(handle); };
  }, [isLiveMode, isStageMode]);

  if (isLiveMode) {
    return <LiveView />;
  }
  if (isStageMode) {
    return <StageView />;
  }

  // Global Shortcuts
  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setIsBaseScreenProjected(prev => !prev);
      }
      if (e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        if (playlist.length > 0) {
          setActiveSong(playlist[0]);
          setActiveVerseIdx(0);
          setIsBaseScreenProjected(false);
          setLiveCategory(categoryOf(playlist[0]));
          // La présentation démarre : les flèches doivent répondre tout de
          // suite, même si on venait juste de taper dans la recherche.
          focusSlideList();
        }
      }
      if (e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        setSearchFocusTrigger(prev => prev + 1);
      }
      if (e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        handleLiveToggle();
      }
      if (e.altKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        const next = !isContentHidden;
        setIsContentHidden(next);
        import('@tauri-apps/api/event').then(({ emit }) => emit('update_live_hide_content', next));
      }
      // Alt+N => Écran Noir
      if (e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setOverlayColor('black');
        import('@tauri-apps/api/event').then(({ emit }) => emit('update_live_overlay', 'black'));
      }
      // Alt+W => Écran Blanc
      if (e.altKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        setOverlayColor('white');
        import('@tauri-apps/api/event').then(({ emit }) => emit('update_live_overlay', 'white'));
      }
      // Alt+R => Réveil (retirer overlay)
      if (e.altKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        setOverlayColor(null);
        import('@tauri-apps/api/event').then(({ emit }) => emit('update_live_overlay', null));
      }
      // Alt+C => Toggle Horloge
      if (e.altKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        setClockSettings((prev: any) => ({ ...prev, enabled: !prev.enabled }));
      }
      // Alt+M => Toggle Message défilant
      if (e.altKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setTickerSettings((prev: any) => ({ ...prev, enabled: !prev.enabled }));
      }

      // --- Télécommandes de présentation (clickers Bluetooth / USB) ---------
      // Elles envoient des touches standard, sans Alt. On ne retient que des
      // touches non ambiguës, et jamais pendant une saisie.
      if (!e.altKey && !e.ctrlKey && !isTypingTarget(e.target)) {
        // « . » : écran noir, comme dans les logiciels de présentation.
        if (e.key === '.') {
          e.preventDefault();
          setOverlayColor((prev: any) => {
            const next = prev === 'black' ? null : 'black';
            import('@tauri-apps/api/event').then(({ emit }) => emit('update_live_overlay', next));
            return next;
          });
        }
        // Échap : retirer le voile et revenir à l'affichage normal.
        if (e.key === 'Escape') {
          setOverlayColor((prev: any) => {
            if (prev === null) return prev;
            import('@tauri-apps/api/event').then(({ emit }) => emit('update_live_overlay', null));
            return null;
          });
        }
      }
    };
    window.addEventListener('keydown', handleGlobalShortcuts);
    return () => window.removeEventListener('keydown', handleGlobalShortcuts);
  }, [playlist, isLiveActive, isContentHidden]);

  const handleLiveToggle = async () => {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    let existing = await WebviewWindow.getByLabel('live');

    if (existing) {
      try {
        await existing.close();
      } catch (e) {
        console.error("Failed to close window", e);
        // Force state reset if close fails (e.g. window already gone but handle still exists)
        setIsLiveActive(false);
      }
      return;
    }

    try {
      const { availableMonitors } = await import('@tauri-apps/api/window');
      const monitors = await availableMonitors();
      let opts: any = {
        url: '/?live=true',
        title: 'Live',
        fullscreen: true,
        decorations: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        focus: false,
      };

      if (monitors.length > 1) {
        const m = monitors[monitors.length - 1];
        opts.x = m.position.x;
        opts.y = m.position.y;
      }

      const w = new WebviewWindow('live', opts);

      setIsLiveActive(true);

      // Lecture automatique du fond vidéo.
      //
      // WebKitGTK fige la politique média à la création du document. La
      // fenêtre principale la reçoit dans `setup()`, avant son premier
      // chargement — ses vidéos démarrent seules. Celle-ci est créée plus
      // tard : son premier document naît sans la politique, d'où le bouton
      // « play » au milieu du fond.
      //
      // On la pose donc puis on recharge : le SECOND document l'a. Le
      // rechargement se produit sur un écran encore noir, avant tout contenu.
      //
      // Tout échec ici est sans gravité : la projection fonctionne, seul le
      // démarrage automatique du fond vidéo serait perdu.
      setTimeout(() => {
        invoke('prime_live_webview').catch((e) =>
          console.warn('Lecture automatique du fond non préparée:', e)
        );
      }, 600);

      // Listen to window destruction to reset state instantly
      w.once('tauri://destroyed', () => {
        setIsLiveActive(false);
      });

      w.once('tauri://error', () => {
        setIsLiveActive(false);
      });

    } catch (e) {
      console.error("Window failed", e);
      setIsLiveActive(false);
    }
  };

  const defaultTextSettings = {
    fontFamily: 'Inter',
    fontSize: 100,
    isBold: true,
    isItalic: false,
    isUnderline: false,
    align: 'center',
    valign: 'middle',
    color: '#ffffff',
    lineHeight: 1.4,
    contentWidth: 100,
    // Lisibilité du texte sur le fond — voir src/lib/bgStyle.ts.
    textShadow: 'soft',
  };

  // L'entête était un réglage GLOBAL. C'était une incohérence : tout le reste
  // de l'apparence se règle par portée, et on ne veut justement pas la même
  // référence pour un cantique (« 123 — Titre », discrète) et pour un texte
  // biblique (« Jaona 3:16 », bien visible). Elle rejoint donc la cascade.
  //
  // `legacyHeader` reprend une fois pour toutes l'ancien réglage global, pour
  // ne pas effacer ce qui avait déjà été configuré.
  const legacyHeader = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('headerSettings') || 'null') || {}; }
    catch { return {}; }
  }, []);
  const baseHeader = { ...DEFAULT_HEADER, ...legacyHeader };

  const defaultStyles: any = {
    chant: { textSettings: { ...defaultTextSettings }, bgImage: "/backgrounds/sunset.jpg", bgFilters: { ...DEFAULT_BG_FILTERS }, header: { ...baseHeader }, transition: { ...DEFAULT_TRANSITION }, parallel: { ...DEFAULT_PARALLEL } },
    hymnes: { textSettings: { ...defaultTextSettings }, bgImage: "/backgrounds/sunset.jpg", bgFilters: { ...DEFAULT_BG_FILTERS }, header: { ...baseHeader }, transition: { ...DEFAULT_TRANSITION }, parallel: { ...DEFAULT_PARALLEL } },
    // Un verset projeté a besoin de sa référence : c'est elle qui permet à
    // l'assemblée de suivre dans sa propre bible.
    bible: { textSettings: { ...defaultTextSettings, align: 'left' }, bgImage: "/backgrounds/tree.png", bgFilters: { ...DEFAULT_BG_FILTERS }, header: { ...baseHeader, content: 'ref' }, transition: { ...DEFAULT_TRANSITION }, parallel: { ...DEFAULT_PARALLEL } },
    agenda: { textSettings: { ...defaultTextSettings }, bgImage: "/backgrounds/sunset.jpg", bgFilters: { ...DEFAULT_BG_FILTERS }, header: { ...baseHeader }, transition: { ...DEFAULT_TRANSITION }, parallel: { ...DEFAULT_PARALLEL } },
  };

  const [settingsByCategory, setSettingsByCategory] = useState(() => {
    const saved = localStorage.getItem('appSettings');
    if (saved) return JSON.parse(saved);
    return defaultStyles;
  });

  const [specificSettings, setSpecificSettings] = useState(() => {
    const saved = localStorage.getItem('appSpecificSettings');
    if (saved) return JSON.parse(saved);
    return { books: {}, songs: {}, verses: {}, base: {} };
  });

  useEffect(() => {
    localStorage.setItem('appSpecificSettings', JSON.stringify(specificSettings));
  }, [specificSettings]);

  const [editingScope, setEditingScope] = useState<'category' | 'book' | 'song' | 'verse' | 'base'>('category');

  const getComputedSettingsForVerse = (song: any, verseIdx: number, forceBase: boolean = false, categoryOverride?: string) => {
    if (!song || forceBase) {
      return {
        textSettings: { ...defaultStyles.chant?.textSettings, ...(specificSettings.base?.textSettings || {}) },
        bgImage: specificSettings.base?.bgImage || defaultStyles.chant?.bgImage,
        bgFilters: { ...DEFAULT_BG_FILTERS, ...(specificSettings.base?.bgFilters || {}) },
        header: { ...baseHeader, ...(specificSettings.base?.header || {}) },
        transition: { ...DEFAULT_TRANSITION, ...(specificSettings.base?.transition || {}) },
        parallel: { ...DEFAULT_PARALLEL }
      };
    }
    const category = categoryOverride || categoryOf(song);
    const baseCategoryStyle = defaultStyles[category] || defaultStyles.chant;
    let txt = { ...baseCategoryStyle.textSettings, ...(settingsByCategory[category]?.textSettings || {}) };
    let bg = settingsByCategory[category]?.bgImage || baseCategoryStyle.bgImage;
    // Les traitements du fond se cumulent comme le style de texte : la portée
    // la plus précise (un verset) complète celle du dessus (le livre, la
    // catégorie) au lieu de la remplacer en bloc.
    let flt = { ...DEFAULT_BG_FILTERS, ...(settingsByCategory[category]?.bgFilters || {}) };
    let hdr = { ...baseCategoryStyle.header, ...(settingsByCategory[category]?.header || {}) };
    let trs = { ...DEFAULT_TRANSITION, ...(settingsByCategory[category]?.transition || {}) };
    let par = { ...DEFAULT_PARALLEL, ...(settingsByCategory[category]?.parallel || {}) };

    const layer = (scope: any) => {
      if (!scope) return;
      txt = { ...txt, ...scope.textSettings };
      if (scope.bgImage) bg = scope.bgImage;
      flt = { ...flt, ...(scope.bgFilters || {}) };
      hdr = { ...hdr, ...(scope.header || {}) };
      trs = { ...trs, ...(scope.transition || {}) };
      par = { ...par, ...(scope.parallel || {}) };
    };

    if (song?.book) layer(specificSettings.books[song.book]);
    if (song?.id) layer(specificSettings.songs[song.id]);
    if (song?.id && verseIdx !== -1) layer(specificSettings.verses[`${song.id}_${verseIdx}`]);

    return { textSettings: txt, bgImage: bg, bgFilters: flt, header: hdr, transition: trs, parallel: par };
  };

  // LIVE FEATURES: Clock and Ticker
  const [clockSettings, setClockSettings] = useState<any>(() => {
    const saved = localStorage.getItem('clockSettings');
    return saved ? JSON.parse(saved) : {
      enabled: false,
      type: 'digital',
      style: 'modern',
      color: '#ffffff',
      size: 60,
      position: 'top-right'
    };
  });

  // Entête de projection (la référence par-dessus la diapo). Voir lib/header.ts.
  const [tickerSettings, setTickerSettings] = useState<any>(() => {
    const saved = localStorage.getItem('tickerSettings');
    const defaultTicker = {
      enabled: false,
      message: "Bienvenue à tous !",
      color: '#ffff00',
      bgColor: '#000000',
      bgOpacity: 0.7,
      position: 'bottom',
      fontSize: 28,
      fontFamily: 'Inter'
    };
    if (!saved) return defaultTicker;
    const parsed = JSON.parse(saved);
    return { ...parsed, message: defaultTicker.message }; // Keep default message as per user request
  });

  useEffect(() => {
    localStorage.setItem('clockSettings', JSON.stringify(clockSettings));
  }, [clockSettings]);

  useEffect(() => {
    localStorage.setItem('tickerSettings', JSON.stringify(tickerSettings));
  }, [tickerSettings]);

  const computedLiveSettings = useMemo(() =>
    getComputedSettingsForVerse(projectedSong, projectedVerseIdx, isBaseScreenProjected, liveCategory),
    [projectedSong, projectedVerseIdx, isBaseScreenProjected, liveCategory, settingsByCategory, specificSettings]
  );

  const previewSettings = useMemo(() =>
    getComputedSettingsForVerse(activeSong, activeVerseIdx, false, activeCategory),
    [activeSong, activeVerseIdx, activeCategory, settingsByCategory, specificSettings]
  );

  // --- Versions bibliques supplémentaires ---------------------------------
  //
  // Lues à part, et non dans `sync()` : sync est rejoué à chaque battement
  // d'horloge ou changement de bandeau. Interroger la base à chacun de ces
  // passages serait du gaspillage, alors que le verset, lui, n'a pas changé.
  const [parallelVerses, setParallelVerses] = useState<any[]>([]);
  const liveParallel = withParallelDefaults(computedLiveSettings.parallel);
  const projectedIsBible = projectedSong?.type === 'bible';

  useEffect(() => {
    if (!projectedIsBible || isBaseScreenProjected || liveParallel.versions.length === 0
        || !projectedSong?.book_no) {
      setParallelVerses([]);
      return;
    }
    const slides = getSlides(projectedSong, slideSplit);
    const idx = Math.max(0, Math.min(projectedVerseIdx, slides.length - 1));
    const verseNo = parseInt(slides[idx]?.match(/^\s*(\d+)/)?.[1] || '', 10);
    if (!Number.isFinite(verseNo)) { setParallelVerses([]); return; }

    let cancelled = false;
    invoke<any[]>('fetch_parallel_verse', {
      dbNames: liveParallel.versions,
      bookNo: projectedSong.book_no,
      chapter: parseInt(projectedSong.number, 10),
      verse: verseNo,
    })
      .then((rows) => { if (!cancelled) setParallelVerses(rows); })
      .catch((e) => { console.warn('fetch_parallel_verse', e); if (!cancelled) setParallelVerses([]); });
    return () => { cancelled = true; };
  }, [
    projectedIsBible, isBaseScreenProjected, projectedSong?.id, projectedSong?.book_no,
    projectedSong?.number, projectedVerseIdx, liveParallel.versions.join('|'),
  ]);

  // Découpage automatique des diapos trop longues. GLOBAL et désactivé par
  // défaut : il change la numérotation des diapos, ce qui ne doit jamais
  // arriver sans qu'on l'ait demandé.
  const [slideSplit, setSlideSplit] = useState(() => {
    try { return withSplitDefaults(JSON.parse(localStorage.getItem('slideSplit') || 'null')); }
    catch { return { ...DEFAULT_SPLIT }; }
  });
  useEffect(() => {
    localStorage.setItem('slideSplit', JSON.stringify(slideSplit));
  }, [slideSplit]);

  // Écran retour (estrade). Fermé par défaut : la troisième fenêtre n'existe
  // que si on la demande.
  const [stage, setStage] = useState(() => {
    try { return withStageDefaults(JSON.parse(localStorage.getItem('stageSettings') || 'null')); }
    catch { return { ...DEFAULT_STAGE }; }
  });
  useEffect(() => {
    localStorage.setItem('stageSettings', JSON.stringify(stage));
  }, [stage]);
  const [isStageActive, setIsStageActive] = useState(false);
  const [timerStart, setTimerStart] = useState<number | null>(null);

  const handleStageToggle = async () => {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const existing = await WebviewWindow.getByLabel('stage');
    if (existing) {
      try { await existing.close(); } catch { setIsStageActive(false); }
      return;
    }
    try {
      // Fenêtre NORMALE, ni plein écran ni sans décorations : on ne sait pas
      // sur quel moniteur l'écran de retour est branché, et deviner mal
      // reviendrait à voler l'écran de projection. L'opérateur la place une
      // fois, le système retient ensuite.
      const w = new WebviewWindow('stage', {
        url: '/?stage=true',
        title: 'Écran retour — estrade',
        width: 960,
        height: 540,
        focus: false,
      });
      setIsStageActive(true);
      w.once('tauri://destroyed', () => setIsStageActive(false));
      w.once('tauri://error', () => setIsStageActive(false));
    } catch (e) {
      console.error('Stage window failed', e);
      setIsStageActive(false);
    }
  };

  // Annonces de l'écran d'accueil. Globales et désactivées par défaut.
  const [announcements, setAnnouncements] = useState(() => {
    try { return withAnnouncementDefaults(JSON.parse(localStorage.getItem('announcements') || 'null')); }
    catch { return { ...DEFAULT_ANNOUNCEMENTS }; }
  });
  useEffect(() => {
    localStorage.setItem('announcements', JSON.stringify(announcements));
  }, [announcements]);

  const [annIndex, setAnnIndex] = useState(0);
  const annSlides = useMemo(() => announcementSlides(announcements), [announcements]);
  // Le défilement ne tourne QUE sur l'écran d'accueil : une annonce ne doit
  // jamais remplacer un verset ou une strophe en cours de projection.
  const annActive = announcements.enabled && isBaseScreenProjected && annSlides.length > 0;

  useEffect(() => {
    if (!annActive) { setAnnIndex(0); return; }
    // Une seule annonce : rien à faire tourner, et un minuteur inutile
    // relancerait une transition toutes les N secondes pour le même texte.
    if (annSlides.length < 2) return;
    const timer = setInterval(
      () => setAnnIndex((i) => (i + 1) % annSlides.length),
      announcements.interval * 1000
    );
    return () => clearInterval(timer);
  }, [annActive, annSlides.length, announcements.interval]);

  // ROBUST SYNC: Ensures LiveView always matches the Controller
  const sync = async () => {
    localStorage.setItem('live_style', JSON.stringify(computedLiveSettings.textSettings));
    localStorage.setItem('live_bg', computedLiveSettings.bgImage);
    // Écrit AVANT le test `isLiveActive`, comme le style : la fenêtre de
    // projection lit ces clés à son ouverture, avant de recevoir le premier
    // évènement. Sans ça le fond s'affichait une fraction de seconde sans son
    // traitement, puis sautait.
    localStorage.setItem('live_bg_filters', JSON.stringify(computedLiveSettings.bgFilters));
    localStorage.setItem('live_header', JSON.stringify(computedLiveSettings.header));
    localStorage.setItem('live_transition', JSON.stringify(computedLiveSettings.transition));

    // On ne sort plus tôt quand la projection est fermée : l'écran retour peut
    // servir seul, en répétition, sans rien projeter à l'assemblée.
    if (!isLiveActive && !isStageActive) return;

    const { emit } = await import('@tauri-apps/api/event');

    // 1. Send Style & Background
    emit('update_live_style', computedLiveSettings.textSettings).catch(() => null);
    emit('update_live_bg', computedLiveSettings.bgImage).catch(() => null);
    emit('update_live_bg_filters', computedLiveSettings.bgFilters).catch(() => null);

    // 2. Compute Content
    let lyricsObj: any = { lines: [], reference: "", isBible: false };
    let mediaObj: any = null;

    // Écran d'accueil + annonces activées : on projette l'annonce courante,
    // avec le style et la transition de l'écran d'accueil.
    if (annActive) {
      lyricsObj = {
        lines: (annSlides[annIndex % annSlides.length] || "").split("\n"),
        reference: "",
        isBible: false,
      };
    }

    if (!isBaseScreenProjected && projectedSong) {
      if (['image', 'video', 'document', 'audio', 'youtube', 'link'].includes(projectedSong.type)) {
        mediaObj = {
          type: projectedSong.type,
          url: projectedSong.lyrics,
          // Pour un lien : vrai si le site accepte d'être affiché en cadre.
          // Vérifié à l'ajout ; `undefined` pour les liens ajoutés avant que
          // cette vérification existe, qu'on affiche alors comme avant.
          embeddable: projectedSong.embeddable,
          title: projectedSong.title,
        };
      } else if (projectedSong.type === 'markdown') {
        // Le Markdown garde sa structure : on transmet la diapo courante telle
        // quelle, la fenêtre de projection s'occupe du rendu.
        const slides = getSlides(projectedSong, slideSplit);
        const safeIdx = Math.max(0, Math.min(projectedVerseIdx, slides.length - 1));
        mediaObj = { type: 'markdown', url: slides[safeIdx] || '' };
      } else {
        // Même découpage que partout ailleurs. Cette ligne redécoupait le
        // texte à la main : l'aperçu et la projection pouvaient diverger dès
        // que la règle de découpage changeait.
        const verses = getSlides(projectedSong, slideSplit);
        const safeIdx = Math.max(0, Math.min(projectedVerseIdx, verses.length - 1));
        const currentVerse = verses[safeIdx] || "";
        const lines = currentVerse.split('\n');
        const isBible = projectedSong.type === 'bible';

        // Le numéro du verset est la première ligne de la diapo biblique :
        // c'est lui qui complète la référence (« Jean 3 » → « Jean 3:16 »).
        const refMatch = lines.length > 0 ? lines[0].match(/^(\d+)/) : null;
        // L'entête appliquée est celle de la portée du contenu projeté : un
        // cantique et un verset peuvent avoir chacun la leur.
        const liveHeader = computedLiveSettings.header;
        const reference = liveHeader.enabled
          ? buildHeaderText(liveHeader, projectedSong, isBible, refMatch?.[1])
          : "";
        // Les versions supplémentaires voyagent avec la diapo : la fenêtre de
        // projection n'a pas accès aux bases, elle ne fait que mettre en page.
        lyricsObj = {
          lines,
          reference,
          isBible,
          parallels: isBible ? parallelVerses : [],
          parallelStyle: {
            sizeFactor: liveParallel.sizeFactor,
            showBookName: liveParallel.showBookName,
          },
        };
      }
    }

    // 3. Emit atomic updates
    // La transition voyage AVEC le contenu, et non dans un évènement à part :
    // c'est la diapo qui arrive qui décide de la façon dont elle arrive. Un
    // évènement séparé pourrait être traité un cycle trop tard, et la diapo
    // s'afficherait avec la transition de la précédente.
    emit('update_live_content', {
      lyrics: lyricsObj,
      media: mediaObj,
      transition: computedLiveSettings.transition,
    }).catch(() => null);
    emit('update_live_hide_content', isContentHidden).catch(() => null);
    emit('update_live_clock', clockSettings).catch(() => null);
    emit('update_live_ticker', tickerSettings).catch(() => null);
    emit('update_live_header', computedLiveSettings.header).catch(() => null);

    // Écran retour : on lui envoie le texte DÉJÀ mis en forme, plus celui qui
    // suit. Il n'a ainsi aucune base à lire ni média à décoder — une fenêtre
    // de retour ne doit jamais ralentir la projection.
    if (isStageActive) {
      const stageSlides = projectedSong ? getSlides(projectedSong, slideSplit) : [];
      const stagePayload = {
        title: isBaseScreenProjected ? "Écran d'accueil" : (projectedSong?.title || ''),
        current: lyricsObj.lines || [],
        next: (!isBaseScreenProjected && projectedVerseIdx < stageSlides.length - 1)
          ? stageSlides[projectedVerseIdx + 1] : '',
        slide: Math.max(0, projectedVerseIdx),
        slides: isBaseScreenProjected ? 0 : stageSlides.length,
        settings: stage,
        fontFamily: computedLiveSettings.textSettings?.fontFamily,
        timerStart,
      };
      emit('update_stage', stagePayload).catch(() => null);
      localStorage.setItem('stage_payload', JSON.stringify(stagePayload));
    }
    emit('toggle_live_camera', isCameraActive).catch(() => null);
    emit('set_camera_id', selectedCamera).catch(() => null);
    emit('update_pdf_size', { width: pdfWidth, height: pdfHeight }).catch(() => null);

    localStorage.setItem('live_lyrics', JSON.stringify(lyricsObj));
    localStorage.setItem('live_media', JSON.stringify(mediaObj));
    localStorage.setItem('live_camera_active', JSON.stringify(isCameraActive));
    localStorage.setItem('live_camera_id', selectedCamera);
  };

  useEffect(() => {
    // Lower debounce (50ms) for instantaneous feel while still preventing race conditions
    const timer = setTimeout(() => {
      sync();
    }, 50);
    return () => clearTimeout(timer);
  }, [isLiveActive, computedLiveSettings, projectedSong, projectedVerseIdx, isBaseScreenProjected, isContentHidden, liveCategory, clockSettings, tickerSettings, parallelVerses, annActive, annIndex, annSlides, isStageActive, stage, timerStart, slideSplit, isCameraActive, selectedCamera, pdfWidth, pdfHeight]);

  // Télécommande : on rejoue les raccourcis clavier existants plutôt que de
  // dupliquer la navigation. Toute la logique (fin de chant → écran de base,
  // projection automatique…) reste donc au même endroit.
  useEffect(() => {
    const KEYS: Record<string, { key: string; alt?: boolean }> = {
      next:   { key: 'ArrowDown' },
      prev:   { key: 'ArrowUp' },
      black:  { key: 'n', alt: true },
      white:  { key: 'w', alt: true },
      normal: { key: 'r', alt: true },
      hide:   { key: 'h', alt: true },
      live:   { key: 'l', alt: true },
      base:   { key: 'b', alt: true },
      start:  { key: 'p', alt: true },
      clock:  { key: 'c', alt: true },
      ticker: { key: 'm', alt: true },
    };

    let unlisten: any;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<string>('remote_command', (e) => {
        const mapped = KEYS[e.payload];
        if (!mapped) return;
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: mapped.key,
          altKey: !!mapped.alt,
          bubbles: true,
        }));
      }).then((u) => { unlisten = u; });
    });
    return () => { if (unlisten) unlisten(); };
  }, []);

  // État publié pour la télécommande : l'opérateur voit sur son téléphone ce
  // qui est réellement projeté, plutôt que de cliquer à l'aveugle.
  useEffect(() => {
    const slides = projectedSong ? getSlides(projectedSong, slideSplit).length : 0;
    invoke('set_remote_state', {
      state: JSON.stringify({
        live: isLiveActive,
        base: isBaseScreenProjected,
        title: isBaseScreenProjected ? "Écran d'accueil" : (projectedSong?.title || ''),
        slide: projectedVerseIdx < 0 ? 0 : projectedVerseIdx,
        slides,
      }),
    }).catch(() => null);
  }, [isLiveActive, isBaseScreenProjected, projectedSong, projectedVerseIdx]);

  // Historique : on note ce qui part réellement à l'écran, une fois par
  // élément. Le doublon rapproché est filtré côté Rust, donc revenir sur un
  // chant pendant le culte ne le compte pas deux fois.
  useEffect(() => {
    if (!isLiveActive || isBaseScreenProjected || !projectedSong?.title) return;
    invoke('record_projection', {
      kind: projectedSong.type || liveCategory || 'agenda',
      title: projectedSong.title,
      number: projectedSong.number != null ? String(projectedSong.number) : null,
      book: projectedSong.book || null,
    }).catch((e) => console.warn('record_projection', e));
  }, [isLiveActive, isBaseScreenProjected, projectedSong?.id, projectedSong?.title]);

  useEffect(() => {
    let unlisten: any;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('live_ready', () => {
        sync();
        // Make a freshly-opened presentation window scroll to the current page.
        import('@tauri-apps/api/event').then(({ emit }) => emit('command_pdf_page', projectedPdfPage));
      }).then(u => unlisten = u);
    });
    return () => { if (unlisten) unlisten(); };
  }, [projectedSong, projectedVerseIdx, isBaseScreenProjected, isLiveActive, projectedPdfPage]);

  // The presentation window can drive the PDF page itself (keyboard / scroll /
  // on-screen buttons). It reports its visible page here so the controller's
  // mirror + indicator follow — WITHOUT echoing a command back (no fight).
  useEffect(() => {
    let unlisten: any;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('stage_ready', () => sync()).then(u => unlisten = u);
    });
    return () => { if (unlisten) unlisten(); };
  }, [projectedSong, projectedVerseIdx, isBaseScreenProjected, isStageActive, stage, timerStart]);

  useEffect(() => {
    let unlisten: any;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<number>('live_pdf_page_changed', (e) => setProjectedPdfPage(e.payload)).then(u => unlisten = u);
    });
    return () => { if (unlisten) unlisten(); };
  }, []);

  // Operator-initiated page change: update state AND command the live window to
  // scroll to that page. (Free scrolling on the live screen never comes here.)
  const commandProjectedPage = (p: number) => {
    const clamped = Math.max(1, projectedNumPages ? Math.min(p, projectedNumPages) : p);
    setProjectedPdfPage(clamped);
    import('@tauri-apps/api/event').then(({ emit }) => emit('command_pdf_page', clamped));
  };

  const getEditingSettings = () => {
    if (editingScope === 'base') {
      return specificSettings.base || {};
    }
    if (editingScope === 'verse' && activeSong && activeVerseIdx !== -1) {
      return specificSettings.verses[`${activeSong.id}_${activeVerseIdx}`] || {};
    }
    if (editingScope === 'song' && activeSong) {
      return specificSettings.songs[activeSong.id] || {};
    }
    if (editingScope === 'book' && activeSong?.book) {
      return specificSettings.books[activeSong.book] || {};
    }
    return settingsByCategory[activeCategory] || defaultStyles.chant;
  };

  const getEditingContext = () => {
    // Determine the base style to start from for the toolbar
    // Portée « catégorie » = l'onglet, c'est son sens même (« Tout : chants »).
    // Toute portée plus précise suit en revanche l'élément sélectionné.
    const category = (editingScope === 'category') ? activeCategory : categoryOf(activeSong);
    const baseStyle = settingsByCategory[category] || defaultStyles.chant;

    let txt = { ...baseStyle.textSettings };
    let bg = baseStyle.bgImage;
    let flt = { ...DEFAULT_BG_FILTERS, ...(baseStyle.bgFilters || {}) };
    let hdr = { ...baseHeader, ...(baseStyle.header || {}) };
    let trs = { ...DEFAULT_TRANSITION, ...(baseStyle.transition || {}) };
    let par = { ...DEFAULT_PARALLEL, ...(baseStyle.parallel || {}) };

    const target = getEditingSettings();
    txt = { ...txt, ...target.textSettings };
    if (target.bgImage) bg = target.bgImage;
    flt = { ...flt, ...(target.bgFilters || {}) };
    hdr = { ...hdr, ...(target.header || {}) };
    trs = { ...trs, ...(target.transition || {}) };
    par = { ...par, ...(target.parallel || {}) };

    return { textSettings: txt, bgImage: bg, bgFilters: flt, header: hdr, transition: trs, parallel: par };
  };

  const tbContext = getEditingContext();
  const tbTextSettings = tbContext.textSettings;
  const tbBgImage = tbContext.bgImage;
  const tbBgFilters = tbContext.bgFilters;
  const tbHeader = tbContext.header;
  const tbTransition = tbContext.transition;
  const tbParallel = tbContext.parallel;

  /**
   * Écrit UN champ de style dans la portée en cours d'édition.
   *
   * Les trois réglages (texte, image de fond, traitement du fond) suivent
   * exactement la même cascade de portées. Elle était recopiée pour chacun :
   * ajouter le traitement du fond aurait imposé une troisième copie, et une
   * correction sur l'une des trois ne se propageait pas aux autres.
   *
   * Au passage, le compartiment visé est RECOPIÉ avant écriture. L'ancienne
   * version écrivait dans `updated.verses[key]` d'un objet seulement copié en
   * surface : elle modifiait donc l'état précédent au passage.
   */
  const updateScopeField = (field: 'textSettings' | 'bgImage' | 'bgFilters' | 'header' | 'transition' | 'parallel', value: any) => {
    if (editingScope === 'category') {
      setSettingsByCategory((prev: any) => {
        const updated = {
          ...prev,
          [activeCategory]: { ...(prev[activeCategory] || defaultStyles.chant), [field]: value }
        };
        localStorage.setItem('appSettings', JSON.stringify(updated));
        return updated;
      });
      return;
    }
    setSpecificSettings((prev: any) => {
      const updated = { ...prev };
      const put = (bucket: 'books' | 'songs' | 'verses', key: string) => {
        updated[bucket] = {
          ...(updated[bucket] || {}),
          [key]: { ...(updated[bucket]?.[key] || {}), [field]: value },
        };
      };
      if (editingScope === 'base') {
        updated.base = { ...(updated.base || {}), [field]: value };
      } else if (editingScope === 'verse' && activeSong && activeVerseIdx !== -1) {
        put('verses', `${activeSong.id}_${activeVerseIdx}`);
      } else if (editingScope === 'song' && activeSong) {
        put('songs', String(activeSong.id));
      } else if (editingScope === 'book' && activeSong?.book) {
        put('books', activeSong.book);
      }
      return updated;
    });
  };

  const handleUpdateTextSettings = (next: any) =>
    updateScopeField('textSettings', typeof next === 'function' ? next(tbTextSettings) : next);

  const handleUpdateBgImage = (next: any) =>
    updateScopeField('bgImage', typeof next === 'function' ? next(tbBgImage) : next);

  const handleUpdateBgFilters = (next: any) =>
    updateScopeField('bgFilters', typeof next === 'function' ? next(tbBgFilters) : next);

  const handleUpdateHeader = (next: any) =>
    updateScopeField('header', typeof next === 'function' ? next(tbHeader) : next);

  const handleUpdateTransition = (next: any) =>
    updateScopeField('transition', typeof next === 'function' ? next(tbTransition) : next);

  const handleUpdateParallel = (next: any) =>
    updateScopeField('parallel', typeof next === 'function' ? next(tbParallel) : next);

  /**
   * Applique un thème à la portée en cours.
   *
   * Les mises à jour s'enchaînent sur le même état : React les applique dans
   * l'ordre, chacune partant du résultat de la précédente. L'enregistrement
   * final en localStorage contient donc bien les cinq champs.
   */
  const handleApplyTheme = (value: any) => {
    if (!value) return;
    if (value.textSettings) updateScopeField('textSettings', value.textSettings);
    if (value.bgImage) updateScopeField('bgImage', value.bgImage);
    if (value.bgFilters) updateScopeField('bgFilters', value.bgFilters);
    if (value.header) updateScopeField('header', value.header);
    if (value.transition) updateScopeField('transition', value.transition);
  };

  const clearSpecificSettings = () => {
    if (editingScope === 'category') return;
    setSpecificSettings((prev: any) => {
      let updated = { ...JSON.parse(JSON.stringify(prev)) };
      if (editingScope === 'base') {
        delete updated.base;
      } else if (editingScope === 'verse' && activeSong && activeVerseIdx !== -1) {
        const key = `${activeSong.id}_${activeVerseIdx}`;
        delete updated.verses[key];
      } else if (editingScope === 'song' && activeSong) {
        delete updated.songs[activeSong.id];
      } else if (editingScope === 'book' && activeSong?.book) {
        delete updated.books[activeSong.book];
      }
      return updated;
    });
  };



  // Largeur des colonnes : glissable et retenue. Voir src/lib/panes.ts.
  const [leftWidth, setLeftWidth, resetLeftWidth] = usePaneSize(PANES.left);
  const [rightWidth, setRightWidth, resetRightWidth] = usePaneSize(PANES.right);

  // Version biblique chargée : nécessaire pour ne pas se proposer soi-même
  // dans la liste des versions supplémentaires.
  const [activeBibleDb, setActiveBibleDb] = useState("");

  /**
   * Bases déjà chargées, par « catégorie:fichier ».
   *
   * Mesuré : une bible représente ~5 Mo de JSON à sérialiser côté Rust,
   * transférer, puis parser côté interface (1 188 chapitres avec leur texte).
   * Or l'effet qui choisit la base se redéclenche à CHAQUE bascule d'onglet,
   * et le fichier actif appartient alors à l'autre catégorie : ces 5 Mo
   * étaient donc repayés à chaque aller-retour entre Cantiques et Bibles.
   * C'est la principale cause de lenteur ressentie.
   *
   * Le cache est invalidé par l'évènement `dbs_changed`, émis par le backend
   * quand un module est installé ou supprimé.
   */
  const dbCache = useRef<Map<string, any[]>>(new Map());
  const loadedKey = useRef<string>("");

  useEffect(() => {
    let unlisten: any;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('dbs_changed', () => dbCache.current.clear()).then(u => { unlisten = u; });
    });
    return () => { if (unlisten) unlisten(); };
  }, []);

  const loadDbData = async (category: string, dbName: string) => {
    const key = `${category}:${dbName}`;
    setActiveCategory(category);
    if (category === "bible") setActiveBibleDb(dbName);

    if (!dbName) { setSongs([]); loadedKey.current = key; return; }

    const cached = dbCache.current.get(key);
    if (cached) {
      loadedKey.current = key;
      setSongs(cached);
      return;
    }

    setIsLoading(true);
    try {
      const command = category === "hymnes" ? "fetch_hymns" : "fetch_bible";
      const result: any[] = await invoke(command, { dbName });
      // Trois bases couvrent le va-et-vient habituel (un recueil, une ou deux
      // bibles) ; au-delà on libère la plus ancienne, une bible pesant
      // plusieurs méga-octets en mémoire.
      if (dbCache.current.size >= 3) {
        const oldest = dbCache.current.keys().next().value;
        if (oldest) dbCache.current.delete(oldest);
      }
      dbCache.current.set(key, result);
      loadedKey.current = key;
      setSongs(result);
    } catch (e) {
      console.error("Failed to load DB", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setIsLoading(false);
  }, []);

  return (
    <div className="flex flex-col h-screen w-full bg-[#18191c] overflow-hidden font-sans text-gray-200">
      {/* Uniquement dans la fenêtre de contrôle : `isLiveMode` a déjà renvoyé
          la vue de projection plus haut, qui ne doit rien afficher de tel. */}
      <UpdateBanner />

      {/* Reprise après incident. Discrète et refermable : si l'application
          s'est arrêtée hier, cette barre ne doit pas gêner la préparation
          d'aujourd'hui. */}
      {resumePoint && (
        <div className="flex shrink-0 items-center gap-3 border-b border-amber-500/25 bg-amber-500/[0.08] px-4 py-2">
          <AlertCircle size={14} className="shrink-0 text-amber-400" />
          <p className="min-w-0 flex-1 truncate text-xs text-amber-100">
            La séance s'est arrêtée {describeAge(resumePoint.savedAt)} sur
            {' '}« {resumePoint.title} », diapo {resumePoint.slideIndex + 1}.
          </p>
          <button
            onClick={applyResume}
            className="shrink-0 rounded-md bg-amber-500 px-3 py-1 text-[11px] font-bold text-black transition hover:bg-amber-400"
          >
            Reprendre ici
          </button>
          <button
            onClick={() => { setResumePoint(null); clearResumePoint(); }}
            title="Ignorer"
            className="shrink-0 rounded-full p-1 text-amber-300/70 transition hover:bg-white/10 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>
      )}
      <Toolbar
        setBgImage={handleUpdateBgImage}
        bgImage={tbBgImage}
        bgFilters={tbBgFilters}
        setBgFilters={handleUpdateBgFilters}
        textSettings={tbTextSettings}
        setTextSettings={handleUpdateTextSettings}
        sampleText={activeSong ? getSlides(activeSong, slideSplit)[activeVerseIdx] : undefined}
        isLiveActive={isLiveActive}
        handleLiveToggle={handleLiveToggle}
        editingScope={editingScope}
        setEditingScope={setEditingScope}
        activeSong={activeSong}
        activeVerseIdx={activeVerseIdx}
        activeCategory={activeCategory}
        clearSpecificSettings={clearSpecificSettings}
        isContentHidden={isContentHidden}
        setIsContentHidden={setIsContentHidden}
        isBaseScreenProjected={isBaseScreenProjected}
        setIsBaseScreenProjected={setIsBaseScreenProjected}
        cameraList={cameraList}
        selectedCamera={selectedCamera}
        setSelectedCamera={setSelectedCamera}
        isCameraActive={isCameraActive}
        setIsCameraActive={setIsCameraActive}
        clockSettings={clockSettings}
        setClockSettings={setClockSettings}
        tickerSettings={tickerSettings}
        setTickerSettings={setTickerSettings}
        headerSettings={tbHeader}
        setHeaderSettings={handleUpdateHeader}
        transition={tbTransition}
        setTransition={handleUpdateTransition}
        themeContext={tbContext}
        onApplyTheme={handleApplyTheme}
        parallel={tbParallel}
        setParallel={handleUpdateParallel}
        currentBibleDb={activeBibleDb}
        slideSplit={slideSplit}
        setSlideSplit={setSlideSplit}
        announcements={announcements}
        setAnnouncements={setAnnouncements}
        stage={stage}
        setStage={setStage}
        isStageActive={isStageActive}
        handleStageToggle={handleStageToggle}
        timerStart={timerStart}
        setTimerStart={setTimerStart}
        liveStatus={{
          title: projectedSong?.title || '',
          slide: projectedVerseIdx,
          slides: projectedSong ? getSlides(projectedSong, slideSplit).length : 0,
        }}
        refreshCameras={refreshCameras}
        setOverlayColor={setOverlayColor}
        cameraError={cameraError}
      />

      <div className="flex-1 flex min-h-0">
        <LeftSidebar
          width={leftWidth}
          songs={songs}
          playlist={playlist}
          setPlaylist={setPlaylist}
          onSelectSong={(song: any, category: string) => {
            setActiveSong(song);
            let startIdx = 0;
            if (song.startVerse) {
              const verses = getSlides(song, slideSplit);
              const foundIdx = verses.findIndex((v: string) => v.trim().startsWith(song.startVerse));
              if (foundIdx !== -1) startIdx = foundIdx;
            }
            setActiveVerseIdx(startIdx);
            if (category) setActiveCategory(category);
          }}
          isLoading={isLoading}
          onLoadDb={loadDbData}
          activeSong={activeSong}
          searchFocusTrigger={searchFocusTrigger}
          favoriteDbs={favoriteDbs}
          toggleFavoriteDb={(category: string, db: string) => {
            setFavoriteDbs((prev: any) => ({ ...prev, [category]: prev[category] === db ? "" : db }));
          }}
        />

        <ResizeHandle
          orientation="vertical"
          value={leftWidth}
          onChange={setLeftWidth}
          min={PANES.left.min}
          max={PANES.left.max}
          onReset={resetLeftWidth}
          title="Largeur de l'agenda et des listes · double-clic pour réinitialiser"
        />

        <MiddleEditor
          activeSong={activeSong}
          onSave={(updatedSong: any) => {
            setActiveSong(updatedSong);
            setPlaylist((prev: any[]) => prev.map(item => item.id === updatedSong.id ? updatedSong : item));
            // Rafraîchit aussi la liste source, sinon l'ancien titre/texte
            // réapparaît quand on re-sélectionne le chant depuis la sidebar.
            setSongs((prev: any[]) => {
              const next = prev.map(s => (s.id === updatedSong.id && s.book === updatedSong.book) ? updatedSong : s);
              // Sans ça, revenir sur l'onglet rechargerait la version d'avant
              // depuis le cache.
              if (loadedKey.current) dbCache.current.set(loadedKey.current, next);
              return next;
            });
          }}
          pdfWidth={pdfWidth}
          setPdfWidth={setPdfWidth}
          pdfHeight={pdfHeight}
          setPdfHeight={setPdfHeight}
          onProjectPage={(page: number) => {
            // Explicit action from the operator: project the current document at
            // the chosen page. (Free reading/scrolling never touches the live screen.)
            if (!activeSong) return;
            setProjectedSong(activeSong);
            setProjectedVerseIdx(0);
            setIsBaseScreenProjected(false);
            setLiveCategory(categoryOf(activeSong));
            commandProjectedPage(page);
          }}
        />

        <ResizeHandle
          orientation="vertical"
          value={rightWidth}
          onChange={setRightWidth}
          min={PANES.right.min}
          max={PANES.right.max}
          invert
          onReset={resetRightWidth}
          title="Largeur de l'aperçu de projection · double-clic pour réinitialiser"
        />

        <RightProjection
          width={rightWidth}
          activeSong={activeSong}
          projectedSong={projectedSong}
          projectedVerseIdx={projectedVerseIdx}
          bgImage={computedLiveSettings.bgImage}
          bgFilters={computedLiveSettings.bgFilters}
          textSettings={computedLiveSettings.textSettings}
          previewSettings={previewSettings.textSettings}
          previewBg={previewSettings.bgImage}
          isLiveActive={isLiveActive}
          activeVerseIdx={activeVerseIdx}
          setActiveVerseIdx={setActiveVerseIdx}
          onProject={(song: any, idx: number) => {
            setProjectedSong(song);
            setProjectedVerseIdx(idx);
            setIsBaseScreenProjected(false);
            setLiveCategory(categoryOf(song));
            if (song?.type === 'document') commandProjectedPage(1);
            else setProjectedPdfPage(1);
          }}
          projectedPdfPage={projectedPdfPage}
          commandProjectedPage={commandProjectedPage}
          projectedNumPages={projectedNumPages}
          setProjectedNumPages={setProjectedNumPages}
          isBaseScreenProjected={isBaseScreenProjected}
          setIsBaseScreenProjected={setIsBaseScreenProjected}
          ticker={tickerSettings}
          clock={clockSettings}
          header={computedLiveSettings.header}
          transition={computedLiveSettings.transition}
          slideSplit={slideSplit}
          parallels={parallelVerses}
          parallelStyle={liveParallel}
          onShrinkText={(size: number) => handleUpdateTextSettings({ ...tbTextSettings, fontSize: size })}
          onPlaySlideVideo={(v: any) => {
            // La vidéo devient le contenu projeté, comme n'importe quel média.
            // Revenir à la présentation se fait en reprojetant le document.
            setProjectedSong({
              id: `slide-video-${v.slide}`, title: v.name, number: '🎬',
              lyrics: v.path, type: 'video',
            });
            setProjectedVerseIdx(0);
            setIsBaseScreenProjected(false);
          }}
          mediaOverlay={null}
          isContentHidden={isContentHidden}
          isCameraActive={isCameraActive}
          selectedCamera={selectedCamera}
          currentTime={new Date()}
          overlayColor={overlayColor}
        />
      </div>
    </div>
  );
}

export default App;
