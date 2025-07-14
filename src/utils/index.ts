import OpenAI from "openai";
import logger from "./logger";
import dotenv from "dotenv";

/**
 * 간단한 날짜 형식을 ISO 8601 형식으로 변환
 * @param dateStr - yyyy-mm-dd, yyyy-mm, yyyy 형식의 날짜 문자열
 * @param isEndDate - 종료 날짜인 경우 true (23:59:59로 설정)
 * @returns ISO 8601 형식의 날짜 문자열
 */
export const convertToISO8601 = (
  dateStr: string,
  isEndDate: boolean = false
): string => {
  try {
    // 이미 ISO 8601 형식인 경우 그대로 반환
    if (dateStr.includes("T") && dateStr.includes("Z")) {
      return dateStr;
    }

    let isoDate: string;

    // yyyy-mm-dd 형식
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      isoDate = isEndDate ? `${dateStr}T23:59:59Z` : `${dateStr}T00:00:00Z`;
    }
    // yyyy-mm 형식
    else if (/^\d{4}-\d{2}$/.test(dateStr)) {
      if (isEndDate) {
        // 해당 월의 마지막 날을 구하기
        const [year, month] = dateStr.split("-").map(Number);
        const lastDay = new Date(year, month, 0).getDate();
        isoDate = `${dateStr}-${lastDay.toString().padStart(2, "0")}T23:59:59Z`;
      } else {
        isoDate = `${dateStr}-01T00:00:00Z`;
      }
    }
    // yyyy 형식
    else if (/^\d{4}$/.test(dateStr)) {
      isoDate = isEndDate
        ? `${dateStr}-12-31T23:59:59Z`
        : `${dateStr}-01-01T00:00:00Z`;
    }
    // 그 외의 경우 그대로 반환 (에러 처리는 GitHub API에서)
    else {
      return dateStr;
    }

    // 유효한 날짜인지 검증
    const date = new Date(isoDate);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid date: ${dateStr}`);
    }

    return isoDate;
  } catch (error) {
    logger.warn({ dateStr, error }, "Failed to convert date format");
    return dateStr; // 변환 실패 시 원본 반환
  }
};

/**
 * OpenRouter API를 사용하는 OpenAI 클라이언트를 생성합니다.
 * @returns Promise<OpenAI> - OpenAI 클라이언트 인스턴스
 * @throws Error - API 키가 없거나 클라이언트 생성 실패 시
 */
export const handleOpenAi = async (): Promise<OpenAI> => {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OpenRouter API key must be defined in environment variables"
    );
  }

  try {
    // OpenRouter 클라이언트 생성 (OpenAI 패키지의 내장 타입 사용)
    const openai = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey,
      defaultHeaders: {
        "HTTP-Referer": "https://portfolio-backend.example.com",
        "X-Title": "Resume Processing Service",
      },
    });

    logger.info("OpenAI client created successfully");
    return openai;
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      },
      "Failed to create OpenAI client"
    );
    throw new Error(
      `Failed to create OpenAI client: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
};
