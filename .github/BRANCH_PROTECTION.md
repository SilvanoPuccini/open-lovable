# Branch Protection Setup

To require CI checks before merging PRs, configure these settings in GitHub:

## Steps

1. Go to **Settings > Branches** in your repository
2. Click **Add branch ruleset** (or edit existing)
3. Set **Branch name pattern** to `main`
4. Enable **Require status checks to pass before merging**
5. Add these **required status checks**:
   - `Lint & Type Check`
   - `Tests`
   - `Build`
6. Enable **Require branches to be up to date before merging**
7. Save changes

## What each check does

| Check | What it verifies |
|-------|-----------------|
| **Lint & Type Check** | ESLint rules pass + TypeScript compiles with zero errors |
| **Tests** | All Vitest tests pass (security tests + component tests) |
| **Build** | `next build` succeeds (production-ready) |

The **Build** job only runs after Lint and Tests pass (dependency chain).
