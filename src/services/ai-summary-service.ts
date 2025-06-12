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
    fileExtensions.has("html");

  const hasBackend =
    backendIndicators.size > 0 ||
    fileExtensions.has("js") ||
    fileExtensions.has("ts") ||
    fileExtensions.has("py") ||
    fileExtensions.has("go") ||
    fileExtensions.has("java") ||
    fileExtensions.has("rs");

  const hasPackageJson = Array.from(configFiles).some((file) =>
    file.includes("package.json")
  );
  const hasRequirementsTxt = Array.from(configFiles).some((file) =>
    file.includes("requirements.txt")
  );
  const hasGoMod = Array.from(configFiles).some((file) =>
    file.includes("go.mod")
  );

  if (hasFrontend && hasBackend) {
    return "풀스택 웹 애플리케이션";
  } else if (hasFrontend && !hasBackend) {
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
            techStack.backend.push("TypeScript");
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
      다음은 GitHub 레포지토리 "${repoName}"에 대한 상세 분석 정보입니다:
      
      README:
      ${readme}
      
      프로젝트 구조:
      ${projectStructure}
      
      언어 통계:
      ${languageStats}
      
      실제 감지된 기술 스택:
      - 전체: ${techStackFromFiles.detected.join(", ") || "없음"}
      - 프론트엔드: ${techStackFromFiles.frontend.join(", ") || "없음"}
      - 백엔드: ${techStackFromFiles.backend.join(", ") || "없음"}
      - 데이터베이스: ${techStackFromFiles.database.join(", ") || "없음"}
      - DevOps: ${techStackFromFiles.devops.join(", ") || "없음"}
      - 테스팅: ${techStackFromFiles.testing.join(", ") || "없음"}
      
      주요 설정 파일들:
      ${configFiles}
      
      최근 커밋 메시지:
      ${commitMessages}
      
      최근 PR 설명:
      ${prDescriptions}
      
      **중요 지침:**
      - 위에서 "실제 감지된 기술 스택"에 나열된 기술만 사용하세요
      - 프론트엔드 기술이 "없음"으로 표시되면 프론트엔드 관련 내용을 포함하지 마세요
      - 백엔드 기술이 "없음"으로 표시되면 백엔드 관련 내용을 포함하지 마세요
      - 실제로 존재하지 않는 기술을 추측하거나 가정하지 마세요
      
      위 정보를 바탕으로 다음 주제에 대해 **실제 감지된 기술만을 사용하여** 요약해주세요:
      
      1. 프로젝트 소개: 이 프로젝트가 무엇인지, 어떤 문제를 해결하는지, 주요 기능은 무엇인지 설명해주세요.
      
      2. 기술 스택: 
         **오직 위에서 감지된 기술만 언급하세요:**
         ${
           techStackFromFiles.frontend.length > 0
             ? `- 프론트엔드: ${techStackFromFiles.frontend.join(", ")}`
             : ""
         }
         ${
           techStackFromFiles.backend.length > 0
             ? `- 백엔드: ${techStackFromFiles.backend.join(", ")}`
             : ""
         }
         ${
           techStackFromFiles.database.length > 0
             ? `- 데이터베이스: ${techStackFromFiles.database.join(", ")}`
             : ""
         }
         ${
           techStackFromFiles.devops.length > 0
             ? `- DevOps: ${techStackFromFiles.devops.join(", ")}`
             : ""
         }
         ${
           techStackFromFiles.testing.length > 0
             ? `- 테스팅: ${techStackFromFiles.testing.join(", ")}`
             : ""
         }
      
      3. 프로젝트 아키텍처:
         - 폴더 구조의 특징
         - 코드 구성 방식
         - 설계 패턴이나 아키텍처 스타일
      
      4. 개발 과정 및 리팩토링:
         - 주요 개발 마일스톤
         - 코드 개선 및 리팩토링 내역
         - 성능 최적화나 버그 수정
      
      5. 협업 및 개발 프로세스:
         - PR 리뷰 패턴
         - 코드 품질 관리
         - 팀 협업 방식
      
      6. 이력서용 성과 요약:
         - 기술적 도전과 해결 과정
         - 프로젝트의 임팩트나 성과
         - 개인 기여도와 역할
         - 학습한 기술이나 경험
    `;

    logger.info(`${prompt} prompt`);

    const completion = await openai.chat.completions.create({
      model: "deepseek/deepseek-r1-0528-qwen3-8b:free",
      messages: [
        {
          role: "system",
          content: `당신은 소프트웨어 개발 프로젝트를 분석하는 전문가입니다. 
          GitHub 레포지토리의 코드 구조, 커밋 히스토리, PR, 설정 파일들을 종합적으로 분석하여 
          개발자의 이력서나 포트폴리오에 활용할 수 있는 전문적이고 구체적인 요약을 제공해주세요.
          기술적 세부사항과 비즈니스 가치를 모두 포함하여 설명해주세요.`,
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
        // 섹션 헤더 감지 (다양한 형태의 헤더 지원)
        if (
          line.match(/^#+\s*\d*\.?\s*(프로젝트\s*소개|Project\s*Introduction)/i)
        ) {
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
        } else if (
          line.match(
            /^#+\s*\d*\.?\s*(기술\s*스택|Tech\s*Stack|Technology\s*Stack)/i
          )
        ) {
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
        } else if (
          line.match(
            /^#+\s*\d*\.?\s*(프로젝트\s*아키텍처|Project\s*Architecture|Architecture)/i
          )
        ) {
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
        } else if (
          line.match(
            /^#+\s*\d*\.?\s*(개발\s*과정|리팩토링|Development\s*Process|Refactoring)/i
          )
        ) {
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
        } else if (
          line.match(
            /^#+\s*\d*\.?\s*(협업|개발\s*프로세스|Collaboration|Development\s*Flow)/i
          )
        ) {
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
        } else if (
          line.match(/^#+\s*\d*\.?\s*(이력서|성과|Resume|Achievement|Impact)/i)
        ) {
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
        } else if (currentSection && !line.match(/^#+/)) {
          // 현재 섹션의 내용 수집
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
        summary.project_intro = content.substring(0, 1000); // 첫 1000자만 저장
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
          other:
            techStackFromFiles.detected.length > 0
              ? [techStackFromFiles.detected.join(", ")]
              : ["분석된 기술 스택 없음"],
        };
        summary.refactoring_history = "AI 응답 파싱 실패로 인한 기본 내용";
        summary.collaboration_flow = "AI 응답 파싱 실패로 인한 기본 내용";
        summary.resume_bullets = [
          {
            title: "프로젝트 분석 완료",
            content: "프로젝트 기본 분석이 완료되었습니다.",
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
          other: [],
        };
      } else {
        // 기존 방식으로 폴백
        const techLines = cleanContent
          .split(/[,\n]/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        summary.tech_stack = {
          frontend: techLines.filter(
            (tech) =>
              tech.toLowerCase().includes("react") ||
              tech.toLowerCase().includes("vue") ||
              tech.toLowerCase().includes("angular") ||
              tech.toLowerCase().includes("frontend") ||
              tech.toLowerCase().includes("프론트")
          ),
          backend: techLines.filter(
            (tech) =>
              tech.toLowerCase().includes("node") ||
              tech.toLowerCase().includes("express") ||
              tech.toLowerCase().includes("django") ||
              tech.toLowerCase().includes("backend") ||
              tech.toLowerCase().includes("백엔드")
          ),
          database: techLines.filter(
            (tech) =>
              tech.toLowerCase().includes("mysql") ||
              tech.toLowerCase().includes("postgres") ||
              tech.toLowerCase().includes("mongodb") ||
              tech.toLowerCase().includes("database") ||
              tech.toLowerCase().includes("데이터베이스")
          ),
          devops: techLines.filter(
            (tech) =>
              tech.toLowerCase().includes("docker") ||
              tech.toLowerCase().includes("kubernetes") ||
              tech.toLowerCase().includes("aws") ||
              tech.toLowerCase().includes("devops") ||
              tech.toLowerCase().includes("배포")
          ),
          testing: techLines.filter(
            (tech) =>
              tech.toLowerCase().includes("jest") ||
              tech.toLowerCase().includes("cypress") ||
              tech.toLowerCase().includes("test") ||
              tech.toLowerCase().includes("테스트")
          ),
          other: techLines.filter(
            (tech) =>
              !tech.toLowerCase().includes("react") &&
              !tech.toLowerCase().includes("node") &&
              !tech.toLowerCase().includes("mysql") &&
              !tech.toLowerCase().includes("docker") &&
              !tech.toLowerCase().includes("jest") &&
              !tech.toLowerCase().includes("frontend") &&
              !tech.toLowerCase().includes("backend") &&
              !tech.toLowerCase().includes("database") &&
              !tech.toLowerCase().includes("devops") &&
              !tech.toLowerCase().includes("test")
          ),
        };
      }
      break;
    case "architecture":
      // architecture 내용을 other 배열에 추가
      const architectureContent = cleanContent;

      if (!summary.tech_stack.other) {
        summary.tech_stack.other = [];
      }

      // 내용을 의미있는 단위로 분리하여 배열에 추가
      if (architectureContent.includes("- ")) {
        // 불릿 포인트가 있으면 각각을 배열 요소로
        const items = architectureContent
          .split(/- /)
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
        summary.tech_stack.other.push(...items);
      } else if (architectureContent.includes("\n")) {
        // 줄바꿈이 있으면 각 줄을 배열 요소로
        const items = architectureContent
          .split("\n")
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
        summary.tech_stack.other.push(...items);
      } else {
        // 단일 텍스트면 그대로 추가
        summary.tech_stack.other.push(architectureContent);
      }
      break;
    case "refactoring_history":
      summary.refactoring_history = cleanContent;
      break;
    case "collaboration_flow":
      summary.collaboration_flow = cleanContent;
      break;
    case "resume_bullets":
      // 전체 텍스트를 더 스마트하게 분리
      let bullets: string[] = [];

      // 1. 먼저 불릿 포인트 기호로 분리 시도
      if (cleanContent.match(/[•\-\*]\s+/)) {
        bullets = cleanContent
          .split(/[•\-\*]\s+/)
          .map((bullet) => bullet.trim())
          .filter((bullet) => bullet.length > 15);
      }
      // 2. 숫자 리스트로 분리 시도 (1., 2., 3. 등)
      else if (cleanContent.match(/\d+\.\s+/)) {
        bullets = cleanContent
          .split(/\d+\.\s+/)
          .map((bullet) => bullet.trim())
          .filter((bullet) => bullet.length > 15);
      }
      // 3. 문단 단위로 분리 (더블 줄바꿈)
      else if (cleanContent.includes("\n\n")) {
        bullets = cleanContent
          .split(/\n\n+/)
          .map((bullet) => bullet.trim().replace(/\n/g, " "))
          .filter((bullet) => bullet.length > 15);
      }
      // 4. 마지막 시도: 마침표 기준으로 의미있는 문장들 그룹화
      else {
        const sentences = cleanContent
          .split(/[.!?]/)
          .map((s) => s.trim())
          .filter((s) => s.length > 10);

        // 2-3개 문장씩 그룹화
        bullets = [];
        for (let i = 0; i < sentences.length; i += 2) {
          const group = sentences.slice(i, i + 2).join(". ");
          if (group.length > 15) {
            bullets.push(group);
          }
        }
      }

      // bullets가 비어있으면 전체 텍스트를 3-4개 부분으로 나누기
      if (bullets.length === 0) {
        const words = cleanContent.split(" ");
        const chunkSize = Math.ceil(words.length / 3);

        for (let i = 0; i < words.length; i += chunkSize) {
          const chunk = words.slice(i, i + chunkSize).join(" ");
          if (chunk.trim().length > 15) {
            bullets.push(chunk.trim());
          }
        }
      }

      // 최대 6개로 제한
      bullets = bullets.slice(0, 6);

      summary.resume_bullets = bullets.map((bullet, index) => {
        // 콜론이 있으면 콜론 기준으로 분리
        if (bullet.includes(":") && bullet.indexOf(":") < bullet.length * 0.6) {
          const colonIndex = bullet.indexOf(":");
          const title = bullet.substring(0, colonIndex).trim();
          const content = bullet.substring(colonIndex + 1).trim();

          return {
            title: title || `성과 ${index + 1}`,
            content: content || bullet,
          };
        }
        // 콜론이 없거나 너무 뒤에 있으면 첫 부분을 title로
        else {
          const words = bullet.split(" ");
          const titleWords = words.slice(
            0,
            Math.min(8, Math.ceil(words.length * 0.3))
          );
          const contentWords = words.slice(titleWords.length);

          const title = titleWords.join(" ");
          const content =
            contentWords.length > 0 ? contentWords.join(" ") : bullet;

          return {
            title: title.length > 3 ? title : `성과 ${index + 1}`,
            content: content,
          };
        }
      });

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

export default {
  generateRepositorySummary,
  saveRepositorySummary,
  getRepositorySummary,
  getRepositorySummariesByRepo,
  getUserRepositorySummaries,
  exportSummaryAsMarkdown,
  exportSummaryAsNotionBlocks,
  generateEnhancedRepositorySummary,
};
