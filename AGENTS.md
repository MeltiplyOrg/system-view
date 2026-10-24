# AGENTS.md

Universal rules for every change in this repository.

## Commits

Use Conventional Commits for every commit:

```text
<type>[optional scope]: <subject>

<body>

[optional footer]
```

- **type**: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`, `style`, or `revert`.
- **scope**: the affected area when it adds information; omit it for repo-wide changes.
- **subject**: state the outcome in the imperative mood, aim for 72 characters or fewer, and leave off the trailing period.
- **body**: required. Explain why the change exists, what changed, the approach and trade-offs, and anything a reviewer needs. Wrap at 72 columns.
- **footer**: reference issues (`Refs: #123`, `Closes: #123`). Mark a breaking change with `!` after the type/scope and a `BREAKING CHANGE:` footer that states the migration.
- Re-read the staged diff before committing; the subject and body describe what is actually staged.

## Comments

Write comments for the next editor who will refactor, optimize, or port this code. Every function, method, class, and non-obvious block documents its contract and the reasoning the code cannot carry.

- Use the language's doc-comment syntax. Document purpose, inputs and valid ranges, return value, errors, side effects, invariants, ownership, and concurrency rules.
- Record the approach and main point: why this shape, which alternative was rejected when the choice was non-obvious, and what must remain true. Explain units, magic numbers, external constraints, and non-obvious branches.
- Place each inline comment beside the code it explains. Update the comment in the same change that changes the behavior; a stale comment is a defect.
- State the behavior a caller can rely on, including ordering, idempotency, and failure semantics.
- Spend each comment on what the code cannot say: intent, constraints, and consequences.

## Code

Write the smallest design that meets today's requirements and stays easy to change.

- **YAGNI:** implement current requirements. Add abstractions, parameters, hooks, and extension points when a current caller needs them.
- **KISS:** choose the simplest correct implementation. Prefer clear control flow, small cohesive functions, and explicit data flow.
- **DRY:** keep one source of truth for each behavior. Before writing new code, search for an existing helper, type, component, or pattern; reuse it or extend its canonical owner.
- Extract shared logic when two or more current callers need the same behavior. Share behavior, not accidental similarity: couple modules only when they share semantics and ownership.
- Remove dead, commented-out, debug, and unused code in the change that makes it obsolete.
- Keep each diff focused on one purpose. Put unrelated cleanup and refactors in their own commit.
- When a concrete requirement conflicts with a rule, follow the requirement and record why in the comment or commit body.
