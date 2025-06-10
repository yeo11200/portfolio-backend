import axios from "axios";
import supabaseClient from "../config/supabase-client";
import logger from "../utils/logger";
import dotenv from "dotenv";

dotenv.config();

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GITHUB_CALLBACK_URL = process.env.GITHUB_CALLBACK_URL;

if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !GITHUB_CALLBACK_URL) {
  throw new Error(
    "GitHub OAuth credentials must be defined in environment variables"
  );
}

export interface GitHubUser {
  id: number;
  login: string;
  avatar_url: string;
}

export interface GitHubToken {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

/**
 * GitHub OAuth 인증 URL 생성
 */
export const getGitHubAuthUrl = (): string => {
  const scope = "read:user repo";
  return `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${GITHUB_CALLBACK_URL}&scope=${scope}`;
};

/**
 * GitHub OAuth 콜백 처리 및 액세스 토큰 획득
 */
export const handleGitHubCallback = async (
  code: string
): Promise<GitHubToken> => {
  try {
    const response = await axios.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: GITHUB_CALLBACK_URL,
      },
      {
        headers: {
          Accept: "application/json",
        },
      }
    );

    return response.data;
  } catch (error) {
    logger.error({ error }, "Error getting GitHub access token");
    throw new Error("Failed to get GitHub access token");
  }
};

/**
 * GitHub 사용자 정보 가져오기
 */
export const getGitHubUser = async (
  accessToken: string
): Promise<GitHubUser> => {
  try {
    const response = await axios.get("https://api.github.com/user", {
      headers: {
        Authorization: `token ${accessToken}`,
      },
    });

    return response.data;
  } catch (error) {
    logger.error({ error }, "Error getting GitHub user");
    throw new Error("Failed to get GitHub user");
  }
};

/**
 * 사용자 저장 또는 업데이트
 */
export const saveOrUpdateUser = async (
  githubUser: GitHubUser,
  tokenData: GitHubToken
): Promise<string> => {
  try {
    // 먼저 기존 사용자 확인
    const { data: existingUser, error: fetchError } = await supabaseClient
      .from("users")
      .select("*")
      .eq("github_id", githubUser.id.toString())
      .single();

    const tokenExpiresAt = new Date();
    tokenExpiresAt.setSeconds(
      tokenExpiresAt.getSeconds() + tokenData.expires_in
    );

    // 기존 사용자가 없으면 새로 생성
    if (fetchError && fetchError.code === "PGRST116") {
      logger.info(
        `Creating new user for GitHub ID: ${githubUser.id}, ${
          githubUser.login
        }, ${githubUser.avatar_url}, ${
          tokenData.access_token
        }, ${tokenExpiresAt.toISOString()}, ${githubUser.avatar_url}`
      );

      const { data, error } = await supabaseClient
        .from("users")
        .insert({
          github_id: githubUser.id.toString(),
          username: githubUser.login,
          avatar_url: githubUser.avatar_url,
          access_token: tokenData.access_token,
          token_expires_at: tokenExpiresAt.toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (error) {
        logger.error({ error }, "Error creating new user");
        throw new Error("Failed to create user");
      }

      return data.id;
    }

    // 기존 사용자가 있으면 업데이트가 필요한지 확인
    if (existingUser) {
      const currentTime = new Date();
      const tokenExpiry = new Date(existingUser.token_expires_at);

      // 토큰이 만료되었거나, 사용자 정보가 변경된 경우에만 업데이트
      const needsTokenUpdate = currentTime >= tokenExpiry;
      const needsProfileUpdate =
        existingUser.username !== githubUser.login ||
        existingUser.avatar_url !== githubUser.avatar_url;

      if (needsTokenUpdate || needsProfileUpdate) {
        logger.info(
          `Updating user ${existingUser.id}: token expired=${needsTokenUpdate}, profile changed=${needsProfileUpdate}`
        );

        const updateData: any = {
          updated_at: new Date().toISOString(),
        };

        // 토큰 업데이트가 필요한 경우
        if (needsTokenUpdate) {
          updateData.access_token = tokenData.access_token;
          updateData.token_expires_at = tokenExpiresAt.toISOString();
        }

        // 프로필 업데이트가 필요한 경우
        if (needsProfileUpdate) {
          updateData.username = githubUser.login;
          updateData.avatar_url = githubUser.avatar_url;
        }

        const { error } = await supabaseClient
          .from("users")
          .update(updateData)
          .eq("id", existingUser.id);

        if (error) {
          logger.error({ error }, "Error updating user");
          throw new Error("Failed to update user");
        }
      } else {
        logger.info(`User ${existingUser.id} is up to date, no update needed`);
      }

      return existingUser.id;
    }

    // 다른 에러가 발생한 경우
    throw new Error("Unexpected error when checking existing user");
  } catch (error) {
    logger.error({ error }, "Exception when saving/updating user");
    throw new Error("Failed to save or update user");
  }
};

/**
 * 사용자 ID로 사용자 정보 가져오기
 */
export const getUserById = async (userId: string) => {
  try {
    const { data, error } = await supabaseClient
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (error) {
      logger.error({ error, userId }, "Error fetching user");
      return null;
    }

    return data;
  } catch (error) {
    logger.error({ error, userId }, "Exception when fetching user");
    return null;
  }
};

export default {
  getGitHubAuthUrl,
  handleGitHubCallback,
  getGitHubUser,
  saveOrUpdateUser,
  getUserById,
};
