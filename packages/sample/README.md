# @meetless/sample

The UI prototype's two projects (the paper and Atlas, `design/claude-design-v3/needs*/data-*.js`) as real core commands, labelled 「样例数据」 in the app.

- `loadPrototype(repoRoot)` runs the prototype data files in `node:vm`.
- `buildSample(data, { locale, me, today })` returns the commands (`SampleAction[]`), with ids `sample:<n>` in build order (users are `register:<id>`).
- `sampleState(opts)` replays them through the core (tests and fixtures). `replayActions` does the same on top of any state.
- The server loads them with `loadSample` (`MEETLESS_SAMPLE=zh-CN|en`, `MEETLESS_SAMPLE_ME`).

Dates shift so that the prototype's today (2026-11-24) is the real today. Every string goes through `noDots` in the chosen language.

## Rules the builder applies

The prototype data leaves these open; the builder decides them as follows.

- **Who did a piece of work**, in this order:
  1. its `by`;
  2. the author (`by`) of the hypothesis it is linked to;
  3. a member named at the start of its text ("Ben: …", "周屿：…");
  4. otherwise `me`.
- **Agent client.** Agent-reported work is `via codex` when its text mentions Codex, otherwise `claude-code`. A handoff's context fetch uses the recipient's own agent client in that project.
- **Who an input is from.** The core takes a need's requester from the input it came from. So an input whose accepted extracts create needs is "from" the most frequent author of those needs (the first on a tie). Any other input keeps its prototype `from`.
  - Known mismatch: the paper's 组会 #2 minutes yield N4 and N5 (Prof. Zhang) and N7 (Mia), so N7's requester is Prof. Zhang.
- **Dedupe.** Accepting an extract records its own work item, and for a revision its own revision. So the builder skips prototype work with `ef: extract` (or `ef: revise`) when an input of the same day has an accepted new/hyp (or rev) extract for the same need. It skips a need revision in the same case too.
  - Examples: paper w13, w14, w16 and w18; Atlas w1; and paper N4's revision, which is made once through IN3.
- **Conflicts.** A `rev` extract is flagged as a conflict when a collab question names a conflict on the same need from an input with the same title (Atlas IN3 x1 on N1).
- **Acceptance text.** Extracts that create a need carry the target need's accept/expect/verify when the extract has none.

- **Stale questions (none).** With today 2026-11-24 the core rules give no stale question to anyone. The paper's H5 (Q3 in the prototype) is `parked`, as in the prototype, and a parked hypothesis is not stale. The stalest open external need, paper N5 (idle 14 days, round due in 7), is held by Prof. Zhang's open handoff HO2 to Alex, so it is not asked either. Other open needs are `doing`/`testing`, or idle fewer than 10 days. The builder keeps the prototype's data, so the sample has no stale-question demo; Alex's one question in the paper is the unlinked temperature commit.

Not loaded: prototype questions (the core rules produce them), canned answers, FAQ, suggestions, summaries, the agent log, metrics, and document pages.
