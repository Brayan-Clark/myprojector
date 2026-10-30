import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { fontStack } from "../lib/fonts";
import { DEFAULT_STAGE, formatElapsed, withStageDefaults, type StageSettings } from "../lib/stage";

type StagePayload = {
  title: string;
  current: string[];
  next: string;
  slide: number;
  slides: number;
  settings: Partial<StageSettings>;
  fontFamily?: string;
  /** Horodatage de départ du chronomètre, ou null s'il est arrêté. */
  timerStart: number | null;
};

const EMPTY: StagePayload = {
  title: "",
  current: [],
  next: "",
  slide: 0,
  slides: 0,
  settings: DEFAULT_STAGE,
  timerStart: null,
};

/**
 * Écran retour, pour l'estrade.
 *
 * Volontairement SOBRE et à fort contraste : il est vu de près, de biais, par
 * quelqu'un qui joue ou qui prêche. Pas de fond d'écran, pas d'effet — un fond
 * noir, du texte blanc, et ce qui arrive ensuite en gris.
 *
 * Il ne reçoit QUE des évènements : aucune base de données, aucun média. Une
 * fenêtre de retour ne doit jamais être ce qui ralentit la projection.
 */
export function StageView() {
  const [data, setData] = useState<StagePayload>(() => {
    try {
      const saved = localStorage.getItem("stage_payload");
      return saved ? { ...EMPTY, ...JSON.parse(saved) } : EMPTY;
    } catch {
      return EMPTY;
    }
  });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const un = listen<StagePayload>("update_stage", (e) => setData({ ...EMPTY, ...e.payload }));
    // On signale notre présence : la fenêtre de contrôle renvoie alors l'état
    // courant, sinon l'écran resterait vide jusqu'au prochain changement.
    import("@tauri-apps/api/event").then(({ emit }) => emit("stage_ready"));
    return () => { un.then((f) => f()); };
  }, []);

  const s = withStageDefaults(data.settings);

  // Une seconde suffit : l'horloge et le chronomètre n'affichent pas les
  // dixièmes, et un rafraîchissement plus rapide ne ferait que consommer.
  useEffect(() => {
    if (!s.showClock && !s.showTimer) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [s.showClock, s.showTimer]);

  const clock = new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex h-screen w-screen select-none flex-col bg-black text-white">
      {/* Bandeau : d'où l'on parle, et où l'on en est. */}
      <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-5 py-2">
        <span className="truncate text-[13px] font-bold uppercase tracking-wider text-[#8891f2]">
          {data.title || "En attente"}
        </span>
        {data.slides > 1 && (
          <span className="shrink-0 font-mono text-[13px] tabular-nums text-gray-500">
            {data.slide + 1} / {data.slides}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-4">
          {s.showTimer && (
            <span
              className="font-mono text-[22px] font-bold tabular-nums text-amber-400"
              title="Temps écoulé"
            >
              {data.timerStart ? formatElapsed(now - data.timerStart) : "0:00"}
            </span>
          )}
          {s.showClock && (
            <span className="font-mono text-[22px] font-bold tabular-nums text-white">{clock}</span>
          )}
        </div>
      </div>

      {s.showCurrent && (
        <div className="flex min-h-0 flex-1 items-center justify-center px-8 py-4">
          <div
            className="w-full text-center font-bold leading-tight"
            style={{ fontFamily: fontStack(data.fontFamily), fontSize: `${(s.fontSize / 100) * 5}vh` }}
          >
            {data.current.length > 0
              ? data.current.map((line, i) => <p key={i}>{line}</p>)
              : <p className="text-gray-700">—</p>}
          </div>
        </div>
      )}

      {s.showNext && (
        /* Le « suivant » est gris et plus petit : il doit se lire d'un coup
           d'œil sans jamais être confondu avec ce qui est projeté. */
        <div className="shrink-0 border-t border-white/10 bg-white/[0.03] px-8 py-3">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-widest text-gray-600">
            Ensuite
          </div>
          <p
            className="line-clamp-3 text-center text-gray-400"
            style={{ fontFamily: fontStack(data.fontFamily), fontSize: `${(s.fontSize / 100) * 2.6}vh` }}
          >
            {data.next || "— fin —"}
          </p>
        </div>
      )}
    </div>
  );
}
