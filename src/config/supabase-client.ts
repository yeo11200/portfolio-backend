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
      .from("news_items")
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

export default supabaseClient;
