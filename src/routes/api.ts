import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import supabaseService from "../services/supabase-service";
import puppeteerService from "../services/puppeteer-service";
import kakaoService from "../services/kakao-service";
import naverService from "../services/naver-service";
import scrapeJob from "../jobs/scrape-job";
import summarizeJob from "../jobs/summarize-job";
import sentimentJob from "../jobs/sentiment-job";
import cleanupJob from "../jobs/cleanup-job";
import logger from "../utils/logger";
import openaiService from "../services/openai-service";

export default async function routes(fastify: FastifyInstance): Promise<void> {
  // 기본 상태 확인 엔드포인트
  fastify.get("/", async (_request, reply) => {
    return reply.send({
      status: "ok",
      message: "News Sentiment Analysis API is running",
    });
  });

  // 후보자별 최신 뉴스 목록
  fastify.get(
    "/news",
    async (
      request: FastifyRequest<{
        Querystring: {
          limit?: string;
          sentiment?: "positive" | "neutral" | "negative";
        };
      }>,
      reply
    ) => {
      try {
        const limit = request.query.limit
          ? parseInt(request.query.limit, 10)
          : 20;
        const sentiment = request.query.sentiment;
        const news = await supabaseService.getRecentNewsByCandidates(
          limit,
          sentiment
        );

        return reply.send({
          status: "success",
          data: news,
        });
      } catch (error) {
        logger.error({ error }, "Error fetching news");
        return reply.status(500).send({
          status: "error",
          message: "Failed to fetch news",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );

  // 특정 후보자의 뉴스 검색
  fastify.get(
    "/news/candidate/:candidate",
    async (
      request: FastifyRequest<{
        Params: {
          candidate: string;
        };
        Querystring: {
          limit?: string;
          sentiment?: "positive" | "neutral" | "negative";
        };
      }>,
      reply
    ) => {
      try {
        const { candidate } = request.params;

        if (!candidate) {
          return reply.status(400).send({
            status: "error",
            message: "Candidate parameter is required",
          });
        }

        const limit = request.query.limit
          ? parseInt(request.query.limit, 10)
          : 20;
        const sentiment = request.query.sentiment;

        const news = await supabaseService.getNewsByCandidate(
          candidate,
          limit,
          sentiment
        );

        return reply.send({
          status: "success",
          data: {
            candidate,
            count: news.length,
            news,
          },
        });
      } catch (error) {
        logger.error({ error }, "Error fetching news for specific candidate");
        return reply.status(500).send({
          status: "error",
          message: "Failed to fetch news for candidate",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );

  // 키워드로 뉴스 검색
  fastify.get(
    "/news/search",
    async (
      request: FastifyRequest<{
        Querystring: {
          keyword: string;
          candidate?: string;
          limit?: string;
          sentiment?: "positive" | "neutral" | "negative";
        };
      }>,
      reply
    ) => {
      try {
        const { keyword, candidate } = request.query;

        if (!keyword) {
          return reply.status(400).send({
            status: "error",
            message: "Keyword parameter is required",
          });
        }

        const limit = request.query.limit
          ? parseInt(request.query.limit, 10)
          : 20;
        const sentiment = request.query.sentiment;

        const news = await supabaseService.searchNewsByKeyword(
          keyword,
          limit,
          candidate,
          sentiment
        );

        return reply.send({
          status: "success",
          data: {
            keyword,
            candidate: candidate || "all",
            count: news.length,
            news,
          },
        });
      } catch (error) {
        logger.error({ error }, "Error searching news by keyword");
        return reply.status(500).send({
          status: "error",
          message: "Failed to search news by keyword",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );

  // 후보자별 감성 분석 통계
  fastify.get("/sentiment-stats", async (_request, reply) => {
    try {
      const stats = await supabaseService.getSentimentStats();

      return reply.send({
        status: "success",
        data: stats,
      });
    } catch (error) {
      logger.error({ error }, "Error fetching sentiment stats");
      return reply.status(500).send({
        status: "error",
        message: "Failed to fetch sentiment stats",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Naver API를 사용한 후보자 뉴스 검색
  fastify.get(
    "/search/candidate",
    async (
      request: FastifyRequest<{
        Querystring: {
          candidate: string;
          page?: string;
          size?: string;
        };
      }>,
      reply
    ) => {
      try {
        const { candidate } = request.query;
        if (!candidate) {
          return reply.status(400).send({
            status: "error",
            message: "Candidate parameter is required",
          });
        }

        const page = request.query.page ? parseInt(request.query.page, 10) : 1;
        const size = request.query.size ? parseInt(request.query.size, 10) : 10;

        const results = await naverService.searchCandidateNews(
          candidate,
          page,
          size
        );

        return reply.send({
          status: "success",
          data: results,
        });
      } catch (error) {
        logger.error({ error }, "Error searching candidate news");
        return reply.status(500).send({
          status: "error",
          message: "Failed to search candidate news",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );

  // Naver API를 사용한 일반 검색
  fastify.get(
    "/search",
    async (
      request: FastifyRequest<{
        Querystring: {
          query: string;
          type?: string;
          page?: string;
          size?: string;
          sort?: string;
        };
      }>,
      reply
    ) => {
      try {
        const { query, type = "news", sort = "date" } = request.query;
        if (!query) {
          return reply.status(400).send({
            status: "error",
            message: "Query parameter is required",
          });
        }

        const page = request.query.page ? parseInt(request.query.page, 10) : 1;
        const size = request.query.size ? parseInt(request.query.size, 10) : 10;

        // Naver에서는 뉴스 API만 사용
        const results = await naverService.searchNews(query, page, size, sort);

        return reply.send({
          status: "success",
          data: results,
        });
      } catch (error) {
        logger.error({ error }, "Error searching with Naver API");
        return reply.status(500).send({
          status: "error",
          message: "Failed to search with Naver API",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );

  // 수동으로 스크래핑 작업 트리거 (관리자용)
  fastify.post(
    "/trigger-scrape",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: true, // 빈 요청 본문 허용
        },
      },
    },
    async (_request, reply) => {
      try {
        // 비동기로 작업 시작
        scrapeJob.runScrapeJob().catch((error) => {
          logger.error({ error }, "Error in triggered scrape job");
        });

        return reply.send({
          status: "success",
          message: "Scrape job triggered",
        });
      } catch (error) {
        logger.error({ error }, "Error triggering scrape job");
        return reply.status(500).send({
          status: "error",
          message: "Failed to trigger scrape job",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );

  // 수동으로 분석 작업 트리거 (관리자용)
  fastify.post(
    "/trigger-analysis",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: true, // 빈 요청 본문 허용
        },
      },
    },
    async (_request, reply) => {
      try {
        // 비동기로 작업 시작
        scrapeJob.runAnalysisJob().catch((error) => {
          logger.error({ error }, "Error in triggered analysis job");
        });

        return reply.send({
          status: "success",
          message: "Analysis job triggered",
        });
      } catch (error) {
        logger.error({ error }, "Error triggering analysis job");
        return reply.status(500).send({
          status: "error",
          message: "Failed to trigger analysis job",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );

  // 수동으로 요약 작업 트리거 (관리자용)
  fastify.post(
    "/trigger-summarize",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: true, // 빈 요청 본문 허용
        },
      },
    },
    async (_request, reply) => {
      try {
        // 비동기로 작업 시작
        summarizeJob.runSummarizeJob().catch((error) => {
          logger.error({ error }, "Error in triggered summarize job");
        });

        return reply.send({
          status: "success",
          message: "Summarize job triggered",
        });
      } catch (error) {
        logger.error({ error }, "Error triggering summarize job");
        return reply.status(500).send({
          status: "error",
          message: "Failed to trigger summarize job",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );

  // 수동으로 감정 분석 작업 트리거 (관리자용)
  fastify.post(
    "/trigger-sentiment",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: true, // 빈 요청 본문 허용
        },
      },
    },
    async (_request, reply) => {
      try {
        // 비동기로 작업 시작
        sentimentJob.runSentimentJob().catch((error) => {
          logger.error({ error }, "Error in triggered sentiment analysis job");
        });

        return reply.send({
          status: "success",
          message: "Sentiment analysis job triggered",
        });
      } catch (error) {
        logger.error({ error }, "Error triggering sentiment analysis job");
        return reply.status(500).send({
          status: "error",
          message: "Failed to trigger sentiment analysis job",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );

  // 감정 분석이 없는 뉴스 목록 조회
  fastify.get("/news-without-sentiment", async (_request, reply) => {
    try {
      const newsItems = await supabaseService.getNewsWithoutSentiment(100);

      return reply.send({
        status: "success",
        data: {
          count: newsItems.length,
          news: newsItems,
        },
      });
    } catch (error) {
      logger.error({ error }, "Error fetching news without sentiment");
      return reply.status(500).send({
        status: "error",
        message: "Failed to fetch news without sentiment",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // 특정 뉴스 항목 감정 분석 수행
  fastify.post(
    "/analyze-sentiment/:newsId",
    async (
      request: FastifyRequest<{
        Params: {
          newsId: string;
        };
      }>,
      reply
    ) => {
      try {
        const { newsId } = request.params;

        if (!newsId) {
          return reply.status(400).send({
            status: "error",
            message: "News ID parameter is required",
          });
        }

        // 뉴스 항목 조회
        const { data: newsItem, error: fetchError } =
          await supabaseService.supabaseClient
            .from("news_items")
            .select("*")
            .eq("id", newsId)
            .single();

        if (fetchError || !newsItem) {
          logger.error(
            { error: fetchError, newsId },
            "Error fetching news item"
          );
          return reply.status(404).send({
            status: "error",
            message: "News item not found",
            error: fetchError?.message,
          });
        }

        // 분석할 텍스트 준비
        const textToAnalyze = newsItem.fullText || newsItem.title;

        if (!textToAnalyze || textToAnalyze.length < 10) {
          return reply.status(400).send({
            status: "error",
            message: "News item has insufficient text for sentiment analysis",
          });
        }

        // 감정 분석 수행
        const sentimentResult = await openaiService.analyzeSentiment(
          textToAnalyze
        );

        // 분석 결과 업데이트
        const updated = await supabaseService.updateNewsSentiment(
          newsId,
          "", // summary는 비워둠
          sentimentResult.sentiment,
          sentimentResult.reasoning
        );

        if (!updated) {
          return reply.status(500).send({
            status: "error",
            message: "Failed to update sentiment in database",
          });
        }

        return reply.send({
          status: "success",
          data: {
            newsId,
            title: newsItem.title,
            sentiment: sentimentResult.sentiment,
            reasoning: sentimentResult.reasoning,
          },
        });
      } catch (error) {
        logger.error({ error }, "Error analyzing sentiment for news item");
        return reply.status(500).send({
          status: "error",
          message: "Failed to analyze sentiment",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );

  // 요약이 없는 뉴스 목록 조회
  fastify.get("/news-without-summary", async (_request, reply) => {
    try {
      const newsItems = await supabaseService.getNewsWithoutSummary(100);

      return reply.send({
        status: "success",
        data: {
          count: newsItems.length,
          news: newsItems,
        },
      });
    } catch (error) {
      logger.error({ error }, "Error fetching news without summary");
      return reply.status(500).send({
        status: "error",
        message: "Failed to fetch news without summary",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // 특정 후보에 대한 검색 수동 실행 (테스트용)
  fastify.post(
    "/test-scrape",
    async (
      request: FastifyRequest<{
        Body: { candidate: string; keyword: string };
      }>,
      reply
    ) => {
      try {
        const { candidate, keyword } = request.body;

        if (!candidate || !keyword) {
          return reply.status(400).send({
            status: "error",
            message: "Candidate and keyword are required",
          });
        }

        // Naver 뉴스 스크래핑 테스트
        const naverResults = await puppeteerService.scrapeNaverNews(
          candidate,
          keyword
        );
        // Daum 뉴스 스크래핑 테스트
        const daumResults = await puppeteerService.scrapeDaumNews(
          candidate,
          keyword
        );

        return reply.send({
          status: "success",
          data: {
            naver: naverResults,
            daum: daumResults,
          },
        });
      } catch (error) {
        logger.error({ error }, "Error in test scrape");
        return reply.status(500).send({
          status: "error",
          message: "Test scrape failed",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );
}
