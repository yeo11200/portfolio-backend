import logger from "../utils/logger";
import supabaseService from "../services/supabase-service";
import openaiService from "../services/openai-service";

/**
 * 감정 분석이 없는 뉴스를 찾아 AI로 감정 분석 수행
 */
export const runSentimentJob = async (): Promise<void> => {
  try {
    logger.info("Starting news sentiment analysis job");

    // 감정이 분석되지 않은 뉴스 항목 조회 (최대 20개)
    const newsWithoutSentiment = await supabaseService.getNewsWithoutSentiment(
      20
    );

    logger.info(
      { count: newsWithoutSentiment.length },
      "Found news items without sentiment analysis"
    );

    if (newsWithoutSentiment.length === 0) {
      logger.info("No news items require sentiment analysis");
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    // 각 뉴스 항목에 대해 감정 분석 수행
    for (const newsItem of newsWithoutSentiment) {
      try {
        logger.info(
          { newsId: newsItem.id, title: newsItem.title },
          "Analyzing sentiment for news item"
        );

        // fullText가 없을 경우 title을 사용
        const textToAnalyze = newsItem.fullText || newsItem.title;

        if (!textToAnalyze || textToAnalyze.length < 10) {
          logger.warn(
            { newsId: newsItem.id },
            "News item has insufficient text for sentiment analysis"
          );
          continue;
        }

        // AI로 감정 분석 수행
        const sentimentResult = await openaiService.analyzeSentiment(
          textToAnalyze
        );

        if (!sentimentResult.sentiment) {
          logger.warn(
            { newsId: newsItem.id },
            "Failed to analyze sentiment (empty result)"
          );
          errorCount++;
          continue;
        }

        // 감정 분석 결과 업데이트
        const updated = await supabaseService.updateNewsSentiment(
          newsItem.id as string,
          "", // summary는 비워둠 - 요약을 업데이트하지 않음
          sentimentResult.sentiment,
          sentimentResult.reasoning
        );

        if (updated) {
          successCount++;
          logger.info(
            {
              newsId: newsItem.id,
              sentiment: sentimentResult.sentiment,
              reasoning: sentimentResult.reasoning,
            },
            "Successfully analyzed and saved sentiment"
          );
        } else {
          errorCount++;
          logger.error(
            { newsId: newsItem.id },
            "Failed to update sentiment in database"
          );
        }

        // API 요청 간격 두기 (rate limit 방지)
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (itemError) {
        errorCount++;
        logger.error(
          { error: itemError, newsId: newsItem.id },
          "Error processing news item for sentiment analysis"
        );
      }
    }

    logger.info(
      {
        total: newsWithoutSentiment.length,
        success: successCount,
        errors: errorCount,
      },
      "News sentiment analysis job completed"
    );
  } catch (error) {
    logger.error({ error }, "Error running news sentiment analysis job");
  }
};

export default {
  runSentimentJob,
};
