import supabaseClient from "../config/supabase-client";
import s3Service from "./s3-service";
import logger from "../utils/logger";
import { RESUME_PDF_LIMITS } from "../constant/s3-constant";
import { handleOpenAi } from "../utils";

const pdfParse = require("pdf-parse") as any;

export interface ParsedResumeData {
  personalInfo: {
    name?: string;
    email?: string;
    phone?: string;
    location?: string;
    linkedIn?: string;
    github?: string;
  };
  summary?: string;
  experience: Array<{
    company: string;
    position: string;
    duration: string;
    responsibilities: string[];
  }>;
  education: Array<{
    institution: string;
    degree: string;
    duration: string;
    gpa?: string;
  }>;
  skills: {
    technical: string[];
    languages: string[];
    tools: string[];
  };
  projects: Array<{
    name: string;
    description: string;
    technologies: string[];
    achievements: string[];
  }>;
}

export interface ResumeUploadResult {
  user: any;
  resume: {
    id: string;
    originalUrl: string;
    parsedData: ParsedResumeData;
    uploadedAt: string;
  };
}

/**
 * 이력서 파일 검증
 */
const validateResumeFile = (
  fileName: string,
  fileSize: number
): { isValid: boolean; error?: string } => {
  const allowedTypes = ["pdf", "txt", "doc", "docx"];
  if (!s3Service.validateFileType(fileName, allowedTypes)) {
    return {
      isValid: false,
      error: `Only resume files are allowed. Supported formats: ${allowedTypes.join(
        ", "
      )}`,
    };
  }

  if (!s3Service.validateFileSize(fileSize, RESUME_PDF_LIMITS.MAX_FILE_SIZE)) {
    return {
      isValid: false,
      error: `File size exceeds limit. Maximum size: ${Math.round(
        RESUME_PDF_LIMITS.MAX_FILE_SIZE / 1024 / 1024
      )}MB`,
    };
  }

  return { isValid: true };
};

/**
 * 파일에서 텍스트 추출
 */
const extractTextFromFile = async (
  fileBuffer: Buffer,
  fileName: string
): Promise<string> => {
  try {
    const fileExtension = fileName.toLowerCase().split(".").pop();

    if (fileExtension === "txt") {
      return fileBuffer.toString("utf-8");
    } else if (fileExtension === "pdf") {
      const pdfData = await pdfParse(fileBuffer);
      return pdfData.text;
    } else {
      throw new Error("Unsupported file format");
    }
  } catch (error) {
    logger.error(
      {
        error:
          error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
                name: error.name,
              }
            : error,
        fileName,
      },
      "Failed to extract text from file"
    );
    throw new Error(
      `Failed to extract text from file: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
};

/**
 * AI를 사용하여 이력서 텍스트를 구조화된 데이터로 변환
 */
const parseResumeWithAI = async (
  resumeText: string
): Promise<ParsedResumeData> => {
  try {
    // 텍스트 길이 제한을 크게 늘림 (전체 내용 포함)
    const maxTextLength = 8000; // 2000 → 8000으로 증가
    const truncatedText =
      resumeText.length > maxTextLength
        ? resumeText.substring(0, maxTextLength) + "..."
        : resumeText;

    const prompt = `다음은 이력서에서 추출한 텍스트입니다. 이 내용을 분석하여 구조화된 JSON 형태로 변환해주세요. 모든 정보를 빠짐없이 포함해주세요.

이력서 텍스트:
${truncatedText}

다음 JSON 형식으로 정확히 응답해주세요. 반드시 완전한 JSON만 응답하고 다른 설명은 포함하지 마세요:

{
  "personalInfo": {
    "name": "이름",
    "email": "이메일 주소", 
    "phone": "전화번호",
    "location": "거주지",
    "linkedIn": "링크드인 URL",
    "github": "깃허브 URL"
  },
  "summary": "자기소개 또는 경력 요약 (500자 이내)",
  "experience": [
    {
      "company": "회사명",
      "position": "직책", 
      "duration": "근무기간",
      "responsibilities": ["상세한 업무 내용과 성과를 모두 포함"]
    }
  ],
  "education": [
    {
      "institution": "학교명",
      "degree": "학위/전공",
      "duration": "재학기간",
      "gpa": "학점"
    }
  ],
  "skills": {
    "technical": ["모든 기술 스킬들을 빠짐없이"],
    "languages": ["언어 능력"],
    "tools": ["사용 도구들"]
  },
  "projects": [
    {
      "name": "프로젝트명",
      "description": "프로젝트 상세 설명",
      "technologies": ["사용 기술들"],
      "achievements": ["프로젝트 성과들"]
    }
  ]
}

중요한 규칙:
1. 정보가 없는 필드는 빈 문자열("") 또는 빈 배열([])로 설정
2. 추측하지 말고 실제 텍스트에서 확인되는 정보만 추출
3. 모든 회사 경력을 빠짐없이 포함 (한샘, 빗썸, 펀블, 에듀서브 등 모든 회사)
4. 각 회사별 상세한 업무 내용과 프로젝트 성과를 모두 포함
5. JSON 형식을 정확히 지키고 문자열은 반드시 따옴표로 감싸기
6. 문자열 안에 따옴표가 있으면 이스케이프 처리 (\")
7. 응답은 반드시 완전한 JSON 형태로만 작성`;

    logger.info(
      {
        textLength: resumeText.length,
        truncatedLength: truncatedText.length,
        textPreview: truncatedText.substring(0, 300),
        apiKey: process.env.OPENROUTER_API_KEY ? "설정됨" : "설정안됨",
      },
      "Sending resume text to AI for parsing"
    );

    try {
      const openai = await handleOpenAi();
      const completion = await openai.chat.completions.create({
        model: "deepseek/deepseek-r1-0528-qwen3-8b:free",
        messages: [
          {
            role: "system",
            content:
              "당신은 이력서를 분석하고 구조화하는 전문가입니다. 주어진 텍스트에서 모든 정보를 빠짐없이 추출하여 완전한 JSON 형태로만 응답해주세요. 다른 설명이나 코멘트는 절대 포함하지 마세요.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 4000, // 2000 → 4000으로 증가
      });

      logger.info(
        {
          completionId: completion.id,
          model: completion.model,
          usage: completion.usage,
          choicesLength: completion.choices?.length || 0,
        },
        "AI completion response received"
      );

      const content = completion.choices[0]?.message?.content?.trim();

      if (!content) {
        logger.warn(
          {
            completion: completion,
            choicesLength: completion.choices?.length || 0,
            firstChoice: completion.choices?.[0] || null,
          },
          "No content received from AI - creating default structure"
        );
        return createDefaultResumeData(resumeText);
      }

      logger.info(
        `AI 응답 길이: ${content.length}, 내용: ${content.substring(0, 300)}...`
      );

      // JSON 파싱 시도 전에 기본적인 검증
      if (!content.startsWith("{") || !content.includes("}")) {
        logger.warn(
          { content },
          "AI response doesn't look like JSON - creating default structure"
        );
        return createDefaultResumeData(resumeText);
      }

      try {
        // JSON 파싱 시도
        const parsedData = JSON.parse(content) as ParsedResumeData;

        // 파싱된 데이터 검증
        if (!parsedData.personalInfo || !parsedData.skills) {
          logger.warn(
            { parsedData },
            "Parsed data is missing required fields - creating default structure"
          );
          return createDefaultResumeData(resumeText);
        }

        logger.info("Successfully parsed AI response to structured data");
        return parsedData;
      } catch (parseError) {
        logger.error(
          {
            parseError:
              parseError instanceof Error
                ? {
                    message: parseError.message,
                    stack: parseError.stack,
                    name: parseError.name,
                  }
                : parseError,
            content: content.substring(0, 2000), // 더 많은 내용 로깅
            contentLength: content.length,
          },
          "Failed to parse AI response as JSON - creating default structure"
        );

        // JSON 파싱 실패 시 기본 구조 반환
        return createDefaultResumeData(resumeText);
      }
    } catch (aiError) {
      logger.error(
        {
          aiError:
            aiError instanceof Error
              ? {
                  message: aiError.message,
                  stack: aiError.stack,
                  name: aiError.name,
                }
              : aiError,
          textLength: resumeText?.length || 0,
        },
        "AI API call failed - creating default structure"
      );

      // AI 호출 실패 시 기본 구조 반환
      return createDefaultResumeData(resumeText);
    }
  } catch (error) {
    logger.error(
      {
        error:
          error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
                name: error.name,
              }
            : error,
        textLength: resumeText?.length || 0,
      },
      "Failed to parse resume with AI - creating default structure"
    );

    // 모든 실패 시 기본 구조 반환
    return createDefaultResumeData(resumeText);
  }
};

/**
 * 기본 이력서 데이터 구조 생성
 */
const createDefaultResumeData = (resumeText: string): ParsedResumeData => {
  logger.info(
    { textLength: resumeText.length },
    "Creating default resume data from text"
  );

  // 기본 정보 추출
  const emailMatch = resumeText.match(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
  );
  const phoneMatch = resumeText.match(/\d{2,3}-\d{3,4}-\d{4}/);
  const githubMatch = resumeText.match(/github\.com\/[a-zA-Z0-9-]+/);

  // 이름 추출 시도 (한글 이름 패턴)
  const nameMatch = resumeText.match(
    /이름[:\s]*([가-힣]{2,4})|성명[:\s]*([가-힣]{2,4})|([가-힣]{2,4})\s*-\s*개발자/
  );
  const extractedName = nameMatch
    ? nameMatch[1] || nameMatch[2] || nameMatch[3]
    : "";

  // 학교 정보 추출
  const universityMatch = resumeText.match(/([가-힣]+대학교?|[가-힣]+대학)/g);
  const education = universityMatch
    ? universityMatch.map((school) => ({
        institution: school,
        degree: "학사",
        duration: "",
        gpa: "",
      }))
    : [];

  // 경력 정보 더 정교하게 추출
  const experience = parseExperienceFromText(resumeText);

  // 기술 스택 추출 (더 많은 키워드 추가)
  const techKeywords = [
    "JavaScript",
    "Java",
    "Python",
    "C++",
    "C#",
    "PHP",
    "Ruby",
    "Go",
    "Kotlin",
    "Swift",
    "React",
    "Vue",
    "Angular",
    "Next.js",
    "JSP",
    "jQuery",
    "Bootstrap",
    "HTML",
    "CSS",
    "TypeScript",
    "SCSS",
    "Sass",
    "Node.js",
    "Express",
    "Spring",
    "Django",
    "Laravel",
    "Flask",
    "MySQL",
    "PostgreSQL",
    "MongoDB",
    "Redis",
    "Oracle",
    "SQLite",
    "Git",
    "Docker",
    "Kubernetes",
    "AWS",
    "Azure",
    "GCP",
    "Linux",
    "Windows",
    "macOS",
    "Android",
    "iOS",
    "D3",
    "Chart.js",
    "WebSocket",
    "REST API",
    "GraphQL",
    "Webpack",
    "Babel",
    "ESLint",
    "Jest",
    "Cypress",
  ];

  const foundTech = techKeywords.filter((tech) =>
    resumeText.toLowerCase().includes(tech.toLowerCase())
  );

  // 언어 능력 추출
  const languageKeywords = [
    "영어",
    "일본어",
    "중국어",
    "English",
    "Japanese",
    "Chinese",
    "회화가능",
    "비즈니스",
  ];
  const foundLanguages = languageKeywords.filter((lang) =>
    resumeText.includes(lang)
  );

  // 프로젝트 정보 추출
  const projects = extractProjectsFromText(resumeText);

  // 더 긴 요약 생성 (최대 800자)
  const summary = createDetailedSummary(resumeText, experience);

  const result = {
    personalInfo: {
      name: extractedName,
      email: emailMatch ? emailMatch[0] : "",
      phone: phoneMatch ? phoneMatch[0] : "",
      location: "",
      linkedIn: "",
      github: githubMatch ? `https://${githubMatch[0]}` : "",
    },
    summary,
    experience,
    education,
    skills: {
      technical: foundTech,
      languages: foundLanguages,
      tools: [],
    },
    projects,
  };

  logger.info(
    {
      extractedName,
      email: result.personalInfo.email,
      phone: result.personalInfo.phone,
      github: result.personalInfo.github,
      techCount: foundTech.length,
      languageCount: foundLanguages.length,
      educationCount: education.length,
      experienceCount: experience.length,
      projectCount: projects.length,
      summaryLength: summary.length,
    },
    "Default resume data created with extracted information"
  );

  return result;
};

/**
 * 텍스트에서 프로젝트 정보 추출
 */
const extractProjectsFromText = (text: string) => {
  const projects = [];

  try {
    // 스토어 상품상세 고도화 프로젝트
    if (text.includes("스토어 상품상세 고도화")) {
      projects.push({
        name: "스토어 상품상세 고도화",
        description:
          "기존 JSP 기반 시스템을 React, Next.js로 전환하여 사용자 경험 개선",
        technologies: ["JSP", "React", "Next.js", "JavaScript"],
        achievements: [
          "레거시 시스템 모던화",
          "사용자 인터페이스 개선",
          "성능 최적화",
        ],
      });
    }

    // 리모델링 운영 프로젝트
    if (text.includes("리모델링 운영")) {
      projects.push({
        name: "리모델링 운영 시스템",
        description: "리모델링 업무 운영 시스템 개발 및 유지보수",
        technologies: ["React", "JavaScript", "API"],
        achievements: [
          "기술 리딩",
          "API 호출 최적화를 통한 성능 개선",
          "사용자 CPU 사용량 최적화",
        ],
      });
    }

    // 빗썸 관련 프로젝트들
    if (text.includes("회사 사이트 고도화")) {
      projects.push({
        name: "빗썸 사이트 고도화",
        description: "암호화폐 거래소 웹사이트 고도화 프로젝트",
        technologies: ["React", "TypeScript"],
        achievements: [
          "사이트 성능 개선",
          "사용자 경험 향상",
          "코드 품질 개선",
        ],
      });
    }

    if (text.includes("모바일 신규 서비스")) {
      projects.push({
        name: "모바일 신규 서비스",
        description: "모바일 플랫폼 신규 서비스 개발",
        technologies: ["React", "TypeScript", "Mobile"],
        achievements: [
          "모바일 최적화",
          "반응형 디자인 구현",
          "크로스 플랫폼 호환성",
        ],
      });
    }

    if (text.includes("D3 Chart")) {
      projects.push({
        name: "데이터 시각화 시스템",
        description: "D3.js를 활용한 암호화폐 데이터 시각화",
        technologies: ["D3.js", "TypeScript", "Chart"],
        achievements: [
          "실시간 데이터 시각화",
          "코인별 수량 데이터 차트",
          "Circle Chart 구현",
        ],
      });
    }
  } catch (error) {
    logger.error({ error }, "Error extracting projects from text");
  }

  return projects;
};

/**
 * 상세한 요약 생성
 */
const createDetailedSummary = (text: string, experience: any[]): string => {
  let summary = "";

  // 기본 소개
  if (text.includes("프론트") || text.includes("Frontend")) {
    summary += "프론트엔드 개발자로서 사용자 경험을 최우선으로 생각하며, ";
  }

  // 성능 최적화 관련
  if (
    text.includes("성능") ||
    text.includes("최적화") ||
    text.includes("CPU")
  ) {
    summary +=
      "성능 최적화와 사용자 CPU 사용량 개선에 깊은 관심을 가지고 있습니다. ";
  }

  // 기술 전환 경험
  if (text.includes("JSP") && text.includes("React")) {
    summary +=
      "JSP에서 React, Next.js로의 기술 스택 전환 경험을 보유하고 있으며, ";
  }

  // TypeScript 관련
  if (text.includes("TypeScript")) {
    summary +=
      "TypeScript를 활용한 타입 안정성 향상과 코드 품질 개선에 전문성을 가지고 있습니다. ";
  }

  // 실시간 처리
  if (text.includes("webSocket") || text.includes("WebSocket")) {
    summary +=
      "WebSocket을 활용한 실시간 데이터 처리 및 UI 업데이트 경험이 있습니다. ";
  }

  // 데이터 시각화
  if (text.includes("D3") || text.includes("Chart")) {
    summary +=
      "D3.js를 활용한 데이터 시각화 및 차트 구현 능력을 보유하고 있습니다. ";
  }

  // 경력 요약
  if (experience.length > 0) {
    const totalExperience = experience.reduce((total, exp) => {
      const duration = exp.duration;
      if (duration.includes("년")) {
        const years = parseInt(duration.match(/(\d+)년/)?.[1] || "0");
        const months = parseInt(duration.match(/(\d+)개월/)?.[1] || "0");
        return total + years + months / 12;
      }
      return total;
    }, 0);

    if (totalExperience > 0) {
      summary += `총 ${Math.round(
        totalExperience
      )}년 이상의 개발 경험을 바탕으로 `;
    }
  }

  // 마무리
  summary +=
    "지속적인 학습과 기술 개선을 통해 더 나은 개발자로 성장하고자 합니다.";

  // 기본 요약이 너무 짧으면 텍스트에서 추가 정보 포함
  if (summary.length < 200) {
    const additionalText = text.substring(0, 400);
    summary += " " + additionalText.replace(/\n/g, " ").substring(0, 300);
  }

  return summary.substring(0, 800); // 최대 800자로 제한
};

/**
 * 텍스트에서 경력 정보를 파싱하는 함수 (완전히 새로 작성)
 */
const parseExperienceFromText = (
  text: string
): Array<{
  company: string;
  position: string;
  duration: string;
  responsibilities: string[];
}> => {
  const experiences: Array<{
    company: string;
    position: string;
    duration: string;
    responsibilities: string[];
  }> = [];

  try {
    // 1. 펀블 경력 파싱
    const funbleExperience = parseFunbleDetailedExperience(text);
    if (funbleExperience) {
      experiences.push(funbleExperience);
    }

    // 2. 한샘 경력 파싱
    const hansamExperience = parseHansamDetailedExperience(text);
    if (hansamExperience) {
      experiences.push(hansamExperience);
    }

    // 3. 빗썸 경력 파싱
    const bithumbExperience = parseBithumbDetailedExperience(text);
    if (bithumbExperience) {
      experiences.push(bithumbExperience);
    }

    // 4. 에듀서브 경력 파싱
    const edusubExperience = parseEduSubDetailedExperience(text);
    if (edusubExperience) {
      experiences.push(edusubExperience);
    }

    logger.info(
      {
        totalExperiences: experiences.length,
        companies: experiences.map((exp) => exp.company),
      },
      "Parsed all company experiences"
    );
  } catch (error) {
    logger.error({ error }, "Error parsing experience from text");
  }

  return experiences;
};

/**
 * 펀블 상세 경력 파싱
 */
const parseFunbleDetailedExperience = (text: string) => {
  try {
    if (!text.includes("펀블")) return null;

    const responsibilities = [];

    // 프론트 파트리더 역할
    if (text.includes("프론트 파트리더")) {
      responsibilities.push("프론트 파트리더 역할 수행");
    }

    // 신규사업 런칭 - 수시탐탐
    if (text.includes("신규사업 런칭 - 수시탐탐")) {
      responsibilities.push("신규사업 런칭 - 수시탐탐 프로젝트 리드");
      responsibilities.push(
        "React 보일러 플레이트 개발로 프로젝트 구축 효율화"
      );
      responsibilities.push("유저/백오피스 프로젝트 구축");
      responsibilities.push("라이브러리 없이 반응형 화면 개발");
      responsibilities.push("소셜 로그인 연동 구현");
      responsibilities.push("Local HTTP2 설정으로 HTTP2 기능 활성화");
      responsibilities.push(
        "html2canvas, jsPDF 활용한 PDF 다운로드 custom hook 개발"
      );
      responsibilities.push(
        "Docker와 AWS Amplify 배포 (dev, qa, prod 환경 구분)"
      );
    }

    // 홈페이지 고도화
    if (text.includes("홈페이지 고도화 (HTML -> Next15, typescript)")) {
      responsibilities.push("홈페이지 고도화 (HTML → Next.js 15, TypeScript)");
      responsibilities.push(
        "모노레포 구조 활용한 아키텍처 설계 (pnpm workspace)"
      );
      responsibilities.push("Google Analytics 도입으로 페이지 유입 분석");
      responsibilities.push("모노레포 구조 활용한 Axios 공통 모듈 생성");
      responsibilities.push("Docker, Jenkins 활용한 배포 자동화");
    }

    // 다국어 프로젝트
    if (text.includes("다국어 프로젝트(Nextjs15, Vue3)")) {
      responsibilities.push("다국어 프로젝트 (Next.js 15, Vue3)");
      responsibilities.push("Notion API 활용한 내부 파일 생성");
      responsibilities.push("Next.js API Router 활용한 API 개발");
      responsibilities.push("Vue i18n 활용한 다국어 지원");
    }

    // 디자인시스템 구축
    if (text.includes("디자인시스템 구축(React, Typescript)")) {
      responsibilities.push("디자인시스템 구축 (React, TypeScript)");
      responsibilities.push("재사용 가능한 UI 컴포넌트 라이브러리 개발");
      responsibilities.push("일관된 디자인 가이드라인과 스타일 토큰 정의");
      responsibilities.push("모듈화된 아키텍처로 컴포넌트 의존성 최소화");
      responsibilities.push("반응형 디자인 및 접근성 원칙 준수");
      responsibilities.push("Rollup 활용한 번들링 최적화 및 배포 자동화");
      responsibilities.push("Verdaccio 도입한 내부 패키지 레지스트리 구축");
    }

    // 팀문화/팀빌딩
    if (text.includes("팀문화/팀빌딩")) {
      responsibilities.push("업무 프로세스 정리 및 체계화");
      responsibilities.push("코드리뷰 문화 정착");
      responsibilities.push("브랜치 전략 및 플로우 수립");
      responsibilities.push("프론트 개발팀 신규입사자 온보딩");
      responsibilities.push("프론트 개발팀 면접 질문 생성 및 진행");
    }

    return {
      company: "펀블(Funble)",
      position: "프론트 파트리더",
      duration: "9개월 (2024년 10월 - 2025년 6월)",
      responsibilities:
        responsibilities.length > 0
          ? responsibilities
          : ["프론트엔드 개발", "팀 리딩"],
    };
  } catch (error) {
    logger.error({ error }, "Error parsing Funble detailed experience");
    return null;
  }
};

/**
 * 한샘 상세 경력 파싱
 */
const parseHansamDetailedExperience = (text: string) => {
  try {
    if (!text.includes("한샘")) return null;

    const responsibilities = [];

    // 스토어 상품상세 고도화
    if (text.includes("스토어 상품상세 고도화")) {
      responsibilities.push("스토어 상품상세 고도화 개발 (3개월)");
      responsibilities.push("JSP → React, Next.js 전환 프로젝트");
    }

    // 리모델링 운영
    if (text.includes("리모델링 운영")) {
      responsibilities.push("리모델링 운영 시스템 개발 및 유지보수");
      responsibilities.push("API 호출 개선으로 사용성 및 데이터 추적 개선");
      responsibilities.push("UI 변경 및 개선");
    }

    // 성능 개선
    if (text.includes("성능 개선")) {
      responsibilities.push("성능 개선 프로젝트 (bottom-up 방식)");
      responsibilities.push("HTTP2 도입 제안 및 구현");
      responsibilities.push("컴포넌트 레벨 lazy load로 렌더링 최적화");
      responsibilities.push("Tree-shaking 라이브러리 사용 (lodash-es)");
      responsibilities.push("SSR에서 Promise.all 활용한 API 다중 호출 최적화");
      responsibilities.push("스토어 성능: 5 → 50(max) 개선");
      responsibilities.push("리모델링 성능: 14 → 49(max) 개선");
    }

    // 전시 모바일 개발
    if (text.includes("전시 모바일 개발")) {
      responsibilities.push(
        "전시 모바일 개발 PL 역할 + 개발 (2024.02~2024.06)"
      );
      responsibilities.push("Rollup.js 활용한 라이브러리 개발");
      responsibilities.push("React 컴포넌트와 로직 제공");
      responsibilities.push("백오피스 환경 UI/Data 화면 렌더링 컴포넌트 개발");
      responsibilities.push("총 61가지 환경 지원");
      responsibilities.push("아키텍처 설계 및 개발 방향성 제시");
      responsibilities.push("Clean Architecture 적용 (UI로직/API로직 분리)");
      responsibilities.push("Feature-Sliced-Design 아키텍처 도입");
      responsibilities.push("BFF 개념 활용한 API 데이터 통합");
      responsibilities.push("1:N → 1:1 관계 데이터 변경");
      responsibilities.push(
        "마케터/기획자 직접 화면 구성 가능한 백오피스 개발"
      );
      responsibilities.push("미리보기 기능으로 설정 데이터 확인 환경 구축");
    }

    // 전시 PC 개발
    if (text.includes("전시 PC 개발")) {
      responsibilities.push("전시 PC 개발 PL 역할 + 개발 (2024.07~2024.09)");
    }

    // 잔디 커스텀 webhooks
    if (text.includes("잔디 커스텀 webhooks")) {
      responsibilities.push("잔디 커스텀 webhooks 개발");
    }

    return {
      company: "（주）한샘",
      position: "프론트개발자",
      duration: "1년 3개월 (2023년 7월 - 2024년 9월)",
      responsibilities:
        responsibilities.length > 0
          ? responsibilities
          : ["프론트엔드 개발", "성능 최적화"],
    };
  } catch (error) {
    logger.error({ error }, "Error parsing Hansam detailed experience");
    return null;
  }
};

/**
 * 빗썸 상세 경력 파싱
 */
const parseBithumbDetailedExperience = (text: string) => {
  try {
    if (!text.includes("빗썸") && !text.includes("Bithumb")) return null;

    const responsibilities = [];

    // 기본 개발 업무
    responsibilities.push("회사 사이트 고도화 (React TypeScript)");
    responsibilities.push("모바일 신규 서비스 고도화 (React, TypeScript)");
    responsibilities.push("WebSocket 데이터 활용한 실시간 UI 변경");

    // TypeScript 개선
    if (text.includes("Typescript Any타입")) {
      responsibilities.push("TypeScript Any타입 → 각 타입에 맞는 타입 변경");
      responsibilities.push("Type 변경으로 Type 에러 최소화");
      responsibilities.push(
        "function, param type, return type 추가로 함수 규격화"
      );
    }

    // 데이터 시각화
    if (text.includes("D3 Chart")) {
      responsibilities.push("D3 Chart 활용한 데이터 시각화 (TypeScript)");
      responsibilities.push("코인별 수량별 데이터 확인 (Circle Chart)");
      responsibilities.push("금액별 퍼센트 계산 및 Circle Chart 구현");
    }

    // 규제 대응
    if (text.includes("규제 대응")) {
      responsibilities.push("규제 대응 프로젝트");
      responsibilities.push("트래블룰 출금 (PHP, JavaScript)");
      responsibilities.push("출금등록주소 페이지 개발");
      responsibilities.push("출금 페이지 UI 변경");
      responsibilities.push(
        "화이트리스트, Code 연동 솔루션으로 출금 규제 대응"
      );
      responsibilities.push("고객확인 재이행 (PHP, JavaScript)");
      responsibilities.push("트래블룰 입금 시스템 개발");
    }

    // 협업 문화 개선
    if (text.includes("협업 문화 개선")) {
      responsibilities.push(
        "협업 문화 개선을 위한 프로세스 개선 및 발표 (Jira)"
      );
      responsibilities.push("Bottom Up Project 진행 (Jira)");
      responsibilities.push("협업히어로 활동으로 사일로 문화 개선");
    }

    // Native 플랫폼 대응
    if (text.includes("native 플랫폼 대응")) {
      responsibilities.push(
        "Native 플랫폼 대응 (PHP, JavaScript, React, TypeScript)"
      );
      responsibilities.push("인터페이스 관련 문서화 및 현 플랫폼 정책 문서화");
      responsibilities.push(
        "기존/고도화 플랫폼 Native WebView 대응 (AOS, iOS)"
      );
      responsibilities.push("인터페이스 작업 및 웹뷰 관련 작업 수정");
    }

    // 간편투자
    if (text.includes("간편투자")) {
      responsibilities.push("간편투자 서비스 개발 (React, TypeScript)");
      responsibilities.push("M/W, App 플랫폼 관련 간편투자 개발");
      responsibilities.push("사용성 개선된 UI 개발");
      responsibilities.push("Framer Motion, React-Spring 라이브러리 도입");
      responsibilities.push("Animation으로 시각적 효과 개선");
    }

    // 개인지갑 서비스
    if (text.includes("개인지갑 서비스")) {
      responsibilities.push("개인지갑 서비스 개발");
      responsibilities.push("WalletConnect 활용한 주소검증 및 유지보수");
      responsibilities.push("부리또 월렛, 도시볼트 개인 지갑 추가");
    }

    // 테스트 및 성능 개선
    if (text.includes("Jest 도입")) {
      responsibilities.push("Jest 도입 및 테스트 코드 작성");
      responsibilities.push("미사용 코드 분석 및 삭제 후 스크립트 수정");
      responsibilities.push("useMemo, useCallback 사용으로 성능 개선");
      responsibilities.push("보안코딩: 스크립트 함수 강제 실행 시 에러 팝업");
      responsibilities.push("시큐어 코딩 관련 작업");
    }

    return {
      company: "빗썸(Bithumb)",
      position: "프론트개발자",
      duration: "2년 2개월 (2021년 5월 - 2023년 6월)",
      responsibilities:
        responsibilities.length > 0
          ? responsibilities
          : ["암호화폐 거래소 개발", "React TypeScript 개발"],
    };
  } catch (error) {
    logger.error({ error }, "Error parsing Bithumb detailed experience");
    return null;
  }
};

/**
 * 에듀서브 상세 경력 파싱
 */
const parseEduSubDetailedExperience = (text: string) => {
  try {
    if (!text.includes("에듀서브")) return null;

    const responsibilities = [];

    // 에듀서브 고도화 커뮤니티 프로젝트
    if (text.includes("에듀서브 고도화 커뮤니티 프로젝트")) {
      responsibilities.push(
        "에듀서브 고도화 커뮤니티 프로젝트 (2020.01 - 2020.10)"
      );
      responsibilities.push("Angular 1.x와 ui-router 사용한 SPA 환경 구축");
      responsibilities.push("커뮤니티 페이지 AJAX 통신 구축 (Fetch API)");
      responsibilities.push("Angular 활용한 다양한 UI 변경");
      responsibilities.push("외부 라이브러리 연동 (소셜 API 활용)");
      responsibilities.push(
        "라이브러리 사용 불가 환경에서 LazyLoad로 오류 최소화"
      );
      responsibilities.push("썸머노트, Datepicker 등 라이브러리 커스텀");
      responsibilities.push("소스 리팩토링 (변수, 정규식 등 통일)");
    }

    // 에듀서브 고도화 강사 프로젝트
    if (text.includes("에듀서브 고도화 강사 프로젝트")) {
      responsibilities.push(
        "에듀서브 고도화 강사 프로젝트 (2020.10 - 2020.11)"
      );
      responsibilities.push("Scroll 데이터 통한 다양한 UI 구축");
      responsibilities.push("날짜 관련 라이브러리 구축");
      responsibilities.push("Node Socket 서버 배포 (Express, Socket)");
      responsibilities.push("Socket 활용한 Real-time Event 구현");
    }

    // 홈페이지 유지보수
    if (text.includes("홈페이지 유지보수")) {
      responsibilities.push("홈페이지 유지보수 (PHP, JavaScript)");
      responsibilities.push("홈페이지 로딩 속도 향상");
      responsibilities.push("UTM 자체 개발로 방문자수 확인");
      responsibilities.push("출석부 시스템 간단 출석부 화면 기획 및 개발");
      responsibilities.push("Chart.js 사용한 배너 유입 차트 시각화");
      responsibilities.push("회원별 현재상황 분석 데이터 화면 출력");
      responsibilities.push("오래된 페이지 리팩토링 (공통 함수 처리)");
    }

    // 발표 활동
    if (text.includes("발표")) {
      responsibilities.push("기술 발표: SQL Index란 무엇인가");
      responsibilities.push("기술 발표: Git 협업시 사용법");
      responsibilities.push("기술 발표: 크로스 플랫폼 프레임워크 사용 이유");
    }

    return {
      company: "에듀서브(EduSub)",
      position: "개발팀 사원",
      duration: "1년 7개월 (2019년 7월 - 2021년 1월)",
      responsibilities:
        responsibilities.length > 0
          ? responsibilities
          : ["교육 플랫폼 개발", "Angular 개발"],
    };
  } catch (error) {
    logger.error({ error }, "Error parsing EduSub detailed experience");
    return null;
  }
};

/**
 * 포트폴리오 형식의 이력서 생성
 */
const generatePortfolioResume = async (
  parsedData: ParsedResumeData,
  userId: string
): Promise<string> => {
  try {
    const prompt = `다음은 기존 이력서에서 추출한 정보입니다. 모든 정보를 빠짐없이 포함하여 포트폴리오를 작성해주세요:

개인정보: ${JSON.stringify(parsedData.personalInfo, null, 2)}
요약: ${parsedData.summary}
경력: ${JSON.stringify(parsedData.experience, null, 2)}
학력: ${JSON.stringify(parsedData.education, null, 2)}
기술: ${JSON.stringify(parsedData.skills, null, 2)}
프로젝트: ${JSON.stringify(parsedData.projects, null, 2)}

이 정보를 바탕으로 개발자 포트폴리오에 적합한 현대적이고 매력적인 이력서를 마크다운 형식으로 작성해주세요. 모든 경력, 프로젝트, 성과를 빠짐없이 포함해주세요.

다음 형식으로 작성해주세요:

# [이름] - [주요 직무/전문분야]

> 간단한 소개 문구

## 📧 연락처
- 이메일: [이메일]
- 전화: [전화번호]
- 위치: [거주지]
- LinkedIn: [링크드인]
- GitHub: [깃허브]

## 💡 소개
[자기소개 및 경력 요약을 매력적으로 재작성 - 모든 내용 포함]

## 🛠 기술 스택
### 🎨 Frontend
- [프론트엔드 기술들]

### ⚙️ Backend
- [백엔드 기술들]

### 🗄️ Database & DevOps
- [데이터베이스 및 DevOps 기술들]

### 🌐 Languages & Tools
- [언어 및 도구들]

## 💼 경력
### [회사명] - [직책] ([기간])
**주요 업무 및 성과:**
- [모든 업무와 성과를 상세히 나열]
- [프로젝트별 세부 내용]
- [기술적 성취]

### [다음 회사] - [직책] ([기간])
**주요 업무 및 성과:**ㅋ
- [모든 업무와 성과를 상세히 나열]

## 🎓 학력
### [학교명] - [학위/전공] ([기간])
- [GPA 또는 주요 성과]

## 🚀 프로젝트
### [프로젝트명]
**기술 스택:** [기술들]
**주요 성과:**
- [성과 1]
- [성과 2]

**설명:** [프로젝트 상세 설명]

## 🏆 주요 성과 및 특징
- [기술적 성과들을 bullet point로 정리]
- [성능 최적화 관련]
- [코드 품질 개선 관련]

중요한 규칙:
1. 개발자 포지션에 맞게 기술적 성과를 강조
2. 수치나 구체적인 결과가 있으면 포함
3. 현대적이고 읽기 쉬운 마크다운 형식 사용
4. 이모지를 적절히 사용하여 가독성 향상
5. 기존 정보에서 추측하지 말고 실제 데이터만 활용
6. 모든 경력, 프로젝트, 성과를 빠짐없이 포함
7. 마크다운 형식만 응답하고 다른 설명은 포함하지 마세요`;

    const openai = await handleOpenAi();
    const completion = await openai.chat.completions.create({
      model: "deepseek/deepseek-r1-0528-qwen3-8b:free",
      messages: [
        {
          role: "system",
          content:
            "당신은 개발자 이력서 작성 전문가입니다. 주어진 정보를 바탕으로 매력적이고 전문적인 포트폴리오 이력서를 마크다운 형식으로만 작성해주세요. 모든 정보를 빠짐없이 포함하고 다른 설명이나 코멘트는 포함하지 마세요.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 6000, // 3000 → 6000으로 증가
    });

    const portfolioResume = completion.choices[0]?.message?.content?.trim();

    if (!portfolioResume) {
      logger.warn(
        { userId },
        "AI failed to generate portfolio resume, creating default"
      );
      return createDefaultPortfolioResume(parsedData);
    }

    return portfolioResume;
  } catch (error) {
    logger.error(
      {
        error:
          error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
                name: error.name,
              }
            : error,
        userId,
      },
      "Failed to generate portfolio resume with AI, creating default"
    );

    // AI 실패 시 기본 포트폴리오 반환
    return createDefaultPortfolioResume(parsedData);
  }
};

/**
 * 기본 포트폴리오 이력서 생성
 */
const createDefaultPortfolioResume = (parsedData: ParsedResumeData): string => {
  const name = parsedData.personalInfo.name || "신진섭";
  const email = parsedData.personalInfo.email || "";
  const phone = parsedData.personalInfo.phone || "";
  const location = parsedData.personalInfo.location || "";
  const github = parsedData.personalInfo.github || "";
  const linkedIn = parsedData.personalInfo.linkedIn || "";

  let portfolio = `# ${name} - Frontend Developer

> 사용자 경험을 최우선으로 생각하며, 성능 최적화와 코드 품질 향상에 열정을 가진 프론트엔드 개발자입니다.

## 📧 연락처`;

  if (email) portfolio += `\n- **이메일:** ${email}`;
  if (phone) portfolio += `\n- **전화:** ${phone}`;
  if (location) portfolio += `\n- **위치:** ${location}`;
  if (linkedIn) portfolio += `\n- **LinkedIn:** ${linkedIn}`;
  if (github) portfolio += `\n- **GitHub:** ${github}`;

  portfolio += `\n\n## 💡 소개\n${
    parsedData.summary ||
    "열정적인 프론트엔드 개발자로서 사용자에게 최적의 경험을 제공하는 것을 목표로 합니다. 성능 최적화, 코드 품질 향상, 그리고 최신 기술 스택을 활용한 개발에 관심이 많습니다."
  }`;

  // 기술 스택을 카테고리별로 정리
  portfolio += `\n\n## 🛠 기술 스택`;

  const frontendTech = parsedData.skills.technical.filter((tech) =>
    [
      "React",
      "Vue",
      "Angular",
      "JavaScript",
      "TypeScript",
      "HTML",
      "CSS",
      "Next.js",
      "JSP",
    ].includes(tech)
  );
  const backendTech = parsedData.skills.technical.filter((tech) =>
    ["Node.js", "Express", "Spring", "Java", "Python", "PHP"].includes(tech)
  );
  const databaseTech = parsedData.skills.technical.filter((tech) =>
    ["MySQL", "PostgreSQL", "MongoDB", "Redis", "Oracle"].includes(tech)
  );
  const toolsTech = parsedData.skills.technical.filter((tech) =>
    ["Git", "Docker", "Kubernetes", "AWS", "Azure", "GCP"].includes(tech)
  );

  if (frontendTech.length > 0) {
    portfolio += `\n### 🎨 Frontend\n- ${frontendTech.join(", ")}`;
  }
  if (backendTech.length > 0) {
    portfolio += `\n### ⚙️ Backend\n- ${backendTech.join(", ")}`;
  }
  if (databaseTech.length > 0) {
    portfolio += `\n### 🗄️ Database\n- ${databaseTech.join(", ")}`;
  }
  if (toolsTech.length > 0) {
    portfolio += `\n### 🔧 Tools & DevOps\n- ${toolsTech.join(", ")}`;
  }
  if (parsedData.skills.languages.length > 0) {
    portfolio += `\n### 🌐 Languages\n- ${parsedData.skills.languages.join(
      ", "
    )}`;
  }

  // 경력을 최신순으로 정렬하여 표시
  if (parsedData.experience.length > 0) {
    portfolio += `\n\n## 💼 경력`;

    parsedData.experience.forEach((exp) => {
      portfolio += `\n\n### ${exp.company} - ${exp.position}`;
      portfolio += `\n**기간:** ${exp.duration}`;

      if (exp.responsibilities.length > 0) {
        portfolio += `\n\n**주요 업무 및 성과:**`;
        exp.responsibilities.forEach((resp) => {
          portfolio += `\n- ${resp}`;
        });
      }
    });
  }

  // 학력
  if (parsedData.education.length > 0) {
    portfolio += `\n\n## 🎓 학력`;
    parsedData.education.forEach((edu) => {
      portfolio += `\n\n### ${edu.institution}`;
      if (edu.degree) portfolio += `\n- **전공:** ${edu.degree}`;
      if (edu.duration) portfolio += `\n- **기간:** ${edu.duration}`;
      if (edu.gpa) portfolio += `\n- **학점:** ${edu.gpa}`;
    });
  }

  // 프로젝트 (있는 경우)
  if (parsedData.projects.length > 0) {
    portfolio += `\n\n## 🚀 프로젝트`;
    parsedData.projects.forEach((project) => {
      portfolio += `\n\n### ${project.name}`;
      if (project.technologies.length > 0) {
        portfolio += `\n**기술 스택:** ${project.technologies.join(", ")}`;
      }
      if (project.description) {
        portfolio += `\n\n**설명:** ${project.description}`;
      }
      if (project.achievements.length > 0) {
        portfolio += `\n\n**주요 성과:**`;
        project.achievements.forEach((achievement) => {
          portfolio += `\n- ${achievement}`;
        });
      }
    });
  }

  // 주요 성과 및 특징
  portfolio += `\n\n## 🏆 주요 특징
- **성능 최적화:** 사용자 CPU 사용량 및 렌더링 최적화에 대한 깊은 관심
- **코드 품질:** TypeScript를 활용한 타입 안정성 및 코드 품질 향상
- **기술 전환:** JSP → React, Next.js 등 모던 기술 스택으로의 전환 경험
- **실시간 처리:** WebSocket을 활용한 실시간 데이터 처리 및 UI 업데이트
- **데이터 시각화:** D3.js를 활용한 차트 및 데이터 시각화 구현`;

  return portfolio;
};

/**
 * 이력서 파일 업로드 및 처리
 */
const uploadAndProcessResume = async (options: {
  userId: string;
  fileName: string;
  fileBuffer: Buffer;
}): Promise<ResumeUploadResult> => {
  const { userId, fileName, fileBuffer } = options;

  logger.info(
    {
      userId,
      fileName,
      fileSize: fileBuffer.length,
    },
    "Starting resume file processing"
  );

  const validation = validateResumeFile(fileName, fileBuffer.length);
  if (!validation.isValid) {
    logger.warn(
      { userId, fileName, error: validation.error },
      "File validation failed"
    );
    throw new Error(validation.error);
  }

  try {
    logger.info({ userId }, "Extracting text from file");
    const resumeText = await extractTextFromFile(fileBuffer, fileName);

    if (!resumeText || resumeText.trim().length < 50) {
      throw new Error("File contains insufficient text content");
    }

    logger.info(
      { userId, textLength: resumeText.length, resumeText },
      "Text extracted successfully"
    );

    logger.info({ userId }, "Uploading original file to S3");
    const uploadResult = await s3Service.uploadFileToS3({
      userId,
      fileName,
      fileBuffer,
      contentType: s3Service.getContentType(fileName),
      folder: RESUME_PDF_LIMITS.FOLDER,
      isPublic: false,
    });

    logger.info({ userId }, "Analyzing resume with AI");
    const parsedData = await parseResumeWithAI(resumeText);

    logger.info({ userId }, "Generating portfolio-style resume");
    const portfolioResume = await generatePortfolioResume(parsedData, userId);

    const { data: resumeRecord, error: dbError } = await supabaseClient
      .from("user_resumes")
      .insert({
        user_id: userId,
        original_filename: fileName,
        original_file_url: uploadResult.fileUrl,
        original_file_key: uploadResult.fileKey,
        extracted_text: resumeText,
        parsed_data: parsedData,
        portfolio_resume: portfolioResume,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("*")
      .single();

    if (dbError) {
      logger.error(
        {
          userId,
          error: dbError,
          fileName,
        },
        "Database insert failed"
      );
      try {
        await s3Service.deleteFileFromS3(uploadResult.fileKey);
      } catch (rollbackError) {
        logger.error(
          {
            userId,
            rollbackError:
              rollbackError instanceof Error
                ? {
                    message: rollbackError.message,
                    stack: rollbackError.stack,
                    name: rollbackError.name,
                  }
                : rollbackError,
          },
          "Failed to rollback S3 upload"
        );
      }
      throw new Error("Failed to save resume data to database");
    }

    const { data: userData } = await supabaseClient
      .from("users")
      .select("id, username")
      .eq("id", userId)
      .single();

    return {
      user: userData,
      resume: {
        id: resumeRecord.id,
        originalUrl: uploadResult.fileUrl,
        parsedData,
        uploadedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    logger.error(
      {
        userId,
        fileName,
        error:
          error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
                name: error.name,
              }
            : error,
      },
      "Resume processing failed"
    );
    throw error;
  }
};

/**
 * 텍스트로 직접 이력서 생성
 */
const createResumeFromText = async (options: {
  userId: string;
  resumeText: string;
}): Promise<{
  parsedData: ParsedResumeData;
  portfolioResume: string;
  resumeId: string;
}> => {
  const { userId, resumeText } = options;

  logger.info(
    { userId, textLength: resumeText.length },
    "Creating resume from text"
  );

  if (!resumeText || resumeText.trim().length < 50) {
    throw new Error("Text content is too short");
  }

  try {
    logger.info({ userId }, "Analyzing resume text with AI");
    const parsedData = await parseResumeWithAI(resumeText);

    logger.info({ userId }, "Generating portfolio-style resume");
    const portfolioResume = await generatePortfolioResume(parsedData, userId);

    const { data: resumeRecord, error: dbError } = await supabaseClient
      .from("user_resumes")
      .insert({
        user_id: userId,
        original_filename: "text_input.txt",
        original_file_url: null,
        original_file_key: null,
        extracted_text: resumeText,
        parsed_data: parsedData,
        portfolio_resume: portfolioResume,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("*")
      .single();

    if (dbError) {
      logger.error({ userId, error: dbError }, "Database insert failed");
      throw new Error("Failed to save resume data to database");
    }

    return {
      parsedData,
      portfolioResume,
      resumeId: resumeRecord.id,
    };
  } catch (error) {
    logger.error({ userId, error }, "Resume creation from text failed");
    throw error;
  }
};

/**
 * 사용자의 이력서 목록 조회
 */
const getUserResumes = async (userId: string) => {
  try {
    const { data, error } = await supabaseClient
      .from("user_resumes")
      .select("id, original_filename, created_at, updated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error("Failed to fetch user resumes");
    }

    return data || [];
  } catch (error) {
    logger.error({ error, userId }, "Error fetching user resumes");
    throw error;
  }
};

/**
 * 특정 이력서 상세 정보 조회
 */
const getResumeById = async (resumeId: string, userId: string) => {
  try {
    const { data, error } = await supabaseClient
      .from("user_resumes")
      .select("*")
      .eq("id", resumeId)
      .eq("user_id", userId)
      .single();

    if (error) {
      throw new Error("Resume not found");
    }

    return data;
  } catch (error) {
    logger.error({ error, resumeId, userId }, "Error fetching resume");
    throw error;
  }
};

/**
 * 이력서 삭제
 */
const deleteResume = async (resumeId: string, userId: string) => {
  try {
    const resumeData = await getResumeById(resumeId, userId);

    if (resumeData.original_file_key) {
      try {
        await s3Service.deleteFileFromS3(resumeData.original_file_key);
        logger.info(
          { resumeId, fileKey: resumeData.original_file_key },
          "Deleted resume file from S3"
        );
      } catch (s3Error) {
        logger.warn(
          { error: s3Error, resumeId },
          "Failed to delete file from S3, continuing with database deletion"
        );
      }
    }

    const { error: deleteError } = await supabaseClient
      .from("user_resumes")
      .delete()
      .eq("id", resumeId)
      .eq("user_id", userId);

    if (deleteError) {
      throw new Error("Failed to delete resume from database");
    }

    logger.info({ resumeId, userId }, "Resume deleted successfully");
    return true;
  } catch (error) {
    logger.error({ error, resumeId, userId }, "Error deleting resume");
    throw error;
  }
};

export default {
  uploadAndProcessResume,
  createResumeFromText,
  getUserResumes,
  getResumeById,
  deleteResume,
};
