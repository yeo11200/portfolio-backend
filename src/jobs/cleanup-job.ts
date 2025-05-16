import cron from "node-cron";
import logger from "../utils/logger";
import supabaseService from "../services/supabase-service";

/**
 * 오래된 로그 삭제 작업
 * - 특정 기간(기본 6개월)보다 오래된 뉴스 데이터 삭제
 */
export const cleanupOldNewsData = async (
  olderThanMonths = 6
): Promise<void> => {
  logger.info({ olderThanMonths }, "Starting cleanup of old news data");

  try {
    // 기준 날짜 계산 (현재 날짜로부터 N개월 전)
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - olderThanMonths);
    const cutoffDateStr = cutoffDate.toISOString();

    // 오래된 뉴스 삭제
    const { error, count } = await supabaseService.supabaseClient
      .from("news_items")
      .delete({ count: "exact" })
      .lt("publishDate", cutoffDateStr);

    if (error) {
      logger.error({ error }, "Error deleting old news data");
      return;
    }

    logger.info({ deletedCount: count }, "Successfully deleted old news data");
  } catch (error) {
    logger.error({ error }, "Exception during cleanup of old news data");
  }
};

/**
 * 분석 실패 데이터 재시도 표시 작업
 * - 요약/감성 분석이 실패한 데이터를 재시도할 수 있도록 마킹
 */
export const markFailedAnalysisForRetry = async (): Promise<void> => {
  logger.info("Starting to mark failed analysis for retry");

  try {
    // 3일 이상 지났지만 분석되지 않은 데이터 찾기
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const cutoffDateStr = threeDaysAgo.toISOString();

    // 분석 실패 데이터 업데이트 (summary 필드를 null로 재설정)
    const { error, count } = await supabaseService.supabaseClient
      .from("news_items")
      .update({
        summary: null,
        updatedAt: new Date().toISOString(),
      })
      .is("summary", null)
      .lt("createdAt", cutoffDateStr)
      .is("sentiment", null);

    if (error) {
      logger.error({ error }, "Error marking failed analysis for retry");
      return;
    }

    logger.info(
      { markedCount: count },
      "Successfully marked failed analysis for retry"
    );
  } catch (error) {
    logger.error({ error }, "Exception during marking failed analysis");
  }
};

/**
 * Cron 작업 스케줄링 설정
 */
export const scheduleCleanupJobs = (): void => {
  // 오래된 데이터 정리: 매월 1일 새벽 3시에 실행
  cron.schedule("0 3 1 * *", async () => {
    logger.info("Running scheduled cleanup job");
    await cleanupOldNewsData();
  });

  // 분석 실패 데이터 재시도 마킹: 매주 월요일 새벽 4시에 실행
  cron.schedule("0 4 * * 1", async () => {
    logger.info("Running scheduled retry marking job");
    await markFailedAnalysisForRetry();
  });

  logger.info("Cleanup jobs scheduled");
};

export default {
  cleanupOldNewsData,
  markFailedAnalysisForRetry,
  scheduleCleanupJobs,
};
