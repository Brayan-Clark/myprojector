import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { FontPicker } from "../FontPicker";
import {
  COMFORTABLE_VERSIONS, versionLabel, withParallelDefaults, type ParallelSettings,
} from "../../lib/parallel";
import { HEADER_PRESETS, withHeaderDefaults, type HeaderSettings } from "../../lib/header";
import { TRANSITIONS, withTransitionDefaults, type TransitionSettings } from "../../lib/transitions";
import { withSplitDefaults, type SplitOptions } from "../../lib/slides";
import { announcementSlides, withAnnouncementDefaults, type Announcements } from "../../lib/announcements";
import { withStageDefaults, type StageSettings } from "../../lib/stage";
import { ColorField, Popover, PresetRow, Row, Select, Slider, Switch } from "./ui";

/**
 * Transition jouée quand la diapo change.
 *
 * Réglable par portée, comme le reste de l'apparence : on peut vouloir un
 * fondu discret entre deux strophes d'un cantique et une coupe nette entre
 * deux versets, ou l'inverse. C'est le réglage de la diapo qui ARRIVE qui
 * s'applique.
 */
export function TransitionMenu({
  open, onClose, transition, setTransition, scopeLabel,
}: {
  open: boolean;
  onClose: () => void;
  transition: any;
  setTransition: (next: TransitionSettings) => void;
  scopeLabel?: string;
}) {
  const t = withTransitionDefaults(transition);
  const set = (patch: Partial<TransitionSettings>) => setTransition({ ...t, ...patch });

  return (
    <Popover open={open} onClose={onClose} title="Transition entre diapos" width={288}>
      {scopeLabel && (
        <p className="rounded border border-[#5865f2]/30 bg-[#5865f2]/10 px-2 py-1.5 text-[10px] leading-relaxed text-gray-300">
          S'applique à <span className="font-bold text-[#8891f2]">{scopeLabel}</span>.
        </p>
      )}

      <div className="grid grid-cols-2 gap-1">
        {TRANSITIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            title={opt.hint}
            onClick={() => set({ type: opt.value })}
            className={`rounded border px-2 py-1.5 text-left text-[10px] font-bold transition ${
              t.type === opt.value
                ? "border-[#5865f2] bg-[#5865f2]/20 text-white"
                : "border-[#36393f] text-gray-300 hover:border-[#5865f2]"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {t.type !== "none" && (
        <Slider
          label="Durée"
          value={t.duration}
          min={80}
          max={900}
          step={20}
          onChange={(v) => set({ duration: v })}
          format={(v) => `${v} ms`}
          title="Au-delà d'une demi-seconde, l'opérateur attend l'affichage à chaque diapo"
        />
      )}

      <p className="text-[10px] leading-relaxed text-gray-500">
        L'arrière-plan n'est jamais animé : une vidéo de fond continue de tourner
        sans redémarrer d'une diapo à l'autre.
      </p>
    </Popover>
  );
}

/**
 * Versions bibliques affichées en plus de la version chargée.
 *
 * Les versions sont alignées sur le numéro de livre MyBible, pas sur son nom :
 * « Jaona », « Jean » et « John » désignent le même livre, et le rang se
 * décale dès qu'un module contient les deutérocanoniques.
 */
export function ParallelMenu({
  open, onClose, parallel, setParallel, currentVersion, scopeLabel,
}: {
  open: boolean;
  onClose: () => void;
  parallel: any;
  setParallel: (next: ParallelSettings) => void;
  /** Version principale : on ne se la propose pas à soi-même. */
  currentVersion?: string;
  scopeLabel?: string;
}) {
  const p = withParallelDefaults(parallel);
  const set = (patch: Partial<ParallelSettings>) => setParallel({ ...p, ...patch });
  const [available, setAvailable] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    invoke<string[]>("list_dbs", { category: "bible" })
      .then(setAvailable)
      .catch(() => setAvailable([]));
  }, [open]);

  const toggle = (file: string) => {
    set({
      versions: p.versions.includes(file)
        ? p.versions.filter((v) => v !== file)
        : [...p.versions, file],
    });
  };

  const others = available.filter((f) => f !== currentVersion);

  return (
    <Popover open={open} onClose={onClose} title="Versions affichées" width={300}>
      {scopeLabel && (
        <p className="rounded border border-[#5865f2]/30 bg-[#5865f2]/10 px-2 py-1.5 text-[10px] leading-relaxed text-gray-300">
          S'applique à <span className="font-bold text-[#8891f2]">{scopeLabel}</span>.
        </p>
      )}

      <p className="text-[11px] leading-relaxed text-gray-400">
        Le verset est projeté dans la version chargée, puis dans chaque version
        cochée ci-dessous.
      </p>

      {others.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-gray-500">
          Aucune autre version installée. Ajoutez-en depuis la Bibliothèque.
        </p>
      ) : (
        <div className="space-y-1">
          {others.map((file) => {
            const on = p.versions.includes(file);
            return (
              <button
                key={file}
                type="button"
                onClick={() => toggle(file)}
                className={`flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left transition ${
                  on ? "border-[#5865f2] bg-[#5865f2]/15" : "border-[#36393f] hover:border-[#5865f2]"
                }`}
              >
                <span
                  className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
                    on ? "border-[#5865f2] bg-[#5865f2] text-white" : "border-[#4f545c]"
                  }`}
                >
                  {on && <Check size={10} />}
                </span>
                <span className="truncate text-[11px] text-gray-200">{versionLabel(file)}</span>
              </button>
            );
          })}
        </div>
      )}

      {p.versions.length > 0 && (
        <>
          <Slider
            label="Taille"
            value={p.sizeFactor}
            min={30}
            max={100}
            onChange={(v) => set({ sizeFactor: v })}
            format={(v) => `${v}%`}
            title="Taille des versions secondaires, par rapport au texte principal"
          />
          <Row label="Afficher la référence de chaque version">
            <Switch checked={p.showBookName} onChange={(v) => set({ showBookName: v })} />
          </Row>
        </>
      )}

      {p.versions.length > COMFORTABLE_VERSIONS && (
        /* On prévient, on n'interdit pas : c'est l'opérateur qui voit la salle. */
        <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-amber-300">
          {p.versions.length + 1} versions sur une même diapo : vérifiez dans l'aperçu que le
          texte reste lisible depuis le fond de la salle.
        </p>
      )}
    </Popover>
  );
}

/**
 * Découpage automatique des diapos trop longues.
 *
 * Volontairement désactivé par défaut : couper change la numérotation des
 * diapos, et un opérateur qui connaît son recueil ne doit pas voir sa strophe 3
 * devenir la 4 sans l'avoir demandé.
 */
export function SplitMenu({
  open, onClose, split, setSplit,
}: {
  open: boolean;
  onClose: () => void;
  split: any;
  setSplit: (next: SplitOptions) => void;
}) {
  const s = withSplitDefaults(split);
  const set = (patch: Partial<SplitOptions>) => setSplit({ ...s, ...patch });

  return (
    <Popover open={open} onClose={onClose} title="Découper les diapos trop longues" width={288}>
      <Row label="Découper automatiquement">
        <Switch checked={s.enabled} onChange={(v) => set({ enabled: v })} />
      </Row>

      <p className="text-[11px] leading-relaxed text-gray-400">
        Une strophe ou un verset trop long est projeté en deux écrans, coupés à
        la fin d'une phrase. Le texte enregistré n'est pas modifié.
      </p>

      {s.enabled && (
        <>
          <Slider
            label="Longueur"
            value={s.maxChars}
            min={80}
            max={700}
            step={10}
            onChange={(v) => set({ maxChars: v })}
            format={(v) => `${v}`}
            title="Nombre de caractères au-delà duquel une diapo est coupée"
          />
          <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-amber-300">
            Le découpage change la numérotation des diapos : une strophe peut
            compter pour deux écrans.
          </p>
        </>
      )}
    </Popover>
  );
}

/**
 * Annonces défilantes de l'écran d'accueil.
 *
 * Désactivées par défaut, et sans effet dès qu'un contenu est projeté : elles
 * occupent le temps d'installation de l'assemblée, rien de plus.
 */
export function AnnouncementsMenu({
  open, onClose, announcements, setAnnouncements,
}: {
  open: boolean;
  onClose: () => void;
  announcements: any;
  setAnnouncements: (next: Announcements) => void;
}) {
  const a = withAnnouncementDefaults(announcements);
  const set = (patch: Partial<Announcements>) => setAnnouncements({ ...a, ...patch });
  const count = announcementSlides(a).length;

  return (
    <Popover open={open} onClose={onClose} title="Annonces de l'écran d'accueil" width={320}>
      <Row label="Faire défiler les annonces">
        <Switch checked={a.enabled} onChange={(v) => set({ enabled: v })} />
      </Row>

      <textarea
        className="h-36 w-full resize-none rounded border border-[#36393f] bg-[#1e1f22] p-2 text-[11px] leading-relaxed text-gray-100 outline-none focus:border-[#5865f2] placeholder:text-gray-600"
        placeholder={"Répétition de la chorale\nSamedi 14 h\n\n---\n\nRéunion des jeunes\nDimanche après le culte"}
        value={a.text}
        onChange={(e) => set({ text: e.target.value })}
      />
      <p className="text-[10px] leading-relaxed text-gray-500">
        Séparez les annonces par une ligne <code className="rounded bg-[#1e1f22] px-1">---</code>,
        comme les diapos Markdown. {count > 0 && <strong className="text-gray-400">{count} annonce{count > 1 ? 's' : ''}.</strong>}
      </p>

      <Slider
        label="Durée"
        value={a.interval}
        min={3}
        max={60}
        onChange={(v) => set({ interval: v })}
        format={(v) => `${v} s`}
        title="Temps d'affichage de chaque annonce"
      />

      <p className="border-t border-[#1e1f22] pt-2.5 text-[10px] leading-relaxed text-gray-500">
        Les annonces n'apparaissent que sur l'écran d'accueil. Dès qu'un chant
        ou un verset est projeté, elles s'effacent — et reviennent ensuite.
        Elles suivent le style et la transition réglés pour « L'écran d'accueil ».
      </p>
    </Popover>
  );
}

/**
 * Écran retour, tourné vers l'estrade.
 *
 * Fermé par défaut : beaucoup d'églises n'ont pas de second écran de retour,
 * et ouvrir une troisième fenêtre sans qu'on l'ait demandé encombrerait le
 * poste de l'opérateur.
 */
export function StageMenu({
  open, onClose, stage, setStage, isStageActive, onToggle, timerStart, setTimerStart,
}: {
  open: boolean;
  onClose: () => void;
  stage: any;
  setStage: (next: StageSettings) => void;
  isStageActive: boolean;
  onToggle: () => void;
  timerStart: number | null;
  setTimerStart: (v: number | null) => void;
}) {
  const s = withStageDefaults(stage);
  const set = (patch: Partial<StageSettings>) => setStage({ ...s, ...patch });

  return (
    <Popover open={open} onClose={onClose} title="Écran retour (estrade)" width={300}>
      <p className="text-[11px] leading-relaxed text-gray-400">
        Une fenêtre à part, pour un écran tourné vers les musiciens : la strophe
        en cours, celle qui suit, l'heure. Placez-la sur l'écran de retour, le
        système retiendra sa position.
      </p>

      <button
        type="button"
        onClick={onToggle}
        className={`w-full rounded px-3 py-2 text-[11px] font-bold transition ${
          isStageActive
            ? "bg-red-600 text-white hover:bg-red-500"
            : "bg-[#5865f2] text-white hover:bg-[#4752c4]"
        }`}
      >
        {isStageActive ? "Fermer l'écran retour" : "Ouvrir l'écran retour"}
      </button>

      <div className="space-y-2 border-t border-[#1e1f22] pt-2.5">
        <Row label="Texte en cours">
          <Switch checked={s.showCurrent} onChange={(v) => set({ showCurrent: v })} />
        </Row>
        <Row label="Diapo suivante">
          <Switch checked={s.showNext} onChange={(v) => set({ showNext: v })} />
        </Row>
        <Row label="Horloge">
          <Switch checked={s.showClock} onChange={(v) => set({ showClock: v })} />
        </Row>
        <Row label="Chronomètre">
          <Switch checked={s.showTimer} onChange={(v) => set({ showTimer: v })} />
        </Row>
        <Slider
          label="Taille"
          value={s.fontSize}
          min={40}
          max={200}
          step={5}
          onChange={(v) => set({ fontSize: v })}
          format={(v) => `${v}%`}
        />
      </div>

      {s.showTimer && (
        <div className="flex items-center gap-2 border-t border-[#1e1f22] pt-2.5">
          <button
            type="button"
            // `Date.now()` est pris ICI et envoyé tel quel : la fenêtre retour
            // calcule l'écoulé elle-même, sans qu'on lui envoie une valeur
            // chaque seconde.
            onClick={() => setTimerStart(timerStart ? null : Date.now())}
            className="flex-1 rounded border border-[#36393f] py-1.5 text-[11px] font-bold text-gray-200 transition hover:border-[#5865f2]"
          >
            {timerStart ? "Arrêter le chronomètre" : "Démarrer le chronomètre"}
          </button>
          {timerStart && (
            <button
              type="button"
              onClick={() => setTimerStart(Date.now())}
              className="rounded border border-[#36393f] px-2 py-1.5 text-[11px] text-gray-300 transition hover:border-[#5865f2]"
              title="Repartir de zéro"
            >
              Relancer
            </button>
          )}
        </div>
      )}
    </Popover>
  );
}

/** Positions possibles pour l'horloge et pour l'entête. */
const CORNERS: { value: string; label: string }[] = [
  { value: "top-left", label: "Haut gauche" },
  { value: "top-center", label: "Haut centre" },
  { value: "top-right", label: "Haut droite" },
  { value: "bottom-left", label: "Bas gauche" },
  { value: "bottom-center", label: "Bas centre" },
  { value: "bottom-right", label: "Bas droite" },
];

export function ClockMenu({
  open, onClose, clock, setClock,
}: {
  open: boolean;
  onClose: () => void;
  clock: any;
  setClock: (next: any) => void;
}) {
  const set = (patch: any) => setClock({ ...clock, ...patch });

  return (
    <Popover open={open} onClose={onClose} title="Horloge (Alt+C)" width={272}>
      <Row label="Afficher l'horloge">
        <Switch checked={!!clock.enabled} onChange={(v) => set({ enabled: v })} />
      </Row>

      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          className={`rounded border py-1 text-[11px] font-bold transition ${clock.type === "digital" ? "border-[#5865f2] bg-[#5865f2] text-white" : "border-[#36393f] text-gray-300 hover:border-[#5865f2]"}`}
          onClick={() => set({ type: "digital", style: "modern" })}
        >
          Chiffres
        </button>
        <button
          type="button"
          className={`rounded border py-1 text-[11px] font-bold transition ${clock.type === "analog" ? "border-[#5865f2] bg-[#5865f2] text-white" : "border-[#36393f] text-gray-300 hover:border-[#5865f2]"}`}
          onClick={() => set({ type: "analog", style: "minimal" })}
        >
          Aiguilles
        </button>
      </div>

      <Row label="Style">
        <Select value={clock.style} onChange={(v) => set({ style: v })} className="w-[140px]">
          {clock.type === "digital" ? (
            <>
              <option value="modern">Moderne</option>
              <option value="classic">Classique</option>
              <option value="neon">Néon</option>
            </>
          ) : (
            <>
              <option value="minimal">Minimaliste</option>
              <option value="numbers">Avec chiffres</option>
              <option value="sport">Sport</option>
            </>
          )}
        </Select>
      </Row>

      <Row label="Position">
        <Select value={clock.position} onChange={(v) => set({ position: v })} className="w-[140px]">
          {CORNERS.filter((c) => !c.value.endsWith("center")).map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
          <option value="center">Centre de l'écran</option>
        </Select>
      </Row>

      <Slider label="Taille" value={clock.size ?? 60} min={20} max={300} onChange={(v) => set({ size: v })} format={(v) => `${v}`} />

      <Row label="Couleur">
        <ColorField value={clock.color || "#ffffff"} onChange={(v) => set({ color: v })} />
      </Row>
    </Popover>
  );
}

export function TickerMenu({
  open, onClose, ticker, setTicker,
}: {
  open: boolean;
  onClose: () => void;
  ticker: any;
  setTicker: (next: any) => void;
}) {
  const set = (patch: any) => setTicker({ ...ticker, ...patch });

  return (
    <Popover open={open} onClose={onClose} title="Message défilant (Alt+M)" width={296}>
      <Row label="Afficher le bandeau">
        <Switch checked={!!ticker.enabled} onChange={(v) => set({ enabled: v })} />
      </Row>

      <textarea
        className="h-16 w-full resize-none rounded border border-[#36393f] bg-[#1e1f22] p-2 text-[11px] text-gray-100 outline-none focus:border-[#5865f2]"
        placeholder="Votre message…"
        value={ticker.message || ""}
        onChange={(e) => set({ message: e.target.value })}
      />

      <Row label="Police">
        <div className="w-[150px]">
          <FontPicker
            compact
            value={ticker.fontFamily}
            sample={ticker.message}
            onChange={(name) => set({ fontFamily: name })}
          />
        </div>
      </Row>

      <Slider label="Taille" value={ticker.fontSize ?? 28} min={12} max={90} onChange={(v) => set({ fontSize: v })} />
      <Slider
        label="Fond"
        value={Math.round((ticker.bgOpacity ?? 0.7) * 100)}
        min={0}
        max={100}
        onChange={(v) => set({ bgOpacity: v / 100 })}
        format={(v) => `${v}%`}
        title="Opacité du bandeau derrière le texte"
      />

      <div className="flex items-center gap-3">
        <ColorField label="Texte" value={ticker.color || "#ffff00"} onChange={(v) => set({ color: v })} />
        <ColorField label="Fond" value={ticker.bgColor || "#000000"} onChange={(v) => set({ bgColor: v })} />
      </div>

      <Row label="Position">
        <Select value={ticker.position || "bottom"} onChange={(v) => set({ position: v })} className="w-[120px]">
          <option value="bottom">En bas</option>
          <option value="top">En haut</option>
        </Select>
      </Row>
    </Popover>
  );
}

/**
 * Entête de projection : la référence affichée par-dessus la diapo.
 * Tout était figé dans le code jusqu'ici — voir src/lib/header.ts.
 */
export function HeaderMenu({
  open, onClose, header, setHeader, scopeLabel,
}: {
  open: boolean;
  onClose: () => void;
  header: any;
  setHeader: (next: HeaderSettings) => void;
  /** Portée en cours, rappelée en haut du panneau. */
  scopeLabel?: string;
}) {
  const h = withHeaderDefaults(header);
  const set = (patch: Partial<HeaderSettings>) => setHeader({ ...h, ...patch });

  return (
    <Popover open={open} onClose={onClose} title="Entête de projection" width={296}>
      {scopeLabel && (
        /* Rappel explicite : ces réglages ne sont PAS globaux. C'est tout
           l'intérêt — une référence biblique et un titre de cantique n'ont
           pas besoin de la même place ni de la même taille. */
        <p className="rounded border border-[#5865f2]/30 bg-[#5865f2]/10 px-2 py-1.5 text-[10px] leading-relaxed text-gray-300">
          S'applique à <span className="font-bold text-[#8891f2]">{scopeLabel}</span>.
          Change la portée dans la barre pour régler autre chose.
        </p>
      )}
      <Row label="Afficher l'entête">
        <Switch checked={h.enabled} onChange={(v) => set({ enabled: v })} />
      </Row>

      <div>
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">
          Styles prêts à l'emploi
        </div>
        <PresetRow
          presets={HEADER_PRESETS}
          onPick={(i) => set(HEADER_PRESETS[i].value)}
        />
      </div>

      <div className="space-y-2.5 border-t border-[#1e1f22] pt-2.5">
        <Row label="Position">
          <Select value={h.position} onChange={(v) => set({ position: v as any })} className="w-[140px]">
            {CORNERS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </Select>
        </Row>

        <Row label="Contenu">
          <Select value={h.content} onChange={(v) => set({ content: v as any })} className="w-[140px]">
            <option value="ref">Référence seule</option>
            <option value="ref-version">Référence + version</option>
            <option value="full">N° + titre (chants)</option>
          </Select>
        </Row>

        <Row label="Police">
          <div className="w-[150px]">
            <FontPicker
              compact
              value={h.fontFamily}
              sample="Jean 3:16"
              onChange={(name) => set({ fontFamily: name })}
            />
          </div>
        </Row>

        <Slider
          label="Taille"
          value={h.size}
          min={10}
          max={90}
          onChange={(v) => set({ size: v })}
          format={(v) => `${(v / 10).toFixed(1)}%`}
          title="En pourcentage de la hauteur de l'écran : la taille reste juste sur tous les projecteurs"
        />

        <div className="flex items-center gap-3">
          <ColorField label="Texte" value={h.color} onChange={(v) => set({ color: v })} />
          <Row label="Gras">
            <Switch checked={h.isBold} onChange={(v) => set({ isBold: v })} />
          </Row>
        </div>

        <Slider
          label="Pastille"
          value={h.bgOpacity}
          min={0}
          max={100}
          onChange={(v) => set({ bgOpacity: v })}
          format={(v) => (v === 0 ? "—" : `${v}%`)}
          title="Fond semi-opaque derrière la référence, utile sur un fond clair"
        />
        {h.bgOpacity > 0 && (
          <Row label="Couleur de la pastille">
            <ColorField value={h.bgColor} onChange={(v) => set({ bgColor: v })} />
          </Row>
        )}
      </div>

      <p className="border-t border-[#1e1f22] pt-2.5 text-[10px] leading-relaxed text-gray-500">
        Entête masquée sur un texte biblique : le numéro du verset reste alors
        affiché dans la diapo, pour que l'assemblée puisse suivre.
      </p>
    </Popover>
  );
}
