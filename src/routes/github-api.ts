// src/routes/github-api.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import githubService from "../services/github-service";
import repositoryService from "../services/repository-service";
import aiSummaryService from "../services/ai-summary-service";
import {
  generateToken,
  verifyToken,
  extractTokenFromHeader,
} from "../utils/jwt";
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

// 인증 체크 헬퍼 함수
const checkAuth = async (request: FastifyRequest) => {
  try {
    const token = extractTokenFromHeader(request.headers.authorization);
    const { userId } = verifyToken(token);

    const user = await githubService.getUserById(userId);
    if (!user) {
      throw new Error("User not found");
    }
    return user;
  } catch (error) {
    if (error instanceof Error && error.message === "No token provided") {
      throw new Error("Authentication required");
    }
    throw error;
  }
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
      }>,
      reply
    ) => {
      try {
        const { owner, repo } = request.params;
        const user = await checkAuth(request);

        // 레포지토리 정보 가져오기
        const repository = await repositoryService.getRepository(
          user.access_token,
          owner,
          repo
        );

        // 레포지토리 저장 (없으면 새로 생성)
        const repositoryId = await repositoryService.saveRepository(
          user.id,
          repository
        );

        // README, 커밋, PR 정보 수집
        const readme = await repositoryService.getRepositoryReadme(
          user.access_token,
          owner,
          repo
        );

        const commits = await repositoryService.getRepositoryCommits(
          user.access_token,
          owner,
          repo,
          "main",
          50
        );

        const pullRequests = await repositoryService.getRepositoryPullRequests(
          user.access_token,
          owner,
          repo,
          "all",
          30
        );

        // AI 요약 생성
        const summary = await aiSummaryService.generateRepositorySummary(
          repository.name,
          readme,
          commits,
          pullRequests
        );

        // 요약 저장
        const summaryId = await aiSummaryService.saveRepositorySummary(
          repositoryId,
          summary
        );

        return reply.send({
          status: "success",
          data: {
            summary_id: summaryId,
            summary,
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
          "Error generating repository summary"
        );
      }
    }
  );

  // 저장된 요약 가져오기
  fastify.get(
    "/github/repos/:owner/:repo/summary",
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

        const summary = await aiSummaryService.getRepositorySummary(
          repository.id
        );

        if (!summary) {
          return reply.status(404).send({
            status: "error",
            message: "Summary not found",
          });
        }

        return reply.send({
          status: "success",
          data: summary,
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

  // 요약을 Markdown으로 내보내기
  fastify.get(
    "/github/repos/:owner/:repo/summary/export/markdown",
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

        const summary = await aiSummaryService.getRepositorySummary(
          repository.id
        );

        if (!summary) {
          return reply.status(404).send({
            status: "error",
            message: "Summary not found",
          });
        }

        const markdown = aiSummaryService.exportSummaryAsMarkdown(summary);

        return reply
          .header("Content-Type", "text/markdown")
          .header(
            "Content-Disposition",
            `attachment; filename="${repo}-summary.md"`
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

  // 요약을 Notion 블록으로 내보내기
  fastify.get(
    "/github/repos/:owner/:repo/summary/export/notion",
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

        const summary = await aiSummaryService.getRepositorySummary(
          repository.id
        );

        if (!summary) {
          return reply.status(404).send({
            status: "error",
            message: "Summary not found",
          });
        }

        const notionBlocks =
          aiSummaryService.exportSummaryAsNotionBlocks(summary);

        return reply.send({
          status: "success",
          data: {
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
}
