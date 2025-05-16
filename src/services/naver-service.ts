import axios from "axios";
import dotenv from "dotenv";
import logger from "../utils/logger";

dotenv.config();

// Naver API 키 확인
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
  throw new Error(
    "NAVER_CLIENT_ID or NAVER_CLIENT_SECRET is not defined in environment variables"
  );
}

// Naver API 기본 설정
const naverClient = axios.create({
  baseURL: "https://openapi.naver.com",
  headers: {
    "X-Naver-Client-Id": NAVER_CLIENT_ID,
    "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    "Content-Type": "application/json; charset=utf-8",
  },
});

/**
 * 뉴스 검색 API
 * @param query 검색 질의어
 * @param page 결과 페이지 번호(1부터 시작)
 * @param size 한 페이지에 보여질 문서 수
 * @param sort 정렬 방식(sim: 정확도순, date: 날짜순)
 * @returns 검색 결과
 */
export const searchNews = async (
  query: string,
  page = 1,
  size = 10,
  sort = "date"
) => {
  try {
    // Naver API는 page가 아닌 start 파라미터 사용
    const start = (page - 1) * size + 1;

    const response = await naverClient.get("/v1/search/news.json", {
      params: {
        query,
        display: size,
        start,
        sort,
      },
    });
    return response.data;
  } catch (error) {
    logger.error({ error }, "Error searching news with Naver API");
    throw error;
  }
};

/**
 * 후보자 관련 뉴스 검색
 * @param candidate 후보자 이름
 * @param page 결과 페이지 번호
 * @param size 한 페이지에 보여질 문서 수
 * @returns 검색 결과
 */
export const searchCandidateNews = async (
  candidate: string,
  page = 1,
  size = 10
) => {
  // 후보자 이름에 정책, 공약 등의 키워드를 추가하여 검색
  const query = `${candidate} 정책 OR ${candidate} 공약`;
  return searchNews(query, page, size);
};

export default {
  searchNews,
  searchCandidateNews,
};
