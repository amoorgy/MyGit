"""
MLX inference worker — JSON-lines protocol on stdin/stdout.

Started by ouro-server.ts. Not intended to be run directly.

Protocol:
  stdin  ← {"id":"<str>","messages":[...],"max_tokens":<int>}
  stdout → {"id":"<str>","response":"<str>"}        (success)
           {"id":"<str>","error":"<str>"}           (failure)
  stdout → {"ready":true,"model":"<str>"}           (on load)
"""

import warnings, os, sys, json

# Suppress all Python warnings and transformers/tqdm noise before any imports
warnings.filterwarnings("ignore")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")

model_id = sys.argv[1] if len(sys.argv) > 1 else "mlx-community/Ouro-2.6B-4bit"

print(f"[worker] Loading {model_id}...", file=sys.stderr, flush=True)

from mlx_lm import load, generate
import transformers
transformers.logging.set_verbosity_error()

model, tokenizer = load(model_id, tokenizer_config={"trust_remote_code": True})

# Signal ready to parent process
print(json.dumps({"ready": True, "model": model_id}), flush=True)

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    req_id = ""
    try:
        req = json.loads(line)
        req_id = req.get("id", "")
        messages = req.get("messages", [])
        max_tokens = req.get("max_tokens", 256)

        if tokenizer.chat_template:
            prompt = tokenizer.apply_chat_template(messages, add_generation_prompt=True)
        else:
            parts = [f"{m['role'].capitalize()}: {m['content']}" for m in messages]
            prompt = "\n".join(parts) + "\nAssistant:"

        response = generate(model, tokenizer, prompt=prompt, max_tokens=max_tokens, verbose=False)
        print(json.dumps({"id": req_id, "response": response}), flush=True)
    except Exception as e:
        print(json.dumps({"id": req_id, "error": str(e)}), flush=True)
