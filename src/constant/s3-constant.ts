// 프로필 이미지 업로드 설정
export const PROFILE_IMAGE_LIMITS = {
  MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
  ALLOWED_TYPES: ["jpg", "jpeg", "png", "webp"] as const,
  FOLDER: "profiles",
} as const;

// 이력서 PDF 업로드 설정
export const RESUME_PDF_LIMITS = {
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_TYPES: ["pdf"] as const,
  FOLDER: "resumes",
} as const;
