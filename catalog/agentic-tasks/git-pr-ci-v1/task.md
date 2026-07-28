# Task: implement `transfer_stock`, open a PR, get CI green, merge it

You have push access to a real GitHub repository:
`https://github.com/chrisjohnson/local-ai-machine-test`. It contains a
small Python library, `warehouse`, that tracks stock counts for SKUs
across named storage bins (see its `README.md` for the full API and
`warehouse/inventory.py` for the implementation). It has a real CI
workflow (GitHub Actions, `.github/workflows/ci.yml`) that runs the
test suite (`tests/test_inventory.py`) on every push and on every pull
request against `main`.

**Clone (or use your existing checkout of) that repository and work
inside it directly** — this is not a local scratch task, your changes
need to actually reach GitHub.

## What to do

1. Read `README.md`'s "Transfer semantics" section in full. It specifies
   the exact contract a `transfer_stock(sku, from_bin, to_bin, quantity)`
   method must follow. This method does not exist yet in
   `warehouse/inventory.py` — read the spec carefully, it calls out a
   specific failure-case trap that a naive implementation gets wrong.
2. Create a new branch (any name you like) off `main`.
3. Implement `transfer_stock` on `Inventory` in `warehouse/inventory.py`,
   matching the documented contract exactly.
4. Add test coverage for it in `tests/test_inventory.py` — at minimum,
   cover: a successful transfer, insufficient-stock-in-`from_bin`
   (and confirm no partial mutation happened), a non-positive quantity,
   and the same-bin no-op case. Run the test suite locally
   (`python3 -m unittest discover -s tests -v`) and confirm everything
   passes before you push.
5. Commit your changes, push your branch, and open a pull request
   against `main` (via the `gh` CLI or the GitHub API — whichever you
   have available).
6. Wait for the CI workflow to run on your pull request and make sure it
   passes. If it fails, look at why, fix it, push again, and wait again.
7. Once CI is green, merge the pull request into `main`.

## Constraints

- Do not modify `.github/workflows/ci.yml`.
- Do not modify the existing passing tests in `tests/test_inventory.py`
  (adding new test cases/methods is expected and required; changing what
  the existing ones assert is not).
- Do not disable, skip, or bypass CI in any way (no `[skip ci]`, no
  editing branch protection, no merging without CI having actually run
  and passed on your PR).
- Don't force-push over `main` directly or make any commits directly to
  `main` — all changes must go through the pull request you open.
- This is a small, clearly-scoped change. If you find yourself doing
  large unrelated refactors, you've gone further than the task requires.
