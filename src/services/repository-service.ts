import axios from "axios";
import supabaseClient from "../config/supabase-client";
import logger from "../utils/logger";

export interface Repository {
  id: number;
  name: string;
  full_name: string;
  owner: {
    login: string;
  };
  description: string;
  html_url: string;
  language: string;
  stargazers_count: number;
  forks_count: number;
  branch_name?: string;
}

export interface RepositoryContent {
  name: string;
  path: string;
  type: string;
  content?: string;
  sha: string;
}

export interface Commit {
  sha: string;
  commit: {
    author: {
      name: string;
      email: string;
      date: string;
    };
    message: string;
  };
}

export interface PullRequest {
  number: number;
  title: string;
  body: string;
  state: string;
  created_at: string;
  merged_at: string | null;
}

/**
 * 사용자의 GitHub 레포지토리 목록 가져오기 (참여한 모든 레포지토리 포함)
 */
export const getUserRepositories = async (
  accessToken: string,
  sort: string = "updated",
  direction: string = "desc",
  search: string = ""
): Promise<Repository[]> => {
  try {
    const params: Record<string, string> = {
      sort,
      direction,
      per_page: "100",
      // 소유한 레포지토리 + 협업하는 레포지토리 + 조직 레포지토리 모두 포함
      affiliation: "owner,collaborator,organization_member",
    };

    // 검색어가 있으면 GitHub Search API 사용
    let url = "https://api.github.com/user/repos";
    if (search) {
      url = "https://api.github.com/search/repositories";
      params.q = `${search} user:@me`;
      delete params.affiliation; // Search API에서는 affiliation 파라미터 사용 불가
    }

    const response = await axios.get(url, {
      params,
      headers: {
        Authorization: `token ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    // Search API 사용시 response.data.items, 일반 API 사용시 response.data
    const repositories = search ? response.data.items : response.data;

    return repositories;
  } catch (error) {
    logger.error({ error, search }, "Error fetching user repositories");
    throw new Error("Failed to fetch user repositories");
  }
};

/**
 * 레포지토리의 기본 브랜치 감지
 */
export const getDefaultBranch = async (
  accessToken: string,
  owner: string,
  repo: string
): Promise<string> => {
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}`,
      {
        headers: {
          Authorization: `token ${accessToken}`,
        },
      }
    );

    return response.data.default_branch || "main";
  } catch (error) {
    logger.error(
      { error, owner, repo },
      "Error fetching default branch, using 'main'"
    );
    return "main";
  }
};

/**
 * 특정 레포지토리 정보 가져오기
 */
export const getRepository = async (
  accessToken: string,
  owner: string,
  repo: string
): Promise<Repository> => {
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}`,
      {
        headers: {
          Authorization: `token ${accessToken}`,
        },
      }
    );

    return response.data;
  } catch (error) {
    logger.error({ error, owner, repo }, "Error fetching repository");
    throw new Error("Failed to fetch repository");
  }
};

/**
 * 레포지토리 README 가져오기
 */
export const getRepositoryReadme = async (
  accessToken: string,
  owner: string,
  repo: string,
  ref: string = "main"
): Promise<string> => {
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/readme`,
      {
        params: { ref },
        headers: {
          Authorization: `token ${accessToken}`,
          Accept: "application/vnd.github+json",
        },
      }
    );

    if (response.data.content && response.data.encoding === "base64") {
      // Base64 디코딩하여 실제 텍스트 내용 반환
      return Buffer.from(response.data.content, "base64").toString("utf-8");
    }

    // encoding이 base64가 아닌 경우 (드물지만)
    return response.data.content || "";
  } catch (error) {
    // main 브랜치에서 실패하면 master 브랜치로 재시도
    if (ref === "main") {
      logger.warn(
        { owner, repo },
        "README not found in main branch, trying master branch"
      );
      try {
        return await getRepositoryReadme(accessToken, owner, repo, "master");
      } catch (masterError) {
        logger.error(
          { error: masterError, owner, repo },
          "Error fetching repository README from master branch"
        );
        return "";
      }
    }

    logger.error(
      { error, owner, repo, ref },
      "Error fetching repository README"
    );
    return "";
  }
};

/**
 * 레포지토리 브랜치 목록 가져오기
 */
export const getRepositoryBranches = async (
  accessToken: string,
  owner: string,
  repo: string
): Promise<string[]> => {
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/branches`,
      {
        headers: {
          Authorization: `token ${accessToken}`,
        },
      }
    );

    return response.data.map((branch: any) => branch.name);
  } catch (error) {
    logger.error({ error, owner, repo }, "Error fetching repository branches");
    throw new Error("Failed to fetch repository branches");
  }
};

/**
 * 레포지토리 디렉토리 내용 가져오기
 */
export const getRepositoryContents = async (
  accessToken: string,
  owner: string,
  repo: string,
  path: string = "",
  ref: string = "main"
): Promise<RepositoryContent[]> => {
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
      {
        params: { ref },
        headers: {
          Authorization: `token ${accessToken}`,
        },
      }
    );

    return response.data;
  } catch (error) {
    // main 브랜치에서 실패하면 master 브랜치로 재시도
    if (ref === "main") {
      logger.warn(
        { owner, repo, path },
        "Contents not found in main branch, trying master branch"
      );
      try {
        return await getRepositoryContents(
          accessToken,
          owner,
          repo,
          path,
          "master"
        );
      } catch (masterError) {
        logger.error(
          { error: masterError, owner, repo, path },
          "Error fetching repository contents from master branch"
        );
        throw new Error("Failed to fetch repository contents");
      }
    }

    logger.error(
      { error, owner, repo, path, ref },
      "Error fetching repository contents"
    );
    throw new Error("Failed to fetch repository contents");
  }
};

/**
 * 레포지토리 커밋 목록 가져오기
 */
export const getRepositoryCommits = async (
  accessToken: string,
  owner: string,
  repo: string,
  branch: string = "main",
  perPage: number = 100
): Promise<Commit[]> => {
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/commits`,
      {
        params: {
          sha: branch,
          per_page: perPage,
        },
        headers: {
          Authorization: `token ${accessToken}`,
        },
      }
    );

    return response.data;
  } catch (error) {
    // main 브랜치에서 실패하면 master 브랜치로 재시도
    if (branch === "main") {
      logger.warn(
        { owner, repo },
        "Commits not found in main branch, trying master branch"
      );
      try {
        return await getRepositoryCommits(
          accessToken,
          owner,
          repo,
          "master",
          perPage
        );
      } catch (masterError) {
        logger.error(
          { error: masterError, owner, repo },
          "Error fetching repository commits from master branch"
        );
        throw new Error("Failed to fetch repository commits");
      }
    }

    logger.error(
      { error, owner, repo, branch },
      "Error fetching repository commits"
    );
    throw new Error("Failed to fetch repository commits");
  }
};

/**
 * 레포지토리 PR 목록 가져오기
 */
export const getRepositoryPullRequests = async (
  accessToken: string,
  owner: string,
  repo: string,
  state: string = "all",
  perPage: number = 100
): Promise<PullRequest[]> => {
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/pulls`,
      {
        params: {
          state,
          per_page: perPage,
        },
        headers: {
          Authorization: `token ${accessToken}`,
        },
      }
    );

    return response.data;
  } catch (error) {
    logger.error(
      { error, owner, repo },
      "Error fetching repository pull requests"
    );
    throw new Error("Failed to fetch repository pull requests");
  }
};

/**
 * 레포지토리 정보 저장
 */
export const saveRepository = async (
  userId: string,
  repo: Repository
): Promise<string> => {
  try {
    const { data, error } = await supabaseClient
      .from("repositories")
      .upsert(
        {
          user_id: userId,
          github_repo_id: repo.id.toString(),
          owner: repo.owner.login,
          name: repo.name,
          description: repo.description,
          html_url: repo.html_url,
          language: repo.language,
          stars_count: repo.stargazers_count,
          forks_count: repo.forks_count,
          branch_name: repo.branch_name,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,github_repo_id,branch_name" }
      )
      .select("id")
      .single();

    if (error) {
      logger.error({ error, userId, repo }, "Error saving repository");
      throw new Error("Failed to save repository");
    }

    return data.id;
  } catch (error) {
    logger.error({ error, userId, repo }, "Exception when saving repository");
    throw new Error("Failed to save repository");
  }
};

/**
 * 사용자의 저장된 레포지토리 목록 가져오기
 */
export const getSavedRepositories = async (
  userId: string,
  sort: string = "updated_at",
  direction: string = "desc",
  search: string = "",
  branchName?: string
): Promise<any[]> => {
  try {
    let query = supabaseClient
      .from("repositories")
      .select("*")
      .eq("user_id", userId)
      .eq("branch_name", branchName)
      .order(sort, { ascending: direction === "asc" });

    if (search) {
      query = query.ilike("name", `%${search}%`);
    }

    const { data, error } = await query;

    if (error) {
      logger.error({ error, userId }, "Error fetching saved repositories");
      throw new Error("Failed to fetch saved repositories");
    }

    return data;
  } catch (error) {
    logger.error(
      { error, userId },
      "Exception when fetching saved repositories"
    );
    throw new Error("Failed to fetch saved repositories");
  }
};

/**
 * 레포지토리 커밋 히스토리 저장
 */
export const saveCommitHistory = async (
  repositoryId: string,
  commits: Commit[]
): Promise<void> => {
  try {
    const commitRecords = commits.map((commit) => ({
      repository_id: repositoryId,
      commit_sha: commit.sha,
      author_name: commit.commit.author.name,
      author_email: commit.commit.author.email,
      commit_date: commit.commit.author.date,
      commit_message: commit.commit.message,
    }));

    const { error } = await supabaseClient
      .from("commit_history")
      .upsert(commitRecords, { onConflict: "repository_id,commit_sha" });

    if (error) {
      logger.error({ error, repositoryId }, "Error saving commit history");
      throw new Error("Failed to save commit history");
    }
  } catch (error) {
    logger.error(
      { error, repositoryId },
      "Exception when saving commit history"
    );
    throw new Error("Failed to save commit history");
  }
};

/**
 * 레포지토리 PR 히스토리 저장
 */
export const savePullRequests = async (
  repositoryId: string,
  pullRequests: PullRequest[]
): Promise<void> => {
  try {
    const prRecords = pullRequests.map((pr) => ({
      repository_id: repositoryId,
      pr_number: pr.number,
      title: pr.title,
      body: pr.body,
      state: pr.state,
      created_at: pr.created_at,
      merged_at: pr.merged_at,
    }));

    const { error } = await supabaseClient
      .from("pull_requests")
      .upsert(prRecords, { onConflict: "repository_id,pr_number" });

    if (error) {
      logger.error({ error, repositoryId }, "Error saving pull requests");
      throw new Error("Failed to save pull requests");
    }
  } catch (error) {
    logger.error(
      { error, repositoryId },
      "Exception when saving pull requests"
    );
    throw new Error("Failed to save pull requests");
  }
};

/**
 * 개별 파일의 실제 내용 가져오기 (코드 분석용)
 */
export const getFileContent = async (
  accessToken: string,
  owner: string,
  repo: string,
  path: string,
  ref: string = "main"
): Promise<{ content: string; encoding: string; size: number } | null> => {
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
      {
        params: { ref },
        headers: {
          Authorization: `token ${accessToken}`,
          Accept: "application/vnd.github+json",
        },
      }
    );

    const fileData = response.data;

    // 파일이 너무 크면 스킵 (1MB 이상)
    if (fileData.size > 1024 * 1024) {
      logger.warn(
        { owner, repo, path, size: fileData.size },
        "File too large, skipping content analysis"
      );
      return null;
    }

    // 바이너리 파일이거나 content가 없으면 스킵
    if (!fileData.content || fileData.type !== "file") {
      logger.warn(
        {
          owner,
          repo,
          path,
          type: fileData.type,
          hasContent: !!fileData.content,
        },
        "File has no content or is not a file type, skipping"
      );
      return null;
    }

    let content = "";
    if (fileData.encoding === "base64") {
      content = Buffer.from(fileData.content, "base64").toString("utf-8");
    } else {
      content = fileData.content;
    }

    logger.info(
      { path, size: fileData.size, encoding: fileData.encoding },
      "File content successfully retrieved"
    );

    return {
      content,
      encoding: fileData.encoding,
      size: fileData.size,
    };
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : "Unknown error",
        owner,
        repo,
        path,
        ref,
      },
      "Error fetching file content"
    );
    return null;
  }
};

/**
 * 여러 파일의 내용을 한번에 가져오기 (배치 처리)
 */
export const getMultipleFileContents = async (
  accessToken: string,
  owner: string,
  repo: string,
  filePaths: string[],
  ref: string = "main",
  maxFiles: number = 100 // 한번에 처리할 최대 파일 수를 100개로 증가
): Promise<
  Record<string, { content: string; size: number; language?: string }>
> => {
  const results: Record<
    string,
    { content: string; size: number; language?: string }
  > = {};

  // 파일 수 제한
  const limitedPaths = filePaths.slice(0, maxFiles);

  logger.info(
    `Processing ${limitedPaths.length} files out of ${filePaths.length} total files`
  );

  // 병렬로 파일 내용 가져오기 (동시 요청 수 제한)
  const batchSize = 8; // 배치 크기를 8로 줄여서 API 안정성 확보
  for (let i = 0; i < limitedPaths.length; i += batchSize) {
    const batch = limitedPaths.slice(i, i + batchSize);

    const batchPromises = batch.map(async (filePath) => {
      const fileContent = await getFileContent(
        accessToken,
        owner,
        repo,
        filePath,
        ref
      );
      if (fileContent) {
        const language = getLanguageFromExtension(filePath);
        results[filePath] = {
          content: fileContent.content,
          size: fileContent.size,
          language,
        };
        return { filePath, success: true };
      }
      return { filePath, success: false };
    });

    logger.info(
      `Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(
        limitedPaths.length / batchSize
      )} (${batch.length} files)`
    );

    const batchResults = await Promise.all(batchPromises);

    const successCount = batchResults.filter((r) => r.success).length;
    logger.info(
      `Batch completed: ${successCount}/${batch.length} files processed successfully`
    );

    // API 레이트 리미트 방지를 위한 딜레이
    if (i + batchSize < limitedPaths.length) {
      await new Promise((resolve) => setTimeout(resolve, 150)); // 딜레이 증가
    }
  }

  logger.info(
    `File content processing completed: ${Object.keys(results).length}/${
      limitedPaths.length
    } files successfully processed`
  );

  return results;
};

/**
 * 파일 확장자로 언어 추정
 */
const getLanguageFromExtension = (filePath: string): string => {
  const extension = filePath.split(".").pop()?.toLowerCase() || "";

  const languageMap: Record<string, string> = {
    js: "JavaScript",
    jsx: "JavaScript",
    ts: "TypeScript",
    tsx: "TypeScript",
    py: "Python",
    java: "Java",
    cpp: "C++",
    c: "C",
    cs: "C#",
    php: "PHP",
    rb: "Ruby",
    go: "Go",
    rs: "Rust",
    swift: "Swift",
    kt: "Kotlin",
    scala: "Scala",
    html: "HTML",
    css: "CSS",
    scss: "SCSS",
    sass: "Sass",
    less: "Less",
    vue: "Vue",
    svelte: "Svelte",
    json: "JSON",
    xml: "XML",
    yaml: "YAML",
    yml: "YAML",
    toml: "TOML",
    md: "Markdown",
    sql: "SQL",
    sh: "Shell",
    bash: "Bash",
    zsh: "Zsh",
    fish: "Fish",
    ps1: "PowerShell",
    r: "R",
    matlab: "MATLAB",
    dart: "Dart",
    lua: "Lua",
    perl: "Perl",
    haskell: "Haskell",
    clj: "Clojure",
    elm: "Elm",
    ex: "Elixir",
    erl: "Erlang",
    f90: "Fortran",
    jl: "Julia",
    nim: "Nim",
    pas: "Pascal",
    pl: "Perl",
    pro: "Prolog",
    rkt: "Racket",
  };

  return languageMap[extension] || "Unknown";
};

export default {
  getUserRepositories,
  getRepository,
  getRepositoryReadme,
  getRepositoryBranches,
  getRepositoryContents,
  getRepositoryCommits,
  getRepositoryPullRequests,
  saveRepository,
  getSavedRepositories,
  saveCommitHistory,
  savePullRequests,
  getDefaultBranch,
  getFileContent,
  getMultipleFileContents,
};
