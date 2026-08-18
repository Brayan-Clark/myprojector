import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Check, Copy, RefreshCw, XCircle } from "lucide-react";
import { ErrorBox, Spinner } from "./ui";

interface DiagCheck {
  id: string; label: string;
  level: "ok" | "warn" | "error";
  detail: string; fix: string | null;
}

const STYLES = {
  ok:    { icon: Check,          color: "text-emerald-400", ring: "border-emerald-500/25", bg: "bg-emerald-500/[0.06]" },
  warn:  { icon: AlertTriangle,  color: "text-amber-400",   ring: "border-amber-500/25",   bg: "bg-amber-500/[0.06]" },
  error: { icon: XCircle,        color: "text-red-400",     ring: "border-red-500/25",     bg: "bg-red-500/[0.06]" },
};

/**
 * Vérifie l'environnement de la machine.
 *
 * Répond aux pannes réellement rencontrées lors des installations : codecs
 * absents (vidéo figée), serveur média injoignable (fonds et PDF vides),
 * second écran manquant, contenus non installés.
 */
export function DiagnosticSection() {
  const [checks, setChecks] = useState<DiagCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setChecks(null);
    try {
      setChecks(await invoke<DiagCheck[]>("run_diagnostics"));
    } catch (e: any) {
      setError(String(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  };

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!checks) return <Spinner label="Vérification de la machine" />;

  const problems = checks.filter((c) => c.level !== "ok").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div>
          <h3 className="text-sm font-bold text-white">
            {problems === 0 ? "Tout est en ordre" : `${problems} point${problems > 1 ? "s" : ""} à vérifier`}
          </h3>
          <p className="text-[11px] text-gray-500">État de cette machine pour la projection</p>
        </div>
        <button
          onClick={load}
          title="Relancer les vérifications"
          className="ml-auto rounded-full p-2 text-gray-400 transition hover:bg-white/10 hover:text-white"
        >
          <RefreshCw size={15} />
        </button>
      </div>

      <div className="space-y-2">
        {checks.map((c) => {
          const st = STYLES[c.level] ?? STYLES.warn;
          const Icon = st.icon;
          return (
            <div key={c.id} className={`flex gap-3 rounded-lg border ${st.ring} ${st.bg} p-3`}>
              <Icon size={16} className={`mt-0.5 shrink-0 ${st.color}`} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-gray-100">{c.label}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-gray-400">{c.detail}</p>
                {c.fix && (
                  <div className="mt-2 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-black/40 px-2 py-1 font-mono text-[10px] text-gray-300">
                      {c.fix}
                    </code>
                    <button
                      onClick={() => copy(c.fix!)}
                      title="Copier"
                      className="shrink-0 rounded p-1.5 text-gray-500 transition hover:bg-white/10 hover:text-white"
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                )}
                {copied === c.fix && <p className="mt-1 text-[10px] text-emerald-400">Copié</p>}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] leading-relaxed text-gray-500">
        À lancer après chaque installation sur un nouveau poste : la plupart des problèmes de
        projection viennent de l'environnement, pas de l'application.
      </p>
    </div>
  );
}
