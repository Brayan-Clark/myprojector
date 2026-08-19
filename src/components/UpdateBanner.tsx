import { useEffect, useState } from "react";
import { ArrowUpCircle, DownloadCloud, ExternalLink, X } from "lucide-react";
import {
  checkForUpdateIfDue, installUpdate, releasesUrl, skipVersion,
  type UpdateInfo,
} from "../lib/updater";
import { openExternalUrl } from "../lib/openExternal";

/**
 * Avertissement discret quand une nouvelle version existe.
 *
 * Volontairement une bannière et pas une fenêtre modale : on ne bloque pas
 * quelqu'un qui vient d'ouvrir l'application dix minutes avant le culte. Rien
 * ne s'installe sans un clic, et « Plus tard » vaut pour cette version.
 *
 * N'est monté que dans la fenêtre de contrôle : l'écran de projection ne doit
 * jamais afficher ça.
 */
export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Au démarrage, l'application a mieux à faire (bases, serveur média) :
    // la vérification attend que tout soit en place.
    const t = window.setTimeout(() => {
      checkForUpdateIfDue().then((found) => { if (found) setInfo(found); });
    }, 8000);
    return () => window.clearTimeout(t);
  }, []);

  if (!info) return null;

  const dismiss = () => { skipVersion(info.version); setInfo(null); };

  const install = async () => {
    setError(null);
    setInstalling(true);
    try {
      await installUpdate(setPercent);
    } catch (e) {
      setError(String(e));
      setInstalling(false);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-[300] w-80 rounded-lg border border-[#5865f2]/50 bg-[#232428] p-4 shadow-2xl shadow-black/60">
      <div className="flex items-start gap-3">
        <ArrowUpCircle size={18} className="mt-0.5 shrink-0 text-[#8891f2]" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-white">Version {info.version} disponible</p>
          <p className="mt-0.5 text-[11px] text-gray-500">Tu utilises la {info.currentVersion}</p>
        </div>
        {!installing && (
          <button onClick={dismiss} title="Plus tard" className="rounded p-1 text-gray-500 transition hover:bg-white/10 hover:text-white">
            <X size={14} />
          </button>
        )}
      </div>

      {installing ? (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full bg-[#5865f2] transition-[width] ${percent === null ? "w-1/3 animate-pulse" : ""}`}
              style={percent === null ? undefined : { width: `${percent}%` }}
            />
          </div>
          <p className="mt-1.5 text-[10px] text-gray-400">
            {percent === null ? "Téléchargement…" : `${percent} %`} — redémarrage automatique à la fin.
          </p>
        </div>
      ) : info.installKind === "auto" ? (
        <div className="mt-3 flex gap-2">
          <button
            onClick={install}
            className="flex flex-1 items-center justify-center gap-1.5 rounded bg-[#5865f2] px-3 py-2 text-[11px] font-bold text-white transition hover:bg-[#4752c4]"
          >
            <DownloadCloud size={13} /> Installer maintenant
          </button>
          <button
            onClick={dismiss}
            className="rounded border border-white/10 px-3 py-2 text-[11px] font-bold text-gray-400 transition hover:border-white/25 hover:text-gray-200"
          >
            Plus tard
          </button>
        </div>
      ) : (
        <button
          onClick={async () => setError(await openExternalUrl(await releasesUrl()))}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded border border-white/15 px-3 py-2 text-[11px] font-bold text-gray-200 transition hover:border-white/30"
        >
          <ExternalLink size={13} /> Télécharger le nouveau paquet
        </button>
      )}

      {error && <p className="mt-2 text-[10px] text-red-400">{error}</p>}
    </div>
  );
}
