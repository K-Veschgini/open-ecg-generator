#!/usr/bin/env node

/**
 * GitHub Pages deployment script.
 *
 * Builds the app and publishes packages/app/dist to the `gh-pages` branch of
 * the `origin` remote. Publishing happens in a throwaway git repository in the
 * OS temp directory, so this script never switches branches and never deletes
 * or modifies anything in your working tree (apart from the build output).
 *
 * Usage:
 *   npm run deploy                 # build + publish
 *   npm run deploy -- --dry-run    # build + prepare commit, but do not push
 *   npm run deploy -- --skip-build # publish the existing packages/app/dist
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(ROOT, 'packages', 'app', 'dist');
const BRANCH = 'gh-pages';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const SKIP_BUILD = args.has('--skip-build');

for (const arg of args) {
  if (!['--dry-run', '--skip-build'].includes(arg)) {
    console.error(`Unknown argument: ${arg}\nUsage: node deploy-gh-pages.js [--dry-run] [--skip-build]`);
    process.exit(2);
  }
}

/** Strip userinfo (user:token@) from any URLs in a string so credentials never reach logs. */
function redact(text) {
  return String(text).replace(/([a-z][a-z0-9+.-]*:\/\/)[^@/\s]+@/gi, '$1');
}

/** Run a command; throw on spawn error or non-zero exit. Returns trimmed stdout when capture=true. */
function run(cmd, cmdArgs, { cwd = ROOT, capture = false, allowFail = false } = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    shell: process.platform === 'win32' && cmd === 'npm',
  });
  if (result.error) {
    throw new Error(redact(`Failed to run "${cmd} ${cmdArgs.join(' ')}": ${result.error.message}`));
  }
  if (result.status !== 0) {
    if (allowFail) return null;
    const detail = capture && result.stderr ? `\n${result.stderr.trim()}` : '';
    throw new Error(redact(`"${cmd} ${cmdArgs.join(' ')}" exited with code ${result.status}${detail}`));
  }
  return capture ? result.stdout.trim() : '';
}

/** Resolve the origin URL; relative local paths are resolved against the repo root. */
function getOriginUrl() {
  const url = run('git', ['remote', 'get-url', 'origin'], { capture: true, allowFail: true });
  if (!url) {
    throw new Error('No "origin" remote configured; cannot determine where to publish.');
  }
  const looksRemote = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) || /^[^/\\]+@[^:]+:/.test(url);
  if (!looksRemote && !isAbsolute(url) && existsSync(resolve(ROOT, url))) {
    return resolve(ROOT, url);
  }
  return url;
}

/** Derive https://<owner>.github.io/<repo>/ from a GitHub remote URL, or null. */
function getPagesUrl(remoteUrl) {
  const match = remoteUrl.match(/github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (!match) return null;
  const owner = match[1];
  const repo = match[2];
  const host = `${owner.toLowerCase()}.github.io`;
  return repo.toLowerCase() === host ? `https://${host}/` : `https://${host}/${repo}/`;
}

/** Commit identity for the temp repo: reuse the project's git config, fall back to a generic one. */
function getIdentity() {
  const name = run('git', ['config', 'user.name'], { capture: true, allowFail: true }) || 'gh-pages deploy';
  const email =
    run('git', ['config', 'user.email'], { capture: true, allowFail: true }) || 'gh-pages-deploy@users.noreply.github.com';
  return { name, email };
}

function main() {
  console.log(`Starting GitHub Pages deployment${DRY_RUN ? ' (dry run, nothing will be pushed)' : ''}...\n`);

  const originUrl = getOriginUrl();
  const pagesUrl = getPagesUrl(originUrl);
  const sourceSha = run('git', ['rev-parse', '--short', 'HEAD'], { capture: true, allowFail: true }) || 'unknown';
  const dirty = run('git', ['status', '--porcelain'], { capture: true, allowFail: true });

  // Step 1: build (core first, then app, via the root "build" script).
  if (SKIP_BUILD) {
    console.log('Skipping build (--skip-build); using existing packages/app/dist\n');
  } else {
    console.log('Building production version...');
    run('npm', ['run', 'build']);
    console.log('Build completed\n');
  }

  if (!existsSync(DIST_DIR) || !statSync(DIST_DIR).isDirectory() || readdirSync(DIST_DIR).length === 0) {
    throw new Error(`Build output not found or empty: ${DIST_DIR}`);
  }

  // Step 2: assemble the site in a separate temporary repository.
  const tempDir = mkdtempSync(join(tmpdir(), 'open-ecg-gh-pages-'));
  try {
    console.log(`Preparing ${BRANCH} commit in ${tempDir}`);
    cpSync(DIST_DIR, tempDir, { recursive: true });
    writeFileSync(join(tempDir, '.nojekyll'), '');

    const { name, email } = getIdentity();
    const git = (gitArgs, opts = {}) => run('git', gitArgs, { cwd: tempDir, ...opts });

    git(['init', '--quiet']);
    git(['checkout', '--quiet', '-b', BRANCH]);
    git(['config', 'user.name', name]);
    git(['config', 'user.email', email]);
    git(['config', 'commit.gpgsign', 'false']);
    git(['add', '--all']);
    const message = `Deploy to GitHub Pages from ${sourceSha}${dirty ? ' (with uncommitted changes)' : ''}`;
    git(['commit', '--quiet', '-m', message]);
    console.log('Files in commit:');
    console.log(git(['ls-files'], { capture: true }).replace(/^/gm, '  '));

    // Step 3: force-push to origin's gh-pages branch.
    if (DRY_RUN) {
      console.log(`\nDry run: would force-push to ${BRANCH} on ${redact(originUrl)}`);
    } else {
      console.log(`\nPushing to ${BRANCH} on ${redact(originUrl)}...`);
      git(['push', '--force', originUrl, `HEAD:refs/heads/${BRANCH}`]);
      console.log('\nDeployment successful!');
    }

    if (pagesUrl) {
      console.log(`\nSite URL: ${pagesUrl}`);
    } else {
      console.log('\nOrigin is not a GitHub remote; could not derive the Pages URL.');
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`\nDeployment failed: ${redact(error.message)}`);
  process.exit(1);
}
