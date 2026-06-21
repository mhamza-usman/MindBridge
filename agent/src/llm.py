"""Central constructor for the frozen chat model.

FROZEN.md / AGENTS.md pin the LLM to ``ChatGoogleGenerativeAI`` on the native
Google Gen AI SDK (``google.genai``). That same class can talk to EITHER the
Gemini Developer API (API key) or Vertex AI (ADC), so we keep the frozen class
and only switch transports here.

Default path (unchanged): Gemini Developer API with ``GEMINI_API_KEY``; MODEL
defaults to ``gemini-3.5-flash``.

Vertex path (opt-in): set ``GOOGLE_GENAI_USE_VERTEXAI=true`` plus
``GOOGLE_CLOUD_PROJECT`` and ``GOOGLE_CLOUD_LOCATION``. Auth is Application
Default Credentials (``gcloud auth application-default login`` or a service
account). ``gemini-3.5-flash`` is not served on Vertex, so MODEL defaults to
``gemini-2.5-flash`` there.

Safety net: if Vertex is requested but no ADC is resolvable (the common case on
a laptop that only has a ``GEMINI_API_KEY``), we log a warning and fall back to
the Developer API instead of constructing a client that would fail mid-stream
(surfacing as ``INCOMPLETE_STREAM`` in the UI).
"""

import os

from langchain_google_genai import ChatGoogleGenerativeAI


def _use_vertex() -> bool:
    return os.getenv("GOOGLE_GENAI_USE_VERTEXAI", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def _adc_available() -> bool:
    """True only if Application Default Credentials actually resolve.

    Vertex AI authenticates via ADC; without it the model call fails at request
    time and terminates the stream. Probing here lets us fall back cleanly.
    """
    try:
        import google.auth

        google.auth.default()
        return True
    except Exception:
        return False


def _developer_api_model(**kwargs) -> ChatGoogleGenerativeAI:
    model = kwargs.pop("model", None) or os.getenv("MODEL", "gemini-3.5-flash")
    return ChatGoogleGenerativeAI(
        model=model,
        google_api_key=os.getenv("GEMINI_API_KEY"),
        **kwargs,
    )


def build_chat_model(**kwargs) -> ChatGoogleGenerativeAI:
    """Build the frozen ChatGoogleGenerativeAI, on Vertex AI when configured."""
    if _use_vertex():
        if _adc_available():
            model = kwargs.pop("model", None) or os.getenv("MODEL", "gemini-2.5-flash")
            return ChatGoogleGenerativeAI(
                model=model,
                vertexai=True,
                project=os.getenv("GOOGLE_CLOUD_PROJECT"),
                location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1"),
                **kwargs,
            )
        print(
            "[llm] GOOGLE_GENAI_USE_VERTEXAI is set but no Application Default "
            "Credentials were found; falling back to the Gemini Developer API "
            "(GEMINI_API_KEY). Run `gcloud auth application-default login` or "
            "unset GOOGLE_GENAI_USE_VERTEXAI to silence this."
        )

    return _developer_api_model(**kwargs)
