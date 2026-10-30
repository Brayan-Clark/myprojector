import { Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import { cleanUrl } from "../../lib/media";
import {
  BG_PRESETS, isBgFiltersDefault, withBgDefaults, bgMediaStyle, veilStyle,
  type BgFilters,
} from "../../lib/bgStyle";
import { ColorField, Popover, PresetRow, Row, Slider } from "./ui";

const isVideoUrl = (url: string) => /\.(mp4|webm|ogg|mov|mkv|avi|m4v)(\?.*)?$/i.test(url);

/** Bibliothèque de fonds, images ou vidéos. */
export function MediaLibraryMenu({
  kind,
  open,
  onClose,
  items,
  current,
  onPick,
  onImport,
  onDelete,
}: {
  kind: "image" | "video";
  open: boolean;
  onClose: () => void;
  /** Chemins absolus des fonds importés. */
  items: string[];
  current?: string;
  onPick: (path: string) => void;
  onImport: () => void;
  onDelete: (e: React.MouseEvent, path: string) => void;
}) {
  const filtered = items.filter((p) => (kind === "video" ? isVideoUrl(p) : !isVideoUrl(p)));

  return (
    <Popover
      open={open}
      onClose={onClose}
      width={300}
      title={kind === "image" ? "Images de fond" : "Vidéos de fond"}
    >
      <button
        type="button"
        onClick={onImport}
        className="flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-[#4f545c] py-2 text-[11px] font-bold text-gray-300 transition hover:border-[#5865f2] hover:text-white"
      >
        <Plus size={13} /> Importer {kind === "image" ? "une image" : "une vidéo"}
      </button>

      {filtered.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-gray-500">
          Aucun fond {kind === "image" ? "image" : "vidéo"} pour l'instant. Les fichiers importés
          sont copiés dans le dossier de l'application : ils restent disponibles hors ligne.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {filtered.map((path) => (
            <div
              key={path}
              onClick={() => onPick(path)}
              title={path.split(/[/\\]/).pop()}
              className={`group relative aspect-video cursor-pointer overflow-hidden rounded border bg-black transition ${
                current === path ? "border-[#5865f2] ring-1 ring-[#5865f2]" : "border-transparent hover:border-[#5865f2]"
              }`}
            >
              {kind === "video" ? (
                <>
                  <video src={cleanUrl(path)} className="h-full w-full object-cover" muted />
                  <div className="absolute inset-0 flex items-center justify-center text-white/40">
                    <Play size={18} />
                  </div>
                </>
              ) : (
                <img src={cleanUrl(path)} className="h-full w-full object-cover" alt="" />
              )}
              <button
                type="button"
                onClick={(e) => onDelete(e, path)}
                title="Supprimer ce fond du disque"
                className="absolute right-1 top-1 rounded bg-red-600/80 p-1 text-white opacity-0 transition group-hover:opacity-100 hover:bg-red-600"
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Popover>
  );
}

/**
 * Traitement du fond : assombrir, éclaircir, flouter, voiler.
 *
 * L'aperçu en haut du panneau est volontairement une vignette du VRAI fond :
 * régler une luminosité sur un curseur sans rien voir revenait à tâtonner.
 */
export function BgFiltersMenu({
  open,
  onClose,
  filters,
  setFilters,
  bgImage,
}: {
  open: boolean;
  onClose: () => void;
  filters?: Partial<BgFilters> | null;
  setFilters: (next: BgFilters) => void;
  bgImage?: string;
}) {
  const f = withBgDefaults(filters);
  const set = (patch: Partial<BgFilters>) => setFilters({ ...f, ...patch });
  const url = cleanUrl(bgImage);

  return (
    <Popover open={open} onClose={onClose} width={296} title="Réglages du fond">
      {url && (
        <div className="relative aspect-video overflow-hidden rounded border border-[#1e1f22] bg-black">
          {bgImage && isVideoUrl(bgImage) ? (
            // Vignette figée : une seconde lecture de la vidéo pour un aperçu de
            // 2 cm coûterait un décodage complet (voir « aperçu allégé »).
            <video src={url} className="h-full w-full object-cover" style={bgMediaStyle(f)} muted />
          ) : (
            <img src={url} className="h-full w-full object-cover" style={bgMediaStyle(f)} alt="" />
          )}
          {veilStyle(f) && <div className="absolute inset-0" style={veilStyle(f)!} />}
          <span
            className="absolute inset-0 flex items-center justify-center text-center text-[13px] font-bold"
            style={{ color: "#fff", textShadow: "0 2px 6px rgba(0,0,0,.85)" }}
          >
            Texte projeté
          </span>
        </div>
      )}

      <div>
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">
          Réglages rapides
        </div>
        <PresetRow presets={BG_PRESETS} onPick={(i) => setFilters({ ...BG_PRESETS[i].value })} />
      </div>

      <div className="space-y-2 border-t border-[#1e1f22] pt-2.5">
        <Slider
          label="Luminosité"
          value={f.brightness}
          min={20}
          max={180}
          onChange={(v) => set({ brightness: v })}
          format={(v) => `${v}%`}
          title="Moins de 100 % assombrit le fond, plus de 100 % l'éclaircit"
        />
        <Slider
          label="Contraste"
          value={f.contrast}
          min={50}
          max={180}
          onChange={(v) => set({ contrast: v })}
          format={(v) => `${v}%`}
        />
        <Slider
          label="Couleurs"
          value={f.saturate}
          min={0}
          max={180}
          onChange={(v) => set({ saturate: v })}
          format={(v) => `${v}%`}
          title="0 % = noir et blanc"
        />
        <Slider
          label="Flou"
          value={f.blur}
          min={0}
          max={60}
          onChange={(v) => set({ blur: v })}
          format={(v) => (v === 0 ? "—" : String(v))}
          title="Met un fond chargé en retrait pour détacher le texte"
        />
        <Slider
          label="Voile"
          value={f.veil}
          min={0}
          max={90}
          onChange={(v) => set({ veil: v })}
          format={(v) => (v === 0 ? "—" : `${v}%`)}
          title="Couche unie posée sur le fond, sous le texte"
        />
        {f.veil > 0 && (
          <Row label="Couleur du voile">
            <ColorField value={f.veilColor} onChange={(v) => set({ veilColor: v })} />
          </Row>
        )}
      </div>

      <button
        type="button"
        onClick={() => setFilters(withBgDefaults(null))}
        disabled={isBgFiltersDefault(f)}
        className="flex w-full items-center justify-center gap-1.5 rounded border border-[#36393f] py-1.5 text-[11px] font-bold text-gray-300 transition hover:border-[#5865f2] hover:text-white disabled:opacity-40"
      >
        <RotateCcw size={12} /> Fond d'origine
      </button>
    </Popover>
  );
}
