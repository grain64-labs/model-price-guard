import os
from openai import OpenAI

client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=os.environ["OPENROUTER_API_KEY"])
MODEL = "openai/gpt-6.1-sol"  # support-ticket router


def route(text: str) -> str:
    r = client.chat.completions.create(model=MODEL, messages=[{"role": "user", "content": text}])
    return r.choices[0].message.content
