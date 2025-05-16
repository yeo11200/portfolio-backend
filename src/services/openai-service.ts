import OpenAI from "openai";
import dotenv from "dotenv";
import logger from "../utils/logger";

dotenv.config();

// OpenRouter API 키 확인
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  throw new Error("OPENROUTER_API_KEY is not defined in environment variables");
}

// OpenRouter 클라이언트 생성 (OpenAI SDK 호환)
const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey,
  defaultHeaders: {
    "HTTP-Referer": "https://portfolio-backend.example.com", // 사이트 URL
    "X-Title": "Portfolio News Sentiment Analysis", // 사이트 이름
  },
});

/**
 * 마크다운 코드 블록에서 JSON 추출
 * @param text 마크다운 텍스트
 * @returns 추출된 JSON 문자열
 */
const extractJsonFromMarkdown = (text: string): string => {
  // 마크다운 코드 블록 패턴 (```json ... ```)
  const jsonCodeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
  const match = text.match(jsonCodeBlockRegex);

  if (match && match[1]) {
    return match[1].trim();
  }

  // 코드 블록이 없으면 원본 반환
  return text;
};

/**
 * 규칙 기반 간단 요약 생성 (API 오류 시 대체 방법)
 * @param text 요약할 텍스트
 * @param maxSentences 최대 문장 수
 * @returns 요약 텍스트
 */
const createFallbackSummary = (text: string, maxSentences = 3): string => {
  try {
    // 긴 텍스트는 적절한 길이로 잘라냄
    const truncatedText = text.slice(0, 5000);

    // 문장 분리
    const sentences = truncatedText
      .replace(/([.!?])\s+/g, "$1|")
      .split("|")
      .filter((s) => s.trim().length > 10);

    // 앞에서부터 maxSentences개 문장 선택
    const selectedSentences = sentences.slice(0, maxSentences);

    // 요약 생성
    const summary = selectedSentences.join(" ");

    logger.info(
      {
        method: "fallback",
        originalLength: text.length,
        summaryLength: summary.length,
      },
      "Created fallback summary"
    );

    return summary;
  } catch (error) {
    logger.error({ error }, "Error creating fallback summary");
    // 최후의 수단: 텍스트 앞부분 반환
    return text.slice(0, 200) + "...";
  }
};

/**
 * 규칙 기반 간단 감정 분석 (API 오류 시 대체 방법)
 * @param text 분석할 텍스트
 * @returns 감정 분석 결과
 */
const createFallbackSentimentAnalysis = (
  text: string
): { sentiment: "positive" | "neutral" | "negative"; reasoning: string[] } => {
  try {
    // 긍정/부정 키워드 목록
    const positiveKeywords = [
      "좋은",
      "긍정",
      "성공",
      "발전",
      "지지",
      "찬성",
      "상승",
      "호의",
      "희망",
      "기대",
      "도움",
      "협력",
      "칭찬",
      "환영",
      "증가",
      "개선",
    ];

    const negativeKeywords = [
      "나쁜",
      "부정",
      "실패",
      "퇴보",
      "반대",
      "하락",
      "비판",
      "문제",
      "우려",
      "걱정",
      "공격",
      "불만",
      "비난",
      "거부",
      "감소",
      "악화",
      "논란",
    ];

    // 키워드 카운팅
    let positiveCount = 0;
    let negativeCount = 0;
    const foundKeywords: string[] = [];

    // 긍정 키워드 확인
    for (const keyword of positiveKeywords) {
      if (text.includes(keyword)) {
        positiveCount++;
        foundKeywords.push(keyword);
      }
    }

    // 부정 키워드 확인
    for (const keyword of negativeKeywords) {
      if (text.includes(keyword)) {
        negativeCount++;
        foundKeywords.push(keyword);
      }
    }

    // 감정 결정
    let sentiment: "positive" | "neutral" | "negative" = "neutral";

    if (positiveCount > negativeCount && positiveCount > 1) {
      sentiment = "positive";
    } else if (negativeCount > positiveCount && negativeCount > 1) {
      sentiment = "negative";
    }

    // 키워드가 부족하면 기본값 반환
    if (foundKeywords.length < 2) {
      foundKeywords.push("뚜렷한 감정 표현 없음");
    }

    logger.info(
      {
        method: "fallback",
        sentiment,
        positiveCount,
        negativeCount,
        foundKeywords,
      },
      "Created fallback sentiment analysis"
    );

    return {
      sentiment,
      reasoning: foundKeywords.slice(0, 5), // 최대 5개 키워드 반환
    };
  } catch (error) {
    logger.error({ error }, "Error creating fallback sentiment analysis");
    return {
      sentiment: "neutral",
      reasoning: ["분석 오류"],
    };
  }
};

/**
 * 뉴스 본문 요약 함수
 * @param text 요약할 본문
 * @param maxLength 최대 요약 길이
 * @returns 요약된 텍스트
 */
export const summarizeText = async (
  text: string,
  maxLength = 3
): Promise<string> => {
  try {
    // 입력 텍스트가 너무 짧으면 그대로 반환
    if (text.length < 100) {
      logger.info(
        { textLength: text.length },
        "Text too short for summarization, returning as is"
      );
      return text;
    }

    // 입력 텍스트 길이 로깅
    logger.info(
      { textLength: text.length, maxLength },
      "Starting text summarization"
    );

    const prompt = `다음 뉴스 기사를 ${maxLength}줄로 요약해주세요:\n\n${text}`;

    // 요청 전 로깅
    logger.info(
      { model: "google/gemma-3-27b-it:free", promptLength: prompt.length },
      "Sending summarization request to OpenRouter"
    );

    const completion = await openai.chat.completions.create({
      model: "google/gemma-3-27b-it:free",
      messages: [
        {
          role: "system",
          content: "당신은 정치 뉴스를 객관적으로 요약하는 전문가입니다.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 250,
    });

    const summary = completion.choices[0]?.message?.content?.trim() || "";

    // 결과가 비어있으면 대체 요약 사용
    if (!summary) {
      logger.warn("Empty summary from API, using fallback method");
      return createFallbackSummary(text, maxLength);
    }

    // 결과 로깅
    logger.info(
      {
        summaryLength: summary.length,
        summary: summary.substring(0, 50) + "...",
      },
      "Successfully received summary from OpenRouter"
    );

    return summary;
  } catch (error: any) {
    // 오류를 더 자세히 로깅
    logger.error(
      {
        error: {
          name: error.name,
          message: error.message,
          status: error.status,
          headers: error.headers,
          response: error.response?.data,
          stack: error.stack,
        },
      },
      "Error summarizing text with OpenRouter"
    );

    // API 오류 시 대체 요약 사용
    logger.info("Using fallback summarization method due to API error");
    return createFallbackSummary(text, maxLength);
  }
};

/**
 * 감정 분석 함수
 * @param text 분석할 텍스트
 * @returns 감정 분석 결과 (positive/neutral/negative)와 근거 키워드
 */
export const analyzeSentiment = async (
  text: string
): Promise<{
  sentiment: "positive" | "neutral" | "negative";
  reasoning: string[];
}> => {
  try {
    // 입력 텍스트가 너무 짧으면 중립으로 반환
    if (text.length < 50) {
      logger.info(
        { textLength: text.length },
        "Text too short for sentiment analysis, returning neutral"
      );
      return {
        sentiment: "neutral",
        reasoning: ["텍스트가 너무 짧음"],
      };
    }

    // 입력 텍스트 길이 로깅
    logger.info({ textLength: text.length }, "Starting sentiment analysis");

    const prompt = `다음 뉴스 내용의 감정이 긍정/중립/부정 중 무엇인지 분석하고, 그 근거가 되는 키워드도 알려주세요:\n\n${text}`;

    // 요청 전 로깅
    logger.info(
      { model: "google/gemma-3-27b-it:free", promptLength: prompt.length },
      "Sending sentiment analysis request to OpenRouter"
    );

    const completion = await openai.chat.completions.create({
      model: "google/gemma-3-27b-it:free",
      messages: [
        {
          role: "system",
          content:
            '당신은 정치 뉴스의 감정을 분석하는 전문가입니다. 감정 분석 결과를 다음 JSON 형식으로 제공해주세요: {"sentiment": "positive|neutral|negative", "reasoning": ["키워드1", "키워드2", "키워드3"]} 추가 설명 없이 JSON만 제공해주세요.',
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      response_format: { type: "text" }, // JSON 형식 제약 제거
    });

    const resultText = completion.choices[0]?.message?.content?.trim() || "";
    logger.info({ resultText }, "Raw model response");

    // 결과가 비어있으면 대체 분석 사용
    if (!resultText) {
      logger.warn("Empty result from API, using fallback method");
      return createFallbackSentimentAnalysis(text);
    }

    // 마크다운 코드 블록에서 JSON 추출
    const jsonText = extractJsonFromMarkdown(resultText);
    logger.info({ jsonText }, "Extracted JSON text");

    try {
      const result = JSON.parse(jsonText);
      const sentiment = result.sentiment as "positive" | "neutral" | "negative";
      const reasoning = Array.isArray(result.reasoning) ? result.reasoning : [];

      return { sentiment, reasoning };
    } catch (parseError) {
      logger.error(
        {
          parseError,
          resultText,
          jsonText: extractJsonFromMarkdown(resultText),
        },
        "Error parsing sentiment analysis result"
      );

      // 파싱 실패 시 정규식으로 결과 추출 시도
      const sentimentMatch = resultText.match(
        /["']sentiment["']\s*:\s*["'](\w+)["']/
      );
      const reasoningMatches = resultText.match(/["']([\w\s]+)["']/g);

      if (sentimentMatch) {
        const sentiment = sentimentMatch[1] as
          | "positive"
          | "neutral"
          | "negative";
        const reasoning = reasoningMatches
          ? reasoningMatches
              .map((m) => m.replace(/["']/g, "").trim())
              .filter(
                (r) =>
                  r !== "sentiment" &&
                  r !== "reasoning" &&
                  r !== "positive" &&
                  r !== "neutral" &&
                  r !== "negative"
              )
          : [];

        logger.info(
          {
            extractMethod: "regex",
            sentiment,
            reasoningCount: reasoning.length,
          },
          "Extracted sentiment using regex"
        );

        return { sentiment, reasoning };
      }

      // 정규식 추출도 실패하면 대체 분석 사용
      logger.info(
        "Using fallback sentiment analysis method due to parsing error"
      );
      return createFallbackSentimentAnalysis(text);
    }
  } catch (error: any) {
    // 오류를 더 자세히 로깅
    logger.error(
      {
        error: {
          name: error.name,
          message: error.message,
          status: error.status,
          headers: error.headers,
          response: error.response?.data,
          stack: error.stack,
        },
      },
      "Error analyzing sentiment with OpenRouter"
    );

    // API 오류 시 대체 분석 사용
    logger.info("Using fallback sentiment analysis method due to API error");
    return createFallbackSentimentAnalysis(text);
  }
};

export default {
  summarizeText,
  analyzeSentiment,
};
