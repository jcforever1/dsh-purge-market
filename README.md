# dsh-purge market index

The [DSH plugin market](https://github.com/deepseek-ai/deepseek-harness) reads **plugin market
index format 1**: a single JSON document listing installable bundles. The market fetches the
configured index URL **verbatim** and validates the body as format 1 — it never appends a path
and never reads a GitHub repository page.

This repository holds that document for the [`dsh-purge`](https://github.com/YuJunZhiXue/dsh-purge)
bundle.

## Use it

Add this URL as an index source in DSH (**Plugins → Discover → Manage index sources…**):

```
https://raw.githubusercontent.com/jcforever1/dsh-purge-market/main/index.json
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
      "versions": [
        {
          "version": "1.1.77",
          "publishTimestamp": 1792777867,
          "source": {
            "type": "git",
            "url": "https://github.com/YuJunZhiXue/dsh-purge",
            "commit": "ac58b3e35509da23bd75b6250f01007590524102"
          },
          "engines": { "dsh": ">=0.2.1-rc.2" }
        }
      ]
    }
  ]
}
```

`format` must be the **number** `1`. Each version's `source` is either `npm`
(`name@version`) or `git` (a canonical `https` repository URL plus a 40-hex commit SHA);
`dsh-purge` is not published to npm, so the entry uses `git`. The `git` source installs as
`git+https://github.com/YuJunZhiXue/dsh-purge.git#ac58b3e3…`, which pnpm resolves to the
commit-pinned tarball
`https://codeload.github.com/YuJunZhiXue/dsh-purge/tar.gz/ac58b3e3…` and verifies by
integrity hash.

## Installing it

The market's **Install** button (or `dsh plugin add`) runs pnpm, which blocks a dependency's
install script until it is allowed. `dsh-purge`'s `postinstall`
(`scripts/ensure-profile-bundle.mjs`) only appends `dsh-purge` to the profile's
`dsh.profile.bundles`, but pnpm still needs the approval first.

DSH handles this: the install dialog reports the blocked build and offers to approve it
(`approvedBuilds`). If you approve there, nothing else is needed. If you install from a
terminal instead, add the key pnpm prints to the target profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-purge@https://codeload.github.com/YuJunZhiXue/dsh-purge/tar.gz/<commit>: true
```

`<commit>` is the commit the index pins, so the key changes with every release. The key pnpm
prints on the blocked attempt is the exact one to copy; the DSH UI shows the same key in its
`installFailureBuildBlockedManual` message.

From the command line:

```bash
dsh plugin --profile <profile> add \
  "git+https://github.com/YuJunZhiXue/dsh-purge.git#ac58b3e35509da23bd75b6250f01007590524102"
```

## Regenerating

`make-index.mjs` reads the upstream repository through the GitHub API, pins its newest commit,
and validates the result with the validator DSH itself ships
(`@deepseek-ai/dsh-plugin-market-index`). It refuses to write an invalid index.

```bash
npm install
node make-index.mjs --out index.json
```

Options: `--repo OWNER/NAME` (default `YuJunZhiXue/dsh-purge`), `--ref BRANCH`
(default `master`), `--no-write` to validate only.

`.github/workflows/update-index.yml` runs the same command every six hours and after a change
to the generator, so the index tracks upstream releases without manual work.

## Why this exists

Pointing the market at `https://github.com/YuJunZhiXue/dsh-purge` fails with:

```
Error: https://github.com/YuJunZhiXue/dsh-purge: $.format must be 1
```

GitHub answers the market's `Accept: application/json` request with HTTP 200 and the
repository page as JSON, so the fetch succeeds and the *validation* fails: the body has no
`format` field. A market index must be served as a JSON document at a URL that returns it
directly.
