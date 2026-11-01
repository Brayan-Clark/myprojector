import { useState, useEffect, useRef, useMemo, lazy, Suspense, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Save, FolderOpen, X, BookOpen, Music, Search as SearchIcon, List, Download, Plus, Trash2, ChevronUp, ChevronDown, FileText, Image as ImageIcon, Video, Type, Library as LibraryIcon, Heart, Headphones, Youtube, Globe, FileCode, Quote, Sparkles } from 'lucide-react';
import Fuse from 'fuse.js';
import { invoke } from '@tauri-apps/api/core';
import { ResizeHandle } from './ResizeHandle';
import { PANES, usePaneSize } from '../lib/panes';
import { focusSlideList, NEXT_KEYS, PREV_KEYS } from '../lib/keys';
import { BibleSearchResults, type BibleHit } from './BibleSearchResults';
import { normalizeBookName, parseBibleRef, resolveBook } from '../lib/bibleRef';
import { newItemId } from '../lib/items';
import {
  buildService, defaultServiceFileName, defaultServiceTitle,
  parseService, serializeService,
} from '../lib/service';
import { totalMinutes, formatDuration, type ServiceTemplate } from '../lib/serviceTemplates';
import { ServiceTemplatePicker } from './ServiceTemplatePicker';
import { buildSabbathPlan, describeSabbath } from '../lib/sabbathPlan';

/**
 * La bibliothèque est chargée à son ouverture, pas au démarrage.
 *
 * Ses treize sections entraînent avec elles les catalogues distants, les
 * cartes de langues et les grilles de fiches. Rien de tout cela ne sert
 * pendant un culte, et l'ensemble retardait le premier affichage de
 * l'application sur une machine lente.
 */
const Library = lazy(() => import('./library/Library').then((m) => ({ default: m.Library })));

export function LeftSidebar({ songs, playlist, setPlaylist, onSelectSong, isLoading, onLoadDb, activeSong, searchFocusTrigger, favoriteDbs, toggleFavoriteDb, width }: any) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState('chant'); // 'chant' | 'bible' | 'store'
  const [hymneSearchTerm, setHymneSearchTerm] = useState('');
  const [bibleSearchTerm, setBibleSearchTerm] = useState('');
  // Deux façons de chercher dans la Bible, donc deux saisies distinctes : on
  // ne perd pas la référence en cours en allant vérifier un mot, et basculer
  // d'un mode à l'autre ne relance pas la recherche de l'autre.
  const [bibleMode, setBibleMode] = useState<'ref' | 'text'>('ref');
  const [bibleTextTerm, setBibleTextTerm] = useState('');
  const [bibleHits, setBibleHits] = useState<BibleHit[]>([]);
  const [bibleSearching, setBibleSearching] = useState(false);
  const [bibleSearchError, setBibleSearchError] = useState<string | null>(null);
  const BIBLE_HIT_LIMIT = 300;

  const isBibleTextSearch = view === 'bible' && bibleMode === 'text';
  const searchTerm = view === 'chant'
    ? hymneSearchTerm
    : isBibleTextSearch ? bibleTextTerm : bibleSearchTerm;
  const setSearchTerm = (val: string) => view === 'chant'
    ? setHymneSearchTerm(val)
    : isBibleTextSearch ? setBibleTextTerm(val) : setBibleSearchTerm(val);
  const [dbs, setDbs] = useState<string[]>([]);
  const [activeDb, setActiveDb] = useState("");
  // Bible specific state
  const [selectedBook, setSelectedBook] = useState("");
  const [selectedChapter, setSelectedChapter] = useState("");
  const [showAddMenu, setShowAddMenu] = useState(false);
  // Custom confirm dialog state (replaces window.confirm which doesn't work in Tauri/WebKit)
  // Le titre et le libellé sont paramétrables : la même boîte sert à
  // supprimer un élément ET à confirmer le remplacement d'un agenda. Figée
  // sur « Confirmer la suppression », elle annonçait une suppression là où
  // l'opérateur ouvrait simplement un autre culte.
  const [confirmDialog, setConfirmDialog] = useState<{
    message: string;
    onConfirm: () => void;
    title?: string;
    confirmLabel?: string;
  } | null>(null);
  // Idem pour la saisie : window.prompt() ne fonctionne pas non plus sous
  // WebKitGTK — il renvoyait toujours null, donc l'ajout d'un lien YouTube ou
  // web ne se produisait jamais.
  const [promptDialog, setPromptDialog] = useState<{
    title: string; placeholder: string; hint?: string;
    submitLabel?: string;
    onSubmit: (value: string) => void;
  } | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const [promptError, setPromptError] = useState<string | null>(null);
  // Conversion d'un document bureautique : plusieurs secondes, il faut le
  // montrer. Et dire clairement quoi installer si aucune suite n'est présente.
  const [converting, setConverting] = useState<string | null>(null);
  const [officeNotice, setOfficeNotice] = useState<string | null>(null);
  // Retour visible des actions sur l'agenda (enregistrer, ouvrir, modèle).
  // Ces actions échouaient en silence dans la console, inaccessible ici.
  const [agendaNotice, setAgendaNotice] =
    useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  // Hauteur de l'agenda : un culte à trois chants et un culte à quinze
  // n'ont pas besoin de la même place. Retenue entre deux séances.
  const [agendaHeight, setAgendaHeight, resetAgendaHeight] = usePaneSize(PANES.agenda);

  useEffect(() => {
    if (searchFocusTrigger > 0) {
      if (view === 'store') setView('chant');
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [searchFocusTrigger]);

  // Keyboard Shortcuts to switch views
  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
       if (e.altKey && e.key === '1') { e.preventDefault(); setView('chant'); }
       if (e.altKey && e.key === '2') { e.preventDefault(); setView('bible'); }
       if (e.altKey && e.key === '3') { e.preventDefault(); setView('store'); }
    };
    window.addEventListener('keydown', handleGlobalKeys);
    return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, []);

  useEffect(() => {
    async function fetchDbs() {
      if (view === 'store') return;
      try {
        const category = view === 'chant' ? 'hymnes' : 'bible';
        const result = await invoke<string[]>("list_dbs", { category });
        setDbs(result);
        
        // Use favorite if available and current active is invalid or empty
        const favorite = favoriteDbs[category];
        if (favorite && result.includes(favorite)) {
           if (activeDb !== favorite) {
              setActiveDb(favorite);
              onLoadDb(category, favorite);
           }
        } else if (result.length > 0 && !result.includes(activeDb)) {
          setActiveDb(result[0]);
          onLoadDb(category, result[0]);
        } else if (result.length === 0) {
          setActiveDb("");
          onLoadDb(category, "");
        }
      } catch (e) { console.error(e); }
    }
    fetchDbs();
  }, [view, favoriteDbs]);

  // "1Jao", "1 Jaona", "1jao." doivent tous mener au même livre : on compare
  // des formes normalisées (sans accents, sans espaces, sans ponctuation).
  // La règle vit dans `lib/bibleRef.ts`, où elle est testée.
  const normalize = normalizeBookName;

  // Fuse ne trouvait pas "1Jao 3" car le titre indexé s'écrit "1 Jaona 3".
  // On indexe donc aussi une version compacte du titre et l'abréviation
  // officielle du livre (books.short_name).
  //
  // ⚠ Uniquement en vue Recueils. Construit systématiquement, cet index
  // recopiait les 1 188 chapitres d'une bible et alimentait un index Fuse qui
  // n'est jamais interrogé de ce côté — du travail pur perte à chaque
  // chargement de bible.
  const searchIndex = useMemo(
    () => view !== 'chant' ? [] : songs.map((s: any) => ({
      ...s,
      _compact: normalize(s.title),
      _abbr: normalize(s.abbr),
      _abbrNum: `${normalize(s.abbr)}${normalize(s.number)}`,
    })),
    [songs, view]
  );

  const fuse = useMemo(
    () => (view !== 'chant' ? null : new Fuse(searchIndex, {
      keys: ['title', 'number', 'book', '_compact', '_abbr', '_abbrNum'],
      threshold: 0.3,
      ignoreLocation: true // match anywhere in the title (faster + better for long titles)
    })),
    [searchIndex, view]
  );

  // Fuse n'est utile qu'à la liste des recueils. Le lancer aussi en vue Bible
  // faisait une recherche approchée sur 31 000 chapitres à chaque frappe de
  // référence, pour un résultat que personne n'affiche.
  const searchResults = useMemo(() => {
    if (view !== 'chant' || !fuse) return songs;
    return searchTerm ? fuse.search(searchTerm, { limit: 200 }).map(r => r.item) : songs;
  }, [view, fuse, searchTerm, songs]);

  const getDbDisplayName = (db: string) => {
    const base = db.replace('.db', '').replace('.SQLite3', '');
    const map: Record<string, string> = {
      "MG65": "Malagasy (MG1965)",
      "DIEM": "Malagasy (DIEM)",
      "Louis_Segond": "Français (Louis Segond)",
      "KJV": "English (KJV)",
      "Ostervald": "Français (Ostervald)",
      "BDS": "Français (Semeur)",
      "S21": "Français (Segond 21)",
      "NVI": "English (NVI)",
    };
    if (map[base]) return map[base];
    return base.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
  };



  // Memoised so they keep a stable reference between renders — this also stops
  // the reference-parsing effect below (which depends on bibleBooks) from
  // re-running on every single render.
  const bibleBooks = useMemo(
    () => (view === 'bible' ? Array.from(new Set(songs.map((s: any) => s.book))) : []),
    [view, songs]
  );
  const bibleChapters = useMemo(
    () => (view === 'bible' && selectedBook ? songs.filter((s: any) => s.book === selectedBook) : []),
    [view, selectedBook, songs]
  );

  // --- Recherche par mot / phrase -----------------------------------------
  // Débounce : chaque appel balaie la base entière côté Rust. À 150 ms on
  // lance une recherche par mot tapé ; à 300 ms on en lance une par mot écrit.
  useEffect(() => {
    if (!isBibleTextSearch) return;
    const query = bibleTextTerm.trim();
    if (query.length < 2 || !activeDb) {
      setBibleHits([]);
      setBibleSearchError(null);
      setBibleSearching(false);
      return;
    }
    let cancelled = false;
    setBibleSearching(true);
    const timer = setTimeout(() => {
      invoke<BibleHit[]>('search_bible', { dbName: activeDb, query, limit: BIBLE_HIT_LIMIT })
        .then((hits) => {
          if (cancelled) return;
          setBibleHits(hits);
          setBibleSearchError(null);
        })
        .catch((e) => {
          if (cancelled) return;
          setBibleHits([]);
          setBibleSearchError(`Recherche impossible : ${e}`);
        })
        .finally(() => { if (!cancelled) setBibleSearching(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [isBibleTextSearch, bibleTextTerm, activeDb]);

  /**
   * Ouvre le chapitre d'un résultat, positionné sur le bon verset.
   * `startVerse` est le mécanisme déjà utilisé par la résolution de référence
   * ("Jean 3:16") : la liste des diapos s'ouvre directement au verset.
   */
  const openBibleHit = (hit: BibleHit) => {
    const chapterSong = songs.find(
      (s: any) => s.book === hit.book && s.number === String(hit.chapter)
    );
    if (!chapterSong) {
      setBibleSearchError(
        `Le chapitre ${hit.book} ${hit.chapter} n'est pas dans la version chargée.`
      );
      return;
    }
    setSelectedBook(hit.book);
    setSelectedChapter(String(hit.chapter));
    onSelectSong({ ...chapterSong, startVerse: String(hit.verse) }, 'bible');
    focusSlideList();
  };

  useEffect(() => {
    // Uniquement en mode Référence : en mode Texte, « amour de Dieu » n'est
    // pas une référence et la résolution sautait de chapitre en chapitre à
    // chaque lettre tapée.
    if (view === 'bible' && bibleMode === 'ref' && searchTerm.trim()) {
      // Découpage et résolution du livre : voir `lib/bibleRef.ts`, qui porte
      // les cas tordus (noms commençant par un chiffre, abréviations) et leurs
      // tests.
      const ref = parseBibleRef(searchTerm);
      if (ref) {
        const { chapter, verseStart: vStart, verseEnd: vEnd } = ref;
        const abbrOf = (book: string) =>
          songs.find((x: any) => x.book === book && x.abbr)?.abbr;
        const bookNameStr = resolveBook(ref.bookAlias, bibleBooks as string[], abbrOf);
        if (bookNameStr) {
          if (selectedBook !== bookNameStr) setSelectedBook(bookNameStr);
          if (selectedChapter !== chapter) setSelectedChapter(chapter);

          const chapterSong = songs.find((s:any) => s.book === bookNameStr && s.number === chapter);
          if (chapterSong && (activeSong?.id !== chapterSong.id || activeSong?.startVerse !== vStart)) {
            onSelectSong({ ...chapterSong, startVerse: vStart, endVerse: vEnd });
          }
        }
      }
    }
  }, [searchTerm, view, bibleMode, bibleBooks, songs]);

  useEffect(() => {
    setSelectedBook("");
    setSelectedChapter("");
  }, [activeDb, view]);

  /**
   * Sortie du champ de recherche vers la navigation au clavier.
   *
   * Tant que le curseur reste dans le champ, les flèches sont (volontairement)
   * ignorées par la projection. On rend donc la main explicitement :
   *   Entrée  → prend le premier résultat et passe à la liste des diapos
   *   Flèches → passe à la liste, et la touche est rejouée pour que le premier
   *             appui déplace déjà la sélection
   *   Échap   → quitte simplement le champ
   */
  const handleSearchKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      focusSlideList();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // En vue Bible par référence, la résolution a déjà sélectionné le
      // chapitre pendant la frappe : il n'y a rien à choisir de plus.
      if (view === 'chant' && searchResults.length > 0) {
        onSelectSong(searchResults[0], 'hymnes');
      } else if (isBibleTextSearch && bibleHits.length > 0) {
        openBibleHit(bibleHits[0]);
        return; // openBibleHit rend déjà la main au clavier
      }
      focusSlideList();
      return;
    }
    if (NEXT_KEYS.includes(e.key) || PREV_KEYS.includes(e.key)) {
      e.preventDefault();
      focusSlideList();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, bubbles: true }));
    }
  };

  /**
   * Enregistre le culte.
   *
   * On demande son titre : un dossier de `agenda.json`, `agenda(1).json`,
   * `agenda(2).json` ne dit pas lequel est le culte du sabbat prochain. Le
   * titre devient aussi le nom proposé, donc répondre suffit.
   */
  const handleSaveAgenda = () => {
    if (playlist.length === 0) {
      setAgendaNotice({ kind: 'error', text: "L'agenda est vide : il n'y a rien à enregistrer." });
      return;
    }
    setPromptError(null);
    setPromptValue(defaultServiceTitle());
    setPromptDialog({
      title: 'Enregistrer le culte',
      placeholder: 'Culte du sabbat…',
      hint: `${playlist.length} élément(s). Le titre sert à le retrouver plus tard.`,
      submitLabel: 'Enregistrer',
      onSubmit: async (value: string) => {
        // La boîte se referme AVANT d'ouvrir le sélecteur de fichier : les
        // autres appelants la ferment eux-mêmes, et l'oublier laissait la
        // saisie par-dessus la fenêtre d'enregistrement du système.
        setPromptDialog(null);
        try {
          const { save } = await import('@tauri-apps/plugin-dialog');
          const filePath = await save({
            defaultPath: defaultServiceFileName(),
            filters: [{ name: 'Culte MyProjector', extensions: ['json'] }],
          });
          if (!filePath) return;
          const document = buildService(playlist, { title: value });
          await invoke('save_playlist_file', {
            path: filePath,
            content: serializeService(document),
          });
          setAgendaNotice({ kind: 'ok', text: `« ${document.title} » enregistré.` });
        } catch (e) {
          // Un échec d'écriture (disque plein, clé USB retirée) doit se VOIR.
          setAgendaNotice({ kind: 'error', text: `Enregistrement impossible : ${e}` });
        }
      },
    });
  };

  /**
   * Ouvre un culte enregistré.
   *
   * Deux choses que l'ancienne version ne faisait pas :
   *   - elle REMPLAÇAIT l'agenda en cours sans prévenir, donc un clic de trop
   *     effaçait une préparation ;
   *   - sur un fichier illisible, elle écrivait dans la console et rien
   *     d'autre. « Rien ne se passe » est le pire retour possible.
   */
  const handleLoadAgenda = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const filePath = await open({
        filters: [{ name: 'Culte MyProjector', extensions: ['json'] }],
        multiple: false,
      });
      if (!filePath || typeof filePath !== 'string') return;

      const contents: string = await invoke('read_playlist_file', { path: filePath });
      // `parseService` lève un message explicite : on le laisse remonter.
      const { document, origin, dropped } = parseService(contents);

      const apply = () => {
        setPlaylist(document.items);
        const details = [
          `${document.items.length} élément(s)`,
          origin === 'legacy' ? 'ancien format converti' : null,
          dropped > 0 ? `${dropped} élément(s) illisible(s) écarté(s)` : null,
        ].filter(Boolean).join(' · ');
        setAgendaNotice({
          kind: dropped > 0 ? 'error' : 'ok',
          text: `« ${document.title} » ouvert — ${details}.`,
        });
      };

      if (playlist.length > 0) {
        setConfirmDialog({
          title: 'Remplacer l\'agenda en cours ?',
          confirmLabel: 'Remplacer',
          message:
            `L'agenda actuel contient ${playlist.length} élément(s) et sera perdu `
            + `s'il n'a pas été enregistré.\n\nOuvrir « ${document.title} » ?`,
          onConfirm: () => { setConfirmDialog(null); apply(); },
        });
      } else {
        apply();
      }
    } catch (e) {
      setAgendaNotice({
        kind: 'error',
        text: e instanceof Error ? e.message : `Ouverture impossible : ${e}`,
      });
    }
  };

  /**
   * Insère un modèle de déroulé.
   *
   * L'ordre d'un culte est toujours le même, et c'est précisément pour ça
   * qu'on en oublie une étape. Le modèle ne contient aucun contenu : chaque
   * étape est un repère que l'opérateur remplace.
   */
  const [showTemplates, setShowTemplates] = useState(false);
  const applyTemplate = (template: ServiceTemplate, items: any[]) => {
    // On AJOUTE à la suite plutôt que de remplacer : l'opérateur a parfois
    // déjà placé deux cantiques avant de penser au déroulé.
    setPlaylist([...playlist, ...items]);
    const duration = formatDuration(totalMinutes(template));
    setAgendaNotice({
      kind: 'ok',
      text: `« ${template.label} » ajouté — ${items.length} étapes`
        + (duration ? ` · environ ${duration}` : '') + '.',
    });
    setShowTemplates(false);
    setShowAddMenu(false);
  };

  /**
   * Prépare le culte du sabbat en un geste.
   *
   * Réunit la leçon de l'École du Sabbat de la semaine, la méditation
   * Mofon'aina du jour et le déroulé du culte — soit la dizaine de clics
   * répartis dans trois écrans qu'on refait chaque semaine.
   *
   * Le compte rendu est AFFICHÉ, y compris ce qui manque : un culte à trous
   * découvert devant l'assemblée serait pire que pas de génération du tout.
   */
  const [preparingSabbath, setPreparingSabbath] = useState(false);
  const prepareSabbath = async () => {
    setShowAddMenu(false);
    setPreparingSabbath(true);
    setAgendaNotice({ kind: 'ok', text: 'Préparation du sabbat…' });
    try {
      // La langue est celle choisie dans la section École du Sabbat : on ne la
      // redemande pas, l'opérateur l'a déjà dite une fois.
      const lang = localStorage.getItem('ssLang') || 'mg';
      const plan = await buildSabbathPlan({ lang });

      const apply = () => {
        setPlaylist([...playlist, ...plan.items]);
        const lines = [
          `Sabbath du ${describeSabbath(plan.date)} — ${plan.items.length} élément(s).`,
          ...plan.included.map((i) => `• ${i}`),
          ...plan.missing.map((m) => `⚠ ${m}`),
        ];
        setAgendaNotice({
          kind: plan.missing.length > 0 ? 'error' : 'ok',
          text: lines.join('\n'),
        });
      };

      if (playlist.length > 0) {
        setConfirmDialog({
          title: 'Ajouter le culte du sabbat ?',
          confirmLabel: 'Ajouter',
          message:
            `${plan.items.length} élément(s) seront ajoutés à la suite des `
            + `${playlist.length} déjà présents.`,
          onConfirm: () => { setConfirmDialog(null); apply(); },
        });
      } else {
        apply();
      }
    } catch (e) {
      setAgendaNotice({ kind: 'error', text: `Préparation impossible : ${e}` });
    } finally {
      setPreparingSabbath(false);
    }
  };

  const addToAgenda = () => {
    if (activeSong && !playlist.some((s:any) => s.id === activeSong.id)) {
      setPlaylist([...playlist, activeSong]);
    }
  };

  const addCustomItem = () => {
    const newItem = { id: newItemId(), title: "Programme Libre", number: "📝", lyrics: "Entrez votre texte ici...", type: "custom" };
    setPlaylist([...playlist, newItem]);
    onSelectSong(newItem, 'agenda');
  };

  const MARKDOWN_TEMPLATE = `# Titre de la présentation

Texte en **gras**, en *italique*, et une liste :

- premier point
- deuxième point

---

## Deuxième diapo

> Une citation mise en avant.

| Colonne A | Colonne B |
| --------- | --------- |
| valeur    | valeur    |
`;

  const addMarkdownItem = () => {
    const newItem = {
      id: newItemId(),
      title: "Présentation Markdown",
      number: "📑",
      lyrics: MARKDOWN_TEMPLATE,
      type: "markdown",
    };
    setPlaylist([...playlist, newItem]);
    onSelectSong(newItem, 'agenda');
  };

  /**
   * Importe un .md : on stocke le TEXTE, pas le chemin, pour que l'agenda
   * reste autonome (un agenda enregistré reste lisible si le fichier bouge).
   */
  const importMarkdownItem = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const file = await open({
        multiple: false,
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdx'] }],
      });
      if (file && typeof file === 'string') {
        const content: string = await invoke('read_text_file', { path: file });
        const filename = file.split(/[/\\]/).pop() || 'Markdown';
        const newItem = {
          id: newItemId(),
          title: filename.replace(/\.(md|markdown|mdx)$/i, ''),
          number: '📑',
          lyrics: content,
          type: 'markdown',
        };
        setPlaylist([...playlist, newItem]);
        onSelectSong(newItem, 'agenda');
      }
    } catch (e) {
      console.error('importMarkdownItem error:', e);
      alert('Import Markdown impossible : ' + e);
    }
  };

  /**
   * Ajoute à l'agenda le playback du cantique sélectionné.
   * Si l'audio a été téléchargé depuis la bibliothèque il est lu hors ligne ;
   * sinon on utilise directement le flux en ligne, sans rien installer.
   */
  const addHymnAudio = async (e: any, item: any) => {
    e.stopPropagation();
    try {
      const { resolveHymnAudio, hymnAudioSource, localHymnAudio } = await import('../lib/library');

      // Fichier déjà téléchargé : on le sert sans jamais interroger le réseau.
      // Sinon une coupure de connexion rendait inutilisable un playback pourtant
      // présent sur le disque.
      const local = await localHymnAudio(item.playback, item.number);
      if (local) {
        const { cleanUrl } = await import('../lib/media');
        const url = cleanUrl(local.path);
        if (url) {
          setPlaylist([...playlist, {
            id: newItemId(),
            title: `♪ ${item.title}`,
            number: '🎵',
            lyrics: url,
            type: 'audio',
          }]);
          return;
        }
      }

      const track = await resolveHymnAudio(item.playback, item.number);
      if (!track) {
        alert(`Aucun playback trouvé pour le cantique ${item.number}.`);
        return;
      }
      const { src, offline } = await hymnAudioSource(item.playback, track);
      setPlaylist([...playlist, {
        id: newItemId(),
        title: `♪ ${item.title}${offline ? '' : ' (en ligne)'}`,
        number: '🎵',
        lyrics: src,
        type: 'audio',
      }]);
    } catch (err) {
      console.error('addHymnAudio', err);
      alert('Playback indisponible : ' + err);
    }
  };

  const addMediaItem = async (type: 'image' | 'video') => {
    try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const file = await open({
          multiple: false,
          filters: type === 'image' ? [{ name: 'Images', extensions: ['png', 'jpeg', 'jpg', 'webp', 'gif'] }] : [{ name: 'Videos', extensions: ['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi', 'm4v'] }]
        });
        if (file && typeof file === 'string') {
          // Copy to public/media/ for HTTP access (required on Linux - asset:// doesn't support Range requests)
          const httpUrl: string = await invoke('import_media', { sourcePath: file });
          const filename = file.split(/[/\\]/).pop() || 'Media';
          const newItem = { id: newItemId(), title: filename, number: type === 'image' ? '🖼️' : '🎬', lyrics: httpUrl, type: type };
          setPlaylist([...playlist, newItem]);
        }
    } catch(e) { console.error('addMediaItem error:', e); alert('Erreur: ' + e); }
  };

  const addFileItem = async () => {
    try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const file = await open({
          multiple: false,
          filters: [{ name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'odt', 'odp', 'ods', 'xls', 'xlsx', 'rtf', 'txt', 'md'] }]
        });
        if (file && typeof file === 'string') {
          const filename = file.split(/[/\\]/).pop() || 'Document';

          // Document bureautique : on le convertit en PDF avec la suite
          // installée sur le poste, puis on l'affiche comme n'importe quel
          // PDF. La conversion prend plusieurs secondes — on la fait ICI, à la
          // préparation, jamais pendant la projection.
          let sourceForImport = file;
          let slideVideos: any[] = [];
          if (/\.(docx?|pptx?|odt|odp|ods|xlsx?|rtf)$/i.test(file)) {
            const office: any = await invoke('office_status');
            if (!office?.available) {
              setOfficeNotice(
                "Pour projeter un document Word ou PowerPoint, installez une suite bureautique " +
                "libre — LibreOffice (libreoffice.org) ou ONLYOFFICE. L'application s'en servira " +
                "pour convertir le fichier, sans jamais l'ouvrir devant l'assemblée."
              );
              return;
            }
            setConverting(filename);
            try {
              sourceForImport = await invoke<string>('convert_office_to_pdf', { sourcePath: file });
              // Le PDF est figé : une vidéo intégrée y devient une image morte.
              // On va donc la rechercher dans l'archive et on la rattache à sa
              // diapo, qui est aussi sa page dans le PDF.
              if (/\.pptx?$/i.test(file)) {
                try {
                  slideVideos = await invoke<any[]>('extract_pptx_videos', { sourcePath: file });
                } catch (e) {
                  console.warn('Vidéos du pptx non extraites:', e);
                }
              }
            } finally {
              setConverting(null);
            }
          }

          const httpUrl: string = await invoke('import_media', { sourcePath: sourceForImport });
          const newItem: any = {
            id: newItemId(), title: filename, number: '📄',
            lyrics: httpUrl, type: 'document',
          };
          if (slideVideos.length > 0) {
            // Rattachées à l'élément : l'opérateur verra, sur la page
            // concernée, qu'une vidéo est disponible.
            newItem.slideVideos = slideVideos;
            setOfficeNotice(
              `${slideVideos.length} vidéo${slideVideos.length > 1 ? 's' : ''} récupérée${slideVideos.length > 1 ? 's' : ''} ` +
              `dans cette présentation. Elle${slideVideos.length > 1 ? 's' : ''} se lance${slideVideos.length > 1 ? 'nt' : ''} ` +
              `depuis la page correspondante, pendant la projection.`
            );
          }
          setPlaylist([...playlist, newItem]);
        }
    } catch(e) {
      console.error('addFileItem error:', e);
      setConverting(null);
      setOfficeNotice('La conversion a échoué : ' + e);
    }
  };

  const addAudioItem = async () => {
    try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const file = await open({
          multiple: false,
          filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a'] }]
        });
        if (file && typeof file === 'string') {
          const httpUrl: string = await invoke('import_media', { sourcePath: file });
          const filename = file.split(/[/\\]/).pop() || 'Audio';
          const newItem = { id: newItemId(), title: filename, number: '🎵', lyrics: httpUrl, type: 'audio' };
          setPlaylist([...playlist, newItem]);
        }
    } catch(e) { console.error('addAudioItem error:', e); alert('Erreur: ' + e); }
  };

  /**
   * Extrait l'identifiant d'une vidéo YouTube.
   * Couvre les formes réellement rencontrées : watch?v=, youtu.be/, /embed/,
   * /live/ et /shorts/. Renvoie null si rien n'est reconnaissable — mieux vaut
   * le dire que d'enregistrer une URL entière qui ne s'affichera jamais.
   */
  const extractYoutubeId = (input: string): string | null => {
    const url = input.trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(url)) return url; // déjà un identifiant
    const patterns = [
      /[?&]v=([A-Za-z0-9_-]{11})/,
      /youtu\.be\/([A-Za-z0-9_-]{11})/,
      /\/embed\/([A-Za-z0-9_-]{11})/,
      /\/live\/([A-Za-z0-9_-]{11})/,
      /\/shorts\/([A-Za-z0-9_-]{11})/,
    ];
    for (const re of patterns) {
      const m = url.match(re);
      if (m) return m[1];
    }
    return null;
  };

  const addYoutubeItem = () => {
    setPromptValue('');
    setPromptError(null);
    setPromptDialog({
      title: 'Ajouter une vidéo YouTube',
      placeholder: 'https://www.youtube.com/watch?v=…',
      hint: "Collez l'adresse de la vidéo. Les formats youtu.be, /live/ et /shorts/ sont reconnus.",
      onSubmit: (value) => {
        const videoId = extractYoutubeId(value);
        if (!videoId) {
          setPromptError("Adresse YouTube non reconnue : impossible d'y trouver un identifiant de vidéo.");
          return;
        }
        const newItem = { id: newItemId(), title: 'Vidéo YouTube', number: '📺', lyrics: videoId, type: 'youtube' };
        setPlaylist([...playlist, newItem]);
        setPromptDialog(null);
      },
    });
  };

  // Mémorise qu'on a déjà prévenu pour le lien en cours de saisie : un site
  // injoignable n'est pas forcément une erreur (réseau coupé au moment de la
  // préparation), l'opérateur doit pouvoir insister.
  const promptForced = useRef(false);

  const addLinkItem = () => {
    promptForced.current = false;
    setPromptValue('');
    setPromptError(null);
    setPromptDialog({
      title: 'Ajouter un lien web',
      placeholder: 'https://exemple.org',
      hint: "L'adresse est vérifiée à l'ajout : beaucoup de sites refusent d'être affichés dans une autre application.",
      onSubmit: async (value) => {
        let url = value.trim();
        if (!url) return;
        // Sans schéma, l'iframe interprète l'adresse comme un chemin local et
        // n'affiche rien.
        if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

        // On interroge le site MAINTENANT. Découvrir en plein culte qu'un lien
        // s'affiche en blanc est le pire moment possible : mesuré, Google,
        // GitHub et jw.org refusent tous le cadre.
        let embeddable = true;
        let reason = '';
        try {
          setPromptError('Vérification du site…');
          const check: any = await invoke('check_embeddable', { url });
          embeddable = !!check.embeddable;
          reason = check.reason || '';
          if (!check.reachable) {
            setPromptError(`${reason} Ajouter quand même ?`);
            // Deuxième appui = l'opérateur insiste, on ajoute.
            if (!promptForced.current) { promptForced.current = true; return; }
          }
        } catch {
          // La vérification est un confort : si elle échoue, on n'empêche pas
          // d'ajouter le lien.
        }
        promptForced.current = false;

        const newItem = {
          id: newItemId(), title: url, number: '🌐', lyrics: url,
          type: 'link', embeddable, embedReason: reason,
        };
        setPlaylist([...playlist, newItem]);
        setPromptDialog(null);
      },
    });
  };

  const moveAgendaItem = (e: any, index: number, dir: 'up'|'down') => {
    e.stopPropagation();
    const newList = [...playlist];
    if (dir === 'up' && index > 0) [newList[index-1], newList[index]] = [newList[index], newList[index-1]];
    else if (dir === 'down' && index < newList.length - 1) [newList[index+1], newList[index]] = [newList[index], newList[index+1]];
    setPlaylist(newList);
  };

  const removeAgendaItem = async (e: any, index: number) => {
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation(); // Extra safety
    const item = playlist[index];
    
    const sharedWithOther = playlist.some(
      (other: any, i: number) => i !== index && other?.lyrics === item?.lyrics
    );
    const confirmMessage = ['image', 'video', 'audio', 'document'].includes(item.type)
      ? (sharedWithOther
          ? `Supprimer "${item.title}" de l'agenda ?\n\nLe fichier est encore utilisé par un autre élément : il sera conservé.`
          : `Supprimer "${item.title}" ?\n\nLe fichier stocké sera supprimé définitivement.`)
      : `Supprimer "${item.title}" de l'agenda ?`;

    // Use custom React dialog instead of window.confirm() which doesn't work in Tauri/WebKit
    setConfirmDialog({
      message: confirmMessage,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          // The stored path is an absolute path (from import_media which returns absolute path)
          if (['image', 'video', 'audio', 'document'].includes(item.type) && item.lyrics) {
            const lyricsPath = item.lyrics as string;
            // Handle both absolute paths and relative /media/ paths
            let absolutePath = lyricsPath;
            if (lyricsPath.startsWith('/media/') || lyricsPath.startsWith('media/')) {
              const appDataPath = localStorage.getItem('appDataPath') || '';
              const stripped = lyricsPath.startsWith('/') ? lyricsPath.slice(1) : lyricsPath;
              absolutePath = `${appDataPath}/${stripped}`;
            }
            // ⚠ Le même fichier peut être utilisé par PLUSIEURS éléments :
            // un cantique projeté deux fois dans le culte, un document ajouté
            // à nouveau. Le supprimer parce qu'on retire l'un d'eux casserait
            // silencieusement les autres — on ne touche au disque que si plus
            // personne ne s'en sert.
            const stillUsed = playlist.some(
              (other: any, i: number) => i !== index && other?.lyrics === lyricsPath
            );
            // Only delete if it's a local file (not a URL or youtube)
            if (!stillUsed
                && !lyricsPath.startsWith('http') && !lyricsPath.startsWith('blob:') && !lyricsPath.startsWith('data:')) {
              // ATTENTION : Tauri v2 attend les paramètres en camelCase.
              // Avec `file_path`, l'appel échouait à chaque fois et le fichier
              // restait sur le disque — l'erreur était avalée par un warning.
              await invoke('delete_media', { filePath: absolutePath });
            }
          }
        } catch (err) {
          // On informe : un échec silencieux laissait le disque se remplir.
          console.error('Delete media error:', err);
          alert(`Le fichier n'a pas pu être supprimé du disque :\n${err}\n\nL'élément est retiré de l'agenda.`);
        }
        const newList = [...playlist];
        newList.splice(index, 1);
        setPlaylist(newList);
      }
    });
  };

  return (
    <div
      className="bg-[#202225] h-full flex flex-col shrink-0 min-w-0"
      style={{ width: width ?? 320 }}
    >
      {/* Custom Confirmation Modal Dialog */}
      {/* Sélecteur de déroulé : plein écran, parce qu'il montre la source et
          le déroulé complet avant d'insérer quoi que ce soit. */}
      {showTemplates && (
        <ServiceTemplatePicker
          onClose={() => setShowTemplates(false)}
          onApply={applyTemplate}
        />
      )}

      {promptDialog && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
          onClick={() => setPromptDialog(null)}
        >
          <div
            className="bg-[#2b2d31] border border-[#36393f] rounded-lg shadow-2xl p-6 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-white font-bold text-sm mb-3">{promptDialog.title}</h3>
            <input
              autoFocus
              type="text"
              value={promptValue}
              placeholder={promptDialog.placeholder}
              onChange={(e) => { setPromptValue(e.target.value); setPromptError(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') promptDialog.onSubmit(promptValue);
                if (e.key === 'Escape') setPromptDialog(null);
              }}
              className="w-full bg-[#18191c] text-gray-100 text-sm rounded px-3 py-2 outline-none ring-1 ring-[#5865f2] placeholder:text-gray-600"
            />
            {promptDialog.hint && (
              <p className="mt-2 text-[11px] leading-relaxed text-gray-500">{promptDialog.hint}</p>
            )}
            {promptError && (
              <p className="mt-2 rounded border border-red-500/20 bg-red-500/10 p-2 text-[11px] text-red-400">
                {promptError}
              </p>
            )}
            <div className="flex justify-end gap-2 mt-5">
              <button
                className="px-4 py-2 text-xs font-bold text-gray-300 hover:text-white bg-[#36393f] hover:bg-[#4f545c] rounded transition"
                onClick={() => setPromptDialog(null)}
              >
                Annuler
              </button>
              <button
                className="px-4 py-2 text-xs font-bold text-white bg-[#5865f2] hover:bg-[#4752c4] rounded transition"
                onClick={() => promptDialog.onSubmit(promptValue)}
              >
                {promptDialog.submitLabel || 'Ajouter'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDialog && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
          <div className="bg-[#2b2d31] border border-[#36393f] rounded-lg shadow-2xl p-6 max-w-sm w-full mx-4">
            <div className="flex items-start gap-3 mb-5">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center shrink-0 mt-0.5">
                <Trash2 size={18} className="text-red-400" />
              </div>
              <div>
                <p className="text-white font-bold text-sm mb-1">{confirmDialog.title || 'Confirmer la suppression'}</p>
                <p className="text-gray-300 text-xs whitespace-pre-line leading-relaxed">{confirmDialog.message}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                className="px-4 py-2 text-xs font-bold text-gray-300 hover:text-white bg-[#36393f] hover:bg-[#3f4147] rounded transition"
                onClick={() => setConfirmDialog(null)}
              >
                Annuler
              </button>
              <button
                className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded transition"
                onClick={confirmDialog.onConfirm}
              >
                {confirmDialog.confirmLabel || 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}
      <div
        className="flex flex-col min-h-0 shrink-0"
        style={{ height: agendaHeight }}
      >
        <div className="p-2 bg-[#2b2d31] flex items-center justify-between border-b border-[#18191c]">
           <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-2 text-gray-300">
             <List size={14} /> Agenda
           </span>
           <div className="flex items-center gap-1 relative">
             <button className="p-1 hover:bg-[#3f4147] rounded text-gray-400 hover:text-white transition" onClick={() => setShowAddMenu(!showAddMenu)}><Plus size={14} /></button>
             {showAddMenu && (
               <div className="absolute top-full right-0 mt-1 w-48 bg-[#2b2d31] border border-[#36393f] rounded shadow-xl z-50 py-1">
                 <button className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-[#5865f2] hover:text-white transition flex items-center gap-2" onClick={() => { addToAgenda(); setShowAddMenu(false); }}><Music size={12} /> Sélection</button>
                 <button className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-[#5865f2] hover:text-white transition flex items-center gap-2" onClick={() => { addCustomItem(); setShowAddMenu(false); }}><Type size={12} /> Libre</button>
                  <button className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-[#5865f2] hover:text-white transition flex items-center gap-2" onClick={() => { addMarkdownItem(); setShowAddMenu(false); }}><FileCode size={12} /> Markdown</button>
                  <button className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-[#5865f2] hover:text-white transition flex items-center gap-2" onClick={() => { importMarkdownItem(); setShowAddMenu(false); }}><FileCode size={12} /> Importer un .md</button>
                  <button className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-[#5865f2] hover:text-white transition flex items-center gap-2" onClick={() => { addMediaItem('image'); setShowAddMenu(false); }}><ImageIcon size={12} /> Image</button>
                  <button className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-[#5865f2] hover:text-white transition flex items-center gap-2" onClick={() => { addMediaItem('video'); setShowAddMenu(false); }}><Video size={12} /> Vidéo</button>
                  <button className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-[#5865f2] hover:text-white transition flex items-center gap-2" onClick={() => { addAudioItem(); setShowAddMenu(false); }}><Headphones size={12} /> Audio</button>
                  <button className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-[#5865f2] hover:text-white transition flex items-center gap-2" onClick={() => { addYoutubeItem(); setShowAddMenu(false); }}><Youtube size={12} /> YouTube</button>
                  <button className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-[#5865f2] hover:text-white transition flex items-center gap-2" onClick={() => { addLinkItem(); setShowAddMenu(false); }}><Globe size={12} /> Lien Web</button>
                  <button className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-[#5865f2] hover:text-white transition flex items-center gap-2" onClick={() => { addFileItem(); setShowAddMenu(false); }}><FileText size={12} /> Fichier</button>

                  {/* Préparation du sabbat : réunit la leçon de la semaine, la
                      méditation du jour et le déroulé. Mise en avant parce que
                      c'est le geste de chaque semaine. */}
                  <div className="mt-1 border-t border-[#36393f] pt-1">
                    <button
                      disabled={preparingSabbath}
                      title="Leçon de l'École du Sabbat, Mofon'aina du jour et déroulé du culte"
                      className="w-full text-left px-3 py-2 text-xs font-bold text-amber-300 hover:bg-amber-500 hover:text-black transition flex items-center gap-2 disabled:opacity-50"
                      onClick={prepareSabbath}
                    >
                      <Sparkles size={12} />
                      {preparingSabbath ? 'Préparation…' : 'Préparer le sabbat'}
                    </button>
                  </div>

                  {/* Un seul point d'entrée : le sélecteur montre les
                      déroulés, leur source et leur contenu avant insertion.
                      Une liste de noms dans un menu n'aurait rien dit de ce
                      qu'on ajoute. */}
                  <button
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-[#5865f2] hover:text-white transition flex items-center gap-2"
                    onClick={() => { setShowTemplates(true); setShowAddMenu(false); }}
                  >
                    <List size={12} /> Déroulé de culte…
                  </button>
               </div>
             )}
             <button title="Ouvrir un culte enregistré" className="p-1 hover:bg-[#3f4147] rounded text-gray-400 hover:text-white transition" onClick={handleLoadAgenda}><FolderOpen size={14} /></button>
             <button title="Enregistrer ce culte" className="p-1 hover:bg-[#3f4147] rounded text-gray-400 hover:text-white transition" onClick={handleSaveAgenda}><Save size={14} /></button>
             {/* Confirmation obligatoire : ce bouton effaçait tout l'agenda
                 d'un seul clic, à côté de « enregistrer ». Maintenant qu'un
                 culte se prépare à l'avance, le geste coûte trop cher. */}
             <button
               title="Vider l'agenda"
               className="p-1 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400 transition"
               onClick={() => {
                 if (playlist.length === 0) return;
                 setConfirmDialog({
                   title: 'Vider l\'agenda ?',
                   confirmLabel: 'Vider',
                   message: `${playlist.length} élément(s) seront retirés.\n\nEnregistre le culte d'abord si tu veux le retrouver.`,
                   onConfirm: () => { setConfirmDialog(null); setPlaylist([]); setAgendaNotice(null); },
                 });
               }}
             >
               <X size={14} />
             </button>
           </div>
        </div>

        {/* Retour des actions sur l'agenda. Refermable, et jamais bloquant. */}
        {agendaNotice && (
          <div className={`flex items-start gap-2 px-2 py-1.5 text-[11px] leading-snug ${
            agendaNotice.kind === 'ok'
              ? 'bg-emerald-500/10 text-emerald-300'
              : 'bg-red-500/10 text-red-300'
          }`}>
            {/* `pre-line` : le compte rendu du sabbat tient sur plusieurs
                lignes (ce qui a été trouvé, ce qui manque). */}
            <span className="min-w-0 flex-1 whitespace-pre-line">{agendaNotice.text}</span>
            <button
              onClick={() => setAgendaNotice(null)}
              className="shrink-0 rounded p-0.5 opacity-70 transition hover:bg-white/10 hover:opacity-100"
            >
              <X size={11} />
            </button>
          </div>
        )}
      <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
        {/* Conversion d'un document bureautique : elle dure plusieurs secondes,
            il faut donc qu'elle se voie, sinon on croit que rien ne se passe. */}
        {converting && (
          <div className="mb-2 flex items-center gap-2 rounded border border-[#5865f2]/40 bg-[#5865f2]/10 px-2 py-1.5">
            <FileText size={12} className="shrink-0 animate-pulse text-[#8891f2]" />
            <span className="truncate text-[10px] text-gray-300">
              Conversion de <span className="font-bold">{converting}</span>…
            </span>
          </div>
        )}
        {officeNotice && (
          <div className="mb-2 rounded border border-amber-500/40 bg-amber-950/60 p-2">
            <p className="text-[10px] leading-relaxed text-amber-200">{officeNotice}</p>
            <button
              className="mt-1.5 rounded bg-amber-500 px-2 py-0.5 text-[9px] font-black text-amber-950"
              onClick={() => setOfficeNotice(null)}
            >
              COMPRIS
            </button>
          </div>
        )}
        {playlist.length === 0 ? <div className="text-xs text-gray-500 text-center mt-4">Agenda vide</div> : playlist.map((item: any, idx: number) => (
          <div 
            key={item.id} 
            className={`px-2 py-1.5 rounded hover:bg-[#36393f] cursor-pointer flex items-center gap-2 group transition text-sm ${activeSong?.id === item.id ? 'bg-[#36393f] border-l-2 border-[#5865f2]' : 'border-l-2 border-transparent'}`}
            onClick={() => onSelectSong(item, item.type === 'bible' ? 'bible' : 'hymnes')}
          >
            {item.type === 'image' && <ImageIcon size={12} className="text-pink-400 shrink-0" />}
            {item.type === 'video' && <Video size={12} className="text-purple-400 shrink-0" />}
            {item.type === 'audio' && <Headphones size={12} className="text-green-400 shrink-0" />}
            {item.type === 'youtube' && <Youtube size={12} className="text-red-500 shrink-0" />}
            {item.type === 'link' && <Globe size={12} className="text-blue-400 shrink-0" />}
            {item.type === 'document' && <FileText size={12} className="text-orange-400 shrink-0" />}
            {item.type === 'custom' && <Type size={12} className="text-yellow-400 shrink-0" />}
            {item.type === 'markdown' && <FileCode size={12} className="text-cyan-400 shrink-0" />}
            {(!item.type || item.type === 'bible' || item.type === 'hymnes') && <Music size={12} className="text-[#5865f2] shrink-0" />}
            <span className="text-gray-400 w-8 shrink-0">{item.number}</span>
            <span className="text-gray-200 truncate flex-1">{item.title}</span>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
              {item.playback && (
                <button
                  className="p-1 hover:bg-emerald-500/20 rounded text-gray-400 hover:text-emerald-400"
                  title="Ajouter le playback de ce cantique"
                  onClick={(e) => addHymnAudio(e, item)}
                ><Headphones size={12} /></button>
              )}
              <button 
                className="p-1 hover:bg-[#2b2d31] rounded text-gray-400 hover:text-white"
                onClick={(e) => moveAgendaItem(e, idx, 'up')}
              ><ChevronUp size={12} /></button>
              <button 
                className="p-1 hover:bg-[#2b2d31] rounded text-gray-400 hover:text-white"
                onClick={(e) => moveAgendaItem(e, idx, 'down')}
              ><ChevronDown size={12} /></button>
              <button 
                className="p-1 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400"
                onClick={(e) => removeAgendaItem(e, idx)}
              ><Trash2 size={12} /></button>
            </div>
          </div>
        ))}
      </div>
      </div>

      <ResizeHandle
        orientation="horizontal"
        value={agendaHeight}
        onChange={setAgendaHeight}
        min={PANES.agenda.min}
        max={PANES.agenda.max}
        onReset={resetAgendaHeight}
        title="Hauteur de l'agenda · double-clic pour réinitialiser"
      />

      <div className="flex-1 flex flex-col min-h-0 bg-[#2f3136]">
        <div className="flex bg-[#202225] text-xs">
          <button className={`flex-1 py-2 font-bold border-b-2 transition flex items-center justify-center gap-1.5 ${view === 'chant' ? 'border-[#5865f2] text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`} onClick={() => setView('chant')}>
             <Music size={14} /> Recueils
          </button>
          <button className={`flex-1 py-2 font-bold border-b-2 transition flex items-center justify-center gap-1.5 ${view === 'bible' ? 'border-[#5865f2] text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`} onClick={() => setView('bible')}>
             <BookOpen size={14} /> Bibles
          </button>
          <button className={`flex-1 py-2 font-bold border-b-2 transition flex items-center justify-center gap-1.5 ${view === 'store' ? 'border-[#5865f2] text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`} onClick={() => setView('store')} title="Recueils, bibles, documents, audio, raccourcis…">
             <LibraryIcon size={14} /> Bibliothèque
          </button>
        </div>
        
        {view === 'store' && (
          /* La bibliothèque est chargée à l'ouverture, pas au démarrage : ses
             treize sections ne servent pas pendant un culte, et elles
             retardaient le premier affichage de l'application. Ici le
             chargement est sans risque — c'est un clic de l'opérateur, pas une
             diapo attendue par l'assemblée. */
          <Suspense fallback={
            <div className="flex-1 flex items-center justify-center text-xs text-gray-500">
              Ouverture de la bibliothèque…
            </div>
          }>
            <Library
              onClose={() => setView('chant')}
              onLoadDb={onLoadDb}
              onAddToPlaylist={(item: any) => setPlaylist([...playlist, item])}
            />
          </Suspense>
        )}
        

        {view !== 'store' && (
           <>
              <div className="p-2 border-b border-[#202225] flex flex-col gap-2">
                <div className="flex gap-1.5 items-center">
                  <select 
                    className="flex-1 bg-[#1e1f22] text-xs text-gray-200 border border-[#36393f] rounded py-1.5 px-2 outline-none appearance-none cursor-pointer focus:ring-1 focus:ring-[#5865f2]" 
                    style={{ backgroundImage: `url('data:image/svg+xml;utf8,<svg fill="currentColor" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z" fill="%239CA3AF"/></svg>')`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 4px center', backgroundSize: '16px' }}
                    value={activeDb} 
                    onChange={(e) => { setActiveDb(e.target.value); onLoadDb(view === 'chant' ? 'hymnes' : 'bible', e.target.value); }}
                  >
                    {dbs.length === 0 && <option value="">Aucun module</option>}
                    {dbs.map(db => <option key={db} value={db} className="bg-[#2b2d31]">{getDbDisplayName(db)}</option>)}
                  </select>
                  {activeDb && (
                    <button 
                      className={`p-1.5 transition rounded ${favoriteDbs[view === 'chant' ? 'hymnes' : 'bible'] === activeDb ? 'text-red-500 hover:text-red-400' : 'text-gray-500 hover:text-gray-300'}`} 
                      title="Définir comme module par défaut" 
                      onClick={() => toggleFavoriteDb(view === 'chant' ? 'hymnes' : 'bible', activeDb)}
                    >
                      <Heart size={14} fill={favoriteDbs[view === 'chant' ? 'hymnes' : 'bible'] === activeDb ? "currentColor" : "none"} />
                    </button>
                  )}
                  <button className="bg-[#5865f2] p-1.5 rounded hover:bg-[#4752c4] transition" title="Ouvrir la bibliothèque (recueils, bibles, documents, Mofon'aina, audio)" onClick={() => setView('store')}><Download size={14} /></button>
                </div>
                {view === 'bible' && (
                  /* Deux manières de chercher : par référence quand on sait où
                     aller, par mots quand on ne se rappelle que le texte. */
                  <div className="flex items-center gap-1 rounded bg-[#1e1f22] p-0.5 text-[10px] font-bold">
                    <button
                      className={`flex flex-1 items-center justify-center gap-1 rounded py-1 transition ${bibleMode === 'ref' ? 'bg-[#5865f2] text-white' : 'text-gray-400 hover:text-gray-200'}`}
                      onClick={() => setBibleMode('ref')}
                      title="Aller à un livre, un chapitre, un verset (ex: Jean 3:16)"
                    >
                      <BookOpen size={11} /> Référence
                    </button>
                    <button
                      className={`flex flex-1 items-center justify-center gap-1 rounded py-1 transition ${bibleMode === 'text' ? 'bg-[#5865f2] text-white' : 'text-gray-400 hover:text-gray-200'}`}
                      onClick={() => { setBibleMode('text'); setTimeout(() => searchRef.current?.focus(), 0); }}
                      title="Chercher un mot ou une phrase dans tout le texte biblique"
                    >
                      <Quote size={11} /> Texte
                    </button>
                  </div>
                )}
                <div className="relative">
                  <SearchIcon className="absolute left-2 top-2 text-gray-400" size={14} />
                  <input
                    ref={searchRef}
                    type="text"
                    placeholder={
                      view === 'chant' ? "Rechercher un chant, un numéro..."
                        : bibleMode === 'text' ? 'Un mot, une phrase ("exacte")…'
                          : "Un livre, un chapitre (ex: Jean 3:16)..."
                    }
                    className="w-full bg-[#1e1f22] text-xs text-gray-200 border border-[#36393f] rounded py-1.5 pl-7 pr-2 outline-none focus:border-[#5865f2]"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={handleSearchKeyDown}
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                {view === 'chant' ? (
                  isLoading ? <div className="text-xs text-gray-400 text-center mt-4">Chargement...</div> : searchResults.map((song: any) => (
                    <div key={song.id} style={{ contentVisibility: 'auto', containIntrinsicSize: '0 28px' } as any} className="px-2 py-1 rounded hover:bg-[#3f4147] cursor-pointer flex items-center gap-2 text-xs" onClick={() => { onSelectSong(song, 'hymnes'); focusSlideList(); }}>
                      <Music size={10} className="text-gray-500" />
                      <span className="text-gray-400 w-6 font-mono">{song.number}</span>
                      <span className="text-gray-300 truncate">{song.title}</span>
                    </div>
                  ))
                ) : bibleMode === 'text' ? (
                  <BibleSearchResults
                    query={bibleTextTerm}
                    hits={bibleHits}
                    loading={bibleSearching}
                    error={bibleSearchError}
                    onPick={openBibleHit}
                    truncated={bibleHits.length >= BIBLE_HIT_LIMIT}
                  />
                ) : (
                  !selectedBook ? (
                    <div className="grid grid-cols-2 gap-1.5">
                      {bibleBooks.map((book: any) => <button key={book} className="bg-[#1e1f22] hover:bg-[#5865f2] text-xs rounded py-2 truncate" onClick={() => setSelectedBook(book)}>{book}</button>)}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 mb-1">
                        <button className="text-[10px] text-gray-400 hover:text-white bg-[#1e1f22] px-2 py-0.5 rounded border border-[#36393f] transition-colors hover:bg-[#2b2d31]" onClick={() => { setSelectedBook(""); setSelectedChapter(""); }}>← Retour</button>
                        <span className="text-xs font-bold text-[#5865f2] truncate uppercase tracking-tighter">{selectedBook}</span>
                      </div>
                      <div className="grid grid-cols-5 gap-1.5">
                        {bibleChapters.map((s:any) => (
                           <button 
                             key={s.id} 
                             className={`text-xs py-2 rounded font-bold transition ${selectedChapter === s.number ? 'bg-[#5865f2] text-white shadow-md' : 'bg-[#1e1f22] text-gray-400 hover:bg-[#3f4147]'}`} 
                             onClick={() => { setSelectedChapter(s.number); onSelectSong(s, 'bible'); focusSlideList(); }}
                           >
                             {s.number}
                           </button>
                        ))}
                      </div>
                    </div>
                  )
                )}
              </div>
           </>
        )}
      </div>
    </div>
  );
}
