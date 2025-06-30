import aiSummaryService from "./ai-summary-service";
import githubService from "./github-service";
import s3Service from "./s3-service";
import supabaseClient from "../config/supabase-client";
import logger from "../utils/logger";
import { PROFILE_IMAGE_LIMITS } from "../constant/s3-constant";

export interface UserProfile {
  count: number;
  monthCount: number;
  repositorySummary: any[];
  removeDuplicatesSummary: number;
  createdAt: string;
}

export interface ProfileImageUploadOptions {
  userId: string;
  fileName: string;
  fileBuffer: Buffer;
}

export interface ProfileImageUploadResult {
  user: any;
  image: {
    url: string;
    key: string;
    uploadedAt: string;
  };
}

export interface UserData {
  id: string;
  username: string;
  profile_image_url: string | null;
  avatar_url?: string | null;
}

/**
 * 사용자 프로필 정보 조회
 */
const getUserProfile = async (userId: string): Promise<UserProfile> => {
  try {
    const [
      count,
      monthCount,
      repositorySummary,
      removeDuplicatesSummary,
      createdAt,
    ] = await Promise.all([
      aiSummaryService.getUserRepositorySummaryCounts(userId),
      aiSummaryService.getUserMonthlyRepositorySummaryCounts(userId),
      aiSummaryService.getUserRepositorySummary(userId),
      aiSummaryService.getUserUniqueRepoSummaryCounts(userId),
      githubService.getUserCreatedAt(userId),
    ]);

    return {
      count: count.count,
      monthCount: monthCount.count,
      repositorySummary: repositorySummary || [],
      removeDuplicatesSummary: removeDuplicatesSummary?.summary_count || 0,
      createdAt: createdAt.data.created_at,
    };
  } catch (error) {
    logger.error({ error, userId }, "Error fetching user profile");
    throw new Error("Failed to fetch user profile");
  }
};

/**
 * 프로필 이미지 파일 검증
 */
const validateProfileImage = (
  fileName: string,
  fileSize: number
): { isValid: boolean; error?: string } => {
  // 파일 타입 검증
  if (
    !s3Service.validateFileType(fileName, [
      ...PROFILE_IMAGE_LIMITS.ALLOWED_TYPES,
    ])
  ) {
    return {
      isValid: false,
      error: `Only image files are allowed. Supported formats: ${PROFILE_IMAGE_LIMITS.ALLOWED_TYPES.join(
        ", "
      )}`,
    };
  }

  // 파일 크기 검증
  if (
    !s3Service.validateFileSize(fileSize, PROFILE_IMAGE_LIMITS.MAX_FILE_SIZE)
  ) {
    return {
      isValid: false,
      error: `Image size exceeds limit. Maximum size: ${Math.round(
        PROFILE_IMAGE_LIMITS.MAX_FILE_SIZE / 1024 / 1024
      )}MB`,
    };
  }

  return { isValid: true };
};

/**
 * 기존 프로필 이미지 삭제 (S3에서)
 */
const deleteExistingProfileImage = async (userId: string): Promise<void> => {
  try {
    const { data: userData } = await supabaseClient
      .from("users")
      .select("profile_image_url")
      .eq("id", userId)
      .single();

    if (
      userData?.profile_image_url &&
      userData.profile_image_url.includes("amazonaws.com")
    ) {
      // S3 URL에서 키 추출하여 기존 이미지 삭제
      const urlParts = userData.profile_image_url.split("/");
      const bucketIndex = urlParts.findIndex((part: string) =>
        part.includes(".amazonaws.com")
      );
      if (bucketIndex !== -1 && bucketIndex < urlParts.length - 1) {
        const key = urlParts.slice(bucketIndex + 1).join("/");
        await s3Service.deleteFileFromS3(key);
        logger.info({ oldImageKey: key, userId }, "Deleted old profile image");
      }
    }
  } catch (error) {
    logger.warn(
      { error, userId },
      "Failed to delete old profile image, continuing with upload"
    );
    // 기존 이미지 삭제 실패는 치명적이지 않으므로 에러를 던지지 않음
  }
};

/**
 * 프로필 이미지 업로드 및 데이터베이스 업데이트
 */
const uploadProfileImage = async (options: {
  userId: string;
  fileName: string;
  fileBuffer: Buffer;
}): Promise<ProfileImageUploadResult> => {
  const { userId, fileName, fileBuffer } = options;

  logger.info(
    {
      userId,
      fileName,
      fileSize: fileBuffer.length,
      s3BucketName: process.env.S3_BUCKET_NAME,
      awsRegion: process.env.AWS_REGION,
    },
    "Starting profile image upload"
  );

  // 파일 검증
  const validation = validateProfileImage(fileName, fileBuffer.length);
  if (!validation.isValid) {
    logger.warn(
      { userId, fileName, error: validation.error },
      "File validation failed"
    );
    throw new Error(validation.error);
  }

  // 기존 프로필 이미지 삭제
  try {
    await deleteExistingProfileImage(userId);
  } catch (error) {
    logger.warn(
      { userId, error },
      "Failed to delete existing profile image, continuing..."
    );
  }

  // S3 업로드
  try {
    logger.info({ userId, fileName }, "Attempting S3 upload");

    const uploadResult = await s3Service.uploadFileToS3({
      userId,
      fileName,
      fileBuffer,
      contentType: s3Service.getContentType(fileName),
      folder: PROFILE_IMAGE_LIMITS.FOLDER,
      isPublic: true,
    });

    logger.info({ userId, uploadResult }, "S3 upload successful");

    // 데이터베이스 업데이트
    const { data: updatedUser, error: updateError } = await supabaseClient
      .from("users")
      .update({
        profile_image_url: uploadResult.fileUrl,
        updated_at: new Date().toISOString(),
        profile_upload_date: new Date().toISOString(),
      })
      .eq("id", userId)
      .select("id, username, profile_image_url")
      .single();

    if (updateError) {
      logger.error({ userId, error: updateError }, "Database update failed");
      // S3 업로드는 성공했지만 DB 업데이트 실패 시 롤백
      try {
        await s3Service.deleteFileFromS3(uploadResult.fileKey);
      } catch (rollbackError) {
        logger.error({ userId, rollbackError }, "Failed to rollback S3 upload");
      }
      throw new Error("Failed to update user profile in database");
    }

    return {
      user: updatedUser,
      image: {
        url: uploadResult.fileUrl,
        key: uploadResult.fileKey,
        uploadedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    logger.error({ userId, fileName, error }, "Profile image upload failed");
    throw error;
  }
};

/**
 * 프로필 이미지 삭제 (GitHub 아바타로 되돌리기)
 */
const resetProfileImage = async (userId: string): Promise<UserData> => {
  try {
    // 현재 프로필 이미지 정보 가져오기
    const { data: userData, error: fetchError } = await supabaseClient
      .from("users")
      .select("profile_image_url, avatar_url")
      .eq("id", userId)
      .single();

    if (fetchError) {
      throw new Error("Failed to fetch user profile");
    }

    // S3에서 프로필 이미지 삭제 (S3 URL인 경우만)
    if (
      userData?.profile_image_url &&
      userData.profile_image_url.includes("amazonaws.com")
    ) {
      try {
        const urlParts = userData.profile_image_url.split("/");
        const bucketIndex = urlParts.findIndex((part: string) =>
          part.includes(".amazonaws.com")
        );
        if (bucketIndex !== -1 && bucketIndex < urlParts.length - 1) {
          const key = urlParts.slice(bucketIndex + 1).join("/");
          await s3Service.deleteFileFromS3(key);
          logger.info(
            { deletedImageKey: key, userId },
            "Deleted profile image from S3"
          );
        }
      } catch (deleteError) {
        logger.warn(
          { error: deleteError, userId },
          "Failed to delete image from S3, continuing with database update"
        );
      }
    }

    // 데이터베이스에서 프로필 이미지 URL을 GitHub 아바타로 되돌리기
    const { data: updatedUser, error: updateError } = await supabaseClient
      .from("users")
      .update({
        profile_image_url: null, // 완전히 null로 설정
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId)
      .select("id, username, profile_image_url, avatar_url")
      .single();

    if (updateError) {
      throw new Error("Failed to reset profile image in database");
    }

    logger.info({ userId }, "Profile image reset to GitHub avatar");

    return updatedUser;
  } catch (error) {
    logger.error({ error, userId }, "Error resetting profile image");
    throw error;
  }
};

/**
 * S3 URL에서 파일 키 추출
 */
const extractS3KeyFromUrl = (url: string): string | null => {
  if (!url.includes("amazonaws.com")) {
    return null;
  }

  const urlParts = url.split("/");
  const bucketIndex = urlParts.findIndex((part: string) =>
    part.includes(".amazonaws.com")
  );

  if (bucketIndex !== -1 && bucketIndex < urlParts.length - 1) {
    return urlParts.slice(bucketIndex + 1).join("/");
  }

  return null;
};

const getProfileImageUpdateDate = async (userId: string): Promise<string> => {
  const { data: userData, error: fetchError } = await supabaseClient
    .from("users")
    .select("profile_upload_date")
    .eq("id", userId)
    .single();

  return userData?.profile_upload_date || null;
};

export default {
  getUserProfile,
  validateProfileImage,
  deleteExistingProfileImage,
  uploadProfileImage,
  resetProfileImage,
  extractS3KeyFromUrl,
  getProfileImageUpdateDate,
};
