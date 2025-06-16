import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { checkAuth } from "../utils/jwt";
import aiSummaryService from "../services/ai-summary-service";
import githubService from "../services/github-service";

export default async function githubMyRoutes(
  fastify: FastifyInstance
): Promise<void> {
  fastify.get(
    "/github/my",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await checkAuth(request);
      const [
        count,
        monthCount,
        repositorySummary,
        removeDuplicatesSummary,
        createdAt,
      ] = await Promise.all([
        aiSummaryService.getUserRepositorySummaryCounts(user.id),
        aiSummaryService.getUserMonthlyRepositorySummaryCounts(user.id),
        aiSummaryService.getUserRepositorySummary(user.id),
        aiSummaryService.getUserUniqueRepoSummaryCounts(user.id),
        githubService.getUserCreatedAt(user.id),
      ]);

      return reply.send({
        status: "success",
        data: {
          count: count.count,
          monthCount: monthCount.count,
          repositorySummary: repositorySummary || [],
          removeDuplicatesSummary: removeDuplicatesSummary?.summary_count || 0,
          createdAt: createdAt.data.created_at,
        },
      });
    }
  );
}
