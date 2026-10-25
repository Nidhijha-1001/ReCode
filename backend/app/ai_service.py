from __future__ import annotations

import os
from typing import Any, Dict, Optional

import requests

from .config import OLLAMA_BASE_URL, OLLAMA_MODEL


def get_ollama_status() -> Dict[str, Any]:
    try:
        response = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=5)
        if response.status_code == 200:
            payload = response.json()
            models = [item.get("name") for item in payload.get("models", [])]
            model_available = bool(models)
            return {
                "available": model_available,
                "model": OLLAMA_MODEL,
                "models": models,
                "message": "Ollama is running and ready for local inference." if model_available else "Ollama is running but no models are available.",
            }
        return {
            "available": False,
            "model": OLLAMA_MODEL,
            "models": [],
            "message": f"Ollama responded with status {response.status_code}.",
        }
    except requests.RequestException as exc:
        return {
            "available": False,
            "model": OLLAMA_MODEL,
            "models": [],
            "message": f"Ollama is unavailable: {exc}",
        }


def build_problem_context(problem: Optional[Dict[str, Any]]) -> str:
    if not problem:
        return "No specific problem context was supplied."
    sections = [
        f"Title: {problem.get('title', 'Unknown problem')}",
        f"Topic: {problem.get('topic', 'General')}",
        f"Difficulty: {problem.get('difficulty', 'Unknown')}",
        f"Saved notes: {problem.get('notes', 'No notes saved.')}",
    ]
    if problem.get("url"):
        sections.append(f"URL: {problem['url']}")
    if problem.get("secondary_topics"):
        sections.append(f"Secondary topics: {problem['secondary_topics']}")
    if problem.get("time_complexity"):
        sections.append(f"Time complexity: {problem['time_complexity']}")
    if problem.get("space_complexity"):
        sections.append(f"Space complexity: {problem['space_complexity']}")
    return "\n".join(sections)


def generate_ai_response(mode: str, user_prompt: str, problem: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    model = os.getenv("OLLAMA_MODEL", OLLAMA_MODEL)
    context = build_problem_context(problem)
    instructions = (
        "You are ReCode's AI DSA tutor. Be clear, encouraging, and practical. "
        "Explain the underlying idea first, then the approach, then complexity. "
        "Never claim a solution is guaranteed optimal or correct. "
        "Use the saved context and history when available. "
        "If you provide code, label it as illustrative and suggest verifying it against edge cases."
    )
    if mode == "hint":
        instructions += " Give progressive hints without fully revealing the answer unless the user asks for the full solution."
    elif mode == "solve":
        instructions += " Provide both the intuition and a clear strategy; include pseudocode or code only when the user asks."
    elif mode == "revise":
        instructions += " Generate active recall questions and conceptual checks tied to the saved notes and revision history."
    elif mode == "plan":
        instructions += " Build a realistic study plan using limited study time and the user's coverage gaps."

    final_prompt = f"{instructions}\n\nProblem context:\n{context}\n\nUser message:\n{user_prompt}\n\nDisclose that model output may contain errors and is not a guarantee of correctness."

    try:
        response = requests.post(
            f"{OLLAMA_BASE_URL}/api/generate",
            json={"model": model, "prompt": final_prompt, "stream": False},
            timeout=90,
        )
        if not response.ok:
            raise RuntimeError(f"Ollama request failed with status {response.status_code}: {response.text}")
        payload = response.json()
        answer = payload.get("response", "The model responded without text.")
        return {
            "answer": answer,
            "model": model,
            "source": "ollama",
            "disclaimer": "Model output can contain mistakes. Verify logic, edge cases, and complexity before relying on it.",
        }
    except requests.RequestException as exc:
        raise RuntimeError(f"Inference request failed: {exc}") from exc
