import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Music, Pause, Play, Plus, Wifi } from "lucide-react";
import {
  fetchPlaybackCollections, fetchPlaybackTracks, listInstalled, trackFileName,
  type PlaybackCollection, type PlaybackTrack,
} from "../../lib/library";
import { cleanUrl } from "../../lib/media";
import { useLibraryDownloads } from "./useLibrary";
import { Card, EmptyState, ErrorBox, InstallButton, Spinner } from "./ui";

/**
 * Playbacks des cantiques. Deux modes, au choix de l'utilisateur :
 *  - écoute en ligne directe (aucun téléchargement),
 *  - téléchargement pour l'utilisation hors ligne pendant le culte.
 */
export function AudioSection({ search, onAddToPlaylist }: {
  search: string;
  onAddToPlaylist: (item: any) => void;
}) {
  const [collections, setCollections] = useState<PlaybackCollection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<PlaybackCollection | null>(null);

  const load = () => {
    setError(null);
    fetchPlaybackCollections().then(setCollections).catch((e) => setError(String(e.message || e)));
  };
  useEffect(load, []);

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!collections) return <Spinner label="Chargement des playbacks" />;

  if (opened) {
    return <TrackList collection={opened} search={search} onBack={() => setOpened(null)} onAddToPlaylist={onAddToPlaylist} />;
  }

  const q = search.trim().toLowerCase();
  const visible = q ? collections.filter((c) => c.title.toLowerCase().includes(q)) : collections;

  return visible.length === 0 ? (
    <EmptyState>Aucun recueil audio ne correspond.</EmptyState>
  ) : (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
      {visible.map((c) => (
        <Card
          key={c.id}
          accent={c.color || "#10b981"}
          eyebrow={c.lang}
          title={c.title}
          meta={<span className="flex items-center gap-1.5"><Music size={11} /> {c.count ?? "?"} pistes</span>}
          onOpen={() => setOpened(c)}
          actions={
            <button
              onClick={() => setOpened(c)}
              className="w-full rounded bg-[#5865f2] px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-[#4752c4]"
            >
              Ouvrir le recueil
            </button>
          }
        />
      ))}
    </div>
  );
}

function TrackList({ collection, search, onBack, onAddToPlaylist }: {
  collection: PlaybackCollection;
  search: string;
  onBack: () => void;
  onAddToPlaylist: (item: any) => void;
}) {
  const [tracks, setTracks] = useState<PlaybackTrack[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { installed, progress, failed, download, remove } = useLibraryDownloads("audio", collection.id);

  const load = () => {
    setError(null);
    fetchPlaybackTracks(collection.id).then(setTracks).catch((e) => setError(String(e.message || e)));
  };
  useEffect(load, [collection.id]);

  // Un seul lecteur pour toute la liste : on libère la source au démontage,
  // sinon le pipeline GStreamer reste ouvert en quittant la bibliothèque.
  useEffect(() => {
    const el = new Audio();
    el.addEventListener("ended", () => setPlaying(null));
    el.addEventListener("error", () => {
      setPlayError("Lecture impossible : source indisponible ou hors ligne.");
      setPlaying(null);
    });
    audioRef.current = el;
    return () => {
      el.pause();
      el.removeAttribute("src");
      el.load();
      audioRef.current = null;
    };
  }, []);

  const localPathOf = async (filename: string) => {
    const files = await listInstalled("audio", collection.id);
    return files.find((f) => f.filename === filename)?.path || null;
  };

  const toggle = async (track: PlaybackTrack) => {
    const el = audioRef.current;
    if (!el) return;
    const filename = trackFileName(track);
    setPlayError(null);

    if (playing === track.id) {
      el.pause();
      setPlaying(null);
      return;
    }

    try {
      // Priorité au fichier local : instantané et fonctionne sans réseau.
      let source: string | null = null;
      if (installed.has(filename)) {
        const path = await localPathOf(filename);
        if (path) source = cleanUrl(path) || null;
      }

      // Sinon on récupère le flux via Rust : l'élément <audio> ne contacte
      // aucun hôte externe, donc ni la CSP ni la redirection Google Drive ne
      // peuvent bloquer la lecture.
      if (!source) {
        const { cacheRemoteAudio } = await import("../../lib/library");
        source = await cacheRemoteAudio(track.url, `${collection.id}-${filename}`);
      }

      // Même précaution que dans le lecteur de présentation : sans `load()`,
      // WebKitGTK garde la position de la piste précédente et la nouvelle
      // démarre en plein milieu.
      el.pause();
      el.removeAttribute("src");
      el.load();
      el.src = source;
      el.load();
      await el.play();
      try { if (el.currentTime > 0.1) el.currentTime = 0; } catch { /* ignoré */ }
      setPlaying(track.id);
    } catch (e) {
      setPlayError(`Lecture impossible : ${e instanceof Error ? e.message : String(e)}`);
      setPlaying(null);
    }
  };

  const addToAgenda = async (track: PlaybackTrack) => {
    const filename = trackFileName(track);
    // Hors ligne garanti dans l'agenda : on télécharge si ce n'est pas déjà fait.
    const path = installed.has(filename)
      ? await localPathOf(filename)
      : await download(track.id, track.url, filename);
    if (!path) return;
    onAddToPlaylist({
      id: `${Date.now()}`,
      title: `${track.c_num || track.id} · ${track.title}`,
      number: "🎵",
      lyrics: path,
      type: "audio",
    });
  };

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!tracks) return <Spinner label={`Chargement de ${collection.title}`} />;

  const q = search.trim().toLowerCase();
  const visible = q
    ? tracks.filter((t) => t.title.toLowerCase().includes(q) || String(t.c_num || t.id).includes(q))
    : tracks;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 rounded border border-white/10 px-3 py-1.5 text-[11px] font-bold text-gray-300 transition hover:border-white/25 hover:text-white"
        >
          <ArrowLeft size={13} /> Recueils
        </button>
        <div>
          <h3 className="text-sm font-bold text-white">{collection.title}</h3>
          <p className="text-[11px] text-gray-500">
            {tracks.length} pistes · {installed.size} hors ligne
          </p>
        </div>
      </div>

      <p className="flex items-center gap-2 rounded border border-white/5 bg-[#1e1f22] px-3 py-2 text-[11px] text-gray-400">
        <Wifi size={13} className="text-[#5865f2]" />
        Lecture directe en ligne. Télécharge une piste pour l'utiliser sans connexion pendant le culte.
      </p>

      {playError && <p className="rounded border border-red-500/20 bg-red-500/10 p-2.5 text-[11px] text-red-400">{playError}</p>}

      <div className="divide-y divide-white/5 overflow-hidden rounded-lg border border-white/5 bg-[#232428]">
        {visible.map((track) => {
          const filename = trackFileName(track);
          const isInstalled = installed.has(filename);
          return (
            <div key={track.id} className="flex items-center gap-3 px-3 py-2 transition hover:bg-white/[0.03]">
              <button
                onClick={() => toggle(track)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#5865f2]/15 text-[#8891f2] transition hover:bg-[#5865f2] hover:text-white"
                title={isInstalled ? "Lire (hors ligne)" : "Écouter en ligne"}
              >
                {playing === track.id ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <span className="w-10 shrink-0 text-right text-[11px] font-bold tabular-nums text-gray-500">
                {track.c_num || track.id}
              </span>
              <span className="flex-1 truncate text-xs text-gray-200" title={track.title}>
                {track.title}
                {failed[track.id] && <span className="ml-2 text-[10px] text-red-400">échec du téléchargement</span>}
              </span>
              <div className="w-40 shrink-0">
                <InstallButton
                  compact
                  installed={isInstalled}
                  progress={progress[track.id]}
                  onInstall={() => download(track.id, track.url, filename)}
                  onRemove={() => remove(filename)}
                />
              </div>
              <button
                onClick={() => addToAgenda(track)}
                title="Ajouter à l'agenda (télécharge si nécessaire)"
                className="shrink-0 rounded border border-[#5865f2]/40 px-2 py-1.5 text-[10px] font-bold text-[#8891f2] transition hover:bg-[#5865f2] hover:text-white"
              >
                <Plus size={12} />
              </button>
            </div>
          );
        })}
        {visible.length === 0 && <EmptyState>Aucune piste ne correspond.</EmptyState>}
      </div>
    </div>
  );
}
