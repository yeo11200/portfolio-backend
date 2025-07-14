import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutBucketPolicyCommand,
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

interface BucketCreationResult {
  created: boolean;
  existed: boolean;
  error?: string;
}

/**
 * S3 버킷 존재 여부 확인
 */
const checkBucketExists = async (bucketName: string): Promise<boolean> => {
  try {
    const headBucketCommand = new HeadBucketCommand({
      Bucket: bucketName,
    });

    await s3Client.send(headBucketCommand);
    return true;
  } catch (error: any) {
    if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    // 다른 에러는 재발생시킴 (권한 문제 등)
    throw error;
  }
};

/**
 * S3 버킷 생성 및 설정
 */
const createBucketWithConfiguration = async (
  bucketName: string
): Promise<BucketCreationResult> => {
  try {
    if (!AWS_REGION) {
      throw new Error("AWS_REGION is not configured");
    }

    // 버킷 생성
    const createBucketCommand = new CreateBucketCommand({
      Bucket: bucketName,
      CreateBucketConfiguration:
        AWS_REGION !== "us-east-1"
          ? {
              LocationConstraint: AWS_REGION as any, // AWS SDK 타입 이슈로 인한 타입 캐스팅
            }
          : undefined, // us-east-1은 LocationConstraint가 필요 없음
    });

    await s3Client.send(createBucketCommand);
    logger.info(
      { bucketName, region: AWS_REGION },
      "S3 bucket created successfully"
    );

    // CORS 설정 (웹 애플리케이션에서 직접 업로드 가능하도록)
    const corsConfiguration = {
      CORSRules: [
        {
          AllowedHeaders: ["*"],
          AllowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD"],
          AllowedOrigins: ["*"], // 프로덕션에서는 특정 도메인으로 제한
          ExposeHeaders: ["ETag"],
          MaxAgeSeconds: 3000,
        },
      ],
    };

    const putBucketCorsCommand = new PutBucketCorsCommand({
      Bucket: bucketName,
      CORSConfiguration: corsConfiguration,
    });

    await s3Client.send(putBucketCorsCommand);
    logger.info({ bucketName }, "CORS configuration applied to bucket");

    // 버킷 정책 설정 (public read 접근을 위한 정책)
    const bucketPolicy = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "PublicReadGetObject",
          Effect: "Allow",
          Principal: "*",
          Action: "s3:GetObject",
          Resource: `arn:aws:s3:::${bucketName}/profiles/*`, // profiles 폴더만 public read
        },
      ],
    };

    const putBucketPolicyCommand = new PutBucketPolicyCommand({
      Bucket: bucketName,
      Policy: JSON.stringify(bucketPolicy),
    });

    await s3Client.send(putBucketPolicyCommand);
    logger.info(
      { bucketName },
      "Bucket policy applied for public profile images"
    );

    return { created: true, existed: false };
  } catch (error: any) {
    logger.error({ error, bucketName }, "Error creating S3 bucket");
    return {
      created: false,
      existed: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
};

/**
 * 버킷 존재 확인 및 필요시 생성
 */
const ensureBucketExists = async (
  bucketName: string
): Promise<BucketCreationResult> => {
  try {
    const bucketExists = await checkBucketExists(bucketName);

    if (bucketExists) {
      logger.debug({ bucketName }, "S3 bucket already exists");
      return { created: false, existed: true };
    }

    logger.info({ bucketName }, "S3 bucket does not exist, creating...");
    return await createBucketWithConfiguration(bucketName);
  } catch (error: any) {
    logger.error({ error, bucketName }, "Error checking/creating S3 bucket");
    return {
      created: false,
      existed: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
};

/**
 * 파일을 S3에 직접 업로드 (버킷 자동 생성 포함)
 */
export const uploadFileToS3 = async (
  options: UploadFileOptions,
  retryCount: number = 0
): Promise<UploadResult> => {
  const MAX_RETRIES = 2;

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
      Metadata: {
        userId,
        originalName: Buffer.from(fileName, "utf8").toString("base64"),
        uploadedAt: new Date().toISOString(),
      },
    });

    // S3에 파일 업로드 시도
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
        retryCount,
      },
      "File uploaded to S3 successfully"
    );

    return result;
  } catch (error: any) {
    // 버킷이 존재하지 않는 경우 처리
    if (
      (error.name === "NoSuchBucket" ||
        error.$metadata?.httpStatusCode === 404 ||
        error.message?.includes("does not exist")) &&
      retryCount < MAX_RETRIES &&
      S3_BUCKET_NAME // null 체크 추가
    ) {
      logger.warn(
        { bucketName: S3_BUCKET_NAME, retryCount },
        "Bucket does not exist, attempting to create and retry upload"
      );

      // 버킷 생성 시도
      const bucketResult = await ensureBucketExists(S3_BUCKET_NAME);

      if (bucketResult.created || bucketResult.existed) {
        logger.info(
          { bucketName: S3_BUCKET_NAME, created: bucketResult.created },
          "Bucket is now available, retrying upload"
        );

        // 재시도 (잠시 대기 후)
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return uploadFileToS3(options, retryCount + 1);
      } else {
        throw new Error(
          `Failed to create bucket: ${bucketResult.error || "Unknown error"}`
        );
      }
    }

    logger.error(
      {
        error,
        fileName: options.fileName,
        userId: options.userId,
        retryCount,
        bucketName: S3_BUCKET_NAME,
      },
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
  generatePresignedDownloadUrl,
  deleteFileFromS3,
  validateFileType,
  validateFileSize,
  getContentType,
};
