# Repo Time-lapse

Type any public GitHub repository and watch it grow from its first commit to today. Each dot is a file, each branch is a folder, and the colours are file types.

## Try it

Open `index.html` in a browser, type something like `expressjs/express`, and press **Watch**. Or press **try an example**, which plays a saved copy of Express's history without calling GitHub at all.

No build step, no dependencies, and no sign-in.

## How it works

Everything that isn't drawing lives in [`timelapse.js`](timelapse.js).

1. **Pick the moments.** A project can have thousands of commits, so the page takes ten spread evenly from the first to the latest.
2. **Fetch as little as possible.** GitHub allows only 60 requests an hour without signing in. Commits arrive 100 to a page, newest first; the first response says how many pages there are, and only the pages that hold a chosen moment are fetched. Each moment then costs one more request for its full file listing. A typical repository needs about 20 requests.
3. **Build one tree.** Every file that existed at any moment goes into a single tree, and each file remembers which moments it was present in. Positions are worked out once, so nothing jumps around as time moves: files only fade in and out.
4. **Lay it out in a circle.** The root sits in the middle, each folder gets a slice of the circle in proportion to how many files it holds, and each level of nesting is one ring further out.
5. **Animate.** Each frame, every dot eases towards shown or hidden and slides out from its folder as it appears.

If GitHub's limit is reached, the page says when to try again. Very large projects are capped at 4,000 files.

## Tests

```
node --test
```

The network code takes its `fetch` function as an argument, so the tests run it against a pretend GitHub: they check which commits get picked, that no page is fetched twice, and that "not found", "empty" and "rate limited" each produce a clear message.
