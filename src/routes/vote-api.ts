import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import voteService from "../services/vote-service";
import logger from "../utils/logger";

export default async function voteRoutes(
  fastify: FastifyInstance
): Promise<void> {
  // 후보자 투표
  fastify.post(
    "/vote/candidate",
    async (
      request: FastifyRequest<{
        Body: {
          candidate_id: string;
          vote_type: boolean; // true=찬성, false=반대
        };
      }>,
      reply
    ) => {
      try {
        const { candidate_id, vote_type } = request.body;

        if (!candidate_id || vote_type === undefined) {
          return reply.status(400).send({
            status: "error",
            message: "Candidate ID and vote type are required",
          });
        }

        // 실제 서비스에서는 인증된 사용자의 ID를 사용
        // 여기서는 임시로 프론트엔드에서 전달하는 UUID 사용
        const user_id = request.headers["x-user-id"] as string;
        if (!user_id) {
          return reply.status(401).send({
            status: "error",
            message: "User ID is required in x-user-id header",
          });
        }

        const result = await voteService.voteCandidateById(
          candidate_id,
          user_id,
          vote_type
        );

        if (!result) {
          return reply.status(500).send({
            status: "error",
            message: "Failed to save vote",
          });
        }

        return reply.send({
          status: "success",
          data: result,
        });
      } catch (error) {
        logger.error({ error }, "Error in candidate vote API");
        return reply.status(500).send({
          status: "error",
          message: "Internal server error",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );

  // 후보자 투표 조회
  fastify.get(
    "/vote/candidate/:candidate_id",
    async (
      request: FastifyRequest<{
        Params: {
          candidate_id: string;
        };
      }>,
      reply
    ) => {
      try {
        const { candidate_id } = request.params;

        // 사용자 ID는 헤더에서 가져옴
        const user_id = request.headers["x-user-id"] as string;
        if (!user_id) {
          return reply.status(401).send({
            status: "error",
            message: "User ID is required in x-user-id header",
          });
        }

        const vote = await voteService.getUserCandidateVote(
          candidate_id,
          user_id
        );

        return reply.send({
          status: "success",
          data: vote,
        });
      } catch (error) {
        logger.error({ error }, "Error fetching candidate vote");
        return reply.status(500).send({
          status: "error",
          message: "Internal server error",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );

  // 사용자가 특정 후보자에게 찬성 투표했는지 여부만 확인
  fastify.get(
    "/vote/has-voted/:candidate_id",
    async (
      request: FastifyRequest<{
        Params: {
          candidate_id: string;
        };
      }>,
      reply
    ) => {
      try {
        const { candidate_id } = request.params;

        // 사용자 ID는 헤더에서 가져옴
        const user_id = request.headers["x-user-id"] as string;
        if (!user_id) {
          return reply.status(401).send({
            status: "error",
            message: "User ID is required in x-user-id header",
          });
        }

        const hasVoted = await voteService.hasUserVotedForCandidate(
          candidate_id,
          user_id
        );

        return reply.send({
          status: "success",
          data: {
            has_voted: hasVoted,
          },
        });
      } catch (error) {
        logger.error(
          { error },
          "Error checking if user has voted for candidate"
        );
        return reply.status(500).send({
          status: "error",
          message: "Internal server error",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );

  // 사용자가 어떤 후보자든 투표한 적이 있는지 여부만 확인
  fastify.get("/vote/has-voted-any", async (request, reply) => {
    try {
      // 사용자 ID는 헤더에서 가져옴
      const user_id = request.headers["x-user-id"] as string;
      if (!user_id) {
        return reply.status(401).send({
          status: "error",
          message: "User ID is required in x-user-id header",
        });
      }

      const hasVoted = await voteService.hasUserVotedAny(user_id);

      return reply.send({
        status: "success",
        data: {
          has_voted: hasVoted,
        },
      });
    } catch (error) {
      logger.error(
        { error },
        "Error checking if user has voted for any candidate"
      );
      return reply.status(500).send({
        status: "error",
        message: "Internal server error",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // 후보자 투표 통계
  fastify.get(
    "/vote/stats/candidate/:candidate_id",
    async (
      request: FastifyRequest<{
        Params: {
          candidate_id: string;
        };
      }>,
      reply
    ) => {
      try {
        const { candidate_id } = request.params;

        const stats = await voteService.getCandidateVoteStats(candidate_id);

        return reply.send({
          status: "success",
          data: {
            candidate_id,
            stats,
          },
        });
      } catch (error) {
        logger.error({ error }, "Error fetching candidate vote stats");
        return reply.status(500).send({
          status: "error",
          message: "Internal server error",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );

  // 모든 후보자 투표 통계
  fastify.get("/vote/stats/candidates", async (_request, reply) => {
    try {
      const stats = await voteService.getAllCandidateVoteStats();

      return reply.send({
        status: "success",
        data: stats,
      });
    } catch (error) {
      logger.error({ error }, "Error fetching all candidate vote stats");
      return reply.status(500).send({
        status: "error",
        message: "Internal server error",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // 후보자 투표 삭제
  fastify.delete(
    "/vote/candidate/:candidate_id",
    async (
      request: FastifyRequest<{
        Params: {
          candidate_id: string;
        };
      }>,
      reply
    ) => {
      try {
        const { candidate_id } = request.params;

        // 사용자 ID는 헤더에서 가져옴
        const user_id = request.headers["x-user-id"] as string;
        if (!user_id) {
          return reply.status(401).send({
            status: "error",
            message: "User ID is required in x-user-id header",
          });
        }

        const result = await voteService.deleteCandidateVote(
          candidate_id,
          user_id
        );

        if (!result) {
          return reply.status(500).send({
            status: "error",
            message: "Failed to delete vote",
          });
        }

        return reply.send({
          status: "success",
          message: "Vote deleted successfully",
        });
      } catch (error) {
        logger.error({ error }, "Error deleting candidate vote");
        return reply.status(500).send({
          status: "error",
          message: "Internal server error",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );
}
