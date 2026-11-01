import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Cpu, Gauge, MonitorPlay, RotateCcw, Zap } from "lucide-react";

type RenderMode = "auto" | "compat" | "software";

interface RenderDiagnostic {
  mode: RenderMode;
  /** Mode depuis lequel l'application a dû redescendre toute seule. */
  downgraded_from: RenderMode | null;
  cores: number;
  gpu_device: boolean;
  hw_decoders: string[];
  compositing_disabled: boolean;
  dmabuf_disabled: boolean;
  feature_rank: string | null;
}

const MODES: { id: RenderMode; label: string; hint: string; icon: any }[] = [
  {
    id: "auto",
    label: "Accélérée",
    hint: "Carte graphique et décodage matériel. À utiliser par défaut.",
    icon: Zap,
  },
  {
    id: "compat",
    label: "Compatibilité",
    hint: "Garde l'accélération mais évite le chemin DMA-BUF, qui échoue sur certains pilotes.",
    icon: Gauge,
  },
  {
    id: "software",
    label: "Logicielle",
    hint: "Tout par le processeur. Dernier recours si la fenêtre reste noire ou verte.",
    icon: Cpu,
  },
];

/**
 * Choix du chemin de rendu vidéo.
 *
 * Ce réglage existe parce que l'application imposait jusqu'ici le rendu
 * logiciel à TOUTES les machines, pour corriger une fenêtre noire ou verte sur
 * certaines d'entre elles. Le prix réel n'avait pas été mesuré : sur un petit
 * processeur, chaque image de vidéo est alors calculée par le processeur, la
 * projection saccade et l'audio hache avec elle.
 *
 * Le compromis appartient à l'opérateur, pas au code : il voit ici ce dont sa
 * machine est capable et choisit. Le mode ne s'applique qu'au redémarrage —
 * WebKitGTK et GStreamer lisent ces réglages une seule fois.
 */
export function RenderModeCard() {
  const [diag, setDiag] = useState<RenderDiagnostic | null>(null);
  const [pending, setPending] = useState<RenderMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDiag(await invoke<RenderDiagnostic>("render_diagnostic"));
    } catch (e) {
      setError(String(e));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const choose = async (mode: RenderMode) => {
    setError(null);
    try {
      await invoke("set_render_mode", { mode });
      setPending(mode);
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const restart = async () => {
    try {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      setError(`Redémarrage impossible : ${e}. Ferme puis relance l'application.`);
    }
  };

  if (!diag) {
    return (
      <div className="rounded-lg border border-white/5 bg-[#232428] p-4">
        <p className="text-[11px] text-gray-500">Lecture du chemin de rendu…</p>
      </div>
    );
  }

  const hw = diag.hw_decoders.length > 0;
  // Le symptôme à l'origine du réglage : tout en logiciel sur peu de coeurs.
  const starved = diag.compositing_disabled && diag.cores <= 2;

  return (
    <div className="overflow-hidden rounded-lg border border-white/5 bg-[#232428]">
      <div className="flex items-center gap-2.5 border-b border-white/5 px-4 py-3">
        <MonitorPlay size={15} className="text-[#8891f2]" />
        <div className="min-w-0">
          <p className="text-xs font-bold text-gray-100">Rendu des vidéos</p>
          <p className="text-[11px] text-gray-500">
            {diag.cores} cœur{diag.cores > 1 ? "s" : ""} ·{" "}
            {diag.gpu_device ? "carte graphique détectée" : "aucune carte graphique détectée"} ·{" "}
            {hw ? `décodage matériel disponible (${diag.hw_decoders.join(", ")})` : "décodage matériel absent"}
          </p>
        </div>
      </div>

      <div className="space-y-2 p-4">
        {/* Un repli automatique ne doit JAMAIS être silencieux : l'opérateur
            perdrait la fluidité sans savoir pourquoi, et une fausse alerte
            (application fermée dans la seconde) resterait en place. */}
        {diag.downgraded_from && (
          <div className="rounded border border-amber-500/30 bg-amber-500/[0.09] p-2.5">
            <p className="text-[11px] leading-relaxed text-amber-200">
              Le démarrage précédent en mode «{" "}
              {MODES.find((m) => m.id === diag.downgraded_from)?.label ?? diag.downgraded_from}{" "}
              » n'a rien affiché : l'application est redescendue toute seule sur «{" "}
              {MODES.find((m) => m.id === diag.mode)?.label ?? diag.mode} ».
            </p>
            <button
              onClick={() => choose(diag.downgraded_from as RenderMode)}
              className="mt-2 rounded border border-amber-500/40 px-2.5 py-1 text-[10px] font-bold text-amber-300 transition hover:bg-amber-500/20"
            >
              C'était une fausse alerte — réessayer en{" "}
              {MODES.find((m) => m.id === diag.downgraded_from)?.label ?? diag.downgraded_from}
            </button>
          </div>
        )}

        {starved && (
          <p className="rounded border border-amber-500/25 bg-amber-500/[0.07] p-2.5 text-[11px] leading-relaxed text-amber-300">
            Cette session tourne en rendu logiciel sur {diag.cores} cœurs : c'est la cause la plus
            fréquente d'une vidéo saccadée et d'un son haché.
            {hw && " Cette machine sait pourtant décoder en matériel."}
          </p>
        )}

        <div className="grid gap-2 sm:grid-cols-3">
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = diag.mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => choose(m.id)}
                className={`flex flex-col gap-1.5 rounded-lg border p-3 text-left transition ${
                  active
                    ? "border-[#5865f2] bg-[#5865f2]/10"
                    : "border-white/10 hover:border-white/25 hover:bg-white/[0.03]"
                }`}
              >
                <span className={`flex items-center gap-1.5 text-[11px] font-bold ${active ? "text-white" : "text-gray-300"}`}>
                  <Icon size={13} className={active ? "text-[#8891f2]" : "text-gray-500"} />
                  {m.label}
                </span>
                <span className="text-[10px] leading-relaxed text-gray-500">{m.hint}</span>
              </button>
            );
          })}
        </div>

        {pending && (
          <div className="flex flex-wrap items-center gap-3 rounded border border-[#5865f2]/30 bg-[#5865f2]/[0.07] p-2.5">
            <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-gray-200">
              Mode enregistré. Il s'appliquera au prochain démarrage — jamais en plein culte.
            </p>
            <button
              onClick={restart}
              className="flex shrink-0 items-center gap-1.5 rounded bg-[#5865f2] px-3 py-1.5 text-[10px] font-bold text-white transition hover:bg-[#4752c4]"
            >
              <RotateCcw size={12} /> Redémarrer maintenant
            </button>
          </div>
        )}

        {error && (
          <p className="rounded border border-red-500/20 bg-red-500/10 p-2.5 text-[11px] text-red-400">{error}</p>
        )}

        <p className="text-[10px] leading-relaxed text-gray-600">
          Session en cours : compositing {diag.compositing_disabled ? "désactivé" : "actif"}, DMA-BUF{" "}
          {diag.dmabuf_disabled ? "désactivé" : "actif"}
          {diag.feature_rank ? ", décodeurs matériels priorisés" : ""}. Une variable
          d'environnement posée à la main garde la priorité sur ce réglage.
        </p>
      </div>
    </div>
  );
}
