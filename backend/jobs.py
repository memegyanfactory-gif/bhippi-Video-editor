import copy
import subprocess
import threading
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor

from fastapi import HTTPException


class Jobs:
    def __init__(self, workers: int = 2, capacity: int = 8):
        self.executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="helios")
        self.slots = threading.BoundedSemaphore(capacity)
        self.lock = threading.RLock()
        self.items = {}

    def get(self, job_id: str) -> dict:
        with self.lock:
            if job_id not in self.items:
                raise HTTPException(404, "Job not found")
            return copy.deepcopy(self.items[job_id])

    def submit(self, operation: Callable, message: str) -> dict:
        if not self.slots.acquire(blocking=False):
            raise HTTPException(429, "Job queue is full; retry when a job finishes")
        job_id = uuid.uuid4().hex
        job = {"id": job_id, "status": "queued", "progress": 0, "message": message}
        with self.lock:
            if len(self.items) >= 200:
                completed = [key for key, value in self.items.items() if value["status"] in ("done", "error")]
                for key in completed[:max(1, len(self.items) - 199)]:
                    del self.items[key]
            self.items[job_id] = job

        def update(progress: float, message: str):
            with self.lock:
                job.update(progress=max(job["progress"], min(99, progress)), message=message)

        def execute():
            try:
                with self.lock:
                    job.update(status="running", message=message)
                result = operation(update, job_id)
                with self.lock:
                    job.update(status="done", progress=100, message="Complete", result=result)
            except HTTPException as exc:
                with self.lock:
                    job.update(status="error", message=str(exc.detail))
            except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as exc:
                with self.lock:
                    job.update(status="error", message=str(exc)[:3000] or type(exc).__name__)
            finally:
                self.slots.release()

        try:
            self.executor.submit(execute)
        except RuntimeError:
            self.slots.release()
            with self.lock:
                del self.items[job_id]
            raise HTTPException(503, "Backend is shutting down") from None
        return self.get(job_id)

    def close(self):
        self.executor.shutdown(wait=True, cancel_futures=False)
