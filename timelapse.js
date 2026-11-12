// Repo Time-lapse: fetches a handful of moments from a GitHub repository's history and
// lays every file out as a tree, so the page can animate the project growing.
// No DOM in here, so the same file runs in the browser and in Node for the tests.
'use strict';

const MAX_FILES = 4000; // more dots than this stop being readable, and slow phones start to struggle

// Accepts "owner/name" or any github.com link to the repository.
function parseRepo(text) {
  const m = /^(?:https?:\/\/(?:www\.)?github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[\/?#].*)?$/.exec(String(text).trim());
  // names made only of dots ("..") would climb out of the /repos/ part of the API address
  if (!m || /^\.+$/.test(m[1]) || /^\.+$/.test(m[2])) throw new Error('Type a repository like "owner/name", or paste its GitHub link.');
  return { owner: m[1], repo: m[2] };
}

// `count` positions spread evenly from the first commit (0) to the latest (total - 1).
function sampleIndexes(total, count) {
  const n = Math.min(total, count);
  if (n <= 1) return total ? [total - 1] : [];
  return Array.from({ length: n }, (_, i) => Math.round(i * (total - 1) / (n - 1)));
}

// Returns snapshots, oldest first: [{ sha, date, message, paths }].
// GitHub allows only 60 requests an hour without signing in, so this is careful with them:
// one request per page of commits it actually needs, plus one file listing per snapshot.
async function loadRepo(owner, repo, { fetchFn = fetch, samples = 10, onProgress = () => {} } = {}) {
  const api = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  async function get(url) {
    const res = await fetchFn(url, { headers: { Accept: 'application/vnd.github+json' } });
    if (res.status === 404) throw new Error("Can't find that repository. Private ones aren't supported.");
    if (res.status === 409) throw new Error('That repository is empty.');
    if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
      const reset = new Date(Number(res.headers.get('x-ratelimit-reset')) * 1000);
      const time = reset.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      throw new Error(`GitHub only allows 60 requests an hour without signing in. Try again after ${time}.`);
    }
    if (!res.ok) throw new Error(`GitHub answered with an error (${res.status}).`);
    return res;
  }

  // Commits come newest first, 100 to a page. The first response says which page is the last.
  const pages = new Map();
  const first = await get(`${api}/commits?per_page=100&page=1`);
  pages.set(1, await first.json());
  const lastPage = Number(/[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(first.headers.get('link') ?? '')?.[1] ?? 1);
  async function page(n) {
    if (!pages.has(n)) pages.set(n, await (await get(`${api}/commits?per_page=100&page=${n}`)).json());
    return pages.get(n);
  }
  const total = (lastPage - 1) * 100 + (await page(lastPage)).length;
  if (!total) throw new Error('That repository is empty.');

  const snapshots = [];
  const indexes = sampleIndexes(total, samples);
  for (const [done, index] of indexes.entries()) {
    onProgress(done + 1, indexes.length);
    const fromNewest = total - 1 - index;
    const commit = (await page(Math.floor(fromNewest / 100) + 1))[fromNewest % 100];
    const listing = await (await get(`${api}/git/trees/${commit.commit.tree.sha}?recursive=1`)).json();
    snapshots.push({
      sha: commit.sha.slice(0, 7),
      date: commit.commit.author.date,
      message: commit.commit.message.split('\n')[0],
      paths: listing.tree.filter((entry) => entry.type === 'blob').map((entry) => entry.path),
    });
  }
  return snapshots;
}

// One tree holding every file that existed in any snapshot. Each node remembers which
// snapshots it was present in, so nothing has to move when the animation changes moment.
function buildTree(snapshots) {
  const node = (name, isFile) => ({ name, isFile, children: new Map(), present: snapshots.map(() => false) });
  const root = node('', false);
  root.present.fill(true);
  let files = 0, capped = false;

  snapshots.forEach((snapshot, s) => {
    for (const path of snapshot.paths) {
      const parts = path.split('/');
      let at = root;
      for (const [i, part] of parts.entries()) {
        let child = at.children.get(part);
        if (!child) {
          const isFile = i === parts.length - 1;
          if (isFile && files >= MAX_FILES) {
            capped = true;
            break;
          }
          if (isFile) files++;
          child = node(part, isFile);
          at.children.set(part, child);
        }
        child.present[s] = true;
        at = child;
      }
    }
  });
  return { root, files, capped };
}

// Radial layout: the root sits in the middle, each folder gets a slice of the circle
// in proportion to how many files it holds, and each level is one ring further out.
// Returns a flat list, parents always before their children.
function layout(root, radius) {
  const countLeaves = (n) => (n.leaves = n.children.size ? [...n.children.values()].reduce((sum, c) => sum + countLeaves(c), 0) : 1);
  const depthBelow = (n) => 1 + Math.max(0, ...[...n.children.values()].map(depthBelow));
  countLeaves(root);
  const rings = Math.max(1, depthBelow(root) - 1);

  const placed = [];
  function place(n, depth, from, to, parent) {
    const angle = (from + to) / 2, r = depth / rings * radius;
    const dot = { name: n.name, isFile: n.isFile, present: n.present, depth, parent, x: r * Math.cos(angle), y: r * Math.sin(angle) };
    placed.push(dot);
    let start = from;
    for (const child of [...n.children.values()].sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const span = (to - from) * child.leaves / n.leaves;
      place(child, depth + 1, start, start + span, dot);
      start += span;
    }
  }
  place(root, 0, -Math.PI / 2, 1.5 * Math.PI, null);
  return placed;
}

if (typeof module !== 'undefined') module.exports = { parseRepo, sampleIndexes, loadRepo, buildTree, layout, MAX_FILES };
