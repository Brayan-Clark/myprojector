import React, { useEffect, useRef, useState } from 'react';
import {
  AlignCenter, AlignLeft, AlignRight,
  AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart,
  AlertCircle, Bold, Camera, ChevronDown, Clock, Eye, EyeOff, Heading,
  Image as ImageIcon, Italic, Languages, Megaphone, MessageSquare, MonitorSpeaker, MoveHorizontal, Play, Presentation,
  Palette, RefreshCw, Scissors, Settings2, StopCircle, Sun, Trash2, Underline, Wand2,
  UnfoldVertical, Video, Zap,
} from 'lucide-react';
import { FontPicker } from './FontPicker';
import { TEXT_SHADOWS } from '../lib/bgStyle';
import {
  ColorField, Divider, Group, IconBtn, MiniDivider, Select, Slider, TextBtn,
} from './toolbar/ui';
import { BgFiltersMenu, MediaLibraryMenu } from './toolbar/BackgroundMenus';
import { AnnouncementsMenu, ClockMenu, HeaderMenu, ParallelMenu, SplitMenu, StageMenu, TickerMenu, TransitionMenu } from './toolbar/OverlayMenus';
import { TRANSITIONS } from '../lib/transitions';
import { ThemesMenu } from './toolbar/ThemesMenu';

/**
 * Barre d'outils.
 *
 * Elle est organisée en DEUX LIGNES, et la raison est fonctionnelle :
 *
 *   Ligne 1 — ce qui agit MAINTENANT sur l'écran de l'assemblée (direct,
 *             écran noir, caméra, horloge…). Pendant un culte, c'est là qu'on
 *             va, et ces boutons ne doivent jamais changer de place.
 *   Ligne 2 — l'APPARENCE de la diapo (police, alignement, fond). On y passe
 *             en préparation, rarement en direct.
 *
 * Avant, les dix groupes partageaient une seule ligne avec `flex-wrap` : selon
 * la largeur de la fenêtre et le contenu sélectionné, le bouton LIVE pouvait
 * se retrouver sur la deuxième ligne ou la quatrième. Chercher un bouton
 * pendant une projection est exactement ce qu'il ne faut pas faire.
 */
export function Toolbar({
  setBgImage, bgImage, bgFilters, setBgFilters,
  textSettings, setTextSettings, sampleText,
  isLiveActive, handleLiveToggle,
  editingScope, setEditingScope, activeSong, activeVerseIdx, activeCategory,
  clearSpecificSettings, isContentHidden, setIsContentHidden, isBaseScreenProjected,
  setIsBaseScreenProjected, cameraList, selectedCamera, setSelectedCamera,
  isCameraActive, setIsCameraActive,
  clockSettings, setClockSettings,
  tickerSettings, setTickerSettings,
  headerSettings, setHeaderSettings,
  transition, setTransition,
  themeContext, onApplyTheme,
  parallel, setParallel, currentBibleDb,
  slideSplit, setSlideSplit,
  announcements, setAnnouncements,
  stage, setStage, isStageActive, handleStageToggle, timerStart, setTimerStart,
  liveStatus,
  refreshCameras, setOverlayColor,
  cameraError,
}: any) {
  type Menu = 'image' | 'video' | 'bgfilters' | 'clock' | 'ticker' | 'header' | 'transition' | 'themes' | 'parallel' | 'split' | 'announcements' | 'stage' | 'fontsize' | null;
  const [menu, setMenu] = useState<Menu>(null);
  const [customBgs, setCustomBgs] = useState<string[]>([]); // chemins absolus
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeMsg, setOptimizeMsg] = useState<string | null>(null);

  const toggleMenu = (m: Exclude<Menu, null>) => setMenu((cur) => (cur === m ? null : m));
  const patchText = (patch: any) => setTextSettings({ ...textSettings, ...patch });

  const fontSizes = [50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 180, 200, 250, 300];

  const loadBackgrounds = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      setCustomBgs(await invoke<string[]>('list_backgrounds'));
    } catch (e) {
      console.error('Failed to load local backgrounds', e);
    }
  };

  useEffect(() => { loadBackgrounds(); }, []);

  /**
   * Fermeture de la liste des tailles au clic extérieur.
   *
   * Les panneaux passent par `Popover`, qui s'en charge. La liste des tailles,
   * elle, est une simple `div` : elle restait ouverte par-dessus l'éditeur
   * jusqu'à ce qu'on reclique exactement sur sa flèche.
   */
  const fontSizeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (menu !== 'fontsize') return;
    const onDown = (e: MouseEvent) => {
      if (!fontSizeRef.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menu]);

  // Analyse et compresse les médias trop lourds (fonds vidéo, images) pour
  // éviter les gels de lecture sur l'écran de présentation.
  const handleOptimizeMedia = async () => {
    setOptimizing(true);
    setOptimizeMsg(null);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const report: any = await invoke('optimize_all_media');
      const details = report.messages?.length > 0
        ? ` · ${report.compressed} optimisé(s), ${report.skipped} déjà léger(s), ${report.errors} erreur(s)`
        : '';
      setOptimizeMsg(`Analyse terminée${details}`);
      loadBackgrounds(); // les fichiers ont été remplacés : vignettes à rafraîchir
    } catch (e) {
      setOptimizeMsg('Erreur : ' + e);
    } finally {
      setOptimizing(false);
      setTimeout(() => setOptimizeMsg(null), 8000);
    }
  };

  const handleImportBackground = async (kind: 'image' | 'video') => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const { invoke } = await import('@tauri-apps/api/core');
      const file = await open({
        multiple: false,
        filters: kind === 'image'
          ? [{ name: 'Images', extensions: ['png', 'jpeg', 'jpg', 'webp', 'gif'] }]
          : [{ name: 'Videos', extensions: ['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi', 'm4v'] }],
      });
      if (file && typeof file === 'string') {
        const internalPath: string = await invoke('import_background', { sourcePath: file });
        loadBackgrounds();
        setBgImage(internalPath);
        setMenu(null);
      }
    } catch (e) { console.error(e); }
  };

  const handleDeleteBackground = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const { confirm } = await import('@tauri-apps/plugin-dialog');
      const ok = await confirm('Voulez-vous vraiment supprimer cet élément de la bibliothèque ?', {
        title: 'Suppression', kind: 'warning',
      });
      if (ok) {
        await invoke('delete_background', { filePath: path });
        loadBackgrounds();
      }
    } catch (e) { console.error(e); }
  };

  const emitOverlay = async (color: 'black' | 'white' | null) => {
    setOverlayColor?.(color);
    (await import('@tauri-apps/api/event')).emit('update_live_overlay', color);
  };

  const scopeIsSpecific = editingScope !== 'category';

  /** Portée en cours, en toutes lettres — rappelée dans les panneaux. */
  const scopeLabel =
    editingScope === 'base' ? "l'écran d'accueil"
      : editingScope === 'book' ? `le livre « ${activeSong?.book} »`
        : editingScope === 'song' ? (activeSong?.type === 'bible' ? 'ce chapitre' : 'ce chant')
          : editingScope === 'verse' ? (activeSong?.type === 'bible' ? 'ce verset' : 'cette diapo')
            : `tous les ${activeCategory === 'bible' ? 'textes bibliques' : 'chants'}`;

  return (
    <div className="shrink-0 border-b border-[#1e1f22] bg-[#2b2d31] text-gray-200 shadow-sm">

      {/* ====================== LIGNE 1 — PROJECTION ====================== */}
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2 px-3 py-1.5">

        <Group label="Direct">
          <TextBtn
            title={isLiveActive ? "Fermer la fenêtre de projection (Alt+L)" : "Ouvrir la fenêtre de projection (Alt+L)"}
            onClick={handleLiveToggle}
            tone={isLiveActive ? 'live' : 'accent'}
            icon={isLiveActive ? <StopCircle size={13} /> : <Play size={13} />}
          >
            {isLiveActive ? 'ARRÊTER' : 'LANCER'}
          </TextBtn>
          <MiniDivider />
          <TextBtn
            title="Masquer le contenu en gardant le fond (Alt+H)"
            onClick={async () => {
              setIsContentHidden(!isContentHidden);
              (await import('@tauri-apps/api/event')).emit('update_live_hide_content', !isContentHidden);
            }}
            tone="warn"
            active={isContentHidden}
            icon={isContentHidden ? <Eye size={13} /> : <EyeOff size={13} />}
          >
            {isContentHidden ? 'AFFICHER' : 'MASQUER'}
          </TextBtn>
          <MiniDivider />
          <div className="relative">
            <IconBtn
              title="Écran retour pour l'estrade (fenêtre séparée, fermée par défaut)"
              active={isStageActive}
              onClick={() => toggleMenu('stage')}
            >
              <MonitorSpeaker size={14} />
            </IconBtn>
            <StageMenu
              open={menu === 'stage'}
              onClose={() => setMenu(null)}
              stage={stage}
              setStage={setStage}
              isStageActive={!!isStageActive}
              onToggle={() => handleStageToggle?.()}
              timerStart={timerStart ?? null}
              setTimerStart={setTimerStart}
            />
          </div>
        </Group>

        <Divider />

        <Group label="Écran de l'assemblée">
          <IconBtn
            title="Revenir à l'écran d'accueil (Alt+B)"
            active={isBaseScreenProjected}
            onClick={async () => {
              setIsBaseScreenProjected(true);
              const { emit } = await import('@tauri-apps/api/event');
              await emit('update_live_lyrics', { lines: [], reference: '' });
              await emit('update_live_media', null);
            }}
          >
            <Presentation size={14} />
          </IconBtn>
          <MiniDivider />
          {/* Les trois voiles gardent leur apparence de pastille : c'est la
              couleur elle-même qui dit ce que fait le bouton. */}
          <button
            type="button"
            title="Écran noir (Alt+N ou « . »)"
            onClick={() => emitOverlay('black')}
            className="h-[26px] w-[26px] shrink-0 rounded border border-gray-600 bg-black transition hover:border-white"
          />
          <button
            type="button"
            title="Écran blanc (Alt+W)"
            onClick={() => emitOverlay('white')}
            className="h-[26px] w-[26px] shrink-0 rounded border border-gray-600 bg-white transition hover:border-[#5865f2]"
          />
          <TextBtn title="Retirer le voile et revenir à la projection (Alt+R ou Échap)" onClick={() => emitOverlay(null)}>
            Reprendre
          </TextBtn>
          <MiniDivider />
          {/* Horloge et bandeau vivent ICI : ils s'ajoutent à ce que voit
              l'assemblée, exactement comme l'écran noir ou l'accueil. Seuls
              dans leur propre section, ils laissaient une large zone étiquetée
              pour deux petits boutons. */}
          <div className="relative">
            <IconBtn title="Horloge (Alt+C)" active={!!clockSettings.enabled} onClick={() => toggleMenu('clock')}>
              <Clock size={14} />
            </IconBtn>
            <ClockMenu open={menu === 'clock'} onClose={() => setMenu(null)} clock={clockSettings} setClock={setClockSettings} />
          </div>
          <div className="relative">
            <IconBtn title="Message défilant (Alt+M)" active={!!tickerSettings.enabled} onClick={() => toggleMenu('ticker')}>
              <MessageSquare size={14} />
            </IconBtn>
            <TickerMenu open={menu === 'ticker'} onClose={() => setMenu(null)} ticker={tickerSettings} setTicker={setTickerSettings} />
          </div>
          <div className="relative">
            <IconBtn
              title="Annonces défilantes sur l'écran d'accueil"
              active={!!announcements?.enabled}
              onClick={() => toggleMenu('announcements')}
            >
              <Megaphone size={14} />
            </IconBtn>
            <AnnouncementsMenu
              open={menu === 'announcements'}
              onClose={() => setMenu(null)}
              announcements={announcements}
              setAnnouncements={setAnnouncements}
            />
          </div>
        </Group>

        <Divider />

        <Group label="Caméra">
          <TextBtn
            title="Diffuser la caméra sur l'écran de projection"
            active={isCameraActive}
            onClick={async () => {
              const next = !isCameraActive;
              if (next && refreshCameras) await refreshCameras(true);
              setIsCameraActive(next);
              (await import('@tauri-apps/api/event')).emit('toggle_live_camera', next);
            }}
            icon={<Camera size={13} className={isCameraActive ? 'animate-pulse' : ''} />}
          >
            {isCameraActive ? 'EN DIRECT' : 'Caméra'}
          </TextBtn>

          {isCameraActive && (
            <>
              <MiniDivider />
              {cameraError ? (
                <span className="flex max-w-[170px] items-center gap-1 text-[10px] font-bold text-red-400" title={cameraError}>
                  <AlertCircle size={11} className="shrink-0" />
                  <span className="truncate">{cameraError}</span>
                </span>
              ) : cameraList.length === 0 ? (
                <span className="text-[10px] font-bold text-red-400">Aucune source</span>
              ) : (
                <Select
                  value={selectedCamera}
                  title="Source vidéo"
                  className="max-w-[150px]"
                  onChange={async (v) => {
                    setSelectedCamera(v);
                    (await import('@tauri-apps/api/event')).emit('set_camera_id', v);
                  }}
                >
                  {cameraList.map((c: any) => (
                    <option key={c.deviceId} value={c.deviceId}>
                      {c.label || `Caméra ${c.deviceId.slice(0, 4)}…`}
                    </option>
                  ))}
                </Select>
              )}
              <IconBtn title="Rechercher à nouveau les caméras" onClick={async () => refreshCameras?.(true)}>
                <RefreshCw size={12} />
              </IconBtn>
            </>
          )}
        </Group>

        <div className="ml-auto flex items-end gap-2">
          {/* L'espace à droite restait vide. Il porte maintenant l'information
              qu'on cherche le plus souvent du regard pendant un culte : ce qui
              est réellement affiché à l'assemblée en ce moment. */}
          <div className="flex h-[26px] items-center gap-2 rounded-md bg-[#1e1f22] px-2.5">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${isLiveActive ? 'animate-pulse bg-red-500' : 'bg-gray-600'}`}
              title={isLiveActive ? 'Fenêtre de projection ouverte' : 'Projection fermée'}
            />
            <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-gray-500">
              À l'écran
            </span>
            <span className="max-w-[240px] truncate text-[11px] font-bold text-gray-200">
              {isBaseScreenProjected ? "Écran d'accueil" : (liveStatus?.title || '—')}
            </span>
            {!isBaseScreenProjected && (liveStatus?.slides || 0) > 1 && (
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-gray-500">
                {(liveStatus.slide ?? 0) + 1}/{liveStatus.slides}
              </span>
            )}
          </div>

          <div className="relative">
            <TextBtn
              title="Analyser et compresser les médias trop lourds, pour éviter les saccades en projection"
              onClick={handleOptimizeMedia}
              disabled={optimizing}
              icon={<Zap size={13} className={optimizing ? 'animate-pulse text-[#5865f2]' : ''} />}
            >
              {optimizing ? 'Analyse…' : 'Optimiser'}
            </TextBtn>
            {optimizeMsg && (
              <div className="absolute right-0 top-full z-[150] mt-2 w-72 whitespace-pre-wrap rounded-lg border border-[#1e1f22] bg-[#2b2d31] p-2.5 text-[11px] text-gray-300 shadow-2xl">
                {optimizeMsg}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ====================== LIGNE 2 — APPARENCE ====================== */}
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2 border-t border-[#1e1f22] bg-[#292b2f] px-3 py-1.5">

        <Group label="Ces réglages s'appliquent à">
          <Select
            value={editingScope || 'category'}
            onChange={setEditingScope}
            className="max-w-[168px]"
            title="Une diapo hérite de son chant, qui hérite du livre, qui hérite de la catégorie. Le réglage le plus précis gagne."
          >
            <option value="base">L'écran d'accueil</option>
            <option value="category">
              Tout : {activeCategory === 'bible' ? 'textes bibliques' : 'chants'}
            </option>
            {activeSong?.book && <option value="book">Le livre « {activeSong.book} »</option>}
            {/* `!= null` et non une simple véracité : le premier chapitre
                d'une bible porte l'identifiant 0, que `&&` traite comme
                absent. Les portées « Ce chapitre » et « Ce verset »
                disparaissaient donc pour Genèse 1 — et seulement pour elle. */}
            {activeSong?.id != null && (
              <option value="song">{activeSong?.type === 'bible' ? 'Ce chapitre' : 'Ce chant'}</option>
            )}
            {activeSong?.id != null && activeVerseIdx !== -1 && (
              <option value="verse">{activeSong?.type === 'bible' ? 'Ce verset' : 'Cette diapo'}</option>
            )}
          </Select>
          {scopeIsSpecific && (
            <IconBtn danger title="Effacer ce réglage particulier et revenir à l'héritage" onClick={clearSpecificSettings}>
              <Trash2 size={13} />
            </IconBtn>
          )}
          {!scopeIsSpecific && <Settings2 size={13} className="mx-1 text-gray-600" />}
        </Group>

        <Divider />

        <Group label="Texte">
          <div className="w-[118px]">
            <FontPicker
              value={textSettings.fontFamily}
              sample={sampleText}
              onChange={(name) => patchText({ fontFamily: name })}
            />
          </div>

          {/* Taille : saisie libre ET liste, parce qu'on veut parfois « 115 »
              exactement, et parfois juste « plus grand ». */}
          <div ref={fontSizeRef} className="relative flex items-stretch">
            <input
              type="text"
              inputMode="numeric"
              title="Taille du texte, en pourcentage de la taille de référence"
              className="h-[26px] w-10 rounded-l border border-[#36393f] bg-[#2b2d31] text-center text-[11px] text-gray-100 outline-none focus:border-[#5865f2]"
              value={textSettings.fontSize ?? ''}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                patchText({ fontSize: isNaN(val) ? 100 : val });
              }}
            />
            <button
              type="button"
              title="Tailles courantes"
              className="flex h-[26px] items-center rounded-r border border-l-0 border-[#36393f] bg-[#2b2d31] px-1 text-gray-400 hover:text-white"
              onClick={() => toggleMenu('fontsize')}
            >
              <ChevronDown size={10} />
            </button>
            {menu === 'fontsize' && (
              <div className="absolute left-0 top-full z-[150] mt-1 max-h-44 w-14 overflow-y-auto custom-scrollbar rounded border border-[#36393f] bg-[#2b2d31] shadow-xl">
                {fontSizes.map((size) => (
                  <button
                    key={size}
                    type="button"
                    className={`block w-full px-2 py-1 text-left text-[11px] transition hover:bg-[#5865f2] ${textSettings.fontSize === size ? 'text-[#8891f2]' : 'text-gray-300'}`}
                    onClick={() => { patchText({ fontSize: size }); setMenu(null); }}
                  >
                    {size}
                  </button>
                ))}
              </div>
            )}
          </div>

          <MiniDivider />
          <IconBtn title="Gras" active={!!textSettings.isBold} onClick={() => patchText({ isBold: !textSettings.isBold })}>
            <Bold size={13} />
          </IconBtn>
          <IconBtn title="Italique" active={!!textSettings.isItalic} onClick={() => patchText({ isItalic: !textSettings.isItalic })}>
            <Italic size={13} />
          </IconBtn>
          <IconBtn title="Souligné" active={!!textSettings.isUnderline} onClick={() => patchText({ isUnderline: !textSettings.isUnderline })}>
            <Underline size={13} />
          </IconBtn>
          <MiniDivider />
          <ColorField
            value={textSettings.color || '#ffffff'}
            onChange={(v) => patchText({ color: v })}
            title="Couleur du texte projeté"
          />
          <Select
            value={textSettings.textShadow || 'soft'}
            onChange={(v) => patchText({ textShadow: v })}
            className="max-w-[104px]"
            title="Lisibilité du texte sur le fond : ombre, contour ou halo"
          >
            {TEXT_SHADOWS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </Select>
        </Group>

        <Divider />

        {/* Un seul groupe pour les quatre panneaux qui habillent la diapo.
            Séparés, chacun portait une large étiquette pour un unique bouton —
            d'où l'impression de sections vides. Ils ont la même nature : ils
            suivent la portée sélectionnée, comme la police et le fond. */}
        <Group label="Fond et habillage de la diapo">
          <div className="relative">
            <TextBtn title="Choisir une image de fond" onClick={() => toggleMenu('image')} icon={<ImageIcon size={13} />}>
              Images
            </TextBtn>
            <MediaLibraryMenu
              kind="image"
              open={menu === 'image'}
              onClose={() => setMenu(null)}
              items={customBgs}
              current={bgImage}
              onPick={(p) => { setBgImage(p); setMenu(null); }}
              onImport={() => handleImportBackground('image')}
              onDelete={handleDeleteBackground}
            />
          </div>
          <div className="relative">
            <TextBtn title="Choisir une vidéo de fond" onClick={() => toggleMenu('video')} icon={<Video size={13} />}>
              Vidéos
            </TextBtn>
            <MediaLibraryMenu
              kind="video"
              open={menu === 'video'}
              onClose={() => setMenu(null)}
              items={customBgs}
              current={bgImage}
              onPick={(p) => { setBgImage(p); setMenu(null); }}
              onImport={() => handleImportBackground('video')}
              onDelete={handleDeleteBackground}
            />
          </div>
          <MiniDivider />
          <div className="relative">
            <TextBtn
              title="Assombrir, éclaircir, flouter ou voiler le fond pour que le texte ressorte"
              onClick={() => toggleMenu('bgfilters')}
              icon={<Sun size={13} />}
            >
              Réglages
            </TextBtn>
            <BgFiltersMenu
              open={menu === 'bgfilters'}
              onClose={() => setMenu(null)}
              filters={bgFilters}
              setFilters={setBgFilters}
              bgImage={bgImage}
            />
          </div>
                  <MiniDivider />
          <div className="relative">
            <TextBtn
              title="La référence affichée par-dessus la diapo — réglable par portée"
              active={!!headerSettings?.enabled}
              onClick={() => toggleMenu('header')}
              icon={<Heading size={13} />}
            >
              Entête
            </TextBtn>
            <HeaderMenu
              open={menu === 'header'}
              onClose={() => setMenu(null)}
              header={headerSettings}
              setHeader={setHeaderSettings}
              scopeLabel={scopeLabel}
            />
          </div>
          <div className="relative">
            <TextBtn
              title="Effet joué au changement de diapo"
              active={transition?.type && transition.type !== 'none'}
              onClick={() => toggleMenu('transition')}
              icon={<Wand2 size={13} />}
            >
              {TRANSITIONS.find((t) => t.value === (transition?.type || 'fade'))?.label || 'Fondu'}
            </TextBtn>
            <TransitionMenu
              open={menu === 'transition'}
              onClose={() => setMenu(null)}
              transition={transition}
              setTransition={setTransition}
              scopeLabel={scopeLabel}
            />
          </div>

          {activeCategory === 'bible' && (
            /* Uniquement en vue Bible : ce réglage n'a aucun sens sur un chant,
               et une barre d'outils doit montrer ce qui sert, maintenant. */
            <>
              <MiniDivider />
              <div className="relative">
                <TextBtn
                  title="Projeter le verset dans plusieurs versions à la fois"
                  active={(parallel?.versions?.length || 0) > 0}
                  onClick={() => toggleMenu('parallel')}
                  icon={<Languages size={13} />}
                >
                  {(parallel?.versions?.length || 0) > 0
                    ? `${parallel.versions.length + 1} versions`
                    : 'Une version'}
                </TextBtn>
                <ParallelMenu
                  open={menu === 'parallel'}
                  onClose={() => setMenu(null)}
                  parallel={parallel}
                  setParallel={setParallel}
                  currentVersion={currentBibleDb || activeSong?.version}
                  scopeLabel={scopeLabel}
                />
              </div>
            </>
          )}

          <MiniDivider />
          <div className="relative">
            <TextBtn
              title="Enregistrer l'apparence complète sous un nom, ou en rappeler une"
              onClick={() => toggleMenu('themes')}
              icon={<Palette size={13} />}
            >
              Thèmes
            </TextBtn>
            <ThemesMenu
              open={menu === 'themes'}
              onClose={() => setMenu(null)}
              current={themeContext || {}}
              onApply={(v) => { onApplyTheme?.(v); setMenu(null); }}
              scopeLabel={scopeLabel}
            />
          </div>
        </Group>

        <Divider />

        {/* Placé en DERNIER et extensible : sur un écran large il termine la
            ligne, sur un écran étroit il passe seul à la ligne suivante et ses
            curseurs y gagnent alors toute la largeur. Dans les deux cas la
            bande paraît voulue, et les curseurs restent attrapables — c'était
            le reproche principal de l'ancienne disposition. */}
        <Group label="Mise en page" grow className="min-w-[320px]">
          <div className="flex shrink-0 overflow-hidden rounded border border-[#36393f] bg-[#2b2d31]">
            <IconBtn title="Aligné à gauche" active={textSettings.align === 'left'} onClick={() => patchText({ align: 'left' })}><AlignLeft size={13} /></IconBtn>
            <IconBtn title="Centré" active={textSettings.align === 'center'} onClick={() => patchText({ align: 'center' })}><AlignCenter size={13} /></IconBtn>
            <IconBtn title="Aligné à droite" active={textSettings.align === 'right'} onClick={() => patchText({ align: 'right' })}><AlignRight size={13} /></IconBtn>
          </div>
          <div className="flex shrink-0 overflow-hidden rounded border border-[#36393f] bg-[#2b2d31]">
            <IconBtn title="En haut de l'écran" active={textSettings.valign === 'top'} onClick={() => patchText({ valign: 'top' })}><AlignVerticalJustifyStart size={13} /></IconBtn>
            <IconBtn title="Au milieu" active={textSettings.valign === 'middle'} onClick={() => patchText({ valign: 'middle' })}><AlignVerticalJustifyCenter size={13} /></IconBtn>
            <IconBtn title="En bas" active={textSettings.valign === 'bottom'} onClick={() => patchText({ valign: 'bottom' })}><AlignVerticalJustifyEnd size={13} /></IconBtn>
          </div>
          <MiniDivider />
          {/* Les deux curseurs étaient empilés dans la hauteur d'un bouton :
              leur piste faisait une soixantaine de pixels, impossible à viser
              à la souris. Côte à côte, chacun garde une piste utilisable. */}
          <Slider
            icon={<UnfoldVertical size={12} className="shrink-0 text-gray-500" />}
            value={textSettings.lineHeight || 1.4}
            min={0.8} max={3} step={0.1}
            onChange={(v) => patchText({ lineHeight: v })}
            format={(v) => v.toFixed(1)}
            title="Interligne : espace entre les lignes"
          />
          <Slider
            icon={<MoveHorizontal size={12} className="shrink-0 text-gray-500" />}
            value={textSettings.contentWidth || 100}
            min={20} max={100}
            onChange={(v) => patchText({ contentWidth: v })}
            format={(v) => `${v}%`}
            title="Largeur du bloc de texte : la réduire force des retours à la ligne plus tôt"
          />
          <MiniDivider />
          <div className="relative">
            <IconBtn
              title="Découper automatiquement les diapos trop longues"
              active={!!slideSplit?.enabled}
              onClick={() => toggleMenu('split')}
            >
              <Scissors size={13} />
            </IconBtn>
            <SplitMenu
              open={menu === 'split'}
              onClose={() => setMenu(null)}
              split={slideSplit}
              setSplit={setSlideSplit}
            />
          </div>
        </Group>
      </div>
    </div>
  );
}
