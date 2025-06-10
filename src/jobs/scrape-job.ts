import cron from "node-cron";
import logger from "../utils/logger";
import naverService from "../services/naver-service";
import supabaseService, { NewsItem } from "../services/supabase-service";
import openaiService from "../services/openai-service";
import { candidateKeywords } from "../config/puppeteer-config";

/**
 * Naver API로 뉴스 검색 및 저장
 */
export const runScrapeJob = async (): Promise<void> => {
  logger.info("Starting news search job using Naver API");

  try {
    let allResults: NewsItem[] = [];

    // 후보자별 뉴스 검색
    for (const { name, keywords } of candidateKeywords) {
      logger.info(`Searching news for candidate: ${name}`);

      // 각 후보와 키워드 조합으로 검색
      for (const keyword of keywords) {
        const query = `${name} ${keyword}`;
        logger.info({ query }, "Searching with query");

        try {
          // Naver API로 뉴스 검색
          const searchResults = await naverService.searchNews(
            query,
            1,
            10,
            "date"
          );

          if (
            searchResults &&
            searchResults.items &&
            searchResults.items.length > 0
          ) {
            logger.info(
              { count: searchResults.items.length },
              `Found news items for query: ${query}`
            );

            // 검색 결과를 NewsItem 형식으로 변환
            const newsItems: NewsItem[] = searchResults.items.map(
              (item: any) => ({
                candidate: name,
                title: item.title.replace(/<[^>]*>/g, ""), // HTML 태그 제거
                link: item.originallink || item.link,
                publishDate: item.pubDate || new Date().toISOString(),
                fullText: item.description.replace(/<[^>]*>/g, ""), // HTML 태그 제거
                media: item.originallink
                  ? new URL(item.originallink).hostname
                  : "네이버 뉴스",
              })
            );

            allResults = [...allResults, ...newsItems];
          } else {
            logger.warn(`No news found for query: ${query}`);
          }

          // API 호출 간격 두기
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (error) {
          logger.error({ error, query }, "Error searching news with Naver API");
        }
      }
    }

    logger.info(
      { count: allResults.length },
      "Total news items found with Naver API"
    );

    if (allResults.length === 0) {
      logger.warn("No news was found. Check Naver API implementation.");
      return;
    }

    // 첫 번째 아이템 로깅 (디버깅 용도)
    if (allResults.length > 0) {
      const firstItem = allResults[0];
      logger.info(
        {
          title: firstItem.title,
          candidate: firstItem.candidate,
          link: firstItem.link,
        },
        "First news item for verification"
      );
    }

    // 중복 제거 및 DB 저장
    let savedCount = 0;
    let existingCount = 0;
    let errorCount = 0;

    for (const newsItem of allResults) {
      try {
        // 이미 저장된 뉴스인지 확인
        const exists = await supabaseService.checkNewsExists(newsItem.link);
        if (exists) {
          logger.info(
            { link: newsItem.link },
            "News item already exists, skipping"
          );
          existingCount++;
          continue;
        }

        // 새로운 뉴스 저장
        const savedItem = await supabaseService.saveNewsItem(newsItem);
        if (savedItem) {
          logger.info({ newsId: savedItem.id }, "News item saved to database");
          savedCount++;
        }
      } catch (error) {
        logger.error(
          { error, title: newsItem.title },
          "Error processing news item"
        );
        errorCount++;
      }
    }

    logger.info(
      {
        total: allResults.length,
        saved: savedCount,
        existing: existingCount,
        errors: errorCount,
      },
      "News search job completed"
    );
  } catch (error) {
    logger.error({ error }, "Error running news search job");
  }
};

/**
 * 저장된 뉴스의 요약 및 감성 분석 작업 실행
 */
export const runAnalysisJob = async (): Promise<void> => {
  logger.info("Starting news analysis job");

  try {
    // 분석되지 않은 뉴스 가져오기
    const { data, error } = await supabaseService.supabaseClient
      .from("news_items")
      .select("*")
      .is("summary", null)
      .limit(10); // 한 번에 10개만 처리

    if (error) {
      throw error;
    }

    logger.info({ count: data?.length || 0 }, "Found unanalyzed news items");

    if (!data || data.length === 0) {
      logger.info("No news items to analyze");
      return;
    }

    // 각 뉴스 분석
    for (const newsItem of data as NewsItem[]) {
      try {
        // 본문 요약
        const summary = await openaiService.summarizeText(newsItem.fullText);

        if (!summary) {
          logger.warn({ newsId: newsItem.id }, "Failed to summarize news");
          continue;
        }

        // 감성 분석
        const { sentiment, reasoning } = await openaiService.analyzeSentiment(
          summary
        );

        const updated = await supabaseService.updateNewsSentiment(
          newsItem.id!,
          summary,
          sentiment,
          reasoning
        );

        if (updated) {
          logger.info(
            { newsId: newsItem.id, sentiment },
            "News analysis completed and updated"
          );
        }
      } catch (error) {
        logger.error(
          { error, newsId: newsItem.id },
          "Error analyzing news item"
        );
      }

      // API 호출 사이에 짧은 대기 시간 추가
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    logger.info("News analysis job completed");
  } catch (error) {
    logger.error({ error }, "Error running analysis job");
  }
};

/**
 * Cron 작업 스케줄링 설정
 */
export const scheduleScrapeJobs = (): void => {
  // 스크래핑 작업: 매일 오전 6시와 오후 6시에 실행
  cron.schedule("0 6,18 * * *", async () => {
    logger.info("Running scheduled news search job");
    await runScrapeJob();
  });

  // 분석 작업: 매시간 10분에 실행
  cron.schedule("10 * * * *", async () => {
    logger.info("Running scheduled analysis job");
    await runAnalysisJob();
  });

  logger.info("News search and analysis jobs scheduled");
};

export default {
  runScrapeJob,
  runAnalysisJob,
  scheduleScrapeJobs,
};
