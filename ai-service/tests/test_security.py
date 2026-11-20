"""Security tests verifying DNS rebinding defenses, Origin validation, CORS, and auth."""

import pytest
from httpx import ASGITransport, AsyncClient
from app.main import create_app


@pytest.mark.asyncio
async def test_wrong_host_rejected():
    """Verify requests with non-loopback Host header are rejected with 403."""
    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://127.0.0.1:8000",
        headers={"Host": "attacker.com"},
    ) as client:
        response = await client.get("/health")
        assert response.status_code == 403
        assert "invalid host header" in response.json()["error"]


@pytest.mark.asyncio
async def test_missing_or_wrong_origin_on_post():
    """Verify state-changing POST requests reject missing or unauthorized Origin with 403."""
    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://127.0.0.1:8000",
        headers={"Host": "127.0.0.1:8000"},
    ) as client:
        # Missing Origin
        res_missing = await client.post("/v1/sessions")
        assert res_missing.status_code == 403
        assert "missing origin header" in res_missing.json()["error"]

        # Disallowed Origin
        res_wrong = await client.post(
            "/v1/sessions",
            headers={"Origin": "http://malicious-site.com"},
        )
        assert res_wrong.status_code == 403
        assert "origin" in res_wrong.json()["error"].lower()


@pytest.mark.asyncio
async def test_health_works_without_origin():
    """Verify /health succeeds without requiring an Origin header."""
    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://127.0.0.1:8000",
        headers={"Host": "127.0.0.1:8000"},
    ) as client:
        response = await client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_bearer_token_authorization(async_client):
    """Verify access requires a valid Bearer token matching the specific session."""
    # Create Session 1
    res1 = await async_client.post(
        "/v1/sessions",
        headers={"Origin": "http://localhost:3000"},
    )
    assert res1.status_code == 201
    s1_id = res1.json()["sessionId"]
    s1_token = res1.json()["token"]

    # Create Session 2
    res2 = await async_client.post(
        "/v1/sessions",
        headers={"Origin": "http://localhost:3000"},
    )
    assert res2.status_code == 201
    s2_id = res2.json()["sessionId"]
    s2_token = res2.json()["token"]

    # 1. No token -> 401
    res_no_tok = await async_client.get(f"/v1/sessions/{s1_id}")
    assert res_no_tok.status_code == 401

    # 2. Wrong token -> 401
    res_wrong_tok = await async_client.get(
        f"/v1/sessions/{s1_id}",
        headers={"Authorization": "Bearer badtoken123"},
    )
    assert res_wrong_tok.status_code == 401

    # 3. Another session's token -> 401
    res_other_tok = await async_client.get(
        f"/v1/sessions/{s1_id}",
        headers={"Authorization": f"Bearer {s2_token}"},
    )
    assert res_other_tok.status_code == 401

    # 4. Valid matching token -> 200
    res_valid = await async_client.get(
        f"/v1/sessions/{s1_id}",
        headers={"Authorization": f"Bearer {s1_token}"},
    )
    assert res_valid.status_code == 200
    assert res_valid.json()["documents"] == 0


@pytest.mark.asyncio
async def test_cors_preflight_and_private_network():
    """Verify CORS preflight handling for allowed origin and refusal for disallowed origin."""
    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://127.0.0.1:8000",
        headers={"Host": "127.0.0.1:8000"},
    ) as client:
        # Preflight for allowed origin
        allowed_res = await client.options(
            "/v1/sessions",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Authorization, Content-Type",
                "Access-Control-Request-Private-Network": "true",
            },
        )
        assert allowed_res.status_code == 200
        assert (
            allowed_res.headers.get("Access-Control-Allow-Origin")
            == "http://localhost:3000"
        )
        assert (
            allowed_res.headers.get("Access-Control-Allow-Private-Network")
            == "true"
        )

        # Preflight for Vercel origin
        vercel_res = await client.options(
            "/v1/sessions",
            headers={
                "Origin": "https://cipher-vault-rho.vercel.app",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Authorization, Content-Type",
                "Access-Control-Request-Private-Network": "true",
            },
        )
        assert vercel_res.status_code == 200
        assert (
            vercel_res.headers.get("Access-Control-Allow-Origin")
            == "https://cipher-vault-rho.vercel.app"
        )
        assert (
            vercel_res.headers.get("Access-Control-Allow-Private-Network")
            == "true"
        )

        # Preflight for refused origin
        refused_res = await client.options(
            "/v1/sessions",
            headers={
                "Origin": "http://untrusted-domain.com",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Authorization, Content-Type",
                "Access-Control-Request-Private-Network": "true",
            },
        )
        assert refused_res.status_code in (400, 403)
        assert (
            refused_res.headers.get("Access-Control-Allow-Origin")
            != "http://untrusted-domain.com"
        )


@pytest.mark.asyncio
async def test_documentation_routes_disabled(async_client):
    """Verify Swagger and OpenAPI specification endpoints are disabled (404)."""
    docs_res = await async_client.get("/docs")
    assert docs_res.status_code == 404

    openapi_res = await async_client.get("/openapi.json")
    assert openapi_res.status_code == 404


@pytest.mark.asyncio
async def test_security_headers_present(async_client):
    """Verify Cache-Control: no-store and X-Content-Type-Options: nosniff are present."""
    response = await async_client.get("/health")
    assert response.headers.get("Cache-Control") == "no-store"
    assert response.headers.get("X-Content-Type-Options") == "nosniff"
