import supabaseClient from "../config/supabase-client";
import logger from "../utils/logger";

// 뉴스 관련 타입 정의
export interface NewsItem {
  id?: string;
  candidate: string;
  title: string;
  link: string;
  publishDate: string;
  fullText: string;
  media: string;
  summary?: string;
  sentiment?: "positive" | "neutral" | "negative";
  reasoning?: string[];
  createdAt?: string;
  updatedAt?: string;
}

// 뉴스 아이템 저장
export const saveNewsItem = async (
  newsItem: NewsItem
): Promise<NewsItem | null> => {
  try {
    const { data, error } = await supabaseClient
      .from("news_items")
      .insert([
        {
          ...newsItem,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (error) {
      logger.error({ error }, "Error saving news item");
      return null;
    }

    logger.info({ newsItemId: data.id }, "News item saved successfully");
    return data;
  } catch (error) {
    logger.error({ error }, "Exception when saving news item");
    return null;
  }
};

// 이미 저장된 뉴스인지 확인 (URL 기준)
export const checkNewsExists = async (link: string): Promise<boolean> => {
  try {
    const { data, error } = await supabaseClient
      .from("news_items")
      .select("id")
      .eq("link", link)
      .maybeSingle();

    if (error) {
      logger.error({ error }, "Error checking if news exists");
      return false;
    }

    return !!data;
  } catch (error) {
    logger.error({ error }, "Exception when checking if news exists");
    return false;
  }
};

// 후보별 최근 뉴스 가져오기
export const getRecentNewsByCandidates = async (
  limit = 20,
  sentiment?: "positive" | "neutral" | "negative"
): Promise<Record<string, NewsItem[]>> => {
  try {
    let query = supabaseClient
      .from("news_items")
      .select("*")
      .order("publishDate", { ascending: false })
      .limit(limit * 3); // 3명의 후보자가 있으므로 limit의 3배로 조회

    if (sentiment) {
      query = query.eq("sentiment", sentiment);
    }

    const { data, error } = await query;

    if (error) {
      logger.error({ error }, "Error fetching recent news by candidates");
      return {};
    }

    // 후보별로 그룹화
    const result: Record<string, NewsItem[]> = {};
    for (const item of data) {
      if (!result[item.candidate]) {
        result[item.candidate] = [];
      }

      // 각 후보별로 limit 개수만큼만 저장
      if (result[item.candidate].length < limit) {
        result[item.candidate].push(item);
      }
    }

    return result;
  } catch (error) {
    logger.error(
      { error },
      "Exception when fetching recent news by candidates"
    );
    return {};
  }
};

// 감성 분석 결과 업데이트
export const updateNewsSentiment = async (
  id: string,
  summary: string,
  sentiment: "positive" | "neutral" | "negative",
  reasoning: string[]
): Promise<boolean> => {
  try {
    const { error } = await supabaseClient
      .from("news_items")
      .update({
        summary,
        sentiment,
        reasoning,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      logger.error({ error, newsItemId: id }, "Error updating news sentiment");
      return false;
    }

    logger.info({ newsItemId: id }, "News sentiment updated successfully");
    return true;
  } catch (error) {
    logger.error(
      { error, newsItemId: id },
      "Exception when updating news sentiment"
    );
    return false;
  }
};

// 감성 분석 통계 가져오기
export const getSentimentStats = async (): Promise<
  Record<string, Record<string, number>>
> => {
  try {
    const { data, error } = await supabaseClient
      .from("news_items")
      .select("candidate, sentiment");

    if (error) {
      logger.error({ error }, "Error fetching sentiment stats");
      return {};
    }

    const result: Record<string, Record<string, number>> = {};

    // 초기화
    const candidates = [...new Set(data.map((item) => item.candidate))];
    for (const candidate of candidates) {
      result[candidate] = {
        positive: 0,
        neutral: 0,
        negative: 0,
      };
    }

    // 집계
    for (const item of data) {
      if (item.sentiment) {
        result[item.candidate][item.sentiment]++;
      }
    }

    return result;
  } catch (error) {
    logger.error({ error }, "Exception when fetching sentiment stats");
    return {};
  }
};

/**
 * 요약이 없는 뉴스 항목 조회
 * @param limit 최대 조회 개수
 * @returns 요약이 없는 뉴스 항목 목록
 */
export const getNewsWithoutSummary = async (
  limit = 100
): Promise<NewsItem[]> => {
  try {
    const { data, error } = await supabaseClient
      .from("news_items")
      .select("*")
      .is("summary", null)
      .limit(limit);

    if (error) {
      logger.error({ error }, "Error fetching news without summary");
      return [];
    }

    return data || [];
  } catch (error) {
    logger.error({ error }, "Exception when fetching news without summary");
    return [];
  }
};

/**
 * 뉴스 요약 업데이트
 * @param newsId 뉴스 항목 ID
 * @param summary 생성된 요약
 * @returns 업데이트 성공 여부
 */
export const updateNewsSummary = async (
  newsId: string,
  summary: string
): Promise<boolean> => {
  try {
    const { error } = await supabaseClient
      .from("news_items")
      .update({ summary, updatedAt: new Date().toISOString() })
      .eq("id", newsId);

    if (error) {
      logger.error({ error, newsId }, "Error updating news summary");
      return false;
    }

    logger.info({ newsId }, "News summary updated successfully");
    return true;
  } catch (error) {
    logger.error({ error, newsId }, "Exception when updating news summary");
    return false;
  }
};

/**
 * 특정 후보자의 뉴스 조회
 * @param candidate 후보자 이름
 * @param limit 최대 조회 개수
 * @param sentiment 감정 필터 (옵션)
 * @returns 후보자의 뉴스 목록
 */
export const getNewsByCandidate = async (
  candidate: string,
  limit = 20,
  sentiment?: "positive" | "neutral" | "negative"
): Promise<NewsItem[]> => {
  try {
    let query = supabaseClient
      .from("news_items")
      .select("*")
      .eq("candidate", candidate)
      .order("publishDate", { ascending: false })
      .limit(limit);

    if (sentiment) {
      query = query.eq("sentiment", sentiment);
    }

    const { data, error } = await query;

    if (error) {
      logger.error(
        { error, candidate },
        "Error fetching news for specific candidate"
      );
      return [];
    }

    return data || [];
  } catch (error) {
    logger.error(
      { error, candidate },
      "Exception when fetching news for specific candidate"
    );
    return [];
  }
};

/**
 * 키워드로 뉴스 검색
 * @param keyword 검색 키워드
 * @param limit 최대 조회 개수
 * @param candidate 특정 후보자로 필터링 (옵션)
 * @param sentiment 감정 필터 (옵션)
 * @returns 검색된 뉴스 목록
 */
export const searchNewsByKeyword = async (
  keyword: string,
  limit = 20,
  candidate?: string,
  sentiment?: "positive" | "neutral" | "negative"
): Promise<NewsItem[]> => {
  try {
    // 제목이나 본문에 키워드가 포함된 뉴스 검색
    let query = supabaseClient
      .from("news_items")
      .select("*")
      .or(`title.ilike.%${keyword}%,fullText.ilike.%${keyword}%`)
      .order("publishDate", { ascending: false })
      .limit(limit);

    // 후보자 필터 추가 (지정된 경우)
    if (candidate) {
      query = query.eq("candidate", candidate);
    }

    // 감정 필터 추가 (지정된 경우)
    if (sentiment) {
      query = query.eq("sentiment", sentiment);
    }

    const { data, error } = await query;

    if (error) {
      logger.error(
        { error, keyword, candidate },
        "Error searching news by keyword"
      );
      return [];
    }

    return data || [];
  } catch (error) {
    logger.error(
      { error, keyword, candidate },
      "Exception when searching news by keyword"
    );
    return [];
  }
};

/**
 * 감정 분석이 없는 뉴스 항목 조회
 * @param limit 최대 조회 개수
 * @returns 감정 분석이 없는 뉴스 항목 목록
 */
export const getNewsWithoutSentiment = async (
  limit = 20
): Promise<NewsItem[]> => {
  try {
    const { data, error } = await supabaseClient
      .from("news_items")
      .select("*")
      .is("sentiment", null)
      .order("publishDate", { ascending: false })
      .limit(limit);

    if (error) {
      logger.error({ error }, "Error fetching news without sentiment");
      return [];
    }

    return data || [];
  } catch (error) {
    logger.error({ error }, "Exception when fetching news without sentiment");
    return [];
  }
};

export default {
  supabaseClient,
  saveNewsItem,
  checkNewsExists,
  getRecentNewsByCandidates,
  updateNewsSentiment,
  getSentimentStats,
  getNewsWithoutSummary,
  updateNewsSummary,
  getNewsByCandidate,
  searchNewsByKeyword,
  getNewsWithoutSentiment,
};
