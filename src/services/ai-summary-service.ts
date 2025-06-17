// src/services/ai-summary-service.ts
import OpenAI from "openai";
import supabaseClient from "../config/supabase-client";
import logger from "../utils/logger";
import dotenv from "dotenv";
import { Repository } from "./repository-service";

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
  id?: string;
  repository_id?: string;
  branch_name: string;
  project_intro: string;
  tech_stack: {
    frontend?: string[];
    backend?: string[];
    database?: string[];
    devops?: string[];
    testing?: string[];
    other?: string[];
  };
  refactoring_history: string;
  collaboration_flow: string;
  resume_bullets: Array<{
    title: string;
    content: string;
  }>;
  performance_metrics?: {
    commits_analyzed: number;
    prs_analyzed: number;
    files_analyzed: number;
    analysis_duration?: number;
  };
  created_at?: string;
  updated_at?: string;
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

    logger.info(`${commitMessages} 맞니?`);

    const prDescriptions = pullRequests
      .slice(0, 10)
      .map((pr) => `PR #${pr.pr_number}: ${pr.title} - ${pr.body}`)
      .join("\n");

    const prompt = `
      다음은 GitHub 레포지토리 "${repoName}"에 대한 정보입니다:
      
      README:
      ${readme}
      
      ${commitMessages && `최근 커밋 메시지: ${commitMessages}`}
      
      ${prDescriptions && `최근 PR 설명: ${prDescriptions}`}

      위 정보를 바탕으로 다음 주제에 대해 요약해주세요:
      
      1. 프로젝트 소개: 이 프로젝트가 무엇인지, 어떤 문제를 해결하는지 간략히 설명해주세요.
      2. 기술 스택: 이 프로젝트에서 사용된 주요 기술과 라이브러리를 나열해주세요.
      3. 리팩토링 내역: 코드 개선이나 리팩토링 관련 커밋을 분석하여 주요 변경 사항을 요약해주세요.
      4. 협업 흐름: PR과 커밋을 분석하여 팀의 협업 패턴과 워크플로우를 설명해주세요.
      5. 이력서용 bullet 정리: 이 프로젝트에서의 기여와 성과를 이력서에 적합한 bullet point로 정리해주세요.
    `;

    const completion = await openai.chat.completions.create({
      model: "deepseek/deepseek-r1-0528-qwen3-8b:free",
      messages: [
        {
          role: "system",
          content: `당신은 GitHub 레포지토리를 분석하는 전문가입니다. 
          주어진 정보를 바탕으로 정확하고 구조화된 분석 보고서를 작성해주세요.
          
          중요한 규칙:
          1. 제공된 형식을 정확히 따라주세요 (## 1. 프로젝트 소개, ## 2. 사용 언어 등)
          2. 실제 데이터에만 기반하여 작성하고, 추측하지 마세요
          3. 각 섹션을 완전히 작성한 후 다음 섹션으로 넘어가세요
          4. 이력서용 성과는 ### 성과 1:, ### 성과 2: 형식으로 작성하세요
          5. 간결하고 명확하게 작성하세요`,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
    });

    logger.info(`${JSON.stringify(completion)} completion`);

    // OpenRouter API 응답에서 실제 내용 추출
    let content: string | null = null;

    if (
      completion.choices &&
      completion.choices[0] &&
      completion.choices[0].message
    ) {
      content = completion.choices[0].message.content;
    } else {
      // 응답 구조가 다른 경우 전체 응답을 로깅
      logger.error({ completion }, "Unexpected API response structure");
      throw new Error("Invalid API response structure");
    }

    if (!content) {
      throw new Error("No content received from AI");
    }

    logger.info(`추출된 AI 응답 내용: ${content.substring(0, 200)}...`);

    // 응답을 파싱하여 각 섹션 추출 (마크다운 헤더 형태 처리)
    const sections = content.split(/###\s*\d+\.\s*/);
    const summary: RepositorySummary = {
      branch_name: "main", // 기본 브랜치
      project_intro: "",
      tech_stack: {},
      refactoring_history: "",
      collaboration_flow: "",
      resume_bullets: [],
    };

    // 섹션별로 내용 매핑
    sections.forEach((section, index) => {
      const cleanSection = section.trim();
      if (!cleanSection) return;

      logger.info(`섹션 ${index}: ${cleanSection.substring(0, 100)}...`);

      if (index === 0) {
        // 첫 번째 섹션은 보통 전체 응답의 시작 부분
        return;
      }

      if (cleanSection.includes("프로젝트 소개") || index === 1) {
        summary.project_intro = cleanSection
          .replace(/^프로젝트 소개[:\s]*/, "")
          .replace(/^.*프로젝트 소개[:\s]*/, "")
          .trim();
      } else if (cleanSection.includes("기술 스택") || index === 2) {
        const techStack = cleanSection
          .replace(/^기술 스택[:\s]*/, "")
          .replace(/^.*기술 스택[:\s]*/, "")
          .trim();
        summary.tech_stack = {
          frontend: techStack.split(/,?\s*frontend\s*[:-]\s*/).filter(Boolean),
          backend: techStack.split(/,?\s*backend\s*[:-]\s*/).filter(Boolean),
          database: techStack.split(/,?\s*database\s*[:-]\s*/).filter(Boolean),
          devops: techStack.split(/,?\s*devops\s*[:-]\s*/).filter(Boolean),
          testing: techStack.split(/,?\s*testing\s*[:-]\s*/).filter(Boolean),
          other: techStack.split(/,?\s*other\s*[:-]\s*/).filter(Boolean),
        };
      } else if (
        cleanSection.includes("아키텍처") ||
        cleanSection.includes("프로젝트 아키텍처") ||
        index === 3
      ) {
        const architectureContent = cleanSection
          .replace(/^.*아키텍처[:\s]*/, "")
          .replace(/^프로젝트 아키텍처[:\s]*/, "")
          .trim();
        summary.tech_stack.other = [architectureContent];
      } else if (
        cleanSection.includes("개발 과정") ||
        cleanSection.includes("리팩토링") ||
        index === 4
      ) {
        summary.refactoring_history = cleanSection
          .replace(/^.*리팩토링[:\s]*/, "")
          .replace(/^.*개발 과정[:\s]*/, "")
          .replace(/^개발 과정 및 리팩토링[:\s]*/, "")
          .trim();
      } else if (
        cleanSection.includes("협업") ||
        cleanSection.includes("프로세스") ||
        index === 5
      ) {
        summary.collaboration_flow = cleanSection
          .replace(/^.*협업[:\s]*/, "")
          .replace(/^.*프로세스[:\s]*/, "")
          .replace(/^협업 및 개발 프로세스[:\s]*/, "")
          .trim();
      } else if (
        cleanSection.includes("이력서") ||
        cleanSection.includes("성과") ||
        index === 6
      ) {
        const bulletContent = cleanSection
          .replace(/^.*이력서[:\s]*/, "")
          .replace(/^.*성과[:\s]*/, "")
          .replace(/^이력서용 성과 요약[:\s]*/, "")
          .trim();

        summary.resume_bullets.push({
          title:
            bulletContent.split("\n")[0] ||
            `성과 ${summary.resume_bullets.length + 1}`,
          content: bulletContent || "프로젝트 성과",
        });
      }
    });

    logger.info(`파싱된 요약:`, {
      project_intro: summary.project_intro.substring(0, 100),
      tech_stack: JSON.stringify(summary.tech_stack),
      refactoring_history: summary.refactoring_history.substring(0, 100),
      collaboration_flow: summary.collaboration_flow.substring(0, 100),
      resume_bullets: summary.resume_bullets.slice(0, 5).join(", "),
    });

    return summary;
  } catch (error) {
    logger.error({ error, repoName }, "Error generating repository summary");
    throw new Error("Failed to generate repository summary");
  }
};

/**
 * 레포지토리 요약 저장 (브랜치별)
 */
export const saveRepositorySummary = async (
  repositoryId: string,
  branchName: string,
  summary: RepositorySummary,
  performanceMetrics?: {
    commits_analyzed: number;
    prs_analyzed: number;
    files_analyzed: number;
    branch_total_files?: number;
    branch_languages?: number;
    top_languages?: any[];
    analysis_duration?: number;
  }
): Promise<string> => {
  try {
    logger.info("=== SAVE REPOSITORY SUMMARY START ===");
    logger.info({ repositoryId, branchName }, "Input parameters");

    // 데이터 타입 변환 및 검증
    const techStackJson =
      typeof summary.tech_stack === "object" ? summary.tech_stack : {};

    const resumeBulletsArray = Array.isArray(summary.resume_bullets)
      ? summary.resume_bullets
      : [];

    logger.info(
      {
        repositoryId,
        branchName,
        techStackType: typeof summary.tech_stack,
        resumeBulletsType: typeof summary.resume_bullets,
        resumeBulletsLength: resumeBulletsArray.length,
        projectIntroLength: summary.project_intro?.length || 0,
        refactoringHistoryLength: summary.refactoring_history?.length || 0,
        collaborationFlowLength: summary.collaboration_flow?.length || 0,
      },
      "Data validation complete"
    );

    // 저장할 데이터 객체 생성
    const dataToSave = {
      repository_id: repositoryId,
      branch_name: branchName,
      project_intro: summary.project_intro || "",
      tech_stack: techStackJson,
      refactoring_history: summary.refactoring_history || "",
      collaboration_flow: summary.collaboration_flow || "",
      resume_bullets: resumeBulletsArray,
      performance_metrics: performanceMetrics || {},
      updated_at: new Date().toISOString(),
    };

    logger.info({ dataToSave }, "Data prepared for saving");

    // 먼저 repository가 존재하는지 확인
    const { data: repoCheck, error: repoCheckError } = await supabaseClient
      .from("repositories")
      .select("id")
      .eq("id", repositoryId)
      .single();

    if (repoCheckError) {
      logger.error({ repoCheckError, repositoryId }, "Repository not found");
      throw new Error(`Repository not found: ${repositoryId}`);
    }

    logger.info({ repoCheck }, "Repository exists, proceeding with upsert");

    const { data, error } = await supabaseClient
      .from("repository_summaries")
      .upsert(dataToSave, { onConflict: "repository_id,branch_name" })
      .select("id")
      .single();

    if (error) {
      logger.error(
        {
          error,
          repositoryId,
          branchName,
          errorCode: error.code,
          errorMessage: error.message,
          errorDetails: error.details,
          errorHint: error.hint,
        },
        "Error saving repository summary"
      );
      throw new Error(`Failed to save repository summary: ${error.message}`);
    }

    logger.info(
      { repositoryId, branchName, summaryId: data.id },
      "Repository summary saved successfully"
    );

    logger.info("=== SAVE REPOSITORY SUMMARY END ===");
    return data.id;
  } catch (error) {
    logger.error(
      { error, repositoryId, branchName },
      "Exception when saving repository summary"
    );
    throw new Error("Failed to save repository summary");
  }
};

/**
 * 레포지토리 요약 가져오기 (브랜치별)
 */
export const getRepositorySummary = async (
  repositoryId: string,
  branchName: string = "main"
): Promise<RepositorySummary | null> => {
  try {
    const { data, error } = await supabaseClient
      .from("repository_summaries")
      .select("*")
      .eq("repository_id", repositoryId)
      .eq("branch_name", branchName)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        // No rows found
        return null;
      }
      logger.error(
        { error, repositoryId, branchName },
        "Error fetching repository summary"
      );
      throw new Error("Failed to fetch repository summary");
    }

    return data;
  } catch (error) {
    logger.error(
      { error, repositoryId, branchName },
      "Exception when fetching repository summary"
    );
    return null;
  }
};

/**
 * 레포지토리의 모든 브랜치 요약 목록 가져오기
 */
export const getRepositorySummariesByRepo = async (
  repositoryId: string
): Promise<RepositorySummary[]> => {
  try {
    const { data, error } = await supabaseClient
      .from("repository_summaries")
      .select("*")
      .eq("repository_id", repositoryId)
      .order("updated_at", { ascending: false });

    if (error) {
      logger.error(
        { error, repositoryId },
        "Error fetching repository summaries"
      );
      throw new Error("Failed to fetch repository summaries");
    }

    return data || [];
  } catch (error) {
    logger.error(
      { error, repositoryId },
      "Exception when fetching repository summaries"
    );
    return [];
  }
};

/**
 * 사용자의 모든 요약 목록 가져오기 (브랜치별)
 */
export const getUserRepositorySummaries = async (
  userId: string,
  limit: number = 50
): Promise<RepositorySummary[]> => {
  try {
    const { data, error } = await supabaseClient
      .from("repository_summaries")
      .select(
        `
        *,
        repositories!inner(
          id,
          name,
          owner,
          description,
          html_url,
          language,
          stars_count,
          forks_count
        )
      `
      )
      .eq("repositories.user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (error) {
      logger.error(
        { error, userId },
        "Error fetching user repository summaries"
      );
      throw new Error("Failed to fetch user repository summaries");
    }

    return data || [];
  } catch (error) {
    logger.error(
      { error, userId },
      "Exception when fetching user repository summaries"
    );
    return [];
  }
};

/**
 * Markdown 형식으로 요약 내보내기
 */
export const exportSummaryAsMarkdown = (summary: RepositorySummary): string => {
  let markdown = `# ${summary.project_intro}\n\n`;

  markdown += `## 기술 스택\n`;
  if (summary.tech_stack.frontend?.length) {
    markdown += `**Frontend:** ${summary.tech_stack.frontend.join(", ")}\n`;
  }
  if (summary.tech_stack.backend?.length) {
    markdown += `**Backend:** ${summary.tech_stack.backend.join(", ")}\n`;
  }
  if (summary.tech_stack.database?.length) {
    markdown += `**Database:** ${summary.tech_stack.database.join(", ")}\n`;
  }

  markdown += `\n## 리팩토링 히스토리\n${summary.refactoring_history}\n\n`;
  markdown += `## 협업 프로세스\n${summary.collaboration_flow}\n\n`;

  markdown += `## 주요 성과\n`;
  summary.resume_bullets.forEach((bullet) => {
    markdown += `### ${bullet.title}\n${bullet.content}\n\n`;
  });

  return markdown;
};

/**
 * Notion 블록 형식으로 요약 내보내기
 */
export const exportSummaryAsNotionBlocks = (
  summary: RepositorySummary
): any[] => {
  const blocks = [
    {
      type: "heading_1",
      heading_1: {
        rich_text: [
          {
            type: "text",
            text: { content: summary.project_intro },
          },
        ],
      },
    },
    {
      type: "heading_2",
      heading_2: {
        rich_text: [
          {
            type: "text",
            text: { content: "기술 스택" },
          },
        ],
      },
    },
    {
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: [
          {
            type: "text",
            text: {
              content: `Frontend: ${
                summary.tech_stack.frontend?.join(", ") || "없음"
              }`,
            },
          },
        ],
      },
    },
    {
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: [
          {
            type: "text",
            text: {
              content: `Backend: ${
                summary.tech_stack.backend?.join(", ") || "없음"
              }`,
            },
          },
        ],
      },
    },
    {
      type: "heading_2",
      heading_2: {
        rich_text: [
          {
            type: "text",
            text: { content: "주요 성과" },
          },
        ],
      },
    },
    ...summary.resume_bullets.map((bullet) => ({
      type: "heading_3",
      heading_3: {
        rich_text: [
          {
            type: "text",
            text: { content: bullet.title },
          },
        ],
      },
    })),
    ...summary.resume_bullets.map((bullet) => ({
      type: "paragraph",
      paragraph: {
        rich_text: [
          {
            type: "text",
            text: { content: bullet.content },
          },
        ],
      },
    })),
  ];

  return blocks;
};

/**
 * 파일 트리 구조를 분석하여 프로젝트 구조 요약 생성
 */
const analyzeProjectStructure = (tree: any[]): string => {
  const folders = new Set<string>();
  const fileExtensions = new Map<string, number>();
  const importantFiles: string[] = [];
  const frontendIndicators = new Set<string>();
  const backendIndicators = new Set<string>();
  const databaseFiles = new Set<string>();
  const configFiles = new Set<string>();

  tree.forEach((item) => {
    if (item.type === "tree") {
      folders.add(item.path);

      // 프론트엔드 폴더 패턴 감지
      const frontendFolders = [
        "src/components",
        "src/pages",
        "public",
        "static",
        "assets",
        "styles",
        "css",
      ];
      if (
        frontendFolders.some((pattern) =>
          item.path.toLowerCase().includes(pattern)
        )
      ) {
        frontendIndicators.add(`폴더: ${item.path}`);
      }

      // 백엔드 폴더 패턴 감지
      const backendFolders = [
        "src/routes",
        "src/controllers",
        "src/services",
        "src/models",
        "api",
        "server",
        "backend",
      ];
      if (
        backendFolders.some((pattern) =>
          item.path.toLowerCase().includes(pattern)
        )
      ) {
        backendIndicators.add(`폴더: ${item.path}`);
      }
    } else if (item.type === "blob") {
      const ext = item.path.split(".").pop()?.toLowerCase();
      const fileName = item.path.toLowerCase();

      if (ext) {
        fileExtensions.set(ext, (fileExtensions.get(ext) || 0) + 1);

        // 프론트엔드 파일 확장자
        const frontendExts = [
          "jsx",
          "tsx",
          "vue",
          "svelte",
          "html",
          "css",
          "scss",
          "sass",
          "less",
        ];
        if (frontendExts.includes(ext)) {
          frontendIndicators.add(`${ext} 파일`);
        }

        // 백엔드 파일 패턴
        const backendPatterns = [
          "controller",
          "service",
          "model",
          "route",
          "middleware",
          "handler",
        ];
        if (backendPatterns.some((pattern) => fileName.includes(pattern))) {
          backendIndicators.add(`${ext} 파일 (${fileName})`);
        }
      }

      // 중요한 파일들 식별
      const importantPatterns = [
        "package.json",
        "requirements.txt",
        "Dockerfile",
        "README",
        "tsconfig.json",
        "webpack.config",
        "vite.config",
        "next.config",
        "docker-compose",
        "Makefile",
        "go.mod",
        "Cargo.toml",
        "pom.xml",
      ];

      if (
        importantPatterns.some((pattern) =>
          fileName.includes(pattern.toLowerCase())
        )
      ) {
        importantFiles.push(item.path);
        configFiles.add(item.path);
      }

      // 데이터베이스 관련 파일
      const dbPatterns = [
        "migration",
        "schema",
        "seed",
        "database",
        ".sql",
        ".db",
      ];
      if (dbPatterns.some((pattern) => fileName.includes(pattern))) {
        databaseFiles.add(item.path);
      }
    }
  });

  const topFolders = Array.from(folders)
    .filter((folder) => !folder.includes("/"))
    .slice(0, 10);

  const topExtensions = Array.from(fileExtensions.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const projectType = determineProjectType(
    frontendIndicators,
    backendIndicators,
    fileExtensions,
    configFiles
  );

  return `
프로젝트 구조 분석:
- 프로젝트 타입: ${projectType}
- 주요 폴더: ${topFolders.join(", ")}
- 파일 확장자 분포: ${topExtensions
    .map(([ext, count]) => `${ext}(${count}개)`)
    .join(", ")}
- 프론트엔드 지표: ${
    frontendIndicators.size > 0
      ? Array.from(frontendIndicators).join(", ")
      : "없음"
  }
- 백엔드 지표: ${
    backendIndicators.size > 0
      ? Array.from(backendIndicators).join(", ")
      : "없음"
  }
- 데이터베이스 파일: ${
    databaseFiles.size > 0 ? Array.from(databaseFiles).join(", ") : "없음"
  }
- 중요 설정 파일: ${importantFiles.join(", ")}
- 총 파일 수: ${tree.filter((item) => item.type === "blob").length}개
`;
};

/**
 * 프로젝트 타입 결정
 */
const determineProjectType = (
  frontendIndicators: Set<string>,
  backendIndicators: Set<string>,
  fileExtensions: Map<string, number>,
  configFiles: Set<string>
): string => {
  const hasFrontend =
    frontendIndicators.size > 0 ||
    fileExtensions.has("jsx") ||
    fileExtensions.has("tsx") ||
    fileExtensions.has("vue") ||
    fileExtensions.has("html") ||
    fileExtensions.has("css") ||
    fileExtensions.has("scss") ||
    fileExtensions.has("sass");

  // 백엔드 판단을 더 엄격하게 - 실제 서버 관련 파일이 있는지 확인
  const hasBackendFiles = Array.from(configFiles).some(
    (file) =>
      file.toLowerCase().includes("server") ||
      file.toLowerCase().includes("api") ||
      file.toLowerCase().includes("express") ||
      file.toLowerCase().includes("fastify") ||
      file.toLowerCase().includes("koa")
  );

  const hasBackend =
    backendIndicators.size > 0 ||
    hasBackendFiles ||
    fileExtensions.has("py") ||
    fileExtensions.has("go") ||
    fileExtensions.has("java") ||
    fileExtensions.has("rs") ||
    fileExtensions.has("php") ||
    fileExtensions.has("rb");

  const hasPackageJson = Array.from(configFiles).some((file) =>
    file.includes("package.json")
  );
  const hasRequirementsTxt = Array.from(configFiles).some((file) =>
    file.includes("requirements.txt")
  );
  const hasGoMod = Array.from(configFiles).some((file) =>
    file.includes("go.mod")
  );

  // Vite, Webpack 등 프론트엔드 빌드 도구 감지
  const hasFrontendBuildTools = Array.from(configFiles).some(
    (file) =>
      file.includes("vite.config") ||
      file.includes("webpack.config") ||
      file.includes("next.config") ||
      file.includes("nuxt.config") ||
      file.includes("vue.config")
  );

  if (hasFrontend && hasBackend) {
    return "풀스택 웹 애플리케이션";
  } else if (hasFrontend && !hasBackend) {
    if (hasFrontendBuildTools) {
      return "프론트엔드 SPA (Single Page Application)";
    }
    return "프론트엔드 전용 애플리케이션";
  } else if (!hasFrontend && hasBackend) {
    if (hasPackageJson) return "Node.js 백엔드 API";
    if (hasRequirementsTxt) return "Python 백엔드 API";
    if (hasGoMod) return "Go 백엔드 API";
    return "백엔드 API 서버";
  } else {
    return "라이브러리/유틸리티 프로젝트";
  }
};

/**
 * 설정 파일들을 분석하여 기술 스택 추출 (더 정확한 분석)
 */
const analyzeTechStackFromFiles = (files: {
  [key: string]: string;
}): {
  detected: string[];
  frontend: string[];
  backend: string[];
  database: string[];
  devops: string[];
  testing: string[];
} => {
  const techStack = {
    detected: [] as string[],
    frontend: [] as string[],
    backend: [] as string[],
    database: [] as string[],
    devops: [] as string[],
    testing: [] as string[],
  };

  Object.entries(files).forEach(([path, content]) => {
    try {
      if (path.includes("package.json")) {
        const packageJson = JSON.parse(content);
        const deps = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies,
        };

        Object.keys(deps).forEach((dep) => {
          // 프론트엔드 프레임워크/라이브러리
          if (dep.includes("react") && !dep.includes("react-dom")) {
            techStack.frontend.push("React");
            techStack.detected.push("React");
          }
          if (dep.includes("vue")) {
            techStack.frontend.push("Vue.js");
            techStack.detected.push("Vue.js");
          }
          if (dep.includes("angular")) {
            techStack.frontend.push("Angular");
            techStack.detected.push("Angular");
          }
          if (dep.includes("next")) {
            techStack.frontend.push("Next.js");
            techStack.detected.push("Next.js");
          }
          if (dep.includes("nuxt")) {
            techStack.frontend.push("Nuxt.js");
            techStack.detected.push("Nuxt.js");
          }
          if (dep.includes("tailwind")) {
            techStack.frontend.push("Tailwind CSS");
            techStack.detected.push("Tailwind CSS");
          }

          // 백엔드 프레임워크
          if (dep.includes("express")) {
            techStack.backend.push("Express.js");
            techStack.detected.push("Express.js");
          }
          if (dep.includes("fastify")) {
            techStack.backend.push("Fastify");
            techStack.detected.push("Fastify");
          }
          if (dep.includes("koa")) {
            techStack.backend.push("Koa.js");
            techStack.detected.push("Koa.js");
          }
          if (dep.includes("nestjs") || dep.includes("@nestjs")) {
            techStack.backend.push("NestJS");
            techStack.detected.push("NestJS");
          }

          // 데이터베이스
          if (dep.includes("prisma")) {
            techStack.database.push("Prisma ORM");
            techStack.detected.push("Prisma");
          }
          if (dep.includes("typeorm")) {
            techStack.database.push("TypeORM");
            techStack.detected.push("TypeORM");
          }
          if (dep.includes("mongoose")) {
            techStack.database.push("MongoDB (Mongoose)");
            techStack.detected.push("MongoDB");
          }
          if (dep.includes("pg") || dep.includes("postgres")) {
            techStack.database.push("PostgreSQL");
            techStack.detected.push("PostgreSQL");
          }
          if (dep.includes("mysql")) {
            techStack.database.push("MySQL");
            techStack.detected.push("MySQL");
          }
          if (dep.includes("supabase")) {
            techStack.database.push("Supabase");
            techStack.detected.push("Supabase");
          }

          // 개발 도구
          if (dep.includes("typescript")) {
            // TypeScript는 언어이므로 기술 스택에서 제외
            techStack.detected.push("TypeScript");
          }

          // 테스팅
          if (dep.includes("jest")) {
            techStack.testing.push("Jest");
            techStack.detected.push("Jest");
          }
          if (dep.includes("cypress")) {
            techStack.testing.push("Cypress");
            techStack.detected.push("Cypress");
          }
          if (dep.includes("vitest")) {
            techStack.testing.push("Vitest");
            techStack.detected.push("Vitest");
          }
        });
      }

      if (path.includes("requirements.txt")) {
        const lines = content.split("\n");
        lines.forEach((line) => {
          if (line.includes("django")) {
            techStack.backend.push("Django");
            techStack.detected.push("Django");
          }
          if (line.includes("flask")) {
            techStack.backend.push("Flask");
            techStack.detected.push("Flask");
          }
          if (line.includes("fastapi")) {
            techStack.backend.push("FastAPI");
            techStack.detected.push("FastAPI");
          }
          if (line.includes("pandas")) {
            techStack.backend.push("Pandas");
            techStack.detected.push("Pandas");
          }
          if (line.includes("numpy")) {
            techStack.backend.push("NumPy");
            techStack.detected.push("NumPy");
          }
        });
      }

      if (path.includes("Dockerfile")) {
        if (content.includes("FROM node")) {
          techStack.backend.push("Node.js");
          techStack.detected.push("Node.js");
        }
        if (content.includes("FROM python")) {
          techStack.backend.push("Python");
          techStack.detected.push("Python");
        }
        if (content.includes("FROM nginx")) {
          techStack.devops.push("Nginx");
          techStack.detected.push("Nginx");
        }
        techStack.devops.push("Docker");
        techStack.detected.push("Docker");
      }

      if (path.includes("docker-compose")) {
        techStack.devops.push("Docker Compose");
        techStack.detected.push("Docker Compose");
        if (content.includes("postgres")) {
          techStack.database.push("PostgreSQL");
          techStack.detected.push("PostgreSQL");
        }
        if (content.includes("redis")) {
          techStack.database.push("Redis");
          techStack.detected.push("Redis");
        }
        if (content.includes("mongodb")) {
          techStack.database.push("MongoDB");
          techStack.detected.push("MongoDB");
        }
      }

      if (path.includes("go.mod")) {
        techStack.backend.push("Go");
        techStack.detected.push("Go");
      }

      if (path.includes("Cargo.toml")) {
        techStack.backend.push("Rust");
        techStack.detected.push("Rust");
      }
    } catch (error) {
      // JSON 파싱 에러 등은 무시
    }
  });

  // 중복 제거
  techStack.detected = [...new Set(techStack.detected)];
  techStack.frontend = [...new Set(techStack.frontend)];
  techStack.backend = [...new Set(techStack.backend)];
  techStack.database = [...new Set(techStack.database)];
  techStack.devops = [...new Set(techStack.devops)];
  techStack.testing = [...new Set(techStack.testing)];

  return techStack;
};

/**
 * 향상된 OpenRouter API를 사용하여 레포지토리 요약 생성 (파일 구조 포함)
 */
export const generateEnhancedRepositorySummary = async (
  repoName: string,
  readme: string,
  commits: any[],
  pullRequests: any[],
  tree: any[],
  importantFiles: { [key: string]: string },
  languages: { [key: string]: number }
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

    const projectStructure = analyzeProjectStructure(tree);
    const techStackFromFiles = analyzeTechStackFromFiles(importantFiles);

    const languageStats = Object.entries(languages)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([lang, bytes]) => `${lang}: ${Math.round(bytes / 1024)}KB`)
      .join(", ");

    const configFiles = Object.keys(importantFiles).slice(0, 5).join(", ");

    logger.info(`${projectStructure} projectStructure`);
    logger.info(`${languageStats} languageStats`);
    logger.info(`${configFiles} configFiles`);
    logger.info(`${commitMessages} commitMessages`);
    logger.info(`${prDescriptions} prDescriptions`);

    const prompt = `
GitHub 레포지토리 "${repoName}" 분석 요청

=== 분석 데이터 ===
README: ${readme}

프로젝트 구조: ${projectStructure}

언어 통계: ${languageStats}

감지된 기술 스택:
- 프론트엔드: ${techStackFromFiles.frontend.join(", ") || "없음"}
- 백엔드: ${techStackFromFiles.backend.join(", ") || "없음"}
- 데이터베이스: ${techStackFromFiles.database.join(", ") || "없음"}
- DevOps: ${techStackFromFiles.devops.join(", ") || "없음"}
- 테스팅: ${techStackFromFiles.testing.join(", ") || "없음"}

설정 파일: ${configFiles}
커밋 메시지: ${commitMessages}
PR 설명: ${prDescriptions}

=== 분석 요구사항 ===
다음 형식으로 정확히 응답해주세요. 각 섹션을 명확히 구분하여 작성하세요:

## 1. 프로젝트 소개
이 프로젝트의 목적, 주요 기능, 해결하는 문제를 2-3문장으로 설명하세요.

## 2. 사용 언어
언어 통계를 바탕으로 주요 프로그래밍 언어와 사용 비율을 나열하세요.
예: TypeScript (44%), SCSS (48%), CSS (6%)

## 3. 기술 스택
실제 감지된 프레임워크/라이브러리만 나열하세요:
- 프론트엔드: ${
      techStackFromFiles.frontend.length > 0
        ? techStackFromFiles.frontend.join(", ")
        : "없음"
    }
- 백엔드: ${
      techStackFromFiles.backend.length > 0
        ? techStackFromFiles.backend.join(", ")
        : "없음 (프론트엔드 전용)"
    }
- 데이터베이스: ${
      techStackFromFiles.database.length > 0
        ? techStackFromFiles.database.join(", ")
        : "없음"
    }
- DevOps: ${
      techStackFromFiles.devops.length > 0
        ? techStackFromFiles.devops.join(", ")
        : "없음"
    }
- 테스팅: ${
      techStackFromFiles.testing.length > 0
        ? techStackFromFiles.testing.join(", ")
        : "없음"
    }

## 4. 프로젝트 아키텍처
폴더 구조와 프로젝트 타입(프론트엔드 전용/풀스택/API 서버)을 설명하세요.

## 5. 개발 과정 및 리팩토링
커밋 메시지를 분석하여 주요 개발 과정과 개선 사항을 설명하세요.

## 6. 협업 및 개발 프로세스
개발 패턴과 프로세스를 분석하여 설명하세요.

## 7. 이력서용 성과 요약
다음 4가지 성과를 각각 1-2문장으로 작성하세요:

### 성과 1: 기술적 도전과 해결
UI/UX 구현, 상태 관리, API 연동 등의 기술적 문제 해결 경험

### 성과 2: 프로젝트 임팩트
사용자 경험 개선, 개발 효율성 향상 등의 성과

### 성과 3: 개인 기여도
프로젝트 기획, 설계, 구현, 배포 등 담당 역할

### 성과 4: 학습 경험
새로운 기술 습득이나 개발 방법론 적용 경험

중요: 각 섹션을 명확히 구분하고, 실제 데이터에 기반하여 작성하세요. 추측하지 마세요.
    `;

    logger.info(`${prompt} prompt`);

    const completion = await openai.chat.completions.create({
      model: "deepseek/deepseek-r1-0528-qwen3-8b:free",
      messages: [
        {
          role: "system",
          content: `당신은 GitHub 레포지토리를 분석하는 전문가입니다. 
          주어진 정보를 바탕으로 정확하고 구조화된 분석 보고서를 작성해주세요.
          
          중요한 규칙:
          1. 제공된 형식을 정확히 따라주세요 (## 1. 프로젝트 소개, ## 2. 사용 언어 등)
          2. 실제 데이터에만 기반하여 작성하고, 추측하지 마세요
          3. 각 섹션을 완전히 작성한 후 다음 섹션으로 넘어가세요
          4. 이력서용 성과는 ### 성과 1:, ### 성과 2: 형식으로 작성하세요
          5. 간결하고 명확하게 작성하세요`,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 3000,
    });

    logger.info(`${JSON.stringify(completion)} completion`);

    // OpenRouter API 응답에서 실제 내용 추출
    let content: string | null = null;

    if (
      completion.choices &&
      completion.choices[0] &&
      completion.choices[0].message
    ) {
      content = completion.choices[0].message.content;
    } else {
      // 응답 구조가 다른 경우 전체 응답을 로깅
      logger.error({ completion }, "Unexpected API response structure");
      throw new Error("Invalid API response structure");
    }

    if (!content) {
      throw new Error("No content received from AI");
    }

    logger.info(`추출된 AI 응답 내용: ${content.substring(0, 200)}...`);

    // 기본 요약 객체 생성
    const summary: RepositorySummary = {
      branch_name: "main",
      project_intro: "",
      tech_stack: {
        frontend: [],
        backend: [],
        database: [],
        devops: [],
        testing: [],
        other: [],
      },
      refactoring_history: "",
      collaboration_flow: "",
      resume_bullets: [],
    };

    try {
      // AI 응답을 더 안전하게 파싱
      const lines = content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      let currentSection = "";
      let sectionContent: string[] = [];

      for (const line of lines) {
        // 섹션 헤더 감지 (더 명확한 패턴)
        if (line.match(/^##\s*1\.\s*프로젝트\s*소개/i)) {
          if (currentSection && sectionContent.length > 0) {
            processSection(
              currentSection,
              sectionContent.join(" "),
              summary,
              techStackFromFiles
            );
          }
          currentSection = "project_intro";
          sectionContent = [];
        } else if (line.match(/^##\s*2\.\s*사용\s*언어/i)) {
          if (currentSection && sectionContent.length > 0) {
            processSection(
              currentSection,
              sectionContent.join(" "),
              summary,
              techStackFromFiles
            );
          }
          currentSection = "languages";
          sectionContent = [];
        } else if (line.match(/^##\s*3\.\s*기술\s*스택/i)) {
          if (currentSection && sectionContent.length > 0) {
            processSection(
              currentSection,
              sectionContent.join(" "),
              summary,
              techStackFromFiles
            );
          }
          currentSection = "tech_stack";
          sectionContent = [];
        } else if (line.match(/^##\s*4\.\s*프로젝트\s*아키텍처/i)) {
          if (currentSection && sectionContent.length > 0) {
            processSection(
              currentSection,
              sectionContent.join(" "),
              summary,
              techStackFromFiles
            );
          }
          currentSection = "architecture";
          sectionContent = [];
        } else if (line.match(/^##\s*5\.\s*개발\s*과정/i)) {
          if (currentSection && sectionContent.length > 0) {
            processSection(
              currentSection,
              sectionContent.join(" "),
              summary,
              techStackFromFiles
            );
          }
          currentSection = "refactoring_history";
          sectionContent = [];
        } else if (line.match(/^##\s*6\.\s*협업/i)) {
          if (currentSection && sectionContent.length > 0) {
            processSection(
              currentSection,
              sectionContent.join(" "),
              summary,
              techStackFromFiles
            );
          }
          currentSection = "collaboration_flow";
          sectionContent = [];
        } else if (line.match(/^##\s*7\.\s*이력서용\s*성과/i)) {
          if (currentSection && sectionContent.length > 0) {
            processSection(
              currentSection,
              sectionContent.join(" "),
              summary,
              techStackFromFiles
            );
          }
          currentSection = "resume_bullets";
          sectionContent = [];
        } else if (currentSection && !line.match(/^##/)) {
          // 현재 섹션의 내용 수집 (하위 헤더 포함)
          sectionContent.push(line);
        }
      }

      // 마지막 섹션 처리
      if (currentSection && sectionContent.length > 0) {
        processSection(
          currentSection,
          sectionContent.join(" "),
          summary,
          techStackFromFiles
        );
      }

      // 파싱이 실패한 경우 전체 내용을 project_intro에 저장
      if (
        !summary.project_intro &&
        !summary.tech_stack.frontend?.length &&
        !summary.refactoring_history
      ) {
        // 더 나은 기본값 설정
        const contentLines = content.split("\n").filter((line) => line.trim());

        // 프로젝트 소개 부분 찾기
        const introStart = contentLines.findIndex(
          (line) =>
            line.includes("프로젝트 소개") ||
            line.includes("Project Introduction")
        );

        if (introStart >= 0 && introStart + 1 < contentLines.length) {
          summary.project_intro =
            contentLines
              .slice(introStart + 1, introStart + 4)
              .join(" ")
              .trim() || `${repoName} 프로젝트`;
        } else {
          summary.project_intro = `${repoName} 프로젝트 - GitHub 레포지토리 분석`;
        }

        summary.tech_stack = {
          frontend:
            techStackFromFiles.frontend.length > 0
              ? techStackFromFiles.frontend
              : [],
          backend:
            techStackFromFiles.backend.length > 0
              ? techStackFromFiles.backend
              : [],
          database:
            techStackFromFiles.database.length > 0
              ? techStackFromFiles.database
              : [],
          devops:
            techStackFromFiles.devops.length > 0
              ? techStackFromFiles.devops
              : [],
          testing:
            techStackFromFiles.testing.length > 0
              ? techStackFromFiles.testing
              : [],
          other: [`언어 통계: ${languageStats}`],
        };

        summary.refactoring_history = commitMessages
          ? `주요 커밋 내역: ${commitMessages.substring(0, 200)}...`
          : "개발 과정 분석 필요";

        summary.collaboration_flow = prDescriptions
          ? `PR 분석: ${prDescriptions.substring(0, 200)}...`
          : "개인 프로젝트로 추정";

        summary.resume_bullets = [
          {
            title: "프로젝트 개발 완료",
            content: `${repoName} 프로젝트를 성공적으로 개발하고 배포했습니다.`,
          },
          {
            title: "기술 스택 활용",
            content: `${
              techStackFromFiles.detected.join(", ") || "다양한 기술"
            }을 활용하여 프로젝트를 구현했습니다.`,
          },
        ];
      }
    } catch (parseError) {
      logger.error({ parseError }, "Error parsing AI response");

      // 파싱 실패 시 기본값 설정
      summary.project_intro =
        content.substring(0, 500) || `${repoName} 프로젝트 분석`;
      summary.tech_stack = {
        frontend:
          techStackFromFiles.frontend.length > 0
            ? techStackFromFiles.frontend
            : [],
        backend:
          techStackFromFiles.backend.length > 0
            ? techStackFromFiles.backend
            : [],
        database:
          techStackFromFiles.database.length > 0
            ? techStackFromFiles.database
            : [],
        devops:
          techStackFromFiles.devops.length > 0 ? techStackFromFiles.devops : [],
        testing:
          techStackFromFiles.testing.length > 0
            ? techStackFromFiles.testing
            : [],
        other:
          techStackFromFiles.detected.length > 0
            ? [techStackFromFiles.detected.join(", ")]
            : ["기술 스택 분석 필요"],
      };
      summary.refactoring_history = "상세 분석이 필요합니다.";
      summary.collaboration_flow = "협업 프로세스 분석이 필요합니다.";
      summary.resume_bullets = [
        {
          title: "프로젝트 기본 분석 완료",
          content: "프로젝트에 대한 기본적인 분석이 완료되었습니다.",
        },
      ];
    }

    logger.info(`파싱된 요약:`, {
      project_intro: summary.project_intro.substring(0, 100),
      tech_stack: JSON.stringify(summary.tech_stack),
      refactoring_history: summary.refactoring_history.substring(0, 100),
      collaboration_flow: summary.collaboration_flow.substring(0, 100),
      resume_bullets: summary.resume_bullets.slice(0, 3).map((b) => b.title),
    });

    return summary;
  } catch (error) {
    logger.error(
      { error, repoName },
      "Error generating enhanced repository summary"
    );
    throw new Error("Failed to generate enhanced repository summary");
  }
};

// 섹션별 내용 처리 함수 (개선된 버전)
const processSection = (
  sectionType: string,
  content: string,
  summary: RepositorySummary,
  detectedTechStack?: {
    detected: string[];
    frontend: string[];
    backend: string[];
    database: string[];
    devops: string[];
    testing: string[];
  }
) => {
  const cleanContent = content.trim();

  switch (sectionType) {
    case "project_intro":
      summary.project_intro = cleanContent;
      break;

    case "languages":
      // 사용 언어 정보를 tech_stack.other에 저장
      if (summary.tech_stack.other) {
        summary.tech_stack.other.push(`사용 언어: ${cleanContent}`);
      } else {
        summary.tech_stack.other = [`사용 언어: ${cleanContent}`];
      }
      break;

    case "tech_stack":
      // 실제 감지된 기술 스택을 우선 사용
      if (detectedTechStack) {
        summary.tech_stack = {
          frontend:
            detectedTechStack.frontend.length > 0
              ? detectedTechStack.frontend
              : [],
          backend:
            detectedTechStack.backend.length > 0
              ? detectedTechStack.backend
              : [],
          database:
            detectedTechStack.database.length > 0
              ? detectedTechStack.database
              : [],
          devops:
            detectedTechStack.devops.length > 0 ? detectedTechStack.devops : [],
          testing:
            detectedTechStack.testing.length > 0
              ? detectedTechStack.testing
              : [],
          other: summary.tech_stack.other || [],
        };
      }
      break;

    case "architecture":
      if (summary.tech_stack.other) {
        summary.tech_stack.other.push(`아키텍처: ${cleanContent}`);
      } else {
        summary.tech_stack.other = [`아키텍처: ${cleanContent}`];
      }
      break;

    case "refactoring_history":
      summary.refactoring_history = cleanContent;
      break;

    case "collaboration_flow":
      summary.collaboration_flow = cleanContent;
      break;

    case "resume_bullets":
      // ### 형식의 성과 섹션 파싱
      const achievementSections = cleanContent.split(/###\s*성과\s*\d+:/);
      const bullets: Array<{ title: string; content: string }> = [];

      achievementSections.forEach((section, index) => {
        if (index === 0) return; // 첫 번째는 빈 문자열

        const lines = section
          .trim()
          .split("\n")
          .filter((line) => line.trim());
        if (lines.length === 0) return;

        const title = lines[0].trim();
        const content = lines.slice(1).join(" ").trim();

        if (title && content) {
          bullets.push({
            title: title.length > 80 ? title.substring(0, 80) + "..." : title,
            content:
              content.length > 200
                ? content.substring(0, 200) + "..."
                : content,
          });
        }
      });

      // ### 형식으로 파싱이 안 된 경우 기존 방식 사용
      if (bullets.length === 0) {
        // 텍스트를 의미있는 단위로 분리
        let fallbackBullets: string[] = [];

        // 먼저 불릿 포인트 기호로 분리 시도
        if (
          cleanContent.includes("•") ||
          cleanContent.includes("-") ||
          cleanContent.includes("*")
        ) {
          fallbackBullets = cleanContent
            .split(/[•\-\*]/)
            .map((bullet) => bullet.trim())
            .filter((bullet) => bullet.length > 10);
        }
        // 불릿 포인트가 없으면 문장 단위로 분리
        else {
          // 콜론(:)을 기준으로 주요 섹션 분리
          const sections = cleanContent
            .split(/:\s*/)
            .filter((section) => section.trim().length > 0);

          if (sections.length > 1) {
            // 콜론으로 분리된 섹션들을 처리
            for (let i = 0; i < sections.length - 1; i++) {
              const title =
                sections[i].split(/[.!?]/).pop()?.trim() || sections[i].trim();
              const content =
                sections[i + 1].split(/[.!?]/)[0]?.trim() ||
                sections[i + 1].trim();

              if (title && content && title.length > 3 && content.length > 3) {
                fallbackBullets.push(`${title}: ${content}`);
              }
            }
          } else {
            // 마침표나 느낌표로 문장 분리
            fallbackBullets = cleanContent
              .split(/[.!?]/)
              .map((sentence) => sentence.trim())
              .filter((sentence) => sentence.length > 20);
          }
        }

        // fallbackBullets가 여전히 비어있으면 전체 텍스트를 하나의 bullet으로
        if (fallbackBullets.length === 0) {
          fallbackBullets = [cleanContent];
        }

        summary.resume_bullets = fallbackBullets.map((bullet, index) => {
          // 콜론이 있으면 콜론 앞을 title로, 뒤를 content로
          if (bullet.includes(":")) {
            const [title, ...contentParts] = bullet.split(":");
            return {
              title: title.trim() || `성과 ${index + 1}`,
              content: contentParts.join(":").trim() || title.trim(),
            };
          }
          // 콜론이 없으면 첫 번째 문장을 title로, 나머지를 content로
          else {
            const sentences = bullet.split(/[.!?]/).filter((s) => s.trim());
            const title = sentences[0]?.trim() || `성과 ${index + 1}`;
            const content =
              sentences.slice(1).join(". ").trim() || bullet.trim();

            return {
              title: title.length > 80 ? title.substring(0, 80) : title,
              content: content || bullet.trim(),
            };
          }
        });
      } else {
        summary.resume_bullets = bullets;
      }

      // 빈 배열인 경우 기본값 설정
      if (summary.resume_bullets.length === 0) {
        summary.resume_bullets = [
          {
            title: "프로젝트 완료",
            content: cleanContent || "프로젝트 분석이 완료되었습니다.",
          },
        ];
      }
      break;
  }
};

/**
 * 사용자별 저장된 레포지토리 요약 개수 조회
 */
export const getUserRepositorySummaryCounts = async (
  user_id: string
): Promise<{ user_id: string; count: number }> => {
  try {
    const { count, error } = await supabaseClient
      .from("repository_summaries")
      .select("*, repositories!inner(user_id)", { count: "exact", head: true })
      .eq("repositories.user_id", user_id);

    if (error) {
      logger.error({ error }, "Error fetching repository summary counts");
      throw error;
    }

    return { user_id, count: count || 0 };
  } catch (error) {
    logger.error(
      { error },
      "Exception when fetching repository summary counts"
    );
    return { user_id, count: 0 };
  }
};

/**
 * 사용자별 이번 달 저장된 레포지토리 요약 개수 조회
 */
export const getUserMonthlyRepositorySummaryCounts = async (
  user_id: string
): Promise<{ user_id: string; count: number }> => {
  try {
    const { count, error } = await supabaseClient
      .from("repository_summaries")
      .select("*, repositories!inner(user_id)", { count: "exact", head: true })
      .eq("repositories.user_id", user_id)
      .gte(
        "created_at",
        new Date(
          new Date().getFullYear(),
          new Date().getMonth(),
          1
        ).toISOString()
      )
      .lt(
        "created_at",
        new Date(
          new Date().getFullYear(),
          new Date().getMonth() + 1,
          1
        ).toISOString()
      );

    if (error) {
      logger.error(
        { error },
        "Error fetching monthly repository summary counts"
      );
      throw error;
    }

    return { user_id, count: count || 0 };
  } catch (error) {
    logger.error(
      { error },
      "Exception when fetching monthly repository summary counts"
    );
    return { user_id, count: 0 };
  }
};

export const getUserRepositorySummary = async (
  user_id: string
): Promise<
  | {
      name: string;
      language: string;
      owner: string;
      updated_at: string;
      description: string;
    }[]
  | undefined
> => {
  try {
    const { data, error } = await supabaseClient
      .from("repositories")
      .select("name, language, owner, updated_at, description, created_at")
      .eq("user_id", user_id)
      .limit(3)
      .order("updated_at", { ascending: false });

    if (error) {
      logger.error({ error }, "Error fetching repository summary");
      throw error;
    }

    return data;
  } catch (error) {
    logger.error({ error }, "Error fetching repository summary");
    throw error;
  }
};

/**
 * 사용자별 고유 GitHub 레포지토리 요약 개수 조회 (직접 SQL 쿼리)
 */
export const getUserUniqueRepoSummaryCounts = async (
  user_id: string
): Promise<
  | {
      user_id: string;
      summary_count: number;
    }
  | undefined
> => {
  try {
    // Supabase에서 직접 조인 쿼리 실행
    const { data, error } = await supabaseClient
      .from("repository_summaries")
      .select(
        `
        repositories!inner(
          user_id,
          github_repo_id
        )
      `
      )
      .eq("repositories.user_id", user_id);

    if (error) {
      logger.error(
        { error },
        "Error executing query for user repo summary counts"
      );
      return undefined;
    }

    if (!data || data.length === 0) {
      return { user_id, summary_count: 0 };
    }

    // COUNT(DISTINCT github_repo_id) 처리
    const uniqueRepoIds = new Set<number>();
    data.forEach((item: any) => {
      uniqueRepoIds.add(item.repositories.github_repo_id);
    });

    return {
      user_id,
      summary_count: uniqueRepoIds.size,
    };
  } catch (error) {
    logger.error({ error }, "Exception in getUserUniqueRepoSummaryCounts");
    return undefined;
  }
};

export default {
  generateRepositorySummary,
  saveRepositorySummary,
  getRepositorySummary,
  getRepositorySummariesByRepo,
  getUserRepositorySummaries,
  exportSummaryAsMarkdown,
  exportSummaryAsNotionBlocks,
  generateEnhancedRepositorySummary,
  getUserRepositorySummaryCounts,
  getUserMonthlyRepositorySummaryCounts,
  getUserRepositorySummary,
  getUserUniqueRepoSummaryCounts,
};
