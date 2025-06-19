import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import s3Service from "../services/s3-service";
import { checkAuth } from "../utils/jwt";
import logger from "../utils/logger";

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

// 파일 업로드 설정
const UPLOAD_LIMITS = {
  // 파일 크기 제한 (바이트)
  MAX_FILE_SIZE: {
    image: 10 * 1024 * 1024, // 10MB
    document: 50 * 1024 * 1024, // 50MB
    video: 500 * 1024 * 1024, // 500MB
    audio: 20 * 1024 * 1024, // 20MB
    archive: 100 * 1024 * 1024, // 100MB
    default: 100 * 1024 * 1024, // 100MB
  },
  // 허용된 파일 타입
  ALLOWED_TYPES: {
    image: ["jpg", "jpeg", "png", "gif", "webp", "svg"],
    document: [
      "pdf",
      "doc",
      "docx",
      "xls",
      "xlsx",
      "ppt",
      "pptx",
      "txt",
      "csv",
    ],
    video: ["mp4", "avi", "mov", "wmv", "flv", "webm"],
    audio: ["mp3", "wav", "flac", "aac", "ogg"],
    archive: ["zip", "rar", "7z", "tar", "gz"],
  },
} as const;

export default async function s3Routes(
  fastify: FastifyInstance
): Promise<void> {
  // Multipart 플러그인 등록 (파일 업로드용)
  await fastify.register(import("@fastify/multipart"), {
    limits: {
      fileSize: UPLOAD_LIMITS.MAX_FILE_SIZE.default,
    },
  });

  // 직접 파일 업로드 (서버를 통해)
  fastify.post(
    "/s3/upload",
    async (
      request: FastifyRequest<{
        Querystring: {
          folder?: string;
          isPublic?: string;
        };
      }>,
      reply
    ) => {
      try {
        const user = await checkAuth(request);
        const { folder = "uploads", isPublic = "false" } = request.query;

        // 파일 데이터 받기
        const data = await (request as any).file();
        if (!data) {
          return reply.status(400).send({
            status: "error",
            message: "No file provided",
          });
        }

        const fileName = data.filename;
        const fileBuffer = await data.toBuffer();
        const contentType = s3Service.getContentType(fileName);

        // 파일 타입 검증
        const fileCategory = getFileCategory(fileName);
        const allowedTypes = UPLOAD_LIMITS.ALLOWED_TYPES[fileCategory] || [];

        if (!s3Service.validateFileType(fileName, [...allowedTypes])) {
          return reply.status(400).send({
            status: "error",
            message: `File type not allowed. Allowed types: ${[
              ...allowedTypes,
            ].join(", ")}`,
          });
        }

        // 파일 크기 검증
        const maxSize =
          UPLOAD_LIMITS.MAX_FILE_SIZE[fileCategory] ||
          UPLOAD_LIMITS.MAX_FILE_SIZE.default;
        if (!s3Service.validateFileSize(fileBuffer.length, maxSize)) {
          return reply.status(400).send({
            status: "error",
            message: `File size exceeds limit. Maximum size: ${Math.round(
              maxSize / 1024 / 1024
            )}MB`,
          });
        }

        // S3에 업로드
        const result = await s3Service.uploadFileToS3({
          userId: user.id,
          fileName,
          fileBuffer,
          contentType,
          folder,
          isPublic: isPublic === "true",
        });

        return reply.send({
          status: "success",
          data: result,
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
        return errorResponse(reply, error, "Error uploading file");
      }
    }
  );

  // Presigned URL 생성 (클라이언트 직접 업로드용)
  fastify.post(
    "/s3/presigned-url",
    async (
      request: FastifyRequest<{
        Body: {
          fileName: string;
          contentType?: string;
          folder?: string;
          expiresIn?: number;
        };
      }>,
      reply
    ) => {
      try {
        const user = await checkAuth(request);
        const {
          fileName,
          contentType,
          folder = "uploads",
          expiresIn = 300,
        } = request.body;

        if (!fileName) {
          return reply.status(400).send({
            status: "error",
            message: "fileName is required",
          });
        }

        // 파일 타입 검증
        const fileCategory = getFileCategory(fileName);
        const allowedTypes = UPLOAD_LIMITS.ALLOWED_TYPES[fileCategory] || [];

        if (!s3Service.validateFileType(fileName, [...allowedTypes])) {
          return reply.status(400).send({
            status: "error",
            message: `File type not allowed. Allowed types: ${[
              ...allowedTypes,
            ].join(", ")}`,
          });
        }

        const finalContentType =
          contentType || s3Service.getContentType(fileName);

        const result = await s3Service.generatePresignedUploadUrl({
          fileName,
          contentType: finalContentType,
          folder,
          userId: user.id,
          expiresIn,
        });

        return reply.send({
          status: "success",
          data: {
            ...result,
            uploadInstructions: {
              method: "PUT",
              headers: {
                "Content-Type": finalContentType,
              },
              maxFileSize:
                UPLOAD_LIMITS.MAX_FILE_SIZE[fileCategory] ||
                UPLOAD_LIMITS.MAX_FILE_SIZE.default,
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
        return errorResponse(reply, error, "Error generating presigned URL");
      }
    }
  );

  // 사용자 파일 목록 조회
  fastify.get(
    "/s3/files",
    async (
      request: FastifyRequest<{
        Querystring: {
          folder?: string;
        };
      }>,
      reply
    ) => {
      try {
        const user = await checkAuth(request);
        const { folder = "uploads" } = request.query;

        const result = await s3Service.getUserFiles(user.id, folder);

        return reply.send({
          status: "success",
          data: result,
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
        return errorResponse(reply, error, "Error retrieving user files");
      }
    }
  );

  // 파일 다운로드 URL 생성
  fastify.get(
    "/s3/download/:fileKey",
    async (
      request: FastifyRequest<{
        Params: {
          fileKey: string;
        };
        Querystring: {
          expiresIn?: string;
        };
      }>,
      reply
    ) => {
      try {
        const user = await checkAuth(request);
        const { fileKey } = request.params;
        const { expiresIn = "3600" } = request.query;

        // 파일 키에서 사용자 ID 확인 (권한 검증)
        const decodedFileKey = decodeURIComponent(fileKey);
        if (!decodedFileKey.includes(`/${user.id}/`)) {
          return reply.status(403).send({
            status: "error",
            message: "Access denied to this file",
          });
        }

        const downloadUrl = await s3Service.generatePresignedDownloadUrl(
          decodedFileKey,
          parseInt(expiresIn)
        );

        return reply.send({
          status: "success",
          data: {
            downloadUrl,
            expiresAt: new Date(
              Date.now() + parseInt(expiresIn) * 1000
            ).toISOString(),
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
        return errorResponse(reply, error, "Error generating download URL");
      }
    }
  );

  // 파일 삭제
  fastify.delete(
    "/s3/files/:fileKey",
    async (
      request: FastifyRequest<{
        Params: {
          fileKey: string;
        };
      }>,
      reply
    ) => {
      try {
        const user = await checkAuth(request);
        const { fileKey } = request.params;

        // 파일 키에서 사용자 ID 확인 (권한 검증)
        const decodedFileKey = decodeURIComponent(fileKey);
        if (!decodedFileKey.includes(`/${user.id}/`)) {
          return reply.status(403).send({
            status: "error",
            message: "Access denied to this file",
          });
        }

        await s3Service.deleteFileFromS3(decodedFileKey);

        return reply.send({
          status: "success",
          message: "File deleted successfully",
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
        return errorResponse(reply, error, "Error deleting file");
      }
    }
  );

  // 파일 업로드 제한 정보 조회
  fastify.get("/s3/upload-limits", async (_request, reply) => {
    return reply.send({
      status: "success",
      data: {
        maxFileSizes: Object.entries(UPLOAD_LIMITS.MAX_FILE_SIZE).map(
          ([category, size]) => ({
            category,
            maxSizeBytes: size,
            maxSizeMB: Math.round(size / 1024 / 1024),
          })
        ),
        allowedTypes: UPLOAD_LIMITS.ALLOWED_TYPES,
      },
    });
  });
}

/**
 * 파일명에서 카테고리 추론
 */
function getFileCategory(
  fileName: string
): keyof typeof UPLOAD_LIMITS.ALLOWED_TYPES {
  const extension = fileName.split(".").pop()?.toLowerCase() || "";

  for (const [category, types] of Object.entries(UPLOAD_LIMITS.ALLOWED_TYPES)) {
    if (types.includes(extension as never)) {
      return category as keyof typeof UPLOAD_LIMITS.ALLOWED_TYPES;
    }
  }

  return "document"; // 기본값
}
