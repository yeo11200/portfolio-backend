import { LaunchOptions } from "puppeteer";

// Puppeteer 기본 설정 옵션
export const defaultPuppeteerOptions: LaunchOptions = {
  headless: false, // 디버깅을 위해 브라우저 창 표시 (디버깅 후에 true로 변경)
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas",
    "--disable-gpu",
    "--window-size=1920x1080",
    // 더 많은 메모리 할당
    "--disable-dev-profile",
    "--js-flags=--max-old-space-size=4096",
    // 추가 설정
    "--start-maximized",
    "--disable-extensions",
    "--disable-default-apps",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-web-security",
    "--disable-features=site-per-process",
    "--no-first-run",
    "--no-zygote",
  ],
  defaultViewport: {
    width: 1920,
    height: 1080,
  },
  slowMo: 100, // 각 동작 사이에 지연 시간 추가 (안정성 향상)
  timeout: 60000, // 기본 타임아웃
  // ignoreHTTPSErrors: true, // 타입 오류로 제거
};

// 뉴스 검색에 사용할 검색어 설정
export const candidateKeywords = [
  { name: "이재명", keywords: ["공약", "후보", "정책"] },
  { name: "김문수", keywords: ["공약", "후보", "정책"] },
  { name: "이준석", keywords: ["공약", "후보", "정책"] },
];

// 뉴스 소스 설정
export const newsSources = [
  {
    name: "Naver",
    baseUrl: "https://search.naver.com/search.naver",
    searchPath: "?where=news&query=",
  },
  {
    name: "Daum",
    baseUrl: "https://search.daum.net/search",
    searchPath: "?w=news&q=",
  },
];

// 스크래핑 설정
export const scrapingConfig = {
  periodInWeeks: 12, // 최근 12주 기준
  itemsPerCandidate: 50, // 후보당 최대 뉴스 아이템 수
  retryLimit: 3, // 실패 시 재시도 횟수
};

export default {
  defaultPuppeteerOptions,
  candidateKeywords,
  newsSources,
  scrapingConfig,
};
