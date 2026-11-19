from __future__ import annotations

import json

import httpx
import pytest

from backend.providers.gemini_embeddings import GeminiEmbeddingModel


def test_gemini_embedding_requests_and_validates_1024_dimensions():
    requests_seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests_seen.append(request)
        body = json.loads(request.content)
        return httpx.Response(
            200,
            json={"embeddings": [{"values": [0.1] * 1024} for _ in body["requests"]]},
        )

    model = GeminiEmbeddingModel(
        api_key="test-key",
        output_dimensionality=1024,
        timeout_seconds=2,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    try:
        assert len(model.encode_query(["question"])) == 1
        assert len(model.encode_document(["document"])) == 1
    finally:
        model.close()

    query_request, document_request = requests_seen
    query_payload = json.loads(query_request.content)
    document_payload = json.loads(document_request.content)
    assert query_request.headers["x-goog-api-key"] == "test-key"
    assert query_payload["requests"][0]["outputDimensionality"] == 1024
    assert (
        query_payload["requests"][0]["content"]["parts"][0]["text"]
        == "task: search result | query: question"
    )
    assert (
        document_payload["requests"][0]["content"]["parts"][0]["text"]
        == "title: none | text: document"
    )


def test_gemini_embedding_rejects_non_1024_configuration():
    with pytest.raises(ValueError, match="dimension must remain 1024"):
        GeminiEmbeddingModel(api_key="test-key", output_dimensionality=768)


def test_gemini_embedding_rejects_malformed_vector_dimension():
    model = GeminiEmbeddingModel(
        api_key="test-key",
        output_dimensionality=1024,
        timeout_seconds=2,
        client=httpx.Client(
            transport=httpx.MockTransport(
                lambda _request: httpx.Response(
                    200,
                    json={"embeddings": [{"values": [0.1] * 768}]},
                )
            )
        ),
    )
    try:
        with pytest.raises(ValueError, match="dimension is not 1024"):
            model.encode_query(["question"])
    finally:
        model.close()
