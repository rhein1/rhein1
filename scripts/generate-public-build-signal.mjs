#!/usr/bin/env node

import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_LOGIN = "rhein1";
const DEFAULT_OUTPUT = path.resolve("assets/public-build-signal.svg");
const API_ROOT = "https://api.github.com";
const ACTIVE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function requestHeaders(token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "agoragentic-profile-signal",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchJson(url, token) {
  const response = await fetch(url, { headers: requestHeaders(token) });
  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

async function fetchPublicProfile(login, token) {
  const user = await fetchJson(`${API_ROOT}/users/${encodeURIComponent(login)}`, token);
  const repos = [];

  for (let page = 1; page <= 10; page += 1) {
    const batch = await fetchJson(
      `${API_ROOT}/users/${encodeURIComponent(login)}/repos?per_page=100&type=owner&sort=updated&page=${page}`,
      token,
    );
    repos.push(...batch);
    if (batch.length < 100) break;
  }

  return { user, repos };
}

function summarizePublicProfile({ user, repos }, now = new Date()) {
  const login = String(user.login || DEFAULT_LOGIN);
  const originalRepos = repos.filter(
    (repo) => repo?.owner?.login === login && repo.fork === false,
  );
  const activeCutoff = now.getTime() - ACTIVE_WINDOW_MS;
  const languageCounts = new Map();

  for (const repo of originalRepos) {
    if (repo.language) {
      languageCounts.set(repo.language, (languageCounts.get(repo.language) || 0) + 1);
    }
  }

  const primaryLanguages = [...languageCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([language]) => language);

  return {
    login,
    publicRepos: Number(user.public_repos || repos.length || 0),
    originalRepos: originalRepos.length,
    stars: originalRepos.reduce((total, repo) => total + Number(repo.stargazers_count || 0), 0),
    forks: originalRepos.reduce((total, repo) => total + Number(repo.forks_count || 0), 0),
    activeRepos90d: originalRepos.filter((repo) => {
      const pushedAt = Date.parse(repo.pushed_at || "");
      return Number.isFinite(pushedAt) && pushedAt >= activeCutoff;
    }).length,
    primaryLanguages,
  };
}

function renderSignal(summary) {
  const metrics = [
    ["PUBLIC REPOS", summary.publicRepos, "#68e3ea"],
    ["ORIGINAL BUILDS", summary.originalRepos, "#78e6ec"],
    ["STARS ON BUILDS", summary.stars, "#9adfdc"],
    ["FORKS OF BUILDS", summary.forks, "#e6b091"],
    ["ACTIVE IN 90D", summary.activeRepos90d, "#ff8062"],
  ];
  const cards = metrics.map(([label, value, color], index) => {
    const x = 36 + index * 224;
    return `<g transform="translate(${x} 82)">
      <rect width="208" height="112" rx="16" fill="#0e1e32" stroke="${color}" stroke-opacity="0.48"/>
      <text x="18" y="31" font-family="JetBrains Mono, Consolas, monospace" font-size="11" font-weight="800" letter-spacing="1.4" fill="#93a8c0">${escapeXml(label)}</text>
      <text x="18" y="81" font-family="Inter, Arial, sans-serif" font-size="38" font-weight="850" fill="${color}">${escapeXml(value)}</text>
    </g>`;
  }).join("");
  const languages = summary.primaryLanguages.length
    ? summary.primaryLanguages.map((language) => escapeXml(language.toUpperCase())).join(" / ")
    : "NOT REPORTED";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 250" width="1200" height="250" role="img" aria-labelledby="title desc">
  <title id="title">Public GitHub build signal for ${escapeXml(summary.login)}</title>
  <desc id="desc">Public repository, original build, star, fork, and recent activity totals generated from the GitHub public API.</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#071321"/>
      <stop offset="1" stop-color="#111f35"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#45d6df"/>
      <stop offset="0.54" stop-color="#78e6ec"/>
      <stop offset="1" stop-color="#ff7453"/>
    </linearGradient>
    <pattern id="grid" width="44" height="44" patternUnits="userSpaceOnUse">
      <path d="M44 0H0V44" fill="none" stroke="#6f86a8" stroke-opacity="0.06"/>
    </pattern>
  </defs>
  <rect width="1200" height="250" rx="24" fill="url(#bg)"/>
  <rect width="1200" height="250" rx="24" fill="url(#grid)"/>
  <rect x="1" y="1" width="1198" height="248" rx="23" fill="none" stroke="#45617c" stroke-opacity="0.45"/>
  <text x="36" y="36" font-family="JetBrains Mono, Consolas, monospace" font-size="14" font-weight="850" letter-spacing="2.4" fill="#e8f4fb">PUBLIC BUILD SIGNAL</text>
  <text x="36" y="60" font-family="Inter, Arial, sans-serif" font-size="12" fill="#91a5c1">GitHub public API / owned public repositories / no private activity</text>
  <text x="1164" y="36" text-anchor="end" font-family="JetBrains Mono, Consolas, monospace" font-size="10" letter-spacing="1.25" fill="#67dce4">REFRESHED BY GITHUB ACTIONS</text>
  <path d="M36 70H1164" stroke="url(#accent)" stroke-opacity="0.5"/>
  ${cards}
  <text x="36" y="226" font-family="JetBrains Mono, Consolas, monospace" font-size="10.5" font-weight="750" letter-spacing="1.35" fill="#91a5c1">PRIMARY LANGUAGES / ${languages}</text>
  <text x="1164" y="226" text-anchor="end" font-family="Inter, Arial, sans-serif" font-size="11" fill="#7187a3">Counts are public-source signals, not adoption or revenue claims.</text>
  <rect x="0" y="246" width="1200" height="4" fill="url(#accent)"/>
</svg>
`;
}

function selfTest() {
  const now = new Date("2026-08-15T12:00:00Z");
  const summary = summarizePublicProfile({
    user: { login: "demo&owner", public_repos: 3 },
    repos: [
      { owner: { login: "demo&owner" }, fork: false, language: "JavaScript", stargazers_count: 4, forks_count: 2, pushed_at: "2026-08-10T00:00:00Z" },
      { owner: { login: "demo&owner" }, fork: false, language: "Python", stargazers_count: 1, forks_count: 0, pushed_at: "2025-01-01T00:00:00Z" },
      { owner: { login: "demo&owner" }, fork: true, language: "Rust", stargazers_count: 99, forks_count: 99, pushed_at: "2026-08-10T00:00:00Z" },
    ],
  }, now);

  assert.deepEqual(summary, {
    login: "demo&owner",
    publicRepos: 3,
    originalRepos: 2,
    stars: 5,
    forks: 2,
    activeRepos90d: 1,
    primaryLanguages: ["JavaScript", "Python"],
  });
  const svg = renderSignal(summary);
  assert.match(svg, /demo&amp;owner/);
  assert.doesNotMatch(svg, /99/);
  assert.match(svg, /Counts are public-source signals/);
  console.log("PUBLIC_SIGNAL_SELF_TEST_OK");
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--self-test")) {
    selfTest();
    return;
  }

  const login = process.env.GITHUB_LOGIN || DEFAULT_LOGIN;
  const output = process.env.OUTPUT_PATH ? path.resolve(process.env.OUTPUT_PATH) : DEFAULT_OUTPUT;
  const source = await fetchPublicProfile(login, process.env.GITHUB_TOKEN || "");
  const summary = summarizePublicProfile(source);
  await writeFile(output, renderSignal(summary), "utf8");
  console.log(JSON.stringify({ output, ...summary }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export { escapeXml, renderSignal, summarizePublicProfile };
