// 프로필 이미지 업로드 설정
export const PROFILE_IMAGE_LIMITS = {
  MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
  ALLOWED_TYPES: ["jpg", "jpeg", "png", "webp"] as const,
  FOLDER: "profiles",
} as const;
