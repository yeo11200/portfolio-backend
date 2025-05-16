import axios from "axios";
import dotenv from "dotenv";
import logger from "../utils/logger";

dotenv.config();

// Kakao API 키 확인
const KAKAO_API_KEY = process.env.KAKAO_API_KEY;

if (!KAKAO_API_KEY) {
  throw new Error("KAKAO_API_KEY is not defined in environment variables");
}

// Kakao API 기본 설정
const kakaoClient = axios.create({
  baseURL: "https://dapi.kakao.com",
  headers: {
    Authorization: `KakaoAK ${KAKAO_API_KEY}`,
    "Content-Type": "application/json; charset=utf-8",
  },
});

/**
 * 웹 문서 검색 API
 * @param query 검색 질의어
 * @param page 결과 페이지 번호
 * @param size 한 페이지에 보여질 문서 수
 * @returns 검색 결과
 */
export const searchWeb = async (query: string, page = 1, size = 10) => {
  try {
    const response = await kakaoClient.get("/v2/search/web", {
      params: {
        query,
        page,
        size,
      },
    });
    return response.data;
  } catch (error) {
    logger.error({ error }, "Error searching web documents with Kakao API");
    throw error;
  }
};

/**
 * 블로그 검색 API
 * @param query 검색 질의어
 * @param page 결과 페이지 번호
 * @param size 한 페이지에 보여질 문서 수
 * @returns 검색 결과
 */
export const searchBlog = async (query: string, page = 1, size = 10) => {
  try {
    const response = await kakaoClient.get("/v2/search/blog", {
      params: {
        query,
        page,
        size,
      },
    });
    return response.data;
  } catch (error) {
    logger.error({ error }, "Error searching blogs with Kakao API");
    throw error;
  }
};

/**
 * 뉴스 검색 API (카페 API로 대체)
 * @param query 검색 질의어
 * @param page 결과 페이지 번호
 * @param size 한 페이지에 보여질 문서 수
 * @returns 검색 결과
 */
export const searchNews = async (query: string, page = 1, size = 10) => {
  try {
    const response = await kakaoClient.get("/v2/search/web", {
      params: {
        query,
        page,
        size,
        sort: "recency", // 최신순으로 정렬
      },
    });
    return response.data;
  } catch (error) {
    logger.error({ error }, "Error searching news with Kakao API");
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
  searchWeb,
  searchBlog,
  searchNews,
  searchCandidateNews,
};
