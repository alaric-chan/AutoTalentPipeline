from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from loguru import logger
from pydantic import BaseModel
from app.flow_interview import generate_interview_summary
from app.lark_client import LarkClient
from app.llm_client import LLMClient
from app.scheduler import build_scheduler, run_flow_resume


class InterviewWebhookPayload(BaseModel):
    interview_record_id: str


@asynccontextmanager
async def lifespan(app: FastAPI):
    sched = build_scheduler()
    sched.start()
    app.state.scheduler = sched
    logger.info("scheduler started")
    yield
    sched.shutdown(wait=False)
    logger.info("scheduler stopped")


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/webhook/interview-complete")
async def on_interview_complete(payload: InterviewWebhookPayload):
    try:
        summary = generate_interview_summary(
            interview_record_id=payload.interview_record_id,
            lark=LarkClient(),
            llm=LLMClient(),
        )
        return {"status": "ok", "summary_preview": summary[:100]}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("interview webhook 失败")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/admin/run-flow-resume")
async def trigger_flow_resume():
    """手动触发流程 A（用于调试，生产可移除）。"""
    await run_flow_resume()
    return {"status": "triggered"}
