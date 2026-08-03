import json
import os
from typing import Any, Dict, Optional

from litellm.integrations.custom_logger import CustomLogger


class _JsonlFileLogger(CustomLogger):
    def __init__(self) -> None:
        self.log_file = os.environ.get(
            "LITELLM_JSONL_LOG_FILE", "/app/logs/litellm.jsonl"
        )

    def _append(self, record: Dict[str, Any]) -> None:
        try:
            os.makedirs(os.path.dirname(self.log_file), exist_ok=True)
            with open(self.log_file, "a") as f:
                f.write(json.dumps(record, default=str) + "\n")
        except Exception:
            pass

    @staticmethod
    def _finish_reason(payload: Dict[str, Any]) -> Optional[str]:
        response = payload.get("response")
        if not isinstance(response, dict):
            return None
        choices = response.get("choices")
        if not isinstance(choices, list) or not choices:
            return None
        first = choices[0]
        if isinstance(first, dict):
            return first.get("finish_reason")
        return None

    @staticmethod
    def _extract(payload: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "timestamp": payload.get("endTime"),
            "model": payload.get("model"),
            "model_group": payload.get("model_group"),
            "call_type": payload.get("call_type"),
            "status": payload.get("status"),
            "cache_hit": payload.get("cache_hit"),
            "prompt_tokens": payload.get("prompt_tokens"),
            "completion_tokens": payload.get("completion_tokens"),
            "total_tokens": payload.get("total_tokens"),
            "stop_reason": _JsonlFileLogger._finish_reason(payload),
            "response_time": payload.get("response_time"),
            "error_str": payload.get("error_str"),
        }

    async def async_log_success_event(
        self, kwargs, response_obj, start_time, end_time
    ) -> None:
        payload = kwargs.get("standard_logging_object") or {}
        self._append(self._extract(payload))

    async def async_log_failure_event(
        self, kwargs, response_obj, start_time, end_time
    ) -> None:
        payload = kwargs.get("standard_logging_object") or {}
        self._append(self._extract(payload))


JsonlFileLogger = _JsonlFileLogger()
