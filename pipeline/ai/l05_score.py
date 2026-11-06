#!/usr/bin/env python3
"""L0.5 prompt-injection scorer — Galvanize-2 (ModernBERT classifier).

Reads JSON array [{id, text}] on stdin, prints [{id, score}] on stdout.
Model resolves from $GALVANIZE_DIR or the HF cache ($HF_HOME or
~/.cache/huggingface). Threshold lives in thresholds.json (benign_max ≈
0.662): score ≥ threshold → injection signal.

transformers 4.57's AutoTokenizer chokes on this repo's backend:tokenizers
config — load tokenizers.Tokenizer directly, then torch the safetensors.
"""
import json
import os
import sys
import glob


def model_dir() -> str:
    d = os.environ.get("GALVANIZE_DIR")
    if d:
        return d
    hf = os.environ.get("HF_HOME") or os.path.expanduser("~/.cache/huggingface")
    snaps = glob.glob(os.path.join(hf, "hub", "models--usezn--Galvanize-2", "snapshots", "*"))
    if not snaps:
        sys.exit("Galvanize-2 not found — set GALVANIZE_DIR or HF_HOME")
    return snaps[0]


def main() -> None:
    items = json.load(sys.stdin)
    if not items:
        print("[]")
        return
    d = model_dir()
    from tokenizers import Tokenizer
    import torch
    from transformers import AutoModelForSequenceClassification

    tok = Tokenizer.from_file(os.path.join(d, "tokenizer.json"))
    model = AutoModelForSequenceClassification.from_pretrained(d)
    model.eval()

    # input protocol per thresholds.json: flattened whitespace, first 512 tokens
    texts = [" ".join(str(i["text"]).split()) for i in items]
    enc = tok.encode_batch(texts)
    ids = [e.ids[:512] for e in enc]
    masks = [e.attention_mask[:512] for e in enc]
    n = max(len(x) for x in ids)
    ids = [x + [0] * (n - len(x)) for x in ids]
    masks = [x + [0] * (n - len(x)) for x in masks]

    # chunked forward — one shot over hundreds of padded blocks spikes
    # activation memory (N × 512 tokens through a ~500MB ModernBERT). The
    # padded ids/masks are tiny ints; chunking caps the peak at ~64 rows
    # worth of activations with identical per-row scores.
    B = 64
    scores = []
    with torch.no_grad():
        for i in range(0, len(ids), B):
            out = model(
                input_ids=torch.tensor(ids[i:i + B]),
                attention_mask=torch.tensor(masks[i:i + B]),
            )
            scores.extend(torch.sigmoid(out.logits.float()).tolist())
    scores = [p[0] if len(p) == 1 else p[-1] for p in scores]
    print(json.dumps([{"id": i["id"], "score": s} for i, s in zip(items, scores)]))


if __name__ == "__main__":
    main()
