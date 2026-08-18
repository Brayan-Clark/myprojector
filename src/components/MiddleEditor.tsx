import { useState, useEffect, useMemo } from 'react';
import { FileText, Plus, Save, Edit3, Eye } from 'lucide-react';
import { AudioPlayer } from './AudioPlayer';
import { MarkdownView } from './MarkdownView';
import { getSlides } from '../lib/slides';
import { fileExtension, isProjectableDocument, openWithSystem } from '../lib/openExternal';
import { invoke } from '@tauri-apps/api/core';
import { cleanUrl } from '../lib/media';
import { PdfViewer } from './PdfViewer';
export function MiddleEditor({
  activeSong, onSave, pdfWidth, setPdfWidth, pdfHeight, setPdfHeight, onProjectPage
}: {
  activeSong: any, onSave: (s:any) => void,
  pdfWidth: number, setPdfWidth: (v: number) => void,
  pdfHeight: number, setPdfHeight: (v: number) => void,
  onProjectPage: (page: number) => void
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [localTitle, setLocalTitle] = useState("");
  const [localContent, setLocalContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [viewPage, setViewPage] = useState(1);

  useEffect(() => {
    if (activeSong) {
      setLocalTitle(activeSong.title || "");
      setLocalContent(activeSong.lyrics || "");
      setIsEditing(false);
      setTextContent(null);
      setNumPages(0);
      setViewPage(1);

      const fileUrl = activeSong.lyrics || "";

      // Load PDF as blob
      if (activeSong.type === 'document' && fileUrl.toLowerCase().endsWith('.pdf')) {
        const urlToFetch = cleanUrl(fileUrl);
        if (urlToFetch) {
          fetch(urlToFetch)
            .then(r => r.blob())
            .then(blob => setPdfBlobUrl(URL.createObjectURL(blob)))
            .catch(e => { console.error("PDF Preview Load Error:", e); setPdfBlobUrl(null); });
        }
      } else {
        setPdfBlobUrl(null);
      }

      // Load .txt content via Rust
      if (activeSong.type === 'document' && fileUrl.toLowerCase().endsWith('.txt')) {
        const appDataPath = localStorage.getItem('appDataPath');
        let fullPath = fileUrl;
        if (appDataPath && (fileUrl.startsWith('media/') || fileUrl.startsWith('/media/'))) {
           const stripped = fileUrl.startsWith('/') ? fileUrl.slice(1) : fileUrl;
           fullPath = `${appDataPath}/${stripped}`;
        }
        invoke("read_text_file", { path: fullPath })
          .then((content: any) => setTextContent(content))
          .catch(e => setTextContent("Impossible de lire le fichier: " + e));
      }
    }
    return () => { if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl); };
  }, [activeSong?.id, activeSong?.lyrics]);

  const handleSave = async () => {
    if (!activeSong) return;
    setIsSaving(true);
    try {
      // Assuming db_name mapped back to original db, or activeSong.book
      // But book is pure book name for bible.
      // Hymnes are from adventools_data... 
      // For hymnes, activeSong.book contains the dbName without .db. So book + ".db".
      if (!activeSong.type || !['custom', 'image', 'video', 'document'].includes(activeSong.type)) {
        const isBible = activeSong.number === "Chap" || isNaN(Number(activeSong.number));
        const dbName = isBible ? `${activeSong.book}.SQLite3` : `${activeSong.book}.db`;
        
        await invoke("update_song", {
          dbName,
          isBible,
          id: typeof activeSong.id === 'string' ? parseInt(activeSong.id) : activeSong.id,
          title: localTitle,
          content: localContent
        });
      }
      
      onSave({ ...activeSong, title: localTitle, lyrics: localContent });
      setIsEditing(false);
    } catch (e) {
      alert("Erreur lors de la sauvegarde: " + e);
    } finally {
      setIsSaving(false);
    }
  };
  // Aperçu vivant : on découpe le texte EN COURS d'édition, pas celui enregistré.
  const slides = useMemo(
    () => (activeSong?.type === 'markdown' ? getSlides({ ...activeSong, lyrics: localContent }) : []),
    [activeSong, localContent]
  );

  if (!activeSong) {
    return (
      <div className="flex-1 bg-[#36393f] flex items-center justify-center text-gray-500">
         Sélectionnez un chant pour l'éditer.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[#36393f]">
      {/* En-tête Editeur */}
      <div className="h-10 bg-[#2f3136] flex items-center px-4 border-b border-[#202225] gap-4 flex-shrink-0">
        <div className="flex items-center gap-2 text-[#5865f2] font-semibold text-sm">
           <FileText size={16} /> Paroles
        </div>
        <div className="flex bg-[#202225] rounded p-0.5">
           <button 
             className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition ${!isEditing ? 'bg-[#36393f] text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
             onClick={() => setIsEditing(false)}
           >
              <Eye size={12} /> Vue
           </button>
           <button 
             className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition ${isEditing ? 'bg-[#36393f] text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
             onClick={() => setIsEditing(true)}
           >
              <Edit3 size={12} /> Éditer
           </button>
        </div>

        {/* Audio associé : playback d'un cantique ou chapitre de la Bible
            malgache. N'apparaît que si l'élément en a un. */}
        <AudioPlayer song={activeSong} />
        <div className="ml-auto flex items-center gap-3">
           {!isEditing && activeSong?.type === 'document' && (
              <div className="flex items-center gap-3 bg-[#202225] px-2 py-0.5 rounded border border-[#18191c]">
                 <div className="flex items-center gap-1">
                    <span className="text-[9px] text-gray-400 font-bold">L:</span>
                    <input 
                       type="range" min="10" max="400" value={pdfWidth} 
                       onChange={(e) => setPdfWidth(parseInt(e.target.value))}
                       className="w-12 h-1 accent-[#5865f2] cursor-pointer"
                    />
                 </div>
                 <div className="flex items-center gap-1">
                    <span className="text-[9px] text-gray-400 font-bold">H:</span>
                    <input 
                       type="range" min="10" max="400" value={pdfHeight} 
                       onChange={(e) => setPdfHeight(parseInt(e.target.value))}
                       className="w-12 h-1 accent-[#5865f2] cursor-pointer"
                    />
                 </div>
                 <button 
                    onClick={() => { setPdfWidth(100); setPdfHeight(100); }}
                    className="text-[9px] bg-[#36393f] px-1 rounded hover:bg-[#4752c4] transition font-bold"
                 >RÀZ</button>
              </div>
           )}
           <button className="text-gray-400 hover:text-white transition" title="Ajouter un chant"><Plus size={16} /></button>
           {isEditing && (
              <button 
                 className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-bold text-white transition ${isSaving ? 'bg-gray-500' : 'bg-green-600 hover:bg-green-500'}`}
                 title="Sauvegarder les modifications"
                 onClick={handleSave}
                 disabled={isSaving}
              >
                 <Save size={14} /> {isSaving ? "Doc..." : "Sauver"}
              </button>
           )}
        </div>
      </div>

      {/* Meta data du chant */}
      <div className="p-4 flex gap-4 bg-[#2b2d31] border-b border-[#202225] flex-shrink-0">
         <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400 font-bold">Numéro:</label>
            <input type="text" value={activeSong?.number} readOnly className="w-16 bg-[#1e1f22] text-gray-400 text-xs py-1 px-2 rounded outline-none cursor-default" />
         </div>
         <div className="flex items-center gap-2 flex-1">
            <label className="text-xs text-gray-400 font-bold">Titre:</label>
            <input 
               type="text" 
               value={localTitle} 
               onChange={(e) => setLocalTitle(e.target.value)}
               readOnly={!isEditing}
               className={`w-full text-sm py-1 px-2 rounded outline-none font-semibold transition ${isEditing ? 'bg-[#18191c] text-white ring-1 ring-[#5865f2]' : 'bg-[#1e1f22] text-gray-200'}`} 
            />
         </div>
      </div>

      {/* Editeur Texte — layout adaptatif selon le type */}
      {(activeSong?.type === 'image' || activeSong?.type === 'video' || activeSong?.type === 'audio' || activeSong?.type === 'document') ? (
        <div className="flex-1 flex flex-col overflow-hidden relative" style={{ minHeight: 0 }}>
          {activeSong.type === 'document' && !isProjectableDocument(localContent) ? (
            /* ---- Format non affichable : on délègue au système ----
               Pas de convertisseur imposé : la machine de l'utilisateur ouvre
               le fichier avec ce qu'elle a (LibreOffice, WPS, OnlyOffice…). */
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#2b2d31] p-8 text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-[#5865f2]/15">
                <FileText size={34} className="text-[#8891f2]" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-100">Fichier {fileExtension(localContent)}</p>
                <p className="mt-1 max-w-md text-xs leading-relaxed text-gray-400">
                  Ce format ne s'affiche pas dans la fenêtre de projection. Ouvre-le avec le
                  programme de ton ordinateur, ou convertis-le en PDF pour pouvoir le projeter.
                </p>
              </div>
              <button
                onClick={async () => setOpenError(await openWithSystem(localContent))}
                className="flex items-center gap-2 rounded bg-[#5865f2] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#4752c4]"
              >
                <Eye size={14} /> Ouvrir avec l'application par défaut
              </button>
              {openError && (
                <p className="max-w-md rounded border border-red-500/20 bg-red-500/10 p-2 text-[10px] text-red-400">
                  {openError}
                </p>
              )}
            </div>
          ) : activeSong.type === 'document' ? (
            /* ---- PDF / Texte (rendu via PDF.js, identique en dev et build) ---- */
            <div className="absolute inset-0 bg-white overflow-hidden">
               {textContent ? (
                 <div className="absolute inset-0 overflow-auto p-4 font-mono text-sm bg-[#18191c] text-[#d1d5db]">
                   {textContent}
                 </div>
               ) : (
                 <div className="absolute inset-0">
                    <PdfViewer
                       mode="scroll"
                       url={pdfBlobUrl || cleanUrl(localContent)}
                       zoom={(pdfWidth || 100) / 100}
                       onLoaded={setNumPages}
                       onVisiblePageChange={setViewPage}
                       style={{ background: '#3f4147' }}
                    />
                    {numPages > 0 && (
                       <>
                          <div className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-black/70 text-white rounded-full px-3 py-1 shadow-lg pointer-events-none">
                             <FileText size={12} />
                             <span className="text-[10px] font-bold tracking-wide">Aperçu · page {viewPage} / {numPages} — défilez pour lire</span>
                          </div>
                          <button
                             className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-[#5865f2] hover:bg-[#4752c4] text-white rounded-full px-4 py-2 shadow-2xl text-xs font-bold transition"
                             onClick={() => onProjectPage(viewPage)}
                             title="Envoyer cette page sur l'écran de projection"
                          >
                             <Eye size={14} /> Projeter cette page ({viewPage})
                          </button>
                       </>
                    )}
                 </div>
               )}
            </div>
          ) : (
            /* ---- Image / Vidéo / Audio ---- */
            <div className="flex-1 flex items-center justify-center bg-black/20 relative" style={{ minHeight: 0 }}>
              <div className="absolute top-2 right-2 bg-black/80 text-white px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider z-10">
                {activeSong.type}
              </div>
              {activeSong.type === 'image' && <img src={cleanUrl(localContent)} className="max-w-full max-h-full object-contain" alt="Aperçu image" />}
              {activeSong.type === 'video' && (
                <video src={cleanUrl(localContent)} className="max-w-full max-h-full object-contain" controls playsInline preload="auto" style={{ display: 'block' }} />
              )}
              {activeSong.type === 'audio' && (
                <div className="flex flex-col items-center gap-4 w-full p-4">
                  <div className="w-20 h-20 bg-[#5865f2] rounded-full flex items-center justify-center shadow-lg shadow-[#5865f2]/30">
                    <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                    </svg>
                  </div>
                  <p className="text-xs text-gray-400 truncate max-w-full text-center">{activeSong.title}</p>
                  <audio key={localContent} src={cleanUrl(localContent)} controls className="w-full max-w-sm" />
                  <p className="text-[10px] text-gray-600 italic text-center">Lecture locale uniquement — non projeté sur l'écran de présentation</p>
                </div>
              )}
            </div>
          )}
        </div>
      ) : activeSong?.type === 'markdown' ? (
        /* ====== MARKDOWN : édition côte à côte, aperçu fidèle ====== */
        <div className="flex-1 flex flex-col overflow-hidden" style={{ minHeight: 0 }}>
          <div className="flex items-center gap-3 px-4 py-1.5 bg-[#2b2d31] border-b border-[#202225] text-[10px] text-gray-500">
            <span className="font-bold uppercase tracking-wider text-[#5865f2]">Markdown</span>
            <span>{slides.length} diapo{slides.length > 1 ? 's' : ''}</span>
            <span className="opacity-70">
              Séparez les diapos par une ligne <code className="bg-[#18191c] px-1 rounded">---</code> ·
              médias : <code className="bg-[#18191c] px-1 rounded">![](clip.mp4)</code> ·
              maths : <code className="bg-[#18191c] px-1 rounded">$E=mc^2$</code>
            </span>
          </div>

          <div className="flex-1 flex min-h-0">
            {isEditing && (
              <textarea
                className="w-1/2 h-full bg-[#18191c] p-3 text-gray-200 resize-none outline-none leading-relaxed text-sm font-mono border-r border-[#202225]"
                value={localContent}
                onChange={(e) => setLocalContent(e.target.value)}
                placeholder={"# Titre\n\nTexte en **gras**, liste :\n- point\n\n---\n\n## Diapo suivante"}
                spellCheck={false}
              />
            )}
            <div className={`${isEditing ? 'w-1/2' : 'w-full'} h-full overflow-y-auto p-4 text-gray-200`}>
              {slides.map((slide: string, i: number) => (
                <div key={i} className="mb-4 rounded border border-[#202225] bg-[#2b2d31] p-3">
                  <div className="mb-2 text-[9px] font-bold uppercase tracking-widest text-gray-500">
                    Diapo {i + 1}
                  </div>
                  <MarkdownView content={slide} variant="editor" />
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* ====== MODE TEXTE / EDIT ====== */
        <div className="flex-1 p-4 overflow-y-auto">
          {isEditing ? (
            <textarea
              className="w-full h-full bg-[#18191c] p-3 rounded text-gray-200 resize-none outline-none leading-relaxed text-sm font-medium ring-1 ring-[#5865f2]"
              value={localContent}
              onChange={(e) => setLocalContent(e.target.value)}
            />
          ) : (
            <div className="w-full text-gray-200 whitespace-pre-line leading-relaxed text-sm font-medium">
              {localContent}
            </div>
          )}
        </div>
      )}

      {/* Footer Meta */}
      <div className="p-2 border-t border-[#202225] bg-[#2f3136] flex gap-4 text-xs">
         <div className="flex items-center gap-2">
            <label className="text-gray-500">Référence:</label>
            <input type="text" className="bg-[#1e1f22] text-gray-300 px-1 rounded" />
         </div>
         <div className="flex items-center gap-2">
            <label className="text-gray-500">Auteur:</label>
            <input type="text" className="bg-[#1e1f22] text-gray-300 px-1 rounded" />
         </div>
      </div>
    </div>
  );
}
