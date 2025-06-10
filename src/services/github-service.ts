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
    const tokenExpiresAt = new Date();
    tokenExpiresAt.setSeconds(
      tokenExpiresAt.getSeconds() + tokenData.expires_in
    );

    const { data, error } = await supabaseClient
      .from("users")
      .upsert(
        {
          github_id: githubUser.id.toString(),
          username: githubUser.login,
          avatar_url: githubUser.avatar_url,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          token_expires_at: tokenExpiresAt.toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "github_id" }
      )
      .select("id")
      .single();

    if (error) {
      logger.error({ error }, "Error saving user");
      throw new Error("Failed to save user");
    }

    return data.id;
  } catch (error) {
    logger.error({ error }, "Exception when saving user");
    throw new Error("Failed to save user");
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
