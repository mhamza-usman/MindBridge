import os
from langchain_openai import ChatOpenAI

def build_chat_model(**kwargs):
    openrouter_api_key = os.getenv("OPENROUTER_API_KEY")
    base_url = "https://openrouter.ai/api/v1"

    free_models = [
        "google/gemini-2.5-flash:free",
        "mistralai/mistral-nemo:free",
        "meta-llama/llama-3.1-8b-instruct:free",
    ]

    primary_model = ChatOpenAI(
        model=free_models[0],
        api_key=openrouter_api_key,
        base_url=base_url,
        model_kwargs={"parallel_tool_calls": False},
        **kwargs,
    )

    fallbacks = [
        ChatOpenAI(
            model=model_name,
            api_key=openrouter_api_key,
            base_url=base_url,
            model_kwargs={"parallel_tool_calls": False},
            **kwargs,
        )
        for model_name in free_models[1:]
    ]

    return primary_model.with_fallbacks(fallbacks)
