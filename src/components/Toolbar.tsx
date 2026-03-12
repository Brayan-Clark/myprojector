import React, { useState, useEffect } from 'react';
import {
  Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight,
  MonitorOff, Play, Image, Video, Plus, StopCircle,
  Settings2, Trash2, EyeOff, Eye, Presentation,
  AlignVerticalJustifyCenter, AlignVerticalJustifyStart, AlignVerticalJustifyEnd,
  ChevronDown, Camera, Type, List, Clock, MessageSquare
} from 'lucide-react';




export function Toolbar({
  setBgImage, textSettings, setTextSettings, isLiveActive, handleLiveToggle,
  editingScope, setEditingScope, activeSong, activeVerseIdx, activeCategory,
  clearSpecificSettings, isContentHidden, setIsContentHidden, isBaseScreenProjected,
  setIsBaseScreenProjected, cameraList, selectedCamera, setSelectedCamera,
  isCameraActive, setIsCameraActive,
  clockSettings, setClockSettings,
  tickerSettings, setTickerSettings,
  refreshCameras
}: any) {
  const [activeMediaMenu, setActiveMediaMenu] = useState<'image' | 'video' | 'clock' | 'ticker' | null>(null);
  const [showFontDropdown, setShowFontDropdown] = useState(false);
  const [customBgs, setCustomBgs] = useState<string[]>([]); // Stores absolute paths

  const fontSizes = [50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 180, 200, 250, 300];

  const isVideoUrl = (url: string) => url.match(/\.(mp4|webm|ogg|mov|mkv|avi|m4v)(\?.*)?$/i);

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

  const defaultBgs: { name: string, url: string }[] = [
    // { name: 'Easy Worship', url: '/backgrounds/easy_worship.mp4' }
    // { name: 'Sunset', url: '/backgrounds/sunset.jpg' },
    // { name: 'Book', url: '/backgrounds/books.jpg' },
  ];

  const handleBgSelect = async (url: string) => {
    setBgImage(url);
    setActiveMediaMenu(null);
  };

  const handleAddCustomMedia = async (mediaType: 'image' | 'video') => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const { invoke } = await import('@tauri-apps/api/core');

      const file = await open({
        multiple: false,
        filters: mediaType === 'image' ? [{
          name: 'Images',
          extensions: ['png', 'jpeg', 'jpg', 'webp', 'gif']
        }] : [{
          name: 'Videos',
          extensions: ['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi', 'm4v']
        }]
      });

      if (file && typeof file === 'string') {
        // Copy to internal data folder
        const internalPath: string = await invoke('import_background', { sourcePath: file });
        loadBackgrounds();
        handleBgSelect(internalPath);
      }
    } catch (e) { console.error(e) }
  };

  const handleDeleteCustomMedia = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const { confirm } = await import('@tauri-apps/plugin-dialog');

      const ok = await confirm("Voulez-vous vraiment supprimer cet élément de la bibliothèque ?", { title: "Suppression", kind: 'warning' });
      if (ok) {
        await invoke('delete_background', { filePath: path });
        loadBackgrounds();
      }
    } catch (e) { console.error(e) }
  };

  const loadBackgrounds = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const files: string[] = await invoke('list_backgrounds');
      setCustomBgs(files);
    } catch (e) {
      console.error("Failed to load local backgrounds", e);
    }
  };



  useEffect(() => {
    loadBackgrounds();
  }, []);

  return (
    <div className="min-h-[5rem] py-2 bg-[#2b2d31] border-b border-[#1e1f22] flex flex-wrap items-center px-4 gap-6 shrink-0 shadow-sm z-10 w-full text-gray-200">

      {/* Group: Scope Selection */}
      <div className="flex flex-col gap-1 min-w-max">
        <span className="text-[10px] font-bold text-[#5865f2] uppercase tracking-wider flex items-center gap-1"><Settings2 size={10} /> Appliquer à</span>
        <div className="flex items-center gap-1 bg-[#1e1f22] p-1 rounded-md">
          <select
            className="bg-[#1e1f22] text-[10px] text-gray-200 font-bold border border-[#36393f] outline-none rounded px-2 py-1 cursor-pointer appearance-none pr-6 max-w-[140px] truncate hover:border-[#5865f2] transition-colors"
            style={{ backgroundImage: `url('data:image/svg+xml;utf8,<svg fill="currentColor" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z" fill="%239CA3AF"/></svg>')`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 2px center', backgroundSize: '16px' }}
            value={editingScope || 'category'}
            onChange={(e) => setEditingScope(e.target.value)}
          >
            <option value="base" className="bg-[#2b2d31]">Écran de Base / Accueil</option>
            <option value="category" className="bg-[#2b2d31]">Par défaut ({activeCategory === 'bible' ? 'Bible' : 'Recueils'})</option>
            {activeSong?.book && <option value="book" className="bg-[#2b2d31]">Livre ({activeSong.book})</option>}
            {activeSong?.id && <option value="song" className="bg-[#2b2d31]">{activeSong?.type === 'bible' ? 'Chapitre (Bible)' : 'Chant courant'}</option>}
            {activeSong?.id && activeVerseIdx !== -1 && <option value="verse" className="bg-[#2b2d31]">{activeSong?.type === 'bible' ? 'Verset courant' : 'Diapo courante'}</option>}
          </select>
          {editingScope !== 'category' && (
            <button onClick={clearSpecificSettings} className="p-1 px-1.5 hover:bg-red-500/20 text-red-400 hover:text-red-500 rounded transition" title="Effacer"><Trash2 size={14} /></button>
          )}
        </div>
      </div>

      <div className="w-px h-10 bg-[#1e1f22]"></div>

      {/* Group: Text Style */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Style</span>
        <div className="flex items-center gap-1 bg-[#1e1f22] p-1 rounded-md">
          <select
            className="bg-[#1e1f22] text-xs text-gray-200 border border-[#36393f] outline-none rounded px-2 py-1 cursor-pointer appearance-none pr-6 hover:border-[#5865f2] transition-colors"
            style={{ backgroundImage: `url('data:image/svg+xml;utf8,<svg fill="currentColor" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z" fill="%239CA3AF"/></svg>')`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 2px center', backgroundSize: '16px' }}
            value={textSettings.fontFamily}
            onChange={(e) => setTextSettings({ ...textSettings, fontFamily: e.target.value })}
          >
            <option className="bg-[#2b2d31]" value="Inter">Inter</option>
            <option className="bg-[#2b2d31]" value="Montserrat">Montserrat</option>
            <option className="bg-[#2b2d31]" value="Poppins">Poppins</option>
            <option className="bg-[#2b2d31]" value="Roboto Condensed">Roboto Condensed</option>
            <option className="bg-[#2b2d31]" value="Oswald">Oswald</option>
            <option className="bg-[#2b2d31]" value="Lora">Lora</option>
            <option className="bg-[#2b2d31]" value="Playfair Display">Playfair Display</option>
            <option className="bg-[#2b2d31]" value="Times New Roman">Times New Roman</option>
            <option className="bg-[#2b2d31]" value="Arial">Arial</option>
          </select>

          <div className="relative flex items-stretch">
            <input
              type="text"
              className="bg-[#2b2d31] text-xs text-gray-200 border border-[#36393f] outline-none rounded-l px-2 py-1 w-10 text-center"
              value={textSettings.fontSize || ''}
              onFocus={() => setShowFontDropdown(true)}
              onBlur={() => setTimeout(() => setShowFontDropdown(false), 200)}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                setTextSettings({ ...textSettings, fontSize: isNaN(val) ? 100 : val });
              }}
            />
            <button className="bg-[#2b2d31] border border-l-0 border-[#36393f] rounded-r px-1 text-gray-400" onClick={() => setShowFontDropdown(!showFontDropdown)}>
              <ChevronDown size={10} />
            </button>
            {showFontDropdown && (
              <div className="absolute top-full left-0 mt-1 w-16 bg-[#2b2d31] border border-[#36393f] rounded shadow-xl max-h-40 overflow-y-auto z-50">
                {fontSizes.map(size => (
                  <div key={size} className="px-2 py-1 text-xs hover:bg-[#5865f2] cursor-pointer" onMouseDown={() => setTextSettings({ ...textSettings, fontSize: size })}>{size}</div>
                ))}
              </div>
            )}
          </div>

          <div className="w-px h-4 bg-gray-600 mx-1"></div>
          <button className={`p-1.5 rounded transition ${textSettings.isBold ? 'bg-[#5865f2] text-white shadow-sm' : 'hover:bg-[#3f4147] text-gray-300'}`} onClick={() => setTextSettings({ ...textSettings, isBold: !textSettings.isBold })}><Bold size={14} /></button>
          <button className={`p-1.5 rounded transition ${textSettings.isItalic ? 'bg-[#5865f2] text-white shadow-sm' : 'hover:bg-[#3f4147] text-gray-300'}`} onClick={() => setTextSettings({ ...textSettings, isItalic: !textSettings.isItalic })}><Italic size={14} /></button>
          <button className={`p-1.5 rounded transition ${textSettings.isUnderline ? 'bg-[#5865f2] text-white shadow-sm' : 'hover:bg-[#3f4147] text-gray-300'}`} onClick={() => setTextSettings({ ...textSettings, isUnderline: !textSettings.isUnderline })}><Underline size={14} /></button>
        </div>
      </div>

      <div className="w-px h-10 bg-[#1e1f22]"></div>
      {/* Group: Alignment & Dimensions */}
      <div className="flex flex-col gap-1 min-w-[300px]">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Mise en forme</span>
        <div className="flex items-center gap-2 bg-[#1e1f22] p-1.5 rounded-md h-[42px]">
          <div className="flex bg-[#2b2d31] rounded border border-[#36393f] overflow-hidden shrink-0">
            <button className={`p-1.5 transition ${textSettings.align === 'left' ? 'bg-[#3f4147]' : 'hover:bg-[#3f4147]'}`} onClick={() => setTextSettings({ ...textSettings, align: 'left' })}><AlignLeft size={14} /></button>
            <button className={`p-1.5 transition ${textSettings.align === 'center' ? 'bg-[#3f4147]' : 'hover:bg-[#3f4147]'}`} onClick={() => setTextSettings({ ...textSettings, align: 'center' })}><AlignCenter size={14} /></button>
            <button className={`p-1.5 transition ${textSettings.align === 'right' ? 'bg-[#3f4147]' : 'hover:bg-[#3f4147]'}`} onClick={() => setTextSettings({ ...textSettings, align: 'right' })}><AlignRight size={14} /></button>
          </div>
          <div className="w-px h-6 bg-[#2b2d31]"></div>
          <div className="flex bg-[#2b2d31] rounded border border-[#36393f] overflow-hidden shrink-0">
            <button className={`p-1.5 transition ${textSettings.valign === 'top' ? 'bg-[#3f4147]' : 'hover:bg-[#3f4147]'}`} onClick={() => setTextSettings({ ...textSettings, valign: 'top' })} title="Haut"><AlignVerticalJustifyStart size={14} /></button>
            <button className={`p-1.5 transition ${textSettings.valign === 'middle' ? 'bg-[#3f4147]' : 'hover:bg-[#3f4147]'}`} onClick={() => setTextSettings({ ...textSettings, valign: 'middle' })} title="Milieu"><AlignVerticalJustifyCenter size={14} /></button>
            <button className={`p-1.5 transition ${textSettings.valign === 'bottom' ? 'bg-[#3f4147]' : 'hover:bg-[#3f4147]'}`} onClick={() => setTextSettings({ ...textSettings, valign: 'bottom' })} title="Bas"><AlignVerticalJustifyEnd size={14} /></button>
          </div>
          <div className="w-px h-6 bg-[#2b2d31]"></div>
          <div className="flex flex-col gap-1 flex-1 px-1">
            <div className="flex items-center gap-2" title="Interligne">
              <List size={10} className="text-gray-500 shrink-0" />
              <input type="range" min="0.8" max="3" step="0.1" value={textSettings.lineHeight || 1.4} onChange={(e) => setTextSettings({ ...textSettings, lineHeight: parseFloat(e.target.value) })} className="flex-1 h-1 accent-[#5865f2]" />
            </div>
            <div className="flex items-center gap-2" title="Largeur">
              <Type size={10} className="text-gray-500 shrink-0" />
              <input type="range" min="20" max="100" step="1" value={textSettings.contentWidth || 100} onChange={(e) => setTextSettings({ ...textSettings, contentWidth: parseInt(e.target.value) })} className="flex-1 h-1 accent-[#5865f2]" />
            </div>
          </div>
          <span className="text-[9px] text-gray-500 font-mono w-6 text-right shrink-0">{textSettings.contentWidth || 100}%</span>
        </div>
      </div>

      <div className="w-px h-10 bg-[#1e1f22]"></div>

      {/* Group: Background */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Arrière-plan</span>
        <div className="flex items-center gap-1 bg-[#1e1f22] p-1 rounded-md">
          <div className="relative">
            <button className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-[#3f4147] rounded text-gray-300 transition text-xs font-semibold" onClick={() => setActiveMediaMenu(activeMediaMenu === 'image' ? null : 'image')}>
              <Image size={14} /> Images
            </button>
            {activeMediaMenu === 'image' && (
              <div className="absolute top-full left-0 mt-2 bg-[#2b2d31] border border-[#1e1f22] shadow-2xl rounded p-2 z-50 w-64 overflow-y-auto max-h-64">
                <div className="flex justify-between items-center mb-2 px-1 text-[10px] font-bold text-gray-400 uppercase">Bibliothèque <button onClick={() => handleAddCustomMedia('image')} className="text-[#5865f2] hover:text-[#4752c4]"><Plus size={14} /></button></div>
                <div className="grid grid-cols-2 gap-2">
                  {defaultBgs.filter(bg => !isVideoUrl(bg.url)).map(bg => <div key={bg.url} onClick={() => handleBgSelect(bg.url)} className="aspect-video bg-black overflow-hidden rounded border border-transparent hover:border-[#5865f2] transition cursor-pointer"><img src={bg.url} className="w-full h-full object-cover" /></div>)}
                  {customBgs.filter(path => !isVideoUrl(path)).map((path, i) => (
                    <div key={i} onClick={() => handleBgSelect(path)} className="aspect-video bg-black overflow-hidden rounded border border-transparent hover:border-[#5865f2] transition cursor-pointer relative group">
                      <img src={cleanUrl(path)} className="w-full h-full object-cover" />
                      <button onClick={(e) => handleDeleteCustomMedia(e, path)} className="absolute top-1 right-1 p-1 bg-red-600/80 text-white rounded opacity-0 group-hover:opacity-100 transition hover:bg-red-600">
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="relative">
            <button className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-[#3f4147] rounded text-gray-300 transition text-xs font-semibold" onClick={() => setActiveMediaMenu(activeMediaMenu === 'video' ? null : 'video')}>
              <Video size={14} /> Vidéos
            </button>
            {activeMediaMenu === 'video' && (
              <div className="absolute top-full left-0 mt-2 bg-[#2b2d31] border border-[#1e1f22] shadow-2xl rounded p-2 z-50 w-64 overflow-y-auto max-h-64">
                <div className="flex justify-between items-center mb-2 px-1 text-[10px] font-bold text-gray-400 uppercase">Fonds Vidéo <button onClick={() => handleAddCustomMedia('video')} className="text-[#5865f2] hover:text-[#4752c4]"><Plus size={14} /></button></div>
                <div className="grid grid-cols-2 gap-2">
                  {defaultBgs.filter(bg => isVideoUrl(bg.url)).map(bg => (
                    <div key={bg.url} onClick={() => handleBgSelect(bg.url)} className="aspect-video bg-black overflow-hidden rounded border border-transparent hover:border-[#5865f2] transition cursor-pointer relative group">
                      <video src={bg.url} className="w-full h-full object-cover" muted />
                      <div className="absolute inset-0 flex items-center justify-center text-white/40"><Play size={20} /></div>
                    </div>
                  ))}
                  {customBgs.filter(path => isVideoUrl(path)).map((path, i) => (
                    <div key={i} onClick={() => handleBgSelect(path)} className="aspect-video bg-black overflow-hidden rounded border border-transparent hover:border-[#5865f2] transition cursor-pointer relative group">
                      <video src={cleanUrl(path)} className="w-full h-full object-cover" muted />
                      <div className="absolute inset-0 flex items-center justify-center text-white/40"><Play size={20} /></div>
                      <button onClick={(e) => handleDeleteCustomMedia(e, path)} className="absolute top-1 right-1 p-1 bg-red-600/80 text-white rounded opacity-0 group-hover:opacity-100 transition hover:bg-red-600">
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 bg-[#2b2d31] rounded-lg border border-[#36393f] p-1 ml-1 hover:border-[#5865f2] transition-all group/cam shadow-inner">
            <button
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md transition-all text-xs font-bold ${isCameraActive ? 'bg-orange-500 text-white shadow-[0_0_15px_rgba(249,115,22,0.4)]' : 'hover:bg-[#3f4147] text-gray-400 group-hover/cam:text-gray-200'}`}
              onClick={async () => {
                const next = !isCameraActive;
                console.log("Toggling camera. Target state:", next);
                
                if (next) {
                  // 1. Refresh before to see what's there
                  if (refreshCameras) await refreshCameras();

                  try {
                    // 2. Try to get permission (unblocks labels)
                    console.log("Requesting camera access...");
                    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                    stream.getTracks().forEach(t => t.stop());
                    console.log("Access granted, refreshing list...");
                    if (refreshCameras) await refreshCameras();
                  } catch (e: any) {
                    console.warn("Could not get camera permission or device busy:", e.name, e.message);
                    // Still refresh, maybe we can see the devices without labels
                    if (refreshCameras) await refreshCameras();
                  }
                }

                setIsCameraActive(next);
                const { emit } = await import('@tauri-apps/api/event');
                emit('toggle_live_camera', next);
              }}
            >
              <Camera size={14} className={isCameraActive ? 'animate-pulse' : ''} /> 
              <span>Caméra</span>
            </button>
            {isCameraActive && cameraList.length > 0 && (
              <div className="relative flex items-center h-full">
                <div className="w-px h-6 bg-[#36393f] mx-1"></div>
                <select
                  className="bg-[#1e1f22] text-[10px] text-[#5865f2] font-black border border-[#36393f] outline-none py-1 px-2 rounded-md cursor-pointer max-w-[120px] hover:border-[#5865f2] transition-all appearance-none pr-6 shadow-sm"
                  style={{ backgroundImage: `url('data:image/svg+xml;utf8,<svg fill="currentColor" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z" fill="%235865f2"/></svg>')`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 2px center', backgroundSize: '16px' }}
                  value={selectedCamera}
                  onChange={async (e) => {
                    setSelectedCamera(e.target.value);
                    const { emit } = await import('@tauri-apps/api/event');
                    emit('set_camera_id', e.target.value);
                  }}
                >
                  {cameraList.map((c: any) => <option key={c.deviceId} value={c.deviceId} className="bg-[#2b2d31] text-white">{c.label || `Source ${c.deviceId.slice(0,4)}`}</option>)}
                </select>
              </div>
            )}
            {isCameraActive && cameraList.length === 0 && (
               <span className="text-[10px] text-red-400 font-bold px-2 animate-pulse">Aucune source déctectée</span>
            )}
          </div>

          <div className="w-px h-6 bg-[#2b2d31] mx-0.5"></div>

          <button className="w-6 h-6 rounded bg-black border border-gray-600 hover:border-white transition shrink-0" title="Noir" onClick={async () => { (await import('@tauri-apps/api/event')).emit('update_live_overlay', 'black') }}></button>
          <button className="w-6 h-6 rounded bg-white border border-gray-600 hover:border-black transition shrink-0" title="Blanc" onClick={async () => { (await import('@tauri-apps/api/event')).emit('update_live_overlay', 'white') }}></button>
          <button className="w-6 h-6 rounded bg-gray-500/20 border border-gray-500 hover:bg-gray-500/40 transition flex items-center justify-center shrink-0" title="Réveil" onClick={async () => { (await import('@tauri-apps/api/event')).emit('update_live_overlay', null) }}><MonitorOff size={12} /></button>
          <button className={`w-6 h-6 rounded border transition flex items-center justify-center shrink-0 ${isBaseScreenProjected ? 'bg-[#5865f2] text-white border-white' : 'bg-[#18191c] text-gray-400 border-gray-600 hover:border-[#5865f2]'}`} title="Accueil" onClick={async () => {
            setIsBaseScreenProjected(true);
            const { emit } = await import('@tauri-apps/api/event');
            await emit('update_live_lyrics', { lines: [], reference: "" });
            await emit('update_live_media', null);
          }}><Presentation size={12} /></button>
        </div>
      </div>

      <div className="w-px h-10 bg-[#1e1f22]"></div>

      {/* Group: Extra Features */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Projection +</span>
        <div className="flex items-center gap-1 bg-[#1e1f22] p-1 rounded-md">
          <div className="relative">
            <button
              className={`p-1.5 rounded transition ${clockSettings.enabled ? 'bg-[#5865f2] text-white' : 'hover:bg-[#3f4147] text-gray-400'}`}
              onClick={() => setActiveMediaMenu(activeMediaMenu === 'clock' ? null : 'clock')}
            >
              <Clock size={16} />
            </button>
            {activeMediaMenu === 'clock' && (
              <div className="absolute top-full left-0 mt-2 bg-[#2b2d31] border border-[#1e1f22] shadow-2xl rounded p-3 z-50 w-64 space-y-3">
                <div className="flex justify-between items-center text-[10px] font-bold text-[#5865f2] uppercase">Options Horloge</div>
                <div className="flex items-center justify-between">
                  <span className="text-xs">Activé</span>
                  <input type="checkbox" checked={clockSettings.enabled} onChange={(e) => setClockSettings({ ...clockSettings, enabled: e.target.checked })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button className={`text-[10px] py-1 rounded border ${clockSettings.type === 'digital' ? 'bg-[#5865f2] border-white' : 'border-[#36393f]'}`} onClick={() => setClockSettings({ ...clockSettings, type: 'digital', style: 'modern' })}>Digital</button>
                  <button className={`text-[10px] py-1 rounded border ${clockSettings.type === 'analog' ? 'bg-[#5865f2] border-white' : 'border-[#36393f]'}`} onClick={() => setClockSettings({ ...clockSettings, type: 'analog', style: 'minimal' })}>Analogue</button>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-gray-400">Style</span>
                  <select
                    className="w-full bg-[#1e1f22] text-[10px] text-gray-200 border border-[#36393f] rounded p-1 appearance-none"
                    style={{ backgroundImage: `url('data:image/svg+xml;utf8,<svg fill="currentColor" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z" fill="%239CA3AF"/></svg>')`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 2px center', backgroundSize: '10px' }}
                    value={clockSettings.style}
                    onChange={(e) => setClockSettings({ ...clockSettings, style: e.target.value })}
                  >
                    {clockSettings.type === 'digital' ? (
                      <>
                        <option value="modern" className="bg-[#2b2d31]">Moderne</option>
                        <option value="classic" className="bg-[#2b2d31]">Classique (Serif)</option>
                        <option value="neon" className="bg-[#2b2d31]">Néon</option>
                      </>
                    ) : (
                      <>
                        <option value="minimal" className="bg-[#2b2d31]">Minimaliste</option>
                        <option value="numbers" className="bg-[#2b2d31]">Avec Chiffres</option>
                        <option value="sport" className="bg-[#2b2d31]">Sport / Bold</option>
                      </>
                    )}
                  </select>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-gray-400">Taille</span>
                    <span className="text-[10px] text-[#5865f2] font-bold">{clockSettings.size}px</span>
                  </div>
                  <input type="range" min="20" max="300" value={clockSettings.size} onChange={(e) => setClockSettings({ ...clockSettings, size: parseInt(e.target.value) })} className="w-full h-1 accent-[#5865f2]" />
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-gray-400">Position</span>
                  <select
                    className="w-full bg-[#1e1f22] text-[10px] text-gray-200 border border-[#36393f] rounded p-1.5 outline-none appearance-none cursor-pointer"
                    style={{ backgroundImage: `url('data:image/svg+xml;utf8,<svg fill="currentColor" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z" fill="%239CA3AF"/></svg>')`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 4px center', backgroundSize: '12px' }}
                    value={clockSettings.position}
                    onChange={(e) => setClockSettings({ ...clockSettings, position: e.target.value })}
                  >
                    <option value="top-right" className="bg-[#2b2d31]">Haut Droite</option>
                    <option value="top-left" className="bg-[#2b2d31]">Haut Gauche</option>
                    <option value="bottom-right" className="bg-[#2b2d31]">Bas Droite</option>
                    <option value="bottom-left" className="bg-[#2b2d31]">Bas Gauche</option>
                    <option value="center" className="bg-[#2b2d31]">Centre</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400">Couleur</span>
                  <input type="color" value={clockSettings.color} onChange={(e) => setClockSettings({ ...clockSettings, color: e.target.value })} className="w-8 h-4 bg-transparent border-none cursor-pointer" />
                </div>
              </div>
            )}
          </div>

          <div className="relative">
            <button
              className={`p-1.5 rounded transition ${tickerSettings.enabled ? 'bg-[#5865f2] text-white' : 'hover:bg-[#3f4147] text-gray-400'}`}
              onClick={() => setActiveMediaMenu(activeMediaMenu === 'ticker' ? null : 'ticker')}
            >
              <MessageSquare size={16} />
            </button>
            {activeMediaMenu === 'ticker' && (
              <div className="absolute top-full left-0 mt-2 bg-[#2b2d31] border border-[#1e1f22] shadow-2xl rounded p-3 z-50 w-72 space-y-3">
                <div className="flex justify-between items-center text-[10px] font-bold text-[#5865f2] uppercase">Message Défilant</div>
                <div className="flex items-center justify-between">
                  <span className="text-xs">Activé</span>
                  <input type="checkbox" checked={tickerSettings.enabled} onChange={(e) => setTickerSettings({ ...tickerSettings, enabled: e.target.checked })} />
                </div>
                <textarea
                  className="w-full bg-[#1e1f22] text-xs border border-[#36393f] rounded p-2 outline-none h-16 resize-none"
                  placeholder="Votre message ici..."
                  value={tickerSettings.message}
                  onChange={(e) => setTickerSettings({ ...tickerSettings, message: e.target.value })}
                />
                <div className="grid grid-cols-1 gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-gray-400 uppercase font-black">Opacité Fond</span>
                    <input type="range" min="0" max="1" step="0.1" value={tickerSettings.bgOpacity} onChange={(e) => setTickerSettings({ ...tickerSettings, bgOpacity: parseFloat(e.target.value) })} className="h-1 accent-[#5865f2]" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-gray-400">Police</span>
                    <select
                      className="w-full bg-[#1e1f22] text-[10px] text-gray-200 border border-[#36393f] rounded p-1 appearance-none"
                      style={{ backgroundImage: `url('data:image/svg+xml;utf8,<svg fill="currentColor" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z" fill="%239CA3AF"/></svg>')`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 2px center', backgroundSize: '10px' }}
                      value={tickerSettings.fontFamily}
                      onChange={(e) => setTickerSettings({ ...tickerSettings, fontFamily: e.target.value })}
                    >
                      <option value="Inter" className="bg-[#2b2d31]">Inter</option>
                      <option value="Montserrat" className="bg-[#2b2d31]">Montserrat</option>
                      <option value="Oswald" className="bg-[#2b2d31]">Oswald</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-gray-400">Taille</span>
                    <input type="number" className="w-full bg-[#1e1f22] text-[10px] border border-[#36393f] rounded p-1" value={tickerSettings.fontSize} onChange={(e) => setTickerSettings({ ...tickerSettings, fontSize: parseInt(e.target.value) })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-400">Texte</span>
                    <input type="color" value={tickerSettings.color} onChange={(e) => setTickerSettings({ ...tickerSettings, color: e.target.value })} className="w-6 h-4 bg-transparent border-none cursor-pointer" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-400">Fond</span>
                    <input type="color" value={tickerSettings.bgColor} onChange={(e) => setTickerSettings({ ...tickerSettings, bgColor: e.target.value })} className="w-6 h-4 bg-transparent border-none cursor-pointer" />
                  </div>
                </div>
                <select
                  className="w-full bg-[#1e1f22] text-[10px] text-gray-200 border border-[#36393f] rounded p-1.5 outline-none appearance-none"
                  style={{ backgroundImage: `url('data:image/svg+xml;utf8,<svg fill="currentColor" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z" fill="%239CA3AF"/></svg>')`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 4px center', backgroundSize: '12px' }}
                  value={tickerSettings.position}
                  onChange={(e) => setTickerSettings({ ...tickerSettings, position: e.target.value })}
                >
                  <option value="bottom" className="bg-[#2b2d31]">Bandeau en Bas</option>
                  <option value="top" className="bg-[#2b2d31]">Bandeau en Haut</option>
                </select>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Projection Controls */}
      <div className="ml-auto flex items-center gap-1 bg-[#1e1f22] p-1 rounded-md border border-[#36393f]">
        <button
          id="hide-toggle-btn"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition text-[10px] font-bold ${isContentHidden ? 'bg-orange-500/20 border border-orange-500/50 text-orange-400' : 'hover:bg-[#3f4147] text-gray-400 hover:text-white'}`}
          onClick={async () => {
            setIsContentHidden(!isContentHidden);
            (await import('@tauri-apps/api/event')).emit('update_live_hide_content', !isContentHidden);
          }}
        >
          {isContentHidden ? <Eye size={14} /> : <EyeOff size={14} />}
          {isContentHidden ? "AFFICHER" : "CACHER"}
        </button>

        <div className="w-px h-6 bg-[#2b2d31] mx-0.5"></div>

        <button
          id="live-toggle-btn"
          className={`flex items-center gap-2 px-4 py-1.5 rounded transition text-[10px] font-black tracking-widest ${isLiveActive ? 'bg-red-600 text-white animate-pulse' : 'bg-[#5865f2]/20 border border-[#5865f2]/50 text-[#5865f2] hover:bg-[#5865f2] hover:text-white'}`}
          onClick={handleLiveToggle}
        >
          {isLiveActive ? <StopCircle size={14} /> : <Play size={14} />}
          {isLiveActive ? "OFF" : "LIVE"}
        </button>
      </div>
    </div>
  );
}
