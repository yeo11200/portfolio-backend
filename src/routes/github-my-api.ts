import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { checkAuth } from "../utils/jwt";
import githubMyService from "../services/github-my-service";
import logger from "../utils/logger";
import { PROFILE_IMAGE_LIMITS } from "../constant/s3-constant";
import fastifyMultipart from "@fastify/multipart";
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

export default async function githubMyRoutes(
  fastify: FastifyInstance
): Promise<void> {
  // Multipart 플러그인 등록 (파일 업로드용)
  await fastify.register(fastifyMultipart, {
    attachFieldsToBody: true,
    limits: {
      fileSize: PROFILE_IMAGE_LIMITS.MAX_FILE_SIZE,
    },
  });

  fastify.post(
    "/upload-profile",
    {
      preHandler: (req, reply, done) => {
        console.log("Headers:", req.headers); // Content-Type 항목 확인
        done();
      },
    },
    async (req, reply) => {
      // --- 1) isMultipart 확인 & Content-Type 로깅
      fastify.log.info(
        { ct: req.headers["content-type"], isMp: req.isMultipart() },
        "upload check"
      );
      if (!req.isMultipart()) {
        return reply
          .code(406)
          .send({ error: "multipart/form-data 요청이 아닙니다" });
      }

      // --- 2) 모든 파트 순회 로그 (디버깅용)
      for await (const part of req.parts()) {
        fastify.log.info({ field: part.fieldname, type: part.type }, "part");
      }

      // 파일은 req.body 안에 있음
      const body = req.body as any;
      const file = body.file;

      console.log("file 객체:", file);
      console.log("body 객체:", body);

      // 파일 버퍼 가져오기
      const fileBuffer = await file.toBuffer();
      console.log("파일 버퍼 크기:", fileBuffer.length);

      return reply.send({
        success: true,
        message: "파일 업로드 성공!",
        fileInfo: {
          filename: file.filename,
          mimetype: file.mimetype,
          size: fileBuffer.length,
        },
      });
    }
  );

  // 내 정보 조회
  fastify.get(
    "/github/my",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = await checkAuth(request);
        const userProfile = await githubMyService.getUserProfile(user.id);

        return reply.send({
          status: "success",
          data: userProfile,
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
        return errorResponse(reply, error, "Error fetching user profile");
      }
    }
  );

  // 프로필 사진 업로드 및 업데이트
  fastify.post(
    "/github/my/profile-image",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = await checkAuth(request);

        logger.info(
          { userId: user.id },
          "Profile image upload request received"
        );

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
        const data = body.image || body.profileImage || body.file; // 여러 필드명 지원

        if (!data) {
          return reply.status(400).send({
            status: "error",
            message:
              "No image file provided. Please attach a file with field name 'image', 'profileImage', or 'file'.",
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
          "Processing profile image upload"
        );

        // 서비스를 통해 프로필 이미지 업로드
        const result = await githubMyService.uploadProfileImage({
          userId: user.id,
          fileName,
          fileBuffer,
        });

        return reply.send({
          status: "success",
          message: "Profile image updated successfully",
          data: result,
        });
      } catch (error) {
        logger.error({ error }, "Profile image upload error");

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
          (error.message.includes("Only image files are allowed") ||
            error.message.includes("Image size exceeds limit"))
        ) {
          return reply.status(400).send({
            status: "error",
            message: error.message,
          });
        }

        return errorResponse(reply, error, "Error updating profile image");
      }
    }
  );

  // 프로필 사진 삭제 (기본 GitHub 아바타로 되돌리기)
  fastify.delete(
    "/github/my/profile-image",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = await checkAuth(request);

        // 서비스를 통해 프로필 이미지 리셋
        const updatedUser = await githubMyService.resetProfileImage(user.id);

        return reply.send({
          status: "success",
          message: "Profile image reset to GitHub avatar",
          data: {
            user: updatedUser,
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
        return errorResponse(reply, error, "Error resetting profile image");
      }
    }
  );
}
