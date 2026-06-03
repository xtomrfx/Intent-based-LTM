import os
import time
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional, Union

import torch
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, field_validator
from transformers import pipeline


MODEL_ID = os.getenv("MODEL_ID", "MoritzLaurer/mDeBERTa-v3-base-mnli-xnli").strip()
API_TOKEN = os.getenv("API_TOKEN", "").strip()
TORCH_NUM_THREADS = max(1, int(os.getenv("TORCH_NUM_THREADS", "4")))

torch.set_num_threads(TORCH_NUM_THREADS)

CLASSIFIER = None


class ZeroShotParameters(BaseModel):
    candidate_labels: Union[List[str], str]
    hypothesis_template: str = "This text is about {}."
    multi_label: bool = False

    @field_validator("candidate_labels")
    @classmethod
    def validate_candidate_labels(cls, value: Union[List[str], str]) -> List[str]:
        if isinstance(value, str):
            labels = [item.strip() for item in value.split(",")]
        else:
            labels = [str(item).strip() for item in value]
        labels = [item for item in labels if item]
        if not labels:
            raise ValueError("candidate_labels must contain at least one label")
        return labels


class ZeroShotRequest(BaseModel):
    inputs: Union[str, List[str]]
    parameters: ZeroShotParameters


def verify_token(authorization: Optional[str]) -> None:
    if not API_TOKEN:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token.")
    token = authorization[7:].strip()
    if token != API_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid bearer token.")


def get_classifier():
    global CLASSIFIER
    if CLASSIFIER is None:
        CLASSIFIER = pipeline(
            task="zero-shot-classification",
            model=MODEL_ID,
            device=-1
        )
    return CLASSIFIER


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_classifier()
    yield


app = FastAPI(
    title="HF Zero-Shot Classifier",
    version="1.0.0",
    lifespan=lifespan
)


@app.get("/")
def root() -> Dict[str, Any]:
    return {
        "service": "hf-zero-shot-mdeberta",
        "model": MODEL_ID,
        "schema_family": "hf_zero_shot_classification",
        "ready": CLASSIFIER is not None
    }


@app.get("/healthz")
def healthz() -> Dict[str, Any]:
    return {
        "ok": True,
        "ready": CLASSIFIER is not None,
        "model": MODEL_ID
    }


@app.post("/classify")
def classify(
    payload: ZeroShotRequest,
    authorization: Optional[str] = Header(default=None)
) -> Union[Dict[str, Any], List[Dict[str, Any]]]:
    verify_token(authorization)

    classifier = get_classifier()
    started_at = time.time()
    result = classifier(
        payload.inputs,
        candidate_labels=payload.parameters.candidate_labels,
        hypothesis_template=payload.parameters.hypothesis_template,
        multi_label=payload.parameters.multi_label
    )
    elapsed_ms = round((time.time() - started_at) * 1000, 2)

    if isinstance(result, list):
        return [
            {
                "sequence": item["sequence"],
                "labels": list(item["labels"]),
                "scores": [float(score) for score in item["scores"]],
                "model": MODEL_ID,
                "elapsed_ms": elapsed_ms
            }
            for item in result
        ]

    return {
        "sequence": result["sequence"],
        "labels": list(result["labels"]),
        "scores": [float(score) for score in result["scores"]],
        "model": MODEL_ID,
        "elapsed_ms": elapsed_ms
    }
