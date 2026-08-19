#!/usr/bin/env node
/**
 * Construction locale de l'application.
 *
 *   npm run build:app
 *   npm run build:app -- --bundles deb
 *
 * Depuis que la mise à jour automatique existe, `tauri.conf.json` contient une
 * clé publique : tauri exige alors la clé PRIVEE pour signer les artefacts, et
 * s'arrête sinon avec « A public key has been found, but no private key ».
 *
 * Ce script fournit la clé à partir du fichier local, pour ne pas avoir à s'en
 * souvenir à chaque construction. La clé n'est jamais écrite ailleurs : elle ne
 * vit que dans l'environnement du processus lancé ici.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const keyPath =
  process.env.TAURI_SIGNING_PRIVATE_KEY_PATH ||
  join(homedir(), ".myprojector-keys", "myprojector-updater.key");

const env = { ...process.env };

if (env.TAURI_SIGNING_PRIVATE_KEY) {
  console.log("Clé de signature : fournie par l'environnement.");
} else if (existsSync(keyPath)) {
  env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(keyPath, "utf8").trim();
  console.log(`Clé de signature : ${keyPath}`);
} else {
  console.error(`
✗ Clé privée introuvable : ${keyPath}

  Elle est nécessaire pour signer les artefacts de mise à jour.
  Restaure ta sauvegarde, ou indique son emplacement :

      TAURI_SIGNING_PRIVATE_KEY_PATH=/chemin/vers/la.key npm run build:app

  Voir docs/RELEASE.md.
`);
  process.exit(1);
}

// La variable doit exister même vide : sans elle, tauri bascule en saisie
// interactive du mot de passe et échoue. Notre clé n'en a pas.
env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= "";

const args = process.argv.slice(2).filter((a) => a !== "--");
const res = spawnSync("npx", ["tauri", "build", ...args], {
  cwd: root,
  env,
  stdio: "inherit",
});

process.exit(res.status ?? 1);
