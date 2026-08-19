import { useEffect, useState } from "react";
import { CheckCircle2, DownloadCloud, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import {
  checkForUpdate, currentVersion, installUpdate, releasesUrl,
  type UpdateInfo,
} from "../../lib/updater";
import { openExternalUrl } from "../../lib/openExternal";

/** Vérification manuelle des mises à jour, et installation à la demande. */
export function UpdateSection() {
  const [version, setVersion] = useState("…");
  const [state, setState] = useState<"idle" | "checking" | "uptodate" | "found" | "installing">("idle");
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { currentVersion().then(setVersion).catch(() => setVersion("inconnue")); }, []);

  const check = async () => {
    setError(null);
    setState("checking");
    const found = await checkForUpdate();
    setInfo(found);
    setState(found ? "found" : "uptodate");
  };

  const install = async () => {
    setError(null);
    setState("installing");
    try {
      await installUpdate(setPercent);
    } catch (e) {
      setError(String(e));
      setState("found");
    }
  };

  return (
    <div className="max-w-2xl space-y-4">
      <div className="rounded-lg border border-white/5 bg-[#232428] p-5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Version installée</p>
        <p className="mt-1 text-2xl font-black text-white">{version}</p>

        <button
          onClick={check}
          disabled={state === "checking" || state === "installing"}
          className="mt-4 flex items-center gap-2 rounded bg-[#5865f2] px-4 py-2 text-[11px] font-bold text-white transition hover:bg-[#4752c4] disabled:opacity-50"
        >
          {state === "checking"
            ? <><Loader2 size={14} className="animate-spin" /> Vérification…</>
            : <><RefreshCw size={14} /> Vérifier les mises à jour</>}
        </button>
      </div>

      {state === "uptodate" && (
        <p className="flex items-center gap-2 rounded border border-emerald-500/25 bg-emerald-500/[0.07] px-3 py-2 text-[11px] text-emerald-400">
          <CheckCircle2 size={14} /> L'application est à jour.
        </p>
      )}

      {info && (
        <div className="rounded-lg border border-[#5865f2]/40 bg-[#5865f2]/[0.07] p-5">
          <p className="text-sm font-bold text-white">Version {info.version} disponible</p>
          <p className="text-[11px] text-gray-400">
            Tu utilises la {info.currentVersion}
            {info.date ? ` · publiée le ${info.date.slice(0, 10)}` : ""}
          </p>

          {info.notes && (
            <pre className="mt-3 max-h-52 overflow-y-auto whitespace-pre-wrap rounded bg-black/30 p-3 text-[11px] leading-relaxed text-gray-300">
              {info.notes}
            </pre>
          )}

          {info.installKind === "auto" ? (
            state === "installing" ? (
              <div className="mt-4">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full bg-[#5865f2] transition-[width] ${percent === null ? "w-1/3 animate-pulse" : ""}`}
                    style={percent === null ? undefined : { width: `${percent}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-gray-400">
                  {percent === null ? "Téléchargement…" : `${percent} %`} — l'application redémarrera toute seule.
                </p>
              </div>
            ) : (
              <button
                onClick={install}
                className="mt-4 flex items-center gap-2 rounded bg-emerald-600 px-4 py-2 text-[11px] font-bold text-white transition hover:bg-emerald-500"
              >
                <DownloadCloud size={14} /> Installer et redémarrer
              </button>
            )
          ) : (
            <div className="mt-4 space-y-2">
              {/* Un .deb ou un .rpm appartient au gestionnaire de paquets :
                  l'application n'a pas à le remplacer dans le dos du système. */}
              <p className="text-[11px] leading-relaxed text-amber-400">
                Cette installation vient d'un paquet système (.deb / .rpm) : la mise à jour
                automatique ne s'applique pas. Télécharge le nouveau paquet et installe-le
                comme la première fois.
              </p>
              <button
                onClick={async () => setError(await openExternalUrl(await releasesUrl()))}
                className="flex items-center gap-2 rounded border border-white/15 px-4 py-2 text-[11px] font-bold text-gray-200 transition hover:border-white/30"
              >
                <ExternalLink size={14} /> Ouvrir la page de téléchargement
              </button>
            </div>
          )}

          {error && (
            <p className="mt-3 rounded border border-red-500/20 bg-red-500/10 p-2 text-[11px] text-red-400">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}
