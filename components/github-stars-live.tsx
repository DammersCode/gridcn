"use client";

import { useEffect, useState, type ReactNode } from "react";
import { GitHubStars } from "@/components/github-stars";

type GitHubStarsLiveProps = {
  /** GitHub repository in `owner/repo` format. */
  repo: string;
};

/** Client-side star-count fetch (public REST API, no auth/CSP concerns) wrapping {@link GitHubStars}. */
export function GitHubStarsLive({ repo }: GitHubStarsLiveProps): ReactNode {
  const [stargazersCount, setStargazersCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`https://api.github.com/repos/${repo}`, { headers: { Accept: "application/vnd.github+json" } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && typeof data?.stargazers_count === "number") {
          setStargazersCount(data.stargazers_count);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [repo]);

  if (stargazersCount === null) return null;
  return <GitHubStars repo={repo} stargazersCount={stargazersCount} />;
}
