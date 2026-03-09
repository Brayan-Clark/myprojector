import { useState, useEffect } from 'react';
import { Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, Type, PaintBucket, MonitorOff, Cast, Play, Image, Video, Plus, StopCircle } from 'lucide-react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';

let liveWindowPopup: Window | null = null;

export function Toolbar({ setBgImage, textSettings, setTextSettings, isLiveActive, setIsLiveActive }: any) {
  const [activeMediaMenu, setActiveMediaMenu] = useState<'image' | 'video' | null>(null);
  const [customBgs, setCustomBgs] = useState<string[]>([]);

  const isVideoUrl = (url: string) => url.match(/\.(mp4|webm|ogg|mov|mkv|avi|m4v)(\?.*)?$/i);
  
  const defaultBgs = [
    { name: 'Sunset', url: '/backgrounds/sunset.jpg' },
    { name: 'Tree', url: '/backgrounds/tree.png' },
    { name: 'Noir', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' }
  ];

  const handleBgSelect = async (url: string) => {
    setBgImage(url);
    localStorage.setItem('live_bg', url);
    const { emit } = await import('@tauri-apps/api/event');
    await emit('update_live_bg', url);
    setActiveMediaMenu(null);
  };

  const handleAddCustomMedia = async (mediaType: 'image' | 'video') => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const file = await open({
        multiple: false,
        filters: mediaType === 'image' ? [{
          name: 'Images',
          extensions: ['png', 'jpeg', 'jpg', 'webp']
        }] : [{
          name: 'Videos',
          extensions: ['mp4', 'webm', 'ogg']
        }]
      });
      if (file && typeof file === 'string') {
        const assetUrl = convertFileSrc(file);
        // Add to list and select
        setCustomBgs([...customBgs, assetUrl]);
        handleBgSelect(assetUrl);
      }
    } catch(e) { console.error(e) }
  };
  // Effet pour synchroniser avec LiveView
  useEffect(() => {
    import('@tauri-apps/api/event').then(({ emit }) => {
      emit('update_live_style', textSettings).catch(console.error);
    });
  }, [textSettings]);

  return (
    <div className="h-20 bg-[#2b2d31] border-b border-[#1e1f22] flex items-center px-4 gap-6 shrink-0 shadow-sm z-10">
      
      {/* Group: Style de texte */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Style</span>
        <div className="flex items-center gap-1 bg-[#1e1f22] p-1 rounded-md">
           <select 
              className="bg-[#2b2d31] text-xs text-gray-200 border border-[#36393f] outline-none rounded px-2 py-1 cursor-pointer appearance-none pr-6"
              style={{ backgroundImage: `url('data:image/svg+xml;utf8,<svg fill="currentColor" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z" fill="%239CA3AF"/></svg>')`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 2px center', backgroundSize: '16px' }}
              value={textSettings.fontFamily}
              onChange={(e) => {
                  const newSettings = { ...textSettings, fontFamily: e.target.value };
                  setTextSettings(newSettings);
                  localStorage.setItem('live_style', JSON.stringify(newSettings));
                  import('@tauri-apps/api/event').then(({ emit }) => emit('update_live_style', newSettings));
              }}
           >
              <option className="bg-[#2b2d31]" value="Inter">Inter</option>
              <option className="bg-[#2b2d31]" value="Roboto">Roboto</option>
              <option className="bg-[#2b2d31]" value="Arial">Arial</option>
              <option className="bg-[#2b2d31]" value="Times New Roman">Times New Roman</option>
           </select>
           <input 
             type="number"
             min="50"
             max="300"
             step="10"
             className="bg-[#2b2d31] text-xs text-gray-200 border border-[#36393f] outline-none rounded px-2 py-1 w-14 text-center cursor-ns-resize"
             title="Taille de la police (%)"
             value={textSettings.fontSize || 100}
             onChange={(e) => {
                 const newSettings = { ...textSettings, fontSize: parseInt(e.target.value) || 100 };
                 setTextSettings(newSettings);
                 localStorage.setItem('live_style', JSON.stringify(newSettings));
                 import('@tauri-apps/api/event').then(({ emit }) => emit('update_live_style', newSettings));
             }}
           />
           <div className="w-px h-4 bg-gray-600 mx-1"></div>
           <button 
             className={`p-1.5 rounded transition ${textSettings.isBold ? 'bg-[#5865f2] text-white shadow-sm' : 'hover:bg-[#3f4147] text-gray-300'}`}
             onClick={() => setTextSettings({ ...textSettings, isBold: !textSettings.isBold })}
           >
             <Bold size={14} />
           </button>
           <button 
             className={`p-1.5 rounded transition ${textSettings.isItalic ? 'bg-[#5865f2] text-white shadow-sm' : 'hover:bg-[#3f4147] text-gray-300'}`}
             onClick={() => setTextSettings({ ...textSettings, isItalic: !textSettings.isItalic })}
           >
             <Italic size={14} />
           </button>
           <button 
             className={`p-1.5 rounded transition ${textSettings.isUnderline ? 'bg-[#5865f2] text-white shadow-sm' : 'hover:bg-[#3f4147] text-gray-300'}`}
             onClick={() => setTextSettings({ ...textSettings, isUnderline: !textSettings.isUnderline })}
           >
             <Underline size={14} />
           </button>
        </div>
      </div>

      <div className="w-px h-10 bg-[#1e1f22]"></div>

      {/* Group: Alignement & Couleur */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Mise en forme</span>
        <div className="flex items-center gap-1 bg-[#1e1f22] p-1 rounded-md">
           <div className="flex bg-[#2b2d31] rounded border border-[#36393f] overflow-hidden">
             <button 
               className={`p-1.5 transition ${textSettings.align === 'left' ? 'bg-[#3f4147] text-white shadow-inner' : 'hover:bg-[#3f4147] text-gray-400'}`}
               onClick={async () => {
                   const newSettings = { ...textSettings, align: 'left' };
                   setTextSettings(newSettings);
                   localStorage.setItem('live_style', JSON.stringify(newSettings));
                   const { emit } = await import('@tauri-apps/api/event');
                   await emit('update_live_style', newSettings);
               }}
             ><AlignLeft size={14} /></button>
             <button 
               className={`p-1.5 transition ${textSettings.align === 'center' ? 'bg-[#3f4147] text-white shadow-inner border-x border-[#36393f]' : 'hover:bg-[#3f4147] text-gray-400 border-x border-[#36393f]'}`}
               onClick={async () => {
                   const newSettings = { ...textSettings, align: 'center' };
                   setTextSettings(newSettings);
                   localStorage.setItem('live_style', JSON.stringify(newSettings));
                   const { emit } = await import('@tauri-apps/api/event');
                   await emit('update_live_style', newSettings);
               }}
             ><AlignCenter size={14} /></button>
             <button 
               className={`p-1.5 transition ${textSettings.align === 'right' ? 'bg-[#3f4147] text-white shadow-inner' : 'hover:bg-[#3f4147] text-gray-400'}`}
               onClick={async () => {
                   const newSettings = { ...textSettings, align: 'right' };
                   setTextSettings(newSettings);
                   localStorage.setItem('live_style', JSON.stringify(newSettings));
                   const { emit } = await import('@tauri-apps/api/event');
                   await emit('update_live_style', newSettings);
               }}
             ><AlignRight size={14} /></button>
           </div>
           <div className="w-px h-4 bg-gray-600 mx-1"></div>
           <button className="p-1.5 hover:bg-[#3f4147] rounded text-gray-300 transition"><Type size={14} /></button>
           <button className="p-1.5 hover:bg-[#3f4147] rounded text-gray-300 transition"><PaintBucket size={14} /></button>
        </div>
      </div>

      <div className="w-px h-10 bg-[#1e1f22]"></div>

      {/* Group: Arrière-plan */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Arrière-plan</span>
        <div className="flex items-center gap-1 bg-[#1e1f22] p-1 rounded-md">
           <div className="relative">
             <button 
               className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-[#3f4147] rounded text-gray-300 transition text-xs font-semibold"
               onClick={() => setActiveMediaMenu(activeMediaMenu === 'image' ? null : 'image')}
             >
                <Image size={14} /> Images
             </button>
             
             {activeMediaMenu === 'image' && (
               <div className="absolute top-full left-0 mt-2 bg-[#2b2d31] border border-[#1e1f22] shadow-2xl rounded p-2 z-50 w-64">
                 <div className="flex justify-between items-center mb-2 px-1">
                    <span className="text-xs font-bold text-gray-400 uppercase">Fonds d'écran</span>
                    <button onClick={() => handleAddCustomMedia('image')} className="text-[#5865f2] hover:text-[#4752c4] transition" title="Ajouter une image depuis l'ordinateur" ><Plus size={14} /></button>
                 </div>
                 <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                    {defaultBgs.map(bg => (
                      <div 
                        key={bg.name}
                        onClick={() => handleBgSelect(bg.url)}
                        className="relative group cursor-pointer rounded overflow-hidden aspect-video border border-[#1e1f22] hover:border-[#5865f2] transition"
                      >
                         <img src={bg.url} alt={bg.name} className="w-full h-full object-cover" />
                         <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-end p-1">
                            <span className="text-[10px] text-white font-bold truncate">{bg.name}</span>
                         </div>
                      </div>
                    ))}
                    {customBgs.filter(url => !isVideoUrl(url)).map((url, i) => (
                      <div 
                        key={i}
                        onClick={() => handleBgSelect(url)}
                        className="relative group cursor-pointer rounded overflow-hidden aspect-video border border-[#1e1f22] hover:border-[#5865f2] transition"
                      >
                         <img src={url} alt={`Custom ${i}`} className="w-full h-full object-cover" />
                         <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-end p-1">
                            <span className="text-[10px] text-white font-bold truncate">Custom Image</span>
                         </div>
                      </div>
                    ))}
                 </div>
               </div>
             )}
           </div>

           <div className="relative">
             <button 
               className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-[#3f4147] rounded text-gray-300 transition text-xs font-semibold"
               onClick={() => setActiveMediaMenu(activeMediaMenu === 'video' ? null : 'video')}
               title="Ajouter une vidéo depuis l'ordinateur"
             >
                <Video size={14} /> Vidéo
             </button>

             {activeMediaMenu === 'video' && (
               <div className="absolute top-full left-0 mt-2 bg-[#2b2d31] border border-[#1e1f22] shadow-2xl rounded p-2 z-50 w-64">
                 <div className="flex justify-between items-center mb-2 px-1">
                    <span className="text-xs font-bold text-gray-400 uppercase">Arrière-plans Vidéo</span>
                    <button onClick={() => handleAddCustomMedia('video')} className="text-[#5865f2] hover:text-[#4752c4] transition" title="Ajouter une vidéo depuis l'ordinateur" ><Plus size={14} /></button>
                 </div>
                 <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                    {customBgs.filter(url => isVideoUrl(url)).map((url, i) => (
                      <div 
                        key={i}
                        onClick={() => handleBgSelect(url)}
                        className="relative group cursor-pointer rounded overflow-hidden aspect-video border border-[#1e1f22] hover:border-[#5865f2] transition"
                      >
                         <video src={url} className="w-full h-full object-cover" />
                         <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-end p-1">
                            <span className="text-[10px] text-white font-bold truncate">Custom Video</span>
                         </div>
                      </div>
                    ))}
                    {customBgs.filter(url => isVideoUrl(url)).length === 0 && (
                       <div className="col-span-2 text-center text-xs text-gray-500 py-4">Aucune vidéo. Importez-en une !</div>
                    )}
                 </div>
               </div>
             )}
           </div>
           <div className="w-px h-4 bg-gray-600 mx-1"></div>
           <button 
              className="flex flex-col items-center justify-center w-6 h-6 rounded bg-black border border-gray-600 ml-1 cursor-pointer transition hover:border-gray-400"
              onClick={async () => {
                  /* Optional: a blank or purely black background / transparent image for purely text */
                  setBgImage("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=");
                  const { emit } = await import('@tauri-apps/api/event');
                  await emit('update_live_bg', "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=");
              }}
           ></button>
           <button className="flex flex-col items-center justify-center w-6 h-6 rounded bg-gradient-to-br from-blue-900 to-indigo-500 cursor-pointer transition hover:ring-1 hover:ring-white"></button>
        </div>
      </div>

      <div className="w-px h-10 bg-[#1e1f22] ml-auto"></div>

      {/* Group: Actions Rapides (Noir, Logo) */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Projection</span>
        <div className="flex items-center gap-2">
           <button 
             className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 rounded-md transition text-xs font-semibold"
             onClick={async () => {
               localStorage.setItem('live_lyrics', JSON.stringify({ lines: [] }));
               const { emit } = await import('@tauri-apps/api/event');
               await emit('update_live_lyrics', { lines: [] });
             }}
           >
              <MonitorOff size={14} /> Noir
           </button>
           <button 
             className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition text-xs font-semibold shadow-md ml-2 ${isLiveActive ? 'bg-red-600 hover:bg-red-500 text-white animate-pulse' : 'bg-[#5865f2] hover:bg-[#4752c4] text-white'}`}
             onClick={async () => {
               if (isLiveActive) {
                  setIsLiveActive(false);
                  const { emit } = await import('@tauri-apps/api/event');
                  await emit('update_live_lyrics', { lines: [] });
                  try {
                     const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
                     const w = await WebviewWindow.getByLabel('live');
                     if (w) await w.close();
                  } catch (e) {
                     console.error("Failed to close WebviewWindow", e);
                  }
                  if (liveWindowPopup) {
                     liveWindowPopup.close();
                     liveWindowPopup = null;
                  }
               } else {
                  setIsLiveActive(true);
                  try {
                    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
                    const w = new WebviewWindow('live', {
                      url: '/?live=true',
                      title: 'Live Projection',
                      fullscreen: true
                    });
                    
                    w.once('tauri://error', (e) => {
                       console.error('Failed to create WebviewWindow', e);
                       liveWindowPopup = window.open('/?live=true', 'LiveProjection', 'popup,fullscreen=yes,width=1280,height=720');
                    });
                  } catch (e) {
                    console.error('Cannot import WebviewWindow', e);
                    liveWindowPopup = window.open('/?live=true', 'LiveProjection', 'popup,fullscreen=yes,width=1280,height=720');
                  }
               }
             }}
           >
              {isLiveActive ? <StopCircle size={14} aria-hidden="true"/> : <Play size={14} aria-hidden="true"/>} 
              {isLiveActive ? "ARRÊTER LIVE" : "Démarrer Live"}
           </button>
        </div>
      </div>
    </div>
  );
}
