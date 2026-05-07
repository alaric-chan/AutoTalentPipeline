from apscheduler.schedulers.asyncio import AsyncIOScheduler
from loguru import logger
from app.config import get_settings
from app.flow_resume import process_new_resumes
from app.llm_client import LLMClient
from app.lark_client import LarkClient
from app.outlook_client import OutlookClient


def build_scheduler() -> AsyncIOScheduler:
    s = get_settings()
    sched = AsyncIOScheduler()
    sched.add_job(
        run_flow_resume,
        trigger="interval",
        minutes=s.resume_poll_interval_minutes,
        id="flow_resume",
        next_run_time=None,
        max_instances=1,
        coalesce=True,
    )
    return sched


async def run_flow_resume() -> None:
    outlook = OutlookClient()
    lark = LarkClient()
    llm = LLMClient()
    logger.info("开始执行流程 A")
    try:
        stats = await process_new_resumes(outlook=outlook, lark=lark, llm=llm)
        logger.info("流程 A 完成 stats={}", stats)
    except Exception as e:
        logger.exception("流程 A 整体失败")
        try:
            lark.send_alert(f"流程A整体失败: {e}")
        except Exception:
            logger.exception("告警失败")
