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
import { execFileSync } from 'node:child_process';
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
const method = option('method', 'auto');

const api = `https://api.github.com/repos/${repo}`;
const raw = `https://raw.githubusercontent.com/${repo}/${ref}`;

async function getJson(url) {
    const headers = { accept: 'application/vnd.github+json', 'user-agent': 'dsh-market-index' };
    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    if (token !== undefined) headers.authorization = `Bearer ${token}`;
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
    return response.json();
}

/**
 * The newest commit on the ref: the index pins it, so every install lands on one exact tree.
 *
 * The GitHub API is rate limited per IP, and CI runners share addresses, so an unauthenticated
 * call can be refused with HTTP 403. A shallow clone needs no API and no token, so it is the
 * fallback that keeps this working everywhere. The clone directory is kept for the caller and
 * removed at the end.
 */
async function viaApi() {
    const commit = await getJson(`${api}/commits/${ref}`);
    return { sha: commit.sha, date: commit.commit.committer.date, via: 'api', dir: undefined };
}

function viaGit() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-market-index-'));
    try {
        execFileSync('git', ['clone', '--depth', '1', '--branch', ref, '--single-branch', '--quiet', `https://github.com/${repo}.git`, dir], { stdio: 'ignore' });
    } catch {
        // The ref may be a commit rather than a branch or tag.
        execFileSync('git', ['clone', '--depth', '1', '--quiet', `https://github.com/${repo}.git`, dir], { stdio: 'ignore' });
        execFileSync('git', ['-C', dir, 'fetch', '--depth', '1', '--quiet', 'origin', ref], { stdio: 'ignore' });
        execFileSync('git', ['-C', dir, 'checkout', '--quiet', 'FETCH_HEAD'], { stdio: 'ignore' });
    }
    const sha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const date = execFileSync('git', ['-C', dir, 'show', '-s', '--format=%cI', 'HEAD'], { encoding: 'utf8' }).trim();
    return { sha, date, via: 'git', dir };
}

async function resolveCommit() {
    if (method === 'git') return viaGit();
    if (method === 'api') return viaApi();
    try {
        return await viaApi();
    } catch (error) {
        console.log(`  api unavailable (${error.message}); falling back to a shallow clone`);
        return viaGit();
    }
}

console.log(`source: ${repo}@${ref}`);

const commit = await resolveCommit();
const sha = commit.sha;
const publishTimestamp = Math.floor(new Date(commit.date).getTime() / 1000);
console.log(`commit: ${sha}  (${commit.date}, via ${commit.via})`);

/** The package manifest: the raw file, or the clone the fallback already made. */
async function readManifest() {
    if (commit.dir !== undefined) {
        return JSON.parse(fs.readFileSync(path.join(commit.dir, 'package.json'), 'utf8'));
    }
    const response = await fetch(`${raw}/package.json`, { headers: { 'user-agent': 'dsh-market-index' } });
    if (!response.ok) throw new Error(`${raw}/package.json -> HTTP ${response.status}`);
    return response.json();
}

const manifest = await readManifest();
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

/**
 * A relative icon resolves against the index URL, so it breaks when the index moves hosts.
 * Use an absolute https URL, and look for the file in the clone when there is one.
 */
let icon;
for (const candidate of ['docs/banner.svg', 'icon.svg', 'docs/icon.svg']) {
    if (commit.dir !== undefined) {
        if (fs.existsSync(path.join(commit.dir, candidate))) { icon = `${raw}/${candidate}`; break; }
        continue;
    }
    const probe = await fetch(`${raw}/${candidate}`, { method: 'HEAD', headers: { 'user-agent': 'dsh-market-index' } });
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

if (commit.dir !== undefined) fs.rmSync(commit.dir, { recursive: true, force: true });
