# HF Zero-Shot mDeBERTa Service

This service exposes `MoritzLaurer/mDeBERTa-v3-base-mnli-xnli` behind the
`hf_zero_shot_classification` request/response schema already used by AITO.

## API

`POST /classify`

Request:

```json
{
  "inputs": "请帮我看看 BIG-IP 配置问题",
  "parameters": {
    "candidate_labels": ["chat", "f5", "bad", "unknown"],
    "hypothesis_template": "This text is about {}.",
    "multi_label": false
  }
}
```

Response:

```json
{
  "sequence": "请帮我看看 BIG-IP 配置问题",
  "labels": ["f5", "chat", "unknown", "bad"],
  "scores": [0.91, 0.06, 0.02, 0.01],
  "model": "MoritzLaurer/mDeBERTa-v3-base-mnli-xnli",
  "elapsed_ms": 148.27
}
```

## AITO settings

- `classifier_type`: `classifier_nli`
- `schema_family`: `hf_zero_shot_classification`
- `endpoint_url`: `http://10.1.1.9:18081/classify`
- `api_key`: `hf-zero-shot-demo-token`

## Deploy to current UDF Linux host

```bash
cd /Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo\ test/ltm-semantic-routing/classifier-services/hf-zero-shot-mdeberta
chmod +x deploy_to_udf_linux.sh
./deploy_to_udf_linux.sh
```
