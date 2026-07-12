"""수집 가드 테스트. 실제 API 는 호출하지 않는다 (쿼터 보호)."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
import requests

import collect


class TestApiKeyGuard:
    def test_exits_cleanly_when_key_missing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(collect, "load_dotenv", lambda: None)
        monkeypatch.delenv("EV_API_KEY", raising=False)

        with pytest.raises(SystemExit) as exc:
            collect.load_api_key()

        assert "EV_API_KEY" in str(exc.value)  # 스택트레이스가 아니라 사람이 읽는 메시지

    def test_exits_when_key_is_placeholder(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(collect, "load_dotenv", lambda: None)
        monkeypatch.setenv("EV_API_KEY", "여기에_발급받은_인증키를_넣으세요")

        with pytest.raises(SystemExit):
            collect.load_api_key()

    def test_accepts_real_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(collect, "load_dotenv", lambda: None)
        monkeypatch.setenv("EV_API_KEY", "abc123")
        assert collect.load_api_key() == "abc123"


class TestQuotaGuard:
    def test_max_calls_is_80(self) -> None:
        assert collect.MAX_CALLS == 80

    def test_raises_when_pages_exceed_max_calls(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path
    ) -> None:
        """API 가 비정상적으로 큰 totalCount 를 주면 쿼터를 태우기 전에 멈춰야 한다."""
        monkeypatch.setattr(collect, "RAW_DIR", tmp_path)
        monkeypatch.setattr(collect, "load_api_key", lambda: "key")

        # 9999 * 80 = 799,920 을 넘는 totalCount -> 81 페이지 필요
        runaway = {"totalCount": 9999 * 81, "items": {"item": []}}
        monkeypatch.setattr(collect, "fetch_page", lambda *a, **k: runaway)

        with pytest.raises(collect.QuotaGuardError, match="MAX_CALLS"):
            collect.collect(force=True)

    def test_bad_total_count_does_not_reflect_api_value(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path
    ) -> None:
        """totalCount 가 정수가 아니면 API 가 준 값이 ValueError 로 반사되면 안 된다."""
        monkeypatch.setattr(collect, "RAW_DIR", tmp_path)
        monkeypatch.setattr(collect, "load_api_key", lambda: "key")

        poisoned = {"totalCount": "REVIEW_FAKE_KEY_DO_NOT_LOG", "items": {"item": []}}
        monkeypatch.setattr(collect, "fetch_page", lambda *a, **k: poisoned)

        with pytest.raises(RuntimeError) as exc_info:
            collect.collect(force=True)

        assert str(exc_info.value) == "totalCount 가 없거나 정수가 아닙니다 -- 수집을 중단합니다."

        # `from None` 은 __context__ 를 지우지 않고 출력만 억제한다(__suppress_context__).
        # 그러니 "값이 사라졌는지"가 아니라 "찍히는 트레이스백에 안 나오는지"를 본다.
        import traceback

        rendered = "".join(
            traceback.format_exception(
                type(exc_info.value), exc_info.value, exc_info.value.__traceback__
            )
        )
        assert "REVIEW_FAKE_KEY_DO_NOT_LOG" not in rendered

    def test_normal_page_count_is_within_guard(self) -> None:
        """실제 규모(52만기)는 53페이지 -- 가드에 걸리지 않아야 한다."""
        import math

        pages = math.ceil(521_329 / collect.NUM_OF_ROWS)
        assert pages == 53
        assert pages < collect.MAX_CALLS


class TestSkipExisting:
    def test_skips_when_snapshot_exists(self, monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
        """같은 날 재실행이 쿼터를 또 태우면 안 된다."""
        from datetime import datetime

        today = datetime.now().strftime("%Y%m%d")
        existing = tmp_path / f"chargers_{today}.parquet"
        existing.write_bytes(b"stub")

        monkeypatch.setattr(collect, "RAW_DIR", tmp_path)
        fetch = MagicMock()
        monkeypatch.setattr(collect, "fetch_page", fetch)

        result = collect.collect(force=False)

        assert result == existing
        fetch.assert_not_called()  # API 를 한 번도 부르지 않았다


class TestNoStatusEndpoint:
    def test_no_executable_code_references_get_charger_status(self) -> None:
        """getChargerStatus 는 불필요하다 -- getChargerInfo 가 stat 을 이미 준다.

        주석/독스트링에서 '쓰지 않는다'고 설명하는 건 괜찮다. 실행되는 코드에
        문자열 리터럴로 등장하면 안 된다.
        """
        import ast

        source = collect.Path(collect.__file__).read_text(encoding="utf-8")
        tree = ast.parse(source)

        literals = [
            node.value
            for node in ast.walk(tree)
            if isinstance(node, ast.Constant) and isinstance(node.value, str)
        ]
        doc_nodes = (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
        docstrings = {
            ast.get_docstring(n, clean=False)
            for n in ast.walk(tree)
            if isinstance(n, doc_nodes)
        }
        code_literals = [s for s in literals if s not in docstrings]

        assert not any("getChargerStatus" in s for s in code_literals)

    def test_endpoint_is_charger_info(self) -> None:
        assert collect.ENDPOINT.endswith("/getChargerInfo")


class TestRetry:
    def test_failure_does_not_expose_api_key_or_request_url(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """수집 실패 진단에는 상태를 남기되 인증정보가 든 URL은 노출하지 않는다."""
        monkeypatch.setattr(collect.time, "sleep", lambda _: None)
        fake_key = "REVIEW_FAKE_KEY_DO_NOT_LOG"
        request = requests.Request(
            "GET", collect.ENDPOINT, params={"serviceKey": fake_key}
        ).prepare()
        response = requests.Response()
        response.status_code = 401
        response.request = request
        response.url = request.url

        session = MagicMock()
        session.get.return_value = response

        with pytest.raises(RuntimeError) as exc_info:
            collect.fetch_page(session, fake_key, 7)

        assert str(exc_info.value) == "page 7 수집 실패 (3회 시도): HTTP 401 HTTPError"

    def test_failure_does_not_reflect_result_msg(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """resultMsg 는 API 가 준 문자열이다 -- 진단 메시지로 반사하면 안 된다."""
        monkeypatch.setattr(collect.time, "sleep", lambda _: None)
        poisoned = "SERVICE_KEY_IS_NOT_REGISTERED_ERROR REVIEW_FAKE_KEY_DO_NOT_LOG"

        session = MagicMock()
        session.get.return_value.json.return_value = {
            "resultCode": "30",
            "resultMsg": poisoned,
        }

        with pytest.raises(RuntimeError) as exc_info:
            collect.fetch_page(session, "REVIEW_FAKE_KEY_DO_NOT_LOG", 3)

        # 부분 문자열 거부(not in)로는 resultMsg 를 '잘라서' 넣는 반사를 못 잡는다.
        # 메시지 전체를 고정해 무엇이 덧붙든 실패하게 한다.
        assert str(exc_info.value) == "page 3 수집 실패 (3회 시도): resultCode=30"

    def test_retries_then_raises_on_persistent_failure(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(collect.time, "sleep", lambda _: None)
        session = MagicMock()
        session.get.return_value.json.return_value = {
            "resultCode": "99",
            "resultMsg": "SERVICE ERROR",
        }

        with pytest.raises(RuntimeError, match="수집 실패"):
            collect.fetch_page(session, "key", 1)

        assert session.get.call_count == collect.RETRIES
