from __future__ import annotations

import csv
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from typing import Mapping

from scripts.export_deals import (
    CSV_HEADERS,
    ExportError,
    HttpResponse,
    HubSpotDealSearchClient,
    HubSpotHttpError,
    deal_row,
    utc_window,
    write_csv,
)


def response(status: int, body: Mapping[str, object], headers: Mapping[str, str] | None = None) -> HttpResponse:
    return HttpResponse(status, headers or {}, json.dumps(body).encode("utf-8"))


class QueueTransport:
    def __init__(self, responses: list[HttpResponse | Exception]):
        self.responses = responses
        self.requests: list[dict[str, object]] = []

    def __call__(self, _url: str, body: bytes, _headers: Mapping[str, str]) -> HttpResponse:
        self.requests.append(json.loads(body.decode("utf-8")))
        next_response = self.responses.pop(0)
        if isinstance(next_response, Exception):
            raise next_response
        return next_response


class ExportDealsTests(unittest.TestCase):
    def test_uses_a_rolling_utc_seven_day_window(self) -> None:
        now = datetime(2026, 10, 20, 12, 30, tzinfo=timezone.utc)
        start, end = utc_window(7, now)
        self.assertEqual(start, datetime(2026, 10, 13, 12, 30, tzinfo=timezone.utc))
        self.assertEqual(end, now)

    def test_fetches_all_pages_with_the_createdate_filter(self) -> None:
        transport = QueueTransport([
            response(200, {"results": [{"id": "1", "properties": {}}], "paging": {"next": {"after": "cursor-2"}}}),
            response(200, {"results": [{"id": "2", "properties": {}}]}),
        ])
        client = HubSpotDealSearchClient("test-token", transport=transport)
        start, end = utc_window(7, datetime(2026, 10, 20, tzinfo=timezone.utc))

        deals = client.search_deals(start, end)

        self.assertEqual([deal["id"] for deal in deals], ["1", "2"])
        self.assertEqual(transport.requests[0]["filterGroups"][0]["filters"][0]["propertyName"], "createdate")
        self.assertEqual(transport.requests[0]["filterGroups"][0]["filters"][0]["operator"], "BETWEEN")
        first_filter = transport.requests[0]["filterGroups"][0]["filters"][0]
        self.assertEqual(int(first_filter["highValue"]) - int(first_filter["value"]), 7 * 24 * 60 * 60 * 1000)
        self.assertEqual(transport.requests[1]["after"], "cursor-2")

    def test_empty_results_create_a_header_only_csv(self) -> None:
        transport = QueueTransport([response(200, {"results": []})])
        client = HubSpotDealSearchClient("test-token", transport=transport)
        start, end = utc_window(7, datetime(2026, 10, 20, tzinfo=timezone.utc))
        with tempfile.TemporaryDirectory() as temporary_directory:
            destination = Path(temporary_directory) / "nested" / "deals.csv"
            self.assertEqual(write_csv(destination, client.search_deals(start, end)), 0)
            with destination.open(newline="", encoding="utf-8") as source:
                self.assertEqual(list(csv.reader(source)), [CSV_HEADERS])

    def test_missing_values_and_decimal_text_are_preserved(self) -> None:
        row = deal_row({"id": "100", "createdAt": "2026-10-20T00:00:00Z", "properties": {"amount": "900.00"}})
        self.assertEqual(row, ["100", "", "", "900.00", "", "", "", "", "2026-10-20T00:00:00Z"])

    def test_csv_headers_and_quoting_are_correct(self) -> None:
        deal = {"id": "100", "properties": {
            "external_order_id": "ORD-100", "dealname": 'Order, "quoted"', "amount": "1234.567890123456789",
            "hs_currency_code": "PHP", "pipeline": "default", "dealstage": "closedwon",
            "closedate": "2026-10-20T00:00:00Z", "createdate": "2026-10-19T00:00:00Z",
        }}
        with tempfile.TemporaryDirectory() as temporary_directory:
            destination = Path(temporary_directory) / "deals.csv"
            write_csv(destination, [deal])
            with destination.open(newline="", encoding="utf-8") as source:
                rows = list(csv.reader(source))
        self.assertEqual(rows[0], CSV_HEADERS)
        self.assertEqual(rows[1][2], 'Order, "quoted"')
        self.assertEqual(rows[1][3], "1234.567890123456789")

    def test_retries_429_and_5xx_with_retry_after_and_jitter(self) -> None:
        delays: list[float] = []
        transport = QueueTransport([
            response(429, {"message": "Rate limited"}, {"Retry-After": "3"}),
            response(503, {"message": "Temporarily unavailable"}),
            response(200, {"results": []}),
        ])
        client = HubSpotDealSearchClient("test-token", transport=transport, sleep=delays.append, random_value=lambda: 0.5)
        start, end = utc_window(7, datetime(2026, 10, 20, tzinfo=timezone.utc))

        self.assertEqual(client.search_deals(start, end), [])
        self.assertEqual(delays, [3.0, 1.0])

    def test_does_not_retry_authorization_failures_or_leak_token(self) -> None:
        transport = QueueTransport([response(401, {"message": "Bearer secret-token-that-must-not-appear"})])
        client = HubSpotDealSearchClient("secret-token-that-must-not-appear", transport=transport)
        start, end = utc_window(7, datetime(2026, 10, 20, tzinfo=timezone.utc))

        with self.assertRaises(HubSpotHttpError) as raised:
            client.search_deals(start, end)
        self.assertEqual(raised.exception.status, 401)
        self.assertNotIn("secret-token-that-must-not-appear", str(raised.exception))
        self.assertEqual(len(transport.requests), 1)

    def test_retries_a_temporary_network_failure(self) -> None:
        transport = QueueTransport([OSError("network unavailable"), response(200, {"results": []})])
        delays: list[float] = []
        client = HubSpotDealSearchClient("test-token", transport=transport, sleep=delays.append, random_value=lambda: 0)
        start, end = utc_window(7, datetime(2026, 10, 20, tzinfo=timezone.utc))

        self.assertEqual(client.search_deals(start, end), [])
        self.assertEqual(delays, [0.0])


if __name__ == "__main__":
    unittest.main()
