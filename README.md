# dsh-purge market index (compatibility alias)

The [DSH plugin market](https://github.com/deepseek-ai/deepseek-harness) reads **plugin market
index format 1**: a single JSON document listing installable bundles. The market fetches the
configured index URL **verbatim** and validates the body as format 1 — it never appends a path
and never reads a GitHub repository page.

**This repository is an alias.** The canonical index now lives with the plugin's mirror
repository and is generated there:

```
https://raw.githubusercontent.com/jcforever1/dsh-purge/master/index.json
```

This repository keeps serving the same document at its original URL so existing index sources
keep working:

```
https://raw.githubusercontent.com/jcforever1/dsh-purge-market/main/index.json
```

Both URLs return byte-identical content.

## Use it

Add the canonical URL as an index source in DSH (**Plugins → Discover → Manage index sources…**):

```
https://raw.githubusercontent.com/jcforever1/dsh-purge/master/index.json
```

or, for a profile that prefers a local copy, point at any static server that serves
`index.json` (for example `http://127.0.0.1:8849/index.json`).

## What the document contains

```json
{
  "format": 1,
  "title": "dsh-purge",
  "plugins": [
    {
      "name": "dsh-purge",
      "author": "YuJunZhiXue",
      "repository": { "url": "https://github.com/YuJunZhiXue/dsh-purge" },
      "versions": [
        {
          "version": "1.1.77",
          "publishTimestamp": 1792777867,
          "source": {
            "type": "git",
            "url": "https://github.com/jcforever1/dsh-purge",
            "commit": "1732eed6b0cdeb5a5e7353fdc013e19226fca54e"
          },
          "engines": { "dsh": ">=0.2.1-rc.2" }
        }
      ]
    }
  ]
}
```

`format` must be the **number** `1`. Each version's `source` is either `npm` (`name@version`) or
`git` (a canonical `https` repository URL plus a 40-hex commit SHA); `dsh-purge` is not published
to npm, so the entry uses `git`.

Two fields carry different facts on purpose:

- `source` is where the install comes from — the mirror repository, which is the tree that
  carries the change below.
- `author` and `repository` are where the code originally comes from — the upstream repository by
  the upstream author, as the upstream NOTICE requires.

## Installing it needs no approval

The mirror ships **no `postinstall`**. Upstream's `postinstall`
(`scripts/ensure-profile-bundle.mjs`) only appends `dsh-purge` to the profile's
`dsh.profile.bundles`, and DSH's own plugin manager already does that — `reconcile()` in
`dsh-plugin-manager` runs after every install the manager performs, adds the new bundle to
`dsh.profile.bundles`, and loads the bundle's `cordis.patch.yml` as an overlay patch.

That matters because pnpm 11 blocks a dependency's install script until the exact dependency is
allowed, and the key it demands is the dependency's *resolved* identifier. For a git dependency
that identifier embeds the commit:

```
dsh-purge@https://codeload.github.com/<owner>/dsh-purge/tar.gz/<commit>
```

A name-only key is rejected (verified on pnpm 11.28.5: `allowBuilds: { dsh-purge: true }` still
fails with `ERR_PNPM_IGNORED_BUILDS`). Because the commit is part of the key, the key changed on
every upstream release and every user had to re-approve on every update.

With no lifecycle script to run, a market install runs zero build scripts: no approval, no
`allowBuilds` entry, at any version.

Installing through raw pnpm (`dsh plugin --profile <profile> add …`) bypasses the plugin manager,
so run the script once by hand afterwards:

```bash
node <profile>/node_modules/dsh-purge/scripts/ensure-profile-bundle.mjs
```

## Regenerating

The index is generated in the mirror repository by `make-index.mjs` there, and validated with the
validator DSH itself ships (`@deepseek-ai/dsh-plugin-market-index`). This repository's workflow
copies that document and checks `format === 1` before committing it.

## Why this exists

Pointing the market at `https://github.com/YuJunZhiXue/dsh-purge` fails with:

```
Error: https://github.com/YuJunZhiXue/dsh-purge: $.format must be 1
```

GitHub answers the market's `Accept: application/json` request with HTTP 200 and the repository
page as JSON, so the fetch succeeds and the *validation* fails: the body has no `format` field.
A market index must be served as a JSON document at a URL that returns it directly.

## Refresh

The canonical index is generated in the plugin mirror
([`jcforever1/dsh-purge`](https://github.com/jcforever1/dsh-purge)) and copied here every six
hours by `.github/workflows/update-index.yml`. The canonical URL is:

```
https://raw.githubusercontent.com/jcforever1/dsh-purge/master/index.json
```

Note: `raw.githubusercontent.com` caches per path, so after a push this URL can serve the previous
bytes for a few minutes. The repository's own content is always current — check
`https://api.github.com/repos/jcforever1/dsh-purge-market/contents/index.json` if the two
disagree.
