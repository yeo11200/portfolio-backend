import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { checkAuth } from "../utils/jwt";
import resumeService from "../services/resume-service";
import logger from "../utils/logger";
import { RESUME_PDF_LIMITS } from "../constant/s3-constant";
import fastifyMultipart from "@fastify/multipart";

// 에러 응답 헬퍼 함수
const errorResponse = (
  reply: FastifyReply,
  error: unknown,
  message: string
) => {
  logger.error(
    {
      error:
        error instanceof Error
          ? {
              message: error.message,
              stack: error.stack,
              name: error.name,
            }
          : error,
    },
    message
  );
  return reply.status(500).send({
    status: "error",
    message: "Internal server error",
    error: error instanceof Error ? error.message : "Unknown error",
  });
};

export default async function resumeRoutes(
  fastify: FastifyInstance
): Promise<void> {
  // Multipart 플러그인 등록 (파일 업로드용)
  await fastify.register(fastifyMultipart, {
    attachFieldsToBody: true,
    limits: {
      fileSize: RESUME_PDF_LIMITS.MAX_FILE_SIZE,
    },
  });

  // 이력서 파일 업로드 및 처리
  fastify.post(
    "/resume/upload",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = await checkAuth(request);

        logger.info({ userId: user.id }, "Resume file upload request received");

        // multipart 확인
        if (!request.isMultipart()) {
          return reply.status(400).send({
            status: "error",
            message:
              "Request must be multipart/form-data with a file attached.",
          });
        }

        // 파일은 req.body 안에 있음
        const body = request.body as any;
        const data = body.resume || body.file; // 여러 필드명 지원

        if (!data) {
          return reply.status(400).send({
            status: "error",
            message:
              "No resume file provided. Please attach a file with field name 'resume' or 'file'.",
          });
        }

        const fileName = data.filename;
        if (!fileName) {
          return reply.status(400).send({
            status: "error",
            message:
              "File name is required. Please ensure the uploaded file has a valid name.",
          });
        }

        const fileBuffer = await data.toBuffer();

        logger.info(
          {
            fileName,
            fileSize: fileBuffer.length,
            contentType: data.mimetype,
            fieldname: data.fieldname,
            userId: user.id,
          },
          "Processing resume file upload"
        );

        // 서비스를 통해 이력서 파일 업로드 및 처리
        const result = await resumeService.uploadAndProcessResume({
          userId: user.id,
          fileName,
          fileBuffer,
        });

        return reply.send({
          status: "success",
          message: "Resume processed successfully",
          data: result,
        });
      } catch (error) {
        logger.error(
          {
            error:
              error instanceof Error
                ? {
                    message: error.message,
                    stack: error.stack,
                    name: error.name,
                  }
                : error,
          },
          "Resume file upload error"
        );

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

        // 파일 검증 에러는 400 Bad Request로 처리
        if (
          error instanceof Error &&
          (error.message.includes("Only resume files are allowed") ||
            error.message.includes("File size exceeds limit") ||
            error.message.includes("PDF processing not yet implemented") ||
            error.message.includes("insufficient text content"))
        ) {
          return reply.status(400).send({
            status: "error",
            message: error.message,
          });
        }

        return errorResponse(reply, error, "Error processing resume file");
      }
    }
  );

  // 텍스트로 직접 이력서 생성
  fastify.post(
    "/resume/create-from-text",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = await checkAuth(request);
        const body = request.body as { resumeText: string };

        if (!body.resumeText) {
          return reply.status(400).send({
            status: "error",
            message: "Resume text is required",
          });
        }

        logger.info(
          {
            userId: user.id,
            textLength: body.resumeText.length,
          },
          "Creating resume from text"
        );

        // 서비스를 통해 텍스트로 이력서 생성
        const result = await resumeService.createResumeFromText({
          userId: user.id,
          resumeText: body.resumeText,
        });

        return reply.send({
          status: "success",
          message: "Resume created successfully from text",
          data: result,
        });
      } catch (error) {
        logger.error(
          {
            error:
              error instanceof Error
                ? {
                    message: error.message,
                    stack: error.stack,
                    name: error.name,
                  }
                : error,
          },
          "Resume creation from text error"
        );

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

        if (
          error instanceof Error &&
          error.message.includes("Text content is too short")
        ) {
          return reply.status(400).send({
            status: "error",
            message: error.message,
          });
        }

        return errorResponse(reply, error, "Error creating resume from text");
      }
    }
  );

  // 사용자의 이력서 목록 조회
  fastify.get(
    "/resume/list",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = await checkAuth(request);

        const resumes = await resumeService.getUserResumes(user.id);

        return reply.send({
          status: "success",
          data: resumes,
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
        return errorResponse(reply, error, "Error fetching user resumes");
      }
    }
  );

  // 특정 이력서 상세 조회
  fastify.get(
    "/resume/:resumeId",
    async (
      request: FastifyRequest<{ Params: { resumeId: string } }>,
      reply: FastifyReply
    ) => {
      try {
        const user = await checkAuth(request);
        const { resumeId } = request.params;

        const resume = await resumeService.getResumeById(resumeId, user.id);

        return reply.send({
          status: "success",
          data: resume,
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

        if (error instanceof Error && error.message === "Resume not found") {
          return reply.status(404).send({
            status: "error",
            message: error.message,
          });
        }

        return errorResponse(reply, error, "Error fetching resume details");
      }
    }
  );

  // 이력서 삭제
  fastify.delete(
    "/resume/:resumeId",
    async (
      request: FastifyRequest<{ Params: { resumeId: string } }>,
      reply: FastifyReply
    ) => {
      try {
        const user = await checkAuth(request);
        const { resumeId } = request.params;

        await resumeService.deleteResume(resumeId, user.id);

        return reply.send({
          status: "success",
          message: "Resume deleted successfully",
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

        if (error instanceof Error && error.message === "Resume not found") {
          return reply.status(404).send({
            status: "error",
            message: error.message,
          });
        }

        return errorResponse(reply, error, "Error deleting resume");
      }
    }
  );
}
