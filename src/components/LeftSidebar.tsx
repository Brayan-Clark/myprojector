import { useState, useEffect, useRef, useMemo } from 'react';
import { Save, FolderOpen, X, BookOpen, Music, Search as SearchIcon, List, Download, Plus, Trash2, ChevronUp, ChevronDown, FileText, Image as ImageIcon, Video, Type, Library as LibraryIcon, Heart, Headphones, Youtube, Globe, FileCode } from 'lucide-react';
import { Library } from './library/Library';
import Fuse from 'fuse.js';
import { invoke } from '@tauri-apps/api/core';

export function LeftSidebar({ songs, playlist, setPlaylist, onSelectSong, isLoading, onLoadDb, activeSong, searchFocusTrigger, favoriteDbs, toggleFavoriteDb }: any) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState('chant'); // 'chant' | 'bible' | 'store'
  const [hymneSearchTerm, setHymneSearchTerm] = useState('');
  const [bibleSearchTerm, setBibleSearchTerm] = useState('');
  const searchTerm = view === 'chant' ? hymneSearchTerm : bibleSearchTerm;
  const setSearchTerm = (val: string) => view === 'chant' ? setHymneSearchTerm(val) : setBibleSearchTerm(val);
  const [dbs, setDbs] = useState<string[]>([]);
  const [activeDb, setActiveDb] = useState("");
  // Bible specific state
  const [selectedBook, setSelectedBook] = useState("");
  const [selectedChapter, setSelectedChapter] = useState("");
  const [showAddMenu, setShowAddMenu] = useState(false);
  // Custom confirm dialog state (replaces window.confirm which doesn't work in Tauri/WebKit)
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);
  // Idem pour la saisie : window.prompt() ne fonctionne pas non plus sous
  // WebKitGTK — il renvoyait toujours null, donc l'ajout d'un lien YouTube ou
  // web ne se produisait jamais.
  const [promptDialog, setPromptDialog] = useState<{
    title: string; placeholder: string; hint?: string;
    onSubmit: (value: string) => void;
  } | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const [promptError, setPromptError] = useState<string | null>(null);

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
  const normalize = (v: any) =>
    String(v ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');

  // Fuse ne trouvait pas "1Jao 3" car le titre indexé s'écrit "1 Jaona 3".
  // On indexe donc aussi une version compacte du titre et l'abréviation
  // officielle du livre (books.short_name).
  const searchIndex = useMemo(
    () => songs.map((s: any) => ({
      ...s,
      _compact: normalize(s.title),
      _abbr: normalize(s.abbr),
      _abbrNum: `${normalize(s.abbr)}${normalize(s.number)}`,
    })),
    [songs]
  );

  const fuse = useMemo(() => new Fuse(searchIndex, {
    keys: ['title', 'number', 'book', '_compact', '_abbr', '_abbrNum'],
    threshold: 0.3,
    ignoreLocation: true // match anywhere in the title (faster + better for long titles)
  }), [searchIndex]);

  const searchResults = useMemo(() => searchTerm
      ? fuse.search(searchTerm, { limit: 200 }).map(result => result.item)
      : songs, [fuse, searchTerm, songs]);

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

  useEffect(() => {
    if (view === 'bible' && searchTerm.trim()) {
      // Le nom du livre peut commencer par un chiffre ET contenir une espace
      // ("1 Jaona"), ou être collé ("1Jao"). L'ancien motif exigeait des
      // caractères contigus, donc aucune référence en 1/2/3 ne fonctionnait.
      const match = searchTerm.match(
        /^\s*(\d?\s*[^\d\s.:,;]+)\s*[.\s]*(\d+)\s*[:.\s]*(\d+)?\s*-?\s*(\d+)?/i
      );
      if (match) {
        const [, bookAlias, chapter, vStart, vEnd] = match;
        const alias = normalize(bookAlias);
        // On accepte le nom complet comme l'abréviation, dans les deux sens :
        // "1jao" doit trouver "1 Jaona", et "1jaona" doit trouver l'abrégé "1jao".
        const bookNameStr = alias
          ? bibleBooks.find((b: any) => normalize(b).startsWith(alias)) ||
            bibleBooks.find((b: any) => {
              const song = songs.find((x: any) => x.book === b && x.abbr);
              const abbr = normalize(song?.abbr);
              return abbr && (abbr.startsWith(alias) || alias.startsWith(abbr));
            })
          : undefined;
        if (bookNameStr) {
          if (selectedBook !== bookNameStr) setSelectedBook(bookNameStr as string);
          if (selectedChapter !== chapter) setSelectedChapter(chapter);
          
          const chapterSong = songs.find((s:any) => s.book === bookNameStr && s.number === chapter);
          if (chapterSong && (activeSong?.id !== chapterSong.id || activeSong?.startVerse !== vStart)) {
            onSelectSong({ ...chapterSong, startVerse: vStart, endVerse: vEnd });
          }
        }
      }
    }
  }, [searchTerm, view, bibleBooks, songs]);

  useEffect(() => {
    setSelectedBook("");
    setSelectedChapter("");
  }, [activeDb, view]);

  const handleSaveAgenda = async () => {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const filePath = await save({ filters: [{ name: 'Agenda JSON', extensions: ['json'] }] });
      if (filePath) await invoke('save_playlist_file', { path: filePath, content: JSON.stringify(playlist, null, 2) });
    } catch (e) { console.error(e); }
  };

  const handleLoadAgenda = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const filePath = await open({ filters: [{ name: 'Agenda JSON', extensions: ['json'] }], multiple: false });
      if (filePath && typeof filePath === 'string') {
        const contents: string = await invoke('read_playlist_file', { path: filePath });
        const data = JSON.parse(contents);
        if (Array.isArray(data)) setPlaylist(data);
      }
    } catch (e) { console.error(e); }
  };

  const addToAgenda = () => {
    if (activeSong && !playlist.some((s:any) => s.id === activeSong.id)) {
      setPlaylist([...playlist, activeSong]);
    }
  };

  const addCustomItem = () => {
    const newItem = { id: Date.now().toString(), title: "Programme Libre", number: "📝", lyrics: "Entrez votre texte ici...", type: "custom" };
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
      id: Date.now().toString(),
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
          id: Date.now().toString(),
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
      const { resolveHymnAudio, hymnAudioSource } = await import('../lib/library');
      const track = await resolveHymnAudio(item.playback, item.number);
      if (!track) {
        alert(`Aucun playback trouvé pour le cantique ${item.number}.`);
        return;
      }
      const { src, offline } = await hymnAudioSource(item.playback, track);
      setPlaylist([...playlist, {
        id: Date.now().toString(),
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
          const newItem = { id: Date.now().toString(), title: filename, number: type === 'image' ? '🖼️' : '🎬', lyrics: httpUrl, type: type };
          setPlaylist([...playlist, newItem]);
        }
    } catch(e) { console.error('addMediaItem error:', e); alert('Erreur: ' + e); }
  };

  const addFileItem = async () => {
    try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const file = await open({
          multiple: false,
          filters: [{ name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt', 'md'] }]
        });
        if (file && typeof file === 'string') {
          const httpUrl: string = await invoke('import_media', { sourcePath: file });
          const filename = file.split(/[/\\]/).pop() || 'Document';
          const newItem = { id: Date.now().toString(), title: filename, number: '📄', lyrics: httpUrl, type: 'document' };
          setPlaylist([...playlist, newItem]);
        }
    } catch(e) { console.error('addFileItem error:', e); alert('Erreur: ' + e); }
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
          const newItem = { id: Date.now().toString(), title: filename, number: '🎵', lyrics: httpUrl, type: 'audio' };
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
        const newItem = { id: Date.now().toString(), title: 'Vidéo YouTube', number: '📺', lyrics: videoId, type: 'youtube' };
        setPlaylist([...playlist, newItem]);
        setPromptDialog(null);
      },
    });
  };

  const addLinkItem = () => {
    setPromptValue('');
    setPromptError(null);
    setPromptDialog({
      title: 'Ajouter un lien web',
      placeholder: 'https://exemple.org',
      hint: "Certains sites refusent d'être affichés dans une autre page ; dans ce cas l'écran restera vide.",
      onSubmit: (value) => {
        let url = value.trim();
        if (!url) return;
        // Sans schéma, l'iframe interprète l'adresse comme un chemin local et
        // n'affiche rien.
        if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
        const newItem = { id: Date.now().toString(), title: url, number: '🌐', lyrics: url, type: 'link' };
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
    
    const confirmMessage = ['image', 'video', 'audio', 'document'].includes(item.type)
      ? `Supprimer "${item.title}" ?\n\nLe fichier stocké sera supprimé définitivement.`
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
            // Only delete if it's a local file (not a URL or youtube)
            if (!lyricsPath.startsWith('http') && !lyricsPath.startsWith('blob:') && !lyricsPath.startsWith('data:')) {
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
    <div className="w-80 bg-[#202225] h-full flex flex-col border-r border-[#18191c]">
      {/* Custom Confirmation Modal Dialog */}
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
                Ajouter
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
                <p className="text-white font-bold text-sm mb-1">Confirmer la suppression</p>
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
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="flex-1 flex flex-col min-h-0 border-b border-[#18191c]">
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
               </div>
             )}
             <button className="p-1 hover:bg-[#3f4147] rounded text-gray-400 hover:text-white transition" onClick={handleLoadAgenda}><FolderOpen size={14} /></button>
             <button className="p-1 hover:bg-[#3f4147] rounded text-gray-400 hover:text-white transition" onClick={handleSaveAgenda}><Save size={14} /></button>
             <button className="p-1 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400 transition" onClick={() => setPlaylist([])}><X size={14} /></button>
           </div>
        </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
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
          <Library
            onClose={() => setView('chant')}
            onLoadDb={onLoadDb}
            onAddToPlaylist={(item: any) => setPlaylist([...playlist, item])}
          />
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
                <div className="relative">
                  <SearchIcon className="absolute left-2 top-2 text-gray-400" size={14} />
                  <input ref={searchRef} type="text" placeholder={view === 'chant' ? "Rechercher un chant, un numéro..." : "Un livre, un chapitre (ex: Jean 3:16)..."} className="w-full bg-[#1e1f22] text-xs text-gray-200 border border-[#36393f] rounded py-1.5 pl-7 pr-2 outline-none" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                {view === 'chant' ? (
                  isLoading ? <div className="text-xs text-gray-400 text-center mt-4">Chargement...</div> : searchResults.map((song: any) => (
                    <div key={song.id} style={{ contentVisibility: 'auto', containIntrinsicSize: '0 28px' } as any} className="px-2 py-1 rounded hover:bg-[#3f4147] cursor-pointer flex items-center gap-2 text-xs" onClick={() => onSelectSong(song, 'hymnes')}>
                      <Music size={10} className="text-gray-500" />
                      <span className="text-gray-400 w-6 font-mono">{song.number}</span>
                      <span className="text-gray-300 truncate">{song.title}</span>
                    </div>
                  ))
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
                             onClick={() => { setSelectedChapter(s.number); onSelectSong(s, 'bible'); }}
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
