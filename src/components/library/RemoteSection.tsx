import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bluetooth, Copy, Loader2, ShieldCheck, Smartphone, WifiOff } from "lucide-react";
import { ErrorBox, Spinner } from "./ui";

interface RemoteStatus { enabled: boolean; code: string; port: number; urls: string[] }

/**
 * Télécommande : pilote la projection depuis un téléphone du même réseau.
 * Éteinte par défaut, protégée par un code régénéré à chaque activation.
 */
export function RemoteSection() {
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setStatus(await invoke<RemoteStatus>("remote_status"));
    } catch (e: any) {
      setError(String(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async () => {
    if (!status) return;
    setBusy(true);
    try {
      setStatus(await invoke<RemoteStatus>("set_remote_enabled", { enabled: !status.enabled }));
    } catch (e: any) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      window.setTimeout(() => setCopied(null), 2000);
    } catch { /* presse-papiers indisponible */ }
  };

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!status) return <Spinner label="État de la télécommande" />;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${
          status.enabled ? "bg-emerald-500/15 text-emerald-400" : "bg-white/[0.06] text-gray-500"
        }`}>
          <Smartphone size={18} />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-white">Télécommande</h3>
          <p className="text-[11px] text-gray-500">Piloter la projection depuis un téléphone</p>
        </div>
        <button
          onClick={toggle}
          disabled={busy}
          className={`ml-auto flex items-center gap-2 rounded px-4 py-2 text-xs font-bold transition disabled:opacity-60 ${
            status.enabled
              ? "bg-red-600 text-white hover:bg-red-500"
              : "bg-[#5865f2] text-white hover:bg-[#4752c4]"
          }`}
        >
          {busy && <Loader2 size={13} className="animate-spin" />}
          {status.enabled ? "Désactiver" : "Activer"}
        </button>
      </div>

      {status.enabled ? (
        <>
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.07] p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-400">Code d'accès</p>
            <p className="mt-1 font-mono text-3xl font-black tracking-[0.3em] text-white">{status.code}</p>
            <p className="mt-1 text-[10px] text-gray-400">
              À saisir sur le téléphone. Un nouveau code est généré à chaque activation.
            </p>
          </div>

          <div>
            <p className="mb-2 text-xs font-bold text-gray-200">Adresse à ouvrir sur le téléphone</p>
            {status.urls.length === 0 ? (
              <p className="flex items-center gap-2 rounded border border-amber-500/25 bg-amber-500/[0.07] p-3 text-[11px] text-amber-300">
                <WifiOff size={13} /> Aucune adresse réseau détectée. Vérifie que l'ordinateur est connecté
                au même réseau Wi-Fi que le téléphone.
              </p>
            ) : (
              <div className="space-y-2">
                {status.urls.map((u) => (
                  <div key={u} className="flex items-center gap-2 rounded-lg border border-white/5 bg-[#232428] px-4 py-3">
                    <code className="min-w-0 flex-1 truncate font-mono text-sm text-gray-100">{u}</code>
                    <button
                      onClick={() => copy(u)}
                      title="Copier"
                      className="shrink-0 rounded p-1.5 text-gray-500 transition hover:bg-white/10 hover:text-white"
                    >
                      <Copy size={13} />
                    </button>
                    {copied === u && <span className="shrink-0 text-[10px] text-emerald-400">copié</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <p className="rounded-lg border border-white/5 bg-[#232428] p-4 text-[11px] leading-relaxed text-gray-400">
          Une fois activée, une page s'ouvre depuis le navigateur du téléphone avec les boutons
          <strong className="text-gray-200"> Suivant</strong>,
          <strong className="text-gray-200"> Précédent</strong>,
          <strong className="text-gray-200"> Écran noir/blanc</strong> et
          <strong className="text-gray-200"> Masquer</strong>.
        </p>
      )}

      <div className="flex gap-3 rounded-lg border border-white/5 bg-[#232428] p-4">
        <Bluetooth size={16} className="mt-0.5 shrink-0 text-[#8891f2]" />
        <div className="space-y-1.5 text-[11px] leading-relaxed text-gray-400">
          <p className="font-bold text-gray-200">Télécommande Bluetooth (clicker)</p>
          <p>
            Les petites télécommandes de présentation, Bluetooth ou USB, fonctionnent
            <strong className="text-gray-200"> sans rien activer ici</strong> : appairez-la au système,
            elle se comporte comme un clavier. L'application reconnaît
            <code className="mx-1 rounded bg-black/40 px-1">Page suiv./préc.</code>,
            les flèches, <code className="mx-1 rounded bg-black/40 px-1">.</code> pour l'écran noir
            et <code className="mx-1 rounded bg-black/40 px-1">Échap</code> pour reprendre.
          </p>
          <p>
            Un téléphone, lui, ne peut pas piloter l'application en Bluetooth sans installer une
            application dédiée : c'est pourquoi il passe par le Wi-Fi ci-dessus.
          </p>
        </div>
      </div>

      <div className="flex gap-3 rounded-lg border border-white/5 bg-[#232428] p-4">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[#8891f2]" />
        <div className="space-y-1.5 text-[11px] leading-relaxed text-gray-400">
          <p className="font-bold text-gray-200">Ce que ça ouvre exactement</p>
          <p>
            Un serveur distinct sur le port {status.port}, qui n'expose que la page de commande et
            six actions. Le serveur qui sert tes fichiers (fonds, médias, bases) reste, lui,
            strictement sur <code className="rounded bg-black/40 px-1">127.0.0.1</code> et n'est
            jamais accessible depuis le réseau.
          </p>
          <p>
            Toute commande sans le bon code est refusée. Coupe la télécommande après le culte :
            sur un réseau public, n'importe qui connaissant le code pourrait agir sur l'écran.
          </p>
        </div>
      </div>
    </div>
  );
}
