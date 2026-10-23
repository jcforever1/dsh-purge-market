#!/usr/bin/env node
/**
 * Generate the DSH plugin market index (format 1) for the dsh-purge bundle, straight from
 * the upstream GitHub repository, and validate it with the validator DSH itself ships.
 *
 *   node make-index.mjs [--repo OWNER/NAME] [--ref BRANCH] [--out FILE] [--no-write]
 *
 * Defaults: --repo YuJunZhiXue/dsh-purge --ref master --out ~/.dsh/market/dsh-purge/index.json
 *
 * The index pins the upstream commit, so an install is reproducible. Run this after every
 * upstream release, then the market server (or raw.githubusercontent) serves the new document.
 * The market caches a document for cacheTtlMs (10 min by default); the Discover tab's
 * refresh button bypasses the cache.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseMarketIndex, marketInstallTarget } from '@deepseek-ai/dsh-plugin-market-index';

const args = process.argv.slice(2);
const option = (name, fallback) => {
    const at = args.indexOf(`--${name}`);
    return at === -1 ? fallback : args[at + 1];
};
const repo = option('repo', 'YuJunZhiXue/dsh-purge');
const ref = option('ref', 'master');
const outFile = path.resolve(option('out', path.join(os.homedir(), '.dsh', 'market', 'dsh-purge', 'index.json')));
const dryRun = args.includes('--no-write');

const api = `https://api.github.com/repos/${repo}`;
const raw = `https://raw.githubusercontent.com/${repo}/${ref}`;

async function getJson(url) {
    const response = await fetch(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-market-index' } });
    if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
    return response.json();
}

console.log(`source: ${repo}@${ref}`);

// The newest commit on the ref: the index pins it, so every install lands on one exact tree.
const commit = await getJson(`${api}/commits/${ref}`);
const sha = commit.sha;
const publishTimestamp = Math.floor(new Date(commit.commit.committer.date).getTime() / 1000);
console.log(`commit: ${sha}  (${commit.commit.committer.date})`);

const manifest = await getJson(`${raw}/package.json`);
const name = manifest.name;
const version = manifest.version;
const description = manifest.description ?? name;

/** The market's git source needs a canonical https URL; npm's `git+https://….git` is not one. */
function canonicalGitUrl(value) {
    const url = value.replace(/^git\+/, '').replace(/\.git$/, '').replace(/#.*$/, '');
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error(`repository.url must be https: ${value}`);
    return parsed.href;
}
const repositoryUrl = canonicalGitUrl(manifest.repository?.url ?? `https://github.com/${repo}`);
const owner = new URL(repositoryUrl).pathname.split('/').filter(Boolean)[0] ?? 'unknown';
const author = (typeof manifest.author === 'string' ? manifest.author : manifest.author?.name) ?? owner;

/** A relative icon resolves against the index URL, so it breaks when the index moves hosts. Use an absolute https URL. */
let icon;
for (const candidate of ['docs/banner.svg', 'icon.svg', 'docs/icon.svg']) {
    const probe = await fetch(`${raw}/${candidate}`, { method: 'HEAD' });
    if (probe.ok) { icon = `${raw}/${candidate}`; break; }
}
if (icon === undefined) console.log('note: no icon found upstream; the entry will use the default artwork');

const dshRange = manifest.dshTarget ? `>=${manifest.dshTarget}` : undefined;

const index = {
    format: 1,
    title: name,
    description: { en: description, zh: description },
    metadata: {
        categories: { general: { title: { en: 'General', zh: '通用' } } },
        labels: {},
        sortKeys: {},
    },
    plugins: [
        {
            name,
            title: { en: name, zh: name },
            description: { en: description, zh: description },
            author,
            ...(icon === undefined ? {} : { icon }),
            homepage: manifest.homepage ?? repositoryUrl,
            repository: { url: repositoryUrl },
            metadata: {
                category: 'general',
                keywords: [...new Set(['dsh', 'plugin', ...(manifest.keywords ?? [])])].slice(0, 12),
                labels: [],
            },
            versions: [
                {
                    version,
                    publishTimestamp,
                    source: { type: 'git', url: repositoryUrl, commit: sha },
                    ...(dshRange === undefined ? {} : { engines: { dsh: dshRange } }),
                },
            ],
        },
    ],
};

// Validate with the validator DSH ships; refuse to emit an invalid index.
const validated = parseMarketIndex(index, 'https://raw.githubusercontent.com/OWNER/REPO/main/index.json');

if (!dryRun) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${JSON.stringify(index, null, 2)}\n`);
    console.log(`wrote ${outFile}`);
}
console.log(`  format   : ${validated.format}`);
console.log(`  plugin   : ${name} v${version}`);
console.log(`  icon     : ${icon ?? '(none)'}`);
console.log(`  install  : ${marketInstallTarget(name, validated.plugins[0].versions[0]).spec}`);
console.log(`  engines  : ${JSON.stringify(validated.plugins[0].versions[0].engines.dsh)}`);
console.log('  VALID against @deepseek-ai/dsh-plugin-market-index');
