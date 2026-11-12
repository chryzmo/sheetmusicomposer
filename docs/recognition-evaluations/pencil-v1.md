# Pencil v1: first frozen session evaluation

## Protocol

The classifier, policy, adapter, dependency manifest/lockfile, runner, and data hashes were frozen in commit **`558fa7db84514e30309e9990dcb6915b5a4855b5`**, before the first recognition run on `Pencil-eval-1`. See [`frozen-pencil-v1.ts`](../../tests/evaluation/frozen-pencil-v1.ts). No predictor, thresholds, templates, or frozen hashes were changed after observing the results below.

- Templates: all 15 supported primitive annotations from `Pencil-dev-1`; no synthetic seeds and no evaluation examples.
- Queries: all 20 annotated groups in the separately designated evaluation export: five filled heads, five hollow heads, five stems, five unknowns.
- Grouping: supplied by manual annotations, not inferred by the app.
- Policy: unchanged 1.5 weighted-distance ceiling; development-informed 0.1 top-two margin; staff-space bounds and covariance-based stem linearity. See [recognition design](../recognition.md).
- Environment: Node.js 24.18.0 on Linux, not Safari/iPad execution.
- The development recording and existing regression cases informed model choices. The evaluation recording had only schema/annotation/integrity/source-overlap checks before the source freeze; no prior recognition scores or calibration use.

The committed [machine-readable result](pencil-v1.json) records the first run's source commit, counts, and all 20 decisions, including distances, margins, linearity, and nearest-label geometry failures. It is documentation, not a fixture/backup import format.

## Results

| Expected primitive | Examples | Correctly accepted | Kept as unknown | Wrong accepted labels |
| --- | ---: | ---: | ---: | ---: |
| Filled head | 5 | 2 | 3 | 0 |
| Hollow head | 5 | 4 | 1 | 0 |
| Stem | 5 | 4 | 1 | 0 |
| Unknown mark | 5 | N/A | 5 (correct rejection) | 0 |

- **Known-symbol coverage: 10/15 correctly accepted; 5/15 rejected.**
- Unknown rejection: **5/5**, with no unknown marks accepted as known labels.
- Overall exact label/rejection agreement: **15/20**, including the five correct unknown rejections.
- Accepted groups: **10/20**, with **0 wrong labels among these ten accepts**. This small observation is not a guarantee of general safety or perfect precision.

Four known symbols fail the margin gate: three filled heads and one hollow head. Two of those nearest-label rankings are actually wrong (annotations 5 and 8), so rejection prevents those mislabels. One stem (annotation 14) fails the aspect gate and is also farther from its nearest template than the distance cutoff. No threshold was adjusted to accept these failures.

There is no pre-change independent evaluation score to compare against: **before N/A, first frozen result as above**. Do not present the development leave-one-group-out improvement (0/15 → 13/15) as a held-out improvement. They are different protocols.

## Interpretation and limitations

This is an encouraging but limited **single-user, small-session, oracle-grouped primitive evaluation**. The nominal 15/20 agreement depends on the deliberately chosen 15-known/5-unknown mix and is not an estimate of general handwriting accuracy. The unknown examples are only five marks, not a comprehensive unsupported-symbol, scribble-gesture, or false-acceptance benchmark. Recorded ink and disjoint IDs/exact point arrays do not independently prove session separation or writer diversity.

Filled-versus-hollow coverage is still weak. The wider stem allowance also cannot distinguish a stem from every line-shaped symbol, or a retraced stem from a straight scribble/delete gesture without context. Keep uncertainty as original ink, do not call distances or covariance ratios probabilities, and do not enable automatic canvas replacement based on this experiment alone.

No automatic grouping, pitch/duration decisions, note assembly, storage migration, rendering, undo integration, native Pencil behavior, Safari classifier behavior, or actual iPad latency was tested here. The evaluation template bank remains development infrastructure; it is not bundled as a new runtime personal-template bank. The app still does not convert canvas ink to notes.

## Reproduction and future use

At the frozen commit or a descendant with identical pinned sources/data/dependencies:

```sh
npm ci
npm run test:recognition-eval
```

Later assembly work adds settings to shared `src/config.ts` and an assignment to `tests/fixtures/roles.ts`. Both files are pinned, so the v1 guard deliberately rejects that newer checkout even though primitive policy values and the recorded first-run result are unchanged. Replay in a separate frozen worktree instead of refreshing hashes:

```sh
git worktree add --detach ../sheetmusicomposer-pencil-v1 558fa7d
cd ../sheetmusicomposer-pencil-v1
npm ci
npm run test:recognition-eval
```

The command is opt-in, separate from ordinary unit/fixture tests and CI. Source/data hash mismatches stop classification. If current code has evolved, use a separate worktree at the frozen commit rather than changing the stored hashes. The runner checks protocol integrity, not an accuracy target chosen after seeing the outcome; a passing test does not mean every symbol was recognized.

This evaluation has now been **observed**, not left unseen for future tuning. Exact replays reproduce this result; they are not additional independent trials. If these failures are used to select or tune a later model, this collection is validation/development evidence for that process, and fresh held-out input is needed for a new independent accuracy claim. Do not silently add its samples as templates or calibration negatives.

Next proceed with conservative grouping/assembly and validated event commands/persistence before VexFlow integration, while preserving unknown ink and explicitly choosing a reviewed runtime template bank. Further classifier work should be designed and checked using development data; integration still needs real-iPad acceptance.
