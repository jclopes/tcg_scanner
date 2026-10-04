# Development Principles

Rules for changing this code, in priority order: when two conflict, follow the one listed first. An explicit instruction from the user overrides them.

## 1. Keep it simple
Simple means low complexity, not less code: minimize the concepts, states, branches and indirection a reader has to keep in mind.
- No options, flags, parameters, abstractions or extension points that no current use needs.
- Between two working approaches, pick the one with fewer moving parts (state, branches, layers, dependencies), even if it is longer.
- Prefer plain, direct code to clever or compact code; a little repetition beats an abstraction that is hard to follow.

## 2. Do only what was asked
Change what the request needs and nothing else.
- A small request gets the minimal inline edit: no new helpers, public interfaces, refactors or tests.
- Don't fix, rename or restyle unrelated code; mention it instead.
- Cleaning up what your change made unused is part of the change (rule 3).

## 3. Leave no orphans
Removing or replacing something also removes everything that only existed for it.
- Check styles, markup, configuration, constants, types, settings and stored-data fields, imports, comments and docs.
- Search the codebase for every removed name before you finish.

## 4. Explicit over implicit
Behavior should be visible where it happens.
- Spell out conditions instead of relying on implicit conversions (compare a count with zero rather than treating it as true or false).
- Declare mappings explicitly instead of deriving them by parsing names or strings at runtime.
- Functions that read state don't change it.
- Don't rely on call order or timing that the code doesn't enforce: pass the value in, or check it and fail.

## 5. Small, single-purpose functions
Each function does the one thing its name says.
- If describing it needs "and", split it. Keep computation apart from side effects (I/O, UI, storage, timers).
- Prefer parameters and return values over shared mutable state.
- Don't split for its own sake: a helper's name must say more than its body.

## 6. Idempotent where natural
Calling it twice must have the same effect as calling it once.
- This applies to rendering, setters, show/hide and start/stop operations, and event handlers.
- Prefer setting a target state ("set to on") to flipping it ("toggle").
- Cumulative actions (adding an item, incrementing a counter) are fine as they are.

## 7. Consistent: reuse before adding
Have one way to do each thing: the way the codebase already does it.
- Match the surrounding code's naming and structure. Before writing a helper, style or constant, look for an existing one and use it.
- Visual values come from one shared definition: colors always, sizes and spacing wherever an existing value fits.
- Merge duplicates only when the merged version needs no extra flags or parameters (rule 5), and not as a drive-by (rule 2).

## 8. Fail fast
A state that should be impossible must stop with an error; never hide it.
- Don't substitute a default, skip a missing value, ignore a caught error or return early to get past a case that shouldn't happen. Make the error say what was wrong.
- Validate untrusted data (files, stored data, user input, network responses) where it enters the system; trust it after that.
- Expected failures aren't bugs: a denied permission, invalid user input, an unavailable device or service, a saved setting that no longer applies. Handle them: tell the user, or fall back when the data is best-effort (such as saved preferences).

## 9. Tests: business logic only
Test what could break in a way that matters, nothing else.
- Test business rules, data parsing and validation, and tricky edge cases.
- Don't test trivial accessors, constants, pass-throughs, UI wiring or styling.
- Test public functions by inputs and outputs; don't assert on internals or mock our own code.
- Change tests together with the behavior they cover; never leave one failing.

## 10. Comments only where the code can't speak
Comment only when a reader would otherwise get it wrong.
- Explain why: platform quirks, external limits, non-obvious invariants, units.
- Never restate the code or narrate history ("was X, now Y").
- One or two lines; needing more usually means the code should be simpler.
