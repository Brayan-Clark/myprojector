import { useEffect, type ReactNode } from "react";
import { useFlipAlign } from "../../lib/popover";

/**
 * Briques de la barre d'outils.
 *
 * Avant, chaque contrôle portait ses propres classes : on croisait du texte en
 * 9, 10 et 12 px, des boutons de quatre hauteurs différentes et trois nuances
 * de gris pour la même chose. Les primitives ci-dessous fixent une seule
 * échelle, pour que la barre se lise d'un coup d'œil pendant un culte.
 *
 * Échelle retenue :
 *   - étiquette de groupe : 10 px, majuscules, gris moyen
 *   - texte de contrôle   : 11 px
 *   - hauteur de contrôle : 26 px (CONTROL_H)
 */

export const CONTROL_H = "h-[26px]";

/** Groupe étiqueté : « quoi est à côté de quoi » devient explicite. */
export function Group({
  label,
  children,
  grow = false,
  className = "",
}: {
  label: string;
  children: ReactNode;
  grow?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${grow ? "flex-1" : ""} ${className}`}>
      <span className="truncate text-[10px] font-bold uppercase tracking-wider text-gray-500">
        {label}
      </span>
      <div className="flex items-center gap-1 rounded-md bg-[#1e1f22] p-1">{children}</div>
    </div>
  );
}

/** Séparateur entre deux groupes. */
export function Divider() {
  return <div className="mx-1 hidden h-9 w-px shrink-0 self-end bg-[#1e1f22] sm:block" />;
}

/** Séparateur à l'intérieur d'un groupe. */
export function MiniDivider() {
  return <div className="mx-0.5 h-4 w-px shrink-0 bg-[#3f4147]" />;
}

export function IconBtn({
  active = false,
  danger = false,
  title,
  onClick,
  disabled = false,
  children,
}: {
  active?: boolean;
  danger?: boolean;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex ${CONTROL_H} w-[26px] shrink-0 items-center justify-center rounded transition disabled:opacity-40 ${
        active
          ? "bg-[#5865f2] text-white shadow-sm"
          : danger
            ? "text-gray-400 hover:bg-red-500/20 hover:text-red-400"
            : "text-gray-300 hover:bg-[#3f4147] hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

/** Bouton avec libellé, pour les actions qu'on doit trouver sans hésiter. */
export function TextBtn({
  active = false,
  title,
  onClick,
  icon,
  children,
  tone = "neutral",
  disabled = false,
}: {
  active?: boolean;
  title: string;
  onClick?: () => void;
  icon?: ReactNode;
  children: ReactNode;
  tone?: "neutral" | "accent" | "live" | "warn";
  disabled?: boolean;
}) {
  const tones: Record<string, string> = {
    neutral: active
      ? "bg-[#5865f2] text-white"
      : "text-gray-300 hover:bg-[#3f4147] hover:text-white",
    accent: "bg-[#5865f2] text-white hover:bg-[#4752c4]",
    live: "bg-red-600 text-white hover:bg-red-500",
    warn: active
      ? "bg-orange-500/20 text-orange-300 ring-1 ring-orange-500/50"
      : "text-gray-300 hover:bg-[#3f4147] hover:text-white",
  };
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`flex ${CONTROL_H} shrink-0 items-center gap-1.5 rounded px-2.5 text-[11px] font-bold transition disabled:opacity-40 ${tones[tone]}`}
    >
      {icon}
      {children}
    </button>
  );
}

/** Bascule à plusieurs positions (alignement, mode…). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; title: string; icon?: ReactNode; label?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex shrink-0 overflow-hidden rounded border border-[#36393f] bg-[#2b2d31]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-label={o.title}
          onClick={() => onChange(o.value)}
          className={`flex ${CONTROL_H} items-center justify-center gap-1 px-1.5 text-[11px] font-bold transition ${
            value === o.value ? "bg-[#5865f2] text-white" : "text-gray-400 hover:bg-[#3f4147]"
          }`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Curseur étiqueté, avec sa valeur toujours lisible. */
export function Slider({
  label,
  icon,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  title,
}: {
  label?: string;
  icon?: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  title?: string;
}) {
  return (
    <label className="flex min-w-0 flex-1 items-center gap-1.5" title={title ?? label}>
      {icon}
      {label && <span className="shrink-0 text-[10px] text-gray-400">{label}</span>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1 min-w-0 flex-1 accent-[#5865f2]"
      />
      <span className="w-9 shrink-0 text-right text-[10px] font-mono tabular-nums text-gray-400">
        {format ? format(value) : value}
      </span>
    </label>
  );
}

/** Sélecteur de couleur, avec la pastille comme zone de clic. */
export function ColorField({
  value,
  onChange,
  label,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  title?: string;
}) {
  return (
    <label
      className={`flex ${CONTROL_H} shrink-0 cursor-pointer items-center gap-1.5 rounded px-1 hover:bg-[#3f4147]`}
      title={title ?? label}
    >
      {label && <span className="text-[10px] text-gray-400">{label}</span>}
      <span
        className="h-4 w-4 rounded border border-white/30 shadow-inner"
        style={{ backgroundColor: value }}
      />
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-0 w-0 opacity-0"
      />
    </label>
  );
}

/**
 * Panneau déroulant.
 *
 * Il se ferme au clic extérieur et à Échap : les anciens menus restaient
 * ouverts par-dessus l'aperçu de projection jusqu'à ce qu'on reclique
 * exactement sur leur bouton.
 */
export function Popover({
  open,
  onClose,
  title,
  width = 272,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  width?: number;
  children: ReactNode;
}) {
  // Le côté d'ouverture n'est pas un choix de l'appelant mais une contrainte
  // de place : un panneau du dernier groupe sortait de l'écran.
  const [ref, align] = useFlipAlign(open);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.parentElement?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      style={{ width }}
      className={`absolute top-full z-[150] mt-2 max-h-[70vh] overflow-y-auto custom-scrollbar rounded-lg border border-[#1e1f22] bg-[#2b2d31] p-3 shadow-2xl ${
        align === "right" ? "right-0" : "left-0"
      }`}
    >
      <div className="mb-2.5 text-[10px] font-black uppercase tracking-widest text-[#8891f2]">
        {title}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

/** Ligne « étiquette · contrôle » d'un panneau. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-gray-300">{label}</span>
      {children}
    </div>
  );
}

/** Interrupteur. `<input type=checkbox>` nu était presque invisible sur fond sombre. */
export function Switch({
  checked,
  onChange,
  title,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      onClick={() => onChange(!checked)}
      className={`relative h-[18px] w-8 shrink-0 rounded-full transition ${
        checked ? "bg-[#5865f2]" : "bg-[#4f545c]"
      }`}
    >
      <span
        className={`absolute top-0.5 h-[14px] w-[14px] rounded-full bg-white transition-all ${
          checked ? "left-[16px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

/** Liste déroulante classique, à l'apparence du reste de la barre. */
export function Select({
  value,
  onChange,
  children,
  className = "",
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <select
      value={value}
      title={title}
      onChange={(e) => onChange(e.target.value)}
      className={`${CONTROL_H} min-w-0 cursor-pointer appearance-none rounded border border-[#36393f] bg-[#1e1f22] pl-2 pr-6 text-[11px] text-gray-100 outline-none transition hover:border-[#5865f2] ${className}`}
      style={{
        backgroundImage: `url('data:image/svg+xml;utf8,<svg fill="none" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z" fill="%239CA3AF"/></svg>')`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 2px center",
        backgroundSize: "14px",
      }}
    >
      {children}
    </select>
  );
}

/** Choix rapide parmi des réglages prêts à l'emploi. */
export function PresetRow({
  presets,
  onPick,
}: {
  presets: { label: string; hint: string }[];
  onPick: (index: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {presets.map((p, i) => (
        <button
          key={p.label}
          type="button"
          title={p.hint}
          onClick={() => onPick(i)}
          className="rounded border border-[#36393f] px-2 py-1 text-[10px] font-bold text-gray-300 transition hover:border-[#5865f2] hover:bg-[#5865f2]/20 hover:text-white"
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
