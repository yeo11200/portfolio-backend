// src/services/ai-summary-service.ts
import OpenAI from "openai";
import supabaseClient from "../config/supabase-client";
import logger from "../utils/logger";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.OPENROUTER_API_KEY;

if (!apiKey) {
  throw new Error(
    "OpenRouter API key must be defined in environment variables"
  );
}

// OpenRouter 클라이언트 생성 (OpenAI SDK 호환)
const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey,
  defaultHeaders: {
    "HTTP-Referer": "https://portfolio-backend.example.com", // 사이트 URL
    "X-Title": "Portfolio Repository Summary Analysis", // 사이트 이름
  },
});

export interface RepositorySummary {
  project_intro: string;
  tech_stack: string;
  refactoring_history: string;
  collaboration_flow: string;
  resume_bullets: string;
}

/**
 * OpenRouter API를 사용하여 레포지토리 요약 생성
 */
export const generateRepositorySummary = async (
  repoName: string,
  readme: string,
  commits: any[],
  pullRequests: any[]
): Promise<RepositorySummary> => {
  try {
    const commitMessages = commits
      .slice(0, 20)
      .map((commit) => commit.commit_message)
      .join("\n");

    const prDescriptions = pullRequests
      .slice(0, 10)
      .map((pr) => `PR #${pr.pr_number}: ${pr.title} - ${pr.body}`)
      .join("\n");

    const prompt = `
      다음은 GitHub 레포지토리 "${repoName}"에 대한 정보입니다:
      
      README:
      ${readme}
      
      최근 커밋 메시지:
      ${commitMessages}
      
      최근 PR 설명:
      ${prDescriptions}
      
      위 정보를 바탕으로 다음 주제에 대해 요약해주세요:
      
      1. 프로젝트 소개: 이 프로젝트가 무엇인지, 어떤 문제를 해결하는지 간략히 설명해주세요.
      2. 기술 스택: 이 프로젝트에서 사용된 주요 기술과 라이브러리를 나열해주세요.
      3. 리팩토링 내역: 코드 개선이나 리팩토링 관련 커밋을 분석하여 주요 변경 사항을 요약해주세요.
      4. 협업 흐름: PR과 커밋을 분석하여 팀의 협업 패턴과 워크플로우를 설명해주세요.
      5. 이력서용 bullet 정리: 이 프로젝트에서의 기여와 성과를 이력서에 적합한 bullet point로 정리해주세요.
    `;

    const completion = await openai.chat.completions.create({
      model: "openai/gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "당신은 GitHub 레포지토리를 분석하고 요약하는 전문가입니다. 주어진 정보를 바탕으로 명확하고 간결한 요약을 제공해주세요.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
    });

    const content = completion.choices[0].message.content;

    if (!content) {
      throw new Error("No content received from AI");
    }

    // 응답을 파싱하여 각 섹션 추출
    const sections = content.split("\n\n");
    const summary: RepositorySummary = {
      project_intro: "",
      tech_stack: "",
      refactoring_history: "",
      collaboration_flow: "",
      resume_bullets: "",
    };

    let currentSection = "";
    for (const section of sections) {
      if (section.includes("프로젝트 소개:")) {
        currentSection = "project_intro";
        summary[currentSection as keyof RepositorySummary] = section
          .replace("프로젝트 소개:", "")
          .trim();
      } else if (section.includes("기술 스택:")) {
        currentSection = "tech_stack";
        summary[currentSection as keyof RepositorySummary] = section
          .replace("기술 스택:", "")
          .trim();
      } else if (section.includes("리팩토링 내역:")) {
        currentSection = "refactoring_history";
        summary[currentSection as keyof RepositorySummary] = section
          .replace("리팩토링 내역:", "")
          .trim();
      } else if (section.includes("협업 흐름:")) {
        currentSection = "collaboration_flow";
        summary[currentSection as keyof RepositorySummary] = section
          .replace("협업 흐름:", "")
          .trim();
      } else if (section.includes("이력서용 bullet 정리:")) {
        currentSection = "resume_bullets";
        summary[currentSection as keyof RepositorySummary] = section
          .replace("이력서용 bullet 정리:", "")
          .trim();
      } else if (currentSection && section.trim()) {
        summary[currentSection as keyof RepositorySummary] +=
          "\n" + section.trim();
      }
    }

    return summary;
  } catch (error) {
    logger.error({ error, repoName }, "Error generating repository summary");
    throw new Error("Failed to generate repository summary");
  }
};

/**
 * 레포지토리 요약 저장
 */
export const saveRepositorySummary = async (
  repositoryId: string,
  summary: RepositorySummary
): Promise<string> => {
  try {
    const { data, error } = await supabaseClient
      .from("repository_summaries")
      .upsert(
        {
          repository_id: repositoryId,
          project_intro: summary.project_intro,
          tech_stack: summary.tech_stack,
          refactoring_history: summary.refactoring_history,
          collaboration_flow: summary.collaboration_flow,
          resume_bullets: summary.resume_bullets,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "repository_id" }
      )
      .select("id")
      .single();

    if (error) {
      logger.error({ error, repositoryId }, "Error saving repository summary");
      throw new Error("Failed to save repository summary");
    }

    return data.id;
  } catch (error) {
    logger.error(
      { error, repositoryId },
      "Exception when saving repository summary"
    );
    throw new Error("Failed to save repository summary");
  }
};

/**
 * 레포지토리 요약 가져오기
 */
export const getRepositorySummary = async (
  repositoryId: string
): Promise<RepositorySummary | null> => {
  try {
    const { data, error } = await supabaseClient
      .from("repository_summaries")
      .select("*")
      .eq("repository_id", repositoryId)
      .single();

    if (error) {
      logger.error(
        { error, repositoryId },
        "Error fetching repository summary"
      );
      return null;
    }

    return data;
  } catch (error) {
    logger.error(
      { error, repositoryId },
      "Exception when fetching repository summary"
    );
    return null;
  }
};

/**
 * Markdown 형식으로 요약 내보내기
 */
export const exportSummaryAsMarkdown = (summary: RepositorySummary): string => {
  return `# 프로젝트 소개
${summary.project_intro}

# 기술 스택
${summary.tech_stack}

# 리팩토링 내역
${summary.refactoring_history}

# 협업 흐름
${summary.collaboration_flow}

# 이력서용 bullet 정리
${summary.resume_bullets}
`;
};

/**
 * Notion 블록 형식으로 요약 내보내기
 */
export const exportSummaryAsNotionBlocks = (
  summary: RepositorySummary
): any[] => {
  return [
    {
      object: "block",
      type: "heading_1",
      heading_1: {
        rich_text: [{ type: "text", text: { content: "프로젝트 소개" } }],
      },
    },
    {
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "text", text: { content: summary.project_intro } }],
      },
    },
    {
      object: "block",
      type: "heading_1",
      heading_1: {
        rich_text: [{ type: "text", text: { content: "기술 스택" } }],
      },
    },
    {
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "text", text: { content: summary.tech_stack } }],
      },
    },
    {
      object: "block",
      type: "heading_1",
      heading_1: {
        rich_text: [{ type: "text", text: { content: "리팩토링 내역" } }],
      },
    },
    {
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [
          { type: "text", text: { content: summary.refactoring_history } },
        ],
      },
    },
    {
      object: "block",
      type: "heading_1",
      heading_1: {
        rich_text: [{ type: "text", text: { content: "협업 흐름" } }],
      },
    },
    {
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [
          { type: "text", text: { content: summary.collaboration_flow } },
        ],
      },
    },
    {
      object: "block",
      type: "heading_1",
      heading_1: {
        rich_text: [
          { type: "text", text: { content: "이력서용 bullet 정리" } },
        ],
      },
    },
    {
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [
          { type: "text", text: { content: summary.resume_bullets } },
        ],
      },
    },
  ];
};

export default {
  generateRepositorySummary,
  saveRepositorySummary,
  getRepositorySummary,
  exportSummaryAsMarkdown,
  exportSummaryAsNotionBlocks,
};
