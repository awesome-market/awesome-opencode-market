#!/usr/bin/env python3
"""L0.5 prompt-injection scorer — local ModernBERT classifier.

Reads JSON array [{id, text}] on stdin, prints [{id, score}] on stdout.
Model dir comes from $GALVANIZE_DIR (required — the classifier's identity
stays in the operator's env, never in the published code: a named judge
invites targeted evasion). Threshold lives in thresholds.json (benign_max ≈
0.662): score ≥ threshold → injection signal.

transformers 4.57's AutoTokenizer chokes on this repo's backend:tokenizers
config — load tokenizers.Tokenizer directly, then torch the safetensors.

Windowed scoring: tokenizer.json bakes a 512-token RIGHT truncation, so a
naive encode silently drops everything past the first window — an injection
hiding at the end of a long SKILL.md scored as benign. We disable the baked
truncation, slice the full token stream into overlapping 512-token windows
(bos/eos re-wrapped per window), score every window, and report the MAX per
item. Per-item and global window budgets bound the worst case; when the
global budget runs out, later items simply get no score (the caller treats a
missing score as unscored — same as before).
"""
import json
import os
import sys

WIN = 512          # model context window (matches thresholds.json protocol)
STRIDE = 448       # 64-token overlap so boundary-spanning payloads still land inside a window
PER_ITEM_HEAD = 30  # windows kept from the head of an over-long item…
PER_ITEM_TAIL = 10  # …plus this many from the tail — end-of-file is the classic hiding spot
GLOBAL_BUDGET = 6000  # total windows per run; ~64/batch → ~95 forwards ≈ 2-3min on M-series CPU


def model_dir() -> str:
    d = os.environ.get("GALVANIZE_DIR")
    if not d or not os.path.isdir(d):
        sys.exit("GALVANIZE_DIR unset or missing — point it at the L0.5 classifier snapshot dir (source ai.env)")
    return d


def windows_for(ids, bos, eos):
    """Full token ids → list of model-ready windows ([bos]+content+[eos]).
    Empty content yields no windows — an empty file carries no signal."""
    content = WIN - 2
    if len(ids) <= content:
        spans = [ids]
    else:
        starts = list(range(0, len(ids) - content + 1, STRIDE))
        if starts[-1] != len(ids) - content:
            starts.append(len(ids) - content)  # tail-aligned final window
        spans = [ids[s:s + content] for s in starts]
    if len(spans) > PER_ITEM_HEAD + PER_ITEM_TAIL:
        spans = spans[:PER_ITEM_HEAD] + spans[-PER_ITEM_TAIL:]
    return [[bos] + s + [eos] for s in spans if s]


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
    tok.no_truncation()  # tokenizer.json bakes max_length=512 right-truncation — windowing needs the full stream
    model = AutoModelForSequenceClassification.from_pretrained(d)
    model.eval()

    # input protocol per thresholds.json: flattened whitespace. Encoding now
    # runs WITHOUT the baked truncation and WITHOUT special tokens — each
    # window re-wraps bos/eos itself so every window looks like a complete
    # sequence to the classifier.
    texts = [" ".join(str(i["text"]).split()) for i in items]
    encs = tok.encode_batch(texts, add_special_tokens=False)

    bos = tok.token_to_id("<bos>")
    eos = tok.token_to_id("<eos>")
    if bos is None or eos is None:
        sys.exit("L0.5 tokenizer lacks <bos>/<eos> — cannot window safely")
    plan = [windows_for(e.ids, bos, eos) for e in encs]

    # global budget in input order; the boundary item keeps a head+tail mix
    # so a mid-list file doesn't lose its tail coverage to the cap
    windows = []  # (item_index, ids)
    remaining = GLOBAL_BUDGET
    for idx, spans in enumerate(plan):
        if remaining <= 0:
            break
        if len(spans) <= remaining:
            chosen = spans
        else:
            h = (remaining * 3 + 3) // 4
            t = remaining - h
            chosen = spans[:h] + (spans[-t:] if t else [])
        for w in chosen:
            windows.append((idx, w))
        remaining -= len(chosen)

    if not windows:
        print("[]")
        return

    # chunked forward — one shot over the window list spikes activation
    # memory (N × 512 tokens through a ~500MB ModernBERT); ~64 rows per
    # forward caps the peak with identical per-window scores.
    B = 64
    n = max(len(w) for _, w in windows)
    ids = [w + [0] * (n - len(w)) for _, w in windows]
    masks = [[1] * len(w) + [0] * (n - len(w)) for _, w in windows]
    probs = []
    with torch.no_grad():
        for i in range(0, len(ids), B):
            out = model(
                input_ids=torch.tensor(ids[i:i + B]),
                attention_mask=torch.tensor(masks[i:i + B]),
            )
            probs.extend(torch.sigmoid(out.logits.float()).tolist())
    probs = [p[0] if len(p) == 1 else p[-1] for p in probs]

    best = {}
    for (idx, _), p in zip(windows, probs):
        if idx not in best or p > best[idx]:
            best[idx] = p
    print(json.dumps([
        {"id": items[idx]["id"], "score": best[idx]}
        for idx in sorted(best)
    ]))


if __name__ == "__main__":
    main()
