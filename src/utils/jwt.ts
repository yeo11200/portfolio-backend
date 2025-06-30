import jwt from "jsonwebtoken";
import logger from "./logger";
import dotenv from "dotenv";
import { FastifyRequest } from "fastify";
import githubService from "../services/github-service";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
const TOKEN_EXPIRES_IN = "7d";

export interface JWTPayload {
  userId: string;
}

/**
 * JWT 토큰 생성
 */
export const generateToken = (userId: string): string => {
  try {
    return jwt.sign({ userId }, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });
  } catch (error) {
    logger.error({ error }, "Error generating JWT token");
    throw new Error("Failed to generate token");
  }
};

/**
 * JWT 토큰 검증
 */
export const verifyToken = (token: string): JWTPayload => {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch (error) {
    logger.error({ error }, "Error verifying JWT token");
    throw new Error("Invalid token");
  }
};

/**
 * Authorization 헤더에서 토큰 추출
 */
export const extractTokenFromHeader = (
  authHeader: string | undefined
): string => {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("No token provided");
  }
  return authHeader.split(" ")[1];
};

/**
 * 토큰 만료 시간 확인
 */
export const isTokenExpired = (token: string): boolean => {
  try {
    const decoded = jwt.decode(token) as any;
    if (!decoded || !decoded.exp) {
      return true;
    }
    return Date.now() >= decoded.exp * 1000;
  } catch (error) {
    logger.error({ error }, "Error checking token expiration");
    return true;
  }
};

/**
 * 토큰에서 사용자 ID 추출 (검증 없이)
 */
export const getUserIdFromToken = (token: string): string | null => {
  try {
    const decoded = jwt.decode(token) as JWTPayload;
    return decoded?.userId || null;
  } catch (error) {
    logger.error({ error }, "Error extracting user ID from token");
    return null;
  }
};

// 인증 체크 헬퍼 함수
export const checkAuth = async (request: FastifyRequest) => {
  try {
    logger.info(request.headers.authorization);
    const token = extractTokenFromHeader(request.headers.authorization);
    const { userId } = verifyToken(token);

    logger.info(`${userId} userId`);

    const user = await githubService.getUserById(userId);
    if (!user) {
      throw new Error("User not found");
    }
    return user;
  } catch (error) {
    if (error instanceof Error && error.message === "No token provided") {
      throw new Error("Authentication required");
    }

    throw error;
  }
};

export default {
  generateToken,
  verifyToken,
  extractTokenFromHeader,
  isTokenExpired,
  getUserIdFromToken,
  checkAuth,
};
