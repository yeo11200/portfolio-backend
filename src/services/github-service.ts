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
  const scope = "read:user repo read:org";
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
 * Refresh Token을 사용하여 새로운 Access Token 획득
 */
export const refreshGitHubToken = async (
  refreshToken: string
): Promise<GitHubToken> => {
  try {
    const response = await axios.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      },
      {
        headers: {
          Accept: "application/json",
        },
      }
    );

    return response.data;
  } catch (error) {
    logger.error({ error }, "Error refreshing GitHub access token");
    throw new Error("Failed to refresh GitHub access token");
  }
};

/**
 * GitHub 토큰 유효성 검증
 */
export const validateGitHubToken = async (
  accessToken: string
): Promise<boolean> => {
  try {
    const response = await axios.get("https://api.github.com/user", {
      headers: {
        Authorization: `token ${accessToken}`,
      },
    });

    return response.status === 200;
  } catch (error) {
    logger.warn({ error }, "GitHub token validation failed");
    return false;
  }
};

/**
 * 사용자의 토큰이 만료되었는지 확인하고 필요시 갱신
 */
export const ensureValidToken = async (userId: string): Promise<string> => {
  try {
    const user = await getUserById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const currentTime = new Date();
    const tokenExpiry = new Date(user.token_expires_at);

    // 토큰이 아직 유효한 경우
    if (currentTime < tokenExpiry) {
      // 추가로 GitHub API로 토큰 유효성 검증
      const isValid = await validateGitHubToken(user.access_token);
      if (isValid) {
        return user.access_token;
      }
    }

    // 토큰이 만료되었거나 유효하지 않은 경우 refresh token으로 갱신
    if (user.refresh_token) {
      logger.info(`Refreshing token for user ${userId}`);

      const newTokenData = await refreshGitHubToken(user.refresh_token);

      // 새로운 토큰으로 DB 업데이트
      const newTokenExpiresAt = new Date();
      newTokenExpiresAt.setSeconds(
        newTokenExpiresAt.getSeconds() + newTokenData.expires_in
      );

      const { error } = await supabaseClient
        .from("users")
        .update({
          access_token: newTokenData.access_token,
          refresh_token: newTokenData.refresh_token || user.refresh_token,
          token_expires_at: newTokenExpiresAt.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      if (error) {
        logger.error({ error }, "Error updating refreshed token");
        throw new Error("Failed to update refreshed token");
      }

      return newTokenData.access_token;
    }

    // refresh token이 없는 경우 재인증 필요
    throw new Error(
      "Token expired and no refresh token available. Re-authentication required."
    );
  } catch (error) {
    logger.error({ error, userId }, "Error ensuring valid token");
    throw new Error("Failed to ensure valid token");
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
    const { data: existingUsers, error: fetchError } = await supabaseClient
      .from("users")
      .select("*")
      .eq("github_id", githubUser.id.toString());

    if (fetchError) {
      logger.error({ fetchError }, "Error fetching existing user");
      throw new Error("Failed to check existing user");
    }

    const tokenExpiresAt = new Date();
    tokenExpiresAt.setSeconds(
      tokenExpiresAt.getSeconds() + (tokenData.expires_in || 28800) // 기본 8시간
    );

    // 기존 사용자가 없으면 새로 생성
    if (!existingUsers || existingUsers.length === 0) {
      logger.info(
        `Creating new user for GitHub ID: ${githubUser.id} (${githubUser.login})`
      );

      const { data, error } = await supabaseClient
        .from("users")
        .insert({
          github_id: githubUser.id.toString(),
          username: githubUser.login,
          avatar_url: githubUser.avatar_url,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
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

    // 기존 사용자가 있으면 토큰 정보 업데이트
    const existingUser = existingUsers[0];
    logger.info(`Updating tokens for existing user ${existingUser.id}`);

    const { error: updateError } = await supabaseClient
      .from("users")
      .update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || existingUser.refresh_token,
        token_expires_at: tokenExpiresAt.toISOString(),
        username: githubUser.login, // 사용자명이 변경될 수 있음
        avatar_url: githubUser.avatar_url, // 아바타가 변경될 수 있음
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingUser.id);

    if (updateError) {
      logger.error({ updateError }, "Error updating user");
      throw new Error("Failed to update user");
    }

    return existingUser.id;
  } catch (error) {
    logger.error(
      { error, githubId: githubUser.id },
      "Error saving or updating user"
    );
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

/**
 * 레포지토리의 파일 트리 구조 가져오기
 */
export const getRepositoryTree = async (
  accessToken: string,
  owner: string,
  repo: string,
  branch: string = "main"
): Promise<any[]> => {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    if (!response.ok) {
      // 지정된 브랜치가 없으면 master 브랜치 시도 (main이 기본값인 경우만)
      if (branch === "main") {
        const masterResponse = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/git/trees/master?recursive=1`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/vnd.github.v3+json",
            },
          }
        );

        if (!masterResponse.ok) {
          throw new Error(
            `Failed to fetch repository tree: ${response.status}`
          );
        }

        const masterData = await masterResponse.json();
        return masterData.tree || [];
      } else {
        throw new Error(
          `Failed to fetch repository tree from branch ${branch}: ${response.status}`
        );
      }
    }

    const data = await response.json();
    return data.tree || [];
  } catch (error) {
    logger.error(
      { error, owner, repo, branch },
      "Error fetching repository tree"
    );
    throw new Error("Failed to fetch repository tree");
  }
};

/**
 * 특정 파일의 내용 가져오기
 */
export const getFileContent = async (
  accessToken: string,
  owner: string,
  repo: string,
  path: string,
  ref: string = "main"
): Promise<string> => {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${ref}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch file content: ${response.status}`);
    }

    const data = await response.json();

    // Base64로 인코딩된 내용을 디코딩
    if (data.content && data.encoding === "base64") {
      return Buffer.from(data.content, "base64").toString("utf-8");
    }

    return data.content || "";
  } catch (error) {
    logger.error(
      { error, owner, repo, path, ref },
      "Error fetching file content"
    );
    return "";
  }
};

/**
 * 주요 설정 파일들의 내용 가져오기
 */
export const getImportantFiles = async (
  accessToken: string,
  owner: string,
  repo: string,
  tree: any[],
  branch: string = "main"
): Promise<{ [key: string]: string }> => {
  const importantFiles = [
    "package.json",
    "package-lock.json",
    "yarn.lock",
    "requirements.txt",
    "Pipfile",
    "Gemfile",
    "pom.xml",
    "build.gradle",
    "Cargo.toml",
    "go.mod",
    "composer.json",
    "Dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    ".env.example",
    "tsconfig.json",
    "webpack.config.js",
    "vite.config.js",
    "next.config.js",
    "tailwind.config.js",
    ".eslintrc.js",
    ".eslintrc.json",
    "jest.config.js",
    "cypress.config.js",
  ];

  const files: { [key: string]: string } = {};

  // 트리에서 중요한 파일들 찾기
  const foundFiles = tree.filter(
    (item) =>
      item.type === "blob" &&
      importantFiles.some((important) =>
        item.path.toLowerCase().includes(important.toLowerCase())
      )
  );

  // 각 파일의 내용 가져오기 (최대 10개까지)
  const filesToFetch = foundFiles.slice(0, 10);

  for (const file of filesToFetch) {
    try {
      const content = await getFileContent(
        accessToken,
        owner,
        repo,
        file.path,
        branch
      );
      if (content) {
        files[file.path] = content;
      }
    } catch (error) {
      logger.warn({ error, path: file.path }, "Failed to fetch file content");
    }
  }

  return files;
};

/**
 * 레포지토리의 언어 통계 가져오기 (전체 레포지토리)
 */
export const getRepositoryLanguages = async (
  accessToken: string,
  owner: string,
  repo: string
): Promise<Record<string, number>> => {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/languages`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    logger.error(
      { error, owner, repo },
      "Failed to fetch repository languages"
    );
    return {};
  }
};

// 브랜치별 언어 분석 (파일 확장자 기반)
export const analyzeBranchLanguages = async (
  accessToken: string,
  owner: string,
  repo: string,
  branch: string = "main"
): Promise<{
  languages: Record<string, { count: number; percentage: number }>;
  totalFiles: number;
  filesByExtension: Record<string, string[]>;
}> => {
  try {
    // 브랜치의 파일 트리 가져오기
    const tree = await getRepositoryTree(accessToken, owner, repo, branch);

    if (!Array.isArray(tree)) {
      return {
        languages: {},
        totalFiles: 0,
        filesByExtension: {},
      };
    }

    // 파일 확장자별 분류
    const filesByExtension: Record<string, string[]> = {};
    const languageMapping: Record<string, string> = {
      // JavaScript/TypeScript
      js: "JavaScript",
      jsx: "JavaScript",
      ts: "TypeScript",
      tsx: "TypeScript",
      mjs: "JavaScript",
      cjs: "JavaScript",

      // Python
      py: "Python",
      pyw: "Python",
      pyi: "Python",

      // Java
      java: "Java",
      class: "Java",
      jar: "Java",

      // C/C++
      c: "C",
      cpp: "C++",
      cxx: "C++",
      cc: "C++",
      h: "C",
      hpp: "C++",
      hxx: "C++",

      // C#
      cs: "C#",

      // Go
      go: "Go",

      // Rust
      rs: "Rust",

      // PHP
      php: "PHP",
      phtml: "PHP",

      // Ruby
      rb: "Ruby",
      rbw: "Ruby",

      // Swift
      swift: "Swift",

      // Kotlin
      kt: "Kotlin",
      kts: "Kotlin",

      // Dart
      dart: "Dart",

      // Web
      html: "HTML",
      htm: "HTML",
      css: "CSS",
      scss: "SCSS",
      sass: "Sass",
      less: "Less",
      vue: "Vue",
      svelte: "Svelte",

      // Shell
      sh: "Shell",
      bash: "Shell",
      zsh: "Shell",
      fish: "Shell",

      // Config/Data
      json: "JSON",
      xml: "XML",
      yaml: "YAML",
      yml: "YAML",
      toml: "TOML",
      ini: "INI",
      env: "Environment",

      // Documentation
      md: "Markdown",
      mdx: "MDX",
      rst: "reStructuredText",
      txt: "Text",

      // Database
      sql: "SQL",

      // Docker
      dockerfile: "Dockerfile",

      // Other
      r: "R",
      scala: "Scala",
      clj: "Clojure",
      ex: "Elixir",
      exs: "Elixir",
      erl: "Erlang",
      hrl: "Erlang",
      lua: "Lua",
      pl: "Perl",
      pm: "Perl",
      vim: "Vim Script",
      asm: "Assembly",
      s: "Assembly",
    };

    // 파일들을 확장자별로 분류
    const blobFiles = tree.filter((item) => item.type === "blob");

    blobFiles.forEach((file) => {
      const fileName = file.path.toLowerCase();
      let extension = "";

      // 특수 파일명 처리
      if (fileName === "dockerfile" || fileName.startsWith("dockerfile.")) {
        extension = "dockerfile";
      } else if (fileName.includes(".")) {
        extension = fileName.split(".").pop() || "";
      }

      if (extension && languageMapping[extension]) {
        const language = languageMapping[extension];
        if (!filesByExtension[language]) {
          filesByExtension[language] = [];
        }
        filesByExtension[language].push(file.path);
      }
    });

    // 언어별 통계 계산
    const totalFiles = blobFiles.length;
    const languages: Record<string, { count: number; percentage: number }> = {};

    Object.entries(filesByExtension).forEach(([language, files]) => {
      const count = files.length;
      const percentage =
        totalFiles > 0 ? Math.round((count / totalFiles) * 100) : 0;

      languages[language] = {
        count,
        percentage,
      };
    });

    logger.info(
      {
        owner,
        repo,
        branch,
        totalFiles,
        languageCount: Object.keys(languages).length,
      },
      "Branch language analysis completed"
    );

    return {
      languages,
      totalFiles,
      filesByExtension,
    };
  } catch (error) {
    logger.error(
      { error, owner, repo, branch },
      "Failed to analyze branch languages"
    );
    return {
      languages: {},
      totalFiles: 0,
      filesByExtension: {},
    };
  }
};

// 브랜치별 상세 파일 분석
export const getBranchFileAnalysis = async (
  accessToken: string,
  owner: string,
  repo: string,
  branch: string = "main"
): Promise<{
  summary: {
    totalFiles: number;
    totalFolders: number;
    maxDepth: number;
  };
  languages: Record<string, { count: number; percentage: number }>;
  structure: {
    topLevelFolders: string[];
    configFiles: string[];
    documentationFiles: string[];
    testFiles: string[];
  };
  fileTypes: {
    source: number;
    config: number;
    documentation: number;
    test: number;
    other: number;
  };
}> => {
  try {
    const tree = await getRepositoryTree(accessToken, owner, repo, branch);

    if (!Array.isArray(tree)) {
      return {
        summary: { totalFiles: 0, totalFolders: 0, maxDepth: 0 },
        languages: {},
        structure: {
          topLevelFolders: [],
          configFiles: [],
          documentationFiles: [],
          testFiles: [],
        },
        fileTypes: {
          source: 0,
          config: 0,
          documentation: 0,
          test: 0,
          other: 0,
        },
      };
    }

    // 언어 분석
    const languageAnalysis = await analyzeBranchLanguages(
      accessToken,
      owner,
      repo,
      branch
    );

    // 파일 및 폴더 분석
    const files = tree.filter((item) => item.type === "blob");
    const folders = tree.filter((item) => item.type === "tree");

    // 최대 깊이 계산
    const maxDepth = Math.max(
      ...tree.map((item) => item.path.split("/").length),
      0
    );

    // 최상위 폴더 추출
    const topLevelFolders = Array.from(
      new Set(
        folders
          .map((folder) => folder.path.split("/")[0])
          .filter((folder) => folder)
      )
    ).slice(0, 10);

    // 파일 분류
    const configFiles: string[] = [];
    const documentationFiles: string[] = [];
    const testFiles: string[] = [];

    let sourceFiles = 0;
    let configFileCount = 0;
    let documentationFileCount = 0;
    let testFileCount = 0;
    let otherFiles = 0;

    files.forEach((file) => {
      const fileName = file.path.toLowerCase();
      const path = file.path;

      // 설정 파일
      if (
        fileName.includes("config") ||
        fileName.includes("package.json") ||
        fileName.includes("tsconfig") ||
        fileName.includes("webpack") ||
        fileName.includes("vite.config") ||
        fileName.includes("next.config") ||
        fileName.includes("tailwind.config") ||
        fileName.includes("eslint") ||
        fileName.includes("prettier") ||
        fileName.includes("babel") ||
        fileName.includes("dockerfile") ||
        fileName.includes("docker-compose") ||
        fileName.includes("requirements.txt") ||
        fileName.includes("cargo.toml") ||
        fileName.includes("go.mod") ||
        fileName.includes("pom.xml") ||
        fileName.includes("build.gradle") ||
        fileName.endsWith(".env") ||
        fileName.endsWith(".ini") ||
        fileName.endsWith(".toml") ||
        fileName.endsWith(".yaml") ||
        fileName.endsWith(".yml")
      ) {
        configFiles.push(path);
        configFileCount++;
      }
      // 문서 파일
      else if (
        fileName.includes("readme") ||
        fileName.includes("changelog") ||
        fileName.includes("license") ||
        fileName.includes("contributing") ||
        fileName.includes("docs/") ||
        fileName.endsWith(".md") ||
        fileName.endsWith(".rst") ||
        fileName.endsWith(".txt")
      ) {
        documentationFiles.push(path);
        documentationFileCount++;
      }
      // 테스트 파일
      else if (
        fileName.includes("test") ||
        fileName.includes("spec") ||
        fileName.includes("__tests__") ||
        fileName.includes(".test.") ||
        fileName.includes(".spec.") ||
        path.includes("/test/") ||
        path.includes("/tests/") ||
        path.includes("/__tests__/")
      ) {
        testFiles.push(path);
        testFileCount++;
      }
      // 소스 파일
      else if (
        fileName.endsWith(".js") ||
        fileName.endsWith(".jsx") ||
        fileName.endsWith(".ts") ||
        fileName.endsWith(".tsx") ||
        fileName.endsWith(".py") ||
        fileName.endsWith(".java") ||
        fileName.endsWith(".c") ||
        fileName.endsWith(".cpp") ||
        fileName.endsWith(".cs") ||
        fileName.endsWith(".go") ||
        fileName.endsWith(".rs") ||
        fileName.endsWith(".php") ||
        fileName.endsWith(".rb") ||
        fileName.endsWith(".swift") ||
        fileName.endsWith(".kt") ||
        fileName.endsWith(".dart") ||
        fileName.endsWith(".vue") ||
        fileName.endsWith(".svelte")
      ) {
        sourceFiles++;
      }
      // 기타
      else {
        otherFiles++;
      }
    });

    return {
      summary: {
        totalFiles: files.length,
        totalFolders: folders.length,
        maxDepth,
      },
      languages: languageAnalysis.languages,
      structure: {
        topLevelFolders,
        configFiles: configFiles.slice(0, 20),
        documentationFiles: documentationFiles.slice(0, 10),
        testFiles: testFiles.slice(0, 15),
      },
      fileTypes: {
        source: sourceFiles,
        config: configFileCount,
        documentation: documentationFileCount,
        test: testFileCount,
        other: otherFiles,
      },
    };
  } catch (error) {
    logger.error(
      { error, owner, repo, branch },
      "Failed to analyze branch file structure"
    );
    return {
      summary: { totalFiles: 0, totalFolders: 0, maxDepth: 0 },
      languages: {},
      structure: {
        topLevelFolders: [],
        configFiles: [],
        documentationFiles: [],
        testFiles: [],
      },
      fileTypes: { source: 0, config: 0, documentation: 0, test: 0, other: 0 },
    };
  }
};

/**
 * 사용자별 생성일 조회
 */
export const getUserCreatedAt = async (
  user_id: string
): Promise<{ user_id: string; data: { created_at: string } }> => {
  try {
    const { data, error } = await supabaseClient
      .from("users")
      .select("created_at")
      .eq("id", user_id)
      .single();

    console.log(data, error);
    if (error) {
      logger.error(
        { error },
        "Error fetching monthly repository summary counts"
      );
      throw error;
    }

    return { user_id, data };
  } catch (error) {
    logger.error(
      { error },
      "Exception when fetching monthly repository summary counts"
    );
    return { user_id, data: { created_at: "" } };
  }
};

/**
 * 사용자의 모든 repository 목록 가져오기 (public + private)
 */
export const getUserRepositories = async (
  accessToken: string,
  page: number = 1,
  perPage: number = 30
): Promise<any[]> => {
  try {
    const response = await axios.get("https://api.github.com/user/repos", {
      headers: {
        Authorization: `token ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
      },
      params: {
        visibility: "all", // public, private, all
        affiliation: "owner,collaborator,organization_member",
        sort: "updated",
        direction: "desc",
        page,
        per_page: perPage,
      },
    });

    return response.data;
  } catch (error) {
    logger.error({ error }, "Error getting user repositories");
    throw new Error("Failed to get user repositories");
  }
};

/**
 * 특정 private repository 정보 가져오기 (테스트용)
 */
export const getPrivateRepository = async (
  accessToken: string,
  owner: string,
  repo: string
): Promise<any> => {
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}`,
      {
        headers: {
          Authorization: `token ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    return response.data;
  } catch (error) {
    logger.error({ error, owner, repo }, "Error getting private repository");
    throw new Error("Failed to get private repository");
  }
};

/**
 * 사용자의 모든 커밋 가져오기 (GitHub Search API 사용)
 * 가장 효율적인 방법 - 모든 레포지토리의 커밋을 한 번에 검색
 */
export const getAllUserCommits = async (
  accessToken: string,
  username: string,
  options: {
    since?: string; // ISO 8601 format (예: '2023-01-01T00:00:00Z')
    until?: string; // ISO 8601 format
    perPage?: number;
    page?: number;
  } = {}
): Promise<{
  commits: any[];
  totalCount: number;
  hasMore: boolean;
}> => {
  try {
    const { since, until, perPage = 100, page = 1 } = options;

    // GitHub Search API를 사용하여 사용자의 모든 커밋 검색
    let query = `author:${username}`;

    // 날짜 범위 필터 추가
    if (since || until) {
      if (since && until) {
        query += ` author-date:${since}..${until}`;
      } else if (since) {
        query += ` author-date:>=${since}`;
      } else if (until) {
        query += ` author-date:<=${until}`;
      }
    }

    const response = await axios.get("https://api.github.com/search/commits", {
      headers: {
        Authorization: `token ${accessToken}`,
        Accept: "application/vnd.github.cloak-preview+json", // Search commits API preview
      },
      params: {
        q: query,
        sort: "author-date",
        order: "desc",
        per_page: perPage,
        page,
      },
    });

    return {
      commits: response.data.items || [],
      totalCount: response.data.total_count || 0,
      hasMore: response.data.items?.length === perPage,
    };
  } catch (error) {
    logger.error({ error, username }, "Error fetching all user commits");
    throw new Error("Failed to fetch all user commits");
  }
};

/**
 * 사용자의 모든 커밋 가져오기 (레포지토리별 순회 방법)
 * 더 상세한 정보가 필요할 때 사용
 */
export const getAllUserCommitsByRepositories = async (
  accessToken: string,
  options: {
    since?: string;
    until?: string;
    maxRepos?: number;
    commitsPerRepo?: number;
  } = {}
): Promise<{
  commits: any[];
  repositoriesProcessed: number;
  totalCommits: number;
}> => {
  try {
    const { since, until, maxRepos = 50, commitsPerRepo = 100 } = options;

    // 1. 사용자의 모든 레포지토리 가져오기
    const repositories = await getUserRepositories(accessToken, 1, maxRepos);

    const allCommits: any[] = [];
    let repositoriesProcessed = 0;

    // 2. 각 레포지토리의 커밋들을 병렬로 가져오기
    const commitPromises = repositories.map(async (repo: any) => {
      try {
        const params: any = {
          author: repo.owner.login, // 해당 사용자가 작성한 커밋만
          per_page: commitsPerRepo,
        };

        if (since) params.since = since;
        if (until) params.until = until;

        const response = await axios.get(
          `https://api.github.com/repos/${repo.full_name}/commits`,
          {
            headers: {
              Authorization: `token ${accessToken}`,
              Accept: "application/vnd.github.v3+json",
            },
            params,
          }
        );

        const commits = response.data || [];

        // 각 커밋에 레포지토리 정보 추가
        const commitsWithRepo = commits.map((commit: any) => ({
          ...commit,
          repository: {
            name: repo.name,
            full_name: repo.full_name,
            owner: repo.owner.login,
            private: repo.private,
            language: repo.language,
            html_url: repo.html_url,
          },
        }));

        repositoriesProcessed++;
        return commitsWithRepo;
      } catch (error) {
        logger.warn(
          { error, repo: repo.full_name },
          "Failed to fetch commits for repository"
        );
        return [];
      }
    });

    // 모든 커밋 데이터 수집
    const commitsArrays = await Promise.all(commitPromises);
    commitsArrays.forEach((commits) => allCommits.push(...commits));

    // 날짜순으로 정렬
    allCommits.sort(
      (a, b) =>
        new Date(b.commit.author.date).getTime() -
        new Date(a.commit.author.date).getTime()
    );

    return {
      commits: allCommits,
      repositoriesProcessed,
      totalCommits: allCommits.length,
    };
  } catch (error) {
    logger.error({ error }, "Error fetching all user commits by repositories");
    throw new Error("Failed to fetch all user commits by repositories");
  }
};

/**
 * 사용자의 커밋 통계 가져오기
 */
export const getUserCommitStats = async (
  accessToken: string,
  username: string,
  options: {
    since?: string;
    until?: string;
  } = {}
): Promise<{
  totalCommits: number;
  repositoriesWithCommits: number;
  languageStats: Record<string, number>;
  dailyStats: Record<string, number>;
  monthlyStats: Record<string, number>;
}> => {
  try {
    const { since, until } = options;

    // Search API로 총 커밋 수 확인
    const searchResult = await getAllUserCommits(accessToken, username, {
      since,
      until,
      perPage: 1,
    });

    // 상세 정보를 위해 레포지토리별 커밋 가져오기 (샘플링)
    const detailedResult = await getAllUserCommitsByRepositories(accessToken, {
      since,
      until,
      maxRepos: 30, // 성능을 위해 최대 30개 레포지토리만 분석
      commitsPerRepo: 50,
    });

    // 언어별 통계
    const languageStats: Record<string, number> = {};
    const dailyStats: Record<string, number> = {};
    const monthlyStats: Record<string, number> = {};

    detailedResult.commits.forEach((commit) => {
      const language = commit.repository?.language || "Unknown";
      languageStats[language] = (languageStats[language] || 0) + 1;

      const date = new Date(commit.commit.author.date);
      const dayKey = date.toISOString().split("T")[0]; // YYYY-MM-DD
      const monthKey = `${date.getFullYear()}-${String(
        date.getMonth() + 1
      ).padStart(2, "0")}`; // YYYY-MM

      dailyStats[dayKey] = (dailyStats[dayKey] || 0) + 1;
      monthlyStats[monthKey] = (monthlyStats[monthKey] || 0) + 1;
    });

    return {
      totalCommits: searchResult.totalCount,
      repositoriesWithCommits: detailedResult.repositoriesProcessed,
      languageStats,
      dailyStats,
      monthlyStats,
    };
  } catch (error) {
    logger.error({ error, username }, "Error fetching user commit stats");
    throw new Error("Failed to fetch user commit stats");
  }
};

export default {
  getGitHubAuthUrl,
  handleGitHubCallback,
  refreshGitHubToken,
  validateGitHubToken,
  ensureValidToken,
  getGitHubUser,
  saveOrUpdateUser,
  getUserById,
  getRepositoryTree,
  getFileContent,
  getImportantFiles,
  getRepositoryLanguages,
  analyzeBranchLanguages,
  getBranchFileAnalysis,
  getUserCreatedAt,
  getUserRepositories,
  getPrivateRepository,
  getAllUserCommits,
  getAllUserCommitsByRepositories,
  getUserCommitStats,
};
