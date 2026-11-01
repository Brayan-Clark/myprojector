import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUILTIN_TEMPLATES, allTemplates, deleteUserTemplate, duplicateTemplate,
  findTemplate, formatDuration, readUserTemplates, saveUserTemplate,
  templateItems, totalMinutes, writeUserTemplates, type ServiceTemplate,
} from "./serviceTemplates";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

beforeEach(() => vi.stubGlobal("localStorage", fakeStorage()));
afterEach(() => vi.unstubAllGlobals());

describe("modèles fournis", () => {
  /**
   * Les deux ordres du culte divin sont repris MOT POUR MOT du Manuel d'Église
   * 2022, p. 252. Ce test fixe le libellé : c'est celui que les anciens
   * reconnaissent, et le reformuler ferait perdre au modèle sa raison d'être.
   */
  it("reprend l'ordre long du Manuel d'Église, dans l'ordre", () => {
    const steps = BUILTIN_TEMPLATES.find((t) => t.id === "sabbath-long")!.steps.map((s) => s.title);
    expect(steps).toEqual([
      "Prélude musical",
      "Annonces",
      "Entrée des participants au service",
      "Doxologie",
      "Invocation (prière)",
      "Lecture de la Bible",
      "Cantique de louange",
      "Prière",
      "Motet ou musique spécialement choisie",
      "Offrande",
      "Cantique de consécration",
      "Prédication",
      "Cantique",
      "Bénédiction",
      "Prière silencieuse",
      "Postlude musical",
    ]);
  });

  it("reprend l'ordre court du Manuel d'Église, dans l'ordre", () => {
    const steps = BUILTIN_TEMPLATES.find((t) => t.id === "sabbath-short")!.steps.map((s) => s.title);
    expect(steps).toEqual([
      "Annonces",
      "Cantique",
      "Prière",
      "Offrande",
      "Cantique ou musique spéciale",
      "Prédication",
      "Cantique",
      "Bénédiction",
      "Prière silencieuse",
    ]);
  });

  it("couvre la semaine de l'église", () => {
    const ids = BUILTIN_TEMPLATES.map((t) => t.id);
    for (const expected of [
      "sabbath-long", "sabbath-short", "sabbath-school", "youth", "prayer",
      "vespers", "communion",
    ]) {
      expect(ids, `modèle manquant : ${expected}`).toContain(expected);
    }
  });

  /**
   * Le Manuel d'Église dit explicitement que les formes du service varient et
   * qu'il s'agit de « deux formes suggérées ». Chaque modèle doit donc porter
   * sa source, affichée dans l'interface : sans elle, l'application aurait
   * l'air de prescrire un culte.
   */
  it("cite une source pour chaque modèle fourni", () => {
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.source, `source manquante : ${t.id}`).toBeTruthy();
    }
  });

  it("renseigne un moment et une famille", () => {
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.when.trim(), t.id).not.toBe("");
      expect(t.hint.trim(), t.id).not.toBe("");
      expect(["divine", "study", "youth", "prayer", "vespers", "communion"]).toContain(t.kind);
    }
  });

  it("n'a aucun identifiant ni libellé en doublon", () => {
    const ids = BUILTIN_TEMPLATES.map((t) => t.id);
    const labels = BUILTIN_TEMPLATES.map((t) => t.label);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("n'a aucune étape sans nom", () => {
    for (const t of BUILTIN_TEMPLATES) {
      for (const step of t.steps) expect(step.title.trim(), t.id).not.toBe("");
    }
  });

  it("donne une durée plausible à chaque service", () => {
    for (const t of BUILTIN_TEMPLATES) {
      const total = totalMinutes(t);
      expect(total, `${t.id} sans durée`).toBeGreaterThan(20);
      // Au-delà de trois heures, c'est une erreur de saisie, pas un culte.
      expect(total, `${t.id} trop long`).toBeLessThan(180);
    }
  });

  it("réserve la part principale à la prédication dans le culte divin", () => {
    for (const id of ["sabbath-long", "sabbath-short"]) {
      const t = BUILTIN_TEMPLATES.find((x) => x.id === id)!;
      const sermon = t.steps.find((s) => s.title === "Prédication")!;
      expect(sermon.minutes).toBeGreaterThanOrEqual(30);
    }
  });

  it("accorde 35 minutes à l'étude de la leçon", () => {
    // La source : 25 minutes de mission, 35 minutes de discussion de la leçon.
    const eds = BUILTIN_TEMPLATES.find((t) => t.id === "sabbath-school")!;
    const study = eds.steps.find((s) => s.title.startsWith("Étude de la leçon"))!;
    expect(study.minutes).toBe(35);
  });
});

describe("templateItems", () => {
  /**
   * ⚠ Les étapes sont des REPÈRES, pas des diapos. Si elles portaient du
   * texte, « Prédication » partirait en plein écran devant l'assemblée.
   */
  it("ne produit aucun contenu projetable", () => {
    for (const t of BUILTIN_TEMPLATES) {
      for (const item of templateItems(t)) {
        expect(item.type).toBe("custom");
        expect(item.lyrics).toBe("");
      }
    }
  });

  it("produit une étape par ligne, dans l'ordre", () => {
    const t = BUILTIN_TEMPLATES[0];
    expect(templateItems(t).map((i) => i.title)).toEqual(t.steps.map((s) => s.title));
  });

  it("produit des identifiants tous distincts", () => {
    const items = templateItems(BUILTIN_TEMPLATES[0]);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });
});

describe("formatDuration", () => {
  it("passe des minutes aux heures", () => {
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(85)).toBe("1 h 25");
    expect(formatDuration(120)).toBe("2 h");
  });

  it("ne rend rien pour une durée inconnue", () => {
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(-5)).toBe("");
  });
});

describe("modèles de l'utilisateur", () => {
  const mine: ServiceTemplate = {
    id: "user-1", label: "Mon culte", when: "Sabbat", hint: "",
    kind: "divine", steps: [{ title: "Cantique" }], builtin: false,
  };

  it("enregistre, relit et supprime", () => {
    saveUserTemplate(mine);
    expect(readUserTemplates()).toHaveLength(1);
    expect(findTemplate("user-1")?.label).toBe("Mon culte");
    deleteUserTemplate("user-1");
    expect(readUserTemplates()).toHaveLength(0);
  });

  it("remplace au lieu d'ajouter quand l'identifiant existe", () => {
    saveUserTemplate(mine);
    saveUserTemplate({ ...mine, label: "Renommé" });
    const list = readUserTemplates();
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe("Renommé");
  });

  it("place les modèles de l'utilisateur avant ceux fournis", () => {
    saveUserTemplate(mine);
    expect(allTemplates()[0].id).toBe("user-1");
    expect(allTemplates()).toHaveLength(BUILTIN_TEMPLATES.length + 1);
  });

  it("force `builtin` à faux, même si le stockage dit le contraire", () => {
    // Sinon un modèle de l'utilisateur deviendrait non supprimable.
    writeUserTemplates([{ ...mine, builtin: true } as ServiceTemplate]);
    expect(readUserTemplates()[0].builtin) .toBe(false);
  });

  it("écarte les entrées inutilisables sans tout perdre", () => {
    localStorage.setItem("serviceTemplates", JSON.stringify([
      mine,
      null,
      { id: "x", label: "  ", steps: [{ title: "a" }] },
      { id: "y", label: "Sans étape", steps: [] },
      { id: "z", label: "Étapes vides", steps: [{ title: "  " }] },
    ]));
    const list = readUserTemplates();
    expect(list.map((t) => t.id)).toEqual(["user-1"]);
  });

  it("ignore un stockage illisible au lieu de lever", () => {
    // Il survit aux mises à jour : son contenu n'est pas digne de confiance,
    // et une exception empêcherait d'ouvrir le sélecteur.
    localStorage.setItem("serviceTemplates", "{ pas du json");
    expect(readUserTemplates()).toEqual([]);
    localStorage.setItem("serviceTemplates", '{"pas":"un tableau"}');
    expect(readUserTemplates()).toEqual([]);
  });
});

describe("duplicateTemplate", () => {
  const manual = BUILTIN_TEMPLATES.find((t) => t.id === "sabbath-long")!;

  it("crée une copie indépendante et modifiable", () => {
    const copy = duplicateTemplate(manual);
    expect(copy.builtin).toBe(false);
    expect(copy.id).not.toBe(manual.id);
    expect(copy.steps).toEqual(manual.steps);
    // Copie PROFONDE : modifier la copie ne doit pas toucher la référence.
    copy.steps[0].title = "Changé";
    expect(manual.steps[0].title).toBe("Prélude musical");
  });

  /**
   * ⚠ Garder la source telle quelle laisserait croire que le Manuel d'Église
   * dit ce que l'église locale a décidé. On la requalifie.
   */
  it("requalifie la source d'une version modifiée", () => {
    const copy = duplicateTemplate(manual);
    expect(copy.source).toMatch(/^D'après :/);
    expect(copy.source).toContain("Manuel d'Église");
  });

  it("accepte un nom donné, sinon en propose un", () => {
    expect(duplicateTemplate(manual, "Culte d'Antsirabe").label).toBe("Culte d'Antsirabe");
    expect(duplicateTemplate(manual).label).toContain("ma version");
    expect(duplicateTemplate(manual, "   ").label).toContain("ma version");
  });

  it("ne modifie pas le modèle fourni", () => {
    const before = JSON.stringify(manual);
    saveUserTemplate(duplicateTemplate(manual));
    expect(JSON.stringify(BUILTIN_TEMPLATES.find((t) => t.id === "sabbath-long"))).toBe(before);
  });
});
