#!/usr/bin/env node
/**
 * Publication d'une version.
 *
 *   npm run release 0.2.0
 *
 * Met le même numéro dans les trois fichiers qui le portent, verrouille
 * Cargo.lock, commit, pose le tag `v0.2.0` et pousse. C'est le tag qui
 * déclenche `.github/workflows/release.yml`, qui construit Windows, macOS et
 * Linux puis prépare la release en brouillon.
 *
 * Trois fichiers, parce qu'un désaccord entre eux est invisible et coûteux :
 * la version affichée par l'application vient de tauri.conf.json, et c'est elle
 * que le client compare à `latest.json`. Si Cargo.toml dit autre chose, le
 * binaire s'appelle autrement que ce que l'utilisateur croit installer.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// `stdio: "inherit"` renvoie null (la sortie est allée au terminal, pas dans une
// variable) : sans le `?? ""`, le simple fait d'afficher la progression de git
// faisait planter le script APRES un push pourtant réussi.
const run = (cmd, args, opts = {}) =>
  (execFileSync(cmd, args, { cwd: root, encoding: "utf8", stdio: "pipe", ...opts }) ?? "").trim();

const fail = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };

// --- Version demandée -------------------------------------------------------
const version = process.argv.slice(2).find((a) => a !== "--");
if (!version) fail("Version manquante.  Exemple :  npm run release 0.2.0");
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`« ${version} » n'est pas une version valide (attendu : 1.2.3).`);

// --- Garde-fous -------------------------------------------------------------
// Un tag pointe sur un commit précis : publier depuis un dossier contenant des
// modifications non commitées produirait une version différente de ce qui est
// réellement dans le dépôt.
if (run("git", ["status", "--porcelain"])) {
  fail("Des modifications ne sont pas enregistrées. Fais un commit avant de publier.");
}

const tag = `v${version}`;
const tags = run("git", ["tag", "--list", tag]);
if (tags) fail(`Le tag ${tag} existe déjà. Choisis un numéro supérieur.`);

const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);

// --- Mise à jour des trois fichiers ----------------------------------------
const bumpJson = (path, apply) => {
  const file = join(root, path);
  const data = JSON.parse(readFileSync(file, "utf8"));
  apply(data);
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
};

bumpJson("package.json", (d) => { d.version = version; });
bumpJson("src-tauri/tauri.conf.json", (d) => { d.version = version; });

const cargoPath = join(root, "src-tauri/Cargo.toml");
const cargo = readFileSync(cargoPath, "utf8");
// Uniquement la version du paquet, en tête de fichier : surtout pas celles des
// dépendances qui suivent.
const bumped = cargo.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`);
if (bumped === cargo) fail("Version introuvable dans src-tauri/Cargo.toml.");
writeFileSync(cargoPath, bumped);

// Cargo.lock est suivi par git : sans cette mise à jour, la compilation en CI
// le modifierait et le dépôt divergerait à chaque release.
try {
  run("cargo", ["update", "--package", "myprojector", "--offline"], { cwd: join(root, "src-tauri") });
} catch {
  console.warn("⚠ Cargo.lock non mis à jour (cargo indisponible) — vérifie-le avant de pousser.");
}

console.log(`Version ${version} écrite dans package.json, tauri.conf.json et Cargo.toml.`);

// --- Commit, tag, push ------------------------------------------------------
run("git", ["add", "package.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]);
run("git", ["commit", "-m", `release: ${tag}`]);
run("git", ["tag", "-a", tag, "-m", `MyProjector ${version}`]);
run("git", ["push", "origin", branch, "--follow-tags"], { stdio: "inherit" });

console.log(`
✓ ${tag} publié sur la branche ${branch}.

  La construction démarre ici :
  https://github.com/Brayan-Clark/myprojector/actions

  Windows, macOS et Linux prennent une quinzaine de minutes. La release est
  créée en BROUILLON : relis-la, puis clique « Publish release ». C'est cette
  publication qui déclenche la proposition de mise à jour chez les utilisateurs.
`);
