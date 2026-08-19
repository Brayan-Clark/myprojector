# Publier une version

---

## En résumé

```bash
npm run release 0.2.0
```

Puis, quand la construction est finie (~15 min), aller sur la page des releases
GitHub et cliquer **Publish release**. C'est tout.

---

## Ce que fait la commande

`scripts/release.mjs` :

1. refuse de continuer si des modifications ne sont pas commitées, ou si le tag
   existe déjà ;
2. écrit le numéro de version dans **les trois fichiers qui le portent** —
   `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` — et met
   à jour `Cargo.lock` ;
3. commit `release: v0.2.0`, pose le tag annoté `v0.2.0` ;
4. pousse la branche et le tag.

Trois fichiers, parce qu'un désaccord entre eux est invisible et coûteux : la
version affichée par l'application vient de `tauri.conf.json`, et c'est elle que
le client compare à `latest.json`.

**Pourquoi un tag et pas chaque push ?** Une release par commit rendrait le
numéro de version insignifiant et enverrait une notification de mise à jour à
tous les utilisateurs pour la moindre virgule.

---

## Ce que fait la CI

`.github/workflows/release.yml`, déclenché par un tag `v*` (ou à la main via
*Run workflow*). Trois machines en parallèle, sans `fail-fast` : un échec macOS
n'annule pas Windows et Linux.

| Runner | Produit |
|---|---|
| `windows-latest` | `.msi` et `.exe` (NSIS) |
| `macos-latest` | `.dmg` universel (Intel + Apple Silicon) |
| `ubuntu-22.04` | `.deb`, `.rpm`, `.AppImage` |

**⚠ Ne pas passer le runner Linux à une version plus récente.** Le binaire est
lié à la glibc de la machine de compilation : compiler sur 24.04 casserait
Debian 12, LMDE et toute distribution un peu moins récente.

La release est créée **en brouillon**. Tant qu'elle n'est pas publiée, aucun
utilisateur ne reçoit de notification — c'est le filet de sécurité avant
diffusion.

---

## Les clés de signature

Chaque mise à jour est signée. Sans signature valide, les applications déjà
installées **refusent** la mise à jour : c'est ce qui empêche quelqu'un de
distribuer un faux binaire à ta place.

| Élément | Où |
|---|---|
| Clé publique | `src-tauri/tauri.conf.json` → `plugins.updater.pubkey` |
| Clé privée | `~/.myprojector-keys/myprojector-updater.key` (hors du dépôt) |
| Secret GitHub | `TAURI_SIGNING_PRIVATE_KEY` = contenu de ce fichier |

### 🔴 Sauvegarde la clé privée

Si tu la perds, **plus aucune mise à jour ne pourra être signée** pour les
versions déjà installées : il faudrait que chaque utilisateur réinstalle à la
main. Copie-la sur un support séparé (clé USB, gestionnaire de mots de passe).

`*.key` et `*.key.pub` sont dans `.gitignore`. Ne jamais les committer.

### Le mot de passe

La clé a été générée **sans mot de passe**. Ne crée donc pas le secret
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` : GitHub évalue un secret inexistant en
chaîne vide, ce qui est exactement ce qu'il faut.

La variable doit malgré tout **exister** dans l'environnement. Vérifié :

| Situation | Résultat |
|---|---|
| Variable absente | ❌ `incorrect updater private key password: No such device` |
| Variable présente et vide | ✅ signature produite |

Sans la variable, `tauri` bascule en saisie interactive — impossible dans un
runner. D'où le `|| ''` dans le workflow, qui documente que le vide est voulu.

### Régénérer une clé

```bash
npx tauri signer generate -w ~/.myprojector-keys/myprojector-updater.key
```

Puis reporter la nouvelle clé publique dans `tauri.conf.json` et le secret sur
GitHub. **Attention** : les applications déjà installées avec l'ancienne clé
publique n'accepteront plus les mises à jour. À ne faire qu'en cas de fuite.

---

## Côté application

L'utilisateur voit une bannière discrète en bas à droite quand une version
existe : *Installer maintenant* / *Plus tard*. Jamais de fenêtre bloquante, rien
d'automatique — on ne redémarre pas une machine en plein culte.

- vérification 8 secondes après le démarrage, une fois par tranche de 6 h ;
- « Plus tard » ne vaut que pour cette version, la suivante est reproposée ;
- jamais affichée dans la fenêtre de projection ;
- vérification manuelle : **Bibliothèque → Mise à jour**.

Le client interroge :
`https://github.com/Brayan-Clark/myprojector/releases/latest/download/latest.json`
— fichier généré par la CI (`includeUpdaterJson: true`) et accessible seulement
une fois la release publiée.

### ⚠ Le .deb ne se met pas à jour tout seul

Limite de Tauri, pas un oubli : un paquet appartient au gestionnaire de paquets,
l'application n'a pas à le remplacer dans le dos du système.

| Format | Mise à jour |
|---|---|
| AppImage, Windows, macOS | automatique |
| `.deb`, `.rpm` | manuelle |

La commande Rust `update_install_kind()` détecte le cas (variable
d'environnement `APPIMAGE`). Sur un paquet système, l'application le dit
clairement et ouvre la page de téléchargement.

---

## Construire en local

```bash
npm run build:app
npm run build:app -- --bundles deb      # un seul format
```

**⚠ Pas `npm run tauri build` directement.** `tauri.conf.json` contient la clé
publique de mise à jour : tauri réclame alors la clé privée pour signer, et
s'arrête sur *« A public key has been found, but no private key »*.
`scripts/build.mjs` lit la clé dans `~/.myprojector-keys/` et la passe par
l'environnement — elle n'est écrite nulle part.

Clé ailleurs ? `TAURI_SIGNING_PRIVATE_KEY_PATH=/chemin/vers/la.key npm run build:app`

---

## Réutiliser un numéro de version

Supprimer un tag sur GitHub ne le supprime pas en local. Le script distingue les
deux cas :

| Situation | Message |
|---|---|
| Tag présent sur GitHub | *déjà publié — choisis un numéro supérieur* |
| Tag local seulement | donne la commande : `git tag -d v0.0.1` |

Pour repartir proprement d'un numéro déjà essayé :

```bash
git tag -d v0.0.1                        # local
git push origin :refs/tags/v0.0.1        # distant, si besoin
npm run release 0.0.1
```

Supprime aussi la release correspondante sur GitHub, sinon le tag est recréé
avec elle.

---

## Si la construction échoue

1. Ouvrir l'onglet **Actions** du dépôt, cliquer sur le job en rouge.
2. Les erreurs Rust apparaissent à l'étape `tauri-apps/tauri-action`.
3. Corriger, committer, puis **supprimer le tag** avant de recommencer :

```bash
git tag -d v0.2.0
git push origin :refs/tags/v0.2.0
```

Le script refuse un tag existant — c'est volontaire, un tag qui change de sens
est une source d'ennuis durable.

Les builds Windows et macOS n'ont jamais été compilés localement. Le code Rust
spécifique à Linux est isolé derrière des `#[cfg(target_os = "linux")]`, mais
seule la CI le prouve réellement.

Le bundle macOS n'est pas signé chez Apple : les utilisateurs verront un
avertissement Gatekeeper au premier lancement (clic droit → Ouvrir).
