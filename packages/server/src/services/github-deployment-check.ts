import { authGithub } from "../utils/providers/github";
import type { Application } from "./application";
import { findGithubById } from "./github";

type Conclusion = "success" | "failure" | "cancelled";

export const getDeploymentCommitSha = (description: string) =>
	description.match(/^Hash: ([a-f0-9]{40})$/i)?.[1];

/** Each deployment owns a check run, even when several apps build the same SHA. */
export const createGithubDeploymentCheck = ({
	application,
	deploymentId,
	detailsUrl,
	preview = false,
}: {
	application: Pick<
		Application,
		"sourceType" | "githubId" | "owner" | "repository" | "name" | "appName"
	>;
	deploymentId: string;
	detailsUrl: string;
	preview?: boolean;
}) => {
	const { sourceType, githubId, owner, repository, name, appName } =
		application;
	const checkName = `Dokploy / ${appName} / ${preview ? "Preview" : "Deploy"}`;
	let current:
		| { sha: string; id: number; octokit: ReturnType<typeof authGithub> }
		| undefined;
	let completed = false;

	const reportError = (operation: string, error: unknown) => {
		console.warn(
			`GitHub deployment check ${operation} failed for ${appName}: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	};

	const complete = async (conclusion: Conclusion) => {
		if (!current || completed) return;
		const title =
			conclusion === "success"
				? "Deployment succeeded"
				: conclusion === "failure"
					? "Deployment failed"
					: "Deployment superseded";
		try {
			await current.octokit.rest.checks.update({
				owner: owner!,
				repo: repository!,
				check_run_id: current.id,
				status: "completed",
				conclusion,
				completed_at: new Date().toISOString(),
				request: { timeout: 10_000 },
				output: {
					title,
					summary:
						conclusion === "cancelled"
							? "The deployment is not verified to be building this commit. See Dokploy for the commit and deployment logs."
							: `${name}: ${title.toLowerCase()}. [View deployment in Dokploy](${detailsUrl}).`,
				},
			});
			completed = true;
		} catch (error) {
			reportError("update", error);
		}
	};

	return {
		complete,
		async start(sha: string | undefined) {
			if (sourceType !== "github" || !githubId || !owner || !repository) {
				return;
			}
			if (!sha || !/^[a-f0-9]{40}$/i.test(sha)) {
				if (current) {
					await complete("cancelled");
					current = undefined;
				}
				return;
			}
			const normalizedSha = sha.toLowerCase();
			if (current?.sha === normalizedSha) return;
			if (current) {
				await complete("cancelled");
				current = undefined;
			}
			try {
				const github = await findGithubById(githubId);
				const octokit = authGithub(github);
				const { data } = await octokit.rest.checks.create({
					owner,
					repo: repository,
					name: checkName,
					head_sha: normalizedSha,
					external_id: deploymentId,
					details_url: detailsUrl,
					status: "in_progress",
					started_at: new Date().toISOString(),
					request: { timeout: 10_000 },
					output: {
						title: "Deployment in progress",
						summary: `${name} is being deployed. [View deployment in Dokploy](${detailsUrl}).`,
					},
				});
				current = { sha: normalizedSha, id: data.id, octokit };
				completed = false;
			} catch (error) {
				reportError("creation", error);
			}
		},
	};
};
