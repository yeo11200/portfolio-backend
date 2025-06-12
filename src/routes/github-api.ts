// src/routes/github-api.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import githubService from "../services/github-service";
import repositoryService from "../services/repository-service";
import aiSummaryService from "../services/ai-summary-service";
import { generateToken, checkAuth } from "../utils/jwt";
import logger from "../utils/logger";

// 세션 타입 정의
declare module "fastify" {
  interface Session {
    userId: string;
  }
}

// 에러 응답 헬퍼 함수
const errorResponse = (
  reply: FastifyReply,
  error: unknown,
  message: string
) => {
  logger.error({ error }, message);
  return reply.status(500).send({
    status: "error",
    message: "Internal server error",
    error: error instanceof Error ? error.message : "Unknown error",
  });
};

export default async function githubRoutes(
  fastify: FastifyInstance
): Promise<void> {
  // GitHub OAuth 인증 URL 가져오기
  fastify.get("/github/auth", async (_request, reply) => {
    try {
      const authUrl = githubService.getGitHubAuthUrl();
      return reply.send({
        status: "success",
        data: { auth_url: authUrl },
      });
    } catch (error) {
      return errorResponse(reply, error, "Error getting GitHub auth URL");
    }
  });

  // GitHub OAuth 콜백 처리
  fastify.get(
    "/github/callback",
    async (
      request: FastifyRequest<{
        Querystring: {
          code: string;
        };
      }>,
      reply
    ) => {
      try {
        const { code } = request.query;

        if (!code) {
          return reply.status(400).send({
            status: "error",
            message: "Authorization code is required",
          });
        }

        const tokenData = await githubService.handleGitHubCallback(code);

        logger.info(
          `Server is running on ${JSON.stringify(tokenData)} tokenData`
        );

        const githubUser = await githubService.getGitHubUser(
          tokenData.access_token
        );

        logger.info(
          `Server is running on ${JSON.stringify(githubUser)} githubUser`
        );

        const userId = await githubService.saveOrUpdateUser(
          githubUser,
          tokenData
        );

        logger.info(`Server is running on ${userId} userId`);

        // JWT 토큰 생성
        const token = generateToken(userId);

        return reply.send({
          status: "success",
          data: {
            token,
            user: {
              id: userId,
              username: githubUser.login,
              avatar_url: githubUser.avatar_url,
            },
          },
        });
      } catch (error) {
        return errorResponse(reply, error, "Error in GitHub callback");
      }
    }
  );

  // 사용자 레포지토리 목록 가져오기
  fastify.get(
    "/github/repos",
    async (
      request: FastifyRequest<{
        Querystring: {
          sort?: string;
          direction?: string;
          search?: string;
        };
      }>,
      reply
    ) => {
      try {
        const { sort, direction, search } = request.query;
        const user = await checkAuth(request);

        const repos = await repositoryService.getUserRepositories(
          user.access_token,
          sort,
          direction,
          search
        );

        return reply.send({
          status: "success",
          data: repos,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Authentication required"
        ) {
          return reply.status(401).send({
            status: "error",
            message: "Authentication required",
          });
        }
        if (error instanceof Error && error.message === "Invalid token") {
          return reply.status(401).send({
            status: "error",
            message: "Invalid token",
          });
        }
        return errorResponse(reply, error, "Error fetching user repositories");
      }
    }
  );

  // 특정 레포지토리 정보 가져오기
  fastify.get(
    "/github/repos/:owner/:repo",
    async (
      request: FastifyRequest<{
        Params: {
          owner: string;
          repo: string;
        };
      }>,
      reply
    ) => {
      try {
        const { owner, repo } = request.params;
        const user = await checkAuth(request);

        const repository = await repositoryService.getRepository(
          user.access_token,
          owner,
          repo
        );

        return reply.send({
          status: "success",
          data: repository,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === "Authentication required" ||
            error.message === "Invalid token")
        ) {
          return reply.status(401).send({
            status: "error",
            message: error.message,
          });
        }
        return errorResponse(reply, error, "Error fetching repository");
      }
    }
  );

  // 레포지토리 README 가져오기
  fastify.get(
    "/github/repos/:owner/:repo/readme",
    async (
      request: FastifyRequest<{
        Params: {
          owner: string;
          repo: string;
        };
      }>,
      reply
    ) => {
      try {
        const { owner, repo } = request.params;
        const user = await checkAuth(request);

        const readme = await repositoryService.getRepositoryReadme(
          user.access_token,
          owner,
          repo
        );

        return reply.send({
          status: "success",
          data: { readme },
        });
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === "Authentication required" ||
            error.message === "Invalid token")
        ) {
          return reply.status(401).send({
            status: "error",
            message: error.message,
          });
        }
        return errorResponse(reply, error, "Error fetching repository README");
      }
    }
  );

  // 레포지토리 브랜치 목록 가져오기
  fastify.get(
    "/github/repos/:owner/:repo/branches",
    async (
      request: FastifyRequest<{
        Params: {
          owner: string;
          repo: string;
        };
      }>,
      reply
    ) => {
      try {
        const { owner, repo } = request.params;
        const user = await checkAuth(request);

        const branches = await repositoryService.getRepositoryBranches(
          user.access_token,
          owner,
          repo
        );

        return reply.send({
          status: "success",
          data: branches,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === "Authentication required" ||
            error.message === "Invalid token")
        ) {
          return reply.status(401).send({
            status: "error",
            message: error.message,
          });
        }
        return errorResponse(
          reply,
          error,
          "Error fetching repository branches"
        );
      }
    }
  );

  // 레포지토리 디렉토리 내용 가져오기
  fastify.get(
    "/github/repos/:owner/:repo/contents",
    async (
      request: FastifyRequest<{
        Params: {
          owner: string;
          repo: string;
        };
        Querystring: {
          path?: string;
          ref?: string;
        };
      }>,
      reply
    ) => {
      try {
        const { owner, repo } = request.params;
        const { path, ref } = request.query;
        const user = await checkAuth(request);

        const contents = await repositoryService.getRepositoryContents(
          user.access_token,
          owner,
          repo,
          path,
          ref
        );

        return reply.send({
          status: "success",
          data: contents,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === "Authentication required" ||
            error.message === "Invalid token")
        ) {
          return reply.status(401).send({
            status: "error",
            message: error.message,
          });
        }
        return errorResponse(
          reply,
          error,
          "Error fetching repository contents"
        );
      }
    }
  );

  // 레포지토리 커밋 목록 가져오기
  fastify.get(
    "/github/repos/:owner/:repo/commits",
    async (
      request: FastifyRequest<{
        Params: {
          owner: string;
          repo: string;
        };
        Querystring: {
          branch?: string;
          per_page?: number;
        };
      }>,
      reply
    ) => {
      try {
        const { owner, repo } = request.params;
        const { branch, per_page } = request.query;
        const user = await checkAuth(request);

        const commits = await repositoryService.getRepositoryCommits(
          user.access_token,
          owner,
          repo,
          branch,
          per_page
        );

        return reply.send({
          status: "success",
          data: commits,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === "Authentication required" ||
            error.message === "Invalid token")
        ) {
          return reply.status(401).send({
            status: "error",
            message: error.message,
          });
        }
        return errorResponse(reply, error, "Error fetching repository commits");
      }
    }
  );

  // 레포지토리 PR 목록 가져오기
  fastify.get(
    "/github/repos/:owner/:repo/pulls",
    async (
      request: FastifyRequest<{
        Params: {
          owner: string;
          repo: string;
        };
        Querystring: {
          state?: string;
          per_page?: number;
        };
      }>,
      reply
    ) => {
      try {
        const { owner, repo } = request.params;
        const { state, per_page } = request.query;
        const user = await checkAuth(request);

        const pullRequests = await repositoryService.getRepositoryPullRequests(
          user.access_token,
          owner,
          repo,
          state,
          per_page
        );

        return reply.send({
          status: "success",
          data: pullRequests,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === "Authentication required" ||
            error.message === "Invalid token")
        ) {
          return reply.status(401).send({
            status: "error",
            message: error.message,
          });
        }
        return errorResponse(
          reply,
          error,
          "Error fetching repository pull requests"
        );
      }
    }
  );

  // 레포지토리 저장
  fastify.post(
    "/github/repos/:owner/:repo/save",
    async (
      request: FastifyRequest<{
        Params: {
          owner: string;
          repo: string;
        };
      }>,
      reply
    ) => {
      try {
        const { owner, repo } = request.params;
        const user = await checkAuth(request);

        const repository = await repositoryService.getRepository(
          user.access_token,
          owner,
          repo
        );

        const repositoryId = await repositoryService.saveRepository(
          user.id,
          repository
        );

        return reply.send({
          status: "success",
          data: { repository_id: repositoryId },
        });
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === "Authentication required" ||
            error.message === "Invalid token")
        ) {
          return reply.status(401).send({
            status: "error",
            message: error.message,
          });
        }
        return errorResponse(reply, error, "Error saving repository");
      }
    }
  );

  // AI 요약 생성 API 엔드포인트 추가
  fastify.post(
    "/github/repos/:owner/:repo/summary",
    async (
      request: FastifyRequest<{
        Params: {
          owner: string;
          repo: string;
        };
        Querystring: {
          branch?: string;
        };
      }>,
      reply
    ) => {
      try {
        const { owner, repo } = request.params;
        const { branch } = request.query;
        logger.info(owner, request.params);
        logger.info(repo);
        const user = await checkAuth(request);

        logger.info(user);

        // 기본 브랜치 감지
        const defaultBranch = await repositoryService.getDefaultBranch(
          user.access_token,
          owner,
          repo
        );

        logger.info(`Using default branch: ${defaultBranch}`);

        const readme = await repositoryService.getRepositoryReadme(
          user.access_token,
          owner,
          repo,
          branch || defaultBranch
        );

        // 🚀 병렬 처리로 성능 최적화 (9초 → 3초)
        const [commits, pullRequests, treeResult, branchLanguageAnalysis] =
          await Promise.all([
            repositoryService.getRepositoryCommits(
              user.access_token,
              owner,
              repo,
              branch || defaultBranch,
              30
            ),
            repositoryService.getRepositoryPullRequests(
              user.access_token,
              owner,
              repo,
              "all",
              20
            ),
            githubService.getRepositoryTree(
              user.access_token,
              owner,
              repo,
              branch || defaultBranch
            ),
            githubService.analyzeBranchLanguages(
              user.access_token,
              owner,
              repo,
              branch || defaultBranch
            ),
          ]);

        // 브랜치 언어 분석 결과를 AI 서비스에서 사용할 형식으로 변환
        const languages: Record<string, number> = {};
        Object.entries(branchLanguageAnalysis.languages).forEach(
          ([lang, data]) => {
            // 파일 개수를 가중치로 사용 (실제 바이트 수 대신)
            languages[lang] = data.count * 1000; // 파일 개수에 1000을 곱해서 바이트 수처럼 표현
          }
        );

        // 중요 파일들 가져오기
        let importantFiles = {};
        if (treeResult && Array.isArray(treeResult)) {
          try {
            importantFiles = await githubService.getImportantFiles(
              user.access_token,
              owner,
              repo,
              treeResult,
              defaultBranch
            );
            logger.info(
              { fileCount: Object.keys(importantFiles).length },
              "Important files fetched"
            );
          } catch (error) {
            logger.error({ error }, "Failed to fetch important files");
          }
        }

        logger.info(`${importantFiles} importantFiles`);

        // AI를 사용하여 향상된 요약 생성
        const summary =
          await aiSummaryService.generateEnhancedRepositorySummary(
            `${owner}/${repo}`,
            readme,
            commits,
            pullRequests,
            treeResult,
            importantFiles,
            languages
          );

        // 브랜치 이름 설정
        summary.branch_name = branch || defaultBranch;

        // 성능 메트릭 준비
        const performanceMetrics = {
          commits_analyzed: commits.length,
          prs_analyzed: pullRequests.length,
          files_analyzed: Object.keys(importantFiles).length,
          branch_total_files: branchLanguageAnalysis.totalFiles,
          branch_languages: Object.keys(branchLanguageAnalysis.languages)
            .length,
          top_languages: Object.entries(branchLanguageAnalysis.languages)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 5)
            .map(([lang, data]) => ({
              language: lang,
              file_count: data.count,
              percentage: data.percentage,
            })),
        };

        // 요약 저장을 위한 레포지토리 정보 처리
        const repository = await repositoryService.getRepository(
          user.access_token,
          owner,
          repo
        );

        const repositoryId = await repositoryService.saveRepository(user.id, {
          ...repository,
          branch_name: branch || defaultBranch,
        });

        const summaryId = await aiSummaryService.saveRepositorySummary(
          repositoryId,
          branch || defaultBranch,
          summary,
          performanceMetrics
        );

        return reply.send({
          status: "success",
        });
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === "Authentication required" ||
            error.message === "Invalid token")
        ) {
          return reply.status(401).send({
            status: "error",
            message: error.message,
          });
        }
        return errorResponse(
          reply,
          error,
          "Error generating repository summary"
        );
      }
    }
  );

  // 저장된 요약 가져오기 (브랜치별)
  fastify.get(
    "/github/repos/:owner/:repo/summary",
    async (
      request: FastifyRequest<{
        Params: {
          owner: string;
          repo: string;
        };
        Querystring: {
          branch?: string;
        };
      }>,
      reply
    ) => {
      try {
        const { owner, repo } = request.params;
        const { branch = "main" } = request.query;
        const user = await checkAuth(request);

        // 레포지토리 ID 찾기
        const repositories = await repositoryService.getSavedRepositories(
          user.id,
          "updated_at",
          "desc",
          repo,
          branch || "main"
        );

        logger.info(repositories);

        const repository = repositories.find(
          (r) => r.owner === owner && r.name === repo
        );

        if (!repository) {
          return reply.status(500).send({
            status: "error",
            message: "Repository not found",
          });
        }

        const summary = await aiSummaryService.getRepositorySummary(
          repository.id,
          branch
        );

        if (!summary) {
          return reply.status(404).send({
            status: "error",
            message: `Summary not found for branch '${branch}'`,
          });
        }

        return reply.send({
          status: "success",
          data: {
            ...summary,
            repository: {
              owner: repository.owner,
              name: repository.name,
              branch: branch,
            },
          },
        });
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === "Authentication required" ||
            error.message === "Invalid token")
        ) {
          return reply.status(401).send({
            status: "error",
            message: error.message,
          });
        }
        return errorResponse(reply, error, "Error fetching repository summary");
      }
    }
  );

  // 레포지토리의 모든 브랜치 요약 목록 가져오기
  fastify.get(
    "/github/repos/:owner/:repo/summaries",
    async (
      request: FastifyRequest<{
        Params: {
          owner: string;
          repo: string;
        };
      }>,
      reply
    ) => {
      try {
        const { owner, repo } = request.params;
        const user = await checkAuth(request);

        // 레포지토리 ID 찾기
        const repositories = await repositoryService.getSavedRepositories(
          user.id,
          "updated_at",
          "desc",
          repo
        );

        const repository = repositories.find(
          (r) => r.owner === owner && r.name === repo
        );

        if (!repository) {
          return reply.status(404).send({
            status: "error",
            message: "Repository not found",
          });
        }

        const summaries = await aiSummaryService.getRepositorySummariesByRepo(
          repository.id
        );

        return reply.send({
          status: "success",
          data: {
            repository: {
              owner: repository.owner,
              name: repository.name,
            },
            summaries: summaries.map((summary) => ({
              ...summary,
              branch: summary.branch_name,
            })),
            total: summaries.length,
          },
        });
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === "Authentication required" ||
            error.message === "Invalid token")
        ) {
          return reply.status(401).send({
            status: "error",
            message: error.message,
          });
        }
        return errorResponse(
          reply,
          error,
          "Error fetching repository summaries"
        );
      }
    }
  );

  // 요약을 Markdown으로 내보내기 (브랜치별)
  fastify.get(
    "/github/repos/:owner/:repo/summary/export/markdown",
    async (
      request: FastifyRequest<{
        Params: {
          owner: string;
          repo: string;
        };
        Querystring: {
          branch?: string;
        };
      }>,
      reply
    ) => {
      try {
        const { owner, repo } = request.params;
        const { branch = "main" } = request.query;
        const user = await checkAuth(request);

        // 레포지토리 ID 찾기
        const repositories = await repositoryService.getSavedRepositories(
          user.id,
          "updated_at",
          "desc",
          repo
        );

        const repository = repositories.find(
          (r) => r.owner === owner && r.name === repo
        );

        if (!repository) {
          return reply.status(404).send({
            status: "error",
            message: "Repository not found",
          });
        }

        const summary = await aiSummaryService.getRepositorySummary(
          repository.id,
          branch
        );

        if (!summary) {
          return reply.status(404).send({
            status: "error",
            message: `Summary not found for branch '${branch}'`,
          });
        }

        const markdown = aiSummaryService.exportSummaryAsMarkdown(summary);

        return reply
          .header("Content-Type", "text/markdown")
          .header(
            "Content-Disposition",
            `attachment; filename="${repo}-${branch}-summary.md"`
          )
          .send(markdown);
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === "Authentication required" ||
            error.message === "Invalid token")
        ) {
          return reply.status(401).send({
            status: "error",
            message: error.message,
          });
        }
        return errorResponse(
          reply,
          error,
          "Error exporting summary as markdown"
        );
      }
    }
  );

  // 요약을 Notion 블록으로 내보내기 (브랜치별)
  fastify.get(
    "/github/repos/:owner/:repo/summary/export/notion",
    async (
      request: FastifyRequest<{
        Params: {
          owner: string;
          repo: string;
        };
        Querystring: {
          branch?: string;
        };
      }>,
      reply
    ) => {
      try {
        const { owner, repo } = request.params;
        const { branch = "main" } = request.query;
        const user = await checkAuth(request);

        // 레포지토리 ID 찾기
        const repositories = await repositoryService.getSavedRepositories(
          user.id,
          "updated_at",
          "desc",
          repo
        );

        const repository = repositories.find(
          (r) => r.owner === owner && r.name === repo
        );

        if (!repository) {
          return reply.status(404).send({
            status: "error",
            message: "Repository not found",
          });
        }

        const summary = await aiSummaryService.getRepositorySummary(
          repository.id,
          branch
        );

        if (!summary) {
          return reply.status(404).send({
            status: "error",
            message: `Summary not found for branch '${branch}'`,
          });
        }

        const notionBlocks =
          aiSummaryService.exportSummaryAsNotionBlocks(summary);

        return reply.send({
          status: "success",
          data: {
            repository: {
              owner,
              name: repo,
              branch,
            },
            notion_blocks: notionBlocks,
          },
        });
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === "Authentication required" ||
            error.message === "Invalid token")
        ) {
          return reply.status(401).send({
            status: "error",
            message: error.message,
          });
        }
        return errorResponse(
          reply,
          error,
          "Error exporting summary as notion blocks"
        );
      }
    }
  );

  // 레포지토리 파일 구조 및 분석 정보 가져오기
  fastify.get(
    "/github/repos/:owner/:repo/analysis",
    async (
      request: FastifyRequest<{
        Params: {
          owner: string;
          repo: string;
        };
        Querystring: {
          branch?: string;
        };
      }>,
      reply
    ) => {
      try {
        const { owner, repo } = request.params;
        const { branch } = request.query;
        const user = await checkAuth(request);

        // 기본 브랜치 감지
        const defaultBranch = await repositoryService.getDefaultBranch(
          user.access_token,
          owner,
          repo
        );

        const targetBranch = branch || defaultBranch;

        // 브랜치별 상세 분석
        const branchAnalysis = await githubService.getBranchFileAnalysis(
          user.access_token,
          owner,
          repo,
          targetBranch
        );

        // 전체 레포지토리 언어 통계 (비교용)
        const repoLanguages = await githubService.getRepositoryLanguages(
          user.access_token,
          owner,
          repo
        );

        // 언어 통계를 백분율로 변환
        const totalBytes = Object.values(repoLanguages).reduce(
          (a, b) => a + b,
          0
        );
        const repoLanguageStats = Object.entries(repoLanguages)
          .sort((a, b) => b[1] - a[1])
          .map(([lang, bytes]) => ({
            language: lang,
            bytes: bytes,
            percentage:
              totalBytes > 0 ? Math.round((bytes / totalBytes) * 100) : 0,
          }));

        return reply.send({
          status: "success",
          data: {
            repository: {
              owner,
              name: repo,
              branch: targetBranch,
              default_branch: defaultBranch,
            },
            branch_analysis: {
              summary: branchAnalysis.summary,
              languages: branchAnalysis.languages,
              structure: branchAnalysis.structure,
              file_types: branchAnalysis.fileTypes,
            },
            repository_languages: repoLanguageStats,
            comparison: {
              branch_files: branchAnalysis.summary.totalFiles,
              branch_languages: Object.keys(branchAnalysis.languages).length,
              repo_languages: Object.keys(repoLanguages).length,
            },
          },
        });
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === "Authentication required" ||
            error.message === "Invalid token")
        ) {
          return reply.status(401).send({
            status: "error",
            message: error.message,
          });
        }
        return errorResponse(
          reply,
          error,
          "Error analyzing repository structure"
        );
      }
    }
  );
}
