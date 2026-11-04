# Sound Along pipeline limits

Every limit the pipeline or API runs into, where it is enforced, and which test covers it.
`scripts/test_limits.py` is the source of truth. If the code changes, update this table from the test results, not the other way round.

| Limit | Value | Enforced in | Behaviour at the limit | Test |
|---|---|---|---|---|
| Polly sync spoken characters | 3000 chars (characters, not bytes) | `etl/pipeline.py` `plan_parts`, `audio.SYNC_CHAR_CAP` | Up to the cap: one call per request. Over it (pipeline 0.4.0): split at paragraph/sentence boundaries into parts of at most 2800 spoken / 5600 total chars, joined into one track | `test_size_*`, `test_size_largest_single_request_input_is_the_cap` |
| Polly sync total input incl. SSML tags | 6000 chars | `pipeline.SYNC_TOTAL_CHAR_CAP` | Same: split into parts. Hit below 3000 spoken chars by many short sentences (7 tag chars per `<s>`) or XML-escaped `&`, `<` | `test_size_short_sentences_*`, `test_size_xml_escaping_*` |
| One sentence over the part cap | 2800 spoken / 5600 total chars with no sentence or paragraph boundary | `pipeline.PART_SPOKEN_CAP`, `PART_TOTAL_CAP` | `ValueError` ("part cap") before any Polly call, nothing written | `etl/tests/test_pipeline_stage2.py::test_one_sentence_over_part_cap_is_refused` |
| API raw text length | none (removed) | `lambda/text_to_speech_post/handler.py` | Any length is accepted and synthesized in parts. The real limit is time: 25 s Lambda timeout, ~29 s API Gateway cap. One track of a ~7,800-char passage takes ~9 s; `allVoices` doubles it. Use the cloud ETL for very long text | `test_api_text_over_sync_cap_is_201_in_parts` |
| Cloud ETL text length | No length limit | `lambda/etl_run/handler.py` | Long text is synthesized in parts; input the pipeline refuses (one sentence over the part cap) is moved to `failed/`. The longest UI passage is about 7900 chars | `lambda/tests/test_etl_run_limits.py` |
| Polly calls per passage | 2 per track (mp3 + marks); 2 tracks per language in `etl/voices.json` | `audio.synthesize_track` | ETL generates all tracks by default (4 calls); API only the default track unless `voiceId`/`allVoices` | `test_size_at_or_under_cap_*`, `test_api_all_voices_*` |
| Cost | $16 per 1M chars Neural, audio and marks billed separately | `pipeline.NEURAL_USD_PER_MCHAR` | about $0.096 per 3000-char passage per track | `test_size_billed_chars_*` |
| Throttling / Polly errors | No app-level retry; botocore default retries only | ETL runners catch and continue; API returns 502 | No partial passage is written (all tracks synthesized before any write) | `test_faults_polly_*`, `test_api_polly_throttle_*` |
| S3 / DynamoDB write failure | n/a | `pipeline.run` write order | Product JSON and DynamoDB record are written last, so no record points at missing audio. Earlier audio/timing objects may be left behind | `test_faults_storage_*`, `test_api_s3_failure_*` |
| DynamoDB item size | 400 KB | `storage.AwsStorage.put_record` | Worst case at the cap is far below (tested < 200 KB) | `test_capacity_dynamodb_*` |
| Lambda timeout | 25 s (HTTP API integration caps at ~29-30 s) | `infra/cdk/lib/api-stack.ts` | Pipeline CPU at the cap is well under 1 s; real Polly latency uses the rest. Only measurable live | `test_capacity_pipeline_cpu_*`, `load_test.py` |
| Lambda concurrency / API throttling | No reserved concurrency, no stage throttling | `api-stack.ts` | Account defaults apply; Polly TPS quota is the likely first limit | `load_test.py` only |
| Polly TPS quota | Account/region specific | AWS Service Quotas | Throttles surface as 502 `ThrottlingException` from the API | `load_test.py` only |

## Known gaps (xfail in the suite)

- **Empty or whitespace-only text in the ETL** is sent to Polly: 4 billed requests and a passage with 0 tokens. The API already rejects it with 400.

## Checking the Polly quota

```bash
aws service-quotas list-service-quotas --service-code polly --region us-west-2 \
  --query "Quotas[?contains(QuotaName, 'SynthesizeSpeech')].[QuotaName,Value]" --output table
```
