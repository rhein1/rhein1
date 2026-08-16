#!/usr/bin/env node

import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_LOGIN = "rhein1";
const DEFAULT_OUTPUT = path.resolve("assets/public-build-signal.svg");
const DEFAULT_ACTIVITY_OUTPUT = path.resolve("assets/public-shipping-pulse.svg");
const API_ROOT = "https://api.github.com";
const ACTIVE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const ACTIVITY_WINDOW_DAYS = 28;
const DAY_MS = 24 * 60 * 60 * 1000;

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

async function fetchPublicEvents(login, token) {
  const events = [];

  for (let page = 1; page <= 3; page += 1) {
    const batch = await fetchJson(
      `${API_ROOT}/users/${encodeURIComponent(login)}/events/public?per_page=100&page=${page}`,
      token,
    );
    events.push(...batch);
    if (batch.length < 100) break;
  }

  return events;
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

function utcDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

function summarizePublicActivity({ user, repos, events }, now = new Date()) {
  const login = String(user.login || DEFAULT_LOGIN);
  const endDay = new Date(`${utcDayKey(now)}T00:00:00Z`);
  const earliestAllowedDay = new Date(endDay.getTime() - (ACTIVITY_WINDOW_DAYS - 1) * DAY_MS);
  const datedEvents = events
    .map((event) => ({ event, createdAt: Date.parse(event?.created_at || "") }))
    .filter(({ createdAt }) => Number.isFinite(createdAt)
      && createdAt >= earliestAllowedDay.getTime()
      && createdAt < endDay.getTime() + DAY_MS);
  const oldestObservedAt = datedEvents.reduce(
    (oldest, { createdAt }) => Math.min(oldest, createdAt),
    endDay.getTime(),
  );
  const startDay = new Date(`${utcDayKey(new Date(oldestObservedAt))}T00:00:00Z`);
  const dayCounts = new Map();

  const feedDays = Math.floor((endDay.getTime() - startDay.getTime()) / DAY_MS) + 1;
  for (let offset = 0; offset < feedDays; offset += 1) {
    dayCounts.set(utcDayKey(new Date(startDay.getTime() + offset * DAY_MS)), 0);
  }

  const windowEvents = datedEvents.map(({ event }) => event);

  for (const event of windowEvents) {
    if (event.type !== "PushEvent") continue;
    const key = utcDayKey(event.created_at);
    if (key && dayCounts.has(key)) dayCounts.set(key, dayCounts.get(key) + 1);
  }

  const recentRepos = repos
    .filter((repo) => repo?.owner?.login === login
      && repo.fork === false
      && repo.archived !== true
      && repo.name !== login)
    .sort((left, right) => Date.parse(right.pushed_at || "") - Date.parse(left.pushed_at || ""))
    .slice(0, 4)
    .map((repo) => ({
      name: String(repo.name || "unnamed"),
      pushedDate: utcDayKey(repo.pushed_at) || "unknown",
      language: String(repo.language || "Mixed"),
      stars: Number(repo.stargazers_count || 0),
    }));

  return {
    login,
    pushEvents: windowEvents.filter((event) => event.type === "PushEvent").length,
    pullRequestEvents: windowEvents.filter((event) => event.type === "PullRequestEvent").length,
    eventDays: new Set(windowEvents.map((event) => utcDayKey(event.created_at)).filter(Boolean)).size,
    reposPushed: new Set(windowEvents
      .filter((event) => event.type === "PushEvent")
      .map((event) => event?.repo?.name)
      .filter(Boolean)).size,
    feedDays,
    dailyPushes: [...dayCounts.entries()].map(([date, count]) => ({ date, count })),
    recentRepos,
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

function renderShippingPulse(summary) {
  const metrics = [
    ["PUSH EVENTS", summary.pushEvents, "#68e3ea"],
    ["PR EVENTS", summary.pullRequestEvents, "#78e6ec"],
    ["REPOS PUSHED", summary.reposPushed, "#e6b091"],
    ["ACTIVE DAYS", summary.eventDays, "#ff8062"],
  ];
  const metricCards = metrics.map(([label, value, color], index) => {
    const x = 36 + index * 170;
    return `<g transform="translate(${x} 88)">
      <rect width="158" height="66" rx="13" fill="#0e1e32" stroke="${color}" stroke-opacity="0.42"/>
      <text x="14" y="24" font-family="JetBrains Mono, Consolas, monospace" font-size="9.5" font-weight="800" letter-spacing="1.15" fill="#93a8c0">${escapeXml(label)}</text>
      <text x="14" y="52" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="850" fill="${color}">${escapeXml(value)}</text>
    </g>`;
  }).join("");

  const maxPushes = Math.max(1, ...summary.dailyPushes.map(({ count }) => count));
  const slotWidth = 644 / Math.max(1, summary.dailyPushes.length);
  const barWidth = Math.max(7, Math.min(22, slotWidth - 4));
  const bars = summary.dailyPushes.map(({ date, count }, index) => {
    const x = 57 + index * slotWidth + (slotWidth - barWidth) / 2;
    const height = count === 0 ? 3 : Math.max(9, Math.round((count / maxPushes) * 142));
    const y = 359 - height;
    const color = count === 0 ? "#29415c" : count === maxPushes ? "#ff8062" : "#68e3ea";
    return `<g>
      <rect x="${x.toFixed(2)}" y="${y}" width="${barWidth.toFixed(2)}" height="${height}" rx="4" fill="${color}" fill-opacity="${count === 0 ? "0.55" : "0.9"}"/>
      <title>${escapeXml(date)}: ${escapeXml(count)} public push event${count === 1 ? "" : "s"}</title>
    </g>`;
  }).join("");

  const recentRows = summary.recentRepos.map((repo, index) => {
    const y = 146 + index * 62;
    const name = repo.name.length > 31 ? `${repo.name.slice(0, 28)}...` : repo.name;
    return `<g>
      <circle cx="778" cy="${y - 4}" r="5" fill="${index === 0 ? "#ff8062" : "#68e3ea"}"/>
      <text x="794" y="${y}" font-family="Inter, Arial, sans-serif" font-size="14" font-weight="750" fill="#e8f4fb">${escapeXml(name)}</text>
      <text x="794" y="${y + 21}" font-family="JetBrains Mono, Consolas, monospace" font-size="9.5" letter-spacing="0.7" fill="#8298b4">PUSHED ${escapeXml(repo.pushedDate)} / ${escapeXml(repo.language.toUpperCase())} / ${escapeXml(repo.stars)} STARS</text>
${index < summary.recentRepos.length - 1 ? `      <path d="M778 ${y + 37}H1137" stroke="#49627e" stroke-opacity="0.28"/>
` : ""}    </g>`;
  }).join("");

  const firstDate = summary.dailyPushes.at(0)?.date || "";
  const middleDate = summary.dailyPushes.at(Math.floor((summary.dailyPushes.length - 1) / 2))?.date || "";
  const lastDate = summary.dailyPushes.at(-1)?.date || "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 450" width="1200" height="450" role="img" aria-labelledby="title desc">
  <title id="title">Recent public shipping pulse for ${escapeXml(summary.login)}</title>
  <desc id="desc">Recent public push-event cadence and recently pushed original repositories, generated from the capped GitHub public events feed.</desc>
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
  <rect width="1200" height="450" rx="24" fill="url(#bg)"/>
  <rect width="1200" height="450" rx="24" fill="url(#grid)"/>
  <rect x="1" y="1" width="1198" height="448" rx="23" fill="none" stroke="#45617c" stroke-opacity="0.45"/>
  <text x="36" y="36" font-family="JetBrains Mono, Consolas, monospace" font-size="14" font-weight="850" letter-spacing="2.4" fill="#e8f4fb">PUBLIC SHIPPING PULSE</text>
  <text x="36" y="60" font-family="Inter, Arial, sans-serif" font-size="12" fill="#91a5c1">Latest GitHub public events feed / owned original repositories / private activity excluded</text>
  <text x="1164" y="36" text-anchor="end" font-family="JetBrains Mono, Consolas, monospace" font-size="10" letter-spacing="1.25" fill="#67dce4">${escapeXml(summary.feedDays)}-DAY OBSERVED FEED</text>
  <path d="M36 70H1164" stroke="url(#accent)" stroke-opacity="0.5"/>
  ${metricCards}
  <rect x="36" y="171" width="690" height="230" rx="16" fill="#0b192b" stroke="#45617c" stroke-opacity="0.36"/>
  <text x="57" y="198" font-family="JetBrains Mono, Consolas, monospace" font-size="10" font-weight="800" letter-spacing="1.25" fill="#93a8c0">PUBLIC PUSH CADENCE</text>
  <path d="M57 359H701" stroke="#49627e" stroke-opacity="0.38"/>
  ${bars}
  <text x="57" y="383" font-family="JetBrains Mono, Consolas, monospace" font-size="9" fill="#7187a3">${escapeXml(firstDate)}</text>
  <text x="379" y="383" text-anchor="middle" font-family="JetBrains Mono, Consolas, monospace" font-size="9" fill="#7187a3">${escapeXml(middleDate)}</text>
  <text x="701" y="383" text-anchor="end" font-family="JetBrains Mono, Consolas, monospace" font-size="9" fill="#7187a3">${escapeXml(lastDate)}</text>
  <rect x="746" y="88" width="418" height="313" rx="16" fill="#0b192b" stroke="#45617c" stroke-opacity="0.36"/>
  <text x="778" y="118" font-family="JetBrains Mono, Consolas, monospace" font-size="10" font-weight="800" letter-spacing="1.25" fill="#93a8c0">RECENT ORIGINAL BUILDS</text>
  ${recentRows || `<text x="778" y="160" font-family="Inter, Arial, sans-serif" font-size="13" fill="#8298b4">No recent public repository activity reported.</text>`}
  <text x="36" y="426" font-family="Inter, Arial, sans-serif" font-size="10.5" fill="#7187a3">GitHub&apos;s public events endpoint is capped; this is not a complete contribution ledger or proof of adoption.</text>
  <text x="1164" y="426" text-anchor="end" font-family="JetBrains Mono, Consolas, monospace" font-size="9.5" letter-spacing="0.9" fill="#67dce4">REFRESHED BY GITHUB ACTIONS</text>
  <rect x="0" y="446" width="1200" height="4" fill="url(#accent)"/>
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

  const activity = summarizePublicActivity({
    user: { login: "demo&owner" },
    repos: [
      { name: "demo&owner", owner: { login: "demo&owner" }, fork: false, archived: false, pushed_at: "2026-08-15T10:00:00Z" },
      { name: "alpha<repo>", owner: { login: "demo&owner" }, fork: false, archived: false, language: "JavaScript", stargazers_count: 4, pushed_at: "2026-08-14T10:00:00Z" },
      { name: "old-repo", owner: { login: "demo&owner" }, fork: false, archived: true, language: "Python", stargazers_count: 2, pushed_at: "2026-08-13T10:00:00Z" },
    ],
    events: [
      { type: "PushEvent", created_at: "2026-08-15T08:00:00Z" },
      { type: "PushEvent", created_at: "2026-08-15T09:00:00Z", repo: { name: "demo&owner/alpha<repo>" } },
      { type: "PullRequestEvent", created_at: "2026-08-14T09:00:00Z", repo: { name: "demo&owner/alpha<repo>" } },
      { type: "ReleaseEvent", created_at: "2025-08-14T09:00:00Z" },
    ],
  }, now);
  assert.equal(activity.pushEvents, 2);
  assert.equal(activity.pullRequestEvents, 1);
  assert.equal(activity.eventDays, 2);
  assert.equal(activity.reposPushed, 1);
  assert.equal(activity.feedDays, 2);
  assert.equal(activity.dailyPushes.length, 2);
  assert.deepEqual(activity.recentRepos.map((repo) => repo.name), ["alpha<repo>"]);
  const activitySvg = renderShippingPulse(activity);
  assert.match(activitySvg, /alpha&lt;repo&gt;/);
  assert.doesNotMatch(activitySvg, /old-repo/);
  assert.match(activitySvg, /public events endpoint is capped/);
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
  const activityOutput = process.env.ACTIVITY_OUTPUT_PATH
    ? path.resolve(process.env.ACTIVITY_OUTPUT_PATH)
    : DEFAULT_ACTIVITY_OUTPUT;
  const token = process.env.GITHUB_TOKEN || "";
  const [source, events] = await Promise.all([
    fetchPublicProfile(login, token),
    fetchPublicEvents(login, token),
  ]);
  const summary = summarizePublicProfile(source);
  const activity = summarizePublicActivity({ ...source, events });
  await Promise.all([
    writeFile(output, renderSignal(summary), "utf8"),
    writeFile(activityOutput, renderShippingPulse(activity), "utf8"),
  ]);
  console.log(JSON.stringify({ output, activityOutput, summary, activity }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export {
  escapeXml,
  renderShippingPulse,
  renderSignal,
  summarizePublicActivity,
  summarizePublicProfile,
};
