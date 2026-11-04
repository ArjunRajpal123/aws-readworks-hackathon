# ReadWorks Sound Along

Read-along audio for ReadWorks passages: human-like Polly narration, each word highlighted as it's spoken, and tap-to-replay from any word. English and Spanish.

| Folder | What |
| --- | --- |
| `etl/` | The pipeline: tokenizer, SSML, Polly synthesis, word timing, QA. Runs locally or in the cloud. |
| `lambda/` | Lambda handlers: cloud ETL (`etl_run`) and the text-to-speech API (`text_to_speech_post`, `text_to_speech_get`). All of them call `etl/pipeline.py`. |
| `frontend/` | Vue 3 player and admin screen. Deployed to EKS behind CloudFront. |
| `infra/cdk/` | AWS CDK app (all stacks). Start here to deploy: [`infra/cdk/README.md`](infra/cdk/README.md). |
| `docs/` | Vision, design spec (`SoundAlong-Kiro.md`), pipeline and audio notes, data contract (`baseref.txt`). |
| `.kiro/skills/` | Agent skills: `regression-test`, `etl-limit-test`, `ui-e2e-test`, `cost-estimate`. |

Quick checks:

```bash
.kiro/skills/regression-test/scripts/run_regression.sh      # offline, no AWS cost
.venv-etl/bin/python .kiro/skills/cost-estimate/scripts/estimate_cost.py
```
