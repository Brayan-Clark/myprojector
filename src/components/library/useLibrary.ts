import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { downloadFile, listInstalled, removeInstalled, type LibraryKind } from "../../lib/library";

export interface Progress { received: number; total: number }

/**
 * État partagé des téléchargements : ce qui est installé, ce qui est en cours.
 * Rien ne se télécharge automatiquement — chaque appel vient d'un clic.
 */
export function useLibraryDownloads(kind: LibraryKind, collection?: string) {
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const files = await listInstalled(kind, collection);
      if (mounted.current) setInstalled(new Set(files.map((f) => f.filename)));
    } catch (e) {
      console.error("listInstalled", kind, collection, e);
    }
  }, [kind, collection]);

  useEffect(() => {
    mounted.current = true;
    refresh();
    return () => { mounted.current = false; };
  }, [refresh]);

  // Progression émise par Rust pendant l'écriture du fichier.
  useEffect(() => {
    let un: (() => void) | undefined;
    listen<{ id: string; received: number; total: number }>("library_download_progress", (e) => {
      setProgress((p) => ({ ...p, [e.payload.id]: { received: e.payload.received, total: e.payload.total } }));
    }).then((u) => { un = u; });
    return () => { if (un) un(); };
  }, []);

  const download = useCallback(async (id: string, url: string, filename: string) => {
    setFailed((f) => { const n = { ...f }; delete n[id]; return n; });
    setProgress((p) => ({ ...p, [id]: { received: 0, total: 0 } }));
    try {
      const path = await downloadFile({ url, kind, filename, id, collection });
      await refresh();
      return path;
    } catch (e: any) {
      setFailed((f) => ({ ...f, [id]: String(e) }));
      return null;
    } finally {
      setProgress((p) => { const n = { ...p }; delete n[id]; return n; });
    }
  }, [kind, collection, refresh]);

  const remove = useCallback(async (filename: string) => {
    await removeInstalled(kind, filename, collection);
    await refresh();
  }, [kind, collection, refresh]);

  return { installed, progress, failed, download, remove, refresh };
}
