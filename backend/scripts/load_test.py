"""
200人程度の同時接続を想定した簡易負荷テストスクリプト。

使い方:
    python scripts/load_test.py --base-url http://localhost:8000 --event-id <UUID> --num-participants 200

事前準備:
    1. 管理者で大会を作成し、問題を1問以上登録しておく
    2. 大会のUUIDを --event-id に指定する
    3. このスクリプト実行後、管理者画面で「次の問題へ」→「回答開始」を押すと、
       接続中の全参加者が同時に回答を送信し、応答時間を計測する。

このスクリプトは追加の依存ライブラリを増やさないよう、
標準ライブラリ(urllib, asyncio)と backend が既に依存している websockets のみを使用する。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import random
import time
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

import websockets


HTTP_TIMEOUT_SECONDS = 10
BURST_SYNC_WINDOW_SECONDS = 0.1


class BurstCoordinator:
    def __init__(self) -> None:
        self._start_event = asyncio.Event()
        self._lock = asyncio.Lock()
        self._release_started = False

    async def wait_until_start(self) -> None:
        async with self._lock:
            if not self._release_started:
                self._release_started = True
                asyncio.create_task(self._release_after_window())
        await self._start_event.wait()

    async def _release_after_window(self) -> None:
        await asyncio.sleep(BURST_SYNC_WINDOW_SECONDS)
        self._start_event.set()


def http_post(url: str, body: dict, token: str | None = None, timing: dict | None = None) -> dict:
    if timing is not None:
        timing["worker_start"] = time.perf_counter()
    data = json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_SECONDS) as resp:
        return json.loads(resp.read().decode("utf-8"))


def percentile(values: list[float], percentile_value: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, math.ceil(percentile_value / 100 * len(ordered)) - 1)
    return ordered[index]


def latency_summary(values: list[float]) -> dict[str, float | int | None]:
    return {
        "count": len(values),
        "average": sum(values) / len(values) if values else None,
        "p50": percentile(values, 50),
        "p95": percentile(values, 95),
        "p99": percentile(values, 99),
        "max": max(values) if values else None,
    }


def classify_http_error(error: BaseException) -> str:
    if isinstance(error, (TimeoutError, asyncio.TimeoutError, TimeoutError)):
        return "timeout"
    if isinstance(error, urllib.error.URLError) and isinstance(error.reason, TimeoutError):
        return "timeout"
    if isinstance(error, urllib.error.HTTPError):
        if 400 <= error.code < 500:
            return "4xx"
        if 500 <= error.code < 600:
            return "5xx"
    return "other"


def http_error_reason(error: urllib.error.HTTPError) -> str:
    try:
        body = error.read().decode("utf-8", errors="replace").strip()
    except Exception:
        body = ""
    if body:
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            return body
        if isinstance(payload, dict) and "detail" in payload:
            detail = payload["detail"]
            if isinstance(detail, str):
                return detail
            return json.dumps(detail, ensure_ascii=False, sort_keys=True)
        return json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return str(error.reason) if error.reason else f"HTTP {error.code}"


def exception_reason(error: BaseException) -> str:
    message = str(error).strip()
    return f"{type(error).__name__}: {message}" if message else type(error).__name__


async def simulate_participant(
    idx: int,
    base_url: str,
    ws_base: str,
    event_id: str,
    stats: dict,
    burst: bool,
    burst_coordinators: dict[str, BurstCoordinator],
    http_executor: ThreadPoolExecutor | None,
) -> None:
    name = f"load-test-{idx}"
    try:
        join = await asyncio.to_thread(http_post, f"{base_url}/api/events/{event_id}/join", {"name": name})
    except urllib.error.HTTPError as error:
        stats["join_failed"] += 1
        stats["join_http_errors"][classify_http_error(error)] += 1
        stats["join_http_statuses"][error.code] += 1
        stats["join_failure_reasons"][http_error_reason(error)] += 1
        return
    except Exception as error:
        stats["join_failed"] += 1
        error_type = classify_http_error(error)
        stats["join_http_errors"][error_type] += 1
        stats["join_failure_reasons"][exception_reason(error)] += 1
        return

    stats["join_succeeded"] += 1
    participant_id = join["participant_id"]
    token = join["token"]
    uri = f"{ws_base}/ws/events/{event_id}?role=participant&participant_id={participant_id}"

    connected = False
    normal_end = False
    try:
        async with websockets.connect(uri, open_timeout=10) as ws:
            connected = True
            stats["ws_connected"] += 1
            answered_question_id = None
            while True:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=60)
                except asyncio.TimeoutError:
                    normal_end = True
                    break
                msg = json.loads(raw)
                if msg.get("phase") == "ANSWER_OPEN" and msg.get("question"):
                    qid = msg["question"]["id"]
                    if qid == answered_question_id:
                        continue
                    answered_question_id = qid
                    choice_keys = msg["question"].get("choice_keys", [])
                    if not choice_keys:
                        stats["answers_failed"] += 1
                        stats["http_errors"]["other"] += 1
                        continue
                    choice = random.choice(choice_keys)
                    if burst:
                        coordinator = burst_coordinators.setdefault(qid, BurstCoordinator())
                        await coordinator.wait_until_start()
                    else:
                        await asyncio.sleep(random.uniform(0.1, 2.0))
                    stats["answers_attempted"] += 1
                    start = time.perf_counter()
                    stats["answer_send_starts"].append(start)
                    timing = {"executor_submit": start}
                    try:
                        if http_executor is None:
                            result = await asyncio.to_thread(
                                http_post,
                                f"{base_url}/api/events/{event_id}/answer",
                                {"participant_id": participant_id, "question_id": qid, "choice": choice},
                                token,
                                timing,
                            )
                        else:
                            loop = asyncio.get_running_loop()
                            result = await loop.run_in_executor(
                                http_executor,
                                http_post,
                                f"{base_url}/api/events/{event_id}/answer",
                                {"participant_id": participant_id, "question_id": qid, "choice": choice},
                                token,
                                timing,
                            )
                        completed = time.perf_counter()
                        stats["answer_response_completions"].append(completed)
                        elapsed = completed - start
                        if result.get("accepted") is True:
                            stats["answers_ok"] += 1
                            stats["accepted_latencies"].append(elapsed)
                            response_time_ms = result.get("response_time_ms")
                            if isinstance(response_time_ms, (int, float)):
                                stats["server_response_times"].append(response_time_ms)
                        else:
                            stats["answers_rejected"] += 1
                            stats["rejected_reasons"][result.get("message") or "unspecified"] += 1
                            stats["rejected_latencies"].append(elapsed)
                    except urllib.error.HTTPError as error:
                        stats["answers_failed"] += 1
                        stats["http_errors"][classify_http_error(error)] += 1
                        stats["http_statuses"][error.code] += 1
                    except Exception as error:
                        stats["answers_failed"] += 1
                        stats["http_errors"][classify_http_error(error)] += 1
                    finally:
                        worker_start = timing.get("worker_start")
                        if worker_start is not None:
                            stats["actual_http_worker_starts"].append(worker_start)
                            stats["executor_waits"].append((worker_start - timing["executor_submit"]) * 1000)
    except websockets.exceptions.ConnectionClosed:
        if normal_end:
            return
        if connected:
            stats["ws_disconnected"] += 1
        else:
            stats["ws_connect_failed"] += 1
    except Exception:
        if normal_end:
            return
        if connected:
            stats["ws_disconnected"] += 1
        else:
            stats["ws_connect_failed"] += 1


def print_latency_summary(label: str, values: list[float]) -> None:
    summary = latency_summary(values)
    print(label)
    for key in ("count", "average", "p50", "p95", "p99", "max"):
        value = summary[key]
        if isinstance(value, float):
            print(f"  {key}: {value:.3f}s")
        else:
            print(f"  {key}: {value if value is not None else '-'}")


def print_millisecond_summary(label: str, values: list[float], relative_to_first: bool = False) -> None:
    if not values:
        print(label)
        print("  count: 0")
        return
    if relative_to_first:
        first = min(values)
        values = [(value - first) * 1000 for value in values]
    summary = latency_summary(values)
    print(label)
    print(f"  min: {min(values):.3f}ms")
    print(f"  average: {summary['average']:.3f}ms")
    print(f"  p50: {summary['p50']:.3f}ms")
    print(f"  p95: {summary['p95']:.3f}ms")
    print(f"  p99: {summary['p99']:.3f}ms")
    print(f"  max: {summary['max']:.3f}ms")
    print(f"  span: {max(values) - min(values):.3f}ms")


def print_summary(stats: dict, elapsed: float, burst: bool) -> None:
    join_rate = stats["join_succeeded"] / stats["join_attempted"] if stats["join_attempted"] else 0
    answer_rate = stats["answers_ok"] / stats["answers_attempted"] if stats["answers_attempted"] else 0
    print("---- 結果 ----")
    print(f"Mode: {'burst' if burst else 'normal'}")
    print("Participants")
    print(f"  attempted: {stats['join_attempted']}")
    print(f"  joined: {stats['join_succeeded']}")
    print(f"  failed: {stats['join_failed']}")
    print(f"  success rate: {join_rate:.1%}")
    print("Join errors")
    print(f"  timeout: {stats['join_http_errors']['timeout']}")
    print(f"  4xx: {stats['join_http_errors']['4xx']}")
    print(f"  5xx: {stats['join_http_errors']['5xx']}")
    print(f"  other: {stats['join_http_errors']['other']}")
    print("  status codes:")
    for status_code, count in sorted(stats["join_http_statuses"].items()):
        print(f"    {status_code}: {count}")
    print("Join failure reasons:")
    for reason, count in stats["join_failure_reasons"].most_common():
        print(f"  {reason!r}: {count}")
    print("WebSocket")
    print(f"  connected: {stats['ws_connected']}")
    print(f"  connect failed: {stats['ws_connect_failed']}")
    print(f"  unexpected disconnected: {stats['ws_disconnected']}")
    print("Answers")
    print(f"  attempted: {stats['answers_attempted']}")
    print(f"  accepted: {stats['answers_ok']}")
    print(f"  rejected: {stats['answers_rejected']}")
    print(f"  failed: {stats['answers_failed']}")
    print(f"  success rate: {answer_rate:.1%}")
    print("HTTP errors")
    print(f"  timeout: {stats['http_errors']['timeout']}")
    print(f"  4xx: {stats['http_errors']['4xx']}")
    print(f"  5xx: {stats['http_errors']['5xx']}")
    print(f"  other: {stats['http_errors']['other']}")
    print(f"  status codes: {dict(sorted(stats['http_statuses'].items()))}")
    print_latency_summary("Answer latency (accepted)", stats["accepted_latencies"])
    print_latency_summary("Answer latency (rejected)", stats["rejected_latencies"])
    print_millisecond_summary("Answer send start (relative to first)", stats["answer_send_starts"], True)
    print_millisecond_summary(
        "Actual HTTP worker start (relative to first)", stats["actual_http_worker_starts"], True
    )
    print_millisecond_summary("Executor wait", stats["executor_waits"])
    print_millisecond_summary("Server response_time_ms (accepted)", stats["server_response_times"])
    print(f"Rejected reasons: {dict(stats['rejected_reasons'])}")
    print(f"Total elapsed time: {elapsed:.3f}s")


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--event-id", required=True)
    parser.add_argument("--num-participants", type=int, default=200)
    parser.add_argument("--burst", action="store_true")
    parser.add_argument("--http-workers", type=int, default=None)
    args = parser.parse_args()
    if args.http_workers is not None and args.http_workers <= 0:
        parser.error("--http-workers must be greater than zero")

    started_at = time.perf_counter()
    ws_base = args.base_url.replace("http", "ws", 1)
    burst_coordinators: dict[str, BurstCoordinator] = {}
    http_executor = ThreadPoolExecutor(max_workers=args.http_workers) if args.http_workers else None
    stats = {
        "join_attempted": args.num_participants,
        "join_succeeded": 0,
        "join_failed": 0,
        "join_http_errors": Counter({"timeout": 0, "4xx": 0, "5xx": 0, "other": 0}),
        "join_http_statuses": Counter(),
        "join_failure_reasons": Counter(),
        "ws_connected": 0,
        "ws_connect_failed": 0,
        "ws_disconnected": 0,
        "answers_attempted": 0,
        "answers_ok": 0,
        "answers_rejected": 0,
        "answers_failed": 0,
        "answer_send_starts": [],
        "answer_response_completions": [],
        "actual_http_worker_starts": [],
        "executor_waits": [],
        "server_response_times": [],
        "accepted_latencies": [],
        "rejected_latencies": [],
        "rejected_reasons": Counter(),
        "http_errors": Counter({"timeout": 0, "4xx": 0, "5xx": 0, "other": 0}),
        "http_statuses": Counter(),
    }

    tasks = [
        simulate_participant(
            i,
            args.base_url,
            ws_base,
            args.event_id,
            stats,
            args.burst,
            burst_coordinators,
            http_executor,
        )
        for i in range(args.num_participants)
    ]
    mode = "burst" if args.burst else "通常"
    print(f"{args.num_participants}人の参加者接続をシミュレートします(mode: {mode})。管理者画面から進行してください。")
    try:
        await asyncio.gather(*tasks)
    finally:
        if http_executor is not None:
            http_executor.shutdown(wait=True)
    print_summary(stats, time.perf_counter() - started_at, args.burst)


if __name__ == "__main__":
    asyncio.run(main())
