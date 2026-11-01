import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearResumePoint, describeAge, readResumePoint, saveResumePoint,
} from "./resume";

/**
 * `localStorage` n'existe pas dans l'environnement de test (volontairement :
 * voir la configuration Vitest). On en pose un minimal — c'est assez pour
 * vérifier la logique de validité, qui est tout l'intérêt de ce module.
 */
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    get size() { return map.size; },
  };
}

let store: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  store = fakeStorage();
  vi.stubGlobal("localStorage", store);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const point = { itemId: "abc", title: "Cantique 42", slideIndex: 2, pdfPage: 1 };

describe("saveResumePoint / readResumePoint", () => {
  it("rend la position enregistrée", () => {
    saveResumePoint(point);
    expect(readResumePoint(["abc"])).toMatchObject(point);
  });

  it("horodate l'enregistrement", () => {
    saveResumePoint(point);
    expect(readResumePoint(["abc"])!.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("ne rend rien quand rien n'est enregistré", () => {
    expect(readResumePoint(["abc"])).toBeNull();
  });

  /**
   * Une position qui désigne un élément supprimé depuis mènerait à un clic
   * sans effet : mieux vaut ne rien proposer.
   */
  it("ignore une position dont l'élément n'est plus dans l'agenda", () => {
    saveResumePoint(point);
    expect(readResumePoint(["autre"])).toBeNull();
    expect(readResumePoint([])).toBeNull();
  });

  /**
   * Douze heures couvrent un culte interrompu et repris le même jour. Au-delà,
   * proposer de reprendre un cantique de la semaine précédente serait au mieux
   * déroutant.
   */
  it("oublie une position de plus de douze heures", () => {
    saveResumePoint(point);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 13 * 60 * 60 * 1000);
    expect(readResumePoint(["abc"])).toBeNull();
  });

  it("garde une position de onze heures", () => {
    saveResumePoint(point);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 60 * 1000);
    expect(readResumePoint(["abc"])).not.toBeNull();
  });

  it("efface sur demande", () => {
    saveResumePoint(point);
    clearResumePoint();
    expect(readResumePoint(["abc"])).toBeNull();
  });
});

describe("robustesse", () => {
  it("ignore un contenu illisible au lieu de lever", () => {
    // `localStorage` survit aux mises à jour : son contenu n'est pas digne de
    // confiance, et une exception ici empêcherait le démarrage.
    store.setItem("resumePoint", "{ pas du json");
    expect(readResumePoint(["abc"])).toBeNull();
  });

  it.each([
    ["sans itemId", { title: "T", slideIndex: 0, pdfPage: 1, savedAt: new Date().toISOString() }],
    ["sans index", { itemId: "abc", title: "T", pdfPage: 1, savedAt: new Date().toISOString() }],
    ["sans horodatage", { itemId: "abc", title: "T", slideIndex: 0, pdfPage: 1 }],
    ["horodatage invalide", { itemId: "abc", title: "T", slideIndex: 0, pdfPage: 1, savedAt: "hier" }],
  ])("rejette une position %s", (_label, value) => {
    store.setItem("resumePoint", JSON.stringify(value));
    expect(readResumePoint(["abc"])).toBeNull();
  });

  it("rejette un horodatage dans le futur", () => {
    // Horloge système changée entre deux lancements : un âge négatif ne doit
    // pas passer pour « tout récent » indéfiniment.
    store.setItem("resumePoint", JSON.stringify({
      ...point, savedAt: new Date(Date.now() + 86_400_000).toISOString(),
    }));
    expect(readResumePoint(["abc"])).toBeNull();
  });

  it("n'écrit rien si le stockage refuse", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => { throw new Error("quota"); },
      removeItem: () => {},
    });
    expect(() => saveResumePoint(point)).not.toThrow();
  });
});

describe("describeAge", () => {
  it("décrit les minutes puis les heures", () => {
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    expect(describeAge(ago(0))).toBe("à l'instant");
    expect(describeAge(ago(30_000))).toBe("à l'instant");
    expect(describeAge(ago(12 * 60_000))).toBe("il y a 12 min");
    expect(describeAge(ago(3 * 3_600_000))).toBe("il y a 3 h");
  });

  it("tolère une date invalide", () => {
    expect(describeAge("hier")).toBe("à l'instant");
  });
});
