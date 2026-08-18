import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  AlertCircle, Check, Download, Gauge, Loader2, Music2, Pause, Play,
  Repeat, Square, Trash2, Volume2, VolumeX, WifiOff,
} from "lucide-react";
import { trackForSong, type TrackRef } from "../lib/audioTrack";

type Status = "idle" | "loading" | "playing" | "paused" | "error";

const SPEEDS = [0.75, 1, 1.25, 1.5];

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

/**
 * Lecteur de l'audio associé à l'élément projeté : playback d'un cantique ou
 * chapitre de la Bible malgache.
 *
 * Règle de résolution, tolérante aux pannes de bout en bout :
 *   1. le fichier téléchargé (aucun réseau) ;
 *   2. sinon le flux distant, récupéré par Rust puis lu depuis un blob local
 *      (ni la CSP ni les redirections ne peuvent le bloquer) ;
 *   3. sinon un message explicite — jamais d'exception qui remonte.
 */
export function AudioPlayer({ song }: { song: any }) {
  const track = useMemo<TrackRef | null>(() => trackForSong(song), [song]);

  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [open, setOpen] = useState(false);

  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);

  const [installed, setInstalled] = useState(false);
  const [dlProgress, setDlProgress] = useState<number | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loadedFor = useRef<string | null>(null);

  const trackKey = track ? `${track.collection}/${track.filename}` : null;

  /**
   * Remet l'élément à l'état vierge.
   *
   * Indispensable : retirer l'attribut `src` ne suffit pas. Tant que `load()`
   * n'est pas appelé, WebKitGTK conserve la ressource ET la position de lecture
   * précédentes — la piste suivante démarrait donc au temps où la précédente
   * s'était arrêtée (un Genèse 1 qui commence au verset 21).
   */
  const resetElement = (el: HTMLAudioElement) => {
    try {
      el.pause();
      el.removeAttribute("src");
      el.load();
      el.currentTime = 0;
    } catch (e) {
      console.warn("AudioPlayer: réinitialisation partielle", e);
    }
  };

  /** Charge une source et garantit un démarrage à 0:00. */
  const loadFromStart = (el: HTMLAudioElement, src: string) =>
    new Promise<void>((resolve) => {
      const onReady = () => {
        el.removeEventListener("loadedmetadata", onReady);
        // La position ne peut être fixée de façon fiable qu'une fois les
        // métadonnées connues (avant, WebKit ignore l'affectation).
        try { if (el.currentTime > 0.1) el.currentTime = 0; } catch { /* ignoré */ }
        resolve();
      };
      el.addEventListener("loadedmetadata", onReady);
      el.src = src;
      el.load();
      // Filet de sécurité : on ne bloque pas la lecture si l'événement tarde.
      window.setTimeout(() => {
        el.removeEventListener("loadedmetadata", onReady);
        resolve();
      }, 4000);
    });

  // --- élément audio unique -------------------------------------------------
  useEffect(() => {
    const el = new Audio();
    el.preload = "none";
    const onTime = () => setTime(el.currentTime);
    const onMeta = () => setDuration(el.duration || 0);
    const onEnd = () => setStatus(el.loop ? "playing" : "idle");
    const onErr = () => {
      setStatus("error");
      setMessage("Lecture impossible : source illisible.");
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("ended", onEnd);
    el.addEventListener("error", onErr);
    audioRef.current = el;
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("error", onErr);
      try { el.pause(); el.removeAttribute("src"); el.load(); } catch { /* démontage */ }
      audioRef.current = null;
    };
  }, []);

  // Réglages appliqués à chaud.
  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume]);
  useEffect(() => { if (audioRef.current) audioRef.current.muted = muted; }, [muted]);
  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = rate; }, [rate]);
  useEffect(() => { if (audioRef.current) audioRef.current.loop = loop; }, [loop]);

  // Changer d'élément coupe l'audio précédent.
  useEffect(() => {
    const el = audioRef.current;
    if (el) resetElement(el);
    loadedFor.current = null;
    setStatus("idle"); setMessage(null); setIsOffline(false);
    setTime(0); setDuration(0); setOpen(false);
  }, [trackKey]);

  // Présence du fichier hors ligne.
  useEffect(() => {
    let alive = true;
    if (!track) { setInstalled(false); return; }
    (async () => {
      try {
        const { listInstalled } = await import("../lib/library");
        const files = await listInstalled("audio", track.collection);
        if (alive) setInstalled(files.some((f) => f.filename === track.filename));
      } catch {
        if (alive) setInstalled(false);
      }
    })();
    return () => { alive = false; };
  }, [trackKey, track]);

  // Progression du téléchargement.
  useEffect(() => {
    let un: (() => void) | undefined;
    listen<{ id: string; received: number; total: number }>("library_download_progress", (e) => {
      if (trackKey && e.payload.id === trackKey) {
        setDlProgress(e.payload.total > 0 ? Math.round((e.payload.received / e.payload.total) * 100) : 0);
      }
    }).then((u) => { un = u; });
    return () => { if (un) un(); };
  }, [trackKey]);

  if (!track) return null;

  /** URL distante de la piste. Null si introuvable. Ne lève jamais. */
  const remoteUrl = async (): Promise<string | null> => {
    if (track.directUrl) return track.directUrl;
    try {
      const { resolveHymnAudio } = await import("../lib/library");
      const found = await resolveHymnAudio(track.playbackCollection!, track.hymnNumber!);
      return found?.url || null;
    } catch (e) {
      console.warn("AudioPlayer: manifeste des playbacks injoignable", e);
      return null;
    }
  };

  /** Source lisible : local d'abord, flux ensuite. */
  const resolveSource = async (): Promise<string | null> => {
    try {
      const { listInstalled } = await import("../lib/library");
      const { cleanUrl } = await import("../lib/media");
      const files = await listInstalled("audio", track.collection);
      const local = files.find((f) => f.filename === track.filename);
      if (local) {
        const url = cleanUrl(local.path);
        if (url) { setIsOffline(true); return url; }
      }
    } catch (e) {
      console.warn("AudioPlayer: recherche locale impossible", e);
    }

    const url = await remoteUrl();
    if (!url) {
      setMessage("Audio introuvable — télécharge-le pour l'utiliser hors ligne.");
      return null;
    }
    try {
      const { cacheRemoteAudio } = await import("../lib/library");
      const local = await cacheRemoteAudio(url, `${track.collection}-${track.filename}`);
      setIsOffline(false);
      return local;
    } catch (e) {
      setMessage(`Lecture en ligne impossible : ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };

  const toggle = async () => {
    const el = audioRef.current;
    if (!el) return;
    try {
      if (status === "playing") { el.pause(); setStatus("paused"); return; }
      if (status === "paused" && loadedFor.current === trackKey) {
        await el.play(); setStatus("playing"); return;
      }
      setStatus("loading"); setMessage(null);
      const src = await resolveSource();
      if (!src) { setStatus("error"); return; }
      await loadFromStart(el, src);
      el.volume = volume; el.muted = muted; el.playbackRate = rate; el.loop = loop;
      await el.play();
      setTime(el.currentTime);
      loadedFor.current = trackKey;
      setStatus("playing");
      setOpen(true);
    } catch (e) {
      console.warn("AudioPlayer: lecture refusée", e);
      setStatus("error");
      setMessage(`Lecture impossible : ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const stop = () => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    try { el.currentTime = 0; } catch { /* métadonnées absentes */ }
    setTime(0);
    setStatus("idle");
  };

  const seek = (v: number) => {
    const el = audioRef.current;
    if (!el || !isFinite(el.duration)) return;
    el.currentTime = v;
    setTime(v);
  };

  const downloadOffline = async () => {
    setMessage(null);
    const url = await remoteUrl();
    if (!url) { setMessage("Impossible de retrouver l'URL de cette piste."); return; }
    setDlProgress(0);
    try {
      const { downloadFile } = await import("../lib/library");
      await downloadFile({
        url, kind: "audio", filename: track.filename,
        id: trackKey!, collection: track.collection,
      });
      setInstalled(true);
    } catch (e) {
      setMessage(`Téléchargement échoué : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDlProgress(null);
    }
  };

  const removeOffline = async () => {
    try {
      const { removeInstalled } = await import("../lib/library");
      await removeInstalled("audio", track.filename, track.collection);
      setInstalled(false);
    } catch (e) {
      setMessage(`Suppression impossible : ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="relative flex items-center gap-1">
      <button
        onClick={toggle}
        disabled={status === "loading"}
        title={status === "playing" ? "Pause" : `Lire l'audio — ${track.label}`}
        className={`flex items-center gap-1.5 rounded-l px-2.5 py-1 text-xs font-semibold transition ${
          status === "playing" ? "bg-emerald-600 text-white hover:bg-emerald-500"
          : status === "error" ? "bg-[#202225] text-red-400 hover:bg-[#282a2e]"
          : "bg-[#202225] text-gray-300 hover:bg-[#282a2e] hover:text-white"
        }`}
      >
        {status === "loading" ? <Loader2 size={12} className="animate-spin" />
          : status === "playing" ? <Pause size={12} />
          : status === "error" ? <AlertCircle size={12} />
          : <Play size={12} />}
        <Music2 size={12} className="opacity-60" />
      </button>

      <button
        onClick={() => setOpen(!open)}
        title="Options de lecture"
        className={`rounded-r px-1.5 py-1 text-xs transition ${
          open ? "bg-[#5865f2] text-white" : "bg-[#202225] text-gray-400 hover:bg-[#282a2e] hover:text-white"
        }`}
      >
        ⋯
      </button>

      {installed && (
        <span title="Disponible hors ligne" className="ml-1 text-emerald-500"><Check size={12} /></span>
      )}
      {!installed && status === "playing" && !isOffline && (
        <span title="Lecture en ligne" className="ml-1 text-amber-500"><WifiOff size={12} /></span>
      )}

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-80 rounded-lg border border-[#202225] bg-[#2f3136] p-3 shadow-2xl shadow-black/50">
          <p className="mb-2 truncate text-[11px] font-bold text-gray-200" title={track.label}>{track.label}</p>

          {/* Progression */}
          <input
            type="range" min={0} max={duration || 0} step={0.5} value={time}
            onChange={(e) => seek(parseFloat(e.target.value))}
            disabled={!duration}
            className="h-1 w-full cursor-pointer accent-[#5865f2]"
          />
          <div className="mb-3 flex justify-between text-[10px] tabular-nums text-gray-500">
            <span>{fmt(time)}</span><span>{fmt(duration)}</span>
          </div>

          {/* Transport */}
          <div className="mb-3 flex items-center gap-2">
            <button onClick={toggle} className="rounded bg-[#5865f2] p-1.5 text-white transition hover:bg-[#4752c4]">
              {status === "playing" ? <Pause size={13} /> : <Play size={13} />}
            </button>
            <button onClick={stop} title="Arrêter" className="rounded bg-[#202225] p-1.5 text-gray-300 transition hover:text-white">
              <Square size={13} />
            </button>
            <button
              onClick={() => setLoop(!loop)}
              title="Lecture en boucle"
              className={`rounded p-1.5 transition ${loop ? "bg-emerald-600 text-white" : "bg-[#202225] text-gray-400 hover:text-white"}`}
            >
              <Repeat size={13} />
            </button>

            <div className="ml-auto flex items-center gap-1.5">
              <button onClick={() => setMuted(!muted)} title={muted ? "Rétablir le son" : "Couper le son"} className="text-gray-400 transition hover:text-white">
                {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
              </button>
              <input
                type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume}
                onChange={(e) => { setVolume(parseFloat(e.target.value)); setMuted(false); }}
                className="h-1 w-16 cursor-pointer accent-[#5865f2]"
              />
            </div>
          </div>

          {/* Vitesse */}
          <div className="mb-3 flex items-center gap-1.5">
            <Gauge size={12} className="text-gray-500" />
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => setRate(s)}
                className={`rounded px-2 py-0.5 text-[10px] font-bold transition ${
                  rate === s ? "bg-[#5865f2] text-white" : "bg-[#202225] text-gray-400 hover:text-white"
                }`}
              >
                {s}×
              </button>
            ))}
          </div>

          {/* Hors ligne */}
          <div className="border-t border-[#202225] pt-2">
            {dlProgress !== null ? (
              <div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full bg-[#5865f2] transition-[width]" style={{ width: `${dlProgress}%` }} />
                </div>
                <p className="mt-1 text-[10px] text-gray-400">Téléchargement… {dlProgress} %</p>
              </div>
            ) : installed ? (
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-400">
                  <Check size={11} /> Disponible hors ligne
                </span>
                <button onClick={removeOffline} className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-gray-500 transition hover:bg-red-500/15 hover:text-red-400">
                  <Trash2 size={11} /> Retirer
                </button>
              </div>
            ) : (
              <button onClick={downloadOffline} className="flex items-center gap-1.5 rounded bg-[#202225] px-2.5 py-1.5 text-[10px] font-bold text-gray-300 transition hover:bg-[#5865f2] hover:text-white">
                <Download size={11} /> Télécharger pour le hors ligne
              </button>
            )}
          </div>

          {message && (
            <p className="mt-2 rounded border border-red-500/20 bg-red-500/10 p-2 text-[10px] leading-relaxed text-red-400">
              {message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
