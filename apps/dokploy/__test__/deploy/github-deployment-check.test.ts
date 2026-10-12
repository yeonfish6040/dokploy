import {
	createGithubDeploymentCheck,
	getDeploymentCommitSha,
} from "@dokploy/server/services/github-deployment-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	findGithub: vi.fn(),
	authGithub: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
}));
vi.mock("@dokploy/server/services/github", () => ({
	findGithubById: mocks.findGithub,
}));
vi.mock("@dokploy/server/utils/providers/github", () => ({
	authGithub: mocks.authGithub,
}));

const sha = "a".repeat(40);
const nextSha = "b".repeat(40);
const options = {
	application: {
		sourceType: "github" as const,
		githubId: "github-id",
		owner: "owner",
		repository: "repo",
		name: "Web",
		appName: "web-unique",
	},
	deploymentId: "deployment-id",
	detailsUrl: "https://dokploy.example.com/dashboard/deployments",
};

describe("GitHub deployment checks", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-12T00:00:00.000Z"));
		mocks.findGithub.mockResolvedValue({ githubId: "github-id" });
		mocks.authGithub.mockReturnValue({ rest: { checks: mocks } });
		mocks.create.mockResolvedValue({ data: { id: 123 } });
		mocks.update.mockResolvedValue({});
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("creates an in-progress check on the supplied SHA using fresh provider credentials", async () => {
		const check = createGithubDeploymentCheck(options);
		await check.start(sha);
		expect(mocks.findGithub).toHaveBeenCalledWith("github-id");
		expect(mocks.authGithub).toHaveBeenCalledWith({ githubId: "github-id" });
		expect(mocks.create).toHaveBeenCalledWith(
			expect.objectContaining({
				owner: "owner",
				repo: "repo",
				name: "Dokploy / web-unique / Deploy",
				head_sha: sha,
				external_id: "deployment-id",
				details_url: options.detailsUrl,
				status: "in_progress",
				started_at: "2026-10-12T00:00:00.000Z",
			}),
		);
	});

	it.each(["success", "failure", "cancelled"] as const)(
		"completes the same run with %s",
		async (conclusion) => {
			const check = createGithubDeploymentCheck(options);
			await check.start(sha);
			await check.complete(conclusion);
			await check.complete(conclusion);
			expect(mocks.update).toHaveBeenCalledTimes(1);
			expect(mocks.update).toHaveBeenCalledWith(
				expect.objectContaining({
					check_run_id: 123,
					status: "completed",
					conclusion,
					completed_at: "2026-10-12T00:00:00.000Z",
				}),
			);
		},
	);

	it("does not recreate a run when the webhook and checkout SHAs agree", async () => {
		const check = createGithubDeploymentCheck(options);
		await check.start(sha.toUpperCase());
		await check.start(sha);
		expect(mocks.create).toHaveBeenCalledTimes(1);
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it("cancels a stale webhook run and completes only the actual checkout run", async () => {
		mocks.create
			.mockResolvedValueOnce({ data: { id: 123 } })
			.mockResolvedValueOnce({ data: { id: 456 } });
		const check = createGithubDeploymentCheck(options);
		await check.start(sha);
		await check.start(nextSha);
		await check.complete("success");
		expect(
			mocks.update.mock.calls.map(([value]) => [
				value.check_run_id,
				value.conclusion,
			]),
		).toEqual([
			[123, "cancelled"],
			[456, "success"],
		]);
		expect(mocks.create.mock.calls.map(([value]) => value.head_sha)).toEqual([
			sha,
			nextSha,
		]);
	});

	it("never reports success on an unverified checkout", async () => {
		const check = createGithubDeploymentCheck(options);
		await check.start(sha);
		await check.start(undefined);
		await check.complete("success");
		expect(mocks.update).toHaveBeenCalledTimes(1);
		expect(mocks.update).toHaveBeenCalledWith(
			expect.objectContaining({ conclusion: "cancelled" }),
		);
	});

	it("keeps preview check names stable when the application's service name changes", async () => {
		const application = { ...options.application };
		const check = createGithubDeploymentCheck({
			...options,
			application,
			preview: true,
		});
		application.appName = "preview-random-name";
		await check.start(sha);
		expect(mocks.create).toHaveBeenCalledWith(
			expect.objectContaining({ name: "Dokploy / web-unique / Preview" }),
		);
	});

	it("does not share a check run between concurrent deployments of the same commit", async () => {
		mocks.create
			.mockResolvedValueOnce({ data: { id: 123 } })
			.mockResolvedValueOnce({ data: { id: 456 } });
		const first = createGithubDeploymentCheck(options);
		const second = createGithubDeploymentCheck({
			...options,
			deploymentId: "other-id",
		});
		await first.start(sha);
		await second.start(sha);
		await first.complete("failure");
		await second.complete("success");
		expect(
			mocks.update.mock.calls.map(([value]) => [
				value.check_run_id,
				value.conclusion,
			]),
		).toEqual([
			[123, "failure"],
			[456, "success"],
		]);
	});

	it("does not interrupt deployment when check creation or completion is forbidden", async () => {
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
		mocks.create.mockRejectedValueOnce(new Error("Checks permission missing"));
		const missingPermission = createGithubDeploymentCheck(options);
		await expect(missingPermission.start(sha)).resolves.toBeUndefined();
		await expect(
			missingPermission.complete("failure"),
		).resolves.toBeUndefined();
		expect(mocks.update).not.toHaveBeenCalled();
		const check = createGithubDeploymentCheck(options);
		await check.start(sha);
		mocks.update.mockRejectedValueOnce(new Error("GitHub unavailable"));
		await expect(check.complete("success")).resolves.toBeUndefined();
		expect(warning).toHaveBeenCalledTimes(2);
	});

	it.each(["git", "gitlab", "gitea", "bitbucket", "docker"] as const)(
		"skips %s applications",
		async (sourceType) => {
			const check = createGithubDeploymentCheck({
				...options,
				application: { ...options.application, sourceType },
			});
			await check.start(sha);
			await check.complete("success");
			expect(mocks.findGithub).not.toHaveBeenCalled();
		},
	);

	it.each([undefined, "", "abc123", "main", `bad;${sha}`])(
		"ignores invalid SHAs: %s",
		async (value) => {
			await createGithubDeploymentCheck(options).start(value);
			expect(mocks.create).not.toHaveBeenCalled();
		},
	);

	it("only accepts full SHAs from the webhook deployment description", () => {
		expect(getDeploymentCommitSha(`Hash: ${sha}`)).toBe(sha);
		expect(getDeploymentCommitSha("Manual deployment")).toBeUndefined();
		expect(getDeploymentCommitSha("Hash: undefined")).toBeUndefined();
		expect(getDeploymentCommitSha(`Hash: ${sha}\nextra text`)).toBeUndefined();
	});
});
