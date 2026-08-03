# Seira — Engineering Rules

These rules are non-negotiable. Violating any of them means the code
gets rejected and rewritten, not patched.

## No slop
- Never write a function that "looks correct" without verifying it against
  the actual type signatures in packages/core/src/types.ts. If a type is
  ambiguous, stop and ask — do not guess and move on.
- No placeholder logic disguised as real logic. If something isn't
  implemented yet, it must throw NotImplementedError("reason") — never
  return a fake/mocked value silently (e.g. never return 0.5; as a stand-in
  for a real reliability score).
- No catch blocks that swallow errors. Every catch must either handle the
  error meaningfully or rethrow with added context. Never catch (e) {}.
- No unused variables, unused imports, or dead code paths. If you write it,
  it's used, or it's deleted.
- No any type in TypeScript. If a type is genuinely unknown, define an
  explicit union or interface — any is a rejected PR.
- No magic numbers or strings. Constants get named and exported from a
  single source (e.g. WEIGHT_PRESETS, not 0.4 scattered in files).
- No duplicated logic across files. If the same 5+ lines appear twice,
  extract a shared function.

## Scope discipline
- Implement exactly what the task specifies — no extra features, no
  "while I'm here" additions, no speculative abstraction for cases that
  aren't in the current spec.
- Do not invent new fields on PaymentIntent, ExecutionPlan, or
  CapabilityEntry without explicit instruction. These are frozen contracts.
- Do not add new npm dependencies without flagging it first.

## Correctness over speed
- Every function that can fail (network call, contract call, parsing)
  must have explicit error handling, not just a try/catch pass-through.
- Every module must ship with unit tests covering: the happy path, at
  least one failure/edge case, and one boundary condition (empty input,
  zero amount, etc.). No module is "done" without tests.
- Never mark a task complete if tests are failing or missing.

## Style
- Consistent naming: camelCase for variables/functions, PascalCase for
  types/interfaces, no abbreviations unless already used in types.ts
  (e.g. use reliability, not rel).
- No console.log left in committed code — use a real logger or remove it.
- Every exported function gets a one-line JSDoc comment explaining intent,
  not restating the function signature.

## When unsure
If a task is ambiguous or underspecified, stop and ask a clarifying
question instead of guessing. A wrong assumption compounds across the
whole codebase — a 30-second question doesn't.

## Git workflow
- After completing every task, always stage, commit, and push automatically.
  Never leave completed work uncommitted.
- Commit messages follow Conventional Commits format:
  <type>: <short summary>, types are feat, fix, refactor, test, chore, docs.
  Example: feat: implement constraint-based route scoring in planner
- The summary line is under 72 characters, written in imperative mood
  ("add", not "added" or "adds").
- If the change is non-trivial, include a short body (2-4 bullet points)
  explaining what changed and why — not a restatement of the diff.
- Never commit with generic messages like "update", "changes", "fix stuff",
  or "wip". If you can't describe the change in one clear sentence, the
  task probably wasn't scoped tightly enough — say so instead of committing
  vaguely.
- Never commit failing tests or broken builds. Run tests before committing;
  if they fail, fix or report the failure instead of pushing broken code.
- One commit per logical unit of work — don't bundle unrelated changes
  (e.g. planner logic + unrelated config tweak) into a single commit.
