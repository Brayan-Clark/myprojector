import { describe, expect, it } from "vitest";
import {
  docFileName, formatBytes, meditationToLyrics, trackFileName,
  type DocItem, type Meditation, type PlaybackTrack,
} from "./library";

const meditation = (extra: Partial<Meditation> = {}): Meditation => ({
  date: "2026-10-27",
  titre_du_jour: "Aiza no ifantohan'ny sainao?",
  verset_texte: "Saino ny zavatra any ambony",
  verset_reference: "Kôl. 3:1,2",
  contenu: "Premier paragraphe.\n\nSecond paragraphe.",
  ...extra,
});

describe("docFileName", () => {
  const doc = (id: string, url: string): DocItem => ({
    id, url, title: "T", fileName: "f", categoryId: "c", size: "1 Mo",
  });

  it("préfixe par l'identifiant pour éviter les collisions", () => {
    // Plusieurs « Ifm.pdf » existent dans le dépôt, dans des catégories
    // différentes : sans le préfixe, le second écraserait le premier.
    expect(docFileName(doc("a1", "https://x/Ifm.pdf"))).toBe("a1-Ifm.pdf");
    expect(docFileName(doc("b2", "https://y/Ifm.pdf"))).toBe("b2-Ifm.pdf");
  });

  it("décode le nom de fichier échappé dans l'URL", () => {
    expect(docFileName(doc("a1", "https://x/Mon%20livre.pdf"))).toBe("a1-Mon livre.pdf");
  });

  it("neutralise les séparateurs de chemin", () => {
    // Un nom contenant « / » deviendrait une écriture hors du dossier visé.
    expect(docFileName(doc("a1", "https://x/a%2Fb.pdf"))).toBe("a1-a-b.pdf");
  });

  it("retombe sur un nom par défaut si l'URL n'en donne pas", () => {
    expect(docFileName(doc("a1", "https://x/"))).toBe("a1-document.pdf");
  });
});

describe("trackFileName", () => {
  const track = (p: Partial<PlaybackTrack>): PlaybackTrack =>
    ({ id: "1", title: "T", url: "https://x/1.mp3", ...p });

  /**
   * ⚠ Le lien se fait par `c_num` (le numéro du chant), PAS par `id` : dans
   * fihirana-adventista l'entrée id=300 correspond au cantique n°324. Nommer
   * le fichier d'après `id` rendrait l'audio introuvable hors ligne.
   */
  it("nomme d'après le numéro de cantique, pas l'identifiant", () => {
    expect(trackFileName(track({ id: "300", c_num: "324" }))).toBe("324.mp3");
  });

  it("retombe sur l'identifiant quand le numéro manque", () => {
    expect(trackFileName(track({ id: "300" }))).toBe("300.mp3");
  });

  it("ignore les espaces autour du numéro", () => {
    expect(trackFileName(track({ id: "1", c_num: " 42 " }))).toBe("42.mp3");
  });
});

describe("formatBytes", () => {
  it("passe en mégaoctets au-delà de 1 Mo", () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 Mo");
  });

  it("reste en kilooctets en dessous", () => {
    expect(formatBytes(512 * 1024)).toBe("512 Ko");
  });

  it("affiche un tiret plutôt que « 0 »", () => {
    // Une taille inconnue vaut mieux qu'un zéro qui ferait croire à un fichier
    // vide.
    expect(formatBytes(0)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
  });
});

describe("meditationToLyrics", () => {
  it("ouvre sur le verset avec sa référence", () => {
    const slides = meditationToLyrics(meditation()).split(/\n\s*\n/);
    expect(slides[0]).toBe("Saino ny zavatra any ambony\n(Kôl. 3:1,2)");
  });

  it("fait une diapo par paragraphe", () => {
    const slides = meditationToLyrics(meditation()).split(/\n\s*\n/);
    expect(slides).toEqual([
      "Saino ny zavatra any ambony\n(Kôl. 3:1,2)",
      "Premier paragraphe.",
      "Second paragraphe.",
    ]);
  });

  /**
   * La source est une référence, pas une pensée : elle termine la dernière
   * diapo au lieu d'occuper un écran à elle seule.
   */
  it("accroche la source à la dernière diapo", () => {
    const slides = meditationToLyrics(meditation({ source: "RH, 2 Febroary 1897." }))
      .split(/\n\s*\n/);
    expect(slides).toHaveLength(3);
    expect(slides[2]).toBe("Second paragraphe.\n— RH, 2 Febroary 1897.");
  });

  it("donne une diapo à la source s'il n'y a aucun paragraphe", () => {
    const slides = meditationToLyrics(meditation({ contenu: "", source: "RH, 1897." }))
      .split(/\n\s*\n/);
    expect(slides[slides.length - 1]).toBe("— RH, 1897.");
  });

  it("ignore une source vide", () => {
    expect(meditationToLyrics(meditation({ source: "   " }))).not.toContain("—");
  });
});
