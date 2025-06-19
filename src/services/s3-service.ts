import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import logger from "../utils/logger";
import dotenv from "dotenv";

dotenv.config();

// AWS S3 환경 변수 검증
const AWS_REGION = process.env.AWS_REGION;
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;

if (
  !AWS_REGION ||
  !AWS_ACCESS_KEY_ID ||
  !AWS_SECRET_ACCESS_KEY ||
  !S3_BUCKET_NAME
) {
  logger.warn(
    "AWS S3 credentials are not fully configured. S3 features will be disabled."
  );
}

// S3 클라이언트 초기화
const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID || "",
    secretAccessKey: AWS_SECRET_ACCESS_KEY || "",
  },
});

export interface UploadFileOptions {
  userId: string;
  fileName: string;
  fileBuffer: Buffer;
  contentType?: string;
  folder?: string;
  isPublic?: boolean;
}

export interface UploadResult {
  fileKey: string;
  fileUrl: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  uploadedAt: string;
}

export interface PresignedUrlOptions {
  fileName: string;
  contentType: string;
  folder?: string;
  userId: string;
  expiresIn?: number; // seconds
}

/**
 * 파일을 S3에 직접 업로드
 */
export const uploadFileToS3 = async (
  options: UploadFileOptions
): Promise<UploadResult> => {
  try {
    if (!S3_BUCKET_NAME) {
      throw new Error("S3 bucket name is not configured");
    }

    const {
      userId,
      fileName,
      fileBuffer,
      contentType = "application/octet-stream",
      folder = "uploads",
      isPublic = false,
    } = options;

    // 파일 키 생성 (폴더/사용자ID/타임스탬프_파일명)
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileKey = `${folder}/${userId}/${timestamp}_${fileName}`;

    // S3 업로드 명령 생성
    const putObjectCommand = new PutObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: fileKey,
      Body: fileBuffer,
      ContentType: contentType,
      ACL: isPublic ? "public-read" : "private",
      Metadata: {
        userId,
        originalName: fileName,
        uploadedAt: new Date().toISOString(),
      },
    });

    // S3에 파일 업로드
    await s3Client.send(putObjectCommand);

    // 파일 URL 생성
    const fileUrl = isPublic
      ? `https://${S3_BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${fileKey}`
      : await getSignedUrl(
          s3Client,
          new GetObjectCommand({
            Bucket: S3_BUCKET_NAME,
            Key: fileKey,
          }),
          { expiresIn: 3600 }
        ); // 1시간 유효

    const result: UploadResult = {
      fileKey,
      fileUrl,
      fileName,
      fileSize: fileBuffer.length,
      contentType,
      uploadedAt: new Date().toISOString(),
    };

    logger.info(
      {
        fileKey,
        fileName,
        fileSize: fileBuffer.length,
        userId,
      },
      "File uploaded to S3 successfully"
    );

    return result;
  } catch (error) {
    logger.error(
      { error, fileName: options.fileName, userId: options.userId },
      "Error uploading file to S3"
    );
    throw new Error(
      `Failed to upload file to S3: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
};

/**
 * Presigned URL 생성 (클라이언트에서 직접 업로드용)
 */
export const generatePresignedUploadUrl = async (
  options: PresignedUrlOptions
): Promise<{
  uploadUrl: string;
  fileKey: string;
  expiresAt: string;
}> => {
  try {
    if (!S3_BUCKET_NAME) {
      throw new Error("S3 bucket name is not configured");
    }

    const {
      fileName,
      contentType,
      folder = "uploads",
      userId,
      expiresIn = 300,
    } = options; // 5분 기본

    // 파일 키 생성
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileKey = `${folder}/${userId}/${timestamp}_${fileName}`;

    // Presigned URL 생성
    const putObjectCommand = new PutObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: fileKey,
      ContentType: contentType,
      Metadata: {
        userId,
        originalName: fileName,
      },
    });

    const uploadUrl = await getSignedUrl(s3Client, putObjectCommand, {
      expiresIn,
    });

    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    logger.info(
      {
        fileKey,
        fileName,
        userId,
        expiresIn,
      },
      "Presigned upload URL generated"
    );

    return {
      uploadUrl,
      fileKey,
      expiresAt,
    };
  } catch (error) {
    logger.error(
      { error, fileName: options.fileName, userId: options.userId },
      "Error generating presigned upload URL"
    );
    throw new Error(
      `Failed to generate presigned upload URL: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
};

/**
 * Presigned Download URL 생성
 */
export const generatePresignedDownloadUrl = async (
  fileKey: string,
  expiresIn: number = 3600
): Promise<string> => {
  try {
    if (!S3_BUCKET_NAME) {
      throw new Error("S3 bucket name is not configured");
    }

    const getObjectCommand = new GetObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: fileKey,
    });

    const downloadUrl = await getSignedUrl(s3Client, getObjectCommand, {
      expiresIn,
    });

    logger.info({ fileKey, expiresIn }, "Presigned download URL generated");

    return downloadUrl;
  } catch (error) {
    logger.error({ error, fileKey }, "Error generating presigned download URL");
    throw new Error(
      `Failed to generate presigned download URL: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
};

/**
 * S3에서 파일 삭제
 */
export const deleteFileFromS3 = async (fileKey: string): Promise<void> => {
  try {
    if (!S3_BUCKET_NAME) {
      throw new Error("S3 bucket name is not configured");
    }

    const deleteObjectCommand = new DeleteObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: fileKey,
    });

    await s3Client.send(deleteObjectCommand);

    logger.info({ fileKey }, "File deleted from S3 successfully");
  } catch (error) {
    logger.error({ error, fileKey }, "Error deleting file from S3");
    throw new Error(
      `Failed to delete file from S3: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
};

/**
 * 사용자별 파일 목록 조회 (S3 객체 목록)
 */
export const getUserFiles = async (
  userId: string,
  folder: string = "uploads"
): Promise<{
  files: Array<{
    key: string;
    fileName: string;
    size: number;
    lastModified: string;
    contentType?: string;
  }>;
  totalCount: number;
}> => {
  try {
    if (!S3_BUCKET_NAME) {
      throw new Error("S3 bucket name is not configured");
    }

    const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");

    const listCommand = new ListObjectsV2Command({
      Bucket: S3_BUCKET_NAME,
      Prefix: `${folder}/${userId}/`,
      MaxKeys: 100,
    });

    const response = await s3Client.send(listCommand);
    const objects = response.Contents || [];

    const files = objects.map((obj) => ({
      key: obj.Key || "",
      fileName: obj.Key?.split("/").pop()?.split("_").slice(1).join("_") || "",
      size: obj.Size || 0,
      lastModified: obj.LastModified?.toISOString() || "",
    }));

    logger.info(
      { userId, fileCount: files.length },
      "Retrieved user files from S3"
    );

    return {
      files,
      totalCount: files.length,
    };
  } catch (error) {
    logger.error({ error, userId }, "Error retrieving user files from S3");
    throw new Error(
      `Failed to retrieve user files: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
};

/**
 * 파일 타입 검증
 */
export const validateFileType = (
  fileName: string,
  allowedTypes: string[]
): boolean => {
  const fileExtension = fileName.toLowerCase().split(".").pop();
  return fileExtension ? allowedTypes.includes(fileExtension) : false;
};

/**
 * 파일 크기 검증 (바이트 단위)
 */
export const validateFileSize = (
  fileSize: number,
  maxSizeBytes: number
): boolean => {
  return fileSize <= maxSizeBytes;
};

/**
 * Content-Type 추론
 */
export const getContentType = (fileName: string): string => {
  const extension = fileName.toLowerCase().split(".").pop();

  const contentTypeMap: Record<string, string> = {
    // 이미지
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",

    // 문서
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",

    // 텍스트
    txt: "text/plain",
    csv: "text/csv",
    json: "application/json",
    xml: "application/xml",

    // 압축
    zip: "application/zip",
    rar: "application/x-rar-compressed",

    // 비디오
    mp4: "video/mp4",
    avi: "video/x-msvideo",
    mov: "video/quicktime",

    // 오디오
    mp3: "audio/mpeg",
    wav: "audio/wav",

    // 기타
    js: "application/javascript",
    css: "text/css",
    html: "text/html",
  };

  return extension
    ? contentTypeMap[extension] || "application/octet-stream"
    : "application/octet-stream";
};

export default {
  uploadFileToS3,
  generatePresignedUploadUrl,
  generatePresignedDownloadUrl,
  deleteFileFromS3,
  getUserFiles,
  validateFileType,
  validateFileSize,
  getContentType,
};
