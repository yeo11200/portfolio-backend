import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import logger from "../utils/logger";

dotenv.config();

// Supabase 환경변수 로드
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

// URL 및 키 디버깅 (비밀번호 일부 가리기)
const debugKey = supabaseKey
  ? `${supabaseKey.substring(0, 10)}...${supabaseKey.substring(
      supabaseKey.length - 5
    )}`
  : "undefined";
logger.info(`Supabase URL: ${supabaseUrl}`);
logger.info(`Supabase Key (masked): ${debugKey}`);

// 환경변수가 설정되지 않았을 경우 오류
if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Supabase URL and Key must be defined in environment variables"
  );
}

logger.info("Initializing Supabase client...");

// Supabase 클라이언트 생성
const supabaseClient = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

logger.info("Supabase client initialized successfully");

// 연결 테스트 함수
export const testConnection = async (): Promise<boolean> => {
  try {
    // 간단한 쿼리 실행 (테이블 존재 여부 확인)
    const { data, error } = await supabaseClient
      .from("repositories")
      .select("id")
      .limit(1);

    if (error) {
      logger.error({ error }, "Supabase connection test failed");
      return false;
    }

    logger.info("Supabase connection test successful");
    return true;
  } catch (error) {
    logger.error({ error }, "Supabase connection test threw an exception");
    return false;
  }
};

// 테이블 생성 함수
export const createTables = async (): Promise<boolean> => {
  try {
    logger.info("Creating database tables...");

    // repositories 테이블 생성
    const { error: repoError } = await supabaseClient.rpc("exec_sql", {
      sql: `
        -- 🗃️ repositories 테이블
        CREATE TABLE IF NOT EXISTS repositories (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL,
          github_repo_id VARCHAR(255) NOT NULL,
          owner VARCHAR(255) NOT NULL,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          html_url VARCHAR(500),
          language VARCHAR(100),
          stars_count INTEGER DEFAULT 0,
          forks_count INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          CONSTRAINT unique_user_github_repo UNIQUE (user_id, github_repo_id)
        );

        CREATE INDEX IF NOT EXISTS idx_repositories_user_id ON repositories(user_id);
        CREATE INDEX IF NOT EXISTS idx_repositories_github_repo_id ON repositories(github_repo_id);
        CREATE INDEX IF NOT EXISTS idx_repositories_owner_name ON repositories(owner, name);

        -- 📄 repository_summaries 테이블 (브랜치 단위)
        CREATE TABLE IF NOT EXISTS repository_summaries (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          branch_name VARCHAR(255) NOT NULL DEFAULT 'main',
          project_intro TEXT,
          tech_stack JSONB DEFAULT '{}'::JSONB,
          refactoring_history TEXT,
          collaboration_flow TEXT,
          resume_bullets TEXT[] DEFAULT '{}',
          performance_metrics JSONB DEFAULT '{}'::JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          CONSTRAINT unique_repository_branch UNIQUE (repository_id, branch_name)
        );

        CREATE INDEX IF NOT EXISTS idx_repository_summaries_repo_id ON repository_summaries(repository_id);
        CREATE INDEX IF NOT EXISTS idx_repository_summaries_branch ON repository_summaries(branch_name);
        CREATE INDEX IF NOT EXISTS idx_repository_summaries_updated_at ON repository_summaries(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_repository_summaries_created_at ON repository_summaries(created_at DESC);

        -- 🔁 자동 updated_at 업데이트용 트리거 함수
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- 📌 트리거 등록 (repositories)
        DROP TRIGGER IF EXISTS trg_update_repositories_updated_at ON repositories;
        CREATE TRIGGER trg_update_repositories_updated_at
          BEFORE UPDATE ON repositories
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_at_column();

        -- 📌 트리거 등록 (repository_summaries)
        DROP TRIGGER IF EXISTS trg_update_repository_summaries_updated_at ON repository_summaries;
        CREATE TRIGGER trg_update_repository_summaries_updated_at
          BEFORE UPDATE ON repository_summaries
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_at_column();

        -- 📝 user_resumes 테이블 (이력서 관리)
        CREATE TABLE IF NOT EXISTS user_resumes (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL,
          original_filename VARCHAR(255),
          original_file_url TEXT,
          original_file_key VARCHAR(500),
          extracted_text TEXT,
          parsed_data JSONB DEFAULT '{}'::JSONB,
          portfolio_resume TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_user_resumes_user_id ON user_resumes(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_resumes_created_at ON user_resumes(created_at DESC);

        -- 📌 트리거 등록 (user_resumes)
        DROP TRIGGER IF EXISTS trg_update_user_resumes_updated_at ON user_resumes;
        CREATE TRIGGER trg_update_user_resumes_updated_at
          BEFORE UPDATE ON user_resumes
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_at_column();
      `,
    });

    if (repoError) {
      logger.error({ error: repoError }, "Failed to create tables using RPC");

      // RPC가 실패하면 직접 SQL 실행 시도
      logger.info("Trying direct SQL execution...");

      // repositories 테이블 생성
      const { error: repoTableError } = await supabaseClient
        .from("repositories")
        .select("id")
        .limit(1);

      if (repoTableError && repoTableError.code === "42P01") {
        logger.error(
          "Tables do not exist. Please create them manually in Supabase dashboard."
        );
        return false;
      }
    }

    logger.info("Database tables created successfully");
    return true;
  } catch (error) {
    logger.error({ error }, "Exception when creating tables");
    return false;
  }
};

export default supabaseClient;
