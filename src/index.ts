import Fastify from "fastify";
import dotenv from "dotenv";
import routes from "./routes/api";
import voteRoutes from "./routes/vote-api";
import scrapeJob, { runScrapeJob, runAnalysisJob } from "./jobs/scrape-job";
import cleanupJob from "./jobs/cleanup-job";
import logger from "./utils/logger";
import { testConnection, createTables } from "./config/supabase-client";
import githubRoutes from "./routes/github-api";
import githubMyRoutes from "./routes/github-my-api";

// 환경 변수 로드
dotenv.config();

// 서버 포트 설정
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3010;
const HOST = process.env.HOST || "0.0.0.0";

// Fastify 인스턴스 생성
const fastify = Fastify({
  logger: {
    transport: {
      target: "pino-pretty",
      options: {
        translateTime: "HH:MM:ss Z",
        ignore: "pid,hostname",
      },
    },
  },
  // JSON 파서 설정 - 빈 본문 허용
  bodyLimit: 1048576, // 1MiB
  ajv: {
    customOptions: {
      removeAdditional: false,
      useDefaults: true,
      coerceTypes: true,
      allErrors: true,
    },
  },
});

// CORS 설정
fastify.register(import("@fastify/cors"), {
  origin: "*", // 개발용 설정, 프로덕션에서는 특정 도메인으로 제한
  methods: ["GET", "POST", "DELETE"], // DELETE 메소드 추가
});

// 빈 JSON 본문 허용 설정
fastify.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  function (req, body: string, done) {
    if (body === "") {
      done(null, {});
      return;
    }

    try {
      const json = JSON.parse(body);
      done(null, json);
    } catch (err) {
      done(err as Error, undefined);
    }
  }
);

// API 라우트 등록
fastify.register(routes, { prefix: "/api" });

// 투표 API 라우트 등록
fastify.register(voteRoutes, { prefix: "/api" });

// 신규 프로젝트인, 깃헙 레포 유지 관리 라우트 등록
fastify.register(githubRoutes, { prefix: "/api" });

// 사용자 관련 라우트 등록
fastify.register(githubMyRoutes, { prefix: "/api" });

// 서버 시작 함수
const startServer = async (): Promise<void> => {
  try {
    // Supabase 연결 테스트
    const connectionSuccessful = await testConnection();
    if (!connectionSuccessful) {
      logger.error(
        "Supabase connection test failed, but continuing server startup"
      );
    }

    // 데이터베이스 테이블 생성
    logger.info("Initializing database tables...");
    const tablesCreated = await createTables();
    if (!tablesCreated) {
      logger.error(
        "Failed to create database tables, but continuing server startup"
      );
    } else {
      logger.info("Database tables initialized successfully");
    }

    // 작업 스케줄러 시작
    scrapeJob.scheduleScrapeJobs();
    cleanupJob.scheduleCleanupJobs();

    // 서버 시작
    await fastify.listen({ port: PORT, host: HOST });
    logger.info(`Server is running on http://${HOST}:${PORT}`);

    // 최초 한 번 스크래핑 작업 실행
    logger.info("Running initial scrape job");
  } catch (error) {
    logger.error({ error }, "Error starting server");
    process.exit(1);
  }
};

// 서버 시작
startServer();

// 정상 종료 처리
const shutdownGracefully = async (): Promise<void> => {
  try {
    logger.info("Shutting down server gracefully");
    await fastify.close();
    logger.info("Server closed successfully");
    process.exit(0);
  } catch (error) {
    logger.error({ error }, "Error during shutdown");
    process.exit(1);
  }
};

// 프로세스 종료 시그널 핸들링
process.on("SIGTERM", shutdownGracefully);
process.on("SIGINT", shutdownGracefully);

export default fastify;
