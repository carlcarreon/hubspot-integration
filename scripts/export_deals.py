#!/usr/bin/env python3
"""Export HubSpot Deals created in a rolling UTC window to an accounting CSV.

This module deliberately uses only the Python standard library. It performs
read-only POST searches against HubSpot's CRM API and has no dependency on the
Node application, PostgreSQL, or the background worker.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import random
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Iterable, Mapping, Sequence
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


API_BASE_URL = "https://api.hubapi.com"
API_VERSION = "2026-09"
SEARCH_PATH = f"/crm/objects/{API_VERSION}/deals/search"
CSV_HEADERS = [
    "Deal ID",
    "External Order ID",
    "Deal Name",
    "Amount",
    "Currency",
    "Pipeline ID",
    "Deal Stage ID",
    "Close Date",
    "Created Date",
]
DEAL_PROPERTIES = [
    "dealname",
    "amount",
    "hs_currency_code",
    "deal_currency_code",  # Compatibility fallback used by the current worker.
    "closedate",
    "createdate",
    "pipeline",
    "dealstage",
    "external_order_id",
]
MAX_RETRY_ATTEMPTS = 4
RETRY_BASE_SECONDS = 1.0
RETRY_MAX_SECONDS = 30.0


class ExportError(RuntimeError):
    """A safe, user-facing exporter error."""


class HubSpotHttpError(ExportError):
    def __init__(self, status: int, message: str, retry_after_seconds: float | None = None):
        super().__init__(f"HubSpot request failed with status {status}. {message}")
        self.status = status
        self.retry_after_seconds = retry_after_seconds

    @property
    def retryable(self) -> bool:
        return self.status == 429 or 500 <= self.status <= 599


class HubSpotNetworkError(ExportError):
    def __init__(self):
        super().__init__("HubSpot network request failed.")

    @property
    def retryable(self) -> bool:
        return True


@dataclass(frozen=True)
class HttpResponse:
    status: int
    headers: Mapping[str, str]
    body: bytes


Transport = Callable[[str, bytes, Mapping[str, str]], HttpResponse]


def load_root_environment(project_root: Path | None = None) -> None:
    """Load unset values from the root .env without overwriting real environment values."""
    root = project_root or Path(__file__).resolve().parents[1]
    env_file = root / ".env"
    if not env_file.is_file():
        return

    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ[key] = value


def utc_window(days: int, now: datetime | None = None) -> tuple[datetime, datetime]:
    if days < 1:
        raise ValueError("--days must be at least 1.")
    end = now or datetime.now(timezone.utc)
    if end.tzinfo is None or end.utcoffset() is None:
        raise ValueError("The export window must use a timezone-aware UTC datetime.")
    end = end.astimezone(timezone.utc)
    return end - timedelta(days=days), end


def unix_milliseconds(value: datetime) -> str:
    return str(int(value.timestamp() * 1_000))


class HubSpotDealSearchClient:
    def __init__(
        self,
        access_token: str,
        transport: Transport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        random_value: Callable[[], float] = random.random,
    ):
        if not access_token:
            raise ExportError("HUBSPOT_ACCESS_TOKEN is required for the CSV export.")
        self._access_token = access_token
        self._transport = transport or urllib_transport
        self._sleep = sleep
        self._random_value = random_value

    def search_deals(self, start: datetime, end: datetime) -> list[dict[str, object]]:
        records: list[dict[str, object]] = []
        after: str | None = None
        seen_cursors: set[str] = set()

        while True:
            payload: dict[str, object] = {
                "filterGroups": [{"filters": [{
                    "propertyName": "createdate",
                    "operator": "BETWEEN",
                    "value": unix_milliseconds(start),
                    "highValue": unix_milliseconds(end),
                }]}],
                "sorts": ["createdate"],
                "properties": DEAL_PROPERTIES,
                "limit": 100,
            }
            if after:
                payload["after"] = after

            response = self._request_page(payload)
            page_records = response.get("results", [])
            if not isinstance(page_records, list):
                raise ExportError("HubSpot returned an invalid search response.")
            records.extend(record for record in page_records if isinstance(record, dict))

            cursor = read_cursor(response)
            if not cursor:
                return records
            if cursor in seen_cursors:
                raise ExportError("HubSpot returned a repeated pagination cursor.")
            seen_cursors.add(cursor)
            after = cursor

    def _request_page(self, payload: Mapping[str, object]) -> Mapping[str, object]:
        request_body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self._access_token}",
            "Content-Type": "application/json",
        }
        error: ExportError | None = None
        for attempt in range(1, MAX_RETRY_ATTEMPTS + 1):
            try:
                response = self._transport(f"{API_BASE_URL}{SEARCH_PATH}", request_body, headers)
                if 200 <= response.status < 300:
                    return parse_json_response(response.body)
                error = HubSpotHttpError(
                    response.status,
                    sanitized_hubspot_message(response.body),
                    retry_after_seconds(header_value(response.headers, "retry-after")),
                )
            except (OSError, URLError):
                error = HubSpotNetworkError()

            if not is_retryable(error) or attempt == MAX_RETRY_ATTEMPTS:
                raise error
            self._sleep(backoff_seconds(attempt, error, self._random_value))

        raise AssertionError("The retry loop must return or raise.")


def urllib_transport(url: str, body: bytes, headers: Mapping[str, str]) -> HttpResponse:
    request = Request(url, data=body, headers=dict(headers), method="POST")
    try:
        with urlopen(request, timeout=30) as response:  # nosec B310: fixed HTTPS HubSpot URL
            return HttpResponse(response.status, dict(response.headers.items()), response.read())
    except HTTPError as error:
        return HttpResponse(error.code, dict(error.headers.items()), error.read())


def parse_json_response(body: bytes) -> Mapping[str, object]:
    try:
        value = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ExportError("HubSpot returned an invalid JSON response.") from error
    if not isinstance(value, dict):
        raise ExportError("HubSpot returned an invalid search response.")
    return value


def read_cursor(response: Mapping[str, object]) -> str | None:
    paging = response.get("paging")
    if not isinstance(paging, dict):
        return None
    next_page = paging.get("next")
    if not isinstance(next_page, dict):
        return None
    after = next_page.get("after")
    return after if isinstance(after, str) and after else None


def retry_after_seconds(value: str | None) -> float | None:
    if not value:
        return None
    try:
        seconds = float(value)
    except ValueError:
        return None
    return max(0.0, seconds) if seconds == seconds else None


def header_value(headers: Mapping[str, str], name: str) -> str | None:
    for key, value in headers.items():
        if key.lower() == name.lower():
            return value
    return None


def is_retryable(error: ExportError | None) -> bool:
    return isinstance(error, (HubSpotHttpError, HubSpotNetworkError)) and error.retryable


def backoff_seconds(attempt: int, error: ExportError, random_value: Callable[[], float]) -> float:
    capped = min(RETRY_MAX_SECONDS, RETRY_BASE_SECONDS * (2 ** (attempt - 1)))
    jittered = max(0.0, min(capped, random_value() * capped))
    retry_after = error.retry_after_seconds if isinstance(error, HubSpotHttpError) else None
    return min(RETRY_MAX_SECONDS, max(jittered, retry_after or 0.0))


def sanitized_hubspot_message(body: bytes) -> str:
    try:
        parsed = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return "HubSpot returned an error response."
    if not isinstance(parsed, dict):
        return "HubSpot returned an error response."
    message = parsed.get("message")
    if not isinstance(message, str):
        return "HubSpot returned an error response."
    return re.sub(r"\bBearer\s+[^\s]+", "Bearer [redacted]", message, flags=re.IGNORECASE).replace("\r", " ").replace("\n", " ")[:500]


def deal_row(deal: Mapping[str, object]) -> list[str]:
    properties = deal.get("properties")
    if not isinstance(properties, dict):
        properties = {}

    def property_value(name: str) -> str:
        value = properties.get(name)
        return value if isinstance(value, str) else ""

    created_date = property_value("createdate")
    if not created_date:
        top_level_created_at = deal.get("createdAt")
        created_date = top_level_created_at if isinstance(top_level_created_at, str) else ""

    return [
        string_value(deal.get("id")),
        property_value("external_order_id"),
        property_value("dealname"),
        property_value("amount"),  # Deliberately retain HubSpot's exact decimal string.
        property_value("hs_currency_code") or property_value("deal_currency_code"),
        property_value("pipeline"),
        property_value("dealstage"),
        property_value("closedate"),
        created_date,
    ]


def string_value(value: object) -> str:
    return value if isinstance(value, str) else ""


def write_csv(destination: Path, deals: Iterable[Mapping[str, object]]) -> int:
    destination.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with destination.open("w", encoding="utf-8", newline="") as output:
        writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)
        writer.writerow(CSV_HEADERS)
        for deal in deals:
            writer.writerow(deal_row(deal))
            count += 1
    return count


def parse_arguments(arguments: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export HubSpot Deals created in a rolling UTC window to CSV.")
    parser.add_argument("--output", type=Path, default=Path("exports/hubspot_deals_last_7_days.csv"), help="CSV destination (default: exports/hubspot_deals_last_7_days.csv)")
    parser.add_argument("--days", type=int, default=7, help="Rolling UTC window in days (default: 7)")
    return parser.parse_args(arguments)


def main(arguments: Sequence[str] | None = None) -> int:
    args = parse_arguments(arguments)
    try:
        start, end = utc_window(args.days)
        load_root_environment()
        client = HubSpotDealSearchClient(os.environ.get("HUBSPOT_ACCESS_TOKEN", ""))
        deals = client.search_deals(start, end)
        count = write_csv(args.output, deals)
    except (ExportError, ValueError) as error:
        print(f"Export failed: {error}", file=sys.stderr)
        return 1

    print(f"Exported {count} deal(s) created from {start.isoformat()} through {end.isoformat()} to {args.output}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
