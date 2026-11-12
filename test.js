// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRepo, sampleIndexes, loadRepo, buildTree, layout, MAX_FILES } = require('./timelapse.js');

test('parseRepo accepts names and links, and rejects anything else', () => {
  const expected = { owner: 'expressjs', repo: 'express' };
  for (const text of ['expressjs/express', ' expressjs/express ', 'https://github.com/expressjs/express',
    'https://github.com/expressjs/express/', 'https://www.github.com/expressjs/express/tree/master/lib',
    'https://github.com/expressjs/express.git', 'expressjs/express?tab=readme']) {
    assert.deepEqual(parseRepo(text), expected, text);
  }
  assert.deepEqual(parseRepo('me/my.repo-1'), { owner: 'me', repo: 'my.repo-1' });
  for (const text of ['', 'express', 'https://example.com/a/b', 'a b/c', '../etc/passwd']) {
    assert.throws(() => parseRepo(text), /owner\/name/, text);
  }
});

test('sampleIndexes spreads evenly and always includes the first and latest commit', () => {
  assert.deepEqual(sampleIndexes(0, 10), []);
  assert.deepEqual(sampleIndexes(1, 10), [0]);
  assert.deepEqual(sampleIndexes(3, 10), [0, 1, 2]);
  assert.deepEqual(sampleIndexes(101, 5), [0, 25, 50, 75, 100]);
  assert.deepEqual(sampleIndexes(250, 1), [249]);
});

test('buildTree records when each file existed, and layout keeps everything inside the circle', () => {
  const { root, files, capped } = buildTree([
    { paths: ['README.md'] },
    { paths: ['README.md', 'src/main.js'] },
    { paths: ['src/main.js', 'src/lib/util.js'] },
  ]);
  assert.equal(files, 3);
  assert.equal(capped, false);
  assert.deepEqual(root.children.get('README.md').present, [true, true, false]);
  assert.deepEqual(root.children.get('src').present, [false, true, true]);
  assert.deepEqual(root.children.get('src').children.get('lib').children.get('util.js').present, [false, false, true]);

  const dots = layout(root, 100);
  assert.equal(dots.length, 6); // root, README.md, src, main.js, lib, util.js
  assert.deepEqual([dots[0].x, dots[0].y, dots[0].parent], [0, 0, null]);
  for (const dot of dots.slice(1)) {
    assert.ok(dots.indexOf(dot.parent) < dots.indexOf(dot), 'parents come first');
    assert.ok(Math.hypot(dot.x, dot.y) <= 100 + 1e-9);
  }
  const deepest = dots.find((d) => d.name === 'util.js');
  assert.ok(Math.abs(Math.hypot(deepest.x, deepest.y) - 100) < 1e-9, 'the deepest file sits on the outer ring');
});

test('buildTree stops adding files past the cap', () => {
  const paths = Array.from({ length: MAX_FILES + 50 }, (_, i) => `f${i}.txt`);
  const { files, capped } = buildTree([{ paths }]);
  assert.equal(files, MAX_FILES);
  assert.equal(capped, true);
});

// A pretend GitHub with `total` commits, newest first, where commit n's tree lists n files.
function fakeGitHub(total, calls = []) {
  const response = (status, body, headers = {}) => ({ status, ok: status < 400, headers: { get: (k) => headers[k] ?? null }, json: async () => body });
  return async (url) => {
    calls.push(url);
    const tree = /\/git\/trees\/tree(\d+)\?recursive=1$/.exec(url);
    if (tree) {
      const files = Array.from({ length: Number(tree[1]) }, (_, i) => ({ type: 'blob', path: `file${i}.js` }));
      return response(200, { tree: [{ type: 'tree', path: 'dir' }, ...files] });
    }
    const page = Number(/[?&]page=(\d+)/.exec(url)[1]);
    const lastPage = Math.max(1, Math.ceil(total / 100));
    const commits = [];
    for (let fromNewest = (page - 1) * 100; fromNewest < Math.min(page * 100, total); fromNewest++) {
      const n = total - fromNewest; // 1 is the first commit ever
      commits.push({ sha: `sha${n}abcdefgh`, commit: { tree: { sha: `tree${n}` }, author: { date: `2020-01-01T00:00:${n % 60}Z` }, message: `commit ${n}\n\nlong text` } });
    }
    const link = lastPage > 1 ? `<https://api.github.com/x?per_page=100&page=2>; rel="next", <https://api.github.com/x?per_page=100&page=${lastPage}>; rel="last"` : null;
    return response(200, commits, { link });
  };
}

test('loadRepo samples from first commit to latest and only fetches the pages it needs', async () => {
  const calls = [];
  const progress = [];
  const snapshots = await loadRepo('o', 'r', { fetchFn: fakeGitHub(250, calls), samples: 3, onProgress: (...p) => progress.push(p) });
  assert.deepEqual(snapshots.map((s) => s.message), ['commit 1', 'commit 126', 'commit 250']);
  assert.deepEqual(snapshots.map((s) => s.paths.length), [1, 126, 250]); // folders are left out
  assert.equal(snapshots[0].sha, 'sha1abc');
  assert.deepEqual(progress, [[1, 3], [2, 3], [3, 3]]);
  assert.equal(calls.filter((u) => u.includes('/commits?')).length, 3, 'three pages of commits, each fetched once');
  assert.equal(calls.length, 6);

  const small = await loadRepo('o', 'r', { fetchFn: fakeGitHub(4), samples: 10 });
  assert.deepEqual(small.map((s) => s.message), ['commit 1', 'commit 2', 'commit 3', 'commit 4']);
});

test('loadRepo turns GitHub errors into messages a person can act on', async () => {
  const failing = (status, headers = {}) => async () => ({ status, ok: false, headers: { get: (k) => headers[k] ?? null }, json: async () => ({}) });
  await assert.rejects(loadRepo('o', 'r', { fetchFn: failing(404) }), /Can't find that repository/);
  await assert.rejects(loadRepo('o', 'r', { fetchFn: failing(409) }), /empty/);
  await assert.rejects(loadRepo('o', 'r', { fetchFn: failing(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' }) }), /60 requests an hour/);
  await assert.rejects(loadRepo('o', 'r', { fetchFn: failing(500) }), /error \(500\)/);
  await assert.rejects(loadRepo('o', 'r', { fetchFn: fakeGitHub(0) }), /empty/);
});
