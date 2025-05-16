import logger from "../utils/logger";
import supabaseService from "../services/supabase-service";
import openaiService from "../services/openai-service";

/**
 * 요약이 없는 뉴스를 찾아 AI로 요약 생성
 */
export const runSummarizeJob = async (): Promise<void> => {
  try {
    logger.info("Starting news summarization job");

    // 요약이 없는 뉴스 항목 조회 (최대 20개)
    const newsWithoutSummary = await supabaseService.getNewsWithoutSummary();

    logger.info(
      { count: newsWithoutSummary.length },
      "Found news items without summary"
    );

    if (newsWithoutSummary.length === 0) {
      logger.info("No news items require summarization");
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    // 각 뉴스 항목에 대해 요약 생성
    for (const newsItem of newsWithoutSummary) {
      try {
        logger.info(
          { newsId: newsItem.id, title: newsItem.title },
          "Generating summary for news item"
        );

        // fullText가 없을 경우 title을 사용
        const textToSummarize = newsItem.fullText || newsItem.title;

        if (!textToSummarize || textToSummarize.length < 10) {
          logger.warn(
            { newsId: newsItem.id },
            "News item has insufficient text for summarization"
          );
          continue;
        }

        // AI로 요약 생성
        const summary = await openaiService.summarizeText(textToSummarize, 2);

        if (!summary) {
          logger.warn(
            { newsId: newsItem.id },
            "Failed to generate summary (empty result)"
          );
          errorCount++;
          continue;
        }

        // 요약 정보 업데이트
        const updated = await supabaseService.updateNewsSummary(
          newsItem.id as string,
          summary
        );

        if (updated) {
          successCount++;
          logger.info(
            { newsId: newsItem.id, summary },
            "Successfully generated and saved summary"
          );
        } else {
          errorCount++;
          logger.error(
            { newsId: newsItem.id },
            "Failed to update news summary in database"
          );
        }

        // API 요청 간격 두기 (rate limit 방지)
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (itemError) {
        errorCount++;
        logger.error(
          { error: itemError, newsId: newsItem.id },
          "Error processing news item for summarization"
        );
      }
    }

    logger.info(
      {
        total: newsWithoutSummary.length,
        success: successCount,
        errors: errorCount,
      },
      "News summarization job completed"
    );
  } catch (error) {
    logger.error({ error }, "Error running news summarization job");
  }
};

export default {
  runSummarizeJob,
};
