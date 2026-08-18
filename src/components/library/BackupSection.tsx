import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Check, Download, FolderInput, Loader2, Save } from "lucide-react";
import { buildProfile, applyProfileSettings, findMissing, type MissingItem, type Profile } from "../../lib/profile";
import { downloadFile } from "../../lib/library";

/**
 * Transfert d'un poste à l'autre : réglages, agenda et liste des contenus.
 *
 * Le fichier ne contient volontairement ni médias ni bases (des centaines de
 * Mo) : les contenus sont re-téléchargés à la demande sur la nouvelle machine.
 */
export function BackupSection() {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ level: "ok" | "error"; text: string } | null>(null);
  const [missing, setMissing] = useState<MissingItem[] | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  const exportProfile = async () => {
    setBusy("export");
    setMessage(null);
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const stamp = new Date().toISOString().slice(0, 10);
      const path = await save({
        defaultPath: `myprojector-profil-${stamp}.json`,
        filters: [{ name: "Profil MyProjector", extensions: ["json"] }],
      });
      if (!path) return;
      const profile = await buildProfile();
      await invoke("save_playlist_file", { path, content: JSON.stringify(profile, null, 2) });
      setMessage({ level: "ok", text: `Profil enregistré : ${path}` });
    } catch (e) {
      setMessage({ level: "error", text: `Export impossible : ${e}` });
    } finally {
      setBusy(null);
    }
  };

  const importProfile = async () => {
    setBusy("import");
    setMessage(null);
    setMissing(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({
        multiple: false,
        filters: [{ name: "Profil MyProjector", extensions: ["json"] }],
      });
      if (!path || typeof path !== "string") return;

      const raw = await invoke<string>("read_playlist_file", { path });
      const profile: Profile = JSON.parse(raw);
      if (!profile?.settings) throw new Error("Fichier de profil invalide");

      const applied = applyProfileSettings(profile);
      const absent = await findMissing(profile);
      setMissing(absent);
      setMessage({
        level: "ok",
        text: `${applied} réglage(s) restauré(s). Redémarre l'application pour qu'ils prennent effet.`,
      });
    } catch (e) {
      setMessage({ level: "error", text: `Import impossible : ${e}` });
    } finally {
      setBusy(null);
    }
  };

  const restoreOne = async (item: MissingItem) => {
    if (!item.url) return;
    setRestoring(item.filename);
    try {
      if (item.kind === "hymnes" || item.kind === "bible") {
        await invoke("download_db", { url: item.url, category: item.kind, filename: item.filename });
      } else {
        await downloadFile({
          url: item.url, kind: item.kind,
          filename: item.filename, id: item.filename,
        });
      }
      setMissing((prev) => (prev ? prev.filter((m) => m.filename !== item.filename) : prev));
    } catch (e) {
      setMessage({ level: "error", text: `Téléchargement échoué : ${e}` });
    } finally {
      setRestoring(null);
    }
  };

  const restoreAll = async () => {
    const list = (missing || []).filter((m) => m.url);
    for (const item of list) await restoreOne(item);
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-bold text-white">Sauvegarde du profil</h3>
        <p className="text-[11px] text-gray-500">Pour installer un poste supplémentaire sans tout refaire</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          onClick={exportProfile}
          disabled={busy !== null}
          className="flex items-center gap-3 rounded-lg border border-white/5 bg-[#232428] p-4 text-left transition hover:border-[#5865f2]/50 disabled:opacity-60"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#5865f2]/15 text-[#8891f2]">
            {busy === "export" ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-bold text-gray-100">Exporter</span>
            <span className="block text-[10px] text-gray-500">Réglages, agenda et liste des contenus</span>
          </span>
        </button>

        <button
          onClick={importProfile}
          disabled={busy !== null}
          className="flex items-center gap-3 rounded-lg border border-white/5 bg-[#232428] p-4 text-left transition hover:border-[#5865f2]/50 disabled:opacity-60"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
            {busy === "import" ? <Loader2 size={18} className="animate-spin" /> : <FolderInput size={18} />}
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-bold text-gray-100">Importer</span>
            <span className="block text-[10px] text-gray-500">Restaure les réglages, puis propose les contenus</span>
          </span>
        </button>
      </div>

      {message && (
        <p className={`rounded border p-2.5 text-[11px] font-semibold ${
          message.level === "ok"
            ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
            : "border-red-500/25 bg-red-500/10 text-red-400"
        }`}>
          {message.text}
        </p>
      )}

      {missing !== null && (
        missing.length === 0 ? (
          <p className="flex items-center gap-2 rounded border border-emerald-500/25 bg-emerald-500/10 p-2.5 text-[11px] text-emerald-400">
            <Check size={13} /> Tous les contenus du profil sont déjà présents sur cette machine.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle size={13} className="text-amber-400" />
              <h4 className="text-xs font-bold text-gray-200">{missing.length} contenu(s) absent(s)</h4>
              {missing.some((m) => m.url) && (
                <button
                  onClick={restoreAll}
                  disabled={restoring !== null}
                  className="ml-auto rounded bg-[#5865f2] px-3 py-1 text-[10px] font-bold text-white transition hover:bg-[#4752c4] disabled:opacity-60"
                >
                  Tout télécharger
                </button>
              )}
            </div>
            <div className="overflow-hidden rounded-lg border border-white/5 bg-[#232428]">
              {missing.map((m) => (
                <div key={`${m.kind}-${m.filename}`} className="flex items-center gap-3 border-b border-white/5 px-4 py-2.5 last:border-0">
                  <span className="shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-bold uppercase text-gray-400">
                    {m.kind}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-gray-300" title={m.filename}>{m.label}</span>
                  {m.url ? (
                    <button
                      onClick={() => restoreOne(m)}
                      disabled={restoring !== null}
                      className="flex shrink-0 items-center gap-1 rounded border border-[#5865f2]/40 px-2 py-1 text-[10px] font-bold text-[#8891f2] transition hover:bg-[#5865f2] hover:text-white disabled:opacity-50"
                    >
                      {restoring === m.filename ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                      Installer
                    </button>
                  ) : (
                    <span className="shrink-0 text-[10px] text-gray-600">source inconnue</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      )}

      <p className="text-[11px] leading-relaxed text-gray-500">
        Le fichier reste léger : il contient les réglages, l'agenda du jour et la <em>liste</em> des
        contenus installés — pas les fichiers eux-mêmes. Les médias importés, les fonds et les audios
        téléchargés ne sont pas transférés ; copie-les à la main si tu en as besoin
        (onglet Stockage → Ouvrir le dossier).
      </p>
    </div>
  );
}
